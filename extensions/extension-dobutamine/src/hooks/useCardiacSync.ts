import { useEffect, useRef } from 'react';
import type { StageTimingMeta } from '../services/CardiacSyncService';

/**
 * Registers a stress-echo viewport with CardiacSyncService when its displaySet
 * metadata is ready, and unregisters it on unmount or when sync is disabled.
 *
 * Receives servicesManager as a prop (matching the pattern already used in
 * StressEchoViewport) rather than relying on a React context hook.
 *
 * The meta object should be built directly from displaySet attributes, which
 * are promoted from DICOM instance tags in getSopClassHandlerModule:
 *
 *   const meta = {
 *     HeartRate:      displaySet.HeartRate,
 *     FrameTime:      displaySet.FrameTime,
 *     numImageFrames: displaySet.numImageFrames,
 *     StageName:      displaySet.StageName,
 *     StageNumber:    displaySet.StageNumber,
 *     ViewName:       displaySet.ViewName,
 *   };
 */
export function useCardiacSync(
  viewportId: string,
  meta: StageTimingMeta | null,
  isSyncEnabled: boolean,
  servicesManager: any
): void {
  const registeredRef = useRef(false);

  useEffect(() => {
    const { cardiacSyncService } = servicesManager.services;

    const shouldRegister =
      isSyncEnabled &&
      !!viewportId &&
      !!meta &&
      !!meta.HeartRate &&
      !!meta.FrameTime &&
      !!meta.numImageFrames;

    if (!shouldRegister) {
      if (registeredRef.current) {
        cardiacSyncService?.unregisterStage(viewportId);
        registeredRef.current = false;
      }
      return;
    }

    cardiacSyncService?.registerStage(viewportId, meta);
    registeredRef.current = true;

    return () => {
      cardiacSyncService?.unregisterStage(viewportId);
      registeredRef.current = false;
    };
  }, [
    viewportId,
    meta?.HeartRate,
    meta?.FrameTime,
    meta?.numImageFrames,
    isSyncEnabled,
    servicesManager,
  ]);
  //             ^^ use stable scalar deps rather than the object ref
  //                to avoid spurious re-registrations
}
