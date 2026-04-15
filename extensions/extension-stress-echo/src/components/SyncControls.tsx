import React, { useEffect, useState } from 'react';
import type { SyncState } from '../services/CardiacSyncService';

type Props = { servicesManager: any };

/**
 * Sync + Play/Pause bar for synchronised cardiac cine.
 *
 * Uses inline SVG for icons (no @ohif/ui icon dependency) and plain Tailwind
 * classes already present in OHIF's bundle.
 *
 * Usage: <SyncControls servicesManager={servicesManager} />
 */
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

  const referenceHR = state.targetRRMs ? Math.round(60000 / state.targetRRMs) : null;

  return (
    <div className="flex select-none items-center gap-2 rounded bg-black/70 px-3 py-1.5 text-xs text-white">
      {/* Sync toggle */}
      <button
        onClick={() => cardiacSyncService?.setSyncEnabled(!state.isSyncEnabled)}
        title="Toggle synchronised cardiac cine"
        className={[
          'flex items-center gap-1.5 rounded px-2 py-1 font-semibold transition-colors',
          state.isSyncEnabled ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-600 hover:bg-gray-500',
        ].join(' ')}
      >
        {/* Heartbeat / ECG icon */}
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
        >
          <polyline points="2,12 6,12 8,4 11,20 14,10 16,14 18,12 22,12" />
        </svg>
        Sync
      </button>

      {/* Play / Pause */}
      <button
        onClick={() => cardiacSyncService?.togglePlayPause()}
        disabled={!state.isSyncEnabled}
        title={state.isPlaying ? 'Pause' : 'Play'}
        className={[
          'flex items-center gap-1 rounded px-2 py-1 transition-colors',
          state.isSyncEnabled
            ? 'cursor-pointer bg-gray-700 hover:bg-gray-600'
            : 'cursor-not-allowed opacity-40',
        ].join(' ')}
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

      {/* Per-stage info — shown when sync is on */}
      {state.isSyncEnabled && referenceHR && (
        <span className="ml-1 text-gray-300">
          ref {referenceHR} BPM
          {state.stages
            .sort((a, b) => a.stageNumber - b.stageNumber)
            .map(s => (
              <span key={s.viewportId} className="ml-2 opacity-70">
                {s.stageName} {s.heartRate}bpm
              </span>
            ))}
        </span>
      )}
    </div>
  );
}
