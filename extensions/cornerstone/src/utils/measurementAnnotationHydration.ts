import { annotation as csToolsAnnotation } from '@cornerstonejs/tools';
import { getRequestedWorkflowAnnotations } from './measurementAnnotations';
import { buildFormApiUrl } from './formApi';

const CONTOUR_TOOL_NAMES = new Set(['SplineROI', 'PlanarFreehandROI', 'LivewireContour']);

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

export async function fetchSeriesDocForActiveStudy(servicesManager) {
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

  if (studyInstanceId) {
    const studyResult = await fetchJsonIfOk(
      buildFormApiUrl(`series/study/${encodeURIComponent(studyInstanceId)}`)
    );

    if (studyResult.ok) {
      console.info('[MeasurementAnnotations] resolved by StudyInstanceUID', {
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

  throw new Error(
    `Series document lookup failed. StudyInstanceUID=${studyInstanceId || ''}, SeriesInstanceUID=${seriesInstanceId || ''}`
  );
}

function inferToolName(annotation) {
  return annotation?.toolName || '';
}

function isCanonicalViewerMeasurementAnnotation(annotation) {
  const annotationId = annotation?.uid || annotation?.annotationId;

  return !!(
    annotation &&
    annotation.workflow === 'viewerMeasurements' &&
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
        unit: measurements.lengthUnit || measurements.unit || '',
      },
    };
  }

  if (CONTOUR_TOOL_NAMES.has(toolName)) {
    const area = finiteNumberOrNull(measurements.area);

    if (area == null) {
      return {};
    }

    return {
      [targetId]: {
        area,
        areaUnit: measurements.areaUnit || '',
      },
    };
  }

  return {};
}

function buildCornerstoneAnnotation(annotation, fallbackFrameOfReferenceUID = '') {
  const annotationUID = annotation.uid || annotation.annotationId;
  const referencedImageId = annotation.referencedImageId;
  const points = Array.isArray(annotation.points) ? annotation.points : [];
  const toolName = inferToolName(annotation);
  const FrameOfReferenceUID = annotation.FrameOfReferenceUID || fallbackFrameOfReferenceUID || '';
  if (!annotationUID || !toolName || !referencedImageId || points.length === 0) {
    return null;
  }

  const data: any = {
    label: annotation.label || annotation.measurementRole || annotation.role || '',
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
    },
    data,
    highlighted: false,
    invalidated: true,
    isLocked: !!annotation.isLocked,
    isVisible: annotation.isVisible !== false,
  };
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
      restoredAnnotations: [],
      processedAnnotations: [],
    };
  }

  const restoredAnnotations = [];
  const processedAnnotations = [];
  let skippedCount = 0;
  let replacedCount = 0;

  const activeViewportInfo = getActiveViewportInfo(servicesManager);

  for (const savedAnnotation of savedAnnotations) {
    const toolName = inferToolName(savedAnnotation);

    // Domain extensions, such as iUSCAN, rebuild semantic panel state from these
    // canonical saved annotations. This is separate from visual Cornerstone restore.
    //
    // Important: Length annotations may be intentionally skipped for visual
    // restoration here, but they still must be returned to iUSCAN so repeated
    // measurement slots/averages can hydrate from canonical saved annotations.
    processedAnnotations.push(savedAnnotation);

    // Length annotations are intentionally not generically restored here.
    // They are still returned via processedAnnotations so panels can hydrate.
    // Saved-row click/navigation handles visual display on demand.
    if (toolName === 'Length') {
      skippedCount++;
      continue;
    }

    const cornerstoneAnnotation = buildCornerstoneAnnotation(
      savedAnnotation,
      activeViewportInfo.FrameOfReferenceUID
    );

    if (!cornerstoneAnnotation) {
      skippedCount++;
      continue;
    }

    const groupSelector =
      cornerstoneAnnotation.metadata.FrameOfReferenceUID ||
      activeViewportInfo.element ||
      savedAnnotation.referencedImageId;

    try {
      const existing = csToolsAnnotation.state.getAnnotation?.(cornerstoneAnnotation.annotationUID);

      if (existing) {
        csToolsAnnotation.state.removeAnnotation?.(cornerstoneAnnotation.annotationUID);
        replacedCount++;
      }

      csToolsAnnotation.state.addAnnotation(cornerstoneAnnotation, groupSelector);

      restoredAnnotations.push(savedAnnotation);

      console.info('[MeasurementAnnotations] restored annotation', {
        annotationUID: cornerstoneAnnotation.annotationUID,
        toolName: cornerstoneAnnotation.metadata.toolName,
        FrameOfReferenceUID: cornerstoneAnnotation.metadata.FrameOfReferenceUID,
        groupSelectorType:
          typeof groupSelector === 'string' ? 'string' : groupSelector ? 'element' : 'none',
        referencedImageId: savedAnnotation.referencedImageId,
      });
    } catch (error) {
      console.warn('[MeasurementAnnotations] restore failed:', error);
      skippedCount++;
    }
  }

  await sleep(10);

  try {
    const { triggerAnnotationRenderForViewportIds } = await import(
      '@cornerstonejs/tools/utilities'
    );
    if (activeViewportInfo.activeViewportId) {
      triggerAnnotationRenderForViewportIds([activeViewportInfo.activeViewportId]);
    }

    activeViewportInfo.viewport?.render?.();
  } catch (error) {
    console.warn('[MeasurementAnnotations] render trigger failed:', error);
  }

  await sleep(200);

  return {
    seriesDoc,
    restoredCount: restoredAnnotations.length,
    skippedCount,
    replacedCount,
    restoredAnnotations,
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
