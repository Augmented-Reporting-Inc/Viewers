import { Types } from '@ohif/core';
import { annotation as csToolsAnnotation } from '@cornerstonejs/tools';
import { id } from './id';
import StudyPrefetchService from './services/StudyPrefetchService/StudyPrefetchService';
import getSopClassHandlerModule from './sopClassHandler/getSopClassHandlerModule';
import hpIUScan from './hangingProtocols/hpIUScan';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import getPanelModule from './panels/getPanelModule';
import { LABEL_MAP, MEASUREMENT_LABELS } from './utils/labelMap';
import { decorateIuscanRepeatedMeasurement, normalizeSavedIuscanRepeatedAnnotations } from './utils/repeatedMeasurements';
import {
  getActiveResearchContext,
  getActiveResearchReview,
  getResearchMeasurementLabels,
  getResearchRepeatedSlotCount,
  loadActiveResearchReviewFromViewer,
  getResearchVisibleMeasurementGroups,
  loadResearchContextFromViewer,
} from './utils/researchProtocol';
import { getLegacyIuscanMeasurementPlaceholders } from './utils/reportBuilder';

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
let _savedRepeatedAnnotations = [];

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

async function hydrateFromSeriesDoc(servicesManager, commandsManager) {
  try {
    const researchContext = await loadResearchContextFromViewer().catch(() => getActiveResearchContext());

    if (researchContext?.preview) {
      _savedRepeatedAnnotations = [];
      return { researchContext, processedAnnotations: [] };
    }

    if (researchContext?.reviewKey) {
      const review =
        getActiveResearchReview() || (await loadActiveResearchReviewFromViewer({ forceRefresh: true }));
      const repeatedAnnotations = (review?.measurementAnnotations || []).filter(
        annotation => annotation?.mode === 'repeated' || annotation?.repeatedMeasurement
      );
      _savedRepeatedAnnotations = normalizeSavedIuscanRepeatedAnnotations(repeatedAnnotations);

      console.info('[iUSCAN] research review annotations loaded', {
        reviewKey: researchContext.reviewKey,
        repeatedCount: _savedRepeatedAnnotations.length,
      });

      return {
        researchContext,
        review,
        processedAnnotations: _savedRepeatedAnnotations,
      };
    }

    const result = await commandsManager.runCommand('hydrateMeasurementAnnotationsForActiveStudy', {
      workflows: ['viewerMeasurements'],
      domains: ['iuscan', 'bowel'],
      notify: false,
    });

    const repeatedAnnotations = (result?.processedAnnotations || []).filter(annotation =>
      annotation?.mode === 'repeated' || annotation?.repeatedMeasurement
    );

    const canonicalRepeatedAnnotations = normalizeSavedIuscanRepeatedAnnotations(repeatedAnnotations);
    const legacyPlaceholders = getLegacyIuscanMeasurementPlaceholders(
      result?.seriesDoc || {},
      canonicalRepeatedAnnotations
    );
    _savedRepeatedAnnotations = [...canonicalRepeatedAnnotations, ...legacyPlaceholders];

    console.info('[iUSCAN] generic annotation hydration complete', {
      processedCount: result?.processedAnnotations?.length || 0,
      repeatedCount: canonicalRepeatedAnnotations.length,
      legacyPlaceholderCount: legacyPlaceholders.length,
      hasSeriesDoc: !!result?.seriesDoc,
    });

    return result;
  } catch (error) {
    console.warn('[iUSCAN] generic MeasurementAnnotations hydration threw:', error?.message || error);
    _savedRepeatedAnnotations = [];
    return null;
  }
}

const iuscanExtension = {
  id,

  // ── Lifecycle hooks ─────────────────────────────────────────────────────────

  /**
   * preRegistration: runs once on app init before any mode loads.
   * Measurement persistence is owned by extension-cornerstone; iUSCAN only
   * registers its study prefetch helper here.
   */
  preRegistration({ servicesManager }) {
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
    const { measurementService, customizationService, panelService } = servicesManager.services;

    _measurementAddedSub?.unsubscribe?.();
    _measurementAddedSub = null;
    _measurementUpdatedSub?.unsubscribe?.();
    _measurementUpdatedSub = null;
    _savedRepeatedAnnotations = [];

    const applyMeasurementLabels = researchContext => {
      const researchItems = getResearchMeasurementLabels(researchContext);
      customizationService.setCustomizations(
        {
          measurementLabels: {
            $set: {
              domain: 'iuscan',
              dialogTitle: researchContext ? 'Research Bowel Measurement' : 'Bowel Annotation',
              annotationTitle: researchContext ? 'Research Bowel Measurement' : 'Bowel Annotation',
              labelOnMeasure: true,
              exclusive: false,
              items: researchItems || MEASUREMENT_LABELS,
            },
          },
        },
        customizationService.Scope.Mode
      );
    };

    applyMeasurementLabels(getActiveResearchContext());
    loadResearchContextFromViewer()
      .then(researchContext => applyMeasurementLabels(researchContext))
      .catch(error => {
        console.warn('[iUSCAN] research protocol load failed:', error?.message || error);
        applyMeasurementLabels(null);
      });

    const decorateMeasurement = measurement => {
      sanitizeMeasurementDisplay(measurement);
      sanitizeViewportAnnotationForIuscan(measurement, servicesManager);

      if (!measurement?.label) {
        return null;
      }

      const researchContext = getActiveResearchContext();
      const mapping = LABEL_MAP?.[measurement.label];
      const stateKey = mapping?.stateKey || mapping?.axis || '';
      const siteKey = mapping?.site || '';
      const researchGroup = getResearchVisibleMeasurementGroups(researchContext, siteKey).find(
        group => group.stateKey === stateKey
      );
      const maxSlots = researchContext
        ? getResearchRepeatedSlotCount(researchContext, siteKey, researchGroup)
        : 3;

      return decorateIuscanRepeatedMeasurement({
        measurementService,
        measurement,
        savedAnnotations: _savedRepeatedAnnotations,
        maxSlots,
      });
    };

    _measurementAddedSub = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_ADDED,
      ({ measurement }) => {
        const decorated = decorateMeasurement(measurement);
        if (decorated) {
          panelService?.activatePanel?.('extension-iuscan.panelModule.iuscanMeasurements', true);
        }
      }
    );

    _measurementUpdatedSub = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      ({ measurement }) => {
        decorateMeasurement(measurement);
      }
    );

    hydrateFromSeriesDoc(servicesManager, commandsManager).catch(error => {
      console.warn('[iUSCAN] hydrateFromSeriesDoc failed:', error?.message || error);
    });
  },

  /**
   * onModeExit: clean up subscriptions and mode-specific customizations.
   * Called BEFORE mode-level cleanup, so service state is still accessible.
   */
  onModeExit({ servicesManager }) {
    const { customizationService } = servicesManager.services;
    // Unsubscribe MEASUREMENT_ADDED listener
    _measurementAddedSub?.unsubscribe?.();
    _measurementAddedSub = null;

    _measurementUpdatedSub?.unsubscribe?.();
    _measurementUpdatedSub = null;

    // Remove our mode-specific label customizations so they don't leak
    // into the longitudinal or stress-echo modes
    customizationService.onModeExit();

    _savedRepeatedAnnotations = [];
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
