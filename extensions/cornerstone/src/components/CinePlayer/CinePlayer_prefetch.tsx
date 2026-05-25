import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useCine } from '@ohif/ui-next';
import { Enums, eventTarget, cache, imageLoader } from '@cornerstonejs/core';
import { useAppConfig } from '@state';

// ---------------------------------------------------------------------------
// Certification viewer: prefetch ALL instances on load before playing anything.
// The reader does not interact with the viewer until the study is fully cached.
// ---------------------------------------------------------------------------
const PREFETCH_CONCURRENCY = 12; // fills idle Orthanc threads (32 total - 20 interaction = 12)

const STUDY_PREFETCH_PROGRESS_EVENT = 'cine:studyPrefetchProgress';

const activeBackgroundRequests = new Set<string>();

// Module-level state — survives React re-renders, resets on true unmount only.
let studyPrefetchInProgress = false;
let onStudyFullyCached: (() => void) | null = null;

function getImageIds(displaySet): string[] {
  const ids = displaySet.imageIds ?? displaySet.images?.map(img => img.imageId ?? img.url) ?? [];
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

async function prefetchDisplaySetFrames(displaySet, onFrameCached?: () => void): Promise<void> {
  const imageIds = getImageIds(displaySet);
  if (!imageIds.length) return;

  for (let i = 0; i < imageIds.length; i += PREFETCH_CONCURRENCY) {
    const batch = imageIds
      .slice(i, i + PREFETCH_CONCURRENCY)
      .filter(id => !cache.isLoaded(id) && !activeBackgroundRequests.has(id));

    if (!batch.length) {
      onFrameCached && imageIds.slice(i, i + PREFETCH_CONCURRENCY).forEach(() => onFrameCached());
      continue;
    }

    batch.forEach(id => activeBackgroundRequests.add(id));
    await Promise.all(
      batch.map(id =>
        imageLoader
          .loadAndCacheImage(id, {})
          .catch(() => {})
          .finally(() => {
            activeBackgroundRequests.delete(id);
            onFrameCached && onFrameCached();
          })
      )
    );
  }
}

function prefetchEntireStudy(displaySetService): void {
  if (studyPrefetchInProgress) return;

  const allDisplaySets = (displaySetService.activeDisplaySets ?? [])
    .filter(ds => ds.numImageFrames > 1)
    .sort((a, b) => {
      const aNum = a.InstanceNumber ?? a.displaySetInstanceUID;
      const bNum = b.InstanceNumber ?? b.displaySetInstanceUID;
      return aNum < bNum ? -1 : aNum > bNum ? 1 : 0;
    });

  const toPrefetch = allDisplaySets.filter(ds => !isDisplaySetFullyCached(ds));

  if (!toPrefetch.length) {
    console.log('[cine] entire study already cached');
    window.dispatchEvent(
      new CustomEvent(STUDY_PREFETCH_PROGRESS_EVENT, {
        detail: { cached: 0, total: 0, done: true },
      })
    );
    onStudyFullyCached?.();
    return;
  }

  const totalFrames = toPrefetch.reduce((sum, ds) => sum + getImageIds(ds).length, 0);
  let cachedFrames = 0;

  console.log(
    `[cine] prefetching entire study: ${toPrefetch.length} instances, ${totalFrames} frames`
  );

  window.dispatchEvent(
    new CustomEvent(STUDY_PREFETCH_PROGRESS_EVENT, {
      detail: { cached: 0, total: totalFrames, done: false },
    })
  );

  studyPrefetchInProgress = true;

  (async () => {
    for (const ds of toPrefetch) {
      await prefetchDisplaySetFrames(ds, () => {
        cachedFrames++;
        if (cachedFrames % 50 === 0 || cachedFrames === totalFrames) {
          window.dispatchEvent(
            new CustomEvent(STUDY_PREFETCH_PROGRESS_EVENT, {
              detail: {
                cached: cachedFrames,
                total: totalFrames,
                done: cachedFrames >= totalFrames,
              },
            })
          );
        }
      });
    }

    studyPrefetchInProgress = false;
    console.log(`[cine] study fully prefetched: ${cachedFrames}/${totalFrames} frames`);

    window.dispatchEvent(
      new CustomEvent(STUDY_PREFETCH_PROGRESS_EVENT, {
        detail: { cached: totalFrames, total: totalFrames, done: true },
      })
    );

    onStudyFullyCached?.();
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
  const cinesRef = useRef(cines);
  const studyReadyRef = useRef(false);
  const pendingFrameRateRef = useRef<number>(24);

  const [studyPrefetchProgress, setStudyPrefetchProgress] = useState<{
    cached: number;
    total: number;
  } | null>(null);

  // Keep cinesRef current without triggering re-renders
  useEffect(() => {
    cinesRef.current = cines;
  }, [cines]);

  // ---------------------------------------------------------------------------
  // Play current instance — only called after study is fully cached
  // ---------------------------------------------------------------------------
  const playCurrentInstance = useCallback(
    (frameRate: number) => {
      if (!isMountedRef.current) return;
      setNewStackFrameRate(frameRate);
      cineService.setCine({ id: viewportId, isPlaying: true, frameRate });
    },
    [cineService, viewportId]
  );

  // ---------------------------------------------------------------------------
  // Study prefetch progress listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handler = (evt: CustomEvent) => {
      if (!isMountedRef.current) return;
      const { cached, total, done } = evt.detail;
      if (done || total === 0) {
        setStudyPrefetchProgress(null);
      } else {
        setStudyPrefetchProgress({ cached, total });
      }
    };
    window.addEventListener(STUDY_PREFETCH_PROGRESS_EVENT, handler as EventListener);
    return () =>
      window.removeEventListener(STUDY_PREFETCH_PROGRESS_EVENT, handler as EventListener);
  }, []); // empty deps — register once only

  // ---------------------------------------------------------------------------
  // Core display set handler — called on mount and on VIEWPORT_NEW_IMAGE_SET
  // Uses refs for everything to avoid stale closures without re-creating the fn
  // ---------------------------------------------------------------------------
  const displaySetServiceRef = useRef(displaySetService);
  const viewportGridServiceRef = useRef(viewportGridService);
  const cineServiceRef = useRef(cineService);
  const playCurrentInstanceRef = useRef(playCurrentInstance);

  useEffect(() => {
    displaySetServiceRef.current = displaySetService;
  }, [displaySetService]);
  useEffect(() => {
    viewportGridServiceRef.current = viewportGridService;
  }, [viewportGridService]);
  useEffect(() => {
    cineServiceRef.current = cineService;
  }, [cineService]);
  useEffect(() => {
    playCurrentInstanceRef.current = playCurrentInstance;
  }, [playCurrentInstance]);

  // Stable handler — no deps that change, uses refs internally
  const newDisplaySetHandler = useCallback(() => {
    if (!enabledVPElement || !isCineEnabled) return;

    const { viewports } = viewportGridServiceRef.current.getState();
    const viewport = viewports.get(viewportId);
    if (!viewport) return;

    const { displaySetInstanceUIDs } = viewport;
    let frameRate = 24;

    displaySetInstanceUIDs.forEach(uid => {
      const displaySet = displaySetServiceRef.current.getDisplaySetByUID(uid);
      if (!displaySet) return;

      const EffectiveFrameRate =
        displaySet.numImageFrames && displaySet.EffectiveDuration
          ? displaySet.numImageFrames / displaySet.EffectiveDuration
          : null;

      if (displaySet.FrameRate || EffectiveFrameRate) {
        frameRate = displaySet.FrameRate
          ? Math.round(1000 / displaySet.FrameRate)
          : Math.round(EffectiveFrameRate);
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
    pendingFrameRateRef.current = frameRate;
    cineServiceRef.current.setIsCineEnabled(true);

    if (studyReadyRef.current) {
      // Study already cached — play immediately
      playCurrentInstanceRef.current(frameRate);
    } else {
      // Keep paused — wait for study prefetch to complete
      cineServiceRef.current.setCine({ id: viewportId, isPlaying: false, frameRate });

      // Register callback for when prefetch completes
      onStudyFullyCached = () => {
        if (!isMountedRef.current) return;
        studyReadyRef.current = true;
        setStudyPrefetchProgress(null);
        console.log('[cine] study ready — starting playback');
        playCurrentInstanceRef.current(pendingFrameRateRef.current);
      };

      // Start prefetch — guard prevents restarts on repeated calls
      prefetchEntireStudy(displaySetServiceRef.current);
    }
    // Intentionally minimal deps — viewportId and isCineEnabled are the only
    // true triggers; everything else accessed via stable refs
  }, [viewportId, isCineEnabled, enabledVPElement]);

  // ---------------------------------------------------------------------------
  // Mount / unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!enabledVPElement) return;

    isMountedRef.current = true;
    newDisplaySetHandler();

    enabledVPElement.addEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, newDisplaySetHandler);
    enabledVPElement.addEventListener(
      Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME,
      newDisplaySetHandler
    );

    return () => {
      // True unmount — reset all module-level state
      studyPrefetchInProgress = false;
      onStudyFullyCached = null;
      studyReadyRef.current = false;
      isMountedRef.current = false;

      cineService.stopClip(enabledVPElement);
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
  }, [enabledVPElement, newDisplaySetHandler, viewportId, cineService]);

  // ---------------------------------------------------------------------------
  // Respond to cine state changes (play/pause from UI controls)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!cines || !cines[viewportId] || !enabledVPElement || !isMountedRef.current) return;

    const { isPlaying = false, frameRate = 24 } = cines[viewportId];
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

    return () => {
      cineService.stopClip(enabledVPElement, { viewportId });
    };
  }, [cines, viewportId, cineService, enabledVPElement]);

  if (!isCineEnabled) return null;

  const cine = cines[viewportId];
  const isPlaying = cine?.isPlaying || false;

  const studyPct = studyPrefetchProgress
    ? Math.round((studyPrefetchProgress.cached / studyPrefetchProgress.total) * 100)
    : null;

  return (
    <>
      {studyPrefetchProgress && studyPct !== null && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{ top: '140px', width: '280px' }}
        >
          <div className="rounded-lg bg-black/80 px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-xs text-white/90">
              <span className="flex items-center gap-1.5 font-medium">
                <span
                  className="inline-block h-2 w-2 rounded-full bg-blue-400"
                  style={{ animation: 'cinePulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite' }}
                />
                Loading study for playback
              </span>
              <span className="font-mono text-white/70">{studyPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-blue-400 transition-all duration-500"
                style={{ width: `${studyPct}%` }}
              />
            </div>
            <div className="mt-1.5 text-center text-xs text-white/40">
              {studyPrefetchProgress.cached.toLocaleString()} /{' '}
              {studyPrefetchProgress.total.toLocaleString()} frames &nbsp;·&nbsp; playback starts
              when complete
            </div>
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
    return () =>
      eventTarget.removeEventListener(
        Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED,
        handleDimensionGroupChange
      );
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
      onPlayPauseChange={isPlaying => cineService.setCine({ id: viewportId, isPlaying })}
      onFrameRateChange={frameRate => cineService.setCine({ id: viewportId, frameRate })}
      dynamicInfo={dynamicInfo}
      updateDynamicInfo={updateDynamicInfo}
    />
  );
}

export default WrappedCinePlayer;
