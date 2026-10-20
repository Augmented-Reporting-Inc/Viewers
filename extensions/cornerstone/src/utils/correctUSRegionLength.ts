import { metaData } from '@cornerstonejs/core';

// DICOM ultrasound-region physical deltas for spatial length measurement are
// in centimetres when Physical Units X/Y Direction = 3 (cm).
const SPATIAL_CM_UNIT = 3;
const SUPPORTED_REGION_DATA_TYPES = new Set([1, 2, 3, 4]);

/**
 * Resolve a physical spatial length only when BOTH handles fall inside the
 * same DICOM US region. Non-spatial Doppler/time regions are not Length values.
 * Return null rather than guessing when metadata is missing or incompatible.
 */
export function getUSRegionLengthCalibration(referencedImageId, annotation) {
  if (!referencedImageId) return null;

  try {
    const regions = metaData.get('calibrationModule', referencedImageId)
      ?.sequenceOfUltrasoundRegions;
    const handles = annotation?.data?.handles?.points;
    if (!Array.isArray(regions) || !Array.isArray(handles) || handles.length !== 2) {
      return null;
    }

    const imagePlane = metaData.get('imagePlaneModule', referencedImageId);
    const colSpacing = Number(imagePlane?.columnPixelSpacing ?? 1);
    const rowSpacing = Number(imagePlane?.rowPixelSpacing ?? 1);
    if (!Number.isFinite(colSpacing) || !Number.isFinite(rowSpacing) ||
        colSpacing <= 0 || rowSpacing <= 0) return null;

    const pixelHandles = handles.map(w => ({
      x: Number(w?.[0]) / colSpacing,
      y: Number(w?.[1]) / rowSpacing,
    }));
    if (pixelHandles.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      return null;
    }

    const region = regions.find(r =>
      SUPPORTED_REGION_DATA_TYPES.has(Number(r.regionDataType)) &&
      Number(r.physicalUnitsXDirection) === SPATIAL_CM_UNIT &&
      Number(r.physicalUnitsYDirection) === SPATIAL_CM_UNIT &&
      pixelHandles.every(p =>
        p.x >= Number(r.regionLocationMinX0) &&
        p.x <= Number(r.regionLocationMaxX1) &&
        p.y >= Number(r.regionLocationMinY0) &&
        p.y <= Number(r.regionLocationMaxY1)
      )
    );
    if (!region) return null;

    const dx = Math.abs(Number(region.physicalDeltaX));
    const dy = Math.abs(Number(region.physicalDeltaY));
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) {
      return null;
    }

    const [p1, p2] = pixelHandles;
    const lengthCm = Math.hypot((p1.x - p2.x) * dx, (p1.y - p2.y) * dy);
    return Number.isFinite(lengthCm) ? { lengthCm, unit: 'cm' } : null;
  } catch (error) {
    console.warn('[Length] ultrasound region calibration unavailable:', error);
    return null;
  }
}

/** Preserve the original public scalar contract for MeasurementService. */
export function correctUSRegionLength(rawLength, referencedImageId, annotation) {
  return getUSRegionLengthCalibration(referencedImageId, annotation)?.lengthCm ?? rawLength;
}
