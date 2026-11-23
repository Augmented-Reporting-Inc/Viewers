import React from 'react';
import {
  calculateLVSimpsonContourVolumeForMeasurement,
  LV_SIMPSON_SLOT_ORDER,
} from '../utils/lvSimpson';

export const ECHO_EF_CONTOUR_SLOTS = [
  { slot: 'A4C_ED', label: 'A4C end-diastole' },
  { slot: 'A4C_ES', label: 'A4C end-systole' },
  { slot: 'A2C_ED', label: 'A2C end-diastole' },
  { slot: 'A2C_ES', label: 'A2C end-systole' },
] as const;

/**
 * Research and Education both use the verified LV Simpson contour calculator.
 * Accept only explicitly identified contour slots. Ambiguous duplicates do not
 * produce a plausible but arbitrary value; they must be resolved by the owner.
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

/** Presentation only. Does not read or mutate answers, scoring or persistence. */
export function EchoEFContourVolumes({
  volumes = {},
  status = 'Current',
}: {
  volumes?: Record<string, unknown>;
  status?: 'Current' | 'Saved';
}) {
  return (
    <div className="mt-2 rounded border border-cyan-800 p-2 text-xs text-gray-200">
      <div className="mb-1 font-semibold text-cyan-100">
        {status} single-view LV contour volumes (mL)
      </div>
      {ECHO_EF_CONTOUR_SLOTS.map(({ slot, label }) => {
        const raw = volumes[slot];
        const volume = raw == null || raw === '' ? NaN : Number(raw);
        const valid = Number.isFinite(volume) && volume > 0;
        return (
          <div key={slot} className="flex justify-between gap-2 py-0.5">
            <span>{label}</span>
            <span className={valid ? 'font-semibold text-emerald-200' : 'text-amber-200'}>
              {valid ? volume.toFixed(2) + ' mL' : 'Not available'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
