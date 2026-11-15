import { getMeasurementSnapshotStudyInstanceId } from './measurementSnapshotStudy';

describe('measurement snapshot source study', () => {
  const attempt = {
    StudyInstanceUID: 'old-camosun-study',
    optimization: {
      status: 'complete',
      optimizedStudyInstanceId: 'mohawk-dicom-study',
    },
  };

  it('uses optimized source study for report-owned learner attempts', () => {
    expect(getMeasurementSnapshotStudyInstanceId(attempt, true)).toBe('mohawk-dicom-study');
  });

  it('preserves the original study filter for clinical and other save targets', () => {
    expect(getMeasurementSnapshotStudyInstanceId(attempt, false)).toBe('old-camosun-study');
  });

  it('does not select incomplete or missing optimized studies', () => {
    expect(getMeasurementSnapshotStudyInstanceId({
      ...attempt, optimization: { status: 'pending', optimizedStudyInstanceId: 'future-study' },
    }, true)).toBe('old-camosun-study');
    expect(getMeasurementSnapshotStudyInstanceId({
      ...attempt, optimization: { status: 'complete' },
    }, true)).toBe('old-camosun-study');
  });

  it('retains the normal behavior when the optimized study is the same', () => {
    expect(getMeasurementSnapshotStudyInstanceId({
      StudyInstanceUID: 'mohawk-dicom-study',
      optimization: { status: 'complete', optimizedStudyInstanceId: 'mohawk-dicom-study' },
    }, true)).toBe('mohawk-dicom-study');
  });
});
