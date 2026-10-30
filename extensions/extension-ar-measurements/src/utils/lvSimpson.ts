const SAMPLE_COUNT = 20;
const AXIS_MISMATCH_WARNING_RATIO = 0.15;
const AXIS_MISMATCH_BLOCK_RATIO = 0.35;
const MIN_WIDTH_COVERAGE_RATIO = 0.8;

export const LV_SIMPSON_SLOT_ORDER = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];

const LV_SIMPSON_SLOT_INFO = {
  A4C_ED: { slot: 'A4C_ED', view: 'A4C', phase: 'ED', display: 'A4C ED' },
  A4C_ES: { slot: 'A4C_ES', view: 'A4C', phase: 'ES', display: 'A4C ES' },
  A2C_ED: { slot: 'A2C_ED', view: 'A2C', phase: 'ED', display: 'A2C ED' },
  A2C_ES: { slot: 'A2C_ES', view: 'A2C', phase: 'ES', display: 'A2C ES' },
};

function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getPoint(point) {
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

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a) {
  return Math.sqrt(dot(a, a));
}

function normalize(a) {
  const vectorLength = length(a);
  return vectorLength > 0 ? scale(a, 1 / vectorLength) : null;
}

function getGeometry(measurement) {
  return measurement?.lvSimpson || measurement?.measurements?.lvSimpson || {};
}

function getSlot(measurement) {
  const geometry = getGeometry(measurement);
  const explicitSlot = String(geometry.slot || measurement?.slot || '').trim();

  if (LV_SIMPSON_SLOT_INFO[explicitSlot]) {
    return explicitSlot;
  }

  const label = String(
    geometry.label || measurement?.measurementRole || measurement?.label || measurement?.role || ''
  ).toUpperCase();
  const match = label.match(/^LV-(A[24]C)-(ED|ES)$/);

  return match ? `${match[1]}_${match[2]}` : '';
}

function getContourPoints(measurement) {
  const geometry = getGeometry(measurement);
  const points = geometry.calibratedContourPoints;
  return (Array.isArray(points) ? points : []).map(getPoint).filter(Boolean);
}

// SplineROI densely samples the same border: a different point count alone
// does not imply an edit. Check the two polylines geometrically, in both
// directions, while requiring the original mitral hinge endpoints to agree.
function pointToSegmentDistance(point, start, end) {
  const edge = subtract(end, start);
  const denom = dot(edge, edge);
  const t = denom > 0
    ? Math.max(0, Math.min(1, dot(subtract(point, start), edge) / denom))
    : 0;
  return length(subtract(point, [
    start[0] + edge[0] * t,
    start[1] + edge[1] * t,
    start[2] + edge[2] * t,
  ]));
}

function withinPolylineDistance(source, target, tolerance) {
  for (const point of source) {
    let nearest = Infinity;
    for (let index = 1; index < target.length; index += 1) {
      nearest = Math.min(nearest, pointToSegmentDistance(
        point, target[index - 1], target[index]
      ));
      if (nearest <= tolerance) break;
    }
    if (nearest > tolerance) return false;
  }
  return true;
}

function hasUnchangedWorldContour(measurement) {
  const geometry = getGeometry(measurement);
  const original = geometry.originalContourPoints;
  const current = Array.isArray(measurement?.points) && measurement.points.length >= 6
    ? measurement.points : geometry.contourPoints;
  if (!Array.isArray(original) || !Array.isArray(current) ||
      original.length < 6 || current.length < 6) return false;
  const originalPoints = original.map(getPoint);
  const currentPoints = current.map(getPoint);
  if (originalPoints.some(point => !point) ||
      currentPoints.some(point => !point)) return false;

  // Use scale of the original contour (not the post-edit curve) so that
  // stretching the contour cannot inflate its own permitted deviation.
  const baseLeft = originalPoints[0];
  const baseRight = originalPoints[originalPoints.length - 1];
  const axis = originalPoints[Number(geometry.axisPointIndex)];
  if (!axis) return false;
  const midpoint = getBaseMidpoint(baseLeft, baseRight);
  const axisLength = length(subtract(axis, midpoint));
  if (!Number.isFinite(axisLength) || axisLength <= 0) return false;
  // Strict relative geometry tolerance to accommodate spline interpolation.
  // Does not relax the independent physical calibration or axis checks.
  const tolerance = axisLength * 0.015;
  if (length(subtract(baseLeft, currentPoints[0])) > tolerance ||
      length(subtract(baseRight, currentPoints[currentPoints.length - 1])) > tolerance) {
    return false;
  }
  return withinPolylineDistance(originalPoints, currentPoints, tolerance) &&
    withinPolylineDistance(currentPoints, originalPoints, tolerance);
}

function getBaseMidpoint(baseLeft, baseRight) {
  return [
    (baseLeft[0] + baseRight[0]) / 2,
    (baseLeft[1] + baseRight[1]) / 2,
    (baseLeft[2] + baseRight[2]) / 2,
  ];
}

function formatMM(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '';
}

function formatPercent(ratio) {
  return Number.isFinite(Number(ratio)) ? `${(Number(ratio) * 100).toFixed(0)}%` : '';
}

function buildAxisMismatchMessage({ phase, a4c, a2c, axisMismatchRatio, isBlocking }) {
  const a4cLength = Number(a4c?.longAxisLengthMM);
  const a2cLength = Number(a2c?.longAxisLengthMM);
  const shorterSlot = a4cLength < a2cLength ? `A4C ${phase}` : `A2C ${phase}`;
  const longerSlot = a4cLength < a2cLength ? `A2C ${phase}` : `A4C ${phase}`;
  const action = isBlocking
    ? 'Replace the outlier contour before calculating volume.'
    : 'EF was calculated with caution; consider redrawing the outlier if the result looks wrong.';

  return `${phase}: A4C axis ${formatMM(a4cLength)} mm vs A2C axis ${formatMM(
    a2cLength
  )} mm (${formatPercent(
    axisMismatchRatio
  )} mismatch). ${shorterSlot} is shorter than ${longerSlot}; recheck hinge placement and apex depth. ${action}`;
}

function buildCoverageMessage({ display, coverageRatio }) {
  return `${display}: contour only covers ${formatPercent(
    coverageRatio
  )} of the LV long axis. It is likely too short, open, or not enclosing the cavity from mitral hinge line to apex. Redraw hinge-to-hinge and include the apex.`;
}

function projectContourToAxis(contourPoints, baseLeft, baseRight, apex, longAxisLengthMM) {
  const baseMidpoint = getBaseMidpoint(baseLeft, baseRight);
  const axisVector = subtract(apex, baseMidpoint);
  const axisCoordinateLength = length(axisVector);
  const axisUnit = normalize(axisVector);

  if (!axisUnit || axisCoordinateLength <= 0 || !longAxisLengthMM || longAxisLengthMM <= 0) {
    return null;
  }

  const scaleToMM = longAxisLengthMM / axisCoordinateLength;
  let transverseVector = null;
  let maxTransverseDistance = 0;

  for (const point of contourPoints) {
    const relative = subtract(point, baseMidpoint);
    const axisComponent = scale(axisUnit, dot(relative, axisUnit));
    const perpendicular = subtract(relative, axisComponent);
    const transverseDistance = length(perpendicular);

    if (transverseDistance > maxTransverseDistance) {
      maxTransverseDistance = transverseDistance;
      transverseVector = perpendicular;
    }
  }

  const transverseUnit = transverseVector ? normalize(transverseVector) : null;

  if (!transverseUnit) {
    return null;
  }

  return contourPoints.map(point => {
    const relative = subtract(point, baseMidpoint);
    return {
      s: dot(relative, axisUnit) * scaleToMM,
      t: dot(relative, transverseUnit) * scaleToMM,
    };
  });
}

function sampleWidths(projectedPoints, longAxisLengthMM) {
  const widths = [];
  const diskHeight = longAxisLengthMM / SAMPLE_COUNT;

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const sampleS = (index + 0.5) * diskHeight;
    const intersections = [];

    for (let pointIndex = 0; pointIndex < projectedPoints.length; pointIndex += 1) {
      const first = projectedPoints[pointIndex];
      const second = projectedPoints[(pointIndex + 1) % projectedPoints.length];

      if (first.s === second.s) {
        continue;
      }

      const crosses =
        (first.s <= sampleS && sampleS < second.s) || (second.s <= sampleS && sampleS < first.s);

      if (!crosses) {
        continue;
      }

      const ratio = (sampleS - first.s) / (second.s - first.s);
      intersections.push(first.t + ratio * (second.t - first.t));
    }

    intersections.sort((a, b) => a - b);
    widths.push(
      intersections.length >= 2
        ? Math.max(0, intersections[intersections.length - 1] - intersections[0])
        : 0
    );
  }

  return widths;
}

function buildSlotGeometry(measurement, slot) {
  const geometry = getGeometry(measurement);
  const contourPoints = getContourPoints(measurement);
  const configuredAxisPointIndex = Number(geometry.axisPointIndex);
  const axisPointIndex = Number.isInteger(configuredAxisPointIndex) &&
    configuredAxisPointIndex > 0 &&
    configuredAxisPointIndex < contourPoints.length - 1
      ? configuredAxisPointIndex : -1;
  const baseLeft = contourPoints[0];
  const baseRight = contourPoints[contourPoints.length - 1];
  const apex = contourPoints[axisPointIndex];
  const baseMidpoint = baseLeft && baseRight ? getBaseMidpoint(baseLeft, baseRight) : null;
  const derivedLength = baseMidpoint && apex ? length(subtract(apex, baseMidpoint)) : null;
  const calibratedAxisLength = finiteNumber(geometry.calibratedLongAxisLengthMM);
  const longAxisLengthMM = calibratedAxisLength && calibratedAxisLength > 0
    ? calibratedAxisLength : null;
  const contourUnchanged = hasUnchangedWorldContour(measurement);
  const display = LV_SIMPSON_SLOT_INFO[slot].display;
  const messages = [];

  const originalPoints = Array.isArray(geometry.originalContourPoints)
    ? geometry.originalContourPoints : [];
  const currentPoints = Array.isArray(measurement?.points) && measurement.points.length >= 6
    ? measurement.points : Array.isArray(geometry.contourPoints) ? geometry.contourPoints : [];
  let maximumPointDelta = null;
  if (originalPoints.length === currentPoints.length && originalPoints.length > 0) {
    const deltas = originalPoints.map((point, index) => {
      const before = getPoint(point);
      const after = getPoint(currentPoints[index]);
      return before && after ? length(subtract(before, after)) : Number.NaN;
    });
    maximumPointDelta = deltas.every(Number.isFinite) ? Math.max(...deltas) : null;
  }
  const axisDifferenceMM = Number.isFinite(derivedLength) && longAxisLengthMM
    ? Math.abs(derivedLength - longAxisLengthMM) : null;
  // EF-only, temporary, aggregate diagnostics; no identifiers or coordinates.
  console.info('[LV EF slot validation]', {
    slot,
    originalPointCount: originalPoints.length,
    currentPointCount: currentPoints.length,
    calibratedPointCount: contourPoints.length,
    maximumPointDelta,
    contourUnchanged,
    calibrationError: geometry.calibrationError || null,
    calibratedAxisPresent: Boolean(longAxisLengthMM),
    derivedAxisValid: Number.isFinite(derivedLength),
    axisDifferenceMM,
    axisToleranceMM: longAxisLengthMM
      ? Math.max(0.01, longAxisLengthMM * 0.001) : null,
  });

  if (geometry.calibrationError) {
    messages.push(`${display}: EF calibration failure (${geometry.calibrationError}). Check the active DICOM instance and spatial ultrasound-region metadata.`);
  }

  if (!contourUnchanged || !longAxisLengthMM ||
      !Number.isFinite(derivedLength) ||
      Math.abs(derivedLength - longAxisLengthMM) > Math.max(0.01, longAxisLengthMM * 0.001)) {
    messages.push(
      `${display}: verified physical calibration is missing or the contour has been edited since calibration. Re-enter the EF contour on a calibrated DICOM ultrasound region.`
    );
  }

  if (contourPoints.length < 6) {
    messages.push(
      `${display}: contour was not completed. Redraw this slot by first drawing the mitral hinge line, then dragging from the hinge midpoint to the LV apex.`
    );
  }

  if (!baseLeft || !baseRight || !apex) {
    messages.push(
      `${display}: missing hinge/apex geometry. Use the LV EF workflow rather than a generic ROI so the hinge points and apex are stored.`
    );
  }

  if (!longAxisLengthMM || longAxisLengthMM <= 0) {
    messages.push(
      `${display}: could not measure calibrated long-axis length. Confirm the image is calibrated and redraw the slot.`
    );
  }

  if (messages.length) {
    return { ...LV_SIMPSON_SLOT_INFO[slot], complete: false, messages };
  }

  const projectedPoints = projectContourToAxis(
    contourPoints,
    baseLeft,
    baseRight,
    apex,
    longAxisLengthMM
  );

  if (!projectedPoints) {
    return {
      ...LV_SIMPSON_SLOT_INFO[slot],
      complete: false,
      messages: [
        `${display}: contour geometry could not be projected onto the LV long axis. Redraw with clearly separated hinge points and an apex away from the hinge line.`,
      ],
    };
  }

  const widths = sampleWidths(projectedPoints, longAxisLengthMM);
  const coverageRatio = widths.filter(width => width > 0).length / SAMPLE_COUNT;
  const maxWidth = Math.max(...widths);
  // A disk diameter larger than 1.5 times the full LV long axis indicates
  // inconsistent contour/world geometry or calibration, not a plausible
  // ventricular cross-section. Reject the result rather than presenting a
  // misleading EF derived from enormous volumes.
  if (geometry.contourSource === 'freehandDerived' &&
      (!Number.isFinite(maxWidth) || maxWidth > longAxisLengthMM * 1.5)) {
    return {
      ...LV_SIMPSON_SLOT_INFO[slot],
      complete: false,
      longAxisLengthMM,
      widths,
      coverageRatio,
      messages: [
        `${display}: contour width/axis calibration inconsistent (maximum diameter ${formatMM(maxWidth)} mm vs long axis ${formatMM(longAxisLengthMM)} mm). Do not capture EF; verify image calibration and redraw.`,
      ],
    };
  }

  if (coverageRatio < MIN_WIDTH_COVERAGE_RATIO) {
    return {
      ...LV_SIMPSON_SLOT_INFO[slot],
      complete: false,
      longAxisLengthMM,
      widths,
      coverageRatio,
      messages: [buildCoverageMessage({ display, coverageRatio })],
    };
  }

  return {
    ...LV_SIMPSON_SLOT_INFO[slot],
    complete: true,
    longAxisLengthMM,
    widths,
    coverageRatio,
    messages: [],
  };
}

function uniqueMessages(messages = []) {
  const seen = new Set();

  return messages.filter(message => {
    const key = String(message || '').trim();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function calculatePhaseVolume(slots, phase) {
  const a4c = slots[`A4C_${phase}`];
  const a2c = slots[`A2C_${phase}`];

  if (!a4c?.complete || !a2c?.complete) {
    return {
      complete: false,
      phase,
      messages: [...(a4c?.messages || []), ...(a2c?.messages || [])],
    };
  }

  const longerAxis = Math.max(a4c.longAxisLengthMM, a2c.longAxisLengthMM);
  const shorterAxis = Math.min(a4c.longAxisLengthMM, a2c.longAxisLengthMM);
  const axisMismatchRatio = longerAxis > 0 ? (longerAxis - shorterAxis) / longerAxis : 1;

  const messages = [];

  if (axisMismatchRatio > AXIS_MISMATCH_BLOCK_RATIO) {
    return {
      complete: false,
      phase,
      axisMismatchRatio,
      messages: [
        buildAxisMismatchMessage({
          phase,
          a4c,
          a2c,
          axisMismatchRatio,
          isBlocking: true,
        }),
      ],
    };
  }

  if (axisMismatchRatio > AXIS_MISMATCH_WARNING_RATIO) {
    messages.push(
      buildAxisMismatchMessage({
        phase,
        a4c,
        a2c,
        axisMismatchRatio,
        isBlocking: false,
      })
    );
  }

  const commonAxisLengthMM = (a4c.longAxisLengthMM + a2c.longAxisLengthMM) / 2;
  const diskHeightMM = commonAxisLengthMM / SAMPLE_COUNT;
  let volumeMM3 = 0;

  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const diskAreaMM2 = (Math.PI / 4) * (a4c.widths[index] || 0) * (a2c.widths[index] || 0);
    volumeMM3 += diskAreaMM2 * diskHeightMM;
  }

  return {
    complete: true,
    phase,
    volumeML: volumeMM3 / 1000,
    axisMismatchRatio,
    messages,
  };
}

export function calculateLVSimpson(measurements = []) {
  const slots = {};
  let hasAnyLVSimpsonSlot = false;

  for (const measurement of measurements || []) {
    const geometry = getGeometry(measurement);
    const measurementKind =
      measurement?.measurementKind || measurement?.measurements?.measurementKind;

    if (measurementKind && measurementKind !== 'lvSimpsonSlot') {
      continue;
    }

    if (!geometry?.measurementKind && measurementKind !== 'lvSimpsonSlot') {
      continue;
    }

    const slot = getSlot(measurement);
    if (!slot || !LV_SIMPSON_SLOT_INFO[slot]) {
      continue;
    }

    hasAnyLVSimpsonSlot = true;
    slots[slot] = buildSlotGeometry(measurement, slot);
  }

  // Do not show the LV Simpson summary before the LV contour workflow has
  // actually been used. Once at least one LV Simpson slot exists, continue
  // returning an incomplete result so the panel can show which slots are
  // still missing.
  if (!hasAnyLVSimpsonSlot) {
    return null;
  }

  for (const slot of LV_SIMPSON_SLOT_ORDER) {
    if (!slots[slot]) {
      slots[slot] = {
        ...LV_SIMPSON_SLOT_INFO[slot],
        complete: false,
        messages: [`${LV_SIMPSON_SLOT_INFO[slot].display}: missing`],
      };
    }
  }

  const ed = calculatePhaseVolume(slots, 'ED');
  const es = calculatePhaseVolume(slots, 'ES');
  const messages = uniqueMessages([
    ...LV_SIMPSON_SLOT_ORDER.flatMap(slot =>
      slots[slot]?.complete ? [] : slots[slot]?.messages || []
    ),
    ...(ed.messages || []),
    ...(es.messages || []),
  ]);
  const allSlotsComplete = LV_SIMPSON_SLOT_ORDER.every(slot => slots[slot]?.complete);

  if (!ed.complete || !es.complete) {
    return {
      status: allSlotsComplete ? 'invalid' : 'incomplete',
      method: 'Biplane Simpson from explicit hinge, apex, and LV contour geometry.',
      slots,
      phases: { ED: ed, ES: es },
      values: null,
      messages,
      guidance: messages,
    };
  }

  // An upper-bound safety check, not a substitute for calibrated contour
  // geometry. Prevent obviously impossible volumes from being scored.
  const containsFreehandContour = LV_SIMPSON_SLOT_ORDER.some(slot =>
    getGeometry(measurements.find(measurement => getSlot(measurement) === slot))
      .contourSource === 'freehandDerived'
  );
  if (containsFreehandContour &&
      (!Number.isFinite(ed.volumeML) || !Number.isFinite(es.volumeML) ||
       ed.volumeML > 1000 || es.volumeML > 1000)) {
    const warning = 'EF volume calculation exceeds the 1000 mL safety limit or is non-finite. Verify contour coordinate calibration; do not capture this result.';
    return {
      status: 'invalid',
      method: 'Biplane Simpson from explicit hinge, apex, and LV contour geometry.',
      slots,
      phases: { ED: ed, ES: es },
      values: null,
      messages: [...messages, warning],
      guidance: [...messages, warning],
    };
  }

  if (ed.volumeML <= 0 || es.volumeML < 0 || es.volumeML >= ed.volumeML) {
    return {
      status: 'invalid',
      method: 'Biplane Simpson from explicit hinge, apex, and LV contour geometry.',
      slots,
      phases: { ED: ed, ES: es },
      values: null,
      messages: [
        ...messages,
        'Calculated EDV/ESV relationship is not physiologic. ESV is greater than or equal to EDV; recheck the ED and ES frame selection or redraw the outlier contour.',
      ],
      guidance: [
        ...messages,
        'Calculated EDV/ESV relationship is not physiologic. ESV is greater than or equal to EDV; recheck the ED and ES frame selection or redraw the outlier contour.',
      ],
    };
  }

  const strokeVolumeML = ed.volumeML - es.volumeML;
  const ejectionFraction = (strokeVolumeML / ed.volumeML) * 100;

  return {
    status: 'complete',
    method: 'Biplane Simpson from explicit hinge, apex, and LV contour geometry.',
    slots,
    phases: { ED: ed, ES: es },
    values: {
      edvML: ed.volumeML,
      esvML: es.volumeML,
      strokeVolumeML,
      ejectionFraction,
    },
    messages,
    guidance: messages,
  };
}
