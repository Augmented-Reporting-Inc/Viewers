/**
 * Pure (dependency-free) DICOM ultrasound-region calibration for the native
 * Cornerstone Length tool.
 *
 * Why this exists
 * ---------------
 * Cornerstone's LengthTool computes `worldLength / scale`, where for an image
 * with a matching US region `scale = 1 / PhysicalDeltaX` and the unit is
 * reported as "cm US Region". That is only correct when world units are
 * pixels. OHIF's imagePlaneModule gives single-region ultrasound a pixel
 * spacing of |PhysicalDelta| x 10 (mm), so the world length is already in mm
 * and the native preview applies the physical delta a second time:
 *
 *   native = pixels x (10 x dX) x dX      (labelled "cm US Region")
 *   true   = pixels x dX                  (cm)
 *
 * e.g. dX ~= 0.0327 cm/px: a 7.499 cm (74.99 mm) caliper previews as ~2.45 cm.
 *
 * This module recovers the continuous pixel index of each handle using the
 * SAME geometry Cornerstone uses to build the stack viewport's vtkImageData
 * (see @cornerstonejs/core utilities/getImageDataMetadata), then applies the
 * region's physical deltas once. Both the live on-image text and the completed
 * MeasurementService record call this function with the same inputs, so they
 * cannot disagree.
 *
 * Nothing here reads or writes annotation state; callers pass plain data.
 */

/** DICOM (0018,6024)/(0018,6026) Physical Units X/Y Direction: 0003H = cm. */
export const DICOM_US_PHYSICAL_UNIT_CM = 3;

/**
 * DICOM (0018,6014) Region Data Type values accepted for a Length, matching
 * Cornerstone's own SUPPORTED_REGION_DATA_TYPES (tissue, color flow, PW, CW).
 * The unit check below is what actually restricts us to spatial regions.
 */
const SUPPORTED_REGION_DATA_TYPES = new Set([1, 2, 3, 4]);

export type Vec3 = [number, number, number] | number[];

export type ImagePlaneLike =
  | {
      imagePositionPatient?: Vec3 | null;
      rowCosines?: Vec3 | null;
      columnCosines?: Vec3 | null;
      rowPixelSpacing?: number | string | null;
      columnPixelSpacing?: number | string | null;
    }
  | null
  | undefined;

export type UltrasoundRegionLike = {
  regionDataType?: number | string;
  regionLocationMinX0?: number | string;
  regionLocationMinY0?: number | string;
  regionLocationMaxX1?: number | string;
  regionLocationMaxY1?: number | string;
  physicalUnitsXDirection?: number | string;
  physicalUnitsYDirection?: number | string;
  physicalDeltaX?: number | string;
  physicalDeltaY?: number | string;
};

export type USRegionLengthResult = {
  /** Calibrated length in millimetres (the unit shown and persisted). */
  lengthMm: number;
  /** The same length in the DICOM region's native centimetres. */
  lengthCm: number;
  unit: 'mm';
  /** Index of the region in SequenceOfUltrasoundRegions that was applied. */
  regionIndex: number;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toVec3 = (value: unknown, fallback: number[] | null): number[] | null => {
  if (!value || typeof (value as ArrayLike<number>).length !== 'number') {
    return fallback;
  }
  const arr = Array.from(value as ArrayLike<unknown>)
    .slice(0, 3)
    .map(toFiniteNumber);
  return arr.length === 3 && arr.every(v => v !== null) ? (arr as number[]) : fallback;
};

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Convert a world point to a continuous image index [column, row] using the
 * exact geometry Cornerstone builds for a stack viewport:
 *   origin    = imagePositionPatient (pixel CENTER of index [0, 0])
 *   x axis    = rowCosines,    x spacing = columnPixelSpacing (|| 1)
 *   y axis    = columnCosines, y spacing = rowPixelSpacing    (|| 1)
 * This is the inverse of vtkImageData indexToWorld, i.e. what the native
 * LengthTool's transformWorldToIndex returns. Integer results are pixel
 * centres, which is the convention DICOM Region Location bounds use.
 *
 * Note: @cornerstonejs/core utilities.worldToImageCoords is NOT used, because
 * it pairs the cosines with the opposite spacing and shifts by half a pixel,
 * which is wrong for anisotropic spacing.
 */
export function worldToImageIndex(
  imagePlane: ImagePlaneLike,
  worldPoint: unknown
): [number, number] | null {
  const point = toVec3(worldPoint, null);
  if (!point) {
    return null;
  }

  const origin = toVec3(imagePlane?.imagePositionPatient, [0, 0, 0]) as number[];
  const rowCosines = toVec3(imagePlane?.rowCosines, [1, 0, 0]) as number[];
  const columnCosines = toVec3(imagePlane?.columnCosines, [0, 1, 0]) as number[];
  // Cornerstone treats 0 / null / missing spacing as 1 (pixel world units).
  const xSpacing = toFiniteNumber(imagePlane?.columnPixelSpacing) || 1;
  const ySpacing = toFiniteNumber(imagePlane?.rowPixelSpacing) || 1;
  if (xSpacing <= 0 || ySpacing <= 0) {
    return null;
  }

  const offset = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  const column = dot(offset, rowCosines) / xSpacing;
  const row = dot(offset, columnCosines) / ySpacing;

  return Number.isFinite(column) && Number.isFinite(row) ? [column, row] : null;
}

type NormalizedRegion = {
  index: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  deltaX: number;
  deltaY: number;
};

/**
 * A region is usable for a spatial Length only when BOTH axes are in cm and
 * both deltas are finite and non-zero. Any other unit (none/percent/dB/s/Hz/
 * cm/s/...) is rejected rather than reinterpreted, so the caller falls back
 * to Cornerstone's native behaviour.
 */
function normalizeSpatialCmRegion(
  region: UltrasoundRegionLike,
  index: number
): NormalizedRegion | null {
  if (!region || typeof region !== 'object') {
    return null;
  }
  const regionDataType = toFiniteNumber(region.regionDataType);
  if (regionDataType === null || !SUPPORTED_REGION_DATA_TYPES.has(regionDataType)) {
    return null;
  }
  if (
    toFiniteNumber(region.physicalUnitsXDirection) !== DICOM_US_PHYSICAL_UNIT_CM ||
    toFiniteNumber(region.physicalUnitsYDirection) !== DICOM_US_PHYSICAL_UNIT_CM
  ) {
    return null;
  }

  const minX = toFiniteNumber(region.regionLocationMinX0);
  const minY = toFiniteNumber(region.regionLocationMinY0);
  const maxX = toFiniteNumber(region.regionLocationMaxX1);
  const maxY = toFiniteNumber(region.regionLocationMaxY1);
  const deltaX = Math.abs(toFiniteNumber(region.physicalDeltaX) ?? NaN);
  const deltaY = Math.abs(toFiniteNumber(region.physicalDeltaY) ?? NaN);

  if ([minX, minY, maxX, maxY].some(v => v === null)) {
    return null;
  }
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || deltaX <= 0 || deltaY <= 0) {
    return null;
  }

  return { index, minX, minY, maxX, maxY, deltaX, deltaY };
}

const contains = (r: NormalizedRegion, [x, y]: [number, number]) =>
  x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

/**
 * Compute a calibrated spatial length when, and only when, both handles lie in
 * a spatial (cm x cm) ultrasound region. Returns null (=> use native behaviour)
 * when metadata is missing, the handles are invalid, the calipers span
 * regions, or several matching regions disagree on calibration.
 */
export function computeUSRegionLength({
  regions,
  imagePlane,
  points,
}: {
  regions: unknown;
  imagePlane: ImagePlaneLike;
  points: unknown;
}): USRegionLengthResult | null {
  if (!Array.isArray(regions) || !regions.length) {
    return null;
  }
  if (!Array.isArray(points) || points.length !== 2) {
    return null;
  }

  const index1 = worldToImageIndex(imagePlane, points[0]);
  const index2 = worldToImageIndex(imagePlane, points[1]);
  if (!index1 || !index2) {
    return null;
  }

  const matching = regions
    .map((region, i) => normalizeSpatialCmRegion(region, i))
    .filter(Boolean)
    .filter(r => contains(r, index1) && contains(r, index2));

  if (!matching.length) {
    return null;
  }

  // Nested/overlapping spatial regions (e.g. a colour box inside B-mode)
  // normally share calibration. If they do not, there is no defensible
  // choice, so do not guess.
  const [region] = matching;
  const EPS = 1e-9;
  if (
    matching.some(
      r => Math.abs(r.deltaX - region.deltaX) > EPS || Math.abs(r.deltaY - region.deltaY) > EPS
    )
  ) {
    return null;
  }

  // Apply each axis's own delta: correct for anisotropic regions too.
  const lengthCm = Math.hypot(
    (index1[0] - index2[0]) * region.deltaX,
    (index1[1] - index2[1]) * region.deltaY
  );
  if (!Number.isFinite(lengthCm)) {
    return null;
  }

  return {
    lengthCm,
    lengthMm: lengthCm * 10,
    unit: 'mm',
    regionIndex: region.index,
  };
}

/**
 * Cornerstone stack target ids are `imageId:<imageId>`. That imageId is
 * frame-specific, so it is preferred over the annotation's referencedImageId.
 * Volume (`volumeId:`) and other targets return null: US regions are defined
 * per 2D image and are not applied to reconstructed volumes.
 */
export function getImageIdForLengthTarget(
  targetId: unknown,
  referencedImageId?: string
): string | null {
  if (typeof targetId === 'string') {
    if (targetId.startsWith('imageId:')) {
      return targetId.slice('imageId:'.length) || null;
    }
    return null;
  }
  return referencedImageId || null;
}

/**
 * Convert a complete LV trace into a single, physically calibrated 2D plane.
 * The caller supplies validated ultrasound regions with bounds in image pixel
 * indices and row/column spacing expressed in mm per pixel. Never fall back
 * to bare world-coordinate distances or a default pixel spacing.
 */
export function calibrateUSContourPoints({
  points,
  imagePlane,
  regions,
}: {
  points: unknown;
  imagePlane: ImagePlaneLike;
  regions: Array<{
    minX: number; minY: number; maxX: number; maxY: number;
    column: number; row: number;
  }>;
}): number[][] | null {
  if (!Array.isArray(points) || points.length < 6 || !Array.isArray(regions)) {
    return null;
  }
  const indices = points.map(point => worldToImageIndex(imagePlane, point));
  if (indices.some(index => !index)) return null;
  const eligible = regions.filter(region =>
    region && [region.minX, region.minY, region.maxX, region.maxY, region.column, region.row]
      .every(value => Number.isFinite(Number(value))) &&
    region.column > 0 && region.row > 0 &&
    indices.every(([x, y]) =>
      x >= region.minX && x <= region.maxX &&
      y >= region.minY && y <= region.maxY
    )
  );
  if (!eligible.length) return null;
  const [region] = eligible;
  // Overlapping ultrasound regions with disagreeing calibration are unsafe.
  if (eligible.some(other =>
    Math.abs(other.column - region.column) > 1e-8 ||
    Math.abs(other.row - region.row) > 1e-8
  )) return null;
  const [originX, originY] = indices[0];
  return indices.map(([x, y]) => [
    (x - originX) * region.column,
    (y - originY) * region.row,
    0,
  ]);
}
