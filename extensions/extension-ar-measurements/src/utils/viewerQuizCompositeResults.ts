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
  const components = new Map<string, { slot: string; annotationId: string }>();

  for (const measurement of measurements) {
    if (sourceKind(measurement) !== expectedKind) continue;
    const slot = slotOf(measurement, kind);
    const annotationId = identifier(measurement);
    if (!requiredSlots.includes(slot) || !annotationId || components.has(slot)) {
      return null; // Ambiguous, incomplete, or untraceable evidence must not be scored.
    }
    components.set(slot, { slot, annotationId });
  }

  if (components.size !== requiredSlots.length) return null;
  return requiredSlots.map(slot => components.get(slot)!);
}

/**
 * Read-only resolver for complete viewer-generated composite measurement results.
 *
 * This does not enable quiz authoring or grading by itself. The API scorer must
 * independently validate each component against the learner's persisted attempt
 * before these results can be accepted as automatically graded answers.
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
