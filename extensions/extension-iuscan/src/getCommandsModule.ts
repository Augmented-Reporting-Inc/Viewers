/**
 * Commands registered by extension-iuscan.
 *
 * exportIUScanReport   — builds PUT body from assignment state, saves to formapi
 * clearIUScanMeasurements — clears assignment state and MeasurementService
 *
 * Both commands are also wired to keyboard hotkeys in mode-iuscan/src/index.js.
 */
export default function getCommandsModule({ servicesManager, commandsManager }) {
  const { measurementService, uiNotificationService, viewportGridService, displaySetService } =
    servicesManager.services;

  return {
    defaultContext: 'ACTIVE_VIEWPORT::CORNERSTONE',

    definitions: {
      exportIUScanReport: {
        commandFn: async () => {
          const assignSvc = servicesManager.services.iuscanAssignmentService;

          if (!assignSvc.hasAnyAssignment()) {
            uiNotificationService.show({
              title: 'iUSCAN',
              message: 'No measurements to export.',
              type: 'warning',
              duration: 3000,
            });
            return;
          }

          // Resolve StudyInstanceUID from the active viewport's display set
          let studyUID = null;
          try {
            const { activeViewportId, viewports } = viewportGridService.getState();
            const activeVP = viewports.get?.(activeViewportId) ?? viewports[activeViewportId];
            const dsUID = activeVP?.displaySetInstanceUIDs?.[0];
            if (dsUID) {
              const ds = displaySetService.getDisplaySetByUID(dsUID);
              studyUID = ds?.StudyInstanceUID;
            }
          } catch (e) {
            console.warn('[iUSCAN] Could not resolve StudyInstanceUID:', e.message);
          }

          if (!studyUID) {
            uiNotificationService.show({
              title: 'iUSCAN',
              message: 'Cannot determine active study. Please ensure a series is displayed.',
              type: 'error',
              duration: 4000,
            });
            return;
          }

          const payload = assignSvc.buildReportPayload(measurementService);

          try {
            // Step 1: look up Mongo _id by StudyInstanceUID
            const seriesRes = await fetch(`/formapi/api/series/study/${studyUID}`, {
              credentials: 'include',
            });
            if (!seriesRes.ok) {
              throw new Error(`Series lookup failed: ${seriesRes.status}`);
            }
            const seriesDoc = await seriesRes.json();

            // Step 2: PUT measurements to the series document
            const putRes = await fetch(`/formapi/api/series/${seriesDoc._id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(payload),
            });
            if (!putRes.ok) {
              throw new Error(`Save failed: ${putRes.status}`);
            }

            uiNotificationService.show({
              title: 'iUSCAN',
              message: 'Measurements saved to report.',
              type: 'success',
              duration: 3000,
            });
          } catch (err) {
            console.error('[iUSCAN] exportIUScanReport error:', err);
            uiNotificationService.show({
              title: 'iUSCAN',
              message: `Export failed: ${err.message}`,
              type: 'error',
              duration: 5000,
            });
          }
        },
      },

      clearIUScanMeasurements: {
        commandFn: () => {
          const assignSvc = servicesManager.services.iuscanAssignmentService;
          assignSvc.clearAll();
          measurementService.clearMeasurements();
          uiNotificationService.show({
            title: 'iUSCAN',
            message: 'All measurements cleared.',
            type: 'info',
            duration: 2000,
          });
        },
      },
    },
  };
}
