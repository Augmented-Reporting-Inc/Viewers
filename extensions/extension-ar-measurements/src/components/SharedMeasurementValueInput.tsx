import React, { useState } from 'react';

/**
 * Workflow-neutral numeric measurement answer and source-delete control.
 * Quiz and Research pass their own value, authorization, source ownership
 * and deletion callback. The shared UI never deletes an annotation itself.
 */
export function SharedMeasurementValueInput({
  value,
  onChange,
  unit = '',
  disabled = false,
  min,
  max,
  step = '0.01',
  displayDecimalPlaces,
  placeholder = 'Measurement value',
  onDelete,
  deleteDisabled = false,
  deleteLabel = 'Delete measurement',
}: {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  unit?: string;
  disabled?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  displayDecimalPlaces?: number;
  placeholder?: string;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  deleteLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const numericValue = Number(value);
  const displayValue = !editing && displayDecimalPlaces !== undefined &&
    value != null && String(value).trim() !== '' && Number.isFinite(numericValue)
    ? numericValue.toFixed(displayDecimalPlaces) : (value ?? '');
  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden">
      <div className="flex min-w-0 flex-1 items-center rounded border border-gray-700 bg-black">
        <input
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-white"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={event => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
        />
        {onDelete ? (
          <button
            type="button"
            data-quiz-review-action="delete"
            className="shrink-0 border-l border-gray-700 px-2 py-1 font-bold text-red-200 hover:bg-red-950 disabled:opacity-40"
            title={deleteLabel}
            aria-label={deleteLabel}
            disabled={disabled || deleteDisabled}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
          >×</button>
        ) : null}
      </div>
      {unit ? (
        <div className="w-14 shrink-0 truncate rounded border border-gray-700 px-2 py-1 text-center text-sm text-gray-300">
          {unit}
        </div>
      ) : null}
    </div>
  );
}

/** Shared captured measurement label; the caller supplies the owned source. */
export function SharedMeasurementLabel({ label }: { label?: string }) {
  const text = String(label || '').trim();
  return text ? (
    <div className="min-w-0 whitespace-normal break-words text-xs text-gray-300" title={text}>
      Measurement label: {text}
    </div>
  ) : null;
}
