import { hasUnpersistedLearnerMeasurementChanges } from './learnerMeasurementReviewChange';

describe('report-owned learner saved measurement review', () => {
  const source = {
    annotationId: 'learner-length-1',
    toolName: 'Length',
    referencedImageId: 'wadors:test-study/series/test-series/instances/test-source/frames/7',
    frameNumber: 7,
    points: [[1, 2, 3], [4, 5, 6]],
    measurements: { value: 42, unit: 'mm' },
  };
  const unchanged = {
    isLearnerCopy: true,
    persistedAnnotations: [source],
    liveAnnotations: [{ ...source }],
    changedIds: [],
    deletedIds: [],
  };

  it('recognizes Save Draft -> Submit with the identical persisted caliper', () => {
    expect(hasUnpersistedLearnerMeasurementChanges(unchanged)).toBe(false);
  });

  it('recognizes reopen -> Submit when the saved learner source is not hydrated', () => {
    expect(hasUnpersistedLearnerMeasurementChanges({
      ...unchanged, liveAnnotations: [],
    })).toBe(false);
  });

  it('permits a sparse hydrated display adapter for an already saved source', () => {
    expect(hasUnpersistedLearnerMeasurementChanges({
      ...unchanged,
      liveAnnotations: [{
        annotationId: source.annotationId,
        toolName: source.toolName,
        referencedImageId: source.referencedImageId,
      }],
    })).toBe(false);
  });

  it('never treats an empty or non-learner source record as unchanged', () => {
    expect(hasUnpersistedLearnerMeasurementChanges({
      ...unchanged, persistedAnnotations: [],
    })).toBe(true);
    expect(hasUnpersistedLearnerMeasurementChanges({
      ...unchanged, isLearnerCopy: false,
    })).toBe(true);
  });

  it('detects new untracked calipers and contour sources by exact annotation ID', () => {
    expect(hasUnpersistedLearnerMeasurementChanges({
      ...unchanged,
      liveAnnotations: [source, { ...source, annotationId: 'new-contour' }],
    })).toBe(true);
  });

  it('does not bypass modified or deleted source state', () => {
    expect(hasUnpersistedLearnerMeasurementChanges({
      ...unchanged, changedIds: [source.annotationId],
    })).toBe(true);
    expect(hasUnpersistedLearnerMeasurementChanges({
      ...unchanged, deletedIds: [source.annotationId],
    })).toBe(true);
  });

  it('detects changes to the source DICOM frame, geometry or calibrated numeric value', () => {
    for (const edited of [
      { ...source, referencedImageId: 'wadors:other-image/frames/7' },
      { ...source, frameNumber: 8 },
      { ...source, points: [[1, 2, 3], [5, 6, 7]] },
      { ...source, measurements: { value: 50, unit: 'mm' } },
    ]) {
      expect(hasUnpersistedLearnerMeasurementChanges({
        ...unchanged, liveAnnotations: [edited],
      })).toBe(true);
    }
  });
});
