import { utilities } from '@cornerstonejs/core';

import CardiacSyncService from './services/CardiacSyncService';
import colormaps from './utils/colormaps';

const { registerColormap } = utilities.colormap;

export default function init({ servicesManager }) {
  const { displaySetService, viewportGridService } = servicesManager.services;

  if (!servicesManager.services.cardiacSyncService) {
    servicesManager.services.cardiacSyncService = new CardiacSyncService({ servicesManager });
    console.log(
      '[dobutamine] cardiacSyncService registered:',
      servicesManager.services.cardiacSyncService
    );
  } else {
    console.log(
      '[dobutamine] reusing cardiacSyncService:',
      servicesManager.services.cardiacSyncService
    );
  }

  // ── Register/re-register stages ───────────────────────────────────────────
  const _registerStages = () => {
    try {
      const svc = servicesManager.services.cardiacSyncService;
      if (!svc) {
        return;
      }
      svc.clearStages();
      const { viewports } = viewportGridService.getState();
      viewports.forEach((viewport, viewportId) => {
        const { displaySetInstanceUIDs } = viewport;
        if (!displaySetInstanceUIDs?.length) {
          return;
        }
        const ds = displaySetService.getDisplaySetByUID(displaySetInstanceUIDs[0]);
        if (!ds?.HeartRate || !ds?.numImageFrames) {
          return;
        }
        const frameTime =
          ds.FrameTime ??
          Math.round(((60 / Number(ds.HeartRate)) * 1000) / Number(ds.numImageFrames));
        svc.registerStage(viewportId, {
          HeartRate: ds.HeartRate,
          FrameTime: frameTime,
          numImageFrames: ds.numImageFrames,
          StageName: ds.StageName,
          StageNumber: ds.StageNumber,
          ViewName: ds.ViewName,
        });
      });
      if (!svc.getState().isPlaying) {
        svc.setSyncEnabled(true);
        svc.play();
      }
    } catch (e) {
      console.warn('[dobutamine] sync init failed:', e);
    }
  };

  setTimeout(_registerStages, 3000);

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () =>
    setTimeout(_registerStages, 500)
  );

  colormaps.forEach(registerColormap);
}
