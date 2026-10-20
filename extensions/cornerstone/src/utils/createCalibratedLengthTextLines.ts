import { utilities as csUtilities } from '@cornerstonejs/core';
import { getUSRegionLengthCalibration } from './correctUSRegionLength';

/**
 * Wrap the ORIGINAL Cornerstone Length text formatter. Never modify native
 * cachedStats or annotation interaction/completion state. For calibrated
 * spatial US regions the DICOM deltas are centimetres, while the UI displays mm.
 * On non-US, unsupported, or off-region measurements return native text.
 */
export function createCalibratedLengthTextLines(nativeGetTextLines) {
  return (data, targetId) => {
    const originalLines = nativeGetTextLines(data, targetId);
    if (typeof targetId !== 'string' || !targetId.startsWith('imageId:')) {
      return originalLines;
    }

    if (data?.cachedStats?.[targetId]?.length == null) {
      return originalLines;
    }

    const referencedImageId = targetId.slice('imageId:'.length);
    const calibration = getUSRegionLengthCalibration(referencedImageId, { data });
    if (!calibration) return originalLines;

    const lengthMm = calibration.lengthCm * 10;
    return Number.isFinite(lengthMm)
      ? [`${csUtilities.roundNumber(lengthMm, 2)} mm`]
      : originalLines;
  };
}
