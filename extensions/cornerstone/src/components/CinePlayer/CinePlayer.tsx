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
const PREFETCH_WINDOW = 3; // how many instances ahead to prefetch
const PREFETCH_CONCURRENCY = 20; // max parallel background requests

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

  // Cleanup pending play-on-prefetch listeners
  const cancelPendingPlay = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
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
      const startPlay = () => {
        if (!isMountedRef.current) return;
        cancelPendingPlay();
        cineService.setCine({ id: viewportId, isPlaying: true, frameRate });
      };

      // If already fully cached from background prefetch, play immediately
      const { viewports } = viewportGridService.getState();
      const viewport = viewports.get(viewportId);
      if (viewport) {
        const allCached = viewport.displaySetInstanceUIDs.every(uid => {
          const ds = displaySetService.getDisplaySetByUID(uid);
          return ds && isDisplaySetFullyCached(ds);
        });
        if (allCached) {
          console.log('[cine] already cached, playing immediately');
          startPlay();
          return;
        }
      }

      // Wait for Cornerstone's stack prefetch to complete before starting.
      // Fallback fires if the prefetch event never arrives (e.g. already cached).
      fallbackTimerRef.current = setTimeout(startPlay, 3000);

      const onPrefetchComplete = evt => {
        // Accept events with no element detail (some prefetchers omit it)
        if (evt.detail?.element && evt.detail.element !== enabledVPElement) return;
        console.log('[cine] prefetch complete, starting play');
        startPlay();
      };
      prefetchListenerRef.current = onPrefetchComplete;
      eventTarget.addEventListener('CORNERSTONE_TOOLS_STACK_PREFETCH_COMPLETE', onPrefetchComplete);
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

      // Prefetch frames for the next PREFETCH_WINDOW instances in the background
      // Delay to avoid competing with active viewport loading
      setTimeout(() => {
        prefetchAheadInstances(
          displaySetInstanceUID,
          displaySetService,
          viewportGridService,
          viewportId
        );
      }, 2000);
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
    <RenderCinePlayer
      viewportId={viewportId}
      cineService={cineService}
      newStackFrameRate={newStackFrameRate}
      isPlaying={isPlaying}
      dynamicInfo={dynamicInfo}
      customizationService={customizationService}
    />
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
