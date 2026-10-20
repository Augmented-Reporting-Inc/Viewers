import { utilities as csUtilities } from '@cornerstonejs/core';
import { LengthTool } from '@cornerstonejs/tools';
import { correctUSRegionLength } from '../utils/correctUSRegionLength';

/**
 * Correct only the in-viewport text for ultrasound-region Length measurements.
 *
 * Leave Cornerstone's cachedStats and interaction/completion lifecycle alone.
 * The existing Length measurement-service mapping performs its own correction
 * when creating the saved measurement and quiz answer.
 */
export default class ARCalibratedLengthTool extends LengthTool {
  static toolName = 'Length';

  constructor(...args: ConstructorParameters<typeof LengthTool>) {
    super(...args);

    const nativeGetTextLines = this.configuration.getTextLines;

    this.configuration.getTextLines = (data, targetId) => {
      const nativeTextLines = nativeGetTextLines?.(data, targetId);

      // For volume/non-image targets, use Cornerstone's original text.
      if (typeof targetId !== 'string' || !targetId.startsWith('imageId:')) {
        return nativeTextLines;
      }

      const nativeStats = data?.cachedStats?.[targetId];
      const nativeLength = nativeStats?.length;

      if (typeof nativeLength !== 'number' || !Number.isFinite(nativeLength)) {
        return nativeTextLines;
      }

      const referencedImageId = targetId.slice('imageId:'.length);
      const calibratedLength = correctUSRegionLength(nativeLength, referencedImageId, { data });

      if (!Number.isFinite(calibratedLength) || calibratedLength === nativeLength) {
        return nativeTextLines;
      }

      return [`${csUtilities.roundNumber(calibratedLength)} ${nativeStats.unit || 'mm'}`];
    };
  }
}
