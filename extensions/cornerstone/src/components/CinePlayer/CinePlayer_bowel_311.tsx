import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useCine } from '@ohif/ui-next';
import { Enums, eventTarget, cache, imageLoader } from '@cornerstonejs/core';
import { useAppConfig } from '@state';

// ---------------------------------------------------------------------------
// Instance prefetch utility
// Prefetches frames for the next WINDOW_SIZE displaySets in the same series,
// using a low-concurrency background queue so it doesn't compete with the
// active viewport's loading.
// ---------------------------------------------------------------------------
const PREFETCH_WINDOW = 0; // how many instances ahead to prefetch - 1 for echo, 0 for bowel
const PREFETCH_CONCURRENCY = 4; // max parallel background requests - 20 for echo, 4 for bowel

const activeBackgroundRequests = new Set<string>();

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

async function prefetchDisplaySetFrames(displaySet): Promise<void> {
  const imageIds = getImageIds(displaySet);
  if (!imageIds.length) return;

  // Fire in batches of PREFETCH_CONCURRENCY
  for (let i = 0; i < imageIds.length; i += PREFETCH_CONCURRENCY) {
    const batch = imageIds
      .slice(i, i + PREFETCH_CONCURRENCY)
      .filter(id => !cache.isLoaded(id) && !activeBackgroundRequests.has(id));
    if (!batch.length) continue;

    batch.forEach(id => activeBackgroundRequests.add(id));
    await Promise.all(
      batch.map(id =>
        imageLoader
          .loadAndCacheImage(id, {})
          .catch(() => {})
          .finally(() => activeBackgroundRequests.delete(id))
      )
    );
  }
}

function prefetchAheadInstances(
  currentDisplaySetUID: string,
  displaySetService,
  viewportGridService,
  viewportId: string
): void {
  // Get all displaySets in the study, ordered by series/instance number
  const allDisplaySets = (displaySetService.activeDisplaySets ?? [])
    .filter(ds => ds.numImageFrames > 1) // only multiframe instances
    .sort((a, b) => {
      // Sort by InstanceNumber if available, else by displaySetInstanceUID
      const aNum = a.InstanceNumber ?? a.displaySetInstanceUID;
      const bNum = b.InstanceNumber ?? b.displaySetInstanceUID;
      return aNum < bNum ? -1 : aNum > bNum ? 1 : 0;
    });

  const currentIdx = allDisplaySets.findIndex(
    ds => ds.displaySetInstanceUID === currentDisplaySetUID
  );

  if (currentIdx === -1) return;

  const toPreetch = allDisplaySets
    .slice(currentIdx + 1, currentIdx + 1 + PREFETCH_WINDOW)
    .filter(ds => !isDisplaySetFullyCached(ds));

  if (toPreetch.length) {
    console.log(
      `[cine] prefetching ${toPreetch.length} ahead instances:`,
      toPreetch.map(ds => ds.displaySetInstanceUID)
    );
  }

  // Process instances sequentially so early instances don't starve later ones
  (async () => {
    for (const ds of toPreetch) {
      await prefetchDisplaySetFrames(ds);
    }
  })();
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
  const prefetchListenerRef = useRef(null);
  const fallbackTimerRef = useRef(null);
  const cinesRef = useRef(cines);
  const [bufferingProgress, setBufferingProgress] = useState<{
    buffered: number;
    total: number;
  } | null>(null);
  const originalFrameRateRef = useRef<number>(24);
  const cacheMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentRateRef = useRef<number>(24);

  // Cleanup pending play-on-prefetch listeners
  const cancelPendingPlay = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (cacheMonitorRef.current) {
      clearInterval(cacheMonitorRef.current);
      cacheMonitorRef.current = null;
    }
    if (prefetchListenerRef.current) {
      eventTarget.removeEventListener(
        'CORNERSTONE_TOOLS_STACK_PREFETCH_COMPLETE',
        prefetchListenerRef.current
      );
      prefetchListenerRef.current = null;
    }
  }, []);

  const startPlayWhenReady = useCallback(
    (frameRate: number) => {
      cancelPendingPlay();

      const startPlay = (playFrameRate: number = frameRate) => {
        if (!isMountedRef.current) return;
        cancelPendingPlay();

        currentRateRef.current = playFrameRate;

        // Monitor cache — clear pill and restore frame rate when fully loaded.
        // Started unconditionally so the pill persists until all frames are cached
        // regardless of whether the frame rate was capped.
        originalFrameRateRef.current = frameRate;
        if (cacheMonitorRef.current) clearInterval(cacheMonitorRef.current);

        cacheMonitorRef.current = setInterval(() => {
          const dsets = getDisplaySets();
          if (!dsets.length) return;

          const totalCached = dsets.reduce((sum, ds) => {
            const ids = getImageIds(ds);
            return sum + ids.filter(id => cache.isLoaded(id)).length;
          }, 0);
          const totalFrames = dsets.reduce((sum, ds) => sum + getImageIds(ds).length, 0);

          // Update buffering pill
          setBufferingProgress({ buffered: totalCached, total: totalFrames });

          // Ramp frame rate based on cache fill fraction
          const cachedFraction = totalFrames > 0 ? totalCached / totalFrames : 0;
          const rampedRate = Math.floor(
            playFrameRate + (frameRate - playFrameRate) * Math.pow(cachedFraction, 0.7)
          );
          const newRate = Math.min(frameRate, Math.max(playFrameRate, rampedRate));

          // Only update if rate has meaningfully changed (avoid thrashing on tiny increments)
          if (newRate > playFrameRate && newRate !== currentRateRef.current) {
            currentRateRef.current = newRate;
            setNewStackFrameRate(newRate);
            cineService.setCine({ id: viewportId, isPlaying: true, frameRate: newRate });
            console.log(
              `[cine] cache ${Math.round(cachedFraction * 100)}%, ramping to ${newRate}fps`
            );
          }

          if (dsets.every(isDisplaySetFullyCached)) {
            clearInterval(cacheMonitorRef.current!);
            cacheMonitorRef.current = null;
            if (!isMountedRef.current) return;
            setBufferingProgress(null);
            // Ensure final rate is exactly the DICOM rate
            setNewStackFrameRate(frameRate);
            cineService.setCine({ id: viewportId, isPlaying: true, frameRate });
            console.log(`[cine] fully cached, final frame rate ${frameRate}fps`);
          }
        }, 500);

        setNewStackFrameRate(playFrameRate);
        cineService.setCine({ id: viewportId, isPlaying: true, frameRate: playFrameRate });
        const { viewports } = viewportGridService.getState();
        const vp = viewports.get(viewportId);
        if (vp) {
          vp.displaySetInstanceUIDs.forEach(uid => {
            prefetchAheadInstances(uid, displaySetService, viewportGridService, viewportId);
          });
        }
      };

      const { viewports } = viewportGridService.getState();
      if (!viewports.get(viewportId)) {
        startPlay();
        return;
      }

      const getDisplaySets = () => {
        const { viewports } = viewportGridService.getState();
        const vp = viewports.get(viewportId);
        if (!vp) return [];
        return vp.displaySetInstanceUIDs
          .map(uid => displaySetService.getDisplaySetByUID(uid))
          .filter(Boolean);
      };

      // If already cached, play immediately
      if (getDisplaySets().every(isDisplaySetFullyCached)) {
        console.log('[cine] already cached, playing immediately');
        startPlay();
        return;
      }

      // Poll cache until enough frames are buffered, then play
      const dsets = getDisplaySets();
      const totalFrames = dsets.reduce((sum, ds) => sum + getImageIds(ds).length, 0);
      const MIN_BUFFERED_FRAMES = 3; // just enough to start — overlay covers the wait
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
        console.log(`[cine] buffered ${buffered}/${totalFrames} frames`);

        if (buffered >= MIN_BUFFERED_FRAMES || elapsed >= MAX_WAIT_MS) {
          clearInterval(poll);

          // Estimate load rate from when first frame arrived, not from poll start,
          // to avoid inflating elapsed with initial Orthanc response latency
          const loadElapsed =
            firstFrameTime !== null ? (elapsed - firstFrameTime) / 1000 : elapsed / 1000;
          const observedLoadFps = loadElapsed > 0 ? buffered / loadElapsed : frameRate;
          const safeFrameRate = Math.min(frameRate, Math.max(8, Math.floor(observedLoadFps * 0.9)));
          console.log(
            `[cine] load rate ~${observedLoadFps.toFixed(1)}fps, playing at ${safeFrameRate}fps`
          );

          startPlay(safeFrameRate);
        }
      }, POLL_INTERVAL_MS);

      fallbackTimerRef.current = poll as unknown as ReturnType<typeof setTimeout>;
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
      // Set paused first, then defer until prefetch completes
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
              &nbsp;·&nbsp; 1st cycle warm-up
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
