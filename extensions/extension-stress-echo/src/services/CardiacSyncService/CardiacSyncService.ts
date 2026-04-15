import { pubSubServiceInterface } from '@ohif/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StageTimingMeta = {
  HeartRate: string | number; // BPM
  FrameTime: string | number; // ms per frame
  numImageFrames: string | number; // total frames in clip
  StageName: string; // 'REST' | 'PEAK' | 'POST'
  StageNumber: string | number; // 1 | 2 | 3
  ViewName?: string; // 'LAX' | 'A4C' | …
};

export type StageInfo = {
  viewportId: string;
  stageName: string;
  stageNumber: number;
  viewName: string;
  heartRate: number; // BPM
  frameTimeMs: number; // ms
  totalFrames: number;
  framesPerCycle: number; // derived: round(rrIntervalMs / frameTimeMs)
  rrIntervalMs: number; // derived: (60 / heartRate) * 1000
};

export type SyncState = {
  isPlaying: boolean;
  isSyncEnabled: boolean;
  targetRRMs: number;
  cyclePosition: number;
  stages: StageInfo[];
};

// ─── Events ───────────────────────────────────────────────────────────────────

const EVENTS = {
  SYNC_STATE_CHANGED: 'event::CardiacSyncService:syncStateChanged',
  STAGE_REGISTERED: 'event::CardiacSyncService:stageRegistered',
  STAGE_UNREGISTERED: 'event::CardiacSyncService:stageUnregistered',
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

class CardiacSyncService {
  static EVENTS = EVENTS;
  readonly EVENTS = EVENTS;

  // Injected by pubSubServiceInterface mixin
  subscribe!: (event: string, cb: (data: unknown) => void) => { unsubscribe: () => void };
  _broadcastEvent!: (event: string, data: unknown) => void;

  private stages = new Map<string, StageInfo>();
  private cyclePosition = 0; // 0.0 → 1.0 within one cardiac cycle
  private targetRRMs = 1000; // ms — slowest (longest) R-R wins
  private rafHandle: number | null = null;
  private lastTimestamp: number | null = null;
  private _isPlaying = false;
  private _isSyncEnabled = false;

  private cornerstoneViewportService: any;
  private cineService: any;

  constructor({ servicesManager }: { servicesManager: any }) {
    this.cornerstoneViewportService = servicesManager.services.cornerstoneViewportService;
    this.cineService = servicesManager.services.cineService;

    Object.assign(this, pubSubServiceInterface);
  }

  // ── Public: Registration ───────────────────────────────────────────────────

  /**
   * Called by useCardiacSync when a viewport mounts with its displaySet.
   * All values come directly from the displaySet attributes set in
   * getSopClassHandlerModule (promoted from DICOM instance metadata).
   */
  registerStage(viewportId: string, meta: StageTimingMeta): void {
    const heartRate = Number(meta.HeartRate);
    const frameTimeMs = Number(meta.FrameTime);
    const totalFrames = Number(meta.numImageFrames);

    if (!heartRate || !frameTimeMs || !totalFrames) {
      console.warn(
        `[CardiacSyncService] Incomplete timing metadata for viewport "${viewportId}":`,
        { heartRate, frameTimeMs, totalFrames }
      );
      return;
    }

    const rrIntervalMs = (60 / heartRate) * 1000;
    const framesPerCycle = Math.max(1, Math.round(rrIntervalMs / frameTimeMs));

    const info: StageInfo = {
      viewportId,
      stageName: String(meta.StageName),
      stageNumber: Number(meta.StageNumber),
      viewName: String(meta.ViewName ?? ''),
      heartRate,
      frameTimeMs,
      totalFrames,
      framesPerCycle,
      rrIntervalMs,
    };

    this.stages.set(viewportId, info);
    this._recalculateTargetRR();

    console.info(
      `[CardiacSyncService] Registered ${info.stageName} / ${info.viewName}` +
        ` — ${heartRate} BPM, ${framesPerCycle} frames/cycle, RR=${rrIntervalMs.toFixed(0)}ms` +
        ` (targetRR now ${this.targetRRMs.toFixed(0)}ms)`
    );

    this._broadcastEvent(EVENTS.STAGE_REGISTERED, { viewportId, info });
    this._broadcastEvent(EVENTS.SYNC_STATE_CHANGED, this._getState());
  }

  unregisterStage(viewportId: string): void {
    if (!this.stages.has(viewportId)) return;
    this.stages.delete(viewportId);
    this._recalculateTargetRR();
    this._broadcastEvent(EVENTS.STAGE_UNREGISTERED, { viewportId });
    this._broadcastEvent(EVENTS.SYNC_STATE_CHANGED, this._getState());
  }

  // ── Public: Playback ───────────────────────────────────────────────────────

  play(): void {
    if (this._isPlaying || !this._isSyncEnabled) return;
    this._isPlaying = true;
    this.lastTimestamp = null;
    this.rafHandle = requestAnimationFrame(this._tick);
    this._broadcastEvent(EVENTS.SYNC_STATE_CHANGED, this._getState());
  }

  pause(): void {
    this._isPlaying = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this._broadcastEvent(EVENTS.SYNC_STATE_CHANGED, this._getState());
  }

  togglePlayPause(): void {
    this._isPlaying ? this.pause() : this.play();
  }

  /**
   * Enable/disable synchronised playback.
   * When enabled, OHIF's built-in CineService is stopped for all registered
   * viewports so the two RAF loops don't fight each other.
   */
  setSyncEnabled(enabled: boolean): void {
    this._isSyncEnabled = enabled;

    if (!enabled) {
      this.pause();
      for (const viewportId of this.stages.keys()) {
        this._restoreBuiltInCine(viewportId);
      }
    } else {
      for (const viewportId of this.stages.keys()) {
        this._suppressBuiltInCine(viewportId);
      }
    }

    this._broadcastEvent(EVENTS.SYNC_STATE_CHANGED, this._getState());
  }

  getState(): SyncState {
    return this._getState();
  }

  /** Called by extension.onModeExit and mode.onModeExit */
  onModeExit(): void {
    this.pause();
    this.stages.clear();
    this._isSyncEnabled = false;
    this.cyclePosition = 0;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Slowest heart rate = longest R-R = reference for all stages */
  private _recalculateTargetRR(): void {
    if (this.stages.size === 0) {
      this.targetRRMs = 1000;
      return;
    }
    this.targetRRMs = Math.max(...Array.from(this.stages.values()).map(s => s.rrIntervalMs));
  }

  private _tick = (timestamp: number): void => {
    if (!this._isPlaying) return;

    if (this.lastTimestamp !== null) {
      const elapsed = timestamp - this.lastTimestamp;
      // Advance shared normalised position (wraps 0→1 = one full cardiac cycle)
      this.cyclePosition = (this.cyclePosition + elapsed / this.targetRRMs) % 1.0;
      this._renderAllViewports();
    }

    this.lastTimestamp = timestamp;
    this.rafHandle = requestAnimationFrame(this._tick);
  };

  private _renderAllViewports(): void {
    for (const [viewportId, stage] of this.stages) {
      // Map the shared cycle position to this stage's own frame index.
      // framesPerCycle ≤ totalFrames always (clips span multiple cycles),
      // so the modulo keeps us inside the first cycle of the clip.
      const frameIndex = Math.min(
        Math.floor(this.cyclePosition * stage.framesPerCycle),
        stage.totalFrames - 1
      );

      try {
        const viewport = this.cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (viewport) {
          viewport.setImageIdIndex(frameIndex);
          viewport.render();
        }
      } catch {
        // Viewport may not be mounted yet — skip silently
      }
    }
  }

  private _suppressBuiltInCine(viewportId: string): void {
    try {
      this.cineService?.setCine({ id: viewportId, isPlaying: false });
    } catch {
      // cineService may not know this viewport yet — harmless
    }
  }

  private _restoreBuiltInCine(_viewportId: string): void {
    // Intentionally do NOT auto-resume the built-in cine —
    // let the user restart it manually after disabling sync.
  }

  private _getState(): SyncState {
    return {
      isPlaying: this._isPlaying,
      isSyncEnabled: this._isSyncEnabled,
      targetRRMs: this.targetRRMs,
      cyclePosition: this.cyclePosition,
      stages: Array.from(this.stages.values()),
    };
  }
}

export default CardiacSyncService;
