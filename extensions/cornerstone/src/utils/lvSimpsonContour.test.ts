import {
  buildEchoVolumeContourFromBaseAxis,
  buildLVSimpsonContourFromHingeApex,
} from './lvSimpsonContour';
import { calculateLVSimpson } from '../../../extension-ar-measurements/src/utils/lvSimpson';

describe('landmark-assisted LV EF contour', () => {
  const baseLeftPoint = [-24, 0, 0];
  const baseRightPoint = [24, 0, 0];
  const apexPoint = [0, 90, 0];

  it('anchors the true hinge endpoints and apex with fewer editable handles', () => {
    const contour = buildLVSimpsonContourFromHingeApex({
      baseLeftPoint,
      baseRightPoint,
      apexPoint,
    });

    expect(contour).not.toBeNull();
    expect(contour.points).toHaveLength(15);
    expect(contour.points[0]).toEqual(baseLeftPoint);
    expect(contour.points[contour.points.length - 1]).toEqual(baseRightPoint);
    expect(contour.points[contour.axisPointIndex]).toEqual(apexPoint);
    expect(contour.axisPointIndex).toBe(7);
    expect(contour.apexPoint).toEqual(apexPoint);
    expect(contour.axisPoint).toEqual(apexPoint);
    expect(contour.longAxisLengthMM).toBe(90);

    for (let i = 1; i < contour.points.length; i += 1) {
      expect(contour.points[i]).not.toEqual(contour.points[i - 1]);
    }
  });

  it('starts with a rounded cavity rather than linearly tapering triangle sides', () => {
    const { points } = buildLVSimpsonContourFromHingeApex({
      baseLeftPoint,
      baseRightPoint,
      apexPoint,
    });

    // The upper mid-cavity stays broader than a triangle with the same
    // hinge width and axis length. Left/right sides remain symmetric.
    const index = 3;
    const t = index / 7;
    const triangleHalfWidth = 24 * (1 - t);
    expect(Math.abs(points[index][0])).toBeGreaterThan(triangleHalfWidth * 1.4);
    expect(points[index][0]).toBeCloseTo(-points[14 - index][0]);
    expect(points[index][1]).toBeCloseTo(points[14 - index][1]);
    expect(points[7]).toEqual(apexPoint);
  });

  it('preserves hinge and apex locations for skewed 3D image planes', () => {
    const left = [2, 1, 4];
    const right = [18, 9, 4];
    const apex = [6, 76, 4];
    const result = buildLVSimpsonContourFromHingeApex({
      baseLeftPoint: left,
      baseRightPoint: right,
      apexPoint: apex,
      pointCountPerSide: 9,
    });

    expect(result.points).toHaveLength(19);
    expect(result.points[0]).toEqual(left);
    expect(result.points[18]).toEqual(right);
    expect(result.points[9]).toEqual(apex);
    expect(result.points.every(point => point[2] === 4)).toBe(true);
    expect(result.baseMidpoint).toEqual([10, 5, 4]);
    expect(result.longAxisLengthMM).toBeCloseTo(Math.hypot(-4, 71));
  });

  it('rejects missing or degenerate landmarks and invalid sample counts', () => {
    expect(buildLVSimpsonContourFromHingeApex({
      baseLeftPoint,
      baseRightPoint,
      apexPoint: [0, 0, 0],
    })).toBeNull();
    expect(buildLVSimpsonContourFromHingeApex({
      baseLeftPoint,
      baseRightPoint: baseLeftPoint,
      apexPoint,
    })).toBeNull();
    expect(buildLVSimpsonContourFromHingeApex({
      baseLeftPoint: null,
      baseRightPoint,
      apexPoint,
    })).toBeNull();
    expect(buildLVSimpsonContourFromHingeApex({
      baseLeftPoint,
      baseRightPoint,
      apexPoint,
      pointCountPerSide: 1,
    })).toBeNull();
  });

  it('keeps the LA generator separate and unchanged', () => {
    const la = buildEchoVolumeContourFromBaseAxis({
      baseLeftPoint,
      baseRightPoint,
      axisPoint: apexPoint,
    });
    expect(la.points).toHaveLength(19);
    expect(la.axisPoint).toEqual(apexPoint);
  });

  it('provides enough contour geometry for the existing biplane EF calculator', () => {
    const slot = (slotName: string, halfWidth: number) => {
      const geometry = buildLVSimpsonContourFromHingeApex({
        baseLeftPoint: [-halfWidth, 0, 0],
        baseRightPoint: [halfWidth, 0, 0],
        apexPoint,
      });

      return {
        measurementKind: 'lvSimpsonSlot',
        slot: slotName,
        lvSimpson: {
          ...geometry,
          measurementKind: 'lvSimpsonSlot',
          slot: slotName,
        },
        points: geometry.points,
      };
    };

    const result = calculateLVSimpson([
      slot('A4C_ED', 24),
      slot('A4C_ES', 17),
      slot('A2C_ED', 22),
      slot('A2C_ES', 16),
    ]);

    expect(result.status).toBe('complete');
    expect(result.values.edvML).toBeGreaterThan(result.values.esvML);
    expect(result.values.ejectionFraction).toBeGreaterThan(0);
    expect(result.values.ejectionFraction).toBeLessThan(100);
  });
});
