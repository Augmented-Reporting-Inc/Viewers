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
