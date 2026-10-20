import { calculateLVSimpson, LV_SIMPSON_SLOT_ORDER } from './lvSimpson';
import { calculateLAVolume, LA_VOLUME_SLOT_ORDER } from './laVolume';

type Measurement = Record<string, any>;
type CompositeKind = 'lvSimpsonEF' | 'laVolumeBiplane';

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
    : measurement?.laVolume || measurement?.measurements?.laVolume || {};
}

function sourceKind(measurement: Measurement): string {
  return clean(measurement?.measurementKind || measurement?.measurements?.measurementKind);
}

function slotOf(measurement: Measurement, kind: CompositeKind): string {
  const g = geometry(measurement, kind);
  const slot = clean(g?.slot || measurement?.slot).toUpperCase();
  return slot;
}

function collectComponents(measurements: Measurement[], kind: CompositeKind) {
  const expectedKind = kind === 'lvSimpsonEF' ? 'lvSimpsonSlot' : 'laVolumeSlot';
  const requiredSlots = kind === 'lvSimpsonEF' ? LV_SIMPSON_SLOT_ORDER : LA_VOLUME_SLOT_ORDER;
  const components = new Map<string, { slot: string; annotationId: string; points: number[][]; target: Record<string, unknown> }>();

  for (const measurement of measurements) {
    if (sourceKind(measurement) !== expectedKind) continue;
    const slot = slotOf(measurement, kind);
    const annotationId = identifier(measurement);
    if (!requiredSlots.includes(slot) || !annotationId || components.has(slot)) {
      return null; // Ambiguous, incomplete, or untraceable evidence must not be scored.
    }
    const contour = geometry(measurement, kind);
    const rawPoints = Array.isArray(measurement?.points) && measurement.points.length >= 3
      ? measurement.points
      : (contour.contourPoints || contour.points || []);
    const points = Array.isArray(rawPoints)
      ? rawPoints.map(point => Array.isArray(point)
        ? point.slice(0, 3)
        : [point?.x, point?.y, point?.z ?? 0])
      : [];
    const validPoints = points.length >= 3 &&
      points.every(point => point.length >= 2 &&
        point.every(value => Number.isFinite(Number(value))));
    components.set(slot, {
      slot,
      annotationId,
      points: validPoints ? points.map(point => [Number(point[0]), Number(point[1]), Number(point[2] ?? 0)]) : [],
      target: {
        studyInstanceUID: clean(measurement.referenceStudyUID || measurement.StudyInstanceUID),
        seriesInstanceUID: clean(measurement.referenceSeriesUID || measurement.SeriesInstanceUID),
        sopInstanceUID: clean(measurement.SOPInstanceUID || measurement.metadata?.SOPInstanceUID),
        referencedImageId: clean(measurement.referencedImageId || measurement.metadata?.referencedImageId),
        frameNumber: Number(measurement.frameNumber || measurement.metadata?.frameNumber || 0),
      },
    });
  }

  if (components.size !== requiredSlots.length) return null;
  return requiredSlots.map(slot => components.get(slot)!);
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
  measurements: Measurement[] = []
) {
  if (kind !== 'lvSimpsonEF' && kind !== 'laVolumeBiplane') return null;
  if (!Array.isArray(measurements)) return null;

  const components = collectComponents(measurements, kind);
  if (!components) return null;

  const result =
    kind === 'lvSimpsonEF'
      ? calculateLVSimpson(measurements)
      : calculateLAVolume(measurements);

  const value =
    kind === 'lvSimpsonEF'
      ? result?.values?.ejectionFraction
      : result?.values?.volumeML;

  if (result?.status !== 'complete' || typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return {
    schemaVersion: 1,
    measurementKind: kind,
    value,
    unit: kind === 'lvSimpsonEF' ? '%' : 'mL',
    components,
  };
}
