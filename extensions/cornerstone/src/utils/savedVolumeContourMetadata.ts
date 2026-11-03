// Only measurements carrying an explicit volume-slot kind can regain
// AR-specific guided contour geometry after Cornerstone hydration.
// Do not infer LV/LA contours from generic ROI annotations.
export function getSavedVolumeContourMetadata(annotation: any = {}) {
  const lvSimpson = annotation?.lvSimpson || annotation?.measurements?.lvSimpson;
  const laVolume = annotation?.laVolume || annotation?.measurements?.laVolume;
  if (lvSimpson?.measurementKind === 'lvSimpsonSlot') {
    return { measurementKind: 'lvSimpsonSlot', lvSimpson: { ...lvSimpson } };
  }
  if (laVolume?.measurementKind === 'laVolumeSlot') {
    return { measurementKind: 'laVolumeSlot', laVolume: { ...laVolume } };
  }
  return {};
}

// SplineROI serializes a dense display polyline separately from the user's
// original EF trace. Only the latter is an editable control-point set.
// Returning the dense curve as handles makes an unchanged reopened contour
// fail the exact calibration/anti-edit guard (typically 20x more points).
export function getSavedLVSimpsonControlPoints(annotation: any = {}) {
  const geometry = annotation?.lvSimpson || annotation?.measurements?.lvSimpson;
  if (geometry?.measurementKind !== 'lvSimpsonSlot') return null;
  const points = geometry.originalContourPoints;
  if (!Array.isArray(points) || points.length < 6 ||
      !points.every(point => Array.isArray(point) &&
        point.length >= 3 && point.slice(0, 3).every(Number.isFinite))) {
    return null;
  }
  return points.map(point => [...point]);
}


/**
 * DICOM frame identity must survive EF annotation hydration. A stack viewport
 * can reuse a single FrameOfReferenceUID across every frame; that group key
 * does not prove an EF contour belongs on the currently displayed image.
 *
 * Fail closed for LV Simpson only. Other measurement domains retain their
 * existing, independently implemented frame/view-reference behaviour.
 */
export function isSavedLVSimpsonImageMatch(annotation: any = {}, imageId = '') {
  const geometry = annotation?.lvSimpson || annotation?.measurements?.lvSimpson;
  if (geometry?.measurementKind !== 'lvSimpsonSlot') return true;

  const parseImage = (value: any) => {
    const match = String(value || '').match(
      /\/instances\/([^/?#]+)\/frames\/(\d+)(?:[/?#]|$)/i
    );
    if (!match) return null;
    const frameNumber = Number(match[2]);
    if (!Number.isSafeInteger(frameNumber) || frameNumber < 1) return null;
    return { sop: decodeURIComponent(match[1]), frameNumber };
  };

  const savedImage = parseImage(annotation?.referencedImageId);
  const candidateImage = parseImage(imageId);
  // Do not substitute the current viewport's frame when either side lacks
  // the DICOM instance/frame locator needed to establish identity.
  if (!savedImage || !candidateImage) return false;

  const explicitSOP = String(annotation?.SOPInstanceUID || '').trim();
  const explicitFrame = Number(annotation?.frameNumber);
  if (explicitSOP && explicitSOP !== savedImage.sop) return false;
  if (Number.isSafeInteger(explicitFrame) && explicitFrame > 0 &&
      explicitFrame !== savedImage.frameNumber) return false;

  return savedImage.sop === candidateImage.sop &&
    savedImage.frameNumber === candidateImage.frameNumber;
}


/**
 * Resolve the image used by actual viewer annotation hydration, not merely a
 * display label. Do not trust a same-image batch override or a stale viewport
 * frame for saved EF. The caller can treat failure as a non-destructive skip.
 */
export function resolveSavedLVSimpsonHydrationImage({
  annotation = {},
  referencedImageIdOverride = '',
  currentImageId = '',
}: {
  annotation?: any;
  referencedImageIdOverride?: string;
  currentImageId?: string;
} = {}) {
  const referencedImageId = String(
    referencedImageIdOverride || annotation?.referencedImageId || ''
  ).trim();
  const savedVolume = getSavedVolumeContourMetadata(annotation);
  if (savedVolume.measurementKind !== 'lvSimpsonSlot') {
    return { ok: true, referencedImageId };
  }
  if (!isSavedLVSimpsonImageMatch(annotation, referencedImageId)) {
    return { ok: false, referencedImageId: '', reason: 'saved-reference-mismatch' };
  }
  if (currentImageId &&
      !isSavedLVSimpsonImageMatch(annotation, String(currentImageId))) {
    return { ok: false, referencedImageId: '', reason: 'viewport-frame-mismatch' };
  }
  return { ok: true, referencedImageId };
}
