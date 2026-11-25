import React from 'react';

/** Shared source-linked spectral answer. The owning workflow validates evidence
 * and supplies its own persistence, permissions and deletion callbacks. */
export function SharedTRVmaxQuestionAnswer({
  captured, value, issue = '', disabled = false, readOnly = false,
  ownerLabel = 'learner', captureLabel = 'quiz', showInstructions = true,
  onDelete, onNavigate,
}: {
  captured: boolean; value?: number | string | null; issue?: string;
  disabled?: boolean; readOnly?: boolean; ownerLabel?: string;
  captureLabel?: string; showInstructions?: boolean;
  onDelete?: () => void; onNavigate?: () => void;
}) {
  const valid = captured && value != null && String(value).trim() !== '' &&
    Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 8;
  const savedText = 'Saved ' + ownerLabel + ' TR Vmax: ' +
    Number(value).toFixed(2) + ' m/s · Available for IVC / RVSP calculation';
  return (
    <>
      <div className={valid
        ? 'rounded border border-emerald-700 bg-emerald-950/20 p-2 text-xs text-emerald-100'
        : 'rounded border border-amber-700 bg-amber-950/20 p-2 text-xs text-amber-100'}>
        <div className="flex items-center justify-between gap-2">
          {valid && onNavigate ? (
            <button type="button" className="min-w-0 text-left hover:underline"
              data-quiz-review-action="navigation"
              onClick={event => { event.preventDefault(); event.stopPropagation(); onNavigate(); }}>
              {savedText}
            </button>
          ) : <span>{valid ? savedText : issue ||
            ('No source-linked ' + ownerLabel + ' TR Vmax is recorded yet. Complete the calibrated spectral Vmax measurement before proceeding to IVC.')}</span>}
          {valid && !disabled && !readOnly && onDelete ? (
            <button type="button" data-quiz-review-action="delete"
              className="shrink-0 rounded border border-red-700 px-2 py-1 text-sm font-bold text-red-200 hover:bg-red-950"
              title="Delete TR Vmax measurement" aria-label="Delete TR Vmax measurement"
              onClick={event => { event.preventDefault(); event.stopPropagation(); onDelete(); }}>×</button>
          ) : null}
        </div>
      </div>
      {showInstructions && !readOnly ? (
        <div className="text-xs text-gray-400">
          Complete a calibrated TR spectral peak measurement; the {captureLabel} will capture its velocity and DICOM source automatically.
        </div>
      ) : null}
    </>
  );
}
