import { metaData } from '@cornerstonejs/core';
import { annotation as csToolsAnnotation, ToolGroupManager } from '@cornerstonejs/tools';
import * as cornerstoneTools from '@cornerstonejs/tools';
import {
  REVIEWER_MEASUREMENTS_WORKFLOW,
  getRequestedWorkflowAnnotations,
  isViewerMeasurementWorkflow,
} from './measurementAnnotations';
import { buildFormApiUrl } from './formApi';

const CONTOUR_TOOL_NAMES = new Set(['SplineROI', 'PlanarFreehandROI', 'LivewireContour']);

const COACH_MEASUREMENT_COLOR = 'rgb(56, 189, 248)';
const COACH_MEASUREMENT_HIGHLIGHT_COLOR = 'rgb(125, 211, 252)';
const COACH_MEASUREMENT_SELECTED_COLOR = 'rgb(186, 230, 253)';
const COACH_MEASUREMENT_LINE_DASH = '4,3';
const COACH_MEASUREMENT_TEXT_BACKGROUND = 'rgba(8, 47, 73, 0.85)';

function buildAnnotationStateStyle(
  property: string,
  {
    normal,
    highlighted = normal,
    selected = highlighted,
    locked = normal,
  }: {
    normal: string;
    highlighted?: string;
    selected?: string;
    locked?: string;
  }
) {
  return {
    [property]: normal,
    [`${property}Active`]: normal,
    [`${property}Passive`]: normal,

    [`${property}Highlighted`]: highlighted,
    [`${property}HighlightedActive`]: highlighted,
    [`${property}HighlightedPassive`]: highlighted,

    [`${property}Selected`]: selected,
    [`${property}SelectedActive`]: selected,
    [`${property}SelectedPassive`]: selected,

    [`${property}Locked`]: locked,
    [`${property}LockedActive`]: locked,
    [`${property}LockedPassive`]: locked,
  };
}

const COACH_MEASUREMENT_ANNOTATION_STYLE = Object.freeze({
  ...buildAnnotationStateStyle('color', {
    normal: COACH_MEASUREMENT_COLOR,
    highlighted: COACH_MEASUREMENT_HIGHLIGHT_COLOR,
    selected: COACH_MEASUREMENT_SELECTED_COLOR,
  }),

  ...buildAnnotationStateStyle('lineDash', {
    normal: COACH_MEASUREMENT_LINE_DASH,
  }),

  ...buildAnnotationStateStyle('lineWidth', {
    normal: '2',
    highlighted: '3',
    selected: '3',
  }),

  ...buildAnnotationStateStyle('textBoxColor', {
    normal: COACH_MEASUREMENT_COLOR,
    highlighted: COACH_MEASUREMENT_HIGHLIGHT_COLOR,
    selected: COACH_MEASUREMENT_SELECTED_COLOR,
  }),

  ...buildAnnotationStateStyle('textBoxBackground', {
    normal: COACH_MEASUREMENT_TEXT_BACKGROUND,
  }),

  ...buildAnnotationStateStyle('textBoxLinkLineColor', {
    normal: COACH_MEASUREMENT_COLOR,
    highlighted: COACH_MEASUREMENT_HIGHLIGHT_COLOR,
    selected: COACH_MEASUREMENT_SELECTED_COLOR,
  }),

  ...buildAnnotationStateStyle('textBoxLinkLineDash', {
    normal: COACH_MEASUREMENT_LINE_DASH,
  }),

  ...buildAnnotationStateStyle('textBoxLinkLineWidth', {
    normal: '2',
  }),
});

function isCoachMeasurementAnnotation({ workflow = '', measurementOwner = '' } = {}) {
  return (
    String(workflow || '').trim() === REVIEWER_MEASUREMENTS_WORKFLOW ||
    String(measurementOwner || '')
      .trim()
      .toLowerCase() === 'coach'
  );
}

export function applyReviewMeasurementAnnotationStyle({
  annotationUID = '',
  workflow = '',
  measurementOwner = '',
}: {
  annotationUID?: string;
  workflow?: string;
  measurementOwner?: string;
} = {}) {
  const resolvedAnnotationUID = String(annotationUID || '').trim();

  if (
    !resolvedAnnotationUID ||
    !isCoachMeasurementAnnotation({
      workflow,
      measurementOwner,
    })
  ) {
    return false;
  }

  csToolsAnnotation.config.style.setAnnotationStyles(
    resolvedAnnotationUID,
    COACH_MEASUREMENT_ANNOTATION_STYLE
  );

  return true;
}

let explicitSeriesDocPromise: Promise<any | null> | null = null;
let explicitSeriesDocCacheKey = '';

function getExplicitSeriesDocCacheKey(seriesIds: string[]) {
  if (!seriesIds.length) {
    return '';
  }

  return `explicit:${seriesIds.join('|')}`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getViewportState(servicesManager) {
  const { viewportGridService } = servicesManager.services;
  const { activeViewportId, viewports } = viewportGridService.getState();
  const activeViewport = viewports?.get?.(activeViewportId) ?? viewports?.[activeViewportId];

  return { activeViewportId, activeViewport };
}

async function waitForActiveDisplaySet(servicesManager) {
  const { displaySetService } = servicesManager.services;

  for (let i = 0; i < 30; i++) {
    const { activeViewport } = getViewportState(servicesManager);
    const displaySetInstanceId = activeViewport?.displaySetInstanceUIDs?.[0];

    if (displaySetInstanceId) {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceId);

      if (displaySet?.StudyInstanceUID || displaySet?.SeriesInstanceUID) {
        return displaySet;
      }
    }

    await sleep(100);
  }

  return null;
}

async function fetchJsonIfOk(url: string) {
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      url,
      data: null,
    };
  }

  return {
    ok: true,
    status: response.status,
    url,
    data: await response.json(),
  };
}

function getViewerUrlSearchParams(): URLSearchParams {
  const params = new URLSearchParams();

  try {
    const searchParams = new URLSearchParams(window.location?.search || '');
    searchParams.forEach((value, key) => {
      params.set(key, value);
    });
  } catch {}

  try {
    const hash = String(window.location?.hash || '');
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1).split('#')[0] : '';

    const hashParams = new URLSearchParams(hashQuery);
    hashParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
  } catch {}

  return params;
}

function getExplicitSeriesIdsFromViewerUrl(): string[] {
  const qs = getViewerUrlSearchParams();
  const seen = new Set<string>();

  return [
    String(qs.get('arLearnerSeriesId') || '').trim(),
    String(qs.get('arSeriesId') || '').trim(),
    String(qs.get('mongo_id') || '').trim(),
    String(qs.get('mongoId') || '').trim(),
    String(qs.get('arMongoId') || '').trim(),
    String(qs.get('arBaseSeriesId') || '').trim(),
  ].filter(value => {
    if (!value || seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
}

async function fetchSeriesDocById(seriesId: string) {
  const id = String(seriesId || '').trim();

  if (!id) {
    return {
      ok: false,
      status: 0,
      url: '',
      data: null,
    };
  }

  return fetchJsonIfOk(buildFormApiUrl(`series/${encodeURIComponent(id)}`));
}

async function fetchSeriesDocFromExplicitViewerContext() {
  const explicitSeriesIds = getExplicitSeriesIdsFromViewerUrl();
  const cacheKey = getExplicitSeriesDocCacheKey(explicitSeriesIds);

  if (!cacheKey) {
    return null;
  }

  if (explicitSeriesDocPromise && explicitSeriesDocCacheKey === cacheKey) {
    return explicitSeriesDocPromise;
  }

  explicitSeriesDocCacheKey = cacheKey;
  explicitSeriesDocPromise = (async () => {
    for (const explicitSeriesId of explicitSeriesIds) {
      const explicitResult = await fetchSeriesDocById(explicitSeriesId);

      if (explicitResult.ok) {
        console.info('[MeasurementAnnotations] resolved by explicit viewer series id', {
          seriesId: explicitResult.data?._id,
          requestedSeriesId: explicitSeriesId,
          hasMeasurementAnnotations: !!explicitResult.data?.MeasurementAnnotations,
        });

        return explicitResult.data;
      }

      console.warn('[MeasurementAnnotations] explicit viewer series id lookup failed', {
        requestedSeriesId: explicitSeriesId,
        status: explicitResult.status,
      });
    }

    return null;
  })();

  try {
    const seriesDoc = await explicitSeriesDocPromise;

    if (!seriesDoc) {
      explicitSeriesDocPromise = null;
      explicitSeriesDocCacheKey = '';
    }

    return seriesDoc;
  } catch (error) {
    explicitSeriesDocPromise = null;
    explicitSeriesDocCacheKey = '';
    throw error;
  }
}

export async function fetchSeriesDocForActiveStudy(servicesManager) {
  const explicitSeriesDoc = await fetchSeriesDocFromExplicitViewerContext();

  if (explicitSeriesDoc) {
    return explicitSeriesDoc;
  }

  const displaySet = await waitForActiveDisplaySet(servicesManager);
  const studyInstanceId = displaySet?.StudyInstanceUID;
  const seriesInstanceId = displaySet?.SeriesInstanceUID;

  if (!studyInstanceId && !seriesInstanceId) {
    throw new Error('Cannot determine active study or series.');
  }

  console.info('[MeasurementAnnotations] resolving series document', {
    StudyInstanceUID: studyInstanceId || '',
    SeriesInstanceUID: seriesInstanceId || '',
  });

  if (seriesInstanceId) {
    const seriesResult = await fetchJsonIfOk(
      buildFormApiUrl(`series/siuid/${encodeURIComponent(seriesInstanceId)}`)
    );

    if (seriesResult.ok) {
      console.info('[MeasurementAnnotations] resolved by SeriesInstanceUID', {
        seriesId: seriesResult.data?._id,
        hasMeasurementAnnotations: !!seriesResult.data?.MeasurementAnnotations,
      });

      return seriesResult.data;
    }

    console.warn('[MeasurementAnnotations] SeriesInstanceUID lookup failed', {
      status: seriesResult.status,
      url: seriesResult.url,
    });
  }

  if (studyInstanceId) {
    const studyResult = await fetchJsonIfOk(
      buildFormApiUrl(`series/study/${encodeURIComponent(studyInstanceId)}`)
    );

    if (studyResult.ok) {
      console.info('[MeasurementAnnotations] resolved by StudyInstanceUID fallback', {
        seriesId: studyResult.data?._id,
        hasMeasurementAnnotations: !!studyResult.data?.MeasurementAnnotations,
      });

      return studyResult.data;
    }

    console.warn('[MeasurementAnnotations] StudyInstanceUID lookup failed', {
      status: studyResult.status,
      url: studyResult.url,
    });
  }

  throw new Error(
    `Series document lookup failed. StudyInstanceUID=${studyInstanceId || ''}, SeriesInstanceUID=${seriesInstanceId || ''}`
  );
}

function inferToolName(annotation) {
  return annotation?.toolName || '';
}

function getViewportAnnotationLabel(annotation: any = {}) {
  const label = annotation?.label || annotation?.measurementRole || annotation?.role || '';

  if (
    annotation?.workflow === REVIEWER_MEASUREMENTS_WORKFLOW &&
    label &&
    !String(label).startsWith('Coach: ')
  ) {
    return `Coach: ${label}`;
  }

  return label;
}

function isCanonicalViewerMeasurementAnnotation(annotation) {
  const annotationId = annotation?.uid || annotation?.annotationId;

  return !!(
    annotation &&
    isViewerMeasurementWorkflow(annotation.workflow) &&
    annotationId &&
    annotation.domain &&
    annotation.mode &&
    annotation.toolName &&
    annotation.referencedImageId &&
    Array.isArray(annotation.points) &&
    annotation.points.length > 0
  );
}

function getFrameOfReferenceUIDFromViewport(viewport) {
  return (
    viewport?.getFrameOfReferenceUID?.() ||
    viewport?.getFrameOfReferenceUID ||
    viewport?.getImageData?.()?.metadata?.FrameOfReferenceUID ||
    viewport?.getImageData?.()?.metadata?.frameOfReferenceUID ||
    ''
  );
}

function getActiveViewportInfo(servicesManager) {
  try {
    const { cornerstoneViewportService } = servicesManager.services;
    const { activeViewportId } = getViewportState(servicesManager);

    if (!activeViewportId) {
      return {
        activeViewportId: '',
        viewport: null,
        element: null,
        FrameOfReferenceUID: '',
      };
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);

    return {
      activeViewportId,
      viewport,
      element: viewport?.element || null,
      FrameOfReferenceUID: getFrameOfReferenceUIDFromViewport(viewport),
    };
  } catch {
    return {
      activeViewportId: '',
      viewport: null,
      element: null,
      FrameOfReferenceUID: '',
    };
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasCornerstoneCachedStatsShape(cachedStats) {
  if (!isPlainObject(cachedStats)) {
    return false;
  }

  return Object.values(cachedStats).some(value => isPlainObject(value));
}

function finiteNumberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeDisplayLengthUnit(unit = '') {
  return /px/i.test(String(unit || '')) ? 'mm' : unit || 'mm';
}

function normalizeDisplayAreaUnit(unit = '') {
  return /px/i.test(String(unit || '')) ? 'mm²' : unit || 'mm²';
}

function getCornerstonePixelSpacingMM(referencedImageId = '') {
  if (!referencedImageId) {
    return null;
  }

  const calibratedPixelSpacing = metaData.get?.('calibratedPixelSpacing', referencedImageId) || {};
  const imagePlaneModule = metaData.get?.('imagePlaneModule', referencedImageId) || {};
  const imagePixelModule = metaData.get?.('imagePixelModule', referencedImageId) || {};
  const pixelSpacing = imagePixelModule.pixelSpacing || imagePlaneModule.pixelSpacing || [];

  const row =
    finiteNumberOrNull(calibratedPixelSpacing.rowPixelSpacing) ??
    finiteNumberOrNull(calibratedPixelSpacing[0]) ??
    finiteNumberOrNull(imagePlaneModule.rowPixelSpacing) ??
    finiteNumberOrNull(pixelSpacing[0]);

  const column =
    finiteNumberOrNull(calibratedPixelSpacing.columnPixelSpacing) ??
    finiteNumberOrNull(calibratedPixelSpacing[1]) ??
    finiteNumberOrNull(imagePlaneModule.columnPixelSpacing) ??
    finiteNumberOrNull(pixelSpacing[1]);

  if (!row || !column || row <= 0 || column <= 0 || (row === 1 && column === 1)) {
    return null;
  }

  return {
    row,
    column,
    unit: 'mm',
  };
}

function getSavedContourAreaMM2(savedAnnotation, referencedImageId = '') {
  const measurements = savedAnnotation?.measurements || {};
  const rawArea = finiteNumberOrNull(measurements.area);
  const rawAreaUnit = String(measurements.areaUnit || '').trim();

  if (rawArea == null) {
    return null;
  }

  if (/px/i.test(rawAreaUnit)) {
    const pixelSpacing = getCornerstonePixelSpacingMM(
      referencedImageId || savedAnnotation?.referencedImageId || ''
    );

    if (pixelSpacing) {
      return rawArea * pixelSpacing.row * pixelSpacing.column;
    }
  }

  return rawArea;
}

function getLinearUnitForAreaUnit(areaUnit = '') {
  const normalized = normalizeDisplayAreaUnit(areaUnit);

  if (/mm/i.test(normalized)) {
    return 'mm';
  }

  if (/cm/i.test(normalized)) {
    return 'cm';
  }

  return 'mm';
}

function removeInvalidCachedStatsKeys(cachedStats = {}) {
  return Object.fromEntries(
    Object.entries(cachedStats || {}).filter(([targetId]) =>
      /^(imageId|volumeId):/i.test(String(targetId || ''))
    )
  );
}

function getSavedContourStats(savedAnnotation, referencedImageId = '') {
  const area = getSavedContourAreaMM2(savedAnnotation, referencedImageId);

  if (area == null) {
    return null;
  }

  return {
    area,
    areaUnit: 'mm²',
    areaUnits: 'mm²',
    unit: 'mm',
    units: 'mm',
    modalityUnit: 'mm',
    modalityUnitOptions: {
      areaUnit: 'mm²',
      unit: 'mm',
    },
    arSavedMeasurementArea: area,
    arSavedMeasurementAreaUnit: 'mm²',
  };
}

function formatSavedAreaMM2(area) {
  if (!Number.isFinite(area)) {
    return '';
  }

  if (area >= 100) {
    return area.toFixed(0);
  }

  if (area >= 10) {
    return area.toFixed(1);
  }

  return area.toFixed(2);
}

function getSavedContourDisplayText(savedAnnotation, referencedImageId = '') {
  const area = getSavedContourAreaMM2(savedAnnotation, referencedImageId);

  if (area == null) {
    return [];
  }

  return [`${formatSavedAreaMM2(area)} mm²`];
}

function getToolGroupForViewportSafe(viewport, viewportId = '') {
  const resolvedViewportId = viewport?.id || viewportId;

  if (!resolvedViewportId) {
    return null;
  }

  try {
    return ToolGroupManager.getToolGroupForViewport?.(
      resolvedViewportId,
      viewport?.renderingEngineId
    );
  } catch {
    try {
      return ToolGroupManager.getToolGroupForViewport?.(resolvedViewportId);
    } catch {
      return null;
    }
  }
}

function installSavedContourTextOverrideForViewport({ viewport, viewportId = '', toolName }) {
  if (!viewport || !CONTOUR_TOOL_NAMES.has(toolName)) {
    return;
  }

  const toolGroup = getToolGroupForViewportSafe(viewport, viewportId);
  const toolInstance = toolGroup?.getToolInstance?.(toolName);

  if (!toolInstance || toolInstance.__arSavedContourTextOverrideInstalled) {
    return;
  }

  const previousGetTextLines = toolInstance.configuration?.getTextLines;

  const getOverrideText = (...args) => {
    for (const arg of args) {
      const candidates = [arg?.data, arg?.annotation?.data, arg?.annotationData, arg].filter(
        Boolean
      );

      for (const candidate of candidates) {
        const overrideText = candidate?.arSavedMeasurementDisplayText;

        if (Array.isArray(overrideText) && overrideText.length > 0) {
          return overrideText;
        }
      }
    }

    return null;
  };

  const nextConfiguration = {
    ...(toolInstance.configuration || {}),
    getTextLines: function (...args) {
      const overrideText = getOverrideText(...args);

      if (overrideText) {
        return overrideText;
      }

      if (typeof previousGetTextLines === 'function') {
        return previousGetTextLines.call(this, ...args);
      }

      return [];
    },
  };

  // Set both. Some Cornerstone versions mutate through the tool group; others
  // read directly from the existing tool instance.
  toolInstance.configuration = nextConfiguration;
  toolGroup?.setToolConfiguration?.(toolName, nextConfiguration, true);

  toolInstance.__arSavedContourTextOverrideInstalled = true;
}

function applySavedContourDisplayTextOverride({
  targetAnnotation,
  savedAnnotation,
  viewport,
  viewportId = '',
}) {
  const toolName = targetAnnotation?.metadata?.toolName || inferToolName(savedAnnotation);

  if (!targetAnnotation || !CONTOUR_TOOL_NAMES.has(toolName)) {
    return targetAnnotation;
  }

  const displayText = getSavedContourDisplayText(
    savedAnnotation,
    targetAnnotation?.metadata?.referencedImageId || savedAnnotation?.referencedImageId || ''
  );

  if (!displayText.length) {
    return targetAnnotation;
  }

  installSavedContourTextOverrideForViewport({
    viewport,
    viewportId,
    toolName,
  });

  targetAnnotation.data = {
    ...(targetAnnotation.data || {}),
    arSavedMeasurementDisplayText: displayText,
  };

  return targetAnnotation;
}

function getValidCornerstoneCachedStatsKeys(cachedStats = {}) {
  return Object.keys(cachedStats || {}).filter(targetId =>
    /^(imageId|volumeId):/i.test(String(targetId || ''))
  );
}

function normalizeImageTargetId(imageId = '') {
  const value = String(imageId || '').trim();

  if (!value) {
    return '';
  }

  if (/^(imageId|volumeId):/i.test(value)) {
    return value;
  }

  return `imageId:${value}`;
}

function repatchSavedContourStatsAfterCornerstoneRecalc({
  annotationUID,
  savedAnnotation,
  referencedImageId = '',
  viewport,
}) {
  if (!annotationUID || !CONTOUR_TOOL_NAMES.has(inferToolName(savedAnnotation))) {
    return;
  }

  const patchOnce = delayMs => {
    window.setTimeout(() => {
      const targetAnnotation = csToolsAnnotation.state.getAnnotation?.(annotationUID);

      if (!targetAnnotation) {
        return;
      }

      patchContourCachedStatsFromSaved(targetAnnotation, savedAnnotation, referencedImageId);

      try {
        viewport?.render?.();
      } catch {
        // Ignore render failures during viewport teardown / navigation.
      }
    }, delayMs);
  };

  // SplineROI emits multiple late measurement updates after hydrate.
  // Patch after each likely recalculation window.
  [0, 25, 75, 150, 300, 600, 1000].forEach(patchOnce);
}

function patchContourCachedStatsFromSaved(
  targetAnnotation,
  savedAnnotation,
  referencedImageId = ''
) {
  const toolName = targetAnnotation?.metadata?.toolName || inferToolName(savedAnnotation);

  if (!targetAnnotation || !CONTOUR_TOOL_NAMES.has(toolName)) {
    return targetAnnotation;
  }

  const savedStats = getSavedContourStats(savedAnnotation, referencedImageId);

  if (!savedStats) {
    return targetAnnotation;
  }

  const existingCachedStats = removeInvalidCachedStatsKeys(
    targetAnnotation.data?.cachedStats || {}
  );

  const existingKeys = getValidCornerstoneCachedStatsKeys(existingCachedStats);
  const referencedTargetId = normalizeImageTargetId(
    referencedImageId || savedAnnotation?.referencedImageId || ''
  );

  const keysToPatch = Array.from(new Set([...existingKeys, referencedTargetId].filter(Boolean)));

  targetAnnotation.data = {
    ...(targetAnnotation.data || {}),
    cachedStats: {
      ...existingCachedStats,
      ...Object.fromEntries(
        keysToPatch.map(targetId => [
          targetId,
          {
            ...(existingCachedStats[targetId] || {}),
            ...savedStats,
          },
        ])
      ),
    },
    arSavedMeasurementDisplayText:
      getSavedContourDisplayText(savedAnnotation, referencedImageId) || undefined,
    arSavedMeasurementStatsLocked: true,
  };

  targetAnnotation.invalidated = false;

  return targetAnnotation;
}

function buildCachedStatsForAnnotation(annotation, toolName, referencedImageId) {
  if (hasCornerstoneCachedStatsShape(annotation.cachedStats)) {
    return annotation.cachedStats;
  }

  const targetId = referencedImageId ? `imageId:${referencedImageId}` : '';
  const measurements = annotation.measurements || {};

  if (!targetId) {
    return {};
  }

  if (toolName === 'Length') {
    const length =
      finiteNumberOrNull(measurements.length) ?? finiteNumberOrNull(measurements.value);

    if (length == null) {
      return {};
    }

    return {
      [targetId]: {
        length,
        unit: normalizeDisplayLengthUnit(measurements.lengthUnit || measurements.unit || ''),
        lengthUnit: normalizeDisplayLengthUnit(measurements.lengthUnit || measurements.unit || ''),
      },
    };
  }

  if (CONTOUR_TOOL_NAMES.has(toolName)) {
    const savedStats = getSavedContourStats(annotation, referencedImageId);

    if (!savedStats) {
      return {};
    }

    return {
      [targetId]: savedStats,
    };
  }

  return {};
}

function cloneAnnotationPoints(points = []) {
  return Array.isArray(points)
    ? points.map(point => (Array.isArray(point) ? [...point] : point))
    : [];
}

function buildCornerstoneAnnotation(annotation, fallbackFrameOfReferenceUID = '') {
  const annotationUID = annotation.uid || annotation.annotationId;
  const referencedImageId = annotation.referencedImageId;
  const points = cloneAnnotationPoints(annotation.points);
  const toolName = inferToolName(annotation);
  const FrameOfReferenceUID = annotation.FrameOfReferenceUID || fallbackFrameOfReferenceUID || '';
  if (!annotationUID || !toolName || !referencedImageId || points.length === 0) {
    return null;
  }

  const data: any = {
    label: getViewportAnnotationLabel(annotation),
    handles: {
      points,
      activeHandleIndex: null,
      textBox: {
        hasMoved: false,
        worldPosition: points[0] || [0, 0, 0],
        worldBoundingBox: null,
      },
    },
    cachedStats: buildCachedStatsForAnnotation(annotation, toolName, referencedImageId),
  };

  // Contour tools need contour geometry. Keeping handles too is harmless and
  // preserves compatibility with tools/mappers that read handles.
  if (CONTOUR_TOOL_NAMES.has(toolName)) {
    data.contour = {
      closed: true,
      polyline: points,
    };
  }

  return {
    annotationUID,
    metadata: {
      toolName,
      referencedImageId,
      FrameOfReferenceUID,
      SOPInstanceUID: annotation.SOPInstanceUID,
      SeriesInstanceUID: annotation.SeriesInstanceUID || annotation.referenceSeriesUID,
      StudyInstanceUID: annotation.StudyInstanceUID,
      arMeasurementWorkflow: annotation.workflow || '',
      arMeasurementReadOnly: !!annotation.isLocked,
      arMeasurementReviewRound: Number(annotation.reviewRound) || null,
    },
    data: {
      ...data,
      arMeasurementWorkflow: annotation.workflow || '',
      arMeasurementReadOnly: !!annotation.isLocked,
      arMeasurementReviewRound: Number(annotation.reviewRound) || null,
    },
    highlighted: false,
    invalidated: false,
    isLocked: !!annotation.isLocked,
    isVisible: annotation.isVisible !== false,
  };
}

function getToolClassForHydration(toolName) {
  switch (toolName) {
    case 'SplineROI':
      return cornerstoneTools.SplineROITool;
    case 'PlanarFreehandROI':
      return cornerstoneTools.PlanarFreehandROITool;
    case 'LivewireContour':
      return cornerstoneTools.LivewireContourTool;
    case 'Length':
      return cornerstoneTools.LengthTool;
    default:
      return null;
  }
}

function patchHydratedAnnotationFromSaved({
  hydrated,
  fallback,
  savedAnnotation,
  referencedImageId,
  fallbackFrameOfReferenceUID = '',
}) {
  const annotationUID =
    hydrated?.annotationUID ||
    hydrated?.uid ||
    fallback?.annotationUID ||
    savedAnnotation?.uid ||
    savedAnnotation?.annotationId;

  const target = csToolsAnnotation.state.getAnnotation?.(annotationUID) || hydrated || fallback;

  if (!target) {
    return null;
  }

  const toolName = inferToolName(savedAnnotation);
  const points = cloneAnnotationPoints(savedAnnotation?.points);

  target.annotationUID = annotationUID;
  target.metadata = {
    ...(target.metadata || {}),
    ...(fallback?.metadata || {}),
    toolName,
    referencedImageId,
    FrameOfReferenceUID:
      target.metadata?.FrameOfReferenceUID ||
      fallback?.metadata?.FrameOfReferenceUID ||
      savedAnnotation.FrameOfReferenceUID ||
      fallbackFrameOfReferenceUID ||
      '',
    SOPInstanceUID: savedAnnotation.SOPInstanceUID,
    SeriesInstanceUID: savedAnnotation.SeriesInstanceUID || savedAnnotation.referenceSeriesUID,
    StudyInstanceUID: savedAnnotation.StudyInstanceUID,
    arMeasurementWorkflow: savedAnnotation.workflow || '',
    arMeasurementReadOnly: !!savedAnnotation.isLocked,
    arMeasurementReviewRound: Number(savedAnnotation.reviewRound) || null,
  };

  target.data = {
    ...(target.data || {}),
    ...(fallback?.data || {}),
    label: getViewportAnnotationLabel(savedAnnotation),
    handles: {
      ...(target.data?.handles || {}),
      ...(fallback?.data?.handles || {}),
      points,
      activeHandleIndex: null,
      textBox: {
        ...(target.data?.handles?.textBox || {}),
        ...(fallback?.data?.handles?.textBox || {}),
        hasMoved: false,
        worldPosition: points[0] || [0, 0, 0],
        worldBoundingBox: null,
      },
    },
    cachedStats: buildCachedStatsForAnnotation(savedAnnotation, toolName, referencedImageId),
    arMeasurementWorkflow: savedAnnotation.workflow || '',
    arMeasurementReadOnly: !!savedAnnotation.isLocked,
    arMeasurementReviewRound: Number(savedAnnotation.reviewRound) || null,
  };

  if (CONTOUR_TOOL_NAMES.has(toolName)) {
    target.data.contour = {
      ...(target.data?.contour || {}),
      closed: true,
      polyline: points,
    };
  }

  target.invalidated = false;
  target.isVisible = savedAnnotation.isVisible !== false;
  target.isLocked = !!savedAnnotation.isLocked;

  applyReviewMeasurementAnnotationStyle({
    annotationUID,
    workflow: savedAnnotation.workflow,
    measurementOwner: savedAnnotation.measurementOwner,
  });

  return target;
}

function hydrateWithToolClass({
  savedAnnotation,
  viewportId,
  fallbackAnnotation,
  referencedImageId,
  fallbackFrameOfReferenceUID = '',
}) {
  const toolName = inferToolName(savedAnnotation);
  const ToolClass = getToolClassForHydration(toolName);
  const points = cloneAnnotationPoints(savedAnnotation?.points);
  const annotationUID = savedAnnotation.uid || savedAnnotation.annotationId;

  if (!ToolClass?.hydrate || !viewportId || !points.length || !annotationUID) {
    return null;
  }

  try {
    const existing = csToolsAnnotation.state.getAnnotation?.(annotationUID);

    if (existing) {
      return patchHydratedAnnotationFromSaved({
        hydrated: existing,
        fallback: fallbackAnnotation,
        savedAnnotation,
        referencedImageId,
        fallbackFrameOfReferenceUID,
      });
    }

    const hydrated = ToolClass.hydrate(viewportId, points, {
      annotationUID,
    });

    return patchHydratedAnnotationFromSaved({
      hydrated,
      fallback: fallbackAnnotation,
      savedAnnotation,
      referencedImageId,
      fallbackFrameOfReferenceUID,
    });
  } catch (error) {
    console.warn('[MeasurementAnnotations] tool hydrate failed:', {
      toolName,
      annotationUID,
      error,
    });
    return null;
  }
}

export function hydrateSavedViewerAnnotationForViewport({
  annotation,
  viewport,
  viewportId,
  referencedImageIdOverride = '',
  fallbackFrameOfReferenceUID = '',
  selectAnnotation = true,
}: {
  annotation: any;
  viewport?: any;
  viewportId?: string;
  referencedImageIdOverride?: string;
  fallbackFrameOfReferenceUID?: string;
  selectAnnotation?: boolean;
}) {
  const annotationToHydrate = {
    ...annotation,
    referencedImageId: referencedImageIdOverride || annotation?.referencedImageId,
    points: cloneAnnotationPoints(annotation?.points),
  };

  const cornerstoneAnnotation = buildCornerstoneAnnotation(
    annotationToHydrate,
    fallbackFrameOfReferenceUID
  );

  if (!cornerstoneAnnotation) {
    return null;
  }

  const annotationUID = cornerstoneAnnotation.annotationUID;
  const toolName = cornerstoneAnnotation.metadata?.toolName || inferToolName(annotationToHydrate);

  installSavedContourTextOverrideForViewport({
    viewport,
    viewportId,
    toolName,
  });

  const toolHydratedAnnotation = hydrateWithToolClass({
    savedAnnotation: annotationToHydrate,
    viewportId,
    fallbackAnnotation: cornerstoneAnnotation,
    referencedImageId: cornerstoneAnnotation.metadata.referencedImageId,
    fallbackFrameOfReferenceUID,
  });

  if (toolHydratedAnnotation) {
    const hydratedAnnotationUID =
      toolHydratedAnnotation.annotationUID || toolHydratedAnnotation.uid || annotationUID;

    const targetAnnotation =
      csToolsAnnotation.state.getAnnotation?.(hydratedAnnotationUID) || toolHydratedAnnotation;

    patchContourCachedStatsFromSaved(
      targetAnnotation,
      annotationToHydrate,
      cornerstoneAnnotation.metadata.referencedImageId
    );

    applySavedContourDisplayTextOverride({
      targetAnnotation,
      savedAnnotation: annotationToHydrate,
      viewport,
      viewportId,
    });

    repatchSavedContourStatsAfterCornerstoneRecalc({
      annotationUID: hydratedAnnotationUID,
      savedAnnotation: annotationToHydrate,
      referencedImageId: cornerstoneAnnotation.metadata.referencedImageId,
      viewport,
    });

    if (selectAnnotation) {
      csToolsAnnotation.selection.setAnnotationSelected?.(hydratedAnnotationUID, true);
    }
    return targetAnnotation;
  }

  const existing = csToolsAnnotation.state.getAnnotation?.(annotationUID);

  if (existing) {
    const patchedExisting = patchHydratedAnnotationFromSaved({
      hydrated: existing,
      fallback: cornerstoneAnnotation,
      savedAnnotation: annotationToHydrate,
      referencedImageId: cornerstoneAnnotation.metadata.referencedImageId,
      fallbackFrameOfReferenceUID,
    });

    if (!patchedExisting) {
      return null;
    }

    applySavedContourDisplayTextOverride({
      targetAnnotation: patchedExisting,
      savedAnnotation: annotationToHydrate,
      viewport,
      viewportId,
    });

    patchContourCachedStatsFromSaved(
      patchedExisting,
      annotationToHydrate,
      cornerstoneAnnotation.metadata.referencedImageId
    );

    repatchSavedContourStatsAfterCornerstoneRecalc({
      annotationUID,
      savedAnnotation: annotationToHydrate,
      referencedImageId: cornerstoneAnnotation.metadata.referencedImageId,
      viewport,
    });

    if (selectAnnotation) {
      csToolsAnnotation.selection.setAnnotationSelected?.(annotationUID, true);
    }

    return patchedExisting;
  }

  const groupSelector =
    viewport?.element ||
    cornerstoneAnnotation.metadata.FrameOfReferenceUID ||
    viewportId ||
    cornerstoneAnnotation.metadata.referencedImageId;

  csToolsAnnotation.state.addAnnotation(cornerstoneAnnotation, groupSelector);

  applyReviewMeasurementAnnotationStyle({
    annotationUID,
    workflow: annotationToHydrate.workflow,
    measurementOwner: annotationToHydrate.measurementOwner,
  });

  applySavedContourDisplayTextOverride({
    targetAnnotation: cornerstoneAnnotation,
    savedAnnotation: annotationToHydrate,
    viewport,
    viewportId,
  });

  patchContourCachedStatsFromSaved(
    cornerstoneAnnotation,
    annotationToHydrate,
    cornerstoneAnnotation.metadata.referencedImageId
  );

  repatchSavedContourStatsAfterCornerstoneRecalc({
    annotationUID,
    savedAnnotation: annotationToHydrate,
    referencedImageId: cornerstoneAnnotation.metadata.referencedImageId,
    viewport,
  });

  if (selectAnnotation) {
    csToolsAnnotation.selection.setAnnotationSelected?.(annotationUID, true);
  }

  return cornerstoneAnnotation;
}

export async function hydrateMeasurementAnnotationsForSeriesDoc({
  servicesManager,
  seriesDoc,
  workflows,
  domains,
}: {
  servicesManager: any;
  seriesDoc: any;
  workflows?: string[];
  domains?: string[];
}) {
  const raw = seriesDoc?.MeasurementAnnotations;
  const requestedAnnotations = getRequestedWorkflowAnnotations(raw, workflows);
  const canonicalAnnotations = requestedAnnotations.filter(isCanonicalViewerMeasurementAnnotation);
  const savedAnnotations =
    Array.isArray(domains) && domains.length > 0
      ? canonicalAnnotations.filter(annotation => domains.includes(annotation?.domain))
      : canonicalAnnotations;

  if (!savedAnnotations.length) {
    return {
      seriesDoc,
      restoredCount: 0,
      skippedCount: 0,
      replacedCount: 0,
      restoredAnnotations: [],
      processedAnnotations: [],
    };
  }

  // Initial study-load hydration should be panel-only.
  // Visual viewport hydration should happen on explicit saved-row click/navigation,
  // after the referenced display set and image are active.
  const processedAnnotations = savedAnnotations.slice();

  return {
    seriesDoc,
    restoredCount: 0,
    skippedCount: 0,
    replacedCount: 0,
    restoredAnnotations: [],
    processedAnnotations,
  };
}

export async function hydrateMeasurementAnnotationsForActiveStudy({
  servicesManager,
  seriesDoc,
  workflows,
  domains,
}: {
  servicesManager: any;
  seriesDoc?: any;
  workflows?: string[];
  domains?: string[];
}) {
  const resolvedSeriesDoc = seriesDoc || (await fetchSeriesDocForActiveStudy(servicesManager));

  return hydrateMeasurementAnnotationsForSeriesDoc({
    servicesManager,
    seriesDoc: resolvedSeriesDoc,
    workflows,
    domains,
  });
}
