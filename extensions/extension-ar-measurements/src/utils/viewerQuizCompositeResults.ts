import { calculateLVSimpson, LV_SIMPSON_SLOT_ORDER } from './lvSimpson';
import { calculateLAVolume, calculateLABiplaneDisks, LA_VOLUME_SLOT_ORDER, LA_VOLUME_AREA_LENGTH_METHOD, LA_VOLUME_DISKS_METHOD } from './laVolume';
import { calculateRVFACFromMeasurements, calculateRAAreaFromMeasurements, getEchoAreaSlot } from './echoAreaMeasurements';
import { calculateIVCFromMeasurements, isIVCDiameterMeasurement } from './rightHeartMeasurements';

type Measurement = Record<string, any>;
type CompositeKind = 'lvSimpsonEF' | 'laVolumeBiplane' | 'laVolumeBiplaneDisks' | 'rvFAC' | 'raArea' | 'ivcCollapsibility';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function identifier(measurement: Measurement): string {
  return clean(
    measurement?.uid ||
      measurement?.annotationId ||
      measurement?.annotationUID ||
      measurement?.id
  );
}

function geometry(measurement: Measurement, kind: CompositeKind) {
  return kind === 'lvSimpsonEF'
    ? measurement?.lvSimpson || measurement?.measurements?.lvSimpson || {}
    : kind === 'rvFAC' || kind === 'raArea'
      ? measurement?.echoArea || measurement?.measurements?.echoArea || {}
      : measurement?.laVolume || measurement?.measurements?.laVolume || {};
}

function sourceKind(measurement: Measurement): string {
  return clean(measurement?.measurementKind || measurement?.measurements?.measurementKind);
}

function slotOf(measurement: Measurement, kind: CompositeKind): string {
  const g = geometry(measurement, kind);
  const slot = kind === 'ivcCollapsibility'
    ? (() => {
        if (!isIVCDiameterMeasurement(measurement)) return '';
        const label = clean(measurement?.label || measurement?.measurementRole || measurement?.role)
          .toLowerCase().replace(/[\s_-]+/g, '');
        return ['ivcexp', 'ivcexpiration', 'ivcendexpiration', 'ivcendexpirationdiameter'].includes(label)
          ? 'IVC_EXP' : 'IVC_INSP';
      })()
    : kind === 'rvFAC' || kind === 'raArea'
      ? getEchoAreaSlot(measurement)
      : clean(g?.slot || measurement?.slot).toUpperCase();
  return slot || '';
}

/**
 * For multiframe EF contours, the referenced image is the actual viewed
 * frame. Some legacy annotations retain a default frameNumber=1 despite
 * referencing another /frames/N image. Do not transfer that stale number
 * into newly authored gold/scored composite evidence.
 *
 * Restrict this correction to EF; other measurement contracts are unchanged.
 */
function efSourceFrameNumber(measurement: Measurement): number {
  const imageId = clean(
    measurement?.referencedImageId || measurement?.metadata?.referencedImageId
  );
  const match = imageId.match(/\/frames\/([1-9][0-9]*)(?:[/?#]|$)/);
  if (match) {
    const referencedFrame = Number(match[1]);
    if (Number.isSafeInteger(referencedFrame)) return referencedFrame;
  }
  return Number(measurement?.frameNumber || measurement?.metadata?.frameNumber || 0);
}

// The FormAPI EF evidence contract rejects contours above 5,000 points.
// Keep a margin for future protocol metadata and leave clinical/source contours
// untouched. This reduces only the polygon sent as spatial quiz evidence.
const MAX_EF_QUIZ_EVIDENCE_POINTS = 4096;

/**
 * Select a deterministic, ordered subset of original contour vertices.
 * This preserves the original spatial coordinate system, endpoints, and
 * explicit polygon closure without rounding or changing EF calculations.
 * Only EF quiz evidence is bounded; other composite measurements are intact.
 */
export function boundEFQuizEvidencePoints(points: number[][]): number[][] {
  if (points.length <= MAX_EF_QUIZ_EVIDENCE_POINTS) return points;
  const last = points.length - 1;
  const output: number[][] = [];
  for (let index = 0; index < MAX_EF_QUIZ_EVIDENCE_POINTS; index++) {
    const sourceIndex = Math.floor(index * last / (MAX_EF_QUIZ_EVIDENCE_POINTS - 1));
    output.push(points[sourceIndex]);
  }
  return output;
}

function collectComponents(measurements: Measurement[], kind: CompositeKind) {
  const isIVC = kind === 'ivcCollapsibility';
  const isRightHeart = kind === 'rvFAC' || kind === 'raArea' || isIVC;
  const expectedKind = kind === 'lvSimpsonEF' ? 'lvSimpsonSlot' : isRightHeart ? 'echoAreaSlot' : 'laVolumeSlot';
  const requiredSlots = kind === 'lvSimpsonEF' ? LV_SIMPSON_SLOT_ORDER
    : kind === 'rvFAC' ? ['RV_ED', 'RV_ES']
    : kind === 'raArea' ? ['RA_ES']
    : isIVC ? ['IVC_EXP', 'IVC_INSP'] : LA_VOLUME_SLOT_ORDER;
  const components = new Map<string, { slot: string; annotationId: string; points: number[][]; target: Record<string, unknown> }>();

  for (const measurement of measurements) {
    if (isIVC ? !isIVCDiameterMeasurement(measurement) || clean(measurement.toolName) !== 'Length'
      : sourceKind(measurement) !== expectedKind) continue;
    const slot = slotOf(measurement, kind);
    const annotationId = identifier(measurement);
    if (isRightHeart && !requiredSlots.includes(slot)) continue;
    if (!requiredSlots.includes(slot) || !annotationId || components.has(slot)) {
      return null; // Ambiguous, incomplete, or untraceable evidence must not be scored.
    }
    const contour = geometry(measurement, kind);
    const rawPoints = Array.isArray(measurement?.points) && measurement.points.length >= (isIVC ? 2 : 3)
      ? measurement.points
      : (contour.contourPoints || contour.points || []);
    const points = Array.isArray(rawPoints)
      ? rawPoints.map(point => Array.isArray(point)
        ? point.slice(0, 3)
        : [point?.x, point?.y, point?.z ?? 0])
      : [];
    const validPoints = points.length >= (isIVC ? 2 : 3) &&
      points.every(point => point.length >= 2 &&
        point.every(value => Number.isFinite(Number(value))));
    components.set(slot, {
      slot,
      annotationId,
      points: validPoints
        ? (kind === 'lvSimpsonEF'
          ? boundEFQuizEvidencePoints(points.map(point => [Number(point[0]), Number(point[1]), Number(point[2] ?? 0)]))
          : points.map(point => [Number(point[0]), Number(point[1]), Number(point[2] ?? 0)]))
        : [],
      target: {
        studyInstanceUID: clean(measurement.referenceStudyUID || measurement.StudyInstanceUID),
        seriesInstanceUID: clean(measurement.referenceSeriesUID || measurement.SeriesInstanceUID),
        sopInstanceUID: clean(measurement.SOPInstanceUID || measurement.metadata?.SOPInstanceUID),
        referencedImageId: clean(measurement.referencedImageId || measurement.metadata?.referencedImageId),
        frameNumber: kind === 'lvSimpsonEF'
          ? efSourceFrameNumber(measurement)
          : Number(measurement.frameNumber || measurement.metadata?.frameNumber || 0),
      },
    });
  }

  if (components.size !== requiredSlots.length) return null;
  const ordered = requiredSlots.map(slot => components.get(slot)!);
  if (isRightHeart) {
    if (ordered.some(c => !c.annotationId || c.points.length < (isIVC ? 2 : 3) ||
        !c.target.studyInstanceUID || !c.target.seriesInstanceUID ||
        !c.target.sopInstanceUID || !(Number(c.target.frameNumber) > 0))) return null;
    if (kind === 'rvFAC' || isIVC) {
      const ed = ordered[0].target;
      const es = ordered[1].target;
      if (ed.studyInstanceUID !== es.studyInstanceUID ||
          (ed.seriesInstanceUID !== es.seriesInstanceUID &&
           ed.sopInstanceUID === es.sopInstanceUID) ||
          (ed.sopInstanceUID === es.sopInstanceUID &&
           ed.frameNumber === es.frameNumber)) return null;
    }
  }
  return ordered;
}

/**
 * Compare the value reviewed in the persistent EF progress panel with the
 * freshly recalculated quiz-capture value at the quiz's two-decimal precision.
 * A different value must be reviewed again, rather than silently captured.
 */
export function isViewerQuizCompositeReviewCurrent(
  reviewedValue: unknown,
  captureValue: unknown
): boolean {
  const reviewed = Number(reviewedValue);
  const captured = Number(captureValue);

  return Number.isFinite(reviewed) &&
    Number.isFinite(captured) &&
    Math.round(reviewed * 100) === Math.round(captured * 100);
}

/**
 * Read-only resolver for complete viewer-generated composite measurement results.
 *
 * This supplies a viewer-calculated numeric result and source references for
 * practice-quiz scoring. It is not independent, exam-grade evidence validation.
 */
export function resolveViewerQuizCompositeResult(
  kind: CompositeKind,
  measurements: Measurement[] = [],
  calculatedResult?: ReturnType<typeof calculateLVSimpson> | ReturnType<typeof calculateLAVolume> | ReturnType<typeof calculateRVFACFromMeasurements> | ReturnType<typeof calculateRAAreaFromMeasurements> | ReturnType<typeof calculateIVCFromMeasurements>
) {
  if (!['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility'].includes(kind)) return null;
  if (!Array.isArray(measurements)) return null;

  const components = collectComponents(measurements, kind);
  if (!components) return null;

  const result = calculatedResult ??
    (kind === 'lvSimpsonEF'
      ? calculateLVSimpson(measurements)
      : kind === 'laVolumeBiplaneDisks'
        ? calculateLABiplaneDisks(measurements)
        : kind === 'rvFAC'
          ? calculateRVFACFromMeasurements(measurements)
          : kind === 'raArea'
            ? calculateRAAreaFromMeasurements(measurements)
            : kind === 'ivcCollapsibility'
              ? calculateIVCFromMeasurements(measurements)
              : calculateLAVolume(measurements));

  const expectedMethodId = kind === 'laVolumeBiplane'
    ? LA_VOLUME_AREA_LENGTH_METHOD
    : kind === 'laVolumeBiplaneDisks'
      ? LA_VOLUME_DISKS_METHOD
      : kind === 'rvFAC' ? 'rv-fac-planimetry-v1'
        : kind === 'raArea' ? 'ra-area-planimetry-v1'
        : kind === 'ivcCollapsibility' ? 'ivc-collapsibility-v1'
        : null;
  if (['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(kind) &&
      expectedMethodId && (!result || !('methodId' in result) || result.methodId !== expectedMethodId)) return null;

  const value = kind === 'lvSimpsonEF' ? result?.values?.ejectionFraction
    : kind === 'rvFAC' ? result?.values?.facPercent
    : kind === 'raArea' ? result?.values?.areaCM2
    : kind === 'ivcCollapsibility' ? result?.values?.collapsibilityPercent
    : result?.values?.volumeML;

  if (result?.status !== 'complete' || typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return {
    schemaVersion: 1,
    measurementKind: kind,
    ...(expectedMethodId ? { methodId: expectedMethodId } : {}),
    value,
    unit: kind === 'lvSimpsonEF' || kind === 'rvFAC' || kind === 'ivcCollapsibility'
      ? '%' : kind === 'raArea' ? 'cm2' : 'mL',
    components,
    ...(kind === 'ivcCollapsibility' && result?.values ? {
      derived: {
        expirationDiameterMM: (result.values as any).expirationDiameterMM,
        inspirationDiameterMM: (result.values as any).inspirationDiameterMM,
        collapsibilityPercent: (result.values as any).collapsibilityPercent,
      },
    } : {}),
  };
}

/**
 * Resolve the exact active-study evidence used for both the viewer EF summary
 * and the quiz's numeric EF capture. Never blend saved annotations or contours
 * from unrelated studies into an authoring/learner quiz gold answer.
 */
export function resolveViewerQuizLVSimpsonForStudy(
  studyInstanceId: string,
  measurements: Measurement[] = []
) {
  const studyId = clean(studyInstanceId);
  if (!studyId || !Array.isArray(measurements)) return null;

  const studyMeasurements = measurements.filter(measurement =>
    clean(measurement?.referenceStudyUID || measurement?.StudyInstanceUID) === studyId
  );
  // Calculate EF once from this exact study snapshot. Build the scored
  // composite and clinical volume result from the same calculation.
  const result = calculateLVSimpson(studyMeasurements);
  if (result?.status !== 'complete' || !result.values) return null;

  const composite = resolveViewerQuizCompositeResult('lvSimpsonEF', studyMeasurements, result);
  if (!composite) return null;

  return { studyInstanceId: studyId, composite, result };
}
