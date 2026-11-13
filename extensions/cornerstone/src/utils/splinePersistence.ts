/** Keep editable spline controls separate from the sampled display contour. */
export function getSplinePersistence(measurement: any, liveAnnotation?: any) {
  if (measurement?.toolName !== 'SplineROI') return {};
  const preserved = measurement?.metadata?.arSplinePersistence || {};
  const controls = liveAnnotation?.data?.handles?.points ||
    measurement.splineControlPoints || preserved.splineControlPoints;
  const type = liveAnnotation?.data?.spline?.type ||
    measurement.splineType || preserved.splineType;
  return Array.isArray(controls) && controls.length >= 3
    ? { splineControlPoints: (type === 'LINEAR' ? compactOversampledSpline(controls) : controls).map(point => Array.from(point)), splineType: type || 'CATMULLROM' }
    : {};
}

/** Legacy sampled contours have no original controls. A linear spline restores
 * those exact vertices without interpolating another 20 points per vertex. */
export function getSavedSplineType(annotation: any) {
  return annotation?.splineControlPoints?.length >= 3 ? annotation.splineType || 'CATMULLROM'
    : annotation?.lvSimpson?.originalContourPoints?.length >= 3 ? 'CATMULLROM' : 'LINEAR';
}

/** Remove excessive interpolation samples within one millionth of contour
 * extent. Retain source vertices, endpoints and area to 0.001%; ordinary
 * contours are returned unchanged. This also recovers bloated legacy saves. */
export function compactOversampledSpline(points: any[]) {
  if (!Array.isArray(points) || points.length <= 8192) return points;
  if (points.some(p => !Array.isArray(p) || p.length !== 3 || p.some(v => !Number.isFinite(v)))) return points;
  const min = [...points[0]], max = [...points[0]];
  for (const p of points) for (let j = 0; j < 3; j++) {
    min[j] = Math.min(min[j], p[j]); max[j] = Math.max(max[j], p[j]);
  }
  const tolerance2 = Math.max(...max.map((v, j) => v - min[j])) ** 2 * 1e-12;
  if (!tolerance2) return points;
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const delta = points[b].map((v, j) => v - points[a][j]);
    const length2 = delta.reduce((n, v) => n + v * v, 0);
    let farthest = -1, distance2 = tolerance2;
    for (let i = a + 1; i < b; i++) {
      const t = length2 ? Math.max(0, Math.min(1,
        points[i].reduce((n, v, j) => n + (v - points[a][j]) * delta[j], 0) / length2)) : 0;
      const d2 = points[i].reduce((n, v, j) => n + (v - points[a][j] - t * delta[j]) ** 2, 0);
      if (d2 > distance2) { distance2 = d2; farthest = i; }
    }
    if (farthest >= 0) {
      keep.add(farthest); stack.push([a, farthest], [farthest, b]);
    }
  }
  const compact = [...keep].sort((a, b) => a - b).map(i => points[i]);
  const area = contour => {
    const cross = [0, 0, 0];
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i], b = contour[(i + 1) % contour.length];
      for (let j = 0; j < 3; j++) cross[j] += a[(j + 1) % 3] * b[(j + 2) % 3] - a[(j + 2) % 3] * b[(j + 1) % 3];
    }
    return Math.hypot(...cross) / 2;
  };
  const originalArea = area(points);
  return compact.length >= 3 && originalArea > 0 &&
    Math.abs(area(compact) - originalArea) / originalArea <= 1e-5 ? compact : points;
}
