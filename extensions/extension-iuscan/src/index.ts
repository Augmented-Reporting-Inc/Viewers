import { Types } from '@ohif/core';
import { id } from './id';
import IUScanAssignmentService from './services/IUScanAssignmentService';
import StudyPrefetchService from './services/StudyPrefetchService/StudyPrefetchService';
import getSopClassHandlerModule from './sopClassHandler/getSopClassHandlerModule';
import hpIUScan from './hangingProtocols/hpIUScan';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import getPanelModule from './panels/getPanelModule';
import { MEASUREMENT_LABELS } from './utils/labelMap';

// Module-level subscription reference — survives between onModeEnter/onModeExit
// without relying on `this` binding (OHIF calls lifecycle methods unbound)
let _measurementAddedSub = null;
let _measurementUpdatedSub = null;

async function hydrateFromSeriesDoc(servicesManager, commandsManager, assignSvc) {
  let result = null;

  try {
    result = await commandsManager.runCommand('hydrateMeasurementAnnotationsForActiveStudy', {
      workflows: ['viewerMeasurements'],
      domains: ['iuscan'],
      notify: false,
    });
  } catch (error) {
    console.warn(
      '[iUSCAN] generic MeasurementAnnotations hydration threw:',
      error?.message || error
    );
    return;
  }

  if (result?.error || !result?.seriesDoc) {
    console.warn('[iUSCAN] hydration skipped: no series document resolved', {
      restoredCount: result?.restoredCount || 0,
      skippedCount: result?.skippedCount || 0,
      hasSeriesDoc: !!result?.seriesDoc,
      error: result?.error?.message || result?.error || '',
    });
    return;
  }

  const doc = result.seriesDoc;

  // Hydrate observation fields from Mongo.
  // Do not hydrate saved BWT/BWTLong/BWTCross averages into slots.
  assignSvc.hydrateFromSeriesDoc(doc);

  const canonicalRepeatedAnnotations = (
    result?.processedAnnotations ||
    result?.restoredAnnotations ||
    []
  ).filter(annotation => {
    return (
      annotation?.workflow === 'viewerMeasurements' &&
      annotation?.domain === 'iuscan' &&
      annotation?.mode === 'repeated' &&
      annotation?.repeatedMeasurement
    );
  });

  const assignedLengthMeasurements = assignSvc.hydrateCanonicalRepeatedAnnotations(
    canonicalRepeatedAnnotations
  );

  console.info('[iUSCAN] hydration complete', {
    restoredCount: result.restoredCount || 0,
    skippedCount: result.skippedCount || 0,
    processedCount: result.processedAnnotations?.length || 0,
    canonicalRepeatedCount: canonicalRepeatedAnnotations.length,
    hasSeriesDoc: true,
    assignedLengthMeasurements,
  });
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

    // Register StudyPrefetchService — used by pviewer/iuscan build to prefetch
    // all study frames before playback begins, guaranteeing stutter-free first cycle
    if (!servicesManager.services.studyPrefetchService) {
      servicesManager.services.studyPrefetchService = new StudyPrefetchService({ servicesManager });
    }
  },

  /**
   * onModeEnter: called each time mode-iuscan is entered (including study
   * switches). Wires up measurement label customizations and the
   * auto-assignment subscriber.
   */
  onModeEnter({ servicesManager, commandsManager }) {
    const { measurementService, customizationService } = servicesManager.services;
    const assignSvc = servicesManager.services.iuscanAssignmentService;

    _measurementAddedSub?.unsubscribe?.();
    _measurementAddedSub = null;

    _measurementUpdatedSub?.unsubscribe?.();
    _measurementUpdatedSub = null;

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
        if (!measurement?.label) {
          return;
        }
        assignSvc.autoAssignByLabel(measurement.uid, measurement.label);
      }
    );

    _measurementUpdatedSub = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      ({ measurement }) => {
        if (!measurement?.label) {
          return;
        }
        // Only auto-assign if not already assigned anywhere
        const state = assignSvc.getFullState();
        const alreadyAssigned = Object.values(state).some(site =>
          ['longitudinal', 'cross'].some(axis =>
            site[axis].slots.some(slot => {
              if (slot === measurement.uid) {
                return true;
              }

              return (
                slot &&
                typeof slot === 'object' &&
                (slot.uid === measurement.uid || slot.annotationId === measurement.uid)
              );
            })
          )
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
    hydrateFromSeriesDoc(servicesManager, commandsManager, assignSvc).catch(e => {
      console.warn('[iUSCAN] hydrateFromSeriesDoc failed:', e?.message || e);
    });
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
