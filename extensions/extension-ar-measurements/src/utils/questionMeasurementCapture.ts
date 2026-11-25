// Shared command contract for Education and Research. Neither workflow owns
// the viewer's calibrated measurement extraction.
export async function captureViewerQuestionMeasurement(commandsManager: any, options: any) {
  if (typeof commandsManager?.runCommand === 'function')
    return commandsManager.runCommand('getSelectedViewerMeasurementQuizAnswer', options);
  if (typeof commandsManager?.run === 'function')
    return commandsManager.run('getSelectedViewerMeasurementQuizAnswer', options);
  return null;
}
