import React, { useEffect, useState } from 'react';
import type { SyncState } from '../services/CardiacSyncService';

type Props = { servicesManager: any };

export function SyncControls({ servicesManager }: Props) {
  const cardiacSyncService = servicesManager?.services?.cardiacSyncService;

  const [state, setState] = useState<SyncState>(
    () =>
      cardiacSyncService?.getState() ?? {
        isPlaying: false,
        isSyncEnabled: false,
        targetRRMs: 0,
        cyclePosition: 0,
        stages: [],
      }
  );

  useEffect(() => {
    if (!cardiacSyncService) return;
    const { unsubscribe } = cardiacSyncService.subscribe(
      cardiacSyncService.EVENTS.SYNC_STATE_CHANGED,
      (s: SyncState) => setState(s)
    );
    return unsubscribe;
  }, [cardiacSyncService]);

  const stages = state.stages ?? [];

  const stageNames = [...new Set(stages.map(s => s.stageName))];
  const viewNames = [...new Set(stages.map(s => s.viewName).filter(Boolean))];
  // By stage: all viewports share one stage name → show it (e.g. "REST")
  // By view: viewports span multiple stages but share one view name → show it (e.g. "LAX")
  // Fallback: show unique stage names joined
  const label =
    stageNames.length === 1
      ? stageNames[0]
      : viewNames.length === 1
        ? viewNames[0]
        : viewNames.length > 0
          ? viewNames.join(' / ')
          : stageNames.join(' / ');

  const heartRates = stages.map(s => s.heartRate).filter(Boolean);
  const minHR = heartRates.length ? Math.min(...heartRates) : null;
  const maxHR = heartRates.length ? Math.max(...heartRates) : null;
  const hrRange =
    minHR && maxHR ? (minHR === maxHR ? `${minHR} BPM` : `${minHR}–${maxHR} BPM`) : null;

  return (
    <div className="flex select-none flex-col gap-2 rounded bg-black/70 px-3 py-2 text-xs text-white">
      {/* Current stage/view label + HR range */}
      {label && (
        <div className="flex items-center justify-between gap-4">
          <span className="font-semibold uppercase tracking-wide text-blue-300">{label}</span>
          {hrRange && <span className="text-gray-300">{hrRange}</span>}
        </div>
      )}

      {/* Play / Pause */}
      <button
        onClick={() => cardiacSyncService?.togglePlayPause()}
        title={state.isPlaying ? 'Pause' : 'Play'}
        className="flex items-center justify-center gap-2 rounded bg-gray-700 px-3 py-1.5 transition-colors hover:bg-gray-600"
      >
        {state.isPlaying ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
        {state.isPlaying ? 'Pause' : 'Play'}
      </button>
    </div>
  );
}
