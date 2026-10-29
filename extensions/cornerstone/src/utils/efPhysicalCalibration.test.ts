import { calibrateUSContourPoints } from './usRegionLengthCalibration';
import { buildLVSimpsonContourFromHingeApex } from './lvSimpsonContour';
import { calculateLVSimpson } from '../../../extension-ar-measurements/src/utils/lvSimpson';

const imagePlane = {
  imagePositionPatient: [0, 0, 0],
  rowCosines: [1, 0, 0],
  columnCosines: [0, 1, 0],
  columnPixelSpacing: 1,
  rowPixelSpacing: 1,
};
const regions = [{
  minX: 0, minY: 0, maxX: 300, maxY: 300,
  column: 0.3, row: 0.3,
}];

function makeMeasurement(slot, halfWidth, height, calibrated = true) {
  const contour = buildLVSimpsonContourFromHingeApex({
    baseLeftPoint: [150 - halfWidth, 100, 0],
    baseRightPoint: [150 + halfWidth, 100, 0],
    apexPoint: [150, 100 + height, 0],
  });
  const physicalPoints = calibrated
    ? calibrateUSContourPoints({ points: contour.points, imagePlane, regions })
    : null;
  const base = physicalPoints?.[0];
  const right = physicalPoints?.[physicalPoints.length - 1];
  const apex = physicalPoints?.[contour.axisPointIndex];
  const midpoint = base?.map((v, i) => (v + right[i]) / 2);
  const calibratedLongAxisLengthMM = midpoint && apex
    ? Math.hypot(...apex.map((v, i) => v - midpoint[i])) : null;
  return {
    measurementKind: 'lvSimpsonSlot',
    slot,
    points: contour.points,
    lvSimpson: {
      measurementKind: 'lvSimpsonSlot',
      slot,
      contourSource: 'hingeApexGenerated',
      axisPointIndex: contour.axisPointIndex,
      contourPoints: contour.points,
      originalContourPoints: physicalPoints ? contour.points.map(p => [...p]) : null,
      calibratedContourPoints: physicalPoints,
      calibratedLongAxisLengthMM,
      longAxisLengthMM: calibratedLongAxisLengthMM ?? contour.longAxisLengthMM,
    },
  };
}

describe('LV EF calibrated geometry', () => {
  test('transforms pixel-world coordinates to mm including anisotropic spacing', () => {
    const points = [[100, 100, 0], [105, 100, 0], [110, 100, 0],
      [110, 105, 0], [110, 110, 0], [100, 110, 0]];
    const converted = calibrateUSContourPoints({
      points, imagePlane,
      regions: [{ ...regions[0], column: 0.4, row: 0.2 }],
    });
    expect(converted[1]).toEqual([2, 0, 0]);
    expect(converted[4]).toEqual([4, 2, 0]);
  });

  test('rejects missing, out-of-region, and conflicting calibration', () => {
    const points = Array.from({ length: 6 }, (_, i) => [100 + i, 100, 0]);
    expect(calibrateUSContourPoints({ points, imagePlane, regions: [] })).toBeNull();
    expect(calibrateUSContourPoints({ points, imagePlane, regions: [
      { ...regions[0], maxX: 102 },
    ] })).toBeNull();
    expect(calibrateUSContourPoints({ points, imagePlane, regions: [
      regions[0], { ...regions[0], row: 0.6 },
    ] })).toBeNull();
  });

  test('calculates sane volumes only from calibrated four-slot contours', () => {
    const contours = [
      makeMeasurement('A4C_ED', 70, 190),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    const result = calculateLVSimpson(contours);
    expect(result?.status).toBe('complete');
    expect(result?.values?.edvML).toBeGreaterThan(5);
    expect(result?.values?.edvML).toBeLessThan(1000);
    expect(result?.values?.ejectionFraction).toBeGreaterThan(0);
    expect(result?.values?.ejectionFraction).toBeLessThan(100);
  });

  test('rejects uncalibrated and subsequently edited contours', () => {
    const contours = [
      makeMeasurement('A4C_ED', 70, 190, false),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    expect(calculateLVSimpson(contours)?.status).not.toBe('complete');
    contours[0] = makeMeasurement('A4C_ED', 70, 190);
    contours[0].points[3][0] += 2;
    expect(calculateLVSimpson(contours)?.status).not.toBe('complete');
  });
});
