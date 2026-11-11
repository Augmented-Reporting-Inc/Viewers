import { convertPhysicalValue } from './physicalMeasurementPresentation';

const SAMPLE_COUNT = 20;
const MIN_WIDTH_COVERAGE_RATIO = 0.8;
const MAX_RECOMMENDED_AXIS_DIFFERENCE_MM = 5;

export const LA_VOLUME_AREA_LENGTH_METHOD = 'biplane-area-length-v1';
export const LA_VOLUME_DISKS_METHOD = 'biplane-disks-v1';

export const LA_VOLUME_SLOT_ORDER = ['A4C', 'A2C'];

const LA_VOLUME_SLOT_INFO = {
  A4C: { slot: 'A4C', view: 'A4C', phase: 'ES', display: 'A4C' },
  A2C: { slot: 'A2C', view: 'A2C', phase: 'ES', display: 'A2C' },
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
  return measurement?.laVolume || measurement?.measurements?.laVolume || {};
}

function getSlot(measurement) {
  const geometry = getGeometry(measurement);
  const directSlot = String(geometry.slot || measurement?.slot || '')
    .trim()
    .toUpperCase();

  if (LA_VOLUME_SLOT_INFO[directSlot]) {
    return directSlot;
  }

  const label = String(
    geometry.label || measurement?.measurementRole || measurement?.label || measurement?.role || ''
  ).toUpperCase();
  const match = label.match(/^LA-(A[24]C)-ES$/);

  return match ? match[1] : '';
}

function getContourPoints(measurement) {
  const geometry = getGeometry(measurement);
  const livePoints = Array.isArray(measurement?.points) ? measurement.points : [];
  const storedPoints = geometry.contourPoints || geometry.points || [];
  const points = livePoints.length >= 6 ? livePoints : storedPoints;

  return (Array.isArray(points) ? points : []).map(getPoint).filter(Boolean);
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

function formatReportNumber(value, digits = 1) {
  const numberValue = finiteNumber(value);

  if (numberValue == null) {
    return '';
  }

  return numberValue.toFixed(digits).replace(/\.0$/, '');
}

function projectContourToAxis(contourPoints, baseLeft, baseRight, superiorPoint, longAxisLengthMM) {
  const baseMidpoint = getBaseMidpoint(baseLeft, baseRight);
  const axisVector = subtract(superiorPoint, baseMidpoint);
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

function calculateProjectedPolygonAreaMM2(projectedPoints = []) {
  if (!Array.isArray(projectedPoints) || projectedPoints.length < 3) {
    return null;
  }

  let signedArea = 0;

  for (let index = 0; index < projectedPoints.length; index += 1) {
    const current = projectedPoints[index];
    const next = projectedPoints[(index + 1) % projectedPoints.length];

    signedArea += current.s * next.t - next.s * current.t;
  }

  const areaMM2 = Math.abs(signedArea) / 2;

  return Number.isFinite(areaMM2) && areaMM2 > 0 ? areaMM2 : null;
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

function buildCoverageMessage({ display, coverageRatio }) {
  return `${display}: contour only covers ${formatPercent(
    coverageRatio
  )} of the LA long axis. Redraw from mitral annulus to the superior LA wall and keep the contour closed.`;
}

function buildSlotGeometry(measurement, slot) {
  const geometry = getGeometry(measurement);
  const contourPoints = getContourPoints(measurement);

  // The editable SplineROI is closed and may be resampled by Cornerstone.
  // Therefore its first/last samples and sample indices are not anatomical
  // landmarks. Preserve the guided annulus/superior geometry and use the
  // current contour only to derive the projected LA area.
  const baseLeft = getPoint(geometry.baseLeftPoint);
  const baseRight = getPoint(geometry.baseRightPoint);
  const superiorPoint = getPoint(
    geometry.superiorPoint || geometry.axisPoint || geometry.apexPoint
  );
  const longAxisLengthMM = finiteNumber(geometry.longAxisLengthMM);
  const display = LA_VOLUME_SLOT_INFO[slot].display;
  const messages = [];

  if (contourPoints.length < 6) {
    messages.push(`${display}: LA contour was not completed.`);
  }

  if (!baseLeft || !baseRight || !superiorPoint) {
    messages.push(
      `${display}: missing mitral-annulus/superior-wall geometry. Use the LA Volume workflow rather than a generic ROI.`
    );
  }

  if (!longAxisLengthMM || longAxisLengthMM <= 0) {
    messages.push(
      `${display}: could not measure calibrated LA long-axis length. Confirm image calibration and redraw the slot.`
    );
  }

  if (messages.length) {
    return { ...LA_VOLUME_SLOT_INFO[slot], complete: false, messages };
  }

  const projectedPoints = projectContourToAxis(
    contourPoints,
    baseLeft,
    baseRight,
    superiorPoint,
    longAxisLengthMM
  );

  if (!projectedPoints) {
    return {
      ...LA_VOLUME_SLOT_INFO[slot],
      complete: false,
      messages: [`${display}: LA contour geometry could not be projected onto its long axis.`],
    };
  }

  const areaMM2 = calculateProjectedPolygonAreaMM2(projectedPoints);

  if (!areaMM2) {
    return {
      ...LA_VOLUME_SLOT_INFO[slot],
      complete: false,
      messages: [`${display}: LA contour area could not be calculated. Recheck the contour.`],
    };
  }

  // Coordinates are already calibrated to millimetres by LA acquisition.
  // This converts that verified physical area; it never calibrates pixels.
  const areaCM2 = convertPhysicalValue(areaMM2, 'mm²', 'cm²', 'area');
  if (areaCM2 == null) {
    return { ...LA_VOLUME_SLOT_INFO[slot], complete: false,
      messages: [`${display}: invalid physically calibrated contour area.`] };
  }
  const widths = sampleWidths(projectedPoints, longAxisLengthMM);
  const coverageRatio = widths.filter(width => width > 0).length / SAMPLE_COUNT;

  if (coverageRatio < MIN_WIDTH_COVERAGE_RATIO) {
    return {
      ...LA_VOLUME_SLOT_INFO[slot],
      complete: false,
      longAxisLengthMM,
      areaMM2,
      areaCM2,
      coverageRatio,
      messages: [buildCoverageMessage({ display, coverageRatio })],
    };
  }

  return {
    ...LA_VOLUME_SLOT_INFO[slot],
    complete: true,
    longAxisLengthMM,
    areaMM2,
    areaCM2,
    coverageRatio,
    // Independently sampled calibrated contour diameters are reused for
    // explicit biplane disk summation, without altering area-length results.
    widths,
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

function getBsaValue(seriesDocOrBsa = null) {
  if (seriesDocOrBsa && typeof seriesDocOrBsa === 'object' && !Array.isArray(seriesDocOrBsa)) {
    return finiteNumber(seriesDocOrBsa.BSA) ?? finiteNumber(seriesDocOrBsa.BSA_num);
  }

  return finiteNumber(seriesDocOrBsa);
}

export function calculateLAVolume(measurements = [], seriesDocOrBsa = null) {
  const slots = {};
  let hasAnyLAVolumeSlot = false;

  for (const measurement of measurements || []) {
    const geometry = getGeometry(measurement);
    const measurementKind =
      measurement?.measurementKind || measurement?.measurements?.measurementKind;

    if (measurementKind && measurementKind !== 'laVolumeSlot') {
      continue;
    }

    if (!geometry?.measurementKind && measurementKind !== 'laVolumeSlot') {
      continue;
    }

    const slot = getSlot(measurement);

    if (!slot || !LA_VOLUME_SLOT_INFO[slot]) {
      continue;
    }

    hasAnyLAVolumeSlot = true;
    slots[slot] = buildSlotGeometry(measurement, slot);
  }

  if (!hasAnyLAVolumeSlot) {
    return null;
  }

  for (const slot of LA_VOLUME_SLOT_ORDER) {
    if (!slots[slot]) {
      slots[slot] = {
        ...LA_VOLUME_SLOT_INFO[slot],
        complete: false,
        messages: [`${LA_VOLUME_SLOT_INFO[slot].display}: missing`],
      };
    }
  }

  const messages = uniqueMessages(
    LA_VOLUME_SLOT_ORDER.flatMap(slot =>
      slots[slot]?.complete ? [] : slots[slot]?.messages || []
    )
  );
  const allSlotsComplete = LA_VOLUME_SLOT_ORDER.every(slot => slots[slot]?.complete);
  const method =
    'CSE biplane area-length LA volume: 0.85 × A4C area × A2C area / shorter LA length.';
  const methodId = LA_VOLUME_AREA_LENGTH_METHOD;

  if (!allSlotsComplete) {
    return {
      status: 'incomplete',
      method,
      methodId,
      slots,
      values: null,
      messages,
      guidance: messages,
    };
  }

  const a4c = slots.A4C;
  const a2c = slots.A2C;
  const axisDifferenceMM = Math.abs(a4c.longAxisLengthMM - a2c.longAxisLengthMM);
  const laLengthMM = Math.min(a4c.longAxisLengthMM, a2c.longAxisLengthMM);
  const laLengthCM = convertPhysicalValue(laLengthMM, 'mm', 'cm', 'length');
  if (laLengthCM == null || laLengthCM <= 0) {
    return { status: 'invalid', method, methodId, slots, values: null,
      messages: ['LA long-axis physical unit conversion failed.'],
      guidance: ['LA long-axis physical unit conversion failed.'] };
  }
  const a4cAreaCM2 = a4c.areaCM2;
  const a2cAreaCM2 = a2c.areaCM2;
  const volumeML = (0.85 * a4cAreaCM2 * a2cAreaCM2) / laLengthCM;

  if (axisDifferenceMM > MAX_RECOMMENDED_AXIS_DIFFERENCE_MM) {
    messages.push(
      `A4C and A2C LA long axes differ by ${formatMM(axisDifferenceMM)} mm (${formatMM(
        a4c.longAxisLengthMM
      )} vs ${formatMM(
        a2c.longAxisLengthMM
      )} mm). Dedicated LA views should be reevaluated when the difference exceeds 5 mm.`
    );
  }

  if (!Number.isFinite(volumeML) || volumeML <= 0) {
    const invalidMessages = uniqueMessages([
      ...messages,
      'Calculated LA volume is invalid. Recheck image calibration and both contours.',
    ]);

    return {
      status: 'invalid',
      method,
      methodId,
      slots,
      values: null,
      axisDifferenceMM,
      messages: invalidMessages,
      guidance: invalidMessages,
    };
  }

  const bsa = getBsaValue(seriesDocOrBsa);
  const lavi = bsa && bsa > 0 ? volumeML / bsa : null;

  return {
    status: 'complete',
    method,
    methodId,
    slots,
    values: {
      volumeML,
      lavi,
      axisDifferenceMM,
      laLengthMM,
      laLengthCM,
      laLengthSource: 'shorter A4C/A2C length',
      a4cAreaMM2: a4c.areaMM2,
      a2cAreaMM2: a2c.areaMM2,
      a4cAreaCM2,
      a2cAreaCM2,
    },
    messages,
    guidance: messages,
  };
}

/**
 * LA biplane summation-of-disks (20 elliptical disks).
 *
 * Only the two guided A4C/A2C end-systolic contours qualify. Each view is
 * sampled along its own calibrated axis. Use the LONGER LA axis for common
 * disk height, not the SHORTER length required by legacy area-length.
 * It is a different technique with different reference intervals.
 *
 * Returned separately; it never changes the historical area-length report
 * field or the existing laVolumeBiplane education scoring kind implicitly.
 */
export function calculateLABiplaneDisks(
  measurements = [],
  seriesDocOrBsa = null
) {
  const methodId = LA_VOLUME_DISKS_METHOD;
  const method = 'Biplane Simpson summation of 20 elliptical LA disks (longer LA axis).';
  const sourceSlots = new Set();
  for (const measurement of measurements || []) {
    const g = getGeometry(measurement);
    const kind = measurement?.measurementKind || measurement?.measurements?.measurementKind;
    if (kind && kind !== 'laVolumeSlot') continue;
    if (!g?.measurementKind && kind !== 'laVolumeSlot') continue;
    const slot = getSlot(measurement);
    if (!slot) continue;
    if (sourceSlots.has(slot)) {
      return {
        status: 'invalid',
        method,
        methodId,
        slots: null,
        values: null,
        messages: ['Duplicate LA contour slots. Delete the old contour before measuring biplane disks.'],
        guidance: ['Duplicate LA contour slots. Delete the old contour before measuring biplane disks.'],
      };
    }
    sourceSlots.add(slot);
  }

  const base = calculateLAVolume(measurements, seriesDocOrBsa);
  if (!base) return null;
  if (base.status !== 'complete') {
    return { ...base, method, methodId };
  }

  const a4c = base.slots.A4C;
  const a2c = base.slots.A2C;
  const axisDifferenceMM = Math.abs(a4c.longAxisLengthMM - a2c.longAxisLengthMM);
  if (axisDifferenceMM > MAX_RECOMMENDED_AXIS_DIFFERENCE_MM) {
    const warning = 'LA A4C/A2C long axes differ by more than 5 mm; reacquire or redraw for Simpson disk summation.';
    return {
      status: 'invalid',
      method,
      methodId,
      slots: base.slots,
      values: null,
      messages: [...(base.messages || []), warning],
      guidance: [...(base.messages || []), warning],
    };
  }

  const widths4 = a4c.widths;
  const widths2 = a2c.widths;
  if (!Array.isArray(widths4) || !Array.isArray(widths2) ||
      widths4.length !== SAMPLE_COUNT || widths2.length !== SAMPLE_COUNT) {
    return {
      status: 'invalid',
      method,
      methodId,
      slots: base.slots,
      values: null,
      messages: ['Calibrated disk widths are missing from one or both contours.'],
      guidance: ['Calibrated disk widths are missing from one or both contours.'],
    };
  }

  const lengthMM = Math.max(a4c.longAxisLengthMM, a2c.longAxisLengthMM);
  const diskHeightMM = lengthMM / SAMPLE_COUNT;
  let volumeMM3 = 0;
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const d4 = widths4[index];
    const d2 = widths2[index];
    if (!(d4 >= 0) || !(d2 >= 0) ||
        !Number.isFinite(d4) || !Number.isFinite(d2)) {
      return {
        status: 'invalid',
        method,
        methodId,
        slots: base.slots,
        values: null,
        messages: ['A sampled LA disk diameter is invalid.'],
        guidance: ['A sampled LA disk diameter is invalid.'],
      };
    }
    volumeMM3 += (Math.PI / 4) * d4 * d2 * diskHeightMM;
  }

  const volumeML = volumeMM3 / 1000;
  if (!(volumeML > 0) || !Number.isFinite(volumeML)) {
    return {
      status: 'invalid',
      method,
      methodId,
      slots: base.slots,
      values: null,
      messages: ['Calculated LA disk-summation volume is invalid.'],
      guidance: ['Calculated LA disk-summation volume is invalid.'],
    };
  }

  const bsa = getBsaValue(seriesDocOrBsa);
  return {
    status: 'complete',
    method,
    methodId,
    slots: base.slots,
    values: {
      volumeML,
      lavi: bsa > 0 ? volumeML / bsa : null,
      axisDifferenceMM,
      laLengthMM: lengthMM,
      laLengthSource: 'longer A4C/A2C LA length',
      diskCount: SAMPLE_COUNT,
      diskHeightMM,
    },
    messages: base.messages || [],
    guidance: base.guidance || [],
  };
}

export function buildCseLAVolumeReportFieldUpdatesFromResult(
  result = null,
  seriesDocOrBsa = null
) {
  // Never reinterpret a Simpson disk result as the legacy CSE area-length.
  if (result?.methodId && result.methodId !== LA_VOLUME_AREA_LENGTH_METHOD) return {};
  const values = result?.status === 'complete' ? result.values : null;

  if (!values || !Number.isFinite(Number(values.volumeML)) || Number(values.volumeML) <= 0) {
    return {};
  }

  const volume = formatReportNumber(values.volumeML, 1);
  const updates = {
    LAV: volume,
    LAESV: volume,
    LAVUOM: 'ml',
    LAESVUOM: 'ml',
  };

  const bsa = getBsaValue(seriesDocOrBsa);
  const lavi = Number.isFinite(Number(values.lavi)) && Number(values.lavi) > 0
    ? Number(values.lavi)
    : bsa && bsa > 0
      ? Number(values.volumeML) / bsa
      : null;

  if (Number.isFinite(Number(lavi)) && Number(lavi) > 0) {
    updates.LAVI = formatReportNumber(lavi, 1);
    updates.LAVIUOM = 'ml/m2';
  }

  return updates;
}

export function buildCseLAVolumeReportFieldUpdates(measurements = [], seriesDocOrBsa = null) {
  return buildCseLAVolumeReportFieldUpdatesFromResult(
    calculateLAVolume(measurements, seriesDocOrBsa),
    seriesDocOrBsa
  );
}
