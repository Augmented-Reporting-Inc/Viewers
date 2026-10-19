import { LengthTool } from '@cornerstonejs/tools';
import { correctUSRegionLength } from '../utils/correctUSRegionLength';

/**
 * Keep the live annotation text and completed report measurement on the same
 * ultrasound-region calibration path. This preserves the standard Length
 * tool name/activation and falls back to Cornerstone stats when no matching
 * ultrasound region applies.
 */
export default class ARCalibratedLengthTool extends LengthTool {
  static toolName = 'Length';

  _calculateCachedStats(annotation, renderingEngine, enabledElement) {
    const result = super._calculateCachedStats(annotation, renderingEngine, enabledElement);
    const imageId = annotation?.metadata?.referencedImageId;
    if (!imageId) return result;

    const stats = annotation?.data?.cachedStats || {};
    Object.values(stats).forEach((entry: any) => {
      if (entry && Number.isFinite(entry.length)) {
        entry.length = correctUSRegionLength(entry.length, imageId, annotation);
      }
    });
    return result;
  }
}
