import { utilities as csUtilities } from '@cornerstonejs/core';
import { resolveLengthValueForTarget } from './resolveLengthValue';

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

    // Same frame-bound value resolver as the MeasurementService mapping.
    // On an unchanged restored caliper, preserve saved mm even if a delayed
    // or inconsistent image-plane calibration would otherwise change it.
    const resolved = resolveLengthValueForTarget(targetId, data);
    if (resolved) {
      return [formatCalibratedLength(resolved.lengthMm)];
    }

    // Native Cornerstone's cm US Region text is not trustworthy in this
    // fallback path; iUSCAN may relabel it as mm. Fail closed rather than show
    // a plausible but wrong physical value after an edit or on a fresh trace.
    const statsUnit = String(data?.cachedStats?.[targetId]?.unit || '');
    if (/cm\s+US\s+Region/i.test(statsUnit)) {
      return ['Physical calibration unavailable'];
    }

    return originalLines;
  }

  calibratedLengthTextLines[WRAPPED] = true;
  return calibratedLengthTextLines;
}

/** Same rounding OHIF uses for Length displayText (utils.roundNumber, 2). */
export function formatCalibratedLength(lengthMm: number) {
  return `${csUtilities.roundNumber(lengthMm, 2)} mm`;
}
