import { calibrateUSContourPoints } from './usRegionLengthCalibration';

/**
 * Revalidate a user-edited guided LV contour against its original DICOM region.
 * The edited spline handles (not its densified display polyline) are the
 * authoritative editable geometry. Never scale world points as if they were mm.
 *
 * This is deliberately opt-in at the explicit Calculate EF checkpoint: it
 * cannot silently change a previously accepted EF or an educator gold answer.
 * The caller must first verify the annotation's exact SOP and frame.
 */
export function recalibrateEditedLVSimpsonContour({
  geometry,
  controlPoints,
  imagePlane,
  regions,
}: {
  geometry: any;
  controlPoints: unknown;
  imagePlane: any;
  regions: any[];
}): { status: 'unchanged' | 'recalibrated' | 'invalid'; geometry?: any; reason?: string } {
  if (geometry?.measurementKind !== 'lvSimpsonSlot') {
    return { status: 'invalid', reason: 'not_an_lv_contour' };
  }
  const original = geometry.originalContourPoints;
  const isValidPoint = (point: any) =>
    Array.isArray(point) && point.length >= 3 &&
    point.slice(0, 3).every((value: any) => typeof value === 'number' && Number.isFinite(value));
  if (!Array.isArray(original) || original.length < 6 ||
      !original.every(isValidPoint) || !Array.isArray(controlPoints) ||
      controlPoints.length !== original.length || !controlPoints.every(isValidPoint)) {
    return { status: 'invalid', reason: 'missing_or_changed_control_point_layout' };
  }
  // Ignore numeric noise, but never silently accept a moved real handle.
  const changed = controlPoints.some((point: number[], index: number) =>
    point.slice(0, 3).some((value, component) =>
      Math.abs(value - original[index][component]) > 0.00001));
  if (!changed) return { status: 'unchanged', geometry };

  const apexIndex = Number(geometry.axisPointIndex);
  if (!Number.isInteger(apexIndex) || apexIndex <= 0 ||
      apexIndex >= controlPoints.length - 1) {
    return { status: 'invalid', reason: 'missing_axis_landmark' };
  }
  if (!imagePlane || !Array.isArray(regions) || regions.length === 0) {
    return { status: 'invalid', reason: 'source_dicom_calibration_unavailable' };
  }

  const calibratedContourPoints = calibrateUSContourPoints({
    points: controlPoints, imagePlane, regions,
  });
  if (!calibratedContourPoints || calibratedContourPoints.length !== controlPoints.length) {
    return { status: 'invalid', reason: 'edited_contour_outside_calibrated_dicom_region' };
  }
  const baseLeft = calibratedContourPoints[0];
  const baseRight = calibratedContourPoints[calibratedContourPoints.length - 1];
  const apex = calibratedContourPoints[apexIndex];
  const midpoint = baseLeft.map((value: number, index: number) =>
    (value + baseRight[index]) / 2);
  const calibratedLongAxisLengthMM = Math.hypot(...apex.map(
    (value: number, index: number) => value - midpoint[index]));
  if (!Number.isFinite(calibratedLongAxisLengthMM) || calibratedLongAxisLengthMM <= 0) {
    return { status: 'invalid', reason: 'edited_long_axis_invalid' };
  }
  const copy = (point: number[]) => point.slice(0, 3);
  const worldPoints = (controlPoints as number[][]).map(copy);
  const hingeMidpoint = worldPoints[0].map((value: number, index: number) =>
    (value + worldPoints[worldPoints.length - 1][index]) / 2);
  return {
    status: 'recalibrated',
    geometry: {
      ...geometry,
      originalContourPoints: worldPoints.map(copy),
      contourPoints: worldPoints.map(copy),
      calibratedContourPoints,
      calibratedLongAxisLengthMM,
      longAxisLengthMM: calibratedLongAxisLengthMM,
      baseLeftPoint: copy(worldPoints[0]),
      baseRightPoint: copy(worldPoints[worldPoints.length - 1]),
      baseMidpoint: hingeMidpoint,
      apexPoint: copy(worldPoints[apexIndex]),
      axisPoint: copy(worldPoints[apexIndex]),
      calibrationError: null,
    },
  };
}
