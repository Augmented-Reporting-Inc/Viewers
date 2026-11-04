import { buildRVFACContourFromAnnulusApex } from './rvFacContour';

describe('RV landmark-assisted contour seed', () => {
  it('preserves free-wall hinge, septal hinge and apex as editable points', () => {
    const free = [-20, 0, 0];
    const septum = [20, 0, 0];
    const apex = [0, 75, 0];
    const result = buildRVFACContourFromAnnulusApex({
      freeWallHingePoint: free,
      septalHingePoint: septum,
      apexPoint: apex,
    });
    expect(result).not.toBeNull();
    expect(result!.points.length).toBe(21);
    expect(result!.points[0]).toEqual(free);
    expect(result!.points[10]).toEqual(apex);
    expect(result!.points[20]).toEqual(septum);
    expect(result!.contourSource).toBe('annulusApexGenerated');
  });

  it('rejects missing and degenerate anatomical landmarks', () => {
    expect(buildRVFACContourFromAnnulusApex({
      freeWallHingePoint: [0, 0, 0],
      septalHingePoint: [0, 0, 0],
      apexPoint: [0, 70, 0],
    })).toBeNull();
    expect(buildRVFACContourFromAnnulusApex({
      freeWallHingePoint: [-20, 0, 0],
      septalHingePoint: [20, 0, 0],
      apexPoint: null,
    })).toBeNull();
  });

  it('stays asymmetric and exposes only finite editable coordinates', () => {
    const result = buildRVFACContourFromAnnulusApex({
      freeWallHingePoint: [-15, 4, 0],
      septalHingePoint: [25, 4, 0],
      apexPoint: [5, 74, 0],
    })!;
    expect(result.points.every(p => p.every(Number.isFinite))).toBe(true);
    expect(result.points[5][0]).not.toBeCloseTo(2 * 5 - result.points[15][0], 2);
  });
});
