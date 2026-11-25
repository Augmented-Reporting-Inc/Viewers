import React from 'react';

/** Presentation only. Owning workflows validate their measurement evidence,
 * configured RAP choices, permissions and persisted answers. Never infer RAP. */
export function SharedIVCRapRVSPAnswer({
  completeIVC, selection = '', choices, rapComplete, trValue = null,
  trIsRecorded, rvspValue = null, disabled = false, readOnly = false,
  ownerLabel = 'learner', captureLabel = 'quiz', allowClear = false,
  onChange, onViewTR,
}: {
  completeIVC: boolean; selection?: string; choices: Array<{value:string;label:string}>;
  rapComplete: boolean; trValue?: number | null; trIsRecorded: boolean;
  rvspValue?: number | string | null; disabled?: boolean; readOnly?: boolean;
  ownerLabel?: string; captureLabel?: string; allowClear?: boolean;
  onChange: (value:string) => void; onViewTR?: () => void;
}) {
  const validRVSP = rvspValue != null && String(rvspValue).trim() !== '' &&
    Number.isFinite(Number(rvspValue));
  const knownSelection = choices.some(choice => choice.value === selection);
  return (
    <div className="mt-2 rounded border border-cyan-700 bg-cyan-950/20 p-2 text-xs text-cyan-100">
      <div className="font-semibold">After measuring IVC: select your RAP</div>
      <div className="mt-1 text-gray-300">
        AR calculates RVSP from your RAP and the TR Vmax you previously
        captured in this {captureLabel}. RAP is not inferred from collapsibility.
      </div>
      <label className="mt-2 flex items-center gap-2">
        RAP
        <select aria-label={ownerLabel === 'learner' ? 'Learner RAP (mmHg)' : 'Reader RAP (mmHg)'}
          value={selection} disabled={disabled || readOnly || !completeIVC}
          className="rounded border border-cyan-600 bg-black px-2 py-1"
          onClick={event => event.stopPropagation()}
          onChange={event => {
            const value = event.target.value;
            if (disabled || readOnly || !completeIVC ||
                (!choices.some(choice => choice.value === value) && !(allowClear && value === ''))) return;
            onChange(value);
          }}>
          <option value="" disabled={!allowClear && selection !== ''}>Select RAP</option>
          {selection && !knownSelection ? (
            <option value={selection} disabled>{selection} mmHg (saved; not a current choice)</option>
          ) : null}
          {choices.map(choice => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </select>
      </label>
      {!completeIVC ? (
        <div className="mt-1 text-amber-200">Complete both calibrated IVC phase measurements first.</div>
      ) : !rapComplete ? (
        <div className="mt-1 text-amber-200" role="status">
          Select RAP ({choices.map(choice => choice.value).join(', ')} mmHg) to complete this IVC question.
        </div>
      ) : !trIsRecorded ? (
        <div className="mt-1 text-amber-200">
          RAP recorded; RVSP unavailable until a source-linked TR Vmax is recorded earlier in this {captureLabel}.
        </div>
      ) : (
        <div className="mt-1 text-green-200">
          {onViewTR ? <button type="button" className="text-left underline"
            onClick={event => { event.stopPropagation(); onViewTR(); }}>
            Recorded TR Vmax: {Number(trValue).toFixed(2)} m/s
          </button> : <>Recorded TR Vmax: {Number(trValue).toFixed(2)} m/s</>}
        </div>
      )}
      {selection !== '' ? (
        <div className="mt-2 rounded border border-emerald-700 p-2 text-emerald-100">
          Saved {ownerLabel} RAP: {selection} mmHg
          {validRVSP && trIsRecorded && rapComplete ? (
            <div>Calculated RVSP: {Number(rvspValue).toFixed(2)} mmHg</div>
          ) : (
            <div>RVSP unavailable: review a recorded TR Vmax before calculating RVSP.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
