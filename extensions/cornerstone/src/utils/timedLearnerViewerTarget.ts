/**
 * A timed learner's viewer measurements belong to its persisted learner
 * attempt, never to the base Series or a shared imaging container.
 *
 * This client-side check is not authorization; FormAPI independently checks
 * tenant, authenticated learner, DICOM identity and deadline.
 */
export function getTimedLearnerViewerTarget(qs: URLSearchParams) {
  if (qs.get('arTimedAssessment') !== '1') return null;
  const saveTarget = String(qs.get('arSaveTarget') || '').trim();
  const learnerSeriesId = String(qs.get('arLearnerSeriesId') || '').trim();
  const baseSeriesId = String(qs.get('arBaseSeriesId') || '').trim();

  if (saveTarget !== 'learnerCopyOnSave' ||
      !learnerSeriesId || learnerSeriesId === baseSeriesId) {
    throw new Error('Timed learner viewer is missing its persisted assessment attempt.');
  }
  return { saveTarget: 'learnerCopyOnSave', learnerSeriesId };
}

export function assertTimedLearnerViewerDocument(
  seriesDoc: any,
  expectedTarget: { learnerSeriesId: string } | null
) {
  if (!expectedTarget) return;
  if (!seriesDoc || seriesDoc.isLearnerCopy !== true ||
      String(seriesDoc._id || '') !== expectedTarget.learnerSeriesId) {
    throw new Error('Timed learner viewer resolved an unrelated Series document.');
  }
}
