import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useCine } from '@ohif/ui-next';
import { Enums, eventTarget, cache, imageLoader } from '@cornerstonejs/core';
import { useAppConfig } from '@state';

// ---------------------------------------------------------------------------
// WrappedCinePlayer — pviewer/iuscan build
//
// Per-instance "decode-and-wait" strategy:
//   When a clip is about to autoplay, ACTIVELY decode every frame of the
//   CURRENT instance, show a "Loading clip" indicator, then play at the full
//   DICOM frame rate once all frames are in the cache.
//
//   We drive the loading ourselves via imageLoader.loadAndCacheImage rather
//   than relying on Cornerstone's stack prefetcher: while a viewport is idle
//   (paused at frame 0), the stack prefetcher only loads a WINDOW of frames
//   around the current index and then stalls. Passive polling of cache state
//   therefore never completes for a large instance — playback would time out
//   and start mid-load, stuttering as the playhead hits undecoded frames.
//
//   - First visit to an instance: waits while its frames decode, then plays
//     perfectly smoothly at full rate (no ramp). Wait length scales with frame
//     count and decode throughput.
//   - Return visit: frames already cached (or instantly re-decoded from the
//     browser's HTTP byte cache), so playback starts immediately.
//   - Memory stays bounded — only the current instance is ever decoded;
//     Cornerstone's LRU cache evicts older instances while the browser retains
//     their compressed bytes for fast re-decode on return.
// ---------------------------------------------------------------------------

// Parallel frame loads while waiting. Matches the request-pool ceiling; the
// real limiter is the web-worker decode pool (maxNumberOfWebWorkers).
const LOAD_CONCURRENCY = 16;

// ── Frame-id helpers (self-contained, no service dependency) ───────────────

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

function isDisplaySetFullyCached(displaySet): boolean {
  const imageIds = getImageIds(displaySet);
  return imageIds.length > 0 && imageIds.every(id => cache.isLoaded(id));
}

// ---------------------------------------------------------------------------
// WrappedCinePlayer
// ---------------------------------------------------------------------------
function WrappedCinePlayer({
  enabledVPElement,
  viewportId,
  servicesManager,
}: withAppTypes<{
  enabledVPElement: HTMLElement;
  viewportId: string;
}>) {
  const { customizationService, displaySetService, viewportGridService } = servicesManager.services;
  const [{ isCineEnabled, cines }, cineService] = useCine();
  const [newStackFrameRate, setNewStackFrameRate] = useState(24);
  const [dynamicInfo, setDynamicInfo] = useState(null);
  const [appConfig] = useAppConfig();

  const isMountedRef = useRef(true);
  const cinesRef = useRef(cines);
  const abortLoadRef = useRef(false);

  // "Loading clip" progress pill — scoped to the current instance
  const [bufferingProgress, setBufferingProgress] = useState<{
    buffered: number;
    total: number;
  } | null>(null);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  const cancelPendingPlay = useCallback(() => {
    // Signals the active-load worker pool to stop pulling new frames
    abortLoadRef.current = true;
  }, []);

  // ── Helpers that read live viewport state ──────────────────────────────────

  const getDisplaySets = useCallback(() => {
    const { viewports } = viewportGridService.getState();
    const vp = viewports.get(viewportId);
    if (!vp) return [];
    return vp.displaySetInstanceUIDs
      .map(uid => displaySetService.getDisplaySetByUID(uid))
      .filter(Boolean);
  }, [viewportGridService, viewportId, displaySetService]);

  const isViewportAlive = useCallback(() => {
    const { viewports } = viewportGridService.getState();
    return !!viewports.get(viewportId);
  }, [viewportGridService, viewportId]);

  // ── Core play logic ─────────────────────────────────────────────────────────

  /**
   * Starts playback at the full DICOM frame rate. Re-checks that the viewport
   * is still alive at call time (it may have been destroyed/recreated while we
   * were decoding frames — the captured enabledVPElement could be stale, so we
   * verify against the live grid state).
   */
  const startPlay = useCallback(
    (frameRate: number) => {
      if (!isMountedRef.current) return;
      setBufferingProgress(null);

      // Guard against the destroyed-viewport race
      if (!isViewportAlive()) {
        return;
      }

      setNewStackFrameRate(frameRate);
      cineService.setCine({ id: viewportId, isPlaying: true, frameRate });
      console.log(`[cine] playing at full rate ${frameRate}fps`);
    },
    [cineService, viewportId, isViewportAlive]
  );

  /**
   * Actively decodes every frame of the CURRENT instance via a continuous
   * worker pool, then plays. If already fully cached (return navigation),
   * plays immediately.
   */
  const startPlayWhenReady = useCallback(
    (frameRate: number) => {
      // Stop any in-flight load from a previous instance, then re-arm
      abortLoadRef.current = true;
      abortLoadRef.current = false;

      if (!isViewportAlive()) return;

      const dsets = getDisplaySets();

      // Fast path — current instance already fully cached
      if (dsets.length && dsets.every(isDisplaySetFullyCached)) {
        console.log('[cine] instance already cached, playing immediately');
        startPlay(frameRate);
        return;
      }

      const imageIds = dsets.flatMap(ds => getImageIds(ds));
      const total = imageIds.length;
      const toLoad = imageIds.filter(id => !cache.isLoaded(id));
      let done = total - toLoad.length;
      let nextIndex = 0;
      const t0 = performance.now();

      setBufferingProgress({ buffered: done, total });

      // Continuous worker pool: each worker pulls the next uncached frame and
      // decodes it. loadAndCacheImage de-dupes against any in-flight load from
      // Cornerstone's own prefetcher, so there is no double-fetching.
      const worker = async (): Promise<void> => {
        while (nextIndex < toLoad.length && !abortLoadRef.current) {
          const id = toLoad[nextIndex++];
          try {
            await imageLoader.loadAndCacheImage(id, {});
          } catch {
            // Non-fatal — skip and keep going so the wait can't hang on one frame
          }
          done++;
          if (isMountedRef.current && !abortLoadRef.current) {
            setBufferingProgress({ buffered: done, total });
          }
        }
      };

      Promise.all(Array.from({ length: LOAD_CONCURRENCY }, () => worker())).then(() => {
        if (!isMountedRef.current || abortLoadRef.current) return;

        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        const dsetsNow = getDisplaySets();
        const fullyCached = dsetsNow.length > 0 && dsetsNow.every(isDisplaySetFullyCached);

        if (!fullyCached) {
          // All frames were loaded, but some no longer remain cached → the
          // cache evicted them mid-load, meaning it can't hold one full
          // instance. Playback will stutter; raise cache.setMaxCacheSize.
          try {
            const used = (cache.getCacheSize() / 1e9).toFixed(2);
            const max = (cache.getMaxCacheSize() / 1e9).toFixed(2);
            console.warn(
              `[cine] decoded ${total} frames in ${secs}s but cache evicted some ` +
                `(${used}GB / ${max}GB) — increase maxCacheSize to hold one instance.`
            );
          } catch {
            console.warn(`[cine] decoded ${total} frames in ${secs}s but some were evicted.`);
          }
        } else {
          console.log(`[cine] instance fully decoded in ${secs}s (${total} frames)`);
        }

        startPlay(frameRate);
      });
    },
    [getDisplaySets, isViewportAlive, startPlay]
  );

  const startPlayWhenReadyRef = useRef(startPlayWhenReady);
  useEffect(() => {
    startPlayWhenReadyRef.current = startPlayWhenReady;
  }, [startPlayWhenReady]);

  // ── Display set handler ───────────────────────────────────────────────────

  const newDisplaySetHandler = useCallback(() => {
    if (!enabledVPElement || !isCineEnabled) return;

    const { viewports } = viewportGridService.getState();
    const { displaySetInstanceUIDs } = viewports.get(viewportId);
    let frameRate = 24;
    let isPlaying = cinesRef.current[viewportId]?.isPlaying || false;
    let shouldAutoPlay = false;

    displaySetInstanceUIDs.forEach(displaySetInstanceUID => {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
      const EffectiveFrameRate =
        displaySet.numImageFrames && displaySet.EffectiveDuration
          ? displaySet.numImageFrames / displaySet.EffectiveDuration
          : null;

      if (displaySet.FrameRate || EffectiveFrameRate) {
        frameRate = displaySet.FrameRate
          ? Math.round(1000 / displaySet.FrameRate)
          : Math.round(EffectiveFrameRate);
        if (appConfig.autoPlayCine) shouldAutoPlay = true;
        isPlaying ||= !!appConfig.autoPlayCine;
      } else if (appConfig.autoPlayCine && displaySet.numImageFrames > 1) {
        isPlaying = true;
        shouldAutoPlay = true;
      }

      if (displaySet.isDynamicVolume) {
        const { dynamicVolumeInfo } = displaySet;
        setDynamicInfo({
          volumeId: displaySet.displaySetInstanceUID,
          dimensionGroupNumber: dynamicVolumeInfo.dimensionGroupNumber || 1,
          numDimensionGroups: dynamicVolumeInfo.timePoints.length,
          label: dynamicVolumeInfo.splittingTag,
        });
      } else {
        setDynamicInfo(null);
      }
    });

    setNewStackFrameRate(frameRate);
    cineService.setIsCineEnabled(true);

    if (shouldAutoPlay && isPlaying) {
      // Pause first, then defer until the current instance is fully decoded
      cineService.setCine({ id: viewportId, isPlaying: false, frameRate });
      startPlayWhenReadyRef.current(frameRate);
      return;
    }

    if (isPlaying) {
      cineService.setIsCineEnabled(isPlaying);
    }
    cineService.setCine({ id: viewportId, isPlaying, frameRate });
  }, [
    displaySetService,
    viewportId,
    viewportGridService,
    isCineEnabled,
    enabledVPElement,
    appConfig,
  ]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    cinesRef.current = cines;
  }, [cines]);

  useEffect(() => {
    isMountedRef.current = true;
    newDisplaySetHandler();
    return () => {
      cancelPendingPlay();
    };
  }, [isCineEnabled, newDisplaySetHandler, cancelPendingPlay]);

  useEffect(() => {
    if (!isCineEnabled || !cinesRef.current?.[viewportId] || !enabledVPElement) return;
    const { isPlaying = false, frameRate = 24 } = cinesRef.current[viewportId];
    const validFrameRate = Math.max(frameRate, 1);
    if (isPlaying) {
      try {
        cineService.playClip(enabledVPElement, { framesPerSecond: validFrameRate, viewportId });
      } catch {
        // viewport destroyed
      }
    } else {
      cineService.stopClip(enabledVPElement);
    }
  }, [isCineEnabled, enabledVPElement]);

  useEffect(() => {
    if (!enabledVPElement) return;

    newDisplaySetHandler();
    enabledVPElement.addEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, newDisplaySetHandler);
    enabledVPElement.addEventListener(
      Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME,
      newDisplaySetHandler
    );

    return () => {
      cancelPendingPlay();
      cineService.stopClip(enabledVPElement);
      isMountedRef.current = false;
      cineService.setCine({ id: viewportId, isPlaying: false });
      enabledVPElement.removeEventListener(
        Enums.Events.VIEWPORT_NEW_IMAGE_SET,
        newDisplaySetHandler
      );
      enabledVPElement.removeEventListener(
        Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME,
        newDisplaySetHandler
      );
    };
  }, [enabledVPElement, newDisplaySetHandler, viewportId, cancelPendingPlay]);

  useEffect(() => {
    if (!cines || !cines[viewportId] || !enabledVPElement || !isMountedRef.current) return;

    const { isPlaying = false, frameRate = 24 } = cines[viewportId];
    const validFrameRate = Math.max(frameRate, 1);
    if (isPlaying) {
      try {
        cineService.playClip(enabledVPElement, { framesPerSecond: validFrameRate, viewportId });
      } catch {
        // viewport was destroyed before playClip could run
      }
    } else {
      cineService.stopClip(enabledVPElement);
    }

    return () => {
      cineService.stopClip(enabledVPElement, { viewportId });
    };
  }, [cines, viewportId, cineService, enabledVPElement]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isCineEnabled) return null;

  const cine = cines[viewportId];
  const isPlaying = cine?.isPlaying || false;

  return (
    <>
      {bufferingProgress && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{ top: '140px' }}
        >
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs text-white/80">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400"
              style={{ animation: 'cinePulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite' }}
            />
            <span>
              Loading clip&nbsp;·&nbsp;
              {bufferingProgress.buffered}&nbsp;/&nbsp;{bufferingProgress.total} frames
            </span>
          </div>
          <style>{`
            @keyframes cinePulse {
              0%, 100% { opacity: 1; }
              50%       { opacity: 0.2; }
            }
          `}</style>
        </div>
      )}
      <RenderCinePlayer
        viewportId={viewportId}
        cineService={cineService}
        newStackFrameRate={newStackFrameRate}
        isPlaying={isPlaying}
        dynamicInfo={dynamicInfo}
        customizationService={customizationService}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// RenderCinePlayer — unchanged
// ---------------------------------------------------------------------------
function RenderCinePlayer({
  viewportId,
  cineService,
  newStackFrameRate,
  isPlaying,
  dynamicInfo: dynamicInfoProp,
  customizationService,
}) {
  const CinePlayerComponent = customizationService.getCustomization('cinePlayer');
  const [dynamicInfo, setDynamicInfo] = useState(dynamicInfoProp);

  useEffect(() => {
    setDynamicInfo(dynamicInfoProp);
  }, [dynamicInfoProp]);

  useEffect(() => {
    if (!dynamicInfo) return;
    const handleDimensionGroupChange = evt => {
      const { volumeId, dimensionGroupNumber, numDimensionGroups, splittingTag } = evt.detail;
      setDynamicInfo({ volumeId, dimensionGroupNumber, numDimensionGroups, label: splittingTag });
    };
    eventTarget.addEventListener(
      Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED,
      handleDimensionGroupChange
    );
    return () => {
      eventTarget.removeEventListener(
        Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED,
        handleDimensionGroupChange
      );
    };
  }, [dynamicInfo]);

  useEffect(() => {
    if (!dynamicInfo) return;
    const { volumeId, dimensionGroupNumber, numDimensionGroups, splittingTag } = dynamicInfo || {};
    const volume = cache.getVolume(volumeId, true);
    volume.dimensionGroupNumber = dimensionGroupNumber;
    setDynamicInfo({ volumeId, dimensionGroupNumber, numDimensionGroups, label: splittingTag });
  }, []);

  const updateDynamicInfo = useCallback(props => {
    const { volumeId, dimensionGroupNumber } = props;
    const volume = cache.getVolume(volumeId, true);
    volume.dimensionGroupNumber = dimensionGroupNumber;
  }, []);

  return (
    <CinePlayerComponent
      className="absolute left-1/2 bottom-3 -translate-x-1/2"
      frameRate={newStackFrameRate}
      isPlaying={isPlaying}
      onClose={() => {
        cineService.setCine({ id: viewportId, isPlaying: false });
        cineService.setIsCineEnabled(false);
        cineService.setViewportCineClosed(viewportId);
      }}
      onPlayPauseChange={isPlaying => {
        cineService.setCine({ id: viewportId, isPlaying });
      }}
      onFrameRateChange={frameRate => {
        cineService.setCine({ id: viewportId, frameRate });
      }}
      dynamicInfo={dynamicInfo}
      updateDynamicInfo={updateDynamicInfo}
    />
  );
}

export default WrappedCinePlayer;
