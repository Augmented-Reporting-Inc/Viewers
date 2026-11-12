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

/**
 * The completion event is only a trigger. The freshly captured result must
 * still correspond to the same numeric value and exact two source annotation
 * IDs reported by the live composite resolver. A stale async response from a
 * previous question or contour edit must never replace an answer.
 */
export function isLearnerCompositeCaptureCurrent(
  captured: any, status: any, measurementKind: string
): boolean {
  const slots = PHASE_SLOTS[measurementKind];
  if (!slots || status?.complete !== true ||
      clean(captured?.measurementKind) !== measurementKind ||
      clean(captured?.unit) !== clean(status.unit) ||
      !Number.isFinite(Number(captured?.value)) ||
      !Number.isFinite(Number(status.value)) ||
      Math.abs(Number(captured.value) - Number(status.value)) > 0.005) return false;
  const savedParts = asObject(captured.compositeResult).components;
  const currentParts = status.components;
  if (!Array.isArray(savedParts) || !Array.isArray(currentParts) ||
      savedParts.length !== slots.length || currentParts.length !== slots.length) return false;
  return slots.every(slot => {
    const saved = savedParts.filter((part: any) => clean(part?.slot) === slot);
    const current = currentParts.filter((part: any) => clean(part?.slot) === slot);
    return saved.length === 1 && current.length === 1 &&
      !!clean(saved[0].annotationId) &&
      clean(saved[0].annotationId) === clean(current[0].annotationId) &&
      Array.isArray(saved[0].points) && saved[0].points.length >= (slotIsIVC(measurementKind) ? 2 : 3) &&
      clean(saved[0].target?.studyInstanceUID) &&
      clean(saved[0].target?.sopInstanceUID) &&
      Number.isSafeInteger(Number(saved[0].target?.frameNumber)) &&
      Number(saved[0].target.frameNumber) > 0;
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

/**
 * Learner quiz saving must persist the underlying phase annotations in the
 * isolated learner Series, not only a numeric/geometry-bearing quiz response.
 * Match each saved contour to the persisted source by full DICOM identity.
 */
export function getLearnerCompositePersistenceSources(
  questions: any[], answers: Record<string, any> = {}
): Array<{ annotationId: string; target: any }> {
  const sources: Array<{ annotationId: string; target: any }> = [];
  for (const question of Array.isArray(questions) ? questions : []) {
    if (question?.type !== 'measurementNumeric') continue;
    const kind = clean(question?.answerConfig?.measurementKind);
    const answer = asObject(answers[question.questionKey]);
    // A learner's spectral TR Vmax must persist as an actual source
    // annotation on the isolated learner Series, not merely as an answer
    // scalar in quiz JSON. Use the same exact DICOM source verifier as
    // composite phase measurements.
    if (kind === 'trVmax') {
      const value = Number(answer.value);
      const annotationId = clean(answer.sourceAnnotationId);
      const target = asObject(answer.viewerTarget);
      if (answer.measurementKind === 'trVmax' && answer.unit === 'm/s' &&
          Number.isFinite(value) && value > 0 && value <= 8 &&
          annotationId && !sources.some(source => source.annotationId === annotationId)) {
        sources.push({ annotationId, target });
      }
      continue;
    }
    const phases = getLearnerCompositeSourceComponents(answer, kind);
    for (const part of phases) {
      const annotationId = clean(part.annotationId);
      if (!annotationId || sources.some(source => source.annotationId === annotationId)) continue;
      sources.push({ annotationId, target: part.target });
    }
  }
  return sources;
}

export function isPersistedLearnerCompositeSource(
  saved: any, source: { annotationId: string; target: any }
): boolean {
  if (!saved || !source) return false;
  const target = asObject(source.target);
  const frame = Number(target.frameNumber);
  const savedId = getCompositePhaseMeasurementId(saved);
  const expectedFrame = clean(target.referencedImageId)
    .match(/\/frames\/([1-9][0-9]*)(?:[/?#]|$)/);
  const actualImage = clean(saved.referencedImageId || saved.metadata?.referencedImageId);
  const actualFrame = actualImage.match(/\/frames\/([1-9][0-9]*)(?:[/?#]|$)/);
  return savedId === clean(source.annotationId) &&
    clean(saved.StudyInstanceUID || saved.referenceStudyUID) === clean(target.studyInstanceUID) &&
    clean(saved.SeriesInstanceUID || saved.referenceSeriesUID) === clean(target.seriesInstanceUID) &&
    clean(saved.SOPInstanceUID || saved.metadata?.SOPInstanceUID) === clean(target.sopInstanceUID) &&
    Number.isSafeInteger(frame) && frame > 0 &&
    !!expectedFrame && Number(expectedFrame[1]) === frame &&
    !!actualFrame && Number(actualFrame[1]) === frame &&
    clean(target.referencedImageId) === actualImage &&
    Array.isArray(saved.points) && saved.points.length >= 2;
}

/** Require server readback of the structured learner evidence that drives
 * RVSP. A successful HTTP response is not sufficient if the backend silently
 * drops the source-linked TR or RAP/RVSP component. */
export function getLearnerHemodynamicReadbackError(
  questions: any[], localAnswers: Record<string, any>,
  responseAnswers: any[]
): string {
  const remote = new Map((Array.isArray(responseAnswers) ? responseAnswers : [])
    .map(row => [clean(row?.questionKey), asObject(row?.value)]));
  const sameTarget = (a: any, b: any) => {
    const left = asObject(a), right = asObject(b);
    return ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID'].every(
      field => clean(left[field]) && clean(left[field]) === clean(right[field])
    ) && Number.isInteger(Number(left.frameNumber)) &&
      Number(left.frameNumber) > 0 &&
      Number(left.frameNumber) === Number(right.frameNumber);
  };
  for (const question of Array.isArray(questions) ? questions : []) {
    if (question?.type !== 'measurementNumeric') continue;
    const kind = clean(question.answerConfig?.measurementKind);
    const key = clean(question.questionKey);
    const local = asObject(localAnswers?.[key]);
    const saved = remote.get(key) || {};
    if (kind === 'trVmax' && local.measurementKind === 'trVmax' &&
        clean(local.sourceAnnotationId) && Number.isFinite(Number(local.value))) {
      if (saved.measurementKind !== 'trVmax' ||
          clean(saved.sourceAnnotationId) !== clean(local.sourceAnnotationId) ||
          clean(saved.unit) !== 'm/s' ||
          Number(saved.value) !== Number(local.value) ||
          !sameTarget(saved.viewerTarget, local.viewerTarget)) {
        return 'TR Vmax calibrated value or DICOM source was not persisted in the AR quiz response.';
      }
    }
    if (kind === 'ivcCollapsibility') {
      const expected = asObject(local.compositeResult);
      const actual = asObject(saved.compositeResult);
      const review = asObject(expected.rapRvsp);
      if (review.methodId !== 'ivc-rap-rvsp-v1') continue;
      const actualReview = asObject(actual.rapRvsp);
      const expectedTR = asObject(asObject(review.trVmax).answer);
      const actualTR = asObject(asObject(actualReview.trVmax).answer);
      if (actualReview.methodId !== review.methodId ||
          Number(actual.rapMMHG) !== Number(expected.rapMMHG) ||
          clean(asObject(actualReview.trVmax).questionKey) !==
            clean(asObject(review.trVmax).questionKey) ||
          clean(actualTR.sourceAnnotationId) !== clean(expectedTR.sourceAnnotationId) ||
          (expected.rvspMMHG != null && (
            actual.rvspMMHG == null ||
            Number(actual.rvspMMHG) !== Number(expected.rvspMMHG) ||
            Number(actual.trGradientMMHG) !== Number(expected.trGradientMMHG)))) {
        return 'IVC RAP/RVSP interpretation or linked TR Vmax source was not persisted in the AR quiz response.';
      }
    }
  }
  return '';
}
