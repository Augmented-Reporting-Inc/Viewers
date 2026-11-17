import { utilities as csUtilities } from '@cornerstonejs/core';
import { getUSRegionLengthCalibrationForTarget } from './correctUSRegionLength';

const WRAPPED = Symbol.for('ar.calibratedLengthTextLines');

/** Use persisted mm only for the exact restored image and unchanged handles. */
function getUnchangedRestoredLength(data, targetId) {
  const saved = data?.arRestoredLengthEvidence;
  if (!saved || typeof targetId !== 'string' || !targetId.startsWith('imageId:')) {
    return null;
  }
  if (targetId.slice('imageId:'.length) !== saved.referencedImageId) return null;
  const current = data?.handles?.points;
  if (!Array.isArray(current) || current.length !== 2 || !Array.isArray(saved.points)) {
    return null;
  }
  const unchanged = current.every((point, i) =>
    Array.isArray(point) &&
    Array.isArray(saved.points[i]) &&
    point.length >= 3 &&
    saved.points[i].length >= 3 &&
    [0, 1, 2].every(axis =>
      Number.isFinite(Number(point[axis])) &&
      Math.abs(Number(point[axis]) - Number(saved.points[i][axis])) < 1e-7
    )
  );
  const value = Number(saved.valueMm);
  return unchanged && Number.isFinite(value) && value > 0 ? value : null;
}

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
    if (calibration) {
      return [formatCalibratedLength(calibration.lengthMm)];
    }

    // The restored record is authoritative only while its image and endpoints
    // have not changed. This avoids recalculating an already-mm single-region
    // saved annotation with a pixel-world fallback when imagePlane is missing.
    const savedLength = getUnchangedRestoredLength(data, targetId);
    if (savedLength != null) {
      return [formatCalibratedLength(savedLength)];
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

/**
 * Register the existing native Length tool with the same calibrated renderer
 * used by the measurement adapter. The class keeps toolName="Length", all
 * native interaction/geometry and inherited hydration behavior. Registering
 * the upstream LengthTool directly bypasses the calibrated getTextLines
 * wrapper and can show a smaller native cm-US-Region number while the panel
 * records the correct mm value.
 */
export function createCalibratedLengthToolClass(BaseLengthTool: any): any {
  return class ARCalibratedLengthTool extends BaseLengthTool {
    static toolName = BaseLengthTool.toolName;

    constructor(...args: any[]) {
      super(...args);
      const original = this.configuration?.getTextLines;
      if (typeof original === 'function') {
        this.configuration.getTextLines = createCalibratedLengthTextLines(original);
      }
    }
  };
}
