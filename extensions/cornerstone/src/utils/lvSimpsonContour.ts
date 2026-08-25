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

export function buildLVSimpsonContourFromHingeApex({
  baseLeftPoint,
  baseRightPoint,
  apexPoint,
  pointCountPerSide = DEFAULT_POINT_COUNT_PER_SIDE,
}) {
  const geometry = buildEchoVolumeContourFromBaseAxis({
    baseLeftPoint,
    baseRightPoint,
    axisPoint: apexPoint,
    pointCountPerSide,
  });

  if (!geometry) {
    return null;
  }

  return {
    ...geometry,
    apexPoint: geometry.axisPoint,
  };
}
