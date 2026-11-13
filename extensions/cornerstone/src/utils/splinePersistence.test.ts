import { getSplinePersistence, getSavedSplineType, compactOversampledSpline } from './splinePersistence';

const circle = (count: number) => Array.from({ length: count + 1 }, (_, i) =>
  [20 * Math.cos(i / count * 2 * Math.PI), 10 * Math.sin(i / count * 2 * Math.PI), 0]);

it('persists sparse editable controls independently of a dense rendered spline', () => {
  const controls = circle(12), polyline = circle(240);
  const saved = { toolName: 'SplineROI', points: polyline,
    ...getSplinePersistence({ toolName: 'SplineROI' }, {
      data: { handles: { points: controls }, spline: { type: 'CATMULLROM' } },
    }) };
  expect(saved.splineControlPoints).toEqual(controls);
  expect(saved.splineControlPoints).not.toBe(controls);
  expect(getSavedSplineType(saved)).toBe('CATMULLROM');
  expect(getSavedSplineType({ points: polyline })).toBe('LINEAR');
  expect(getSavedSplineType({ lvSimpson: { originalContourPoints: controls } })).toBe('CATMULLROM');
});

it('recovers an oversized legacy contour with bounded geometric and area error', () => {
  const points = circle(200000);
  const compact = compactOversampledSpline(points);
  expect(compact.length).toBeLessThan(8192);
  expect(compact[0]).toBe(points[0]);
  expect(compact[compact.length - 1]).toBe(points[points.length - 1]);
  const area = poly => Math.abs(poly.reduce((total, p, i) => {
    const q = poly[(i + 1) % poly.length]; return total + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
  expect(Math.abs(area(points) - area(compact)) / area(points)).toBeLessThan(0.00001);
  expect(compactOversampledSpline(compact)).toBe(compact);
});

it('does not alter ordinary source contours or invalid geometry', () => {
  const points = circle(100);
  expect(compactOversampledSpline(points)).toBe(points);
  const invalid = Array.from({ length: 9000 }, () => [NaN, 0, 0]);
  expect(compactOversampledSpline(invalid)).toBe(invalid);
  expect(getSplinePersistence({ toolName: 'Length' }, {})).toEqual({});
});


it('round-trips sparse controls through MeasurementService-approved metadata', () => {
  const controls = circle(12);
  const original = getSplinePersistence({ toolName: 'SplineROI' }, {
    data: { handles: { points: controls }, spline: { type: 'CATMULLROM' } },
  });
  const mapped = {
    toolName: 'SplineROI',
    points: circle(240),
    metadata: { arSplinePersistence: original },
  };
  // OHIF sees no unknown top-level splineControlPoints/splineType keys.
  expect(mapped).not.toHaveProperty('splineControlPoints');
  expect(mapped).not.toHaveProperty('splineType');
  const saved = getSplinePersistence(mapped);
  expect(saved.splineControlPoints).toEqual(controls);
  expect(saved.splineType).toBe('CATMULLROM');
  expect(getSavedSplineType(saved)).toBe('CATMULLROM');
});
