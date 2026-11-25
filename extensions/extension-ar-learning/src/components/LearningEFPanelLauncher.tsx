import React from 'react';

/** Shared Education/Research Simpson EF panel launcher. The workflow callback
 * selects the authorized source frames and launches the same viewer command. */
export function LearningEFPanelLauncher({
  onOpen,
  disabled = false,
  busy = false,
}: {
  onOpen: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled || busy}
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    >
      {busy ? 'Opening EF panel…' : 'Open EF panel'}
    </button>
  );
}
