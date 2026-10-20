import { utilities as csUtilities } from '@cornerstonejs/core';
import { correctUSRegionLength } from './correctUSRegionLength';

/**
 * Override only the live Length annotation TEXT in the learning quiz.
 * Cornerstone's native Length tool owns interactions, cachedStats and the
 * ANNOTATION_COMPLETED event; the existing Length mapping owns persisted values.
 *
 * Completed AR Length displays normalize cm to mm, including the Cornerstone
 * "US Region" suffix. Apply the same normalization here.
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
    const corrected = correctUSRegionLength(nativeLength, referencedImageId, { data });
    if (!Number.isFinite(corrected) || corrected === nativeLength) {
      return originalLines;
    }

    const sourceUnit = String(nativeStats.unit || '')
      .replace(/\s+US Region$/i, '')
      .replace(/\s+AR_US_REGION_CALIBRATION$/i, '')
      .trim()
      .toLowerCase();

    // DICOM's spatial ultrasound physicalDelta is expressed in cm for
    // physicalUnitsXDirection/YDirection=3. AR's completed display is in mm.
    // Keep unrecognized, nonspatial units untouched rather than invent units.
    if (sourceUnit === 'cm') {
      return [`${csUtilities.roundNumber(corrected * 10, 2)} mm`];
    }
    if (sourceUnit === 'mm') {
      return [`${csUtilities.roundNumber(corrected, 2)} mm`];
    }
    return originalLines;
  };
}
