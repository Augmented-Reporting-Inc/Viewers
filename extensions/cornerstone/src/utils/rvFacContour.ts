/**
 * Landmark-assisted right-ventricular area contour.
 *
 * The first tricuspid hinge is the RV free-wall attachment, the second hinge
 * is septal, and the third landmark is the apex. The initial contour is
 * deliberately asymmetric and MUST be refined against the actual endocardium:
 * it is an editable starting spline, not automatic boundary detection.
 *
 * Area is calculated from the subsequently edited, calibrated Cornerstone ROI.
 */
type Point = [number, number, number];

function point(value: unknown): Point | null {
  if (Array.isArray(value)) {
    const [x, y, z = 0] = value.map(Number);
    return [x, y, z].every(Number.isFinite) ? [x, y, z] : null;
  }
  if (value && typeof value === 'object') {
    const item = value as { x?: number; y?: number; z?: number };
    const x = Number(item.x);
    const y = Number(item.y);
    const z = Number(item.z ?? 0);
    return [x, y, z].every(Number.isFinite) ? [x, y, z] : null;
  }
  return null;
}

function between(a: Point, b: Point, t: number): Point {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function offset(a: Point, v: Point, factor: number): Point {
  return [
    a[0] + v[0] * factor,
    a[1] + v[1] * factor,
    a[2] + v[2] * factor,
  ];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function buildRVFACContourFromAnnulusApex({
  freeWallHingePoint,
  septalHingePoint,
  apexPoint,
  pointCountPerSide = 10,
}: {
  freeWallHingePoint: unknown;
  septalHingePoint: unknown;
  apexPoint: unknown;
  pointCountPerSide?: number;
}) {
  const free = point(freeWallHingePoint);
  const septum = point(septalHingePoint);
  const apex = point(apexPoint);
  if (!free || !septum || !apex || !Number.isInteger(pointCountPerSide) ||
      pointCountPerSide < 4 || pointCountPerSide > 40) {
    return null;
  }

  const midpoint: Point = between(free, septum, 0.5);
  const annulusLength = distance(free, septum);
  const axisLength = distance(midpoint, apex);
  if (!(annulusLength > 0 && axisLength > 0 && axisLength > annulusLength * 0.2)) {
    return null;
  }

  const halfWidthVector: Point = [
    (septum[0] - free[0]) / 2,
    (septum[1] - free[1]) / 2,
    (septum[2] - free[2]) / 2,
  ];
  const freeWall: Point[] = [];
  const septalWall: Point[] = [];

  for (let index = 0; index <= pointCountPerSide; index += 1) {
    const t = index / pointCountPerSide;
    const center = between(midpoint, apex, t);
    const taper = Math.sqrt(Math.max(0, 1 - t * t));
    // Mild asymmetry only; never invent anatomical borders.
    const freeWidth = taper * (1 + 0.18 * Math.sin(Math.PI * t));
    const septalWidth = taper * (1 - 0.10 * Math.sin(Math.PI * t));
    freeWall.push(offset(center, halfWidthVector, -freeWidth));
    septalWall.push(offset(center, halfWidthVector, septalWidth));
  }

  const points = [...freeWall, ...septalWall.reverse().slice(1)];
  return {
    points,
    freeWallHingePoint: free,
    septalHingePoint: septum,
    apexPoint: apex,
    axisPointIndex: pointCountPerSide,
    longAxisLengthWorld: axisLength,
    contourSource: 'annulusApexGenerated',
  };
}
