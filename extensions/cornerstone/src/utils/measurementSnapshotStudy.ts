/**
 * Report-owned learner attempts may retain their historical top-level study
 * identity while rendering an optimized source study. Native Cornerstone
 * annotations must be selected against the study actually rendered.
 *
 * Other viewer save workflows retain their existing top-level study filter.
 */
export function getMeasurementSnapshotStudyInstanceId(
  seriesDoc: any = {},
  isReportOwnedMeasurementSave = false
): string {
  const originalStudy = String(seriesDoc?.StudyInstanceUID || '').trim();
  const optimization = seriesDoc?.optimization || {};
  const optimizedStudy = String(optimization?.optimizedStudyInstanceId || '').trim();

  return isReportOwnedMeasurementSave &&
    String(optimization?.status || '').trim().toLowerCase() === 'complete' &&
    optimizedStudy
    ? optimizedStudy
    : originalStudy;
}
