import { Types } from '@ohif/core';
import { annotation as csToolsAnnotation } from '@cornerstonejs/tools';
import { id } from './id';
import IUScanAssignmentService from './services/IUScanAssignmentService';
import StudyPrefetchService from './services/StudyPrefetchService/StudyPrefetchService';
import getSopClassHandlerModule from './sopClassHandler/getSopClassHandlerModule';
import hpIUScan from './hangingProtocols/hpIUScan';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import getPanelModule from './panels/getPanelModule';
import { MEASUREMENT_LABELS, MEASUREMENT_SLOT_KEYS } from './utils/labelMap';

const sanitizeMeasurementUnit = unit =>
  String(unit || 'mm')
    .replace(/\s*US Region\s*/gi, '')
    .trim() || 'mm';

const toMillimeters = (value, unit = 'mm') => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return /^cm\b/i.test(sanitizeMeasurementUnit(unit)) ? numeric * 10 : numeric;
};

const formatMmDisplay = value => `${Number(value).toFixed(2)} mm`;

function setMeasurementDisplayText(measurement, text) {
  if (!measurement || !text) {
    return;
  }

  const existing = measurement.displayText;

  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    measurement.displayText = {
      ...existing,
      primary: [text],
      secondary: Array.isArray(existing.secondary) ? existing.secondary : [],
    };
    return;
  }

  measurement.displayText = {
    primary: [text],
    secondary: [],
  };
}

function setAnnotationDisplayText(annotation, text) {
  if (!annotation?.data || !text) {
    return;
  }

  const existing = annotation.data.displayText;

  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    annotation.data.displayText = {
      ...existing,
      primary: [text],
      secondary: Array.isArray(existing.secondary) ? existing.secondary : [],
    };
    return;
  }

  annotation.data.displayText = {
    primary: [text],
    secondary: [],
  };
}

function sanitizeLengthStatsObject(stats) {
  if (!stats || typeof stats !== 'object') {
    return false;
  }

  const rawValue = stats.length ?? stats.value;
  const rawUnit = stats.lengthUnit ?? stats.unit ?? 'mm';
  const valueInMm = toMillimeters(rawValue, rawUnit);

  if (valueInMm == null) {
    stats.displayText = scrubUsRegionDisplayText(stats.displayText);
    return false;
  }

  stats.length = valueInMm;
  stats.value = valueInMm;
  stats.unit = 'mm';
  stats.lengthUnit = 'mm';
  stats.displayText = [formatMmDisplay(valueInMm)];

  return true;
}

function sanitizeStatsContainer(container) {
  if (!container || typeof container !== 'object') {
    return false;
  }

  let changed = false;

  for (const value of Object.values(container)) {
    if (value && typeof value === 'object') {
      changed = sanitizeLengthStatsObject(value) || changed;
    }
  }

  return changed;
}

function sanitizeMeasurementForIuscan(measurement) {
  if (!measurement) {
    return measurement;
  }

  let changed = false;

  if (measurement.measurements && typeof measurement.measurements === 'object') {
    changed = sanitizeLengthStatsObject(measurement.measurements) || changed;
  }

  if (measurement.data && typeof measurement.data === 'object') {
    changed = sanitizeStatsContainer(measurement.data) || changed;
  }

  if (measurement.cachedStats && typeof measurement.cachedStats === 'object') {
    changed = sanitizeStatsContainer(measurement.cachedStats) || changed;
  }

  const topLevelValue = measurement.length ?? measurement.value;
  const topLevelUnit = measurement.lengthUnit ?? measurement.unit;
  const topLevelValueInMm = toMillimeters(topLevelValue, topLevelUnit);

  if (topLevelValueInMm != null) {
    measurement.length = topLevelValueInMm;
    measurement.value = topLevelValueInMm;
    measurement.unit = 'mm';
    measurement.lengthUnit = 'mm';
    setMeasurementDisplayText(measurement, formatMmDisplay(topLevelValueInMm));
    changed = true;
  }

  if (!changed) {
    measurement.displayText = scrubUsRegionDisplayText(measurement.displayText);
  } else if (measurement.data && typeof measurement.data === 'object') {
    const firstDisplayText = Object.values(measurement.data)
      .flatMap(datum => datum?.displayText || [])
      .filter(Boolean)[0];

    if (firstDisplayText) {
      setMeasurementDisplayText(measurement, firstDisplayText);
    }
  }

  return measurement;
}

// Module-level subscription reference — survives between onModeEnter/onModeExit
// without relying on `this` binding (OHIF calls lifecycle methods unbound)
let _measurementAddedSub = null;
let _measurementUpdatedSub = null;

function scrubUsRegionDisplayText(value) {
  if (Array.isArray(value)) {
    return value.map(scrubUsRegionDisplayText);
  }

  if (typeof value === 'string') {
    return value.replace(/\s*US Region\b/gi, '').trim();
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubUsRegionDisplayText(item)])
    );
  }

  return value;
}

function parseMaybeJson(value) {
  if (!value) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getAnnotationKey(annotation) {
  return annotation?.annotationId || annotation?.uid || annotation?.id || '';
}

function getViewerMeasurementAnnotationsFromSeriesDoc(doc) {
  const parsed = parseMaybeJson(doc?.MeasurementAnnotations);
  const annotations = parsed?.workflows?.viewerMeasurements?.annotations;

  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations.filter(annotation => {
    return (
      annotation?.workflow === 'viewerMeasurements' &&
      annotation?.domain === 'iuscan' &&
      annotation?.mode === 'repeated' &&
      annotation?.repeatedMeasurement
    );
  });
}

function mergeRepeatedAnnotations(...annotationLists) {
  const out = [];
  const seen = new Set();

  for (const annotationList of annotationLists) {
    for (const annotation of annotationList || []) {
      const key =
        getAnnotationKey(annotation) ||
        [
          annotation?.label || annotation?.measurementRole || annotation?.role || '',
          annotation?.repeatedMeasurement?.groupKey || '',
          annotation?.value ||
            annotation?.measurements?.value ||
            annotation?.measurements?.length ||
            '',
        ].join('|');

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      out.push(annotation);
    }
  }

  return out;
}

function sanitizeMeasurementDisplay(measurement) {
  if (!measurement) {
    return;
  }

  sanitizeMeasurementForIuscan(measurement);
}

function getMeasurementAnnotationKey(measurement) {
  return (
    measurement?.annotationId ||
    measurement?.annotationUID ||
    measurement?.uid ||
    measurement?.id ||
    ''
  );
}

function sanitizeCornerstoneAnnotationByKey(annotationKey) {
  if (!annotationKey) {
    return false;
  }

  const csAnnotation = csToolsAnnotation?.state?.getAnnotation?.(annotationKey);
  if (!csAnnotation?.data) {
    return false;
  }

  let changed = false;

  if (csAnnotation.data.cachedStats) {
    changed = sanitizeStatsContainer(csAnnotation.data.cachedStats) || changed;
  }

  if (csAnnotation.data.measurements) {
    changed = sanitizeLengthStatsObject(csAnnotation.data.measurements) || changed;
  }

  if (changed) {
    const firstDisplayText =
      csAnnotation.data.measurements?.displayText?.[0] ||
      Object.values(csAnnotation.data.cachedStats || {})
        .flatMap(stats => stats?.displayText || [])
        .filter(Boolean)[0];

    if (firstDisplayText) {
      setAnnotationDisplayText(csAnnotation, firstDisplayText);
    }

    csAnnotation.invalidated = true;
  }

  return changed;
}

function rerenderVisibleViewports(servicesManager) {
  const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
  const gridState = viewportGridService?.getState?.();
  const viewports = gridState?.viewports || [];

  Object.values(viewports).forEach(viewportInfo => {
    const viewportId = viewportInfo?.viewportId || viewportInfo?.id;
    const viewport = viewportId
      ? cornerstoneViewportService?.getCornerstoneViewport?.(viewportId)
      : null;

    viewport?.render?.();
  });
}

function sanitizeViewportAnnotationForIuscan(measurement, servicesManager) {
  const annotationKey = getMeasurementAnnotationKey(measurement);
  const changed = sanitizeCornerstoneAnnotationByKey(annotationKey);

  if (changed) {
    rerenderVisibleViewports(servicesManager);
  }
}

function sanitizeHydratedViewportAnnotationsForIuscan(annotations, servicesManager) {
  let changed = false;

  for (const item of annotations || []) {
    const annotationKey = item?.annotationId || item?.annotationUID || item?.uid || item?.id;
    changed = sanitizeCornerstoneAnnotationByKey(annotationKey) || changed;
  }

  if (changed) {
    rerenderVisibleViewports(servicesManager);
  }
}

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

  const hydratedCommandAnnotations = (
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

  const docRepeatedAnnotations = getViewerMeasurementAnnotationsFromSeriesDoc(doc);
  const canonicalRepeatedAnnotations = mergeRepeatedAnnotations(
    docRepeatedAnnotations,
    hydratedCommandAnnotations
  );

  sanitizeHydratedViewportAnnotationsForIuscan(canonicalRepeatedAnnotations, servicesManager);

  assignSvc.hydrateFromSeriesDoc(doc);

  console.info('[iUSCAN] hydration complete', {
    restoredCount: result.restoredCount || 0,
    skippedCount: result.skippedCount || 0,
    processedCount: result.processedAnnotations?.length || 0,
    docRepeatedCount: docRepeatedAnnotations.length,
    canonicalRepeatedCount: canonicalRepeatedAnnotations.length,
    hasSeriesDoc: true,
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
        sanitizeMeasurementDisplay(measurement);
        sanitizeViewportAnnotationForIuscan(measurement, servicesManager);

        if (!measurement?.label) {
          return;
        }
        assignSvc.autoAssignByLabel(measurement.uid, measurement.label);
      }
    );

    _measurementUpdatedSub = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      ({ measurement }) => {
        sanitizeMeasurementDisplay(measurement);
        sanitizeViewportAnnotationForIuscan(measurement, servicesManager);

        if (!measurement?.label) {
          return;
        }
        // Only auto-assign if not already assigned anywhere
        const state = assignSvc.getFullState();
        const alreadyAssigned = Object.values(state).some(site =>
          MEASUREMENT_SLOT_KEYS.some(axis =>
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
