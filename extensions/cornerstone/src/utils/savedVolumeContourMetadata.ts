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
