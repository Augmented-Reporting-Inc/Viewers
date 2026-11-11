import { calculateCalibratedEchoAreaCM2, getSavedQuizEchoAreaDisplayInfo } from './quizEchoAreaCalibration';

describe('DICOM-calibrated quiz echo area', () => {
  it('calculates physical area in cm² from already calibrated millimetres', () => {
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0, 0], [20, 0, 0], [20, 15, 0], [0, 15, 0],
    ])).toBeCloseTo(3, 8);
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0, 0], [20, 0, 0], [20, 15, 0], [0, 15, 0], [0, 0, 0],
    ])).toBeCloseTo(3, 8);
  });
  it('rejects unmeasurable and non-finite contours', () => {
    expect(calculateCalibratedEchoAreaCM2([])).toBeNull();
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0], [1, 1], [2, 2],
    ])).toBeNull();
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0], [Infinity, 0], [0, 1],
    ])).toBeNull();
  });
});


describe('saved echo quiz area display units', () => {
  it('preserves calibrated cm² values and unit metadata without relabeling them as mm²', () => {
    expect(getSavedQuizEchoAreaDisplayInfo(31.26, 'cm2')).toEqual({
      value: 31.26, areaUnit: 'cm²', linearUnit: 'cm',
    });
    expect(getSavedQuizEchoAreaDisplayInfo(19.31, 'cm²')).toEqual({
      value: 19.31, areaUnit: 'cm²', linearUnit: 'cm',
    });
  });
  it('preserves actual mm² values without converting or relabeling them', () => {
    expect(getSavedQuizEchoAreaDisplayInfo(3126, 'mm²')).toEqual({
      value: 3126, areaUnit: 'mm²', linearUnit: 'mm',
    });
  });
  it('rejects pixel areas, missing units, and invalid areas', () => {
    expect(getSavedQuizEchoAreaDisplayInfo(31.26, 'px²')).toBeNull();
    expect(getSavedQuizEchoAreaDisplayInfo(31.26, '')).toBeNull();
    expect(getSavedQuizEchoAreaDisplayInfo(null, 'cm2')).toBeNull();
    expect(getSavedQuizEchoAreaDisplayInfo(-1, 'cm2')).toBeNull();
  });
});
