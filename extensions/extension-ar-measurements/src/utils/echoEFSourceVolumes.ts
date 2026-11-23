import {
  calculateLVSimpsonContourVolumeForMeasurement,
  LV_SIMPSON_SLOT_ORDER,
} from './lvSimpson';

/**
 * Verified source-only single-view EF volumes for the four required slots.
 * Shared by Research display, Education presentation, and viewer capture.
 * No raw ROI areas or unverified display strings are accepted.
 */
export function getLVSimpsonSourceVolumes(annotations: any[] = []) {
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
    const volume = calculateLVSimpsonContourVolumeForMeasurement(annotation);
    bySlot[slot] = volume != null && Number.isFinite(volume) && volume > 0
      ? volume : null;
  }
  for (const slot of LV_SIMPSON_SLOT_ORDER) {
    if (counts[slot] > 1) bySlot[slot] = null;
  }
  return bySlot;
}
