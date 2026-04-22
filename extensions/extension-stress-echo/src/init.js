import { addTool } from '@cornerstonejs/tools';
import { utilities } from '@cornerstonejs/core';
import CardiacSyncService from './services/CardiacSyncService';
import measurementServiceMappingsFactory from './utils/measurementServiceMappings/measurementServiceMappingsFactory';
import colormaps from './utils/colormaps';

const { registerColormap } = utilities.colormap;
const CORNERSTONE_3D_TOOLS_SOURCE_NAME = 'Cornerstone3DTools';
const CORNERSTONE_3D_TOOLS_SOURCE_VERSION = '0.1';

export default function init({ servicesManager, extensionManager }) {
  const { measurementService, displaySetService, cornerstoneViewportService, viewportGridService } =
    servicesManager.services;

  if (!servicesManager.services.cardiacSyncService) {
    servicesManager.services.cardiacSyncService = new CardiacSyncService({ servicesManager });
    console.log(
      '[stress-echo] cardiacSyncService registered:',
      servicesManager.services.cardiacSyncService
    );
  }

  // ── Register/re-register stages ───────────────────────────────────────────
  const _registerStages = () => {
    try {
      const svc = servicesManager.services.cardiacSyncService;
      if (!svc) return;
      svc.clearStages();
      const { viewports } = viewportGridService.getState();
      viewports.forEach((viewport, viewportId) => {
        const { displaySetInstanceUIDs } = viewport;
        if (!displaySetInstanceUIDs?.length) return;
        const ds = displaySetService.getDisplaySetByUID(displaySetInstanceUIDs[0]);
        if (!ds?.HeartRate || !ds?.numImageFrames) return;
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
      console.warn('[stress-echo] sync init failed:', e);
    }
  };

  setTimeout(_registerStages, 3000);

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () =>
    setTimeout(_registerStages, 500)
  );

  const csTools3DVer1MeasurementSource = measurementService.getSource(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );

  colormaps.forEach(registerColormap);
}
