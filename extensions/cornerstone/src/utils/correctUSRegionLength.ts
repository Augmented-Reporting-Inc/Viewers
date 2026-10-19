import { metaData } from '@cornerstonejs/core';

// Use the same ultrasound-region correction for the live Length annotation and
// completed measurement mapping. Outside applicable regions preserve native stats.
export function correctUSRegionLength(rawLength, referencedImageId, annotation) {
  if (!referencedImageId) return rawLength;
  try {
    const calibration = metaData.get('calibrationModule', referencedImageId);
    const regions = calibration?.sequenceOfUltrasoundRegions;
    if (!regions?.length) return rawLength;

    const SUPPORTED = [1, 2, 3, 4];
    const handles = annotation?.data?.handles?.points;
    if (!handles || handles.length < 2) return rawLength;

    const imagePlane = metaData.get('imagePlaneModule', referencedImageId);
    const colSpacing = imagePlane?.columnPixelSpacing ?? 1.0;
    const rowSpacing = imagePlane?.rowPixelSpacing ?? 1.0;

    const pixelHandles = handles.map(w => ({
      x: w[0] / colSpacing,
      y: w[1] / rowSpacing,
    }));

    const region = regions.find(
      r =>
        SUPPORTED.includes(r.regionDataType) &&
        pixelHandles.every(
          px =>
            px.x >= r.regionLocationMinX0 &&
            px.x <= r.regionLocationMaxX1 &&
            px.y >= r.regionLocationMinY0 &&
            px.y <= r.regionLocationMaxY1
        )
    );

    if (!region) return rawLength;

    const [p1, p2] = pixelHandles;
    const dxPhys = (p1.x - p2.x) * Math.abs(region.physicalDeltaX);
    const dyPhys = (p1.y - p2.y) * Math.abs(region.physicalDeltaY);
    const corrected = Math.sqrt(dxPhys * dxPhys + dyPhys * dyPhys);
    return corrected;
  } catch (e) {
    console.error('[Length] error:', e);
    return rawLength;
  }
}

