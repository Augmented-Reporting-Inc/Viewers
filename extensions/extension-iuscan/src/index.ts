import { Types } from '@ohif/core';
import { id } from './id';
import IUScanAssignmentService from './services/IUScanAssignmentService';
import getSopClassHandlerModule from './sopClassHandler/getSopClassHandlerModule';
import hpIUScan from './hangingProtocols/hpIUScan';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import getPanelModule from './panels/getPanelModule';

// Measurement label list — kept in one place, referenced by both
// onModeEnter (registration) and the assignment service label map.
const MEASUREMENT_LABELS = [
  { value: 'SC-Long', label: 'Sigmoid Colon – Long' },
  { value: 'SC-Cross', label: 'Sigmoid Colon – Cross' },
  { value: 'DC-Long', label: 'Descending Colon – Long' },
  { value: 'DC-Cross', label: 'Descending Colon – Cross' },
  { value: 'TC-Long', label: 'Transverse Colon – Long' },
  { value: 'TC-Cross', label: 'Transverse Colon – Cross' },
  { value: 'AC-Long', label: 'Ascending Colon – Long' },
  { value: 'AC-Cross', label: 'Ascending Colon – Cross' },
  { value: 'TI-Long', label: 'Terminal Ileum – Long' },
  { value: 'TI-Cross', label: 'Terminal Ileum – Cross' },
  { value: 'ICA-Long', label: 'Ileocolic Anastomosis – Long' },
  { value: 'ICA-Cross', label: 'Ileocolic Anastomosis – Cross' },
  { value: 'NTI-Long', label: 'Neo-terminal Ileum – Long' },
  { value: 'NTI-Cross', label: 'Neo-terminal Ileum – Cross' },
];

// Module-level subscription reference — survives between onModeEnter/onModeExit
// without relying on `this` binding (OHIF calls lifecycle methods unbound)
let _measurementAddedSub = null;
let _measurementUpdatedSub = null;

async function hydrateFromSeriesDoc(servicesManager, assignSvc) {
  const { viewportGridService, displaySetService } = servicesManager.services;
  await new Promise(resolve => setTimeout(resolve, 200));
  const gridState = viewportGridService.getState();
  const { activeViewportId, viewports } = gridState;
  const activeVP = viewports?.get?.(activeViewportId) ?? viewports?.[activeViewportId];
  const dsUID = activeVP?.displaySetInstanceUIDs?.[0];
  if (!dsUID) return;
  const ds = displaySetService.getDisplaySetByUID(dsUID);
  const studyUID = ds?.StudyInstanceUID;
  if (!studyUID) return;
  const res = await fetch(`/formapi/api/series/study/${studyUID}`, { credentials: 'include' });
  if (!res.ok) return;
  const doc = await res.json();
  assignSvc.hydrateFromSeriesDoc(doc);
}

const iuscanExtension = {
  id,

  // ── Lifecycle hooks ─────────────────────────────────────────────────────────

  /**
   * preRegistration: runs once on app init before any mode loads.
   * Register IUScanAssignmentService here so it is available to all
   * components regardless of which mode is active.
   */
  preRegistration({ servicesManager }) {
    servicesManager.registerService(IUScanAssignmentService.REGISTRATION);
  },

  /**
   * onModeEnter: called each time mode-iuscan is entered (including study
   * switches). Wires up measurement label customizations and the
   * auto-assignment subscriber.
   */
  onModeEnter({ servicesManager }) {
    const { measurementService, customizationService } = servicesManager.services;
    const assignSvc = servicesManager.services.iuscanAssignmentService;

    // Clear previous study's state
    assignSvc.clearAll();

    // Register anatomical label list — shown after each caliper is drawn.
    // Clinician selects the label → MEASUREMENT_ADDED subscriber auto-assigns.
    customizationService.setCustomizations(
      {
        measurementLabels: {
          $set: {
            labelOnMeasure: true,
            exclusive: false,
            items: MEASUREMENT_LABELS,
          },
        },
      },
      customizationService.Scope.Mode
    );

    // Auto-assign labelled calipers to the correct (site, axis, slot)
    _measurementAddedSub = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_ADDED,
      ({ measurement }) => {
        if (!measurement?.label) return;
        assignSvc.autoAssignByLabel(measurement.uid, measurement.label);
      }
    );

    _measurementUpdatedSub = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      ({ measurement }) => {
        if (!measurement?.label) return;
        // Only auto-assign if not already assigned anywhere
        const state = assignSvc.getFullState();
        const alreadyAssigned = Object.values(state).some(site =>
          ['longitudinal', 'cross'].some(axis => site[axis].slots.some(s => s === measurement.uid))
        );

        if (!alreadyAssigned) {
          assignSvc.autoAssignByLabel(measurement.uid, measurement.label);
          // Directly open the panel after assignment
          const { panelService } = servicesManager.services;
          panelService.activatePanel('extension-iuscan.panelModule.iuscanMeasurements', true);
        }
      }
    );

    // Pre-populate panel from any existing Bowel* fields in the series doc.
    // Non-fatal: silently skipped if the study isn't yet linked to a series doc.
    hydrateFromSeriesDoc(servicesManager, assignSvc).catch(e =>
      console.warn('[iUSCAN] hydrateFromSeriesDoc (non-fatal):', e.message)
    );
  },

  /**
   * onModeExit: clean up subscriptions and mode-specific customizations.
   * Called BEFORE mode-level cleanup, so service state is still accessible.
   */
  onModeExit({ servicesManager }) {
    const { customizationService } = servicesManager.services;
    const assignSvc = servicesManager.services.iuscanAssignmentService;

    // Unsubscribe MEASUREMENT_ADDED listener
    _measurementAddedSub?.unsubscribe?.();
    _measurementAddedSub = null;

    _measurementUpdatedSub?.unsubscribe?.();
    _measurementUpdatedSub = null;

    // Remove our mode-specific label customizations so they don't leak
    // into the longitudinal or stress-echo modes
    customizationService.onModeExit();

    // Clear assignment state (clean slate for next study)
    assignSvc.clearAll();
  },

  // ── Modules ─────────────────────────────────────────────────────────────────

  getSopClassHandlerModule,

  getHangingProtocolModule() {
    return [{ name: 'hpIUScan', protocol: hpIUScan }];
  },

  getCommandsModule,

  getToolbarModule,

  getPanelModule,
};

export default iuscanExtension as Types.Extensions.Extension;
