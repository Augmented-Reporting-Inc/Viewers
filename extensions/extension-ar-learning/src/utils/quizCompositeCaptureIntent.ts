/**
 * Guard the EF progress-panel event before binding a calculated composite
 * to a quiz answer. The event itself is only a notification, not evidence.
 * The caller must fetch the current viewer-calculated active-study snapshot.
 */
export function isMatchingQuizEFCompletion({
  mode,
  authoringMode,
  questionKind,
  eventStudy,
  activeStudy,
  eventValue,
  currentValue,
}: {
  mode: string;
  authoringMode: boolean;
  questionKind: string;
  eventStudy: string;
  activeStudy: string;
  eventValue: unknown;
  currentValue: unknown;
}): boolean {
  if (mode !== 'manual' && mode !== 'completed') return false;
  if (authoringMode && mode === 'completed') return false;
  if (questionKind !== 'lvSimpsonEF') return false;
  if (!eventStudy || !activeStudy || eventStudy !== activeStudy) return false;
  const requested = Number(eventValue);
  const calculated = Number(currentValue);
  return Number.isFinite(requested) &&
    Number.isFinite(calculated) &&
    Math.round(requested * 100) === Math.round(calculated * 100);
}

export function isGuidedQuizCompositeKind(value: unknown): boolean {
  return [
    'lvSimpsonEF',
    'laVolumeBiplane',
    'laVolumeBiplaneDisks',
    'rvFAC',
    'raArea',
    'ivcCollapsibility',
    'trVmax',
    'trVTI',
    'ivcRapRvsp',
  ].includes(String(value || ''));
}

/**
 * A learner opening an educator-guided EF question must start at A4C_ED.
 * A previously saved answer (or scored composite) may refer to A2C_ES,
 * because it was recorded on the final contour. It must not override
 * the authored first frame. Explicit navigation overrides still win.
 */
export function getInitialGuidedEFQuestionTarget({
  questionType,
  measurementKind,
  authoredFirstFrame,
  existingTarget,
  hasTargetOverride = false,
}: {
  questionType: string;
  measurementKind: string;
  authoredFirstFrame?: any;
  existingTarget: any;
  hasTargetOverride?: boolean;
}): any {
  if (
    !hasTargetOverride &&
    questionType === 'measurementNumeric' &&
    measurementKind === 'lvSimpsonEF' &&
    authoredFirstFrame
  ) {
    return authoredFirstFrame;
  }
  return existingTarget;
}

/**
 * Submitted EF results that will be judged for contour position or overlap
 * must carry four independently captured contour slots. Numeric-only legacy
 * responses are permitted when neither geometry criterion was configured.
 * This is an early UX guard, not a substitute for server-side scoring.
 */
export function getEFQuizSubmissionEvidenceError(question: any, answer: any): string {
  if (question?.type !== 'measurementNumeric' ||
      String(question?.answerConfig?.measurementKind || '') !== 'lvSimpsonEF') return '';
  const scoring = question?.scoringConfig || {};
  const hasRadius = scoring.radius !== null &&
    scoring.radius !== undefined && String(scoring.radius).trim() !== '';
  if (!hasRadius && scoring.compositeContour?.enabled !== true) return '';
  const expected = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  const components = answer?.compositeResult?.components;
  if (!Array.isArray(components) || components.length !== expected.length ||
      new Set(components.map((part: any) => String(part?.slot || ''))).size !== expected.length ||
      !expected.every(slot => components.some((part: any) => part?.slot === slot &&
        Array.isArray(part.points) && part.points.length >= 3 &&
        part.points.every((point: any) => Array.isArray(point) &&
          point.length >= 2 && point.every((coordinate: any) =>
            typeof coordinate === 'number' && Number.isFinite(coordinate))) &&
        String(part.annotationId || '').trim() &&
        String(part.target?.sopInstanceUID || '').trim() &&
        Number.isInteger(Number(part.target?.frameNumber)) &&
        Number(part.target.frameNumber) >= 1))) {
    return 'EF answer is missing captured contour evidence. Reopen the EF measurement, complete and review all four contours, then capture the calculated result again before submitting.';
  }
  return '';
}
