import { utilities as csUtilities } from '@cornerstonejs/core';
import { getUSRegionLengthCalibrationForTarget } from './correctUSRegionLength';

const WRAPPED = Symbol.for('ar.calibratedLengthTextLines');

/**
 * Wrap the Length tool's existing getTextLines. Only the displayed text
 * changes: cachedStats, handles, interaction and completion stay owned by the
 * native Cornerstone LengthTool.
 *
 * When both handles lie in a spatial (cm) DICOM ultrasound region the text is
 * the region-calibrated length in mm — the same value the MeasurementService
 * mapping records on completion. Otherwise the original text is returned
 * untouched (non-US images, volumes, unsupported units, off-region calipers).
 */
export function createCalibratedLengthTextLines(nativeGetTextLines) {
  if (typeof nativeGetTextLines !== 'function') {
    return nativeGetTextLines;
  }
  if (nativeGetTextLines[WRAPPED]) {
    return nativeGetTextLines;
  }

  function calibratedLengthTextLines(data, targetId) {
    const originalLines = nativeGetTextLines.call(this, data, targetId);

    // Same guard as native: no text until Cornerstone has computed stats.
    if (data?.cachedStats?.[targetId]?.length == null) {
      return originalLines;
    }

    const calibration = getUSRegionLengthCalibrationForTarget(targetId, data);
    if (!calibration) {
      return originalLines;
    }

    return [formatCalibratedLength(calibration.lengthMm)];
  }

  calibratedLengthTextLines[WRAPPED] = true;
  return calibratedLengthTextLines;
}

/** Same rounding OHIF uses for Length displayText (utils.roundNumber, 2). */
export function formatCalibratedLength(lengthMm: number) {
  return `${csUtilities.roundNumber(lengthMm, 2)} mm`;
}
