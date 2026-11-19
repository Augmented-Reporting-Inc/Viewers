import { getLearnerQuizMeasurementDeleteDenial } from './quizLearnerMeasurementDeletion';

describe('learner quiz measurement source deletion authorization', () => {
  const source = {
    uid: 'learner-caliper-1',
    workflow: 'viewerMeasurements',
    measurementOwner: 'learner',
    isLocked: false,
    toolName: 'Length',
  };
  const expectedTarget = {
    sopInstanceUID: 'test-source',
    referencedImageId: 'wadors:test-source/frames/7',
    frameNumber: 7,
  };
  const valid = {
    canEdit: true,
    isLearnerCopy: true,
    sourceId: source.uid,
    persistedOwned: true,
    source,
    expectedTarget,
    actualTarget: { ...expectedTarget },
  };

  it('allows the exact unlocked learner-owned Length caliper on its saved source frame', () => {
    expect(getLearnerQuizMeasurementDeleteDenial(valid)).toBe('');
  });

  it('allows a newly drawn learner session source before it is saved', () => {
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, persistedOwned: false, createdInSession: true,
    })).toBe('');
  });

  it('rejects educator authoring, read-only access, and a non-learner Series', () => {
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, canEdit: false,
    })).toBe('learner-measurements-not-editable');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, isLearnerCopy: false,
    })).toBe('learner-series-not-verified');
  });

  it('never treats a base-study or gold annotation with the same slot as learner-owned', () => {
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, persistedOwned: false, createdInSession: false,
    })).toBe('measurement-not-owned-by-learner');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, source: { ...source, measurementOwner: 'educator' },
    })).toBe('measurement-read-only');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, source: { ...source, workflow: 'viewerQuizGoldDisplay' },
    })).toBe('measurement-read-only');
  });

  it('rejects unknown, already deleted and mismatched annotation identities', () => {
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, sourceId: '',
    })).toBe('source-id-missing-or-already-deleted');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, alreadyDeleted: true,
    })).toBe('source-id-missing-or-already-deleted');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, source: { ...source, uid: 'another-caliper' },
    })).toBe('exact-learner-source-unavailable');
  });

  it('rejects different DICOM sources and exact-frame mismatches', () => {
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, actualTarget: { ...expectedTarget, sopInstanceUID: 'different-source' },
    })).toBe('learner-source-frame-mismatch');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, actualTarget: { ...expectedTarget, frameNumber: 9 },
    })).toBe('learner-source-frame-mismatch');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, actualTarget: { ...expectedTarget, referencedImageId: 'different-image' },
    })).toBe('learner-source-frame-mismatch');
  });

  it('does not bypass persisted locks, AR read-only flags, or a gold overlay', () => {
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, source: { ...source, isLocked: true },
    })).toBe('measurement-read-only');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, liveReadOnly: true,
    })).toBe('measurement-read-only');
    expect(getLearnerQuizMeasurementDeleteDenial({
      ...valid, stateReadOnly: true,
    })).toBe('measurement-read-only');
  });
});
