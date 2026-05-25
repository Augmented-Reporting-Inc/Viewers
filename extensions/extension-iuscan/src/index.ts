import { Types } from '@ohif/core';
import { id } from './id';
import IUScanAssignmentService from './services/IUScanAssignmentService';
import getSopClassHandlerModule from './sopClassHandler/getSopClassHandlerModule';
import hpIUScan from './hangingProtocols/hpIUScan';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import getPanelModule from './panels/getPanelModule';
import { annotation as csToolsAnnotation } from '@cornerstonejs/tools';
import { MEASUREMENT_LABELS } from './utils/labelMap';

// Module-level subscription reference — survives between onModeEnter/onModeExit
// without relying on `this` binding (OHIF calls lifecycle methods unbound)
let _measurementAddedSub = null;
let _measurementUpdatedSub = null;

async function hydrateFromSeriesDoc(servicesManager, assignSvc) {
  const { viewportGridService, displaySetService } = servicesManager.services;

  // Poll for active viewport — it takes a few frames after onModeEnter
  // for the viewport grid to be populated. Poll up to 20 times at 100ms intervals.
  let dsUID = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const { activeViewportId, viewports } = viewportGridService.getState();
    const activeVP = viewports?.get?.(activeViewportId) ?? viewports?.[activeViewportId];
    dsUID = activeVP?.displaySetInstanceUIDs?.[0];
    if (dsUID) break;
  }
  if (!dsUID) {
    console.warn('[iUSCAN] hydrateFromSeriesDoc: no active viewport after polling');
    return;
  }

  const ds = displaySetService.getDisplaySetByUID(dsUID);
  const studyUID = ds?.StudyInstanceUID;
  if (!studyUID) return;

  const res = await fetch(`/formapi/api/series/study/${studyUID}`, { credentials: 'include' });
  if (!res.ok) return;
  const doc = await res.json();

  // Hydrate observation fields from Mongo first.
  // Do not hydrate saved BWT/BWTLong/BWTCross averages into assignment slots.
  // Slots should represent actual restored caliper annotations only.
  assignSvc.hydrateFromSeriesDoc(doc);

  // If full annotation state is stored, restore it — gives per-caliper restoration
  // with live UIDs, click-to-jump, and all 3 slots independently.
  if (doc.IUScanAnnotations) {
    try {
      await restoreAnnotations(doc.IUScanAnnotations, servicesManager, assignSvc);
    } catch (e) {
      console.warn('[iUSCAN] annotation restore failed:', e?.message || e);
    }
  }
}

async function restoreAnnotations(annotationsJson, servicesManager, assignSvc) {
  const { measurementService, displaySetService } = servicesManager.services;
  const saved = JSON.parse(annotationsJson);
  if (!Array.isArray(saved) || saved.length === 0) return;

  for (const ann of saved) {
    if (!ann.referencedImageId || !ann.points?.length) continue;

    // Build a Cornerstone Length annotation object
    const csAnnotation = {
      annotationUID: ann.uid,
      metadata: {
        toolName: 'Length',
        referencedImageId: ann.referencedImageId,
        FrameOfReferenceUID: undefined,
      },
      data: {
        label: ann.label,
        handles: {
          points: ann.points,
          activeHandleIndex: null,
          textBox: { hasMoved: false, worldPosition: [0, 0, 0], worldBoundingBox: null },
        },
        cachedStats: {},
      },
      highlighted: false,
      invalidated: true,
      isLocked: false,
      isVisible: true,
    };

    // Add to Cornerstone annotation state — keyed by referencedImageId
    csToolsAnnotation.state.addAnnotation(csAnnotation, ann.referencedImageId);

    // Trigger MeasurementService to pick up the annotation
    // by dispatching MEASUREMENT_ADDED via the existing subscriber
    // Small delay to let Cornerstone process the annotation
    await new Promise(resolve => setTimeout(resolve, 10));

    // Force MeasurementService to convert the CS annotation to a measurement
    // by triggering the annotation modified event
    const { triggerAnnotationRenderForViewportIds } = await import(
      '@cornerstonejs/tools/utilities'
    );
    try {
      triggerAnnotationRenderForViewportIds([]);
    } catch (_) {}
  }

  // Wait for MeasurementService to process all annotations
  await new Promise(resolve => setTimeout(resolve, 200));

  // Now auto-assign all measurements that have matching labels
  const measurements = measurementService.getMeasurements();
  for (const m of measurements) {
    if (m.label && m.toolName === 'Length') {
      assignSvc.autoAssignByLabel(m.uid, m.label);
    }
  }
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
    hydrateFromSeriesDoc(servicesManager, assignSvc).catch(e => {
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
