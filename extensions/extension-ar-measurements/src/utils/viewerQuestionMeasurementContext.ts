/**
 * Viewer question selection uses the same toolbar context in Research and
 * Education. The persistence and score contexts are deliberately NOT shared.
 */
const RESEARCH_ECHO_QUIZ_KINDS: Record<string, string> = Object.freeze({
  lvEjectionFraction: 'lvSimpsonEF',
  laVolumeDisks: 'laVolumeBiplaneDisks',
  laVolume: 'laVolumeBiplane',
  rvFac: 'rvFAC',
  trVmax: 'trVmax',
  ivcCollapsibility: 'ivcCollapsibility',
});

export function getResearchViewerQuestionMeasurementKind(
  field: any,
  domain: string = 'echo'
): string {
  if (String(domain).trim().toLowerCase() !== 'echo') return '';
  return RESEARCH_ECHO_QUIZ_KINDS[String(field?.componentKey || '').trim()] || '';
}

/**
 * Uses the same command as CaseQuestionsPanel's learner and educator
 * selection. Changing the context releases stale EF/LA/TR session listeners
 * and updates the toolbar, but intentionally does NOT start a drawing.
 *
 * A new stroke is only started by an explicit measurement control. This
 * preserves the existing research review annotations until a replacement
 * can be validated and saved to the correct ResearchReview.
 */
export async function setViewerQuestionMeasurementContext(
  commandsManager: any,
  measurementKind: string
) {
  if (!commandsManager) return null;
  const options = { measurementKind: String(measurementKind || '').trim() };
  if (typeof commandsManager.runCommand === 'function') {
    return commandsManager.runCommand('setViewerQuizMeasurementContext', options);
  }
  if (typeof commandsManager.run === 'function') {
    return commandsManager.run('setViewerQuizMeasurementContext', options);
  }
  return null;
}
