import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useCine } from '@ohif/ui-next';
import { Enums, eventTarget, cache, imageLoader } from '@cornerstonejs/core';
import { useAppConfig } from '@state';

// ---------------------------------------------------------------------------
// Build/version marker — logged once on mount so the running build is
// identifiable from the console. Bump this when you rebuild so you can confirm
// from logs which CinePlayer + whether the decode patch is included.
// ---------------------------------------------------------------------------
const CINE_PLAYER_VERSION =
  'rviewer bviewer adaptive-prefetch-100 + global-prefetch-limit-4 + small-window-1 v4';

// ---------------------------------------------------------------------------
// Instance prefetch utility
// Prefetches frames for an adaptive number of upcoming displaySets in the same
// series, using a concurrency level based on the current instance frame count.
// <=100 frames is treated as small/echo-style. Anything >100 is treated as large.
// ---------------------------------------------------------------------------
const SMALL_CINE_MAX_FRAMES_PER_DISPLAY_SET = 100;

type PrefetchConfig = {
  label: string;
  window: number;
  concurrency: number;
};

const SMALL_CINE_PREFETCH: PrefetchConfig = {
  label: 'small-cine',
  window: 1,
  concurrency: 4,
};

const LARGE_CINE_PREFETCH: PrefetchConfig = {
  label: 'large-cine',
  window: 0,
  concurrency: 4,
};

const MAX_BACKGROUND_FRAME_REQUESTS = 4;
const activeBackgroundRequests = new Set<string>();
const backgroundFrameRequestQueue: Array<() => void> = [];
let activeBackgroundFrameRequestCount = 0;

async function withBackgroundFrameRequestSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeBackgroundFrameRequestCount >= MAX_BACKGROUND_FRAME_REQUESTS) {
    await new Promise<void>(resolve => backgroundFrameRequestQueue.push(resolve));
  }

  activeBackgroundFrameRequestCount += 1;

  try {
    return await work();
  } finally {
    activeBackgroundFrameRequestCount -= 1;
    const next = backgroundFrameRequestQueue.shift();

    if (next) {
      next();
    }
  }
}

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

function getDisplaySetFrameCount(displaySet): number {
  return getImageIds(displaySet).length || Number(displaySet.numImageFrames) || 0;
}

function getPrefetchConfigForDisplaySet(displaySet): PrefetchConfig {
  const frameCount = getDisplaySetFrameCount(displaySet);

  if (frameCount > 0 && frameCount <= SMALL_CINE_MAX_FRAMES_PER_DISPLAY_SET) {
    return SMALL_CINE_PREFETCH;
  }

  return LARGE_CINE_PREFETCH;
}

function shouldPlayImmediately(displaySets): boolean {
  return (
    displaySets.length > 0 &&
    displaySets.every(displaySet => {
      const frameCount = getDisplaySetFrameCount(displaySet);
      return frameCount > 0 && frameCount <= SMALL_CINE_MAX_FRAMES_PER_DISPLAY_SET;
    })
  );
}

function isDisplaySetFullyCached(displaySet): boolean {
  const imageIds = getImageIds(displaySet);
  return imageIds.length > 0 && imageIds.every(id => cache.isLoaded(id));
}

async function prefetchDisplaySetFrames(displaySet, concurrency: number): Promise<void> {
  const imageIds = getImageIds(displaySet);
  if (!imageIds.length) {
    return;
  }

  const batchSize = Math.max(1, concurrency);

  for (let i = 0; i < imageIds.length; i += batchSize) {
    const batch = imageIds
      .slice(i, i + batchSize)
      .filter(id => !cache.isLoaded(id) && !activeBackgroundRequests.has(id));
    if (!batch.length) {
      continue;
    }

    batch.forEach(id => activeBackgroundRequests.add(id));
    await Promise.all(
      batch.map(id =>
        withBackgroundFrameRequestSlot(() => imageLoader.loadAndCacheImage(id, {}))
          .catch(() => {})
          .finally(() => activeBackgroundRequests.delete(id))
      )
    );
  }
}

function prefetchAheadInstances(currentDisplaySetInstanceId: string, displaySetService): void {
  const activeDisplaySets = (displaySetService.activeDisplaySets ?? []).filter(
    displaySet => displaySet.numImageFrames > 1
  );

  const currentDisplaySet = activeDisplaySets.find(
    displaySet => displaySet.displaySetInstanceUID === currentDisplaySetInstanceId
  );

  if (!currentDisplaySet) {
    return;
  }

  const prefetchConfig = getPrefetchConfigForDisplaySet(currentDisplaySet);

  if (prefetchConfig.window <= 0) {
    return;
  }

  const currentSeriesInstanceId = currentDisplaySet.SeriesInstanceUID;

  const allDisplaySets = activeDisplaySets
    .filter(
      displaySet =>
        !currentSeriesInstanceId || displaySet.SeriesInstanceUID === currentSeriesInstanceId
    )
    .sort((a, b) => {
      const aNum = Number(a.InstanceNumber);
      const bNum = Number(b.InstanceNumber);

      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        return aNum - bNum;
      }

      const aKey = String(a.InstanceNumber ?? a.displaySetInstanceUID);
      const bKey = String(b.InstanceNumber ?? b.displaySetInstanceUID);
      return aKey.localeCompare(bKey);
    });

  const currentIdx = allDisplaySets.findIndex(
    displaySet => displaySet.displaySetInstanceUID === currentDisplaySetInstanceId
  );
  if (currentIdx === -1) {
    return;
  }

  const toPrefetch = allDisplaySets
    .slice(currentIdx + 1, currentIdx + 1 + prefetchConfig.window)
    .filter(displaySet => !isDisplaySetFullyCached(displaySet));

  if (toPrefetch.length) {
    console.log(
      `[cine] ${prefetchConfig.label} prefetching ${toPrefetch.length} ahead instance(s), concurrency ${prefetchConfig.concurrency}:`,
      toPrefetch.map(displaySet => displaySet.displaySetInstanceUID)
    );
  }

  (async () => {
    for (const displaySet of toPrefetch) {
      await prefetchDisplaySetFrames(displaySet, prefetchConfig.concurrency);
    }
  })();
}

// ---------------------------------------------------------------------------
// WrappedCinePlayer
//
// Two-stage frame rate (no ramp):
//   Stage 1 — play at a SAFE rate below the measured frame-load rate, so the
//             playhead can't outrun the frames still being decoded.
//   Stage 2 — the moment ALL frames are cached, jump straight to the DICOM
//             metadata frame rate. No intermediate ramping (the ramp gained
//             nothing because load throughput doesn't rise as more frames
//             arrive — it's gated by decode/network, not by progress).
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
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cinesRef = useRef(cines);
  const [bufferingProgress, setBufferingProgress] = useState<{
    buffered: number;
    total: number;
  } | null>(null);
  const cacheMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    console.log(`[cine] ${CINE_PLAYER_VERSION}`);
  }, []);

  const cancelPendingPlay = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (cacheMonitorRef.current) {
      clearInterval(cacheMonitorRef.current);
      cacheMonitorRef.current = null;
    }
  }, []);

  const startPlayWhenReady = useCallback(
    (frameRate: number) => {
      cancelPendingPlay();

      const getDisplaySets = () => {
        const { viewports } = viewportGridService.getState();
        const vp = viewports.get(viewportId);
        if (!vp) {
          return [];
        }
        return vp.displaySetInstanceUIDs
          .map(uid => displaySetService.getDisplaySetByUID(uid))
          .filter(Boolean);
      };

      // ── startPlay: begin at `playFrameRate` (stage 1), then watch the cache
      //    and jump to the DICOM `frameRate` once fully cached (stage 2). ──
      const startPlay = (
        playFrameRate: number = frameRate,
        options: { monitorCache?: boolean } = {}
      ) => {
        if (!isMountedRef.current) {
          return;
        }
        cancelPendingPlay();

        const { monitorCache = true } = options;

        if (monitorCache) {
          cacheMonitorRef.current = setInterval(() => {
            const dsets = getDisplaySets();
            if (!dsets.length) {
              return;
            }

            const totalCached = dsets.reduce((sum, ds) => {
              const ids = getImageIds(ds);
              return sum + ids.filter(id => cache.isLoaded(id)).length;
            }, 0);

            const totalFrames = dsets.reduce((sum, ds) => sum + getImageIds(ds).length, 0);

            setBufferingProgress({ buffered: totalCached, total: totalFrames });

            if (dsets.every(isDisplaySetFullyCached)) {
              clearInterval(cacheMonitorRef.current!);
              cacheMonitorRef.current = null;
              if (!isMountedRef.current) {
                return;
              }

              setBufferingProgress(null);
              setNewStackFrameRate(frameRate);
              cineService.setCine({ id: viewportId, isPlaying: true, frameRate });
              console.log(`[cine] fully cached → DICOM rate ${frameRate}fps`);
            }
          }, 500);
        } else {
          setBufferingProgress(null);
        }

        setNewStackFrameRate(playFrameRate);
        cineService.setCine({ id: viewportId, isPlaying: true, frameRate: playFrameRate });

        const { viewports } = viewportGridService.getState();
        const vp = viewports.get(viewportId);
        if (vp) {
          vp.displaySetInstanceUIDs.forEach(displaySetInstanceId => {
            prefetchAheadInstances(displaySetInstanceId, displaySetService);
          });
        }
      };

      const { viewports } = viewportGridService.getState();
      if (!viewports.get(viewportId)) {
        startPlay(frameRate, { monitorCache: false });
        return;
      }

      const dsets = getDisplaySets();

      // Return navigation / already cached → straight to DICOM rate.
      if (!dsets.length || dsets.every(isDisplaySetFullyCached)) {
        console.log('[cine] already cached, playing immediately at DICOM rate');
        startPlay(frameRate, { monitorCache: false });
        return;
      }

      if (shouldPlayImmediately(dsets)) {
        console.log(
          `[cine] small cine (${dsets.map(getDisplaySetFrameCount).join(',')} frames) → immediate ${frameRate}fps`
        );
        startPlay(frameRate, { monitorCache: false });
        return;
      }

      // ── Measure the frame-load rate over an initial window, then pick a
      //    safe stage-1 rate strictly below it. A longer window than a couple
      //    frames gives a stable estimate so stage 1 doesn't outrun loading. ──
      const totalFrames = dsets.reduce((sum, ds) => sum + getImageIds(ds).length, 0);
      const MIN_BUFFERED_FRAMES = 12; // sample enough frames for a stable rate
      const POLL_INTERVAL_MS = 100;
      const MAX_WAIT_MS = 20000;
      let elapsed = 0;
      let firstFrameTime: number | null = null;

      const poll = setInterval(() => {
        elapsed += POLL_INTERVAL_MS;

        const currentDsets = getDisplaySets();
        const buffered = currentDsets.reduce((sum, ds) => {
          const ids = getImageIds(ds);
          return sum + ids.filter(id => cache.isLoaded(id)).length;
        }, 0);

        if (buffered > 0 && firstFrameTime === null) {
          firstFrameTime = elapsed;
        }

        setBufferingProgress({ buffered, total: totalFrames });

        if (buffered >= MIN_BUFFERED_FRAMES || elapsed >= MAX_WAIT_MS) {
          clearInterval(poll);

          // Rate measured from first-frame arrival (excludes initial latency).
          const loadElapsed =
            firstFrameTime !== null ? (elapsed - firstFrameTime) / 1000 : elapsed / 1000;
          const observedLoadFps = loadElapsed > 0 ? buffered / loadElapsed : frameRate;

          // Safe rate: strictly below the load rate (0.8x), floored at 2fps so
          // it stays watchable, capped at the DICOM rate (never exceed it).
          const safeFrameRate = Math.min(frameRate, Math.max(2, Math.floor(observedLoadFps * 0.8)));
          console.log(
            `[cine] load rate ~${observedLoadFps.toFixed(1)}fps → stage 1 at ${safeFrameRate}fps`
          );

          startPlay(safeFrameRate);
        }
      }, POLL_INTERVAL_MS);

      fallbackTimerRef.current = poll;
    },
    [
      cancelPendingPlay,
      cineService,
      viewportId,
      enabledVPElement,
      viewportGridService,
      displaySetService,
    ]
  );

  const startPlayWhenReadyRef = useRef(startPlayWhenReady);
  useEffect(() => {
    startPlayWhenReadyRef.current = startPlayWhenReady;
  }, [startPlayWhenReady]);

  const newDisplaySetHandler = useCallback(() => {
    if (!enabledVPElement || !isCineEnabled) {
      return;
    }

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
        if (appConfig.autoPlayCine) {
          shouldAutoPlay = true;
        }
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
      // Pause first, then defer to the two-stage starter
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
    if (!isCineEnabled || !cinesRef.current?.[viewportId] || !enabledVPElement) {
      return;
    }
    const { isPlaying = false, frameRate = 24 } = cinesRef.current[viewportId];
    const validFrameRate = Math.max(frameRate, 1);
    if (isPlaying) {
      try {
        cineService.playClip(enabledVPElement, { framesPerSecond: validFrameRate, viewportId });
      } catch (e) {
        // viewport destroyed
      }
    } else {
      cineService.stopClip(enabledVPElement);
    }
  }, [isCineEnabled, enabledVPElement]);

  useEffect(() => {
    if (!enabledVPElement) {
      return;
    }

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
    if (!cines || !cines[viewportId] || !enabledVPElement || !isMountedRef.current) {
      return;
    }

    const { isPlaying = false, frameRate = 24 } = cines[viewportId];
    const validFrameRate = Math.max(frameRate, 1);
    if (isPlaying) {
      try {
        cineService.playClip(enabledVPElement, { framesPerSecond: validFrameRate, viewportId });
      } catch (e) {
        // viewport was destroyed before playClip could run
      }
    } else {
      cineService.stopClip(enabledVPElement);
    }

    return () => {
      cineService.stopClip(enabledVPElement, { viewportId });
    };
  }, [cines, viewportId, cineService, enabledVPElement]);

  if (!isCineEnabled) {
    return null;
  }

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
              Buffering {bufferingProgress.buffered} / {bufferingProgress.total} frames
            </span>
          </div>
          <style>{`
      @keyframes cinePulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.2; }
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
// RenderCinePlayer
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
    if (!dynamicInfo) {
      return;
    }

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
    if (!dynamicInfo) {
      return;
    }

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
        cineService.setCine({
          id: viewportId,
          isPlaying: false,
        });
        cineService.setIsCineEnabled(false);
        cineService.setViewportCineClosed(viewportId);
      }}
      onPlayPauseChange={isPlaying => {
        cineService.setCine({
          id: viewportId,
          isPlaying,
        });
      }}
      onFrameRateChange={frameRate =>
        cineService.setCine({
          id: viewportId,
          frameRate,
        })
      }
      dynamicInfo={dynamicInfo}
      updateDynamicInfo={updateDynamicInfo}
    />
  );
}

export default WrappedCinePlayer;
