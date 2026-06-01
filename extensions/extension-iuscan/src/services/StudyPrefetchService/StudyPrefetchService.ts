import { cache, imageLoader } from '@cornerstonejs/core';

// ─── Events ───────────────────────────────────────────────────────────────────

const EVENTS = {
  PROGRESS_UPDATED: 'event::StudyPrefetchService:progressUpdated',
  PREFETCH_COMPLETE: 'event::StudyPrefetchService:prefetchComplete',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrefetchProgress = {
  buffered: number;
  total: number;
  complete: boolean;
};

// ─── Helpers (module-level, no React) ─────────────────────────────────────────

function getImageIds(displaySet): string[] {
  const ids = displaySet.imageIds ?? displaySet.images?.map(img => img.imageId ?? img.url) ?? [];

  // Multiframe: single imageId ending in /frames/1 — expand to all frames
  if (ids.length === 1 && displaySet.numImageFrames > 1) {
    const baseId = ids[0];
    const frameBase = baseId.replace(/\/frames\/\d+$/, '');
    return Array.from(
      { length: displaySet.numImageFrames },
      (_, i) => `${frameBase}/frames/${i + 1}`
    );
  }

  return ids;
}

function isFullyCached(displaySet): boolean {
  const ids = getImageIds(displaySet);
  return ids.length > 0 && ids.every(id => cache.isLoaded(id));
}

// ─── Service ──────────────────────────────────────────────────────────────────

class StudyPrefetchService {
  static EVENTS = EVENTS;
  readonly EVENTS = EVENTS;

  // Max frames in flight at once. Matches maxNumRequests.interaction (20) which
  // the h2 connection has been verified to sustain without a connection ceiling.
  private static readonly CONCURRENCY = 20;

  // Emit a timing sample every N frames so we can see real load+decode latency
  private static readonly TIMING_SAMPLE_EVERY = 50;

  private _listeners: Map<string, Set<Function>> = new Map();
  private _buffered = 0;
  private _total = 0;
  private _complete = false;
  private _aborted = false;
  private _running = false;
  private _frameCounter = 0;
  private _startTime = 0;

  private displaySetService: any;

  constructor({ servicesManager }: { servicesManager: any }) {
    this.displaySetService = servicesManager.services.displaySetService;
  }

  // ── Public ────────────────────────────────────────────────────────────────

  subscribe(event: string, cb: (data: unknown) => void): { unsubscribe: () => void } {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(cb);
    return { unsubscribe: () => this._listeners.get(event)?.delete(cb) };
  }

  getProgress(): PrefetchProgress {
    return {
      buffered: this._buffered,
      total: this._total,
      complete: this._complete,
    };
  }

  isComplete(): boolean {
    return this._complete;
  }

  /**
   * Called from onModeEnter. Starts prefetching all multiframe instances
   * in the study. Safe to call multiple times — ignored if already running
   * or complete.
   */
  async startPrefetch(): Promise<void> {
    if (this._running || this._complete) return;
    this._running = true;
    this._aborted = false;
    this._frameCounter = 0;
    this._startTime = performance.now();

    // Wait for display sets if not yet available (onModeEnter runs before
    // displaySetService is populated)
    let allDisplaySets = (this.displaySetService.activeDisplaySets ?? []).filter(
      ds => ds.numImageFrames > 1
    );

    if (!allDisplaySets.length) {
      await new Promise<void>(resolve => {
        const sub = this.displaySetService.subscribe(
          this.displaySetService.EVENTS.DISPLAY_SETS_ADDED,
          () => {
            sub.unsubscribe();
            resolve();
          }
        );
      });
    }

    // Re-query after potential wait — runs regardless of which path was taken
    allDisplaySets = (this.displaySetService.activeDisplaySets ?? [])
      .filter(ds => ds.numImageFrames > 1)
      .sort((a, b) => Number(a.InstanceNumber ?? 0) - Number(b.InstanceNumber ?? 0));

    this._total = allDisplaySets.reduce((sum, ds) => sum + getImageIds(ds).length, 0);
    this._buffered = allDisplaySets.reduce((sum, ds) => {
      return sum + getImageIds(ds).filter(id => cache.isLoaded(id)).length;
    }, 0);

    console.log(
      `[StudyPrefetchService] Starting prefetch: ${allDisplaySets.length} instances, ` +
        `${this._total} frames (${this._buffered} already cached), concurrency=${StudyPrefetchService.CONCURRENCY}`
    );

    this._broadcastProgress();

    // Process instances one at a time so the first (active) instance finishes
    // before later ones start. Within each instance, a continuous worker pool
    // keeps CONCURRENCY requests in flight at all times.
    for (const ds of allDisplaySets) {
      if (this._aborted) {
        console.log('[StudyPrefetchService] Prefetch aborted');
        this._running = false;
        return;
      }
      if (isFullyCached(ds)) continue;
      await this._prefetchInstance(ds);
    }

    if (!this._aborted) {
      this._complete = true;
      this._running = false;
      const elapsedSec = ((performance.now() - this._startTime) / 1000).toFixed(1);
      console.log(
        `[StudyPrefetchService] Prefetch complete: ${this._buffered}/${this._total} frames in ${elapsedSec}s`
      );
      this._broadcastEvent(EVENTS.PREFETCH_COMPLETE, this.getProgress());
    }
  }

  /** Called from onModeExit — stops any in-progress prefetch immediately */
  onModeExit(): void {
    this._aborted = true;
    this._running = false;
    this._complete = false;
    this._buffered = 0;
    this._total = 0;
    this._frameCounter = 0;
    console.log('[StudyPrefetchService] Reset on mode exit');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Continuous worker pool: launches CONCURRENCY async workers that each pull
   * the next imageId from a shared cursor until the queue is exhausted. Unlike
   * a batched Promise.all, no worker ever idles waiting for a slow straggler —
   * the moment one frame finishes, that worker grabs the next one. This keeps
   * all CONCURRENCY connections continuously saturated.
   */
  private async _prefetchInstance(displaySet): Promise<void> {
    const imageIds = getImageIds(displaySet).filter(id => !cache.isLoaded(id));

    // Count any already-cached frames toward progress
    const alreadyCached = getImageIds(displaySet).length - imageIds.length;
    if (alreadyCached > 0) {
      this._buffered += alreadyCached;
      this._broadcastProgress();
    }

    if (!imageIds.length) return;

    const concurrency = StudyPrefetchService.CONCURRENCY;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < imageIds.length && !this._aborted) {
        const id = imageIds[nextIndex++];

        const t0 = performance.now();
        try {
          await imageLoader.loadAndCacheImage(id, {});
        } catch {
          // Non-fatal — count as buffered so progress doesn't stall
        }
        const dt = performance.now() - t0;

        this._buffered++;
        this._frameCounter++;

        // Periodic timing sample to distinguish download vs decode latency
        if (this._frameCounter % StudyPrefetchService.TIMING_SAMPLE_EVERY === 0) {
          const totalElapsed = (performance.now() - this._startTime) / 1000;
          const avgRate = (this._frameCounter / totalElapsed).toFixed(1);
          console.log(
            `[StudyPrefetchService] ${this._buffered}/${this._total} frames · ` +
              `last load+decode ${dt.toFixed(0)}ms · avg ${avgRate} frames/s`
          );
        }

        this._broadcastProgress();
      }
    };

    // Launch `concurrency` workers pulling from the shared cursor
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  private _broadcastProgress(): void {
    this._broadcastEvent(EVENTS.PROGRESS_UPDATED, this.getProgress());
  }

  _broadcastEvent(event: string, data: unknown): void {
    this._listeners.get(event)?.forEach(cb => {
      try {
        cb(data);
      } catch {}
    });
  }
}

export default StudyPrefetchService;
