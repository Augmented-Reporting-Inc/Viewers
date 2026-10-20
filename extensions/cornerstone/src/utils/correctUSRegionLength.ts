import { metaData } from '@cornerstonejs/core';
import {
  computeUSRegionLength,
  getImageIdForLengthTarget,
  type USRegionLengthResult,
} from './usRegionLengthCalibration';

/**
 * Metadata adapter for the shared Length calibration. The maths lives in
 * ./usRegionLengthCalibration (pure, unit-tested); this only reads the same
 * Cornerstone metadata the viewport used to build its image geometry.
 *
 * Returns null — meaning "keep Cornerstone's native value" — whenever there is
 * no spatial cm ultrasound region containing both handles.
 */
export function getUSRegionLengthCalibration(
  imageId: string | null | undefined,
  handlePoints: unknown
): USRegionLengthResult | null {
  if (!imageId) {
    return null;
  }

  try {
    const regions = metaData.get('calibrationModule', imageId)?.sequenceOfUltrasoundRegions;
    if (!Array.isArray(regions) || !regions.length) {
      return null;
    }
    const imagePlane = metaData.get('imagePlaneModule', imageId);
    return computeUSRegionLength({ regions, imagePlane, points: handlePoints });
  } catch (error) {
    console.warn('[Length] ultrasound region calibration unavailable:', error);
    return null;
  }
}

/**
 * Calibration for one cachedStats target of a Length annotation. Live text and
 * the completed measurement both go through here, so for the same handles and
 * image they always produce the same number.
 */
export function getUSRegionLengthCalibrationForTarget(
  targetId: unknown,
  annotationData: { handles?: { points?: unknown } } | null | undefined,
  referencedImageId?: string
): USRegionLengthResult | null {
  const imageId = getImageIdForLengthTarget(targetId, referencedImageId);
  return getUSRegionLengthCalibration(imageId, annotationData?.handles?.points);
}
