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
  return value === 'lvSimpsonEF' || value === 'laVolumeBiplane';
}
