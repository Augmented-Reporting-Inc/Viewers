import React from 'react';

/**
 * Reusable scored observation widget.
 * Renders a labelled row of segmented buttons.
 * Clicking the currently-active button deselects it (sets value to null).
 */
export default function ScoreSelector({ label, options, value, onChange }) {
  return (
    <div className="gi-score-row py-1">
      <span className="gi-score-label mb-0.5 block text-xs text-gray-400">{label}</span>
      <div className="gi-score-buttons flex flex-wrap gap-1">
        {options.map(opt => (
          <button
            key={opt.value}
            title={opt.label}
            className={[
              'gi-score-btn rounded border px-2 py-1 text-xs transition-colors',
              value === opt.value
                ? 'bg-primary-light border-primary-light font-semibold text-black'
                : 'hover:border-primary-light hover:text-primary-light border-gray-600 bg-transparent text-gray-300',
            ].join(' ')}
            onClick={() => onChange(value === opt.value ? null : opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
