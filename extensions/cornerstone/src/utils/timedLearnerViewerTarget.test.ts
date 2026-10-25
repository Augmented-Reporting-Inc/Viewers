import {
  getTimedLearnerViewerTarget,
  assertTimedLearnerViewerDocument,
} from './timedLearnerViewerTarget';

const learnerId = '507f1f77bcf86cd799439011';
const baseId = '507f1f77bcf86cd799439012';

function params(options: Record<string, string> = {}) {
  return new URLSearchParams(options);
}

describe('attempt-scoped viewer measurement persistence', () => {
  it('preserves existing clinical and untimed learning behavior', () => {
    expect(getTimedLearnerViewerTarget(params())).toBeNull();
    expect(getTimedLearnerViewerTarget(params({
      arSaveTarget: 'learnerCopyOnSave',
      arBaseSeriesId: baseId,
    }))).toBeNull();
    expect(getTimedLearnerViewerTarget(params({
      arSaveTarget: 'clinicalReportMeasurements',
      arSeriesId: learnerId,
    }))).toBeNull();
  });

  it('requires the learner copy and correct mode for an explicitly timed exam', () => {
    expect(getTimedLearnerViewerTarget(params({
      arTimedAssessment: '1',
      arSaveTarget: 'learnerCopyOnSave',
      arLearnerSeriesId: learnerId,
      arBaseSeriesId: baseId,
    }))).toEqual({
      saveTarget: 'learnerCopyOnSave',
      learnerSeriesId: learnerId,
    });
    expect(() => getTimedLearnerViewerTarget(params({
      arTimedAssessment: '1', arSaveTarget: 'learnerCopyOnSave',
    }))).toThrow(/persisted assessment attempt/);
    expect(() => getTimedLearnerViewerTarget(params({
      arTimedAssessment: '1', arSaveTarget: 'clinicalReportMeasurements',
      arLearnerSeriesId: learnerId,
    }))).toThrow(/persisted assessment attempt/);
    expect(() => getTimedLearnerViewerTarget(params({
      arTimedAssessment: '1', arSaveTarget: 'learnerCopyOnSave',
      arLearnerSeriesId: baseId, arBaseSeriesId: baseId,
    }))).toThrow(/persisted assessment attempt/);
  });

  it('refuses successful base-study hydration or shared container pretending to be learner copy', () => {
    const target = { learnerSeriesId: learnerId };
    expect(() => assertTimedLearnerViewerDocument({
      _id: learnerId, isLearnerCopy: true,
    }, target)).not.toThrow();
    for (const bad of [
      null,
      { _id: baseId, isLearnerCopy: true },
      { _id: learnerId, isLearnerCopy: false },
      { _id: learnerId },
    ]) {
      expect(() => assertTimedLearnerViewerDocument(bad, target))
        .toThrow(/unrelated Series document/);
    }
    expect(() => assertTimedLearnerViewerDocument(null, null)).not.toThrow();
  });
});
