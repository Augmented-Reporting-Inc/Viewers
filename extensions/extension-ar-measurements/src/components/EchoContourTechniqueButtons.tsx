import React from 'react';
import type { EchoContourTechnique } from '../utils/echoCompositeAcquisition';

export function EchoContourTechniqueButtons({
  disabled = false,
  onChoose,
}: {
  disabled?: boolean;
  onChoose: (technique: EchoContourTechnique) => void;
}) {
  return (
    <>
      {([
        { technique: 'freehand', label: 'Freehand' },
        { technique: 'axisApex', label: 'Axis + apex' },
      ] as const).map(({ technique, label }) => (
        <button
          key={technique}
          type="button"
          disabled={disabled}
          className="rounded border border-cyan-600 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-950/40 disabled:opacity-40"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onChoose(technique);
          }}
        >{label}</button>
      ))}
    </>
  );
}
