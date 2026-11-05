const DEFAULT_POINT_COUNT_PER_SIDE = 10;

function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function getPoint(point) {
  if (Array.isArray(point)) {
    const x = finiteNumber(point[0]);
    const y = finiteNumber(point[1]);
    const z = finiteNumber(point[2] ?? 0);

    return x == null || y == null || z == null ? null : [x, y, z];
  }

  if (point && typeof point === 'object') {
    const x = finiteNumber(point.x);
    const y = finiteNumber(point.y);
    const z = finiteNumber(point.z ?? 0);

    return x == null || y == null || z == null ? null : [x, y, z];
  }

  return null;
}

export function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

export function length(a) {
  return Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2);
}

export function midpoint(a, b) {
  return scale(add(a, b), 0.5);
}

export function normalize(a) {
  const vectorLength = length(a);
  return vectorLength > 0 ? scale(a, 1 / vectorLength) : null;
}

export function distance(a, b) {
  return length(subtract(a, b));
}

function interpolate(a, b, t) {
  return add(a, scale(subtract(b, a), t));
}

function smoothWidthProfile(t, baseHalfWidth) {
  const basalShoulder = 0.86 + 0.16 * Math.sin((Math.PI * Math.min(t, 0.7)) / 0.7);
  const superiorTaper = Math.pow(1 - t, 0.72);

  return Math.max(0, baseHalfWidth * basalShoulder * superiorTaper);
}

/**
 * Generic starting contour for echo chamber volume tracing.
 *
 * The two base points define the valve annular closure line. axisPoint is the
 * farthest point on the chamber long axis (LV apex or superior LA wall). The
 * generated spline is only a starting shape: the user remains responsible for
 * editing it to the actual endocardial/blood-tissue interface.
 */
export function buildEchoVolumeContourFromBaseAxis({
  baseLeftPoint,
  baseRightPoint,
  axisPoint,
  pointCountPerSide = DEFAULT_POINT_COUNT_PER_SIDE,
}) {
  const baseLeft = getPoint(baseLeftPoint);
  const baseRight = getPoint(baseRightPoint);
  const axis = getPoint(axisPoint);

  if (!baseLeft || !baseRight || !axis) {
    return null;
  }

  const baseMidpoint = midpoint(baseLeft, baseRight);
  const longAxisVector = subtract(axis, baseMidpoint);
  const longAxisLengthWorld = length(longAxisVector);
  const baseHalfWidth = distance(baseLeft, baseRight) / 2;

  if (!Number.isFinite(longAxisLengthWorld) || longAxisLengthWorld <= 0) {
    return null;
  }

  if (!Number.isFinite(baseHalfWidth) || baseHalfWidth <= 0) {
    return null;
  }

  const leftSide = [];
  const rightSide = [];

  for (let index = 0; index <= pointCountPerSide; index += 1) {
    const t = index / pointCountPerSide;
    const center = interpolate(baseMidpoint, axis, t);
    const leftGuide = interpolate(baseLeft, axis, t);
    const rightGuide = interpolate(baseRight, axis, t);

    const leftDirection = normalize(subtract(leftGuide, center));
    const rightDirection = normalize(subtract(rightGuide, center));
    const width = smoothWidthProfile(t, baseHalfWidth);

    if (!leftDirection || !rightDirection) {
      continue;
    }

    leftSide.push(add(center, scale(leftDirection, width)));
    rightSide.push(add(center, scale(rightDirection, width)));
  }

  // Keep the generated contour editable without making every tiny perimeter
  // segment a handle. Avoid duplicating the terminal long-axis point because
  // duplicate spline handles can render as a spike.
  const contourPoints = [...leftSide, ...rightSide.reverse().slice(1)];

  return {
    points: contourPoints,
    baseLeftPoint: baseLeft,
    baseRightPoint: baseRight,
    axisPoint: axis,
    axisPointIndex: leftSide.length - 1,
    baseMidpoint,
    longAxisLengthMM: longAxisLengthWorld,
  };
}

// The LV template is deliberately independent of the LA starting contour.
// A rounded, slightly bulbous LV cavity is a more useful initial trace than
// the generic tapered wedge, and fewer handles mean less point-by-point editing.
const DEFAULT_LV_POINT_COUNT_PER_SIDE = 7;

function lvRoundedWidthRatio(t: number) {
  // Elliptical apical rounding with a gentle basal/mid-cavity shoulder.
  // At t=0 the trace touches both mitral hinges; at t=1 it meets the apex.
  return Math.sqrt(Math.max(0, 1 - t * t)) * (1 + 0.18 * Math.sin(Math.PI * t));
}

/**
 * Landmark-assisted LV trace, not automatic boundary detection.
 *
 * The generated 15-handle spline is only an editable starting contour.
 * Preserve the true mitral hinge endpoints and the chosen apex as handles,
 * so LV volume calculation can use the same axis after manual reshaping.
 * Existing saved contours and the separate LA generator are not modified.
 */
export function buildLVSimpsonContourFromHingeApex({
  baseLeftPoint,
  baseRightPoint,
  apexPoint,
  pointCountPerSide = DEFAULT_LV_POINT_COUNT_PER_SIDE,
}) {
  const baseLeft = getPoint(baseLeftPoint);
  const baseRight = getPoint(baseRightPoint);
  const apex = getPoint(apexPoint);

  if (!baseLeft || !baseRight || !apex) {
    return null;
  }

  const baseMidpoint = midpoint(baseLeft, baseRight);
  const longAxisLengthMM = distance(baseMidpoint, apex);
  const baseHalfWidth = distance(baseLeft, baseRight) / 2;

  if (
    !Number.isInteger(pointCountPerSide) ||
    pointCountPerSide < 2 ||
    !Number.isFinite(longAxisLengthMM) ||
    longAxisLengthMM <= 0 ||
    !Number.isFinite(baseHalfWidth) ||
    baseHalfWidth <= 0
  ) {
    return null;
  }

  const halfBaseVector = scale(subtract(baseRight, baseLeft), 0.5);
  const leftSide = [];
  const rightSide = [];

  for (let index = 0; index <= pointCountPerSide; index += 1) {
    const t = index / pointCountPerSide;
    const center = interpolate(baseMidpoint, apex, t);
    const widthOffset = scale(halfBaseVector, lvRoundedWidthRatio(t));

    leftSide.push(subtract(center, widthOffset));
    rightSide.push(add(center, widthOffset));
  }

  // Visit the true apex once, between the two editable sides. Closing the
  // spline connects the right hinge back to the left across the mitral plane.
  const points = [...leftSide, ...rightSide.reverse().slice(1)];

  return {
    points,
    baseLeftPoint: baseLeft,
    baseRightPoint: baseRight,
    axisPoint: apex,
    apexPoint: apex,
    axisPointIndex: leftSide.length - 1,
    baseMidpoint,
    longAxisLengthMM,
  };
}

/**
 * Infer LV landmarks from a traced freehand endocardial border.
 *
 * The trace MUST start at one mitral hinge, follow the endocardial border
 * around the apex, and end at the opposite hinge. The implicit closing chord
 * represents the mitral annular plane. A generic arbitrarily-started closed
 * freehand loop is not safe for automatic EF landmark placement.
 *
 * Returns null when a credible basal chord and apex cannot be established.
 * Do not silently calculate an EF in this case.
 */
export function deriveLVSimpsonGeometryFromFreehand(contour) {
  if (!Array.isArray(contour)) return null;
  const points = contour.map(getPoint);
  if (points.length < 6 || points.some(point => !point)) return null;

  const baseLeftPoint = points[0];
  const baseRightPoint = points[points.length - 1];
  const baseVector = subtract(baseRightPoint, baseLeftPoint);
  const baseLength = length(baseVector);
  if (!Number.isFinite(baseLength) || baseLength <= 0) return null;

  const baseMidpoint = midpoint(baseLeftPoint, baseRightPoint);
  const baseUnit = normalize(baseVector);
  let axisPointIndex = -1;
  let greatestDistance = 0;
  let apexSide = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const offset = subtract(points[index], baseMidpoint);
    const projected = scale(baseUnit, offset[0] * baseUnit[0] +
      offset[1] * baseUnit[1] + offset[2] * baseUnit[2]);
    const perpendicular = subtract(offset, projected);
    const candidate = length(perpendicular);
    if (candidate > greatestDistance) {
      greatestDistance = candidate;
      axisPointIndex = index;
      apexSide = index;
    }
  }

  // A tracing that ends back at its starting hinge has no unambiguous
  // opposite mitral hinge. Also reject extremely shallow/degenerate traces.
  if (axisPointIndex < 1 || greatestDistance < baseLength * 0.4 ||
      baseLength < greatestDistance * 0.1) return null;

  const apexPoint = points[apexSide];
  const longAxisLengthMM = distance(baseMidpoint, apexPoint);
  if (!Number.isFinite(longAxisLengthMM) || longAxisLengthMM <= 0) return null;

  return {
    points,
    baseLeftPoint,
    baseRightPoint,
    baseMidpoint,
    apexPoint,
    axisPoint: apexPoint,
    axisPointIndex,
    longAxisLengthMM,
  };
}
