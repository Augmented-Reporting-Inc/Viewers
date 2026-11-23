import React from 'react';
export { getLVSimpsonSourceVolumes } from '../utils/echoEFSourceVolumes';

export const ECHO_EF_CONTOUR_SLOTS = [
  { slot: 'A4C_ED', label: 'A4C end-diastole' },
  { slot: 'A4C_ES', label: 'A4C end-systole' },
  { slot: 'A2C_ED', label: 'A2C end-diastole' },
  { slot: 'A2C_ES', label: 'A2C end-systole' },
] as const;

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
