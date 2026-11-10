import { calculateCalibratedEchoAreaCM2 } from './quizEchoAreaCalibration';

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
