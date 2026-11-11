import {
  getCompositeGoldCaptureSignature,
  getCompositePhaseSlot,
  getCompositePhaseMeasurementId,
} from './quizCompositePhaseEvidence';

const PHASE_SLOTS: Record<string, string[]> = {
  rvFAC: ['RV_ED', 'RV_ES'],
  laVolumeBiplane: ['A4C', 'A2C'],
  laVolumeBiplaneDisks: ['A4C', 'A2C'],
  ivcCollapsibility: ['IVC_EXP', 'IVC_INSP'],
};

const UNIT_BY_KIND: Record<string, string> = {
  rvFAC: '%',
  laVolumeBiplane: 'mL',
  laVolumeBiplaneDisks: 'mL',
  ivcCollapsibility: '%',
};

function clean(value: any): string { return String(value ?? '').trim(); }
function asObject(value: any): any {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Composite calculator readiness is only a signal to capture the authoritative
 * Viewers result. Never calculate clinical values from uncalibrated geometry.
 *
 * A source/geometry fingerprint makes restored answers idempotent, but permits
 * edits of the original contours to replace stale captured source evidence.
 * Do not automatically capture an educator's gold or score a quiz here.
 */
export function getLearnerCompositeAutoCaptureSignature({
  question, liveMeasurements, status, savedAnswer,
}: {
  question: any;
  liveMeasurements: any[];
  status: any;
  savedAnswer?: any;
}): string {
  const kind = clean(question?.answerConfig?.measurementKind);
  const slots = PHASE_SLOTS[kind];
  if (!slots || question?.type !== 'measurementNumeric' ||
      status?.complete !== true ||
      status?.value == null || !Number.isFinite(Number(status.value)) ||
      clean(status.unit) !== UNIT_BY_KIND[kind]) return '';

  const measured = Array.isArray(liveMeasurements) ? liveMeasurements : [];
  // Reuse existing exact-study / guided phase validation but NEVER compare
  // the learner's source identity to educator gold component annotations.
  const signature = getCompositeGoldCaptureSignature({
    ...question,
    answerConfig: { ...asObject(question.answerConfig), goldMeasurement: null },
  }, measured);
  if (!signature) return '';

  const physical = asObject(status.phaseValues);
  if (!slots.every(slot =>
    physical[slot] != null &&
    Number.isFinite(Number(physical[slot])) &&
    Number(physical[slot]) > 0)) return '';
  const components = slots.map(slot => {
    const candidates = measured.filter(item => getCompositePhaseSlot(item, kind) === slot &&
      !item?.isLocked && !item?.arMeasurementReadOnly);
    if (candidates.length !== 1) return null;
    const candidate = candidates[0];
    const id = getCompositePhaseMeasurementId(candidate);
    if (!id) return null;
    const pts = Array.isArray(candidate.points) ? candidate.points :
      Array.isArray(candidate.measurements?.points) ? candidate.measurements.points : null;
    return { slot, id, points: pts };
  });
  if (components.some(component => !component)) return '';

  const saved = asObject(savedAnswer);
  const savedParts = asObject(saved.compositeResult).components;
  const matchesPrevious = Number(saved.value) === Number(status.value) &&
    clean(saved.unit) === clean(status.unit) &&
    Array.isArray(savedParts) && savedParts.length === slots.length &&
    components.every(component => {
      const previous = savedParts.find((part: any) => clean(part?.slot) === component?.slot);
      return previous && clean(previous.annotationId) === component?.id &&
        Array.isArray(previous.points) &&
        // When geometry is available in the live measurement, don't
        // accidentally treat an edited contour as an unchanged saved answer.
        (component?.points == null ||
          JSON.stringify(previous.points) === JSON.stringify(component.points));
    });
  if (matchesPrevious) return '';
  return JSON.stringify({
    kind, signature, value: Number(status.value),
    unit: clean(status.unit),
    phases: slots.map(slot => Number(physical[slot])),
    components,
  });
}

export function getLearnerCompositeSourceComponents(answer: any, kind: string): any[] {
  const parts = kind === 'ivcRapRvsp'
    ? asObject(asObject(asObject(answer).compositeResult).ivc?.compositeResult).components
    : asObject(asObject(answer).compositeResult).components;
  const slots = PHASE_SLOTS[kind === 'ivcRapRvsp' ? 'ivcCollapsibility' : kind];
  if (!slots || !Array.isArray(parts) || parts.length !== slots.length) return [];
  const result = slots.map(slot => parts.find((part: any) => clean(part?.slot) === slot));
  if (result.some((part: any) =>
    !part || !clean(part.annotationId) ||
    !Array.isArray(part.points) || part.points.length < (slotIsIVC(kind) ? 2 : 3) ||
    !clean(part.target?.studyInstanceUID) ||
    !clean(part.target?.seriesInstanceUID) ||
    !clean(part.target?.sopInstanceUID) ||
    !Number.isSafeInteger(Number(part.target?.frameNumber)) ||
    Number(part.target?.frameNumber) < 1 ||
    !clean(part.target?.referencedImageId))) return [];
  if (new Set(result.map((part: any) => clean(part.target.studyInstanceUID))).size !== 1) return [];
  return result;
}
function slotIsIVC(kind: string): boolean {
  return kind === 'ivcCollapsibility' || kind === 'ivcRapRvsp';
}
