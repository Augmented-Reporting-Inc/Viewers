import React from 'react';

export type EchoCompositeResultStatusProps = {
  value?: number | string | null;
  unit?: string;
  label?: string;
  unavailableMessage?: string;
};

/**
 * Presentation shared between Education and Research. Calling workflows own
 * validation, captured evidence, saving and viewer navigation. Never derive
 * a missing result from a source label or a display-only contour statistic.
 */
export function EchoCompositeResultStatus({
  value,
  unit = '',
  label = 'Calculated measurement',
  unavailableMessage = 'Complete the required calibrated measurements.',
}: EchoCompositeResultStatusProps) {
  const result = value == null || String(value).trim() === ''
    ? NaN : Number(value);
  const valid = Number.isFinite(result);
  return valid ? (
    <div className="font-semibold text-emerald-200" aria-live="polite">
      {label}: {result.toFixed(2)}{unit ? ' ' + unit : ''}
    </div>
  ) : (
    <div className="text-amber-200" aria-live="polite">
      Calculation not ready: {unavailableMessage}
    </div>
  );
}

/** Same calculation status container in Education and Research. */
export function EchoCompositeResultCard({ warning = false, children }: {
  warning?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={warning
      ? 'mt-2 rounded border border-amber-700/70 bg-amber-950/10 px-2 py-2 text-xs'
      : 'mt-2 rounded border border-emerald-700/60 bg-emerald-950/10 px-2 py-2 text-xs'}>
      {children}
    </div>
  );
}
