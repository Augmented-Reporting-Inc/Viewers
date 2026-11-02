import {
  getTimedLearnerViewerTarget,
  assertTimedLearnerViewerDocument,
} from './timedLearnerViewerTarget';
import {
  getRequestedWorkflowAnnotations,
  upsertViewerMeasurementAnnotations,
} from './measurementAnnotations';

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

  it('preserves saved EF contour geometry and source frame on a learner copy', () => {
    const geometry = {
      uid: 'A4C-ED-contour',
      annotationId: 'A4C-ED-contour',
      toolName: 'SplineROI',
      label: 'A4C_ED',
      domain: 'echo',
      mode: 'single',
      SOPInstanceUID: '1.2.840.10008.5.1.4.1.1.6.1',
      frameNumber: 13,
      referencedImageId: 'wadors:study/series/instance/frames/13',
      points: [
        [12.34, 20.4, 0],
        [18.9, 42.75, 0],
        [13.12, 65.42, 0],
        [5.31, 42.75, 0],
      ],
    };
    const savedRaw = upsertViewerMeasurementAnnotations({
      existingRaw: null,
      source: 'ar-measurements-panel',
      annotations: [geometry],
      replaceDomains: ['echo'],
    });
    const reopened = getRequestedWorkflowAnnotations(savedRaw, ['viewerMeasurements']);
    expect(reopened).toHaveLength(1);
    expect(reopened[0].points).toEqual(geometry.points);
    expect(reopened[0].frameNumber).toBe(13);
    expect(reopened[0].referencedImageId).toBe(geometry.referencedImageId);
    expect(reopened[0].SOPInstanceUID).toBe(geometry.SOPInstanceUID);
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
