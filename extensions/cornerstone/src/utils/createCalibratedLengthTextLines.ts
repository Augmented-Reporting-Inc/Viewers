import { utilities as csUtilities } from '@cornerstonejs/core';
import { correctUSRegionLength } from './correctUSRegionLength';

/**
 * Change only the rendered Length text, not the native Cornerstone Length
 * tool, its cached statistics, or its drawing/completion event lifecycle.
 */
export function createCalibratedLengthTextLines(nativeGetTextLines) {
  return (data, targetId) => {
    const originalLines = nativeGetTextLines(data, targetId);

    if (typeof targetId !== 'string' || !targetId.startsWith('imageId:')) {
      return originalLines;
    }

    const nativeStats = data?.cachedStats?.[targetId];
    const nativeLength = nativeStats?.length;
    if (typeof nativeLength !== 'number' || !Number.isFinite(nativeLength)) {
      return originalLines;
    }

    const referencedImageId = targetId.slice('imageId:'.length);
    const calibratedLength = correctUSRegionLength(nativeLength, referencedImageId, { data });

    if (!Number.isFinite(calibratedLength) || calibratedLength === nativeLength) {
      return originalLines;
    }

    return [`${csUtilities.roundNumber(calibratedLength)} ${nativeStats.unit || 'mm'}`];
  };
}
