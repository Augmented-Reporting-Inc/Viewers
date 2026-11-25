import {
  calculateLVSimpsonContourVolumeForMeasurement,
  LV_SIMPSON_SLOT_ORDER,
} from './lvSimpson';

/**
 * Verified source-only single-view EF volumes for the four required slots.
 * Shared by Research display, Education presentation, and viewer capture.
 * No raw ROI areas or unverified display strings are accepted.
 */
export function getLVSimpsonSourceVolumes(
  annotations: any[] = [],
  { verifiedSavedSources = false }: { verifiedSavedSources?: boolean } = {}
) {
  const bySlot: Record<string, number | null> = {};
  const counts: Record<string, number> = {};
  for (const annotation of annotations) {
    const slot = String(annotation?.lvSimpson?.slot ||
      annotation?.measurements?.lvSimpson?.slot ||
      annotation?.slot || '').trim();
    const kind = String(annotation?.measurementKind ||
      annotation?.lvSimpson?.measurementKind ||
      annotation?.measurements?.measurementKind || '').trim();
    if (kind !== 'lvSimpsonSlot' || !LV_SIMPSON_SLOT_ORDER.includes(slot)) continue;
    counts[slot] = (counts[slot] || 0) + 1;
    // Saved SplineROI controls are the actual editable trace; the sampled
    // polyline is display geometry and can differ without a user edit.
    const volume = calculateLVSimpsonContourVolumeForMeasurement({
      ...annotation,
      ...(Array.isArray(annotation?.lvSimpsonControlPoints) ? {} :
        Array.isArray(annotation?.splineControlPoints)
          ? { lvSimpsonControlPoints: annotation.splineControlPoints }
          : verifiedSavedSources ? {
              // Legacy compact verified Review sources may lack a separate
              // spline-control field. Use the original calibrated trace that
              // the shared saved-annotation hydrator restores.
              lvSimpsonControlPoints: (annotation?.lvSimpson ||
                annotation?.measurements?.lvSimpson)?.originalContourPoints,
            } : {}),
    });
    bySlot[slot] = volume != null && Number.isFinite(volume) && volume > 0
      ? volume : null;
  }
  for (const slot of LV_SIMPSON_SLOT_ORDER) {
    if (counts[slot] > 1) bySlot[slot] = null;
  }
  return bySlot;
}
