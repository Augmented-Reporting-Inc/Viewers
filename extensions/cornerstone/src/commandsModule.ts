import {
  getEnabledElement,
  metaData,
  StackViewport,
  VolumeViewport,
  utilities as csUtils,
  Enums as CoreEnums,
  Types as CoreTypes,
  BaseVolumeViewport,
  getRenderingEngines,
  eventTarget,
} from '@cornerstonejs/core';
import {
  ToolGroupManager,
  Enums,
  utilities as cstUtils,
  annotation,
  Types as ToolTypes,
} from '@cornerstonejs/tools';
import * as cornerstoneTools from '@cornerstonejs/tools';
import * as labelmapInterpolation from '@cornerstonejs/labelmap-interpolation';
import { ONNXSegmentationController } from '@cornerstonejs/ai';

import { Types as OhifTypes, utils } from '@ohif/core';
import i18n from '@ohif/i18n';
import {
  callInputDialogAutoComplete,
  createReportAsync,
  colorPickerDialog,
  callInputDialog,
} from '@ohif/extension-default';
import { vec3, mat4 } from 'gl-matrix';
import toggleImageSliceSync from './utils/imageSliceSync/toggleImageSliceSync';
import { getFirstAnnotationSelected } from './utils/measurementServiceMappings/utils/selection';
import { getViewportEnabledElement } from './utils/getViewportEnabledElement';
import getActiveViewportEnabledElement from './utils/getActiveViewportEnabledElement';
import toggleVOISliceSync from './utils/toggleVOISliceSync';
import { usePositionPresentationStore, useSegmentationPresentationStore } from './stores';
import { toolNames } from './initCornerstoneTools';
import CornerstoneViewportDownloadForm from './utils/CornerstoneViewportDownloadForm';
import { updateSegmentBidirectionalStats } from './utils/updateSegmentationStats';
import { generateSegmentationCSVReport } from './utils/generateSegmentationCSVReport';
import { getUpdatedViewportsForSegmentation } from './utils/hydrationUtils';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import {
  REVIEWER_MEASUREMENTS_WORKFLOW,
  VIEWER_MEASUREMENTS_WORKFLOW,
  getRequestedWorkflowAnnotations,
  getViewerRepeatedMeasurementMetadata,
  isRepeatedViewerMeasurement,
  upsertViewerMeasurementAnnotations,
} from './utils/measurementAnnotations';
import {
  applyReviewMeasurementAnnotationStyle,
  ensureSeriesDocForActiveStudy,
  fetchSeriesDocForActiveStudy,
  hydrateSavedViewerAnnotationForViewport,
  hydrateMeasurementAnnotationsForActiveStudy as hydrateMeasurementAnnotationsForActiveStudyUtil,
} from './utils/measurementAnnotationHydration';
import { buildFormApiFetchOptions, buildFormApiUrl } from './utils/formApi';
import {
  LV_SIMPSON_MEASUREMENT_KIND,
  LV_TRACE_MEASUREMENT_LABELS_CONFIG,
  LV_TRACE_LABELS,
  LV_TRACE_REQUIRED_SLOTS,
  getLVTraceLabelForSlot,
  normalizeLVTraceSelection,
  parseLVTraceLabel,
} from './utils/lvTraceLabels';
import {
  LA_VOLUME_LABELS,
  LA_VOLUME_MEASUREMENT_KIND,
  LA_VOLUME_MEASUREMENT_LABELS_CONFIG,
  LA_VOLUME_REQUIRED_SLOTS,
  getLAVolumeLabelForSlot,
  normalizeLAVolumeSelection,
  parseLAVolumeLabel,
} from './utils/laVolumeLabels';
import {
  buildEchoVolumeContourFromBaseAxis,
  buildLVSimpsonContourFromHingeApex,
} from './utils/lvSimpsonContour';
import {
  SPECTRAL_DOPPLER_LABEL,
  SPECTRAL_DOPPLER_MEASUREMENT_KIND,
  buildSpectralDopplerDisplayText,
  calculateSpectralDopplerVTI,
  getSpectralDopplerSummaryText,
} from './utils/spectralDoppler';
import {
  buildViewerReportFieldUpdates,
  buildViewerReportMapping,
  getSpectralDopplerVtiTargetOptions,
  normalizeSpectralDopplerVtiTargetSelection,
} from './utils/viewerReportMapping';

const { DefaultHistoryMemo } = csUtils.HistoryMemo;
const toggleSyncFunctions = {
  imageSlice: toggleImageSliceSync,
  voi: toggleVOISliceSync,
};

const VIEWER_CONTOUR_TOOL_NAMES = new Set(
  [
    toolNames.SplineROI,
    'SplineROI',
    toolNames.PlanarFreehandROI,
    'PlanarFreehandROI',
    toolNames.LivewireContour,
    'LivewireContour',
  ].filter(Boolean)
);

const AR_LV_SIMPSON_SESSION_EVENT = 'ar-measurements:lv-simpson-session-updated';
const AR_LA_VOLUME_SESSION_EVENT = 'ar-measurements:la-volume-session-updated';

const lvSimpsonSessionMeasurementsByUid = new Map<string, any>();
const laVolumeSessionMeasurementsByUid = new Map<string, any>();
let activeLVSimpsonWorkflowSessionId = '';
let activeLAVolumeWorkflowSessionId = '';

const LV_SIMPSON_MIN_AXIS_MM = 25;
const LV_SIMPSON_MAX_AXIS_MM = 130;
const LV_SIMPSON_SLOT_PAIR_AXIS_WARNING_RATIO = 0.35;
const LV_SIMPSON_AUTO_CONTINUE_DELAY_MS = 250;
const LA_VOLUME_AUTO_CONTINUE_DELAY_MS = 250;

function getLVSimpsonAxisLengthFromMeasurement(measurement: any = {}) {
  const geometry = measurement?.lvSimpson || measurement?.measurements?.lvSimpson || {};
  const value = Number(geometry.longAxisLengthMM);

  return Number.isFinite(value) && value > 0 ? value : null;
}

function getLVSimpsonPairedSlot(slot = '') {
  const normalizedSlot = normalizeLVSimpsonSlot(slot);

  if (normalizedSlot === 'A4C_ED') {
    return 'A2C_ED';
  }
  if (normalizedSlot === 'A2C_ED') {
    return 'A4C_ED';
  }
  if (normalizedSlot === 'A4C_ES') {
    return 'A2C_ES';
  }
  if (normalizedSlot === 'A2C_ES') {
    return 'A4C_ES';
  }

  return '';
}

function getLVSimpsonAxisWarning({ slot, axisLengthMM, slotCandidates }) {
  if (!Number.isFinite(axisLengthMM) || axisLengthMM <= 0) {
    return 'Could not calculate the LV long-axis length.';
  }

  if (axisLengthMM < LV_SIMPSON_MIN_AXIS_MM || axisLengthMM > LV_SIMPSON_MAX_AXIS_MM) {
    return `LV long-axis length is ${axisLengthMM.toFixed(
      1
    )} mm, which is outside the expected range. Replace this slot.`;
  }

  const pairedSlot = getLVSimpsonPairedSlot(slot);
  const pairedMeasurements = pairedSlot ? slotCandidates.get(pairedSlot) || [] : [];
  const pairedAxis = pairedMeasurements
    .map(getLVSimpsonAxisLengthFromMeasurement)
    .find(value => Number.isFinite(value) && value > 0);

  if (!pairedAxis) {
    return '';
  }

  const longerAxis = Math.max(axisLengthMM, pairedAxis);
  const shorterAxis = Math.min(axisLengthMM, pairedAxis);
  const mismatchRatio = longerAxis > 0 ? (longerAxis - shorterAxis) / longerAxis : 1;

  if (mismatchRatio > LV_SIMPSON_SLOT_PAIR_AXIS_WARNING_RATIO) {
    return `${slot.replace('_', ' ')} long-axis length is ${axisLengthMM.toFixed(
      1
    )} mm but ${pairedSlot.replace('_', ' ')} is ${pairedAxis.toFixed(
      1
    )} mm. Replace this slot before calculating EF.`;
  }

  return '';
}

function getLVSimpsonSessionMeasurements() {
  return Array.from(lvSimpsonSessionMeasurementsByUid.values());
}

function dispatchLVSimpsonSessionMeasurements(detail = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent(AR_LV_SIMPSON_SESSION_EVENT, {
        detail: {
          ...detail,
          measurements: getLVSimpsonSessionMeasurements(),
        },
      })
    );
  } catch {}
}

function upsertLVSimpsonSessionMeasurement(measurement) {
  const uid = getMeasurementAnnotationId(measurement);

  if (!uid) {
    return;
  }

  lvSimpsonSessionMeasurementsByUid.set(uid, measurement);
  dispatchLVSimpsonSessionMeasurements({
    reason: 'lv-simpson-session-upsert',
    uid,
    slot: measurement?.slot || measurement?.lvSimpson?.slot || '',
  });
}

function removeLVSimpsonSessionMeasurement(uid = '') {
  const measurementUid = String(uid || '').trim();

  if (!measurementUid) {
    return;
  }

  const existing = lvSimpsonSessionMeasurementsByUid.get(measurementUid);
  lvSimpsonSessionMeasurementsByUid.delete(measurementUid);

  dispatchLVSimpsonSessionMeasurements({
    reason: 'lv-simpson-session-remove',
    uid: measurementUid,
    slot: existing?.slot || existing?.lvSimpson?.slot || '',
  });
}

function getLAVolumeSessionMeasurements() {
  return Array.from(laVolumeSessionMeasurementsByUid.values());
}

function dispatchLAVolumeSessionMeasurements(detail = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent(AR_LA_VOLUME_SESSION_EVENT, {
        detail: {
          ...detail,
          measurements: getLAVolumeSessionMeasurements(),
        },
      })
    );
  } catch {}
}

function upsertLAVolumeSessionMeasurement(measurement) {
  const uid = getMeasurementAnnotationId(measurement);

  if (!uid) {
    return;
  }

  laVolumeSessionMeasurementsByUid.set(uid, measurement);
  dispatchLAVolumeSessionMeasurements({
    reason: 'la-volume-session-upsert',
    uid,
    slot: measurement?.slot || measurement?.laVolume?.slot || '',
  });
}

function removeLAVolumeSessionMeasurement(uid = '') {
  const measurementUid = String(uid || '').trim();

  if (!measurementUid) {
    return;
  }

  const existing = laVolumeSessionMeasurementsByUid.get(measurementUid);
  laVolumeSessionMeasurementsByUid.delete(measurementUid);

  dispatchLAVolumeSessionMeasurements({
    reason: 'la-volume-session-remove',
    uid: measurementUid,
    slot: existing?.slot || existing?.laVolume?.slot || '',
  });
}

function mergeViewerMeasurementSnapshots(...sources: any[][]) {
  const measurementsWithoutId: any[] = [];
  const measurementsById = new Map<string, any>();

  for (const source of sources) {
    for (const measurement of Array.isArray(source) ? source : []) {
      const measurementId = getMeasurementAnnotationId(measurement);

      if (!measurementId) {
        measurementsWithoutId.push(measurement);
        continue;
      }

      // Later sources are more authoritative. Session measurements are used
      // only as a fallback until MeasurementService has caught up.
      measurementsById.set(measurementId, measurement);
    }
  }

  return [...measurementsWithoutId, ...measurementsById.values()];
}

function synchronizeViewerMeasurementSessionFallbacks(liveMeasurements: any[] = []) {
  let lvSimpsonChanged = false;
  let laVolumeChanged = false;

  for (const liveMeasurement of Array.isArray(liveMeasurements) ? liveMeasurements : []) {
    const measurementId = getMeasurementAnnotationId(liveMeasurement);

    if (!measurementId) {
      continue;
    }

    if (lvSimpsonSessionMeasurementsByUid.has(measurementId)) {
      lvSimpsonSessionMeasurementsByUid.set(measurementId, liveMeasurement);
      lvSimpsonChanged = true;
    }

    if (laVolumeSessionMeasurementsByUid.has(measurementId)) {
      laVolumeSessionMeasurementsByUid.set(measurementId, liveMeasurement);
      laVolumeChanged = true;
    }
  }

  if (lvSimpsonChanged) {
    dispatchLVSimpsonSessionMeasurements({
      reason: 'measurement-service-synchronized',
    });
  }

  if (laVolumeChanged) {
    dispatchLAVolumeSessionMeasurements({
      reason: 'measurement-service-synchronized',
    });
  }
}

function getCurrentViewerMeasurementSnapshot(measurementService: any) {
  const liveMeasurements = measurementService?.getMeasurements?.() || [];

  synchronizeViewerMeasurementSessionFallbacks(liveMeasurements);

  return mergeViewerMeasurementSnapshots(
    getLVSimpsonSessionMeasurements(),
    getLAVolumeSessionMeasurements(),
    liveMeasurements
  );
}

function isViewerContourTool(toolName) {
  return VIEWER_CONTOUR_TOOL_NAMES.has(toolName);
}

function normalizeViewerMeasurementDomain(value = '') {
  const domain = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (domain === 'iuscan') {
    return 'bowel';
  }

  return ['generic', 'echo', 'bowel'].includes(domain) ? domain : '';
}

function viewerMeasurementDomainsMatch(annotationDomain = '', requestedDomain = '') {
  const annotation = normalizeViewerMeasurementDomain(annotationDomain || 'generic') || 'generic';
  const requested = normalizeViewerMeasurementDomain(requestedDomain || 'generic') || 'generic';

  return requested === 'generic' || annotation === requested || annotation === 'generic';
}

function getExplicitViewerMeasurementDomain(explicitDomain = '') {
  const direct = normalizeViewerMeasurementDomain(explicitDomain);
  if (direct) {
    return direct;
  }

  try {
    const params = getViewerUrlSearchParams();
    return normalizeViewerMeasurementDomain(
      params.get('arMeasurementDomain') ||
        params.get('arViewerDomain') ||
        params.get('viewerDomain') ||
        ''
    );
  } catch {
    return '';
  }
}

function inferDomainFromSeriesDoc(seriesDoc, explicitDomain) {
  const requestedDomain = getExplicitViewerMeasurementDomain(explicitDomain);

  if (requestedDomain && requestedDomain !== 'generic') {
    return requestedDomain;
  }

  const storedMeasurementDomain = normalizeViewerMeasurementDomain(
    seriesDoc?.measurementDomain || seriesDoc?.studentPractice?.measurementDomain
  );

  if (storedMeasurementDomain && storedMeasurementDomain !== 'generic') {
    return storedMeasurementDomain;
  }

  const reportType = String(seriesDoc?.reportType || '').toLowerCase();
  const tenantId = String(seriesDoc?.tenantId || '').toLowerCase();
  const labels = Array.isArray(seriesDoc?.labels)
    ? seriesDoc.labels.map(label => String(label || '').toLowerCase())
    : [];
  const path = String(window.location?.pathname || '').toLowerCase();

  if (
    reportType === 'bowel' ||
    tenantId === 'ibd' ||
    tenantId === 'kga' ||
    tenantId === 'iuscan' ||
    labels.includes('tenant_ibd') ||
    labels.includes('tenant_kga') ||
    labels.includes('tenant_iuscan') ||
    path.includes('/bviewer')
  ) {
    return 'bowel';
  }

  if (
    reportType === 'echo' ||
    reportType === 'stress' ||
    reportType === 'stressecho' ||
    reportType === 'dobutamine' ||
    tenantId === 'prime' ||
    tenantId === 'mk' ||
    tenantId === 'hrmx' ||
    tenantId === 'cneat' ||
    tenantId === 'mohawk' ||
    tenantId === 'echocollege' ||
    tenantId === 'smp' ||
    labels.includes('tenant_prime') ||
    labels.includes('tenant_mk') ||
    labels.includes('tenant_hrmx') ||
    labels.includes('tenant_cneat') ||
    labels.includes('tenant_mohawk') ||
    labels.includes('tenant_echocollege') ||
    labels.includes('tenant_smp') ||
    path.includes('/rviewer') ||
    path.includes('/viewer') ||
    path.includes('/stressecho') ||
    path.includes('/dobutamine')
  ) {
    return 'echo';
  }

  return 'generic';
}

function inferDomainWithoutSeriesDoc(explicitDomain) {
  const requestedDomain = getExplicitViewerMeasurementDomain(explicitDomain);

  if (requestedDomain && requestedDomain !== 'generic') {
    return requestedDomain;
  }

  const params = getViewerUrlSearchParams();

  const integration = String(params.get('arIntegration') || '')
    .trim()
    .toLowerCase();

  if (integration === 'iuscan') {
    return 'bowel';
  }

  const urlDomain = getExplicitViewerMeasurementDomain();

  if (urlDomain) {
    return urlDomain;
  }

  const path = String(window.location?.pathname || '').toLowerCase();

  if (path.includes('/bviewer/iuscan')) {
    return 'bowel';
  }

  if (path.includes('/bviewer')) {
    return 'bowel';
  }

  if (path.includes('/learning')) {
    return 'generic';
  }

  // Local/dev longitudinal `/viewer` routes remain echo unless explicitly
  // identified as bowel/iUSCAN through the URL.
  return 'echo';
}

function cleanDialogText(value = '') {
  return String(value || '').trim();
}

function getMeasurementLabelDialogTitleForDomain(domain = '') {
  const normalizedDomain = cleanDialogText(domain)
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (normalizedDomain === 'iuscan' || normalizedDomain === 'bowel') {
    return 'Bowel Annotation';
  }

  if (normalizedDomain === 'echo') {
    return 'Echo Annotation';
  }

  if (normalizedDomain === 'ecg') {
    return 'ECG Annotation';
  }

  if (
    normalizedDomain === 'nuclear' ||
    normalizedDomain === 'nuclear-cardiology' ||
    normalizedDomain === 'nuccard'
  ) {
    return 'Nuclear Cardiology Annotation';
  }

  return 'Measurement Annotation';
}

function getMeasurementLabelDialogTitle(labelConfig, explicitTitle = '') {
  const directTitle = cleanDialogText(explicitTitle);

  if (directTitle) {
    return directTitle;
  }

  const config =
    labelConfig && typeof labelConfig === 'object' && !Array.isArray(labelConfig)
      ? labelConfig
      : {};

  return (
    cleanDialogText(config.dialogTitle) ||
    cleanDialogText(config.annotationTitle) ||
    cleanDialogText(config.title) ||
    getMeasurementLabelDialogTitleForDomain(config.domain)
  );
}

function normalizeMeasurementLabelConfigForDialog(labelConfig, explicitTitle = '') {
  if (!labelConfig) {
    return null;
  }

  const baseConfig = Array.isArray(labelConfig)
    ? {
        id: 'measurementLabels',
        labelOnMeasure: false,
        exclusive: true,
        items: labelConfig,
      }
    : labelConfig;

  const dialogTitle = getMeasurementLabelDialogTitle(baseConfig, explicitTitle);

  return {
    ...baseConfig,
    dialogTitle,
    annotationTitle: baseConfig.annotationTitle || dialogTitle,
    title: baseConfig.title || dialogTitle,
  };
}

function getAnnotationId(annotation) {
  return annotation?.uid || annotation?.annotationId;
}

function getSavedAnnotationViewportLabel(annotation: any = {}) {
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

function getFrameNumberFromReferencedImageId(referencedImageId = '') {
  const match = String(referencedImageId).match(/\/frames\/(\d+)/);
  const frame = Number(match?.[1]);

  return Number.isFinite(frame) && frame > 0 ? frame : 1;
}

function normalizeImageIdForCompare(imageId = '') {
  return String(imageId)
    .replace(/^wadors:/i, '')
    .replace(/^dicomweb:/i, '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .toLowerCase();
}

function getFrameNumberForAnnotation(annotation) {
  return annotation?.frameNumber && annotation.frameNumber > 1
    ? annotation.frameNumber
    : getFrameNumberFromReferencedImageId(annotation?.referencedImageId);
}

function getViewportImageIds(viewport) {
  try {
    const imageIds = viewport?.getImageIds?.();
    return Array.isArray(imageIds) ? imageIds : [];
  } catch {
    return [];
  }
}

async function waitForCurrentSavedAnnotationViewport({
  cornerstoneViewportService,
  viewportGridService,
  viewportId,
  annotation,
  attempts = 150,
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const activeViewportId = viewportGridService.getActiveViewportId();

    const latestViewport =
      cornerstoneViewportService.getCornerstoneViewport(viewportId) ||
      cornerstoneViewportService.getCornerstoneViewport(activeViewportId) ||
      null;

    if (
      latestViewport &&
      findImageIdIndexForSavedAnnotation(latestViewport, annotation).index >= 0
    ) {
      return latestViewport;
    }

    await sleep(100);
  }

  return null;
}

function findImageIdIndexForSavedAnnotation(viewport, annotation) {
  const imageIds = getViewportImageIds(viewport);
  const sopInstanceId = annotation?.SOPInstanceUID;
  const frameNumber = getFrameNumberForAnnotation(annotation);
  const savedReference = normalizeImageIdForCompare(annotation?.referencedImageId);

  if (!imageIds.length) {
    return {
      index: -1,
      imageId: '',
      imageIds,
    };
  }

  const expectedInstanceFrame =
    sopInstanceId && frameNumber
      ? `/instances/${String(sopInstanceId).toLowerCase()}/frames/${frameNumber}`
      : '';

  let index = imageIds.findIndex(imageId =>
    normalizeImageIdForCompare(imageId).includes(expectedInstanceFrame)
  );

  if (index < 0 && savedReference) {
    index = imageIds.findIndex(imageId => {
      const normalized = normalizeImageIdForCompare(imageId);
      return normalized === savedReference || normalized.endsWith(savedReference);
    });
  }

  return {
    index,
    imageId: index >= 0 ? imageIds[index] : '',
    imageIds,
  };
}

async function waitForSavedAnnotationImageMatch(viewport, annotation, attempts = 150) {
  let lastMatch = {
    index: -1,
    imageId: '',
    imageIds: [],
  };

  for (let i = 0; i < attempts; i++) {
    lastMatch = findImageIdIndexForSavedAnnotation(viewport, annotation);

    if (lastMatch.index >= 0) {
      return lastMatch;
    }

    await sleep(100);
  }

  return lastMatch;
}

async function jumpViewportToSavedAnnotationImage(viewport, annotation) {
  const match = await waitForSavedAnnotationImageMatch(viewport, annotation);

  if (match.index < 0) {
    console.warn(
      '[MeasurementAnnotations] could not find saved annotation imageId in viewport stack',
      {
        annotationId: getAnnotationId(annotation),
        SOPInstanceUID: annotation?.SOPInstanceUID,
        frameNumber: getFrameNumberForAnnotation(annotation),
        referencedImageId: annotation?.referencedImageId,
        imageIdCount: match.imageIds.length,
        firstImageId: match.imageIds[0],
        lastImageId: match.imageIds[match.imageIds.length - 1],
      }
    );

    return '';
  }

  try {
    if (viewport.setImageIdIndex) {
      await viewport.setImageIdIndex(match.index);
    } else if (viewport.element) {
      csUtils.jumpToSlice(viewport.element, {
        imageIndex: match.index,
      });
    }

    viewport.render?.();

    console.info('[MeasurementAnnotations] jumped to saved annotation imageId', {
      annotationId: getAnnotationId(annotation),
      imageIndex: match.index,
      actualImageId: match.imageId,
    });

    return match.imageId;
  } catch (error) {
    console.warn('[MeasurementAnnotations] failed to jump to saved annotation imageId:', error);
    return '';
  }
}

async function waitForViewportImageReady(viewport, expectedImageId = '', attempts = 50) {
  const normalizedExpectedImageId = normalizeImageIdForCompare(expectedImageId);
  let currentImageId = '';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    currentImageId = String(viewport?.getCurrentImageId?.() || '').trim();
    const normalizedCurrentImageId = normalizeImageIdForCompare(currentImageId);

    const imageMatches =
      !normalizedExpectedImageId ||
      (!!normalizedCurrentImageId &&
        (normalizedCurrentImageId === normalizedExpectedImageId ||
          normalizedCurrentImageId.endsWith(normalizedExpectedImageId) ||
          normalizedExpectedImageId.endsWith(normalizedCurrentImageId)));

    if (imageMatches && viewport?.getImageData?.()) {
      return currentImageId || expectedImageId;
    }

    await sleep(100);
  }

  return '';
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cloneSavedAnnotationPoints(points = []) {
  return Array.isArray(points)
    ? points.map(point => (Array.isArray(point) ? [...point] : point))
    : [];
}

function getSavedAnnotationImageKey(annotation: any = {}) {
  const referencedImageId = normalizeImageIdForCompare(annotation?.referencedImageId || '');

  if (referencedImageId) {
    return `image:${referencedImageId}`;
  }

  const sopInstanceId = String(annotation?.SOPInstanceUID || '')
    .trim()
    .toLowerCase();

  const frameNumber = getFrameNumberForAnnotation(annotation);

  return sopInstanceId ? `sop:${sopInstanceId}|frame:${frameNumber}` : '';
}

function getSavedAnnotationsForSameImage(annotations: any[] = [], referenceAnnotation: any = null) {
  const reference = referenceAnnotation || annotations[0];
  const imageKey = getSavedAnnotationImageKey(reference);
  const seen = new Set<string>();

  if (!imageKey) {
    return [];
  }

  return (Array.isArray(annotations) ? annotations : []).filter(annotation => {
    const annotationId = getAnnotationId(annotation);

    if (
      !annotationId ||
      seen.has(annotationId) ||
      getSavedAnnotationImageKey(annotation) !== imageKey
    ) {
      return false;
    }

    seen.add(annotationId);
    return true;
  });
}

function buildHydrationMetadata(annotation, displaySet) {
  return {
    toolName: annotation.toolName || 'Length',
    referencedImageId: annotation.referencedImageId,
    FrameOfReferenceUID: annotation.FrameOfReferenceUID || '',
    SOPInstanceUID: annotation.SOPInstanceUID,
    SeriesInstanceUID: annotation.SeriesInstanceUID || annotation.referenceSeriesUID,
    StudyInstanceUID: annotation.StudyInstanceUID || displaySet?.StudyInstanceUID,
  };
}

function buildLengthCachedStats(annotation, referencedImageIdOverride = '') {
  const referencedImageId = referencedImageIdOverride || annotation?.referencedImageId;
  const targetId = referencedImageId ? `imageId:${referencedImageId}` : '';
  const measurements = annotation?.measurements || {};
  const normalized = normalizeLengthValueAndUnit(
    measurements.length ?? measurements.value,
    measurements.lengthUnit || measurements.unit || ''
  );

  if (!targetId || normalized.value == null) {
    return {};
  }

  return {
    [targetId]: {
      length: normalized.value,
      unit: normalized.unit,
    },
  };
}

function hydrateSavedLengthAnnotationForActiveViewport({
  annotation: savedAnnotation,
  activeViewportId,
  referencedImageIdOverride = '',
  selectAnnotation = true,
}) {
  const annotationId = getAnnotationId(savedAnnotation);
  const points = cloneSavedAnnotationPoints(savedAnnotation?.points);
  const referencedImageId = referencedImageIdOverride || savedAnnotation.referencedImageId;

  if (!annotationId || points.length !== 2) {
    return null;
  }

  let hydrated = cornerstoneTools.annotation.state.getAnnotation?.(annotationId) || null;

  if (!hydrated) {
    try {
      if (cornerstoneTools.LengthTool?.hydrate) {
        hydrated = cornerstoneTools.LengthTool.hydrate(activeViewportId, points, {
          annotationUID: annotationId,
        });
      }
    } catch (error) {
      console.warn('[MeasurementAnnotations] LengthTool.hydrate failed:', error);
    }
  }

  const hydratedId = hydrated?.annotationUID || hydrated?.uid || annotationId;

  const targetAnnotation =
    cornerstoneTools.annotation.state.getAnnotation?.(hydratedId) || hydrated;

  if (!targetAnnotation) {
    return null;
  }

  targetAnnotation.annotationUID = hydratedId;

  targetAnnotation.metadata = {
    ...(targetAnnotation.metadata || {}),
    toolName: 'Length',
    referencedImageId,
    FrameOfReferenceUID:
      targetAnnotation.metadata?.FrameOfReferenceUID || savedAnnotation.FrameOfReferenceUID || '',
    SOPInstanceUID: savedAnnotation.SOPInstanceUID,
    SeriesInstanceUID: savedAnnotation.SeriesInstanceUID || savedAnnotation.referenceSeriesUID,
    StudyInstanceUID: savedAnnotation.StudyInstanceUID,
    arMeasurementWorkflow: savedAnnotation.workflow || '',
    arMeasurementReadOnly: !!savedAnnotation.isLocked,
    arMeasurementReviewRound: Number(savedAnnotation.reviewRound) || null,
  };

  targetAnnotation.data = {
    ...(targetAnnotation.data || {}),
    label: getSavedAnnotationViewportLabel(savedAnnotation),
    handles: {
      ...(targetAnnotation.data?.handles || {}),
      points,
      activeHandleIndex: null,
      textBox: {
        ...(targetAnnotation.data?.handles?.textBox || {}),
        hasMoved: false,
        worldPosition: points[0],
        worldBoundingBox: null,
      },
    },
    cachedStats: buildLengthCachedStats(savedAnnotation, referencedImageId),
    arMeasurementWorkflow: savedAnnotation.workflow || '',
    arMeasurementReadOnly: !!savedAnnotation.isLocked,
    arMeasurementReviewRound: Number(savedAnnotation.reviewRound) || null,
  };

  targetAnnotation.invalidated = false;
  targetAnnotation.isVisible = savedAnnotation.isVisible !== false;
  targetAnnotation.isLocked = !!savedAnnotation.isLocked;

  applyReviewMeasurementAnnotationStyle({
    annotationUID: hydratedId,
    workflow: savedAnnotation.workflow,
    measurementOwner: savedAnnotation.measurementOwner,
  });

  if (selectAnnotation) {
    cornerstoneTools.annotation.selection.setAnnotationSelected(hydratedId, true);
  }

  return targetAnnotation;
}

function getMeasurementDisplayText(measurement) {
  if (Array.isArray(measurement?.displayText)) {
    return measurement.displayText;
  }

  if (Array.isArray(measurement?.displayText?.primary)) {
    return measurement.displayText.primary;
  }

  return [];
}

function parseLengthDisplayText(displayText) {
  const text = Array.isArray(displayText) ? displayText.join(' ') : String(displayText || '');

  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Zµμ²^0-9/]+)?/);

  if (!match) {
    return {
      value: null,
      unit: '',
    };
  }

  return {
    value: Number(match[1]),
    unit: match[2] || '',
  };
}

function getLengthMeasurementPayload(measurement) {
  const displayText = getMeasurementDisplayText(measurement);
  const parsed = parseLengthDisplayText(displayText);

  const rawValue = measurement?.value ?? parsed.value;
  const rawUnit = measurement?.unit || parsed.unit || '';
  const normalized = normalizeLengthValueAndUnit(rawValue, rawUnit);
  const value = normalized.value ?? rawValue;
  const unit = normalized.unit;
  const nextDisplayText =
    Number.isFinite(Number(value)) && unit === 'mm'
      ? [`${formatLengthMM(Number(value))} mm`]
      : normalizeDisplayTextUnits(displayText, 'length');

  return {
    displayText: nextDisplayText,
    value,
    unit,
    length: value,
    lengthUnit: unit,
  };
}

function getArrowAnnotateText(measurement, existingAnnotation = null) {
  const directText = [
    measurement?.text,
    measurement?.measurements?.text,
    existingAnnotation?.text,
    existingAnnotation?.measurements?.text,
  ]
    .map(value => String(value || '').trim())
    .find(Boolean);

  if (directText) {
    return directText;
  }

  return (
    [...getMeasurementDisplayText(measurement), ...getMeasurementDisplayText(existingAnnotation)]
      .map(value => String(value || '').trim())
      .find(Boolean) || ''
  );
}

function getArrowAnnotateMeasurementPayload(measurement, existingAnnotation = null) {
  const text = getArrowAnnotateText(measurement, existingAnnotation);

  return {
    text,
    displayText: text ? [text] : [],
  };
}

function cloneViewerMeasurementMetadataVector(value) {
  if (Array.isArray(value)) {
    return [...value];
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value as ArrayLike<number>);
  }

  return undefined;
}

function getViewerMeasurementMetadataVector(measurement, existingAnnotation, key) {
  const value =
    measurement?.metadata?.[key] ||
    existingAnnotation?.[key] ||
    existingAnnotation?.metadata?.[key];

  return cloneViewerMeasurementMetadataVector(value);
}

function hasViewerMeasurementSemanticLabel(measurement) {
  return !!(
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.role ||
    measurement?.slot ||
    (measurement?.toolName === 'ArrowAnnotate' && getArrowAnnotateText(measurement))
  );
}

function isPersistableViewerMeasurement(measurement) {
  return !!(
    measurement?.toolName === 'Length' || hasViewerMeasurementSemanticLabel(measurement)
  );
}

function getExistingAnnotationsById(seriesDoc, workflow = VIEWER_MEASUREMENTS_WORKFLOW) {
  const annotations = getRequestedWorkflowAnnotations(seriesDoc?.MeasurementAnnotations, [
    workflow,
  ]);

  return new Map(
    annotations
      .filter(annotation => annotation?.annotationId || annotation?.uid)
      .map(annotation => [annotation.annotationId || annotation.uid, annotation])
  );
}

function getExistingScorableViewerAnnotations(seriesDoc, domain = '') {
  const annotations = Array.from(
    getExistingAnnotationsById(seriesDoc, VIEWER_MEASUREMENTS_WORKFLOW).values()
  );

  return annotations.filter(annotation => {
    if (!annotation || annotation.mode === 'repeated') {
      return false;
    }

    if (!annotation.toolName || !isPersistableViewerMeasurement(annotation)) {
      return false;
    }

    if (!(annotation.referencedImageId || annotation.points?.length)) {
      return false;
    }

    const annotationDomain = annotation.domain || 'generic';

    return (
      !domain ||
      domain === 'generic' ||
      annotationDomain === domain ||
      annotationDomain === 'generic'
    );
  });
}

function getLVSimpsonGeometry(measurement, existingAnnotation = null) {
  return (
    measurement?.lvSimpson ||
    measurement?.measurements?.lvSimpson ||
    measurement?.geometry?.lvSimpson ||
    existingAnnotation?.lvSimpson ||
    existingAnnotation?.measurements?.lvSimpson ||
    null
  );
}

function updateEchoVolumeGeometryFromMeasurement(geometry = {}, measurement: any = {}) {
  const points = Array.isArray(measurement?.points) ? measurement.points : [];

  if (points.length < 3) {
    return geometry;
  }

  const baseLeftPoint = points[0];
  const baseRightPoint = points[points.length - 1];
  const configuredAxisPointIndex = Number(geometry?.axisPointIndex);
  const fallbackAxisPointIndex = Math.floor((points.length - 1) / 2);
  const axisPointIndex =
    Number.isInteger(configuredAxisPointIndex) &&
    configuredAxisPointIndex > 0 &&
    configuredAxisPointIndex < points.length - 1
      ? configuredAxisPointIndex
      : fallbackAxisPointIndex;
  const axisPoint = points[axisPointIndex];

  if (
    !Array.isArray(baseLeftPoint) ||
    !Array.isArray(baseRightPoint) ||
    !Array.isArray(axisPoint)
  ) {
    return {
      ...geometry,
      contourPoints: points,
    };
  }

  const baseMidpoint = [
    (Number(baseLeftPoint[0]) + Number(baseRightPoint[0])) / 2,
    (Number(baseLeftPoint[1]) + Number(baseRightPoint[1])) / 2,
    (Number(baseLeftPoint[2] || 0) + Number(baseRightPoint[2] || 0)) / 2,
  ];
  const dx = Number(axisPoint[0]) - baseMidpoint[0];
  const dy = Number(axisPoint[1]) - baseMidpoint[1];
  const dz = Number(axisPoint[2] || 0) - baseMidpoint[2];
  const longAxisLengthMM = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    ...geometry,
    baseLeftPoint,
    baseRightPoint,
    baseMidpoint,
    axisPoint,
    axisPointIndex,
    contourPoints: points,
    ...(Number.isFinite(longAxisLengthMM) && longAxisLengthMM > 0
      ? { longAxisLengthMM }
      : {}),
  };
}

function getLVSimpsonMeasurementPayload(measurement, existingAnnotation = null) {
  const lvSimpson = getLVSimpsonGeometry(measurement, existingAnnotation);

  if (!lvSimpson) {
    return {};
  }

  const contourPoints = Array.isArray(measurement?.points) ? measurement.points : [];

  // SplineROI is a closed contour. Preserve the user-confirmed hinge/apex
  // geometry as the long-axis source of truth and update only the editable
  // contour shape. Re-deriving the hinge/apex from sampled spline endpoints
  // can collapse or move the axis and produce report values that disagree
  // with the guided LV Simpson workflow.
  const updatedGeometry = {
    ...(existingAnnotation?.measurements?.lvSimpson || {}),
    ...lvSimpson,
    ...(contourPoints.length >= 3 ? { contourPoints } : {}),
  };

  return {
    measurementKind: LV_SIMPSON_MEASUREMENT_KIND,
    lvSimpson: {
      ...updatedGeometry,
      apexPoint: updatedGeometry.apexPoint || updatedGeometry.axisPoint,
      axisPoint: updatedGeometry.axisPoint || updatedGeometry.apexPoint,
      measurementKind: LV_SIMPSON_MEASUREMENT_KIND,
    },
  };
}

function getLAVolumeGeometry(measurement, existingAnnotation = null) {
  return (
    measurement?.laVolume ||
    measurement?.measurements?.laVolume ||
    measurement?.geometry?.laVolume ||
    existingAnnotation?.laVolume ||
    existingAnnotation?.measurements?.laVolume ||
    null
  );
}

function getLAVolumeMeasurementPayload(measurement, existingAnnotation = null) {
  const laVolume = getLAVolumeGeometry(measurement, existingAnnotation);

  if (!laVolume) {
    return {};
  }

  const contourPoints = Array.isArray(measurement?.points) ? measurement.points : [];

  // SplineROI is a closed contour. Its first and last sampled points can be the
  // same point and its resampling can move indices, so the contour must never
  // redefine the user-confirmed annular endpoints or superior long-axis point.
  // Preserve the guided geometry and update only the editable contour shape.
  const updatedGeometry = {
    ...(existingAnnotation?.measurements?.laVolume || {}),
    ...laVolume,
    ...(contourPoints.length >= 3 ? { contourPoints } : {}),
  };

  return {
    measurementKind: LA_VOLUME_MEASUREMENT_KIND,
    laVolume: {
      ...updatedGeometry,
      superiorPoint: updatedGeometry.superiorPoint || updatedGeometry.axisPoint,
      axisPoint: updatedGeometry.axisPoint || updatedGeometry.superiorPoint,
      measurementKind: LA_VOLUME_MEASUREMENT_KIND,
    },
  };
}

function getSpectralDopplerGeometry(measurement, existingAnnotation = null) {
  return (
    measurement?.spectralDoppler ||
    measurement?.measurements?.spectralDoppler ||
    existingAnnotation?.spectralDoppler ||
    existingAnnotation?.measurements?.spectralDoppler ||
    null
  );
}

function isSpectralDopplerViewerMeasurement(measurement: any = {}) {
  const spectralDoppler = getSpectralDopplerGeometry(measurement, measurement);

  return (
    measurement?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND ||
    spectralDoppler?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND
  );
}

function getSpectralDopplerMeasurementPayload(
  measurement,
  existingAnnotation = null,
  displaySetService = null
) {
  const spectralDoppler = getSpectralDopplerGeometry(measurement, existingAnnotation);

  if (!spectralDoppler) {
    return {};
  }

  const dicomSource = displaySetService
    ? getInstanceForViewerMeasurement(displaySetService, measurement)
    : null;
  const recalculated = calculateSpectralDopplerVTI({
    points: measurement?.points || existingAnnotation?.points || [],
    referencedImageId:
      measurement?.referencedImageId || existingAnnotation?.referencedImageId || '',
    dicomSource,
  });
  const nextSpectralDoppler = {
    ...(existingAnnotation?.measurements?.spectralDoppler || {}),
    ...spectralDoppler,
    ...recalculated,
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
  };

  return {
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    spectralDoppler: nextSpectralDoppler,
    displayText: buildSpectralDopplerDisplayText(nextSpectralDoppler),
  };
}

function serializeViewerMeasurement(measurement, domain, existingAnnotation = null, options = {}) {
  const isArrowAnnotateMeasurement = measurement?.toolName === 'ArrowAnnotate';
  const arrowText = isArrowAnnotateMeasurement
    ? getArrowAnnotateText(measurement, existingAnnotation)
    : '';
  const label = measurement?.label || arrowText || '';
  const isContourMeasurement = isViewerContourTool(measurement?.toolName);
  const lvTrace = domain === 'echo' && isContourMeasurement ? parseLVTraceLabel(label) : null;
  const lvSimpson = getLVSimpsonGeometry(measurement, existingAnnotation);
  const laVolume = getLAVolumeGeometry(measurement, existingAnnotation);
  const spectralDoppler = getSpectralDopplerGeometry(measurement, existingAnnotation);
  const reportMapping =
    measurement?.reportMapping ||
    spectralDoppler?.reportMapping ||
    existingAnnotation?.reportMapping ||
    existingAnnotation?.spectralDoppler?.reportMapping ||
    existingAnnotation?.measurements?.spectralDoppler?.reportMapping ||
    null;
  const isLVSimpson = domain === 'echo' && !!lvSimpson;
  const isLAVolume = domain === 'echo' && !!laVolume;
  const isSpectralDoppler =
    measurement?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND ||
    spectralDoppler?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND;
  const frameNumber =
    measurement.frameNumber && measurement.frameNumber > 1
      ? measurement.frameNumber
      : getFrameNumberFromReferencedImageId(measurement.referencedImageId);

  const nextMeasurements = {
    ...(isContourMeasurement && !isSpectralDoppler
      ? buildContourMeasurementPayload(measurement, existingAnnotation, options.displaySetService)
      : isArrowAnnotateMeasurement
        ? getArrowAnnotateMeasurementPayload(measurement, existingAnnotation)
        : !isContourMeasurement
          ? getLengthMeasurementPayload(measurement)
          : {}),
    ...(isLVSimpson ? getLVSimpsonMeasurementPayload(measurement, existingAnnotation) : {}),
    ...(isLAVolume ? getLAVolumeMeasurementPayload(measurement, existingAnnotation) : {}),
    ...(isSpectralDoppler
      ? getSpectralDopplerMeasurementPayload(
          measurement,
          existingAnnotation,
          options.displaySetService
        )
      : {}),
  };

  const finalDisplayText =
    nextMeasurements?.displayText?.length > 0
      ? nextMeasurements.displayText
      : existingAnnotation?.displayText || [];

  const repeatedMeasurement = getViewerRepeatedMeasurementMetadata(measurement);
  const measurementMode = repeatedMeasurement ? 'repeated' : 'single';

  return {
    annotationId: measurement.uid,
    workflow: options.workflow || VIEWER_MEASUREMENTS_WORKFLOW,
    role: lvTrace?.slot || measurement?.slot || label,
    domain,
    mode: measurementMode,
    measurementRole: lvTrace?.label || measurement?.measurementRole || label,
    ...(repeatedMeasurement ? { repeatedMeasurement } : {}),

    uid: measurement.uid,
    label,
    toolName: measurement.toolName,

    ...(isArrowAnnotateMeasurement
      ? {
          text: arrowText,
          textBox: measurement?.textBox || existingAnnotation?.textBox || null,
        }
      : {}),

    ...(lvTrace
      ? {
          slot: lvTrace.slot,
          view: lvTrace.view,
          phase: lvTrace.phase,
        }
      : {}),

    ...(isLVSimpson
      ? {
          measurementKind: LV_SIMPSON_MEASUREMENT_KIND,
          slot: lvSimpson.slot || lvTrace?.slot || measurement?.slot,
          view: lvSimpson.view || lvTrace?.view || measurement?.view,
          phase: lvSimpson.phase || lvTrace?.phase || measurement?.phase,
          lvSimpson: nextMeasurements.lvSimpson,
        }
      : {}),

    ...(isLAVolume
      ? {
          measurementKind: LA_VOLUME_MEASUREMENT_KIND,
          slot: laVolume.slot || measurement?.slot,
          view: laVolume.view || measurement?.view,
          phase: laVolume.phase || measurement?.phase || 'ES',
          laVolume: nextMeasurements.laVolume,
        }
      : {}),

    ...(isSpectralDoppler
      ? {
          measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
          spectralDoppler: nextMeasurements.spectralDoppler,
          ...(reportMapping ? { reportMapping } : {}),
        }
      : {}),

    StudyInstanceUID: measurement.referenceStudyUID || '',
    SeriesInstanceUID: measurement.referenceSeriesUID || '',
    SOPInstanceUID: measurement.SOPInstanceUID,
    FrameOfReferenceUID: measurement.FrameOfReferenceUID || '',
    displaySetInstanceUID: measurement.displaySetInstanceUID || '',

    referenceSeriesUID: measurement.referenceSeriesUID,
    referencedImageId: measurement.referencedImageId,
    frameNumber,
    points: measurement.points,
    viewPlaneNormal: getViewerMeasurementMetadataVector(
      measurement,
      existingAnnotation,
      'viewPlaneNormal'
    ),
    viewUp: getViewerMeasurementMetadataVector(measurement, existingAnnotation, 'viewUp'),

    measurements: {
      ...(existingAnnotation?.measurements || {}),
      ...(nextMeasurements || {}),
    },
    displayText: finalDisplayText,
  };
}

function getMeasurementStats(measurement) {
  const statsByTarget = measurement?.data || {};
  const preferredKey = measurement?.referencedImageId
    ? `imageId:${measurement.referencedImageId}`
    : null;

  if (preferredKey && statsByTarget[preferredKey]) {
    return statsByTarget[preferredKey];
  }

  const firstKey = Object.keys(statsByTarget)[0];
  return firstKey ? statsByTarget[firstKey] : {};
}

function finiteNumberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function findMeasurementServiceMeasurementById(measurementService, measurementId = '') {
  const id = String(measurementId || '').trim();

  if (!id || !measurementService) {
    return null;
  }

  const direct = measurementService.getMeasurement?.(id);

  if (direct) {
    return direct;
  }

  const measurements = measurementService.getMeasurements?.() || [];

  return (
    measurements.find(measurement => {
      const ids = [
        measurement?.uid,
        measurement?.id,
        measurement?.annotationUID,
        measurement?.annotationId,
      ]
        .filter(Boolean)
        .map(value => String(value));

      return ids.includes(id);
    }) || null
  );
}

async function waitForViewerMeasurementServiceEntry(
  measurementService,
  measurementId = '',
  attempts = 40
) {
  const id = String(measurementId || '').trim();

  if (!id || !measurementService) {
    return null;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const measurement = findMeasurementServiceMeasurementById(measurementService, id);

    if (measurement) {
      return measurement;
    }

    await sleep(25);
  }

  return null;
}

function getSelectedMeasurementIdFromViewport(element) {
  const selectedAnnotationIds =
    cornerstoneTools.annotation.selection.getAnnotationsSelected?.() || [];

  if (selectedAnnotationIds?.[0]) {
    return String(selectedAnnotationIds[0] || '').trim();
  }

  try {
    const selectedAnnotation = element ? getFirstAnnotationSelected(element) : null;

    return String(
      selectedAnnotation?.annotationUID ||
        selectedAnnotation?.uid ||
        selectedAnnotation?.annotationId ||
        ''
    ).trim();
  } catch {
    return '';
  }
}

function getMeasurementValueAndUnitForQuiz(measurement) {
  const stats = getMeasurementStats(measurement);
  const displayText = getMeasurementDisplayText(measurement);
  const parsed = parseLengthDisplayText(displayText);

  const lengthValue =
    finiteNumberOrNull(measurement?.value) ??
    finiteNumberOrNull(measurement?.length) ??
    finiteNumberOrNull(stats?.length) ??
    finiteNumberOrNull(parsed.value);

  if (lengthValue != null) {
    const normalized = normalizeLengthValueAndUnit(
      lengthValue,
      measurement?.unit ||
        measurement?.lengthUnit ||
        stats?.unit ||
        stats?.lengthUnit ||
        parsed.unit ||
        ''
    );

    return {
      value: normalized.value ?? lengthValue,
      unit: normalized.unit,
      measurementKind: 'length',
    };
  }

  const areaValue =
    finiteNumberOrNull(measurement?.area) ??
    finiteNumberOrNull(stats?.area) ??
    finiteNumberOrNull(parsed.value);

  if (areaValue != null) {
    return {
      value: areaValue,
      unit: normalizeDisplayAreaUnit(
        measurement?.areaUnit || stats?.areaUnit || stats?.areaUnits || parsed.unit || ''
      ),
      measurementKind: 'area',
    };
  }

  return {
    value: null,
    unit: '',
    measurementKind: '',
  };
}

function roundQuizMeasurementValue(value, decimalPlaces = 2) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  const factor = Math.pow(10, decimalPlaces);
  return Math.round(numericValue * factor) / factor;
}

function roundQuizCoordinateValue(value, decimalPlaces = 2) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  const factor = Math.pow(10, decimalPlaces);
  return Math.round(numericValue * factor) / factor;
}

function buildViewerQuizTargetFromMeasurement(measurement, displaySetService = null) {
  const frameNumber =
    measurement?.frameNumber && measurement.frameNumber > 1
      ? measurement.frameNumber
      : getFrameNumberFromReferencedImageId(measurement?.referencedImageId);
  const instance = displaySetService
    ? getInstanceForViewerMeasurement(displaySetService, measurement)
    : null;

  return {
    studyInstanceUID: measurement?.referenceStudyUID || measurement?.StudyInstanceUID || '',
    seriesInstanceUID:
      measurement?.referenceSeriesUID ||
      measurement?.SeriesInstanceUID ||
      measurement?.metadata?.SeriesInstanceUID ||
      '',
    sopInstanceUID: measurement?.SOPInstanceUID || measurement?.metadata?.SOPInstanceUID || '',
    instanceNumber: getInstanceNumberFromSource(instance),
    displaySetInstanceUID:
      measurement?.displaySetInstanceUID || measurement?.metadata?.displaySetInstanceUID || '',
    referencedImageId:
      measurement?.referencedImageId || measurement?.metadata?.referencedImageId || '',
    frameNumber,
    frameIndex: frameNumber > 0 ? frameNumber - 1 : undefined,
  };
}

function getMeasurementDisplayLabel(measurement) {
  return (
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.role ||
    measurement?.description ||
    measurement?.finding?.CodeMeaning ||
    ''
  );
}

function buildViewerQuizAnswerFromMeasurement({
  measurement,
  question = {},
  measurementType = '',
  expectedUnit = '',
  displaySetService = null,
} = {}) {
  const valueAndUnit = getMeasurementValueAndUnitForQuiz(measurement);

  if (valueAndUnit.value == null) {
    return null;
  }

  const annotationId = String(
    measurement?.uid ||
      measurement?.annotationUID ||
      measurement?.annotationId ||
      measurement?.id ||
      ''
  ).trim();

  const questionAnswerConfig =
    question?.answerConfig && typeof question.answerConfig === 'object'
      ? question.answerConfig
      : {};

  const resolvedMeasurementType = String(
    measurementType ||
      questionAnswerConfig.measurementType ||
      measurement?.measurementType ||
      getMeasurementDisplayLabel(measurement) ||
      ''
  ).trim();

  const resolvedUnit = String(expectedUnit || questionAnswerConfig.unit || valueAndUnit.unit || '')
    .trim()
    .replace(/^px$/i, 'mm');

  const viewerTarget = buildViewerQuizTargetFromMeasurement(measurement, displaySetService);
  const displayText = getMeasurementDisplayText(measurement);
  const annotationSnapshot = serializeViewerMeasurement(measurement, 'generic', null, {
    workflow: VIEWER_MEASUREMENTS_WORKFLOW,
    displaySetService,
  });

  return {
    value: roundQuizMeasurementValue(valueAndUnit.value, 2),
    unit: resolvedUnit || valueAndUnit.unit || '',
    measurementType: resolvedMeasurementType,
    measurementKind: valueAndUnit.measurementKind,
    sourceAnnotationId: annotationId,
    viewerTarget,
    sourceRefs: {
      annotationId,
      measurementId: annotationId,
      toolName: measurement?.toolName || measurement?.metadata?.toolName || '',
      referencedImageId: viewerTarget.referencedImageId || '',
      displaySetInstanceUID: viewerTarget.displaySetInstanceUID || '',
      studyInstanceUID: viewerTarget.studyInstanceUID || '',
      seriesInstanceUID: viewerTarget.seriesInstanceUID || '',
      sopInstanceUID: viewerTarget.sopInstanceUID || '',
      frameNumber: viewerTarget.frameNumber || '',
    },
    reviewPayload: {
      label: getMeasurementDisplayLabel(measurement),
      toolName: measurement?.toolName || measurement?.metadata?.toolName || '',
      displayText,
      capturedAt: new Date().toISOString(),
      annotation: annotationSnapshot,
    },
  };
}

function readRawDicomValue(source, keys = []) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function readDicomValue(source, keys = []) {
  const value = readRawDicomValue(source, keys);

  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  if (Array.isArray(value?.Value)) {
    return value.Value[0];
  }

  return value;
}

function readDicomNumber(source, keys = []) {
  return finiteNumberOrNull(readDicomValue(source, keys));
}

function getDicomSequenceValues(source, keys = []) {
  const value = readRawDicomValue(source, keys);

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.Value)) {
    return value.Value;
  }

  return [value];
}

function getMeasurementPointCenter(points = []) {
  const validPoints = Array.isArray(points)
    ? points.filter(point => Array.isArray(point) && point.length >= 2)
    : [];

  if (!validPoints.length) {
    return null;
  }

  const sum = validPoints.reduce(
    (acc, point) => {
      acc.x += Number(point[0]) || 0;
      acc.y += Number(point[1]) || 0;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / validPoints.length,
    y: sum.y / validPoints.length,
  };
}

function normalizePhysicalUnitCode(unitCode) {
  if (unitCode === undefined || unitCode === null) {
    return null;
  }

  if (typeof unitCode === 'number') {
    return unitCode;
  }

  const text = String(unitCode).trim();
  const hexMatch = text.match(/^0*([0-9a-f]+)h$/i);

  if (hexMatch) {
    return parseInt(hexMatch[1], 16);
  }

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getPhysicalUnitScaleToMM(unitCode) {
  const code = normalizePhysicalUnitCode(unitCode);

  // DICOM US Region Calibration:
  // 0003H = cm, so cm/pixel -> mm/pixel requires × 10.
  if (code === 3) {
    return 10;
  }

  return null;
}

function getDisplaySetForViewerMeasurement(displaySetService, measurement) {
  if (!displaySetService || !measurement) {
    return null;
  }

  if (measurement.displaySetInstanceUID && displaySetService.getDisplaySetByUID) {
    const displaySet = displaySetService.getDisplaySetByUID(measurement.displaySetInstanceUID);

    if (displaySet) {
      return displaySet;
    }
  }

  const seriesInstanceId = measurement.referenceSeriesUID || measurement.SeriesInstanceUID;
  const sopInstanceId = measurement.SOPInstanceUID;

  if (sopInstanceId && displaySetService.getDisplaySetForSOPInstanceUID) {
    const displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
      sopInstanceId,
      seriesInstanceId
    );

    if (displaySet) {
      return displaySet;
    }
  }

  const seriesDisplaySets =
    seriesInstanceId && displaySetService.getDisplaySetsForSeries
      ? displaySetService.getDisplaySetsForSeries(seriesInstanceId) || []
      : [];

  return seriesDisplaySets[0] || null;
}

function getDisplaySetInstances(displaySet) {
  const candidates = [
    displaySet?.images,
    displaySet?.instances,
    displaySet?.instance,
    displaySet?.metadata?.images,
    displaySet?.metadata?.instances,
  ].filter(Boolean);

  return candidates.flatMap(candidate => (Array.isArray(candidate) ? candidate : [candidate]));
}

function getSopInstanceIdFromSource(source) {
  return (
    source?.SOPInstanceUID ||
    source?.sopInstanceUID ||
    source?.metadata?.SOPInstanceUID ||
    source?.Metadata?.SOPInstanceUID ||
    readDicomValue(source, ['SOPInstanceUID', '00080018', 'x00080018'])
  );
}

function getInstanceForViewerMeasurement(displaySetService, measurement) {
  const displaySet = getDisplaySetForViewerMeasurement(displaySetService, measurement);
  const instances = getDisplaySetInstances(displaySet);
  const sopInstanceId = measurement?.SOPInstanceUID;

  if (!instances.length) {
    return null;
  }

  if (!sopInstanceId) {
    return instances[0];
  }

  return (
    instances.find(
      instance => String(getSopInstanceIdFromSource(instance) || '') === sopInstanceId
    ) || instances[0]
  );
}

function getUltrasoundRegionsFromSource(source) {
  const candidates = [
    source,
    source?.metadata,
    source?.Metadata,
    source?.instance,
    source?.attributes,
    source?.dicom,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const regions = getDicomSequenceValues(candidate, [
      'SequenceOfUltrasoundRegions',
      'sequenceOfUltrasoundRegions',
      '00186011',
      'x00186011',
    ]);

    if (regions.length) {
      return regions;
    }
  }

  return [];
}

function normalizeUltrasoundRegion(region) {
  const minX = readDicomNumber(region, [
    'RegionLocationMinX0',
    'regionLocationMinX0',
    '00186018',
    'x00186018',
  ]);
  const minY = readDicomNumber(region, [
    'RegionLocationMinY0',
    'regionLocationMinY0',
    '0018601A',
    'x0018601A',
  ]);
  const maxX = readDicomNumber(region, [
    'RegionLocationMaxX1',
    'regionLocationMaxX1',
    '0018601C',
    'x0018601C',
  ]);
  const maxY = readDicomNumber(region, [
    'RegionLocationMaxY1',
    'regionLocationMaxY1',
    '0018601E',
    'x0018601E',
  ]);
  const physicalUnitsX = readDicomValue(region, [
    'PhysicalUnitsXDirection',
    'physicalUnitsXDirection',
    '00186024',
    'x00186024',
  ]);
  const physicalUnitsY = readDicomValue(region, [
    'PhysicalUnitsYDirection',
    'physicalUnitsYDirection',
    '00186026',
    'x00186026',
  ]);
  const physicalDeltaX = readDicomNumber(region, [
    'PhysicalDeltaX',
    'physicalDeltaX',
    '0018602C',
    'x0018602C',
  ]);
  const physicalDeltaY = readDicomNumber(region, [
    'PhysicalDeltaY',
    'physicalDeltaY',
    '0018602E',
    'x0018602E',
  ]);

  const xScale = getPhysicalUnitScaleToMM(physicalUnitsX);
  const yScale = getPhysicalUnitScaleToMM(physicalUnitsY);

  if (
    physicalDeltaX == null ||
    physicalDeltaY == null ||
    !xScale ||
    !yScale ||
    physicalDeltaX === 0 ||
    physicalDeltaY === 0
  ) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    column: Math.abs(physicalDeltaX) * xScale,
    row: Math.abs(physicalDeltaY) * yScale,
    unit: 'mm',
    source: 'SequenceOfUltrasoundRegions',
  };
}

function chooseUltrasoundRegionForPoints(regions = [], points = []) {
  const normalizedRegions = regions.map(normalizeUltrasoundRegion).filter(Boolean);

  if (!normalizedRegions.length) {
    return null;
  }

  const center = getMeasurementPointCenter(points);

  if (center) {
    const containingRegions = normalizedRegions
      .filter(region => {
        if (
          region.minX == null ||
          region.minY == null ||
          region.maxX == null ||
          region.maxY == null
        ) {
          return false;
        }

        return (
          center.x >= region.minX &&
          center.x <= region.maxX &&
          center.y >= region.minY &&
          center.y <= region.maxY
        );
      })
      .sort((a, b) => {
        const areaA = Math.abs((a.maxX - a.minX) * (a.maxY - a.minY));
        const areaB = Math.abs((b.maxX - b.minX) * (b.maxY - b.minY));
        return areaA - areaB;
      });

    if (containingRegions[0]) {
      return containingRegions[0];
    }
  }

  return normalizedRegions[0];
}

function getUltrasoundRegionPixelSpacingMM(measurement, displaySetService) {
  const instance = getInstanceForViewerMeasurement(displaySetService, measurement);
  const regions = getUltrasoundRegionsFromSource(instance);
  const region = chooseUltrasoundRegionForPoints(regions, measurement?.points);

  if (!region?.row || !region?.column) {
    return null;
  }

  return {
    row: region.row,
    column: region.column,
    unit: 'mm',
    source: region.source,
  };
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
    source: 'cornerstonePixelSpacing',
  };
}

function getImagePixelSpacingMMForMeasurement(measurement, displaySetService) {
  return (
    getUltrasoundRegionPixelSpacingMM(measurement, displaySetService) ||
    getCornerstonePixelSpacingMM(measurement?.referencedImageId)
  );
}

function formatAreaMM2(area) {
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

function formatLengthMM(length) {
  if (!Number.isFinite(length)) {
    return '';
  }

  if (length >= 100) {
    return length.toFixed(0);
  }

  if (length >= 10) {
    return length.toFixed(1);
  }

  return length.toFixed(2);
}

function normalizeDisplayLengthUnit(unit = '') {
  const normalizedUnit = stripMeasurementSourceSuffix(unit);
  return /px/i.test(normalizedUnit) ? 'mm' : normalizedUnit || 'mm';
}

function normalizeDisplayAreaUnit(unit = '') {
  return /px/i.test(String(unit || '')) ? 'mm²' : unit || 'mm²';
}

function stripMeasurementSourceSuffix(text = '') {
  return String(text || '')
    .replace(/\s+\bUS Region\b/gi, '')
    .replace(/\s+\bAR_US_REGION_CALIBRATION\b/gi, '')
    .trim();
}

function normalizeLengthValueAndUnit(value, unit = '') {
  const numericValue = finiteNumberOrNull(value);
  const normalizedUnit = normalizeDisplayLengthUnit(unit);
  const sourceUnit = stripMeasurementSourceSuffix(unit);

  if (numericValue == null) {
    return {
      value: null,
      unit: normalizedUnit,
    };
  }

  if (/^cm$/i.test(sourceUnit)) {
    return {
      value: numericValue * 10,
      unit: 'mm',
    };
  }

  return {
    value: numericValue,
    unit: normalizedUnit,
  };
}

function normalizeLengthDisplayTextLine(text = '') {
  return stripMeasurementSourceSuffix(text)
    .replace(/(-?\d+(?:\.\d+)?)\s*cm\b/gi, (_match, value) => {
      const millimeters = Number(value) * 10;
      return Number.isFinite(millimeters) ? `${formatLengthMM(millimeters)} mm` : _match;
    })
    .replace(/\bpx\b/gi, 'mm');
}

function normalizeDisplayTextUnits(displayText = [], unitType = 'length') {
  const nextUnit = unitType === 'area' ? 'mm²' : 'mm';

  return (Array.isArray(displayText) ? displayText : [String(displayText || '')])
    .filter(Boolean)
    .map(text => {
      if (unitType === 'length') {
        return normalizeLengthDisplayTextLine(text);
      }

      return stripMeasurementSourceSuffix(
        String(text)
          .replace(/\bpx²\b/gi, nextUnit)
          .replace(/\bpx\b/gi, nextUnit)
      );
    });
}

function buildContourMeasurementPayload(
  measurement,
  existingAnnotation = null,
  displaySetService = null
) {
  const stats = getMeasurementStats(measurement);
  const rawDisplayText =
    getMeasurementDisplayText(measurement).length > 0
      ? getMeasurementDisplayText(measurement)
      : existingAnnotation?.measurements?.displayText || existingAnnotation?.displayText || [];
  const displayText = normalizeDisplayTextUnits(rawDisplayText, 'area');

  const rawArea =
    finiteNumberOrNull(stats?.area) ?? finiteNumberOrNull(existingAnnotation?.measurements?.area);
  const rawAreaUnit = stats?.areaUnit || existingAnnotation?.measurements?.areaUnit || '';

  if (rawArea == null) {
    return {
      area: null,
      areaUnit: rawAreaUnit,
      displayText,
    };
  }

  const pixelSpacing = getImagePixelSpacingMMForMeasurement(measurement, displaySetService);
  const isPixelArea = /px/i.test(String(rawAreaUnit || ''));

  if (!pixelSpacing || !isPixelArea) {
    return {
      area: rawArea,
      areaUnit: rawAreaUnit,
      displayText,
    };
  }

  const areaMM2 = rawArea * pixelSpacing.row * pixelSpacing.column;

  return {
    area: areaMM2,
    areaUnit: 'mm²',
    pixelSpacing,
    displayText: [`${formatAreaMM2(areaMM2)} mm²`],
  };
}

function getSavedContourAreaForDisplay(savedAnnotation, referencedImageId = '') {
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

function getSavedAnnotationDisplayText(savedAnnotation) {
  const savedSpectralDoppler = getSpectralDopplerGeometry(savedAnnotation, savedAnnotation);

  if (
    savedAnnotation?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND ||
    savedSpectralDoppler?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND
  ) {
    return buildSpectralDopplerDisplayText(savedSpectralDoppler || {});
  }

  if (savedAnnotation?.toolName === 'ArrowAnnotate') {
    const text = getArrowAnnotateText(savedAnnotation);
    return text ? [text] : [];
  }
  const measurements = savedAnnotation?.measurements || {};
  const unitType = isViewerContourTool(savedAnnotation?.toolName) ? 'area' : 'length';

  if (Array.isArray(measurements.displayText) && measurements.displayText.length > 0) {
    return normalizeDisplayTextUnits(measurements.displayText, unitType);
  }

  if (Array.isArray(savedAnnotation?.displayText) && savedAnnotation.displayText.length > 0) {
    return normalizeDisplayTextUnits(savedAnnotation.displayText, unitType);
  }

  if (savedAnnotation?.toolName === 'Length') {
    const normalized = normalizeLengthValueAndUnit(
      measurements.length ?? measurements.value,
      measurements.lengthUnit || measurements.unit || ''
    );

    if (normalized.value != null) {
      return [`${formatLengthMM(normalized.value)} ${normalized.unit}`];
    }
  }

  if (isViewerContourTool(savedAnnotation?.toolName)) {
    const area = getSavedContourAreaForDisplay(savedAnnotation, savedAnnotation?.referencedImageId);

    if (area != null) {
      return [`${formatAreaMM2(area)} mm²`];
    }
  }

  return [];
}

function buildSavedAnnotationStatsForMeasurementService(savedAnnotation, referencedImageId = '') {
  if (savedAnnotation?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND) {
    return {};
  }

  const targetId = referencedImageId || savedAnnotation?.referencedImageId;
  const measurements = savedAnnotation?.measurements || {};
  const statsKey = targetId ? `imageId:${targetId}` : '';

  if (!statsKey) {
    return {};
  }

  if (savedAnnotation?.toolName === 'Length') {
    const normalized = normalizeLengthValueAndUnit(
      measurements.length ?? measurements.value,
      measurements.lengthUnit || measurements.unit || ''
    );

    if (normalized.value == null) {
      return {};
    }

    return {
      [statsKey]: {
        length: normalized.value,
        unit: normalized.unit,
      },
    };
  }

  if (isViewerContourTool(savedAnnotation?.toolName)) {
    const area = getSavedContourAreaForDisplay(
      savedAnnotation,
      referencedImageId || savedAnnotation?.referencedImageId || ''
    );

    if (area == null) {
      return {};
    }

    return {
      [statsKey]: {
        area,
        areaUnit: 'mm²',
        areaUnits: 'mm²',
        unit: 'mm',
      },
    };
  }

  return {};
}

function normalizeCornerstoneStatsTargetId(imageId = '') {
  const value = String(imageId || '').trim();

  if (!value) {
    return '';
  }

  if (/^(imageId|volumeId):/i.test(value)) {
    return value;
  }

  return `imageId:${value}`;
}

function getSavedAnnotationStatsTargetIds(savedAnnotation, referencedImageId = '') {
  return Array.from(
    new Set(
      [referencedImageId, savedAnnotation?.referencedImageId]
        .map(normalizeCornerstoneStatsTargetId)
        .filter(Boolean)
    )
  );
}

function removeInvalidCornerstoneCachedStatsKeys(cachedStats = {}) {
  return Object.fromEntries(
    Object.entries(cachedStats || {}).filter(([targetId]) =>
      /^(imageId|volumeId):/i.test(String(targetId || ''))
    )
  );
}

function buildSavedAnnotationStatsForCornerstone(savedAnnotation, referencedImageId = '') {
  if (savedAnnotation?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND) {
    return {};
  }

  const targetIds = getSavedAnnotationStatsTargetIds(savedAnnotation, referencedImageId);
  const measurements = savedAnnotation?.measurements || {};

  if (!targetIds.length) {
    return {};
  }

  if (savedAnnotation?.toolName === 'Length') {
    const normalized = normalizeLengthValueAndUnit(
      measurements.length ?? measurements.value,
      measurements.lengthUnit || measurements.unit || ''
    );

    if (normalized.value == null) {
      return {};
    }

    return Object.fromEntries(
      targetIds.map(targetId => [
        targetId,
        {
          length: normalized.value,
          unit: normalized.unit,
          lengthUnit: normalized.unit,
        },
      ])
    );
  }

  if (isViewerContourTool(savedAnnotation?.toolName)) {
    const area = getSavedContourAreaForDisplay(
      savedAnnotation,
      referencedImageId || savedAnnotation?.referencedImageId || ''
    );

    if (area == null) {
      return {};
    }

    return Object.fromEntries(
      targetIds.map(targetId => [
        targetId,
        {
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
        },
      ])
    );
  }

  return {};
}

function forceSavedAnnotationCornerstoneDisplay({ savedAnnotation, referencedImageId = '' }) {
  // Do not touch Length here. Length was already working, and LengthTool is
  // stricter about cachedStats target keys during render.
  if (!isViewerContourTool(savedAnnotation?.toolName)) {
    return;
  }

  const annotationId = getAnnotationId(savedAnnotation);
  const targetAnnotation = annotationId
    ? cornerstoneTools.annotation.state.getAnnotation?.(annotationId)
    : null;

  if (!targetAnnotation) {
    return;
  }

  const savedStats = buildSavedAnnotationStatsForCornerstone(savedAnnotation, referencedImageId);

  if (!Object.keys(savedStats).length) {
    return;
  }

  targetAnnotation.data = {
    ...(targetAnnotation.data || {}),
    arSavedMeasurementDisplayText: getSavedAnnotationDisplayText(savedAnnotation),
    cachedStats: {
      ...removeInvalidCornerstoneCachedStatsKeys(targetAnnotation.data?.cachedStats || {}),
      ...savedStats,
    },
  };

  targetAnnotation.invalidated = false;
  targetAnnotation.isVisible = savedAnnotation.isVisible !== false;
  targetAnnotation.isLocked = !!savedAnnotation.isLocked;
}

function forceSavedAnnotationDisplayEverywhere({
  measurementService,
  savedAnnotation,
  referencedImageId = '',
}) {
  if (isViewerContourTool(savedAnnotation?.toolName)) {
    forceSavedAnnotationCornerstoneDisplay({
      savedAnnotation,
      referencedImageId,
    });
  }

  forceSavedAnnotationMeasurementServiceDisplay({
    measurementService,
    savedAnnotation,
    referencedImageId,
  });
}

function getSavedMeasurementLabel(measurement) {
  return (
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.role ||
    measurement?.description ||
    ''
  );
}

function findMeasurementServiceMeasurementForSavedAnnotation(measurementService, savedAnnotation) {
  const annotationId = getAnnotationId(savedAnnotation);

  if (!annotationId) {
    return {
      updateId: '',
      measurement: null,
    };
  }

  const direct = measurementService.getMeasurement?.(annotationId);

  if (direct) {
    return {
      updateId: direct.uid || direct.annotationUID || annotationId,
      measurement: direct,
    };
  }

  const measurements = measurementService.getMeasurements?.() || [];

  const matched = measurements.find(measurement => {
    const ids = [
      measurement?.uid,
      measurement?.id,
      measurement?.annotationUID,
      measurement?.annotationId,
    ]
      .filter(Boolean)
      .map(value => String(value));

    if (ids.includes(String(annotationId))) {
      return true;
    }

    return (
      measurement?.SOPInstanceUID === savedAnnotation?.SOPInstanceUID &&
      measurement?.referencedImageId === savedAnnotation?.referencedImageId &&
      getSavedMeasurementLabel(measurement) === getSavedMeasurementLabel(savedAnnotation)
    );
  });

  return {
    updateId: matched?.uid || matched?.annotationUID || annotationId,
    measurement: matched || null,
  };
}

function forceSavedAnnotationMeasurementServiceDisplay({
  measurementService,
  savedAnnotation,
  referencedImageId = '',
}) {
  const annotationId = getAnnotationId(savedAnnotation);
  const { updateId, measurement: currentMeasurement } =
    findMeasurementServiceMeasurementForSavedAnnotation(measurementService, savedAnnotation);

  if (!annotationId || !currentMeasurement) {
    return;
  }

  const displayText = getSavedAnnotationDisplayText(savedAnnotation);
  const arrowText =
    savedAnnotation?.toolName === 'ArrowAnnotate' ? getArrowAnnotateText(savedAnnotation) : '';
  const stats = buildSavedAnnotationStatsForMeasurementService(savedAnnotation, referencedImageId);

  const resolvedReferencedImageId =
    referencedImageId ||
    savedAnnotation.referencedImageId ||
    currentMeasurement.referencedImageId ||
    '';

  const nextMeasurement = {
    ...currentMeasurement,
    label:
      savedAnnotation.label ||
      savedAnnotation.measurementRole ||
      savedAnnotation.role ||
      arrowText ||
      currentMeasurement.label,
    displayText,
    ...(savedAnnotation?.toolName === 'ArrowAnnotate'
      ? {
          textBox: savedAnnotation.textBox || currentMeasurement.textBox || null,
        }
      : {}),
    points: cloneSavedAnnotationPoints(savedAnnotation.points),
    referencedImageId: resolvedReferencedImageId,
    SOPInstanceUID: savedAnnotation.SOPInstanceUID || currentMeasurement.SOPInstanceUID,
    referenceSeriesUID:
      savedAnnotation.referenceSeriesUID ||
      savedAnnotation.SeriesInstanceUID ||
      currentMeasurement.referenceSeriesUID,
    referenceStudyUID: savedAnnotation.StudyInstanceUID || currentMeasurement.referenceStudyUID,
    FrameOfReferenceUID:
      savedAnnotation.FrameOfReferenceUID || currentMeasurement.FrameOfReferenceUID || '',
    ...(savedAnnotation?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND
      ? {
          measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
          spectralDoppler: getSpectralDopplerGeometry(savedAnnotation, savedAnnotation),
        }
      : {}),
    data: {
      ...(currentMeasurement.data || {}),
      ...stats,
    },
  };

  if (savedAnnotation.toolName === 'Length') {
    const measurements = savedAnnotation.measurements || {};
    const normalized = normalizeLengthValueAndUnit(
      measurements.length ?? measurements.value,
      measurements.lengthUnit || measurements.unit || ''
    );

    if (normalized.value != null) {
      nextMeasurement.value = normalized.value;
      nextMeasurement.unit = normalized.unit;
    }
  }

  if (
    isViewerContourTool(savedAnnotation.toolName) &&
    savedAnnotation?.measurementKind !== SPECTRAL_DOPPLER_MEASUREMENT_KIND
  ) {
    const measurements = savedAnnotation.measurements || {};
    const area = getSavedContourAreaForDisplay(
      savedAnnotation,
      referencedImageId || savedAnnotation?.referencedImageId || ''
    );

    if (area != null) {
      nextMeasurement.area = area;
      nextMeasurement.areaUnit = 'mm²';
    }
  }

  measurementService.update(updateId || annotationId, nextMeasurement, true);
}

const { segmentation: segmentationUtils } = cstUtils;

const getLabelmapTools = ({ toolGroupService }) => {
  const labelmapTools = [];
  const toolGroupIds = toolGroupService.getToolGroupIds();
  toolGroupIds.forEach(toolGroupId => {
    const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
    const tools = toolGroup.getToolInstances();
    // tools is an object with toolName as the key and tool as the value
    Object.keys(tools).forEach(toolName => {
      const tool = tools[toolName];
      if (
        tool instanceof cornerstoneTools.LabelmapBaseTool &&
        tool.shouldResolvePreviewRequests()
      ) {
        labelmapTools.push(tool);
      }
    });
  });
  return labelmapTools;
};

const getPreviewTools = ({ toolGroupService }) => {
  const labelmapTools = getLabelmapTools({ toolGroupService });

  const previewTools = labelmapTools.filter(tool => tool.acceptPreview || tool.rejectPreview);

  return previewTools;
};

const segmentAI = new ONNXSegmentationController({
  autoSegmentMode: true,
  models: {
    sam_b: [
      {
        name: 'sam-b-encoder',
        url: 'https://huggingface.co/schmuell/sam-b-fp16/resolve/main/sam_vit_b_01ec64.encoder-fp16.onnx',
        size: 180,
        key: 'encoder',
      },
      {
        name: 'sam-b-decoder',
        url: 'https://huggingface.co/schmuell/sam-b-fp16/resolve/main/sam_vit_b_01ec64.decoder.onnx',
        size: 17,
        key: 'decoder',
      },
    ],
  },
  modelName: 'sam_b',
});
let segmentAIEnabled = false;

const AR_SAVED_ANNOTATIONS_REFRESH_EVENT = 'ar-measurements:saved-annotations-updated';
const AR_LIVE_MEASUREMENTS_REFRESH_EVENT = 'ar-measurements:live-measurements-updated';

const VIEWER_LENGTH_LABEL_MODE_PROMPT = 'prompt';
const VIEWER_LENGTH_LABEL_MODE_MEASURE_ONLY = 'measure-only';
let viewerLengthLabelMode = VIEWER_LENGTH_LABEL_MODE_PROMPT;

function normalizeViewerLengthLabelMode(value = '') {
  return String(value || '').trim().toLowerCase() === VIEWER_LENGTH_LABEL_MODE_MEASURE_ONLY
    ? VIEWER_LENGTH_LABEL_MODE_MEASURE_ONLY
    : VIEWER_LENGTH_LABEL_MODE_PROMPT;
}

function dispatchSavedAnnotationsRefresh(detail = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent(AR_SAVED_ANNOTATIONS_REFRESH_EVENT, {
        detail,
      })
    );
  } catch {}
}

function dispatchLiveMeasurementsRefresh(detail = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent(AR_LIVE_MEASUREMENTS_REFRESH_EVENT, {
        detail,
      })
    );
  } catch {}
}

function getDisplaySetForSavedAnnotation(displaySetService, annotation) {
  const sopInstanceId = annotation?.SOPInstanceUID;
  const seriesInstanceId = annotation?.SeriesInstanceUID || annotation?.referenceSeriesUID;

  if (sopInstanceId && displaySetService.getDisplaySetForSOPInstanceUID) {
    const displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
      sopInstanceId,
      seriesInstanceId
    );

    if (displaySet) {
      return displaySet;
    }
  }

  const seriesDisplaySets = seriesInstanceId
    ? displaySetService.getDisplaySetsForSeries(seriesInstanceId) || []
    : [];

  return (
    seriesDisplaySets.find(displaySet => {
      if (displaySet?.SOPInstanceUID === sopInstanceId) {
        return true;
      }

      if (Array.isArray(displaySet?.images)) {
        return displaySet.images.some(image => image?.SOPInstanceUID === sopInstanceId);
      }

      if (Array.isArray(displaySet?.instances)) {
        return displaySet.instances.some(instance => instance?.SOPInstanceUID === sopInstanceId);
      }

      return false;
    }) || seriesDisplaySets[0]
  );
}

async function waitForDisplaySetForSavedAnnotation({
  displaySetService,
  viewportGridService,
  annotation,
  attempts = 150,
}) {
  let activeDisplaySet = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const activeViewportId = viewportGridService.getActiveViewportId();

    activeDisplaySet = getActiveViewportDisplaySet({
      viewportGridService,
      displaySetService,
      viewportId: activeViewportId,
    });

    const displaySet = displaySetContainsSavedAnnotation(activeDisplaySet, annotation)
      ? activeDisplaySet
      : getDisplaySetForSavedAnnotation(displaySetService, annotation);

    if (displaySet) {
      return {
        activeDisplaySet,
        displaySet,
      };
    }

    await sleep(100);
  }

  return {
    activeDisplaySet,
    displaySet: null,
  };
}

function getViewportsToUpdateSafely({
  hangingProtocolService,
  viewportId,
  displaySetInstanceId,
  viewportOptions,
  context = 'ViewerNavigation',
}) {
  let viewportsToUpdate = [];

  try {
    const hangingProtocolViewports = hangingProtocolService?.getViewportsRequireUpdate?.(
      viewportId,
      displaySetInstanceId
    );

    if (Array.isArray(hangingProtocolViewports) && hangingProtocolViewports.length > 0) {
      viewportsToUpdate = hangingProtocolViewports;
    }
  } catch (error) {
    console.warn(`[${context}] hanging protocol update unavailable; using direct viewport update`, {
      viewportId,
      displaySetInstanceId,
      error,
    });
  }

  if (!viewportsToUpdate.length && viewportId && displaySetInstanceId) {
    viewportsToUpdate = [
      {
        viewportId,
        displaySetInstanceUIDs: [displaySetInstanceId],
      },
    ];
  }

  if (viewportsToUpdate[0] && viewportOptions) {
    viewportsToUpdate[0] = {
      ...viewportsToUpdate[0],
      viewportOptions,
    };
  }

  return viewportsToUpdate;
}

function displaySetContainsSavedAnnotation(displaySet, annotation) {
  const sopInstanceId = String(annotation?.SOPInstanceUID || '').trim();

  if (!displaySet || !sopInstanceId) {
    return false;
  }

  if (String(displaySet?.SOPInstanceUID || '').trim() === sopInstanceId) {
    return true;
  }

  return getDisplaySetInstances(displaySet).some(
    instance => String(getSopInstanceIdFromSource(instance) || '').trim() === sopInstanceId
  );
}

function quizNumberOrNull(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeViewerQuizTarget(target = {}) {
  const source = target && typeof target === 'object' && !Array.isArray(target) ? target : {};

  const explicitFrameNumber =
    quizNumberOrNull(source.frameNumber ?? source.FrameNumber) ?? quizNumberOrNull(source.frame);
  const frameIndex = quizNumberOrNull(source.frameIndex);
  const frameNumber = explicitFrameNumber ?? (frameIndex !== null ? frameIndex + 1 : null);
  const imageIndex = quizNumberOrNull(source.imageIndex);

  return {
    studyInstanceId: String(source.studyInstanceUID || source.StudyInstanceUID || '').trim(),
    seriesInstanceId: String(source.seriesInstanceUID || source.SeriesInstanceUID || '').trim(),
    sopInstanceId: String(source.sopInstanceUID || source.SOPInstanceUID || '').trim(),
    displaySetInstanceId: String(source.displaySetInstanceUID || '').trim(),
    referencedImageId: String(source.referencedImageId || '').trim(),
    frameNumber,
    imageIndex,
  };
}

function hasViewerQuizTargetIdentity(target = {}) {
  return !!(
    target.displaySetInstanceId ||
    target.seriesInstanceId ||
    target.sopInstanceId ||
    target.referencedImageId ||
    Number.isFinite(target.imageIndex) ||
    Number.isFinite(target.frameNumber)
  );
}

function getDisplaySetForViewerQuizTarget(displaySetService, target = {}) {
  if (!displaySetService || !target) {
    return null;
  }

  if (target.displaySetInstanceId && displaySetService.getDisplaySetByUID) {
    const displaySet = displaySetService.getDisplaySetByUID(target.displaySetInstanceId);

    if (displaySet) {
      return displaySet;
    }
  }

  if (target.sopInstanceId && displaySetService.getDisplaySetForSOPInstanceUID) {
    const displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
      target.sopInstanceId,
      target.seriesInstanceId
    );

    if (displaySet) {
      return displaySet;
    }
  }

  const seriesDisplaySets =
    target.seriesInstanceId && displaySetService.getDisplaySetsForSeries
      ? displaySetService.getDisplaySetsForSeries(target.seriesInstanceId) || []
      : [];

  return seriesDisplaySets[0] || null;
}

function findImageIdIndexForViewerQuizTarget(viewport, target = {}) {
  const imageIds = getViewportImageIds(viewport);

  if (!imageIds.length) {
    return {
      index: -1,
      imageId: '',
      imageIds,
      source: 'no-images',
    };
  }

  const normalizedReference = normalizeImageIdForCompare(target.referencedImageId);

  if (normalizedReference) {
    const index = imageIds.findIndex(imageId => {
      const normalized = normalizeImageIdForCompare(imageId);
      return normalized === normalizedReference || normalized.endsWith(normalizedReference);
    });

    if (index >= 0) {
      return {
        index,
        imageId: imageIds[index],
        imageIds,
        source: 'referencedImageId',
      };
    }
  }

  if (target.sopInstanceId && Number.isFinite(target.frameNumber)) {
    const expectedInstanceFrame = `/instances/${String(target.sopInstanceId).toLowerCase()}/frames/${target.frameNumber}`;
    const index = imageIds.findIndex(imageId =>
      normalizeImageIdForCompare(imageId).includes(expectedInstanceFrame)
    );

    if (index >= 0) {
      return {
        index,
        imageId: imageIds[index],
        imageIds,
        source: 'sop-frame',
      };
    }
  }

  if (target.sopInstanceId) {
    const expectedInstance = `/instances/${String(target.sopInstanceId).toLowerCase()}`;
    const index = imageIds.findIndex(imageId =>
      normalizeImageIdForCompare(imageId).includes(expectedInstance)
    );

    if (index >= 0) {
      return {
        index,
        imageId: imageIds[index],
        imageIds,
        source: 'sop',
      };
    }
  }

  if (
    Number.isFinite(target.imageIndex) &&
    target.imageIndex >= 0 &&
    target.imageIndex < imageIds.length
  ) {
    return {
      index: target.imageIndex,
      imageId: imageIds[target.imageIndex],
      imageIds,
      source: 'imageIndex',
    };
  }

  if (Number.isFinite(target.frameNumber)) {
    const oneBasedIndex = target.frameNumber - 1;
    if (oneBasedIndex >= 0 && oneBasedIndex < imageIds.length) {
      return {
        index: oneBasedIndex,
        imageId: imageIds[oneBasedIndex],
        imageIds,
        source: 'frameNumber',
      };
    }
  }

  return {
    index: -1,
    imageId: '',
    imageIds,
    source: 'not-found',
  };
}

async function waitForViewerQuizTargetImageMatch(viewport, target = {}, attempts = 20) {
  let lastMatch = {
    index: -1,
    imageId: '',
    imageIds: [],
    source: 'not-started',
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastMatch = findImageIdIndexForViewerQuizTarget(viewport, target);

    if (lastMatch.index >= 0) {
      return lastMatch;
    }

    await sleep(100);
  }

  return lastMatch;
}

async function jumpViewportToViewerQuizTargetImage(viewport, target = {}) {
  const match = await waitForViewerQuizTargetImageMatch(viewport, target);

  if (match.index < 0) {
    console.warn('[ViewerQuiz] could not find target image in viewport stack', {
      target,
      imageIdCount: match.imageIds.length,
      firstImageId: match.imageIds[0],
      lastImageId: match.imageIds[match.imageIds.length - 1],
      source: match.source,
    });

    return {
      ok: false,
      reason: 'target-image-not-found',
      match,
    };
  }

  try {
    if (viewport.setImageIdIndex) {
      await viewport.setImageIdIndex(match.index);
    } else if (viewport.element) {
      csUtils.jumpToSlice(viewport.element, {
        imageIndex: match.index,
      });
    }

    viewport.render?.();

    console.info('[ViewerQuiz] jumped to target image', {
      imageIndex: match.index,
      actualImageId: match.imageId,
      source: match.source,
    });

    return {
      ok: true,
      imageIndex: match.index,
      imageId: match.imageId,
      source: match.source,
    };
  } catch (error) {
    console.warn('[ViewerQuiz] failed to jump to target image:', error);

    return {
      ok: false,
      reason: 'jump-failed',
      error,
      match,
    };
  }
}

function getSopInstanceIdFromImageId(imageId = '') {
  const match = String(imageId || '').match(/\/instances\/([^/]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function getInstanceNumberFromSource(source) {
  return readDicomNumber(source, ['InstanceNumber', 'instanceNumber', '00200013', 'x00200013']);
}

function getInstanceNumberForViewerQuizTarget({
  displaySet,
  sopInstanceId = '',
  imageIndex = -1,
  imageId = '',
} = {}) {
  const instances = getDisplaySetInstances(displaySet);
  const matchedInstance =
    instances.find(
      instance => String(getSopInstanceIdFromSource(instance) || '') === String(sopInstanceId || '')
    ) ||
    (Number.isFinite(Number(imageIndex)) && Number(imageIndex) >= 0
      ? instances[Number(imageIndex)]
      : null) ||
    instances[0];
  const displaySetInstanceNumber = getInstanceNumberFromSource(matchedInstance);

  if (Number.isFinite(Number(displaySetInstanceNumber))) {
    return Number(displaySetInstanceNumber);
  }

  const metadataCandidates = [
    metaData.get?.('instance', imageId),
    metaData.get?.('instanceModule', imageId),
    metaData.get?.('generalImageModule', imageId),
  ];

  for (const metadataSource of metadataCandidates) {
    const metadataInstanceNumber = getInstanceNumberFromSource(metadataSource);

    if (Number.isFinite(Number(metadataInstanceNumber))) {
      return Number(metadataInstanceNumber);
    }
  }

  return null;
}

function getActiveViewportDisplaySet({ viewportGridService, displaySetService, viewportId }) {
  const viewports = viewportGridService.getState?.()?.viewports;

  const viewportState = viewports?.get?.(viewportId) ?? viewports?.[viewportId];

  const displaySetInstanceId = viewportState?.displaySetInstanceUIDs?.[0] || '';

  if (!displaySetInstanceId || !displaySetService?.getDisplaySetByUID) {
    return null;
  }

  return displaySetService.getDisplaySetByUID(displaySetInstanceId) || null;
}

function getCurrentViewportImageInfo(viewport) {
  const imageIds = getViewportImageIds(viewport);
  const currentImageId =
    viewport?.getCurrentImageId?.() || imageIds[viewport?.getCurrentImageIdIndex?.()] || '';

  let imageIndex = Number(viewport?.getCurrentImageIdIndex?.());

  if (!Number.isFinite(imageIndex) || imageIndex < 0) {
    imageIndex = currentImageId ? imageIds.indexOf(currentImageId) : -1;
  }

  if ((!currentImageId || imageIndex < 0) && imageIds.length === 1) {
    return {
      imageId: imageIds[0],
      imageIndex: 0,
      imageIds,
    };
  }

  return {
    imageId: currentImageId || '',
    imageIndex,
    imageIds,
  };
}

function buildViewerQuizFrameAnswer({ viewport, displaySet, viewportId = '' } = {}) {
  const imageInfo = getCurrentViewportImageInfo(viewport);

  if (!imageInfo.imageId || imageInfo.imageIndex < 0) {
    return null;
  }

  const frameNumber = getFrameNumberFromReferencedImageId(imageInfo.imageId);
  const sopInstanceId =
    getSopInstanceIdFromImageId(imageInfo.imageId) ||
    displaySet?.SOPInstanceUID ||
    displaySet?.sopInstanceUID ||
    '';

  const selectedTarget = {
    studyInstanceUID: displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '',
    seriesInstanceUID: displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '',
    sopInstanceUID: sopInstanceId,
    instanceNumber: getInstanceNumberForViewerQuizTarget({
      displaySet,
      sopInstanceId,
      imageIndex: imageInfo.imageIndex,
      imageId: imageInfo.imageId,
    }),
    displaySetInstanceUID: displaySet?.displaySetInstanceUID || '',
    referencedImageId: imageInfo.imageId,
    frameNumber,
    frameIndex: frameNumber > 0 ? frameNumber - 1 : imageInfo.imageIndex,
    imageIndex: imageInfo.imageIndex,
    viewportId,
  };

  return {
    selectedTarget,
    viewerTarget: selectedTarget,
    sourceRefs: {
      referencedImageId: imageInfo.imageId,
      studyInstanceUID: selectedTarget.studyInstanceUID,
      seriesInstanceUID: selectedTarget.seriesInstanceUID,
      sopInstanceUID: selectedTarget.sopInstanceUID,
      instanceNumber: selectedTarget.instanceNumber,
      displaySetInstanceUID: selectedTarget.displaySetInstanceUID,
      frameNumber,
      imageIndex: imageInfo.imageIndex,
      imageCount: imageInfo.imageIds.length,
    },
    reviewPayload: {
      capturedAt: new Date().toISOString(),
      captureMode: 'currentViewportFrame',
    },
  };
}

function getCanvasPointFromMouseEvent(event, element) {
  const rect = element?.getBoundingClientRect?.();

  if (!rect) {
    return null;
  }

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function buildViewerQuizPointAnswer({ event, viewport, displaySet, viewportId = '' } = {}) {
  const imageInfo = getCurrentViewportImageInfo(viewport);
  const canvasPoint = getCanvasPointFromMouseEvent(event, viewport?.element);

  if (!imageInfo.imageId || imageInfo.imageIndex < 0 || !canvasPoint) {
    return null;
  }

  let worldPoint = null;
  try {
    worldPoint =
      typeof viewport?.canvasToWorld === 'function'
        ? viewport.canvasToWorld([canvasPoint.x, canvasPoint.y])
        : null;
  } catch {
    worldPoint = null;
  }

  const frameNumber = getFrameNumberFromReferencedImageId(imageInfo.imageId);
  const sopInstanceId =
    getSopInstanceIdFromImageId(imageInfo.imageId) ||
    displaySet?.SOPInstanceUID ||
    displaySet?.sopInstanceUID ||
    '';
  const pixelSpacing = getCornerstonePixelSpacingMM(imageInfo.imageId);
  const selectedTarget = {
    studyInstanceUID: displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '',
    seriesInstanceUID: displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '',
    sopInstanceUID: sopInstanceId,
    instanceNumber: getInstanceNumberForViewerQuizTarget({
      displaySet,
      sopInstanceId,
      imageIndex: imageInfo.imageIndex,
      imageId: imageInfo.imageId,
    }),
    displaySetInstanceUID: displaySet?.displaySetInstanceUID || '',
    referencedImageId: imageInfo.imageId,
    frameNumber,
    frameIndex: frameNumber > 0 ? frameNumber - 1 : imageInfo.imageIndex,
    imageIndex: imageInfo.imageIndex,
    viewportId,
  };

  const point =
    Array.isArray(worldPoint) && worldPoint.length >= 2
      ? {
          x: roundQuizCoordinateValue(worldPoint[0]),
          y: roundQuizCoordinateValue(worldPoint[1]),
          z: roundQuizCoordinateValue(worldPoint[2] || 0),
          coordinateSpace: 'world',
        }
      : {
          x: roundQuizCoordinateValue(canvasPoint.x),
          y: roundQuizCoordinateValue(canvasPoint.y),
          coordinateSpace: 'imagePixels',
          ...(pixelSpacing ? { pixelSpacing } : {}),
        };

  return {
    point,
    canvasPoint: {
      x: roundQuizCoordinateValue(canvasPoint.x),
      y: roundQuizCoordinateValue(canvasPoint.y),
      coordinateSpace: 'canvas',
    },
    viewerTarget: selectedTarget,
    selectedTarget,
    sourceRefs: {
      referencedImageId: imageInfo.imageId,
      studyInstanceUID: selectedTarget.studyInstanceUID,
      seriesInstanceUID: selectedTarget.seriesInstanceUID,
      sopInstanceUID: selectedTarget.sopInstanceUID,
      instanceNumber: selectedTarget.instanceNumber,
      displaySetInstanceUID: selectedTarget.displaySetInstanceUID,
      frameNumber,
      imageIndex: imageInfo.imageIndex,
      imageCount: imageInfo.imageIds.length,
      ...(pixelSpacing ? { pixelSpacing } : {}),
    },
    reviewPayload: {
      capturedAt: new Date().toISOString(),
      captureMode: 'viewerQuizPoint',
    },
  };
}

function captureNextViewerClickPoint({ viewport, displaySet, viewportId = '' } = {}) {
  const element = viewport?.element;

  if (!element) {
    return Promise.resolve({
      ok: false,
      reason: 'viewport-element-not-found',
    });
  }

  return new Promise(resolve => {
    const previousCursor = element.style.cursor;
    let done = false;

    function finish(result) {
      if (done) {
        return;
      }
      done = true;
      element.style.cursor = previousCursor;
      element.removeEventListener('click', handleClick, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      resolve(result);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish({
          ok: false,
          reason: 'cancelled',
        });
      }
    }

    function handleClick(event) {
      event.preventDefault();
      event.stopPropagation();

      const answer = buildViewerQuizPointAnswer({
        event,
        viewport,
        displaySet,
        viewportId,
      });

      if (!answer) {
        finish({
          ok: false,
          reason: 'point-capture-failed',
        });
        return;
      }

      finish({
        ok: true,
        answer,
      });
    }

    element.style.cursor = 'crosshair';
    element.addEventListener('click', handleClick, true);
    window.addEventListener('keydown', handleKeyDown, true);
  });
}

const AR_LV_SIMPSON_PREVIEW_CLASS = 'ar-lv-simpson-preview-overlay';

function setLVSimpsonViewportCursor(element, cursor = 'default') {
  if (!element) {
    return;
  }

  try {
    element.style.cursor = cursor;
    element.querySelectorAll?.('canvas, svg').forEach(node => {
      if (node?.style) {
        node.style.cursor = cursor;
      }
    });
  } catch {}
}

function restoreLVSimpsonViewportCursor(element, previousCursor = '') {
  const cursor =
    previousCursor && previousCursor !== 'none' && previousCursor !== 'url("")'
      ? previousCursor
      : 'default';

  setLVSimpsonViewportCursor(element, cursor);
}

function getWorldPointFromMouseEvent(event, viewport) {
  const canvasPoint = getCanvasPointFromMouseEvent(event, viewport?.element);

  if (!canvasPoint || !viewport?.canvasToWorld) {
    return null;
  }

  try {
    return viewport.canvasToWorld([canvasPoint.x, canvasPoint.y]);
  } catch {
    return null;
  }
}

function createLVSimpsonPreviewOverlay(element) {
  if (!element) {
    return null;
  }

  clearLVSimpsonPreviewOverlay(element);

  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.classList.add(AR_LV_SIMPSON_PREVIEW_CLASS);
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '25';

  const previousPosition = element.style.position;
  if (!previousPosition || previousPosition === 'static') {
    element.style.position = 'relative';
  }

  element.appendChild(overlay);

  return overlay;
}

function clearLVSimpsonPreviewOverlay(element) {
  try {
    element?.querySelectorAll?.(`.${AR_LV_SIMPSON_PREVIEW_CLASS}`)?.forEach(node => node.remove());
  } catch {}
}

function drawLVSimpsonPreview({ overlay, viewport, baseLeftPoint, baseRightPoint, apexPoint }) {
  if (!overlay || !viewport?.worldToCanvas || !baseLeftPoint || !baseRightPoint) {
    return;
  }

  overlay.replaceChildren();

  const svgns = 'http://www.w3.org/2000/svg';
  const baseLeftCanvas = viewport.worldToCanvas(baseLeftPoint);
  const baseRightCanvas = viewport.worldToCanvas(baseRightPoint);

  const addLine = (a, b, stroke = '#facc15') => {
    const line = document.createElementNS(svgns, 'line');
    line.setAttribute('x1', String(a[0]));
    line.setAttribute('y1', String(a[1]));
    line.setAttribute('x2', String(b[0]));
    line.setAttribute('y2', String(b[1]));
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', '2');
    overlay.appendChild(line);
  };

  const addCircle = point => {
    const circle = document.createElementNS(svgns, 'circle');
    circle.setAttribute('cx', String(point[0]));
    circle.setAttribute('cy', String(point[1]));
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', '#facc15');
    circle.setAttribute('stroke', '#111827');
    circle.setAttribute('stroke-width', '1');
    overlay.appendChild(circle);
  };

  addLine(baseLeftCanvas, baseRightCanvas);
  addCircle(baseLeftCanvas);
  addCircle(baseRightCanvas);

  if (!apexPoint) {
    return;
  }

  const apexCanvas = viewport.worldToCanvas(apexPoint);
  const contour = buildLVSimpsonContourFromHingeApex({
    baseLeftPoint,
    baseRightPoint,
    apexPoint,
  });

  if (contour?.points?.length) {
    const polyline = document.createElementNS(svgns, 'polyline');
    polyline.setAttribute(
      'points',
      contour.points
        .map(point => viewport.worldToCanvas(point))
        .map(point => `${point[0]},${point[1]}`)
        .join(' ')
    );
    polyline.setAttribute('fill', 'rgba(250, 204, 21, 0.12)');
    polyline.setAttribute('stroke', '#facc15');
    polyline.setAttribute('stroke-width', '2');
    overlay.appendChild(polyline);
  }

  const baseMidCanvas = [
    (baseLeftCanvas[0] + baseRightCanvas[0]) / 2,
    (baseLeftCanvas[1] + baseRightCanvas[1]) / 2,
  ];

  addLine(baseMidCanvas, apexCanvas, '#38bdf8');
  addCircle(apexCanvas);
}

function sanitizeContourTextLines(lines = []) {
  return (Array.isArray(lines) ? lines : [lines])
    .map(line => stripMeasurementSourceSuffix(line))
    .filter(Boolean);
}

function installLVSimpsonContourTextCleanupForViewport({ viewport, viewportId = '', toolName }) {
  if (!viewport || !toolName) {
    return;
  }

  let toolGroup = null;

  try {
    toolGroup =
      ToolGroupManager.getToolGroupForViewport?.(
        viewport.id || viewportId,
        viewport.renderingEngineId
      ) || ToolGroupManager.getToolGroupForViewport?.(viewport.id || viewportId);
  } catch {
    toolGroup = null;
  }

  const toolInstance = toolGroup?.getToolInstance?.(toolName);

  if (!toolInstance || toolInstance.__arLVSimpsonTextCleanupInstalled) {
    return;
  }

  const previousGetTextLines = toolInstance.configuration?.getTextLines;

  const nextConfiguration = {
    ...(toolInstance.configuration || {}),
    getTextLines: function (...args) {
      const lines =
        typeof previousGetTextLines === 'function' ? previousGetTextLines.call(this, ...args) : [];

      return sanitizeContourTextLines(lines);
    },
  };

  toolInstance.configuration = nextConfiguration;
  toolGroup?.setToolConfiguration?.(toolName, nextConfiguration, true);
  toolInstance.__arLVSimpsonTextCleanupInstalled = true;
}

function installSpectralDopplerTextOverrideForViewport({ viewport, viewportId = '' }) {
  if (!viewport) {
    return;
  }

  let toolGroup = null;

  try {
    toolGroup =
      ToolGroupManager.getToolGroupForViewport?.(
        viewport.id || viewportId,
        viewport.renderingEngineId
      ) || ToolGroupManager.getToolGroupForViewport?.(viewport.id || viewportId);
  } catch {
    toolGroup = null;
  }

  const toolName = toolNames.PlanarFreehandROI || 'PlanarFreehandROI';
  const toolInstance = toolGroup?.getToolInstance?.(toolName);

  if (!toolInstance || toolInstance.__arSpectralDopplerTextOverrideInstalled) {
    return;
  }

  const previousGetTextLines = toolInstance.configuration?.getTextLines;

  const getOverrideText = (...args) => {
    for (const arg of args) {
      const candidates = [arg?.data, arg?.annotation?.data, arg?.annotationData, arg].filter(Boolean);

      for (const candidate of candidates) {
        const overrideText =
          candidate?.arSpectralDopplerDisplayText || candidate?.arSavedMeasurementDisplayText;

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

      return typeof previousGetTextLines === 'function'
        ? previousGetTextLines.call(this, ...args)
        : [];
    },
  };

  toolInstance.configuration = nextConfiguration;
  toolGroup?.setToolConfiguration?.(toolName, nextConfiguration, true);
  toolInstance.__arSpectralDopplerTextOverrideInstalled = true;
}

function captureLVSimpsonDrag({ viewport, onPreview, isCancelled }) {
  const element = viewport?.element;

  if (!element) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    const previousCursor = element.style.cursor;
    let startWorld = null;
    let done = false;

    function finish(result) {
      if (done) {
        return;
      }

      done = true;
      restoreLVSimpsonViewportCursor(element, previousCursor);
      element.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      resolve(result);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    }

    function handleMouseDown(event) {
      if (isCancelled?.()) {
        finish(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      startWorld = getWorldPointFromMouseEvent(event, viewport);

      if (!startWorld) {
        finish(null);
        return;
      }

      window.addEventListener('mousemove', handleMouseMove, true);
      window.addEventListener('mouseup', handleMouseUp, true);
    }

    function handleMouseMove(event) {
      if (isCancelled?.()) {
        finish(null);
        return;
      }

      if (!startWorld) {
        return;
      }

      const currentWorld = getWorldPointFromMouseEvent(event, viewport);
      if (currentWorld) {
        onPreview?.({ startWorld, currentWorld });
      }
    }

    function handleMouseUp(event) {
      if (isCancelled?.()) {
        finish(null);
        return;
      }

      if (!startWorld) {
        finish(null);
        return;
      }

      const endWorld = getWorldPointFromMouseEvent(event, viewport);
      finish(endWorld ? { startWorld, endWorld } : null);
    }

    setLVSimpsonViewportCursor(element, 'crosshair');
    element.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
  });
}

function normalizeLVSimpsonSlot(slot = '') {
  const normalizedSlot = String(slot || '')
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, '_');

  return LV_TRACE_REQUIRED_SLOTS.includes(normalizedSlot) ? normalizedSlot : '';
}

function getLVSimpsonSlotLabel(slot = '') {
  return getLVTraceLabelForSlot(normalizeLVSimpsonSlot(slot));
}

function getLVSimpsonSlotDisplayName(slot = '') {
  const normalizedSlot = normalizeLVSimpsonSlot(slot);
  const label = getLVSimpsonSlotLabel(normalizedSlot);
  const parsed = parseLVTraceLabel(label);

  if (!parsed) {
    return normalizedSlot.replace('_', ' ');
  }

  const viewLabel = parsed.view === 'A4C' ? 'Apical 4-chamber' : 'Apical 2-chamber';
  const phaseLabel = parsed.phase === 'ED' ? 'end-diastole' : 'end-systole';

  return `${viewLabel} ${phaseLabel}`;
}

function buildLVSimpsonSlotSelection(slot = '') {
  const normalizedSlot = normalizeLVSimpsonSlot(slot);
  const label = getLVSimpsonSlotLabel(normalizedSlot);
  const slotInfo = parseLVTraceLabel(label);

  return slotInfo ? { label, slotInfo } : null;
}

function isLVSimpsonMeasurement(measurement: any = {}) {
  const measurementKind =
    measurement?.measurementKind ||
    measurement?.measurements?.measurementKind ||
    measurement?.lvSimpson?.measurementKind ||
    measurement?.measurements?.lvSimpson?.measurementKind;

  return !!(
    measurementKind === LV_SIMPSON_MEASUREMENT_KIND ||
    measurement?.lvSimpson ||
    measurement?.measurements?.lvSimpson
  );
}

function getLVSimpsonSlotFromMeasurement(measurement: any = {}) {
  if (!isLVSimpsonMeasurement(measurement)) {
    return '';
  }

  const geometry = measurement?.lvSimpson || measurement?.measurements?.lvSimpson || {};
  const directSlot = normalizeLVSimpsonSlot(geometry.slot || measurement?.slot);

  if (directSlot) {
    return directSlot;
  }

  const labelSlot = parseLVTraceLabel(
    geometry.label || measurement?.measurementRole || measurement?.label || measurement?.role || ''
  )?.slot;

  return normalizeLVSimpsonSlot(labelSlot);
}

function getLVSimpsonSlotCandidates(measurements: any[] = []) {
  const bySlot = new Map<string, any[]>();

  for (const measurement of Array.isArray(measurements) ? measurements : []) {
    const slot = getLVSimpsonSlotFromMeasurement(measurement);

    if (!slot) {
      continue;
    }

    if (!bySlot.has(slot)) {
      bySlot.set(slot, []);
    }

    bySlot.get(slot).push(measurement);
  }

  return bySlot;
}

function getNextMissingLVSimpsonSlot(slotCandidates: Map<string, any[]>) {
  return LV_TRACE_REQUIRED_SLOTS.find(slot => !slotCandidates.get(slot)?.length) || '';
}

function getLVSimpsonStepNumber(slot = '') {
  const index = LV_TRACE_REQUIRED_SLOTS.indexOf(normalizeLVSimpsonSlot(slot));

  return index >= 0 ? index + 1 : 1;
}

function getLVSimpsonExistingMeasurementIds(measurements: any[] = []) {
  return (Array.isArray(measurements) ? measurements : [])
    .map(getMeasurementAnnotationId)
    .filter(Boolean);
}

function getLVSimpsonSlotDialogConfig() {
  return {
    ...LV_TRACE_MEASUREMENT_LABELS_CONFIG,
    labelOnMeasure: false,
    items: LV_TRACE_LABELS,
  };
}

async function resolveLVSimpsonSlot({
  uiDialogService,
  customizationService,
  title = 'LV EF Slot',
  defaultSlot = 'A4C_ED',
} = {}) {
  const renderContent = customizationService.getCustomization('ui.labellingComponent');
  let value = null;
  const defaultValue = getLVSimpsonSlotLabel(defaultSlot) || 'LV-A4C-ED';

  try {
    value = await callInputDialogAutoComplete({
      uiDialogService,
      labelConfig: getLVSimpsonSlotDialogConfig(),
      renderContent,
      title,
    });
  } catch (error) {
    console.warn('[LV EF] slot autocomplete failed; falling back to text input:', error);

    value = await callInputDialog({
      uiDialogService,
      title,
      placeholder: 'Choose LV-A4C-ED, LV-A4C-ES, LV-A2C-ED, or LV-A2C-ES',
      defaultValue,
    });
  }

  const label = normalizeLVTraceSelection(value);
  const slotInfo = parseLVTraceLabel(label);

  return slotInfo ? { label, slotInfo } : null;
}

function normalizeLAVolumeSlot(slot = '') {
  const normalizedSlot = String(slot || '')
    .trim()
    .toUpperCase();

  return LA_VOLUME_REQUIRED_SLOTS.includes(normalizedSlot) ? normalizedSlot : '';
}

function getLAVolumeSlotLabel(slot = '') {
  return getLAVolumeLabelForSlot(normalizeLAVolumeSlot(slot));
}

function getLAVolumeSlotDisplayName(slot = '') {
  const normalizedSlot = normalizeLAVolumeSlot(slot);
  const viewLabel = normalizedSlot === 'A4C' ? 'Apical 4-chamber' : 'Apical 2-chamber';

  return `${viewLabel} at maximum LA volume (end-systole)`;
}

function buildLAVolumeSlotSelection(slot = '') {
  const normalizedSlot = normalizeLAVolumeSlot(slot);
  const label = getLAVolumeSlotLabel(normalizedSlot);
  const slotInfo = parseLAVolumeLabel(label);

  return slotInfo ? { label, slotInfo } : null;
}

function isLAVolumeMeasurement(measurement: any = {}) {
  const measurementKind =
    measurement?.measurementKind ||
    measurement?.measurements?.measurementKind ||
    measurement?.laVolume?.measurementKind ||
    measurement?.measurements?.laVolume?.measurementKind;

  return !!(
    measurementKind === LA_VOLUME_MEASUREMENT_KIND ||
    measurement?.laVolume ||
    measurement?.measurements?.laVolume
  );
}

function getLAVolumeSlotFromMeasurement(measurement: any = {}) {
  if (!isLAVolumeMeasurement(measurement)) {
    return '';
  }

  const geometry = measurement?.laVolume || measurement?.measurements?.laVolume || {};
  const directSlot = normalizeLAVolumeSlot(geometry.slot || measurement?.slot);

  if (directSlot) {
    return directSlot;
  }

  const labelSlot = parseLAVolumeLabel(
    geometry.label || measurement?.measurementRole || measurement?.label || measurement?.role || ''
  )?.slot;

  return normalizeLAVolumeSlot(labelSlot);
}

function getLAVolumeSlotCandidates(measurements: any[] = []) {
  const bySlot = new Map<string, any[]>();

  for (const measurement of Array.isArray(measurements) ? measurements : []) {
    const slot = getLAVolumeSlotFromMeasurement(measurement);

    if (!slot) {
      continue;
    }

    if (!bySlot.has(slot)) {
      bySlot.set(slot, []);
    }

    bySlot.get(slot).push(measurement);
  }

  return bySlot;
}

function getNextMissingLAVolumeSlot(slotCandidates: Map<string, any[]>) {
  return LA_VOLUME_REQUIRED_SLOTS.find(slot => !slotCandidates.get(slot)?.length) || '';
}

function getLAVolumeStepNumber(slot = '') {
  const index = LA_VOLUME_REQUIRED_SLOTS.indexOf(normalizeLAVolumeSlot(slot));
  return index >= 0 ? index + 1 : 1;
}

function getLAVolumeExistingMeasurementIds(measurements: any[] = []) {
  return (Array.isArray(measurements) ? measurements : [])
    .map(getMeasurementAnnotationId)
    .filter(Boolean);
}

function getLAVolumeSlotDialogConfig() {
  return {
    ...LA_VOLUME_MEASUREMENT_LABELS_CONFIG,
    labelOnMeasure: false,
    items: LA_VOLUME_LABELS,
  };
}

async function resolveLAVolumeSlot({
  uiDialogService,
  customizationService,
  title = 'LA Volume Slot',
  defaultSlot = 'A4C',
} = {}) {
  const renderContent = customizationService.getCustomization('ui.labellingComponent');
  let value = null;
  const defaultValue = getLAVolumeSlotLabel(defaultSlot) || 'LA-A4C-ES';

  try {
    value = await callInputDialogAutoComplete({
      uiDialogService,
      labelConfig: getLAVolumeSlotDialogConfig(),
      renderContent,
      title,
    });
  } catch (error) {
    console.warn('[LA Volume] slot autocomplete failed; falling back to text input:', error);

    value = await callInputDialog({
      uiDialogService,
      title,
      placeholder: 'Choose LA-A4C-ES or LA-A2C-ES',
      defaultValue,
    });
  }

  const label = normalizeLAVolumeSelection(value);
  const slotInfo = parseLAVolumeLabel(label);

  return slotInfo ? { label, slotInfo } : null;
}

function getSpectralDopplerVtiTargetDialogConfig({ allowGeneric = false } = {}) {
  return {
    id: 'spectralDopplerVtiReportTarget',
    labelOnMeasure: false,
    exclusive: true,
    items: getSpectralDopplerVtiTargetOptions({ includeGeneric: allowGeneric }),
  };
}

async function resolveSpectralDopplerVtiTarget({
  uiDialogService,
  customizationService,
  allowGeneric = false,
} = {}) {
  const renderContent = customizationService.getCustomization('ui.labellingComponent');
  const options = getSpectralDopplerVtiTargetOptions({ includeGeneric: allowGeneric });
  let value = null;

  try {
    value = await callInputDialogAutoComplete({
      uiDialogService,
      labelConfig: getSpectralDopplerVtiTargetDialogConfig({ allowGeneric }),
      renderContent,
      title: 'VTI Measurement Type',
    });
  } catch (error) {
    console.warn('[VTI Trace] target autocomplete failed; falling back to text input:', error);

    value = await callInputDialog({
      uiDialogService,
      title: 'VTI Measurement Type',
      placeholder: options.map(option => option.label).join(', '),
      defaultValue: options[0]?.label || 'LVOT VTI',
    });
  }

  return normalizeSpectralDopplerVtiTargetSelection(value, { allowGeneric });
}

const VIEWER_QUIZ_MARKER_OVERLAY_CLASS = 'ar-viewer-quiz-marker-overlay';

const VIEWER_QUIZ_MARKER_REVIEW_STYLES: Record<
  string,
  { border: string; background: string; color: string; borderStyle: string }
> = {
  neutral: {
    border: '#facc15',
    background: 'rgba(0, 0, 0, 0.75)',
    color: '#fef3c7',
    borderStyle: 'solid',
  },
  learner: {
    border: '#38bdf8',
    background: 'rgba(8, 47, 73, 0.9)',
    color: '#e0f2fe',
    borderStyle: 'solid',
  },
  gold: {
    border: '#c084fc',
    background: 'rgba(59, 7, 100, 0.9)',
    color: '#f3e8ff',
    borderStyle: 'solid',
  },
  correct: {
    border: '#22c55e',
    background: 'rgba(20, 83, 45, 0.9)',
    color: '#dcfce7',
    borderStyle: 'solid',
  },
  incorrect: {
    border: '#ef4444',
    background: 'rgba(127, 29, 29, 0.9)',
    color: '#fee2e2',
    borderStyle: 'solid',
  },
  missed: {
    border: '#f59e0b',
    background: 'rgba(120, 53, 15, 0.9)',
    color: '#fef3c7',
    borderStyle: 'dashed',
  },
};

function getViewerQuizMarkerReviewStyle(marker = {}) {
  const reviewState = String(marker?.reviewState || marker?.variant || 'neutral').trim();

  return VIEWER_QUIZ_MARKER_REVIEW_STYLES[reviewState] || VIEWER_QUIZ_MARKER_REVIEW_STYLES.neutral;
}

function clearViewerQuizMarkerOverlayForElement(element) {
  try {
    element
      ?.querySelectorAll?.(`.${VIEWER_QUIZ_MARKER_OVERLAY_CLASS}`)
      ?.forEach(node => node.remove());
  } catch {}
}

function clearAllViewerQuizMarkerOverlays() {
  try {
    document
      ?.querySelectorAll?.(`.${VIEWER_QUIZ_MARKER_OVERLAY_CLASS}`)
      ?.forEach(node => node.remove());
  } catch {}
}

function getCanvasPointForViewerQuizMarker(viewport, marker = {}) {
  const point = marker?.point || marker;
  const coordinateSpace = String(point?.coordinateSpace || marker?.coordinateSpace || '').trim();

  if (coordinateSpace === 'world' && typeof viewport?.worldToCanvas === 'function') {
    try {
      const canvasPoint = viewport.worldToCanvas([
        Number(point.x),
        Number(point.y),
        Number(point.z || 0),
      ]);

      if (Array.isArray(canvasPoint) && canvasPoint.length >= 2) {
        return {
          x: canvasPoint[0],
          y: canvasPoint[1],
        };
      }
    } catch {}
  }

  if (Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))) {
    return {
      x: Number(point.x),
      y: Number(point.y),
    };
  }

  return null;
}

function getViewerQuizMarkerToleranceRadiusPx(viewport, marker = {}, canvasPoint = null) {
  const radius = Number(marker?.toleranceRadius);

  if (!Number.isFinite(radius) || radius <= 0 || !canvasPoint) {
    return 0;
  }

  const radiusUnit = String(marker?.toleranceRadiusUnit || '')
    .trim()
    .toLowerCase();

  if (
    radiusUnit === 'canvas' ||
    radiusUnit === 'pixel' ||
    radiusUnit === 'pixels' ||
    radiusUnit === 'imagepixel' ||
    radiusUnit === 'imagepixels'
  ) {
    return radius;
  }

  const point = marker?.point || marker;
  const pointCoordinateSpace = String(point?.coordinateSpace || marker?.coordinateSpace || '')
    .trim()
    .toLowerCase();
  const pixelSpacing =
    point?.pixelSpacing || marker?.pixelSpacing || marker?.sourceRefs?.pixelSpacing || null;
  const rowSpacing = Number(pixelSpacing?.row ?? pixelSpacing?.rowPixelSpacing);
  const columnSpacing = Number(pixelSpacing?.column ?? pixelSpacing?.columnPixelSpacing);

  if (
    (radiusUnit === 'mm' || radiusUnit === 'world') &&
    ['canvas', 'pixel', 'pixels', 'imagepixel', 'imagepixels'].includes(pointCoordinateSpace) &&
    Number.isFinite(rowSpacing) &&
    Number.isFinite(columnSpacing) &&
    rowSpacing > 0 &&
    columnSpacing > 0
  ) {
    const averageSpacing = (rowSpacing + columnSpacing) / 2;
    return radius / averageSpacing;
  }

  const worldPoint = [Number(point?.x), Number(point?.y), Number(point?.z || 0)];

  if (
    String(point?.coordinateSpace || marker?.coordinateSpace || '').trim() !== 'world' ||
    worldPoint.some(value => !Number.isFinite(value)) ||
    typeof viewport?.worldToCanvas !== 'function'
  ) {
    return radius;
  }

  try {
    const camera = viewport.getCamera?.() || {};
    const viewUp = Array.isArray(camera.viewUp) ? camera.viewUp : [0, 1, 0];
    const viewPlaneNormal = Array.isArray(camera.viewPlaneNormal)
      ? camera.viewPlaneNormal
      : [0, 0, 1];
    const right = vec3.create();
    vec3.cross(right, viewUp, viewPlaneNormal);

    if (vec3.length(right) === 0) {
      vec3.set(right, 1, 0, 0);
    } else {
      vec3.normalize(right, right);
    }

    const edgeWorld = vec3.scaleAndAdd(vec3.create(), worldPoint as any, right, radius);
    const edgeCanvas = viewport.worldToCanvas(edgeWorld);

    if (Array.isArray(edgeCanvas) && edgeCanvas.length >= 2) {
      return Math.hypot(edgeCanvas[0] - canvasPoint.x, edgeCanvas[1] - canvasPoint.y);
    }
  } catch {}

  return radius;
}

function appendViewerQuizToleranceCircle({ viewport, point, radius, radiusUnit = 'world' } = {}) {
  const element = viewport?.element;

  if (!element || !point) {
    return false;
  }

  const canvasPoint = getCanvasPointForViewerQuizMarker(viewport, {
    point,
    coordinateSpace: point.coordinateSpace || 'world',
  });

  if (!canvasPoint) {
    return false;
  }

  const toleranceRadiusPx = getViewerQuizMarkerToleranceRadiusPx(
    viewport,
    {
      point,
      coordinateSpace: point.coordinateSpace || 'world',
      toleranceRadius: radius,
      toleranceRadiusUnit: radiusUnit,
    },
    canvasPoint
  );

  if (!(toleranceRadiusPx > 0)) {
    return false;
  }

  const previousPosition = element.style.position;
  if (!previousPosition || previousPosition === 'static') {
    element.style.position = 'relative';
  }

  const toleranceNode = document.createElement('div');
  toleranceNode.className = VIEWER_QUIZ_MARKER_OVERLAY_CLASS;
  toleranceNode.dataset.reviewState = 'gold-tolerance';
  toleranceNode.style.position = 'absolute';
  toleranceNode.style.left = `${canvasPoint.x}px`;
  toleranceNode.style.top = `${canvasPoint.y}px`;
  toleranceNode.style.width = `${toleranceRadiusPx * 2}px`;
  toleranceNode.style.height = `${toleranceRadiusPx * 2}px`;
  toleranceNode.style.transform = 'translate(-50%, -50%)';
  toleranceNode.style.zIndex = '29';
  toleranceNode.style.pointerEvents = 'none';
  toleranceNode.style.border = '2px dashed #c084fc';
  toleranceNode.style.background = 'rgba(192, 132, 252, 0.08)';
  toleranceNode.style.borderRadius = '9999px';
  element.appendChild(toleranceNode);

  return true;
}

function getViewerQuizMeasurementPoints(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const reviewPayload =
    source.reviewPayload &&
    typeof source.reviewPayload === 'object' &&
    !Array.isArray(source.reviewPayload)
      ? source.reviewPayload
      : {};
  const annotationSnapshot =
    source.annotation ||
    source.annotationSnapshot ||
    reviewPayload.annotation ||
    reviewPayload.annotationSnapshot ||
    source;
  const handlePoints = annotationSnapshot?.data?.handles?.points;
  const points = Array.isArray(annotationSnapshot?.points)
    ? annotationSnapshot.points
    : Array.isArray(handlePoints)
      ? handlePoints
      : Array.isArray(source?.points)
        ? source.points
        : [];

  return points.filter(
    point =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(Number(point[0])) &&
      Number.isFinite(Number(point[1]))
  );
}

function getViewerQuizMeasurementCenterPoint(value = {}) {
  const points = getViewerQuizMeasurementPoints(value);

  if (!points.length) {
    return null;
  }

  const totals = points.reduce(
    (result, point) => {
      result.x += Number(point[0]);
      result.y += Number(point[1]);
      result.z += Number(point[2] || 0);
      return result;
    },
    { x: 0, y: 0, z: 0 }
  );

  return {
    x: totals.x / points.length,
    y: totals.y / points.length,
    z: totals.z / points.length,
    coordinateSpace: 'world',
  };
}

function drawViewerQuizMarkerOptions({ viewport, markerOptions = [] } = {}) {
  const element = viewport?.element;

  if (!element) {
    return {
      ok: false,
      reason: 'viewport-element-not-found',
      renderedCount: 0,
    };
  }

  clearViewerQuizMarkerOverlayForElement(element);

  const previousPosition = element.style.position;
  if (!previousPosition || previousPosition === 'static') {
    element.style.position = 'relative';
  }

  let renderedCount = 0;
  const renderedCanvasPoints: Array<{ x: number; y: number }> = [];
  const overlapOffsets = [
    { x: 0, y: 0 },
    { x: 18, y: -18 },
    { x: -18, y: 18 },
    { x: 18, y: 18 },
    { x: -18, y: -18 },
  ];

  for (const marker of Array.isArray(markerOptions) ? markerOptions : []) {
    const markerId = String(marker?.markerId || marker?.markerKey || marker?.value || '').trim();
    const label = String(marker?.label || markerId || `Marker ${renderedCount + 1}`).trim();
    const canvasPoint = getCanvasPointForViewerQuizMarker(viewport, marker);

    if (!canvasPoint) {
      continue;
    }

    const overlappingMarkerCount = renderedCanvasPoints.filter(
      renderedPoint =>
        Math.abs(renderedPoint.x - canvasPoint.x) <= 4 &&
        Math.abs(renderedPoint.y - canvasPoint.y) <= 4
    ).length;
    const overlapOffset =
      overlapOffsets[Math.min(overlappingMarkerCount, overlapOffsets.length - 1)];
    const reviewStyle = getViewerQuizMarkerReviewStyle(marker);

    appendViewerQuizToleranceCircle({
      viewport,
      point: marker?.point || marker,
      radius: marker?.toleranceRadius,
      radiusUnit: marker?.toleranceRadiusUnit,
    });

    const node = document.createElement('div');
    node.className = VIEWER_QUIZ_MARKER_OVERLAY_CLASS;
    node.dataset.reviewState = String(marker?.reviewState || marker?.variant || 'neutral');
    node.style.position = 'absolute';
    node.style.left = `${canvasPoint.x + overlapOffset.x}px`;
    node.style.top = `${canvasPoint.y + overlapOffset.y}px`;
    node.style.transform = 'translate(-50%, -50%)';
    node.style.zIndex = '30';
    node.style.pointerEvents = 'none';
    node.style.border = `2px ${reviewStyle.borderStyle} ${reviewStyle.border}`;
    node.style.background = reviewStyle.background;
    node.style.color = reviewStyle.color;
    node.style.borderRadius = '9999px';
    node.style.minWidth = '24px';
    node.style.height = '24px';
    node.style.padding = '0 6px';
    node.style.display = 'flex';
    node.style.alignItems = 'center';
    node.style.justifyContent = 'center';
    node.style.fontSize = '12px';
    node.style.fontWeight = '700';
    node.textContent = label;

    element.appendChild(node);
    renderedCanvasPoints.push(canvasPoint);
    renderedCount += 1;
  }

  return {
    ok: true,
    renderedCount,
  };
}

function asViewerQuizPlainObject(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getViewerQuizMeasurementReferenceCandidates(reference: any = {}) {
  const source = asViewerQuizPlainObject(reference);
  const reviewPayload = asViewerQuizPlainObject(source.reviewPayload);
  const nested = [
    source,
    source.learnerMeasurement,
    source.rubricMeasurement,
    source.goldMeasurement,
    source.correctAnswer,
    reviewPayload,
  ]
    .map(asViewerQuizPlainObject)
    .filter(candidate => Object.keys(candidate).length > 0);

  return Array.from(new Set(nested));
}

function getViewerQuizMeasurementAnnotationSnapshot(reference: any = {}) {
  const candidates = getViewerQuizMeasurementReferenceCandidates(reference).flatMap(source => {
    const reviewPayload = asViewerQuizPlainObject(source.reviewPayload);

    return [
      source.annotation,
      source.annotationSnapshot,
      reviewPayload.annotation,
      reviewPayload.annotationSnapshot,
      source,
    ];
  });

  return (
    candidates
      .map(asViewerQuizPlainObject)
      .find(
        candidate =>
          !!String(candidate?.toolName || '').trim() &&
          !!String(candidate?.referencedImageId || '').trim() &&
          Array.isArray(candidate?.points) &&
          candidate.points.length > 0
      ) || null
  );
}

function getViewerQuizMeasurementSourceAnnotationId(reference: any = {}) {
  for (const source of getViewerQuizMeasurementReferenceCandidates(reference)) {
    const sourceRefs = asViewerQuizPlainObject(source.sourceRefs);
    const reviewPayload = asViewerQuizPlainObject(source.reviewPayload);
    const annotationSnapshot = asViewerQuizPlainObject(
      source.annotation ||
        source.annotationSnapshot ||
        reviewPayload.annotation ||
        reviewPayload.annotationSnapshot
    );
    const annotationId = String(
      source.sourceAnnotationId ||
        source.annotationId ||
        source.annotationUID ||
        source.uid ||
        sourceRefs.annotationId ||
        sourceRefs.measurementId ||
        annotationSnapshot.annotationId ||
        annotationSnapshot.uid ||
        ''
    ).trim();

    if (annotationId) {
      return annotationId;
    }
  }

  return '';
}

function normalizeViewerQuizMeasurementMatchText(value: any) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '');
}

function getViewerQuizMeasurementReferenceLabels(reference: any = {}) {
  const labels = getViewerQuizMeasurementReferenceCandidates(reference).flatMap(source => {
    const reviewPayload = asViewerQuizPlainObject(source.reviewPayload);

    return [
      source.measurementType,
      source.label,
      source.measurementRole,
      source.role,
      source.description,
      reviewPayload.label,
    ];
  });

  return new Set(labels.map(normalizeViewerQuizMeasurementMatchText).filter(Boolean));
}

function getViewerQuizMeasurementReferenceValue(reference: any = {}) {
  for (const source of getViewerQuizMeasurementReferenceCandidates(reference)) {
    const measurements = asViewerQuizPlainObject(source.measurements);
    const value = quizNumberOrNull(
      source.value ?? measurements.value ?? measurements.length ?? measurements.area
    );

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function scoreViewerQuizMeasurementAnnotationCandidate(reference: any = {}, candidate: any = {}) {
  const referenceTarget = getViewerQuizMeasurementReferenceTarget(reference);
  const candidateTarget = getViewerQuizMeasurementReferenceTarget({}, candidate);
  let score = 0;

  if (referenceTarget?.referencedImageId) {
    const referenceImage = normalizeImageIdForCompare(referenceTarget.referencedImageId);
    const candidateImage = normalizeImageIdForCompare(candidateTarget?.referencedImageId);

    if (!candidateImage || referenceImage !== candidateImage) {
      return -1;
    }

    score += 120;
  } else if (referenceTarget?.sopInstanceUID) {
    if (
      !candidateTarget?.sopInstanceUID ||
      String(referenceTarget.sopInstanceUID) !== String(candidateTarget.sopInstanceUID)
    ) {
      return -1;
    }

    score += 80;
  }

  if (
    referenceTarget?.seriesInstanceUID &&
    candidateTarget?.seriesInstanceUID === referenceTarget.seriesInstanceUID
  ) {
    score += 25;
  }

  if (
    Number.isFinite(Number(referenceTarget?.frameNumber)) &&
    Number(referenceTarget.frameNumber) === Number(candidateTarget?.frameNumber)
  ) {
    score += 20;
  }

  const referenceLabels = getViewerQuizMeasurementReferenceLabels(reference);
  const candidateLabels = getViewerQuizMeasurementReferenceLabels(candidate);

  if ([...referenceLabels].some(label => candidateLabels.has(label))) {
    score += 40;
  }

  const referenceToolName = normalizeViewerQuizMeasurementMatchText(
    getViewerQuizMeasurementReferenceCandidates(reference)
      .map(source => source.toolName)
      .find(Boolean)
  );
  const candidateToolName = normalizeViewerQuizMeasurementMatchText(candidate?.toolName);

  if (referenceToolName && candidateToolName === referenceToolName) {
    score += 20;
  }

  const referenceValue = getViewerQuizMeasurementReferenceValue(reference);
  const candidateValue = getViewerQuizMeasurementReferenceValue(candidate);

  if (
    referenceValue !== null &&
    candidateValue !== null &&
    Math.abs(referenceValue - candidateValue) <= 0.01
  ) {
    score += 20;
  }

  return score;
}

function findViewerQuizMeasurementAnnotationInSeriesDocs(
  reference: any = {},
  seriesDocs: any[] = []
) {
  const directSnapshot = getViewerQuizMeasurementAnnotationSnapshot(reference);

  if (directSnapshot) {
    return directSnapshot;
  }

  const annotations = (Array.isArray(seriesDocs) ? seriesDocs : []).flatMap(seriesDoc =>
    getRequestedWorkflowAnnotations(seriesDoc?.MeasurementAnnotations)
  );
  const sourceAnnotationId = getViewerQuizMeasurementSourceAnnotationId(reference);

  if (sourceAnnotationId) {
    const exactMatch = annotations.find(
      candidate => getMeasurementAnnotationId(candidate) === sourceAnnotationId
    );

    if (exactMatch) {
      return exactMatch;
    }
  }

  const bestMatch = annotations
    .map(candidate => ({
      candidate,
      score: scoreViewerQuizMeasurementAnnotationCandidate(reference, candidate),
    }))
    .filter(entry => entry.score >= 60)
    .sort((left, right) => right.score - left.score)[0];

  return bestMatch?.candidate || null;
}

function getViewerQuizMeasurementReferenceTarget(
  reference: any = {},
  annotationSnapshot: any = {}
) {
  const annotation = asViewerQuizPlainObject(annotationSnapshot);
  const directTarget = getViewerQuizMeasurementReferenceCandidates(reference)
    .flatMap(source => {
      const placedMarker = asViewerQuizPlainObject(source.placedMarker);

      return [
        source.viewerTarget,
        source.selectedTarget,
        placedMarker.viewerTarget,
        placedMarker.selectedTarget,
      ];
    })
    .map(asViewerQuizPlainObject)
    .find(candidate => Object.keys(candidate).length > 0);

  if (directTarget) {
    return directTarget;
  }

  if (!Object.keys(annotation).length) {
    return null;
  }

  return {
    studyInstanceUID: annotation.StudyInstanceUID || '',
    seriesInstanceUID: annotation.SeriesInstanceUID || annotation.referenceSeriesUID || '',
    sopInstanceUID: annotation.SOPInstanceUID || '',
    displaySetInstanceUID: annotation.displaySetInstanceUID || '',
    referencedImageId: annotation.referencedImageId || '',
    frameNumber: annotation.frameNumber,
  };
}

function buildViewerQuizMeasurementStateStyle({
  color,
  background,
  lineDash = '',
}: {
  color: string;
  background: string;
  lineDash?: string;
}) {
  const style: Record<string, string> = {};
  const suffixes = [
    '',
    'Active',
    'Passive',
    'Highlighted',
    'HighlightedActive',
    'HighlightedPassive',
    'Selected',
    'SelectedActive',
    'SelectedPassive',
    'Locked',
    'LockedActive',
    'LockedPassive',
  ];

  suffixes.forEach(suffix => {
    style[`color${suffix}`] = color;
    style[`lineWidth${suffix}`] = '3';
    style[`lineDash${suffix}`] = lineDash;
    style[`textBoxColor${suffix}`] = color;
    style[`textBoxBackground${suffix}`] = background;
    style[`textBoxLinkLineColor${suffix}`] = color;
    style[`textBoxLinkLineWidth${suffix}`] = '2';
    style[`textBoxLinkLineDash${suffix}`] = lineDash;
  });

  return style;
}

const VIEWER_QUIZ_MEASUREMENT_COMPARISON_STYLES = Object.freeze({
  learner: buildViewerQuizMeasurementStateStyle({
    color: 'rgb(56, 189, 248)',
    background: 'rgba(8, 47, 73, 0.9)',
  }),
  rubric: buildViewerQuizMeasurementStateStyle({
    color: 'rgb(192, 132, 252)',
    background: 'rgba(59, 7, 100, 0.9)',
    lineDash: '5,3',
  }),
});

function buildViewerQuizMeasurementComparisonAnnotation({
  sourceAnnotation,
  variant,
  questionKey,
}: {
  sourceAnnotation: any;
  variant: 'learner' | 'rubric';
  questionKey?: string;
}) {
  const safeQuestionKey = String(questionKey || 'question')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-');
  const comparisonAnnotationId = `ar-viewer-quiz-${variant}-${safeQuestionKey}`;
  const label = variant === 'rubric' ? 'Rubric measurement' : 'Your measurement';

  return {
    ...sourceAnnotation,
    annotationId: comparisonAnnotationId,
    uid: comparisonAnnotationId,
    label,
    measurementRole: label,
    role: label,
    isLocked: true,
    isVisible: true,
    measurementOwner: variant,
  };
}

function hydrateViewerQuizMeasurementComparisonAnnotation({
  comparisonAnnotation,
  viewport,
  viewportId,
  referencedImageIdOverride = '',
  fallbackFrameOfReferenceUID = '',
}: {
  comparisonAnnotation: any;
  viewport: any;
  viewportId: string;
  referencedImageIdOverride?: string;
  fallbackFrameOfReferenceUID?: string;
}) {
  const toolName = String(comparisonAnnotation?.toolName || '')
    .trim()
    .toLowerCase();

  if (toolName === 'length') {
    return hydrateSavedLengthAnnotationForActiveViewport({
      annotation: comparisonAnnotation,
      activeViewportId: viewportId,
      referencedImageIdOverride,
    });
  }

  return hydrateSavedViewerAnnotationForViewport({
    annotation: comparisonAnnotation,
    viewport,
    viewportId,
    referencedImageIdOverride,
    fallbackFrameOfReferenceUID,
  });
}

function getViewerUrlSearchParams() {
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

function getArViewerSaveTargetFromUrl() {
  const qs = getViewerUrlSearchParams();

  return {
    mode: String(qs.get('arSaveTarget') || '').trim(),
    baseSeriesId: String(qs.get('arBaseSeriesId') || '').trim(),
    seriesId: String(qs.get('arSeriesId') || '').trim(),
    learnerSeriesId: String(qs.get('arLearnerSeriesId') || '').trim(),
    launchSource: String(qs.get('arLaunchSource') || '').trim(),
    measurementWorkflowRole: String(qs.get('arMeasurementWorkflowRole') || '').trim(),
    reviewWorkflowType: String(qs.get('arReviewWorkflowType') || '').trim(),
    measurementAccess: String(qs.get('arMeasurementAccess') || '').trim(),
  };
}

const REVIEW_WORKFLOW_MEASUREMENTS_SAVE_TARGET = 'reviewWorkflowMeasurements';
const CLINICAL_REPORT_MEASUREMENTS_SAVE_TARGET = 'clinicalReportMeasurements';
const AR_REPORT_MEASUREMENTS_UPDATED_MESSAGE_TYPE = 'AR_REPORT_MEASUREMENTS_UPDATED';

const AR_REPORT_REFRESH_IGNORED_FIELD_NAMES = new Set([
  '_id',
  'id',
  '__v',
  'tenantId',
  'createdAt',
  'updatedAt',
  'audit',
  'MeasurementAnnotations',
  'viewerQuizResponses',
  'lastSavedAt',
  'lastTouchedAt',
  'lastTouchedBy',
  'lastViewedAt',
  'lastPdfViewedAt',
]);

function areArReportFieldValuesEqual(left: any, right: any) {
  if (Object.is(left, right)) {
    return true;
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function getChangedPersistedArReportFields(
  previousSeriesDoc: any = {},
  savedSeriesDoc: any = {}
) {
  if (
    !previousSeriesDoc ||
    typeof previousSeriesDoc !== 'object' ||
    !savedSeriesDoc ||
    typeof savedSeriesDoc !== 'object'
  ) {
    return {};
  }

  return Object.keys(savedSeriesDoc).reduce((updatedFields, fieldName) => {
    if (
      AR_REPORT_REFRESH_IGNORED_FIELD_NAMES.has(fieldName) ||
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName)
    ) {
      return updatedFields;
    }

    const previousValue = previousSeriesDoc[fieldName];
    const savedValue = savedSeriesDoc[fieldName];

    if (!areArReportFieldValuesEqual(previousValue, savedValue)) {
      updatedFields[fieldName] = savedValue;
    }

    return updatedFields;
  }, {} as Record<string, any>);
}

function postArReportMeasurementsUpdated({
  seriesDoc,
  fieldNames = [],
  updatedFields = {},
  source = 'viewer',
}: {
  seriesDoc?: any;
  fieldNames?: string[];
  updatedFields?: Record<string, any>;
  source?: string;
} = {}) {
  const cleanFieldNames = Array.from(
    new Set(
      (Array.isArray(fieldNames) ? fieldNames : [])
        .map(fieldName => String(fieldName || '').trim())
        .filter(Boolean)
    )
  );

  if (!seriesDoc || !cleanFieldNames.length) {
    return;
  }

  try {
    const message = {
      type: AR_REPORT_MEASUREMENTS_UPDATED_MESSAGE_TYPE,
      seriesKey: String(seriesDoc?._id || ''),
      StudyInstanceUID: String(seriesDoc?.StudyInstanceUID || ''),
      SeriesInstanceUID: String(seriesDoc?.SeriesInstanceUID || ''),
      fieldNames: cleanFieldNames,
      updatedFields,
      updatedAt: seriesDoc?.updatedAt || '',
      source,
    };

    window.opener?.postMessage(message, '*');
    window.parent?.postMessage(message, '*');
  } catch (messageError) {
    console.warn('[MeasurementAnnotations] unable to notify AR of report measurement update:', messageError);
  }
}

function normalizeReviewMeasurementRole(value: unknown = '') {
  const role = String(value || '')
    .trim()
    .toLowerCase();

  return ['learner', 'educator'].includes(role) ? role : '';
}

function isReviewWorkflowMeasurementsSaveTarget(saveTarget: any = {}) {
  return (
    saveTarget.mode === REVIEW_WORKFLOW_MEASUREMENTS_SAVE_TARGET &&
    !!saveTarget.seriesId &&
    isLibraryLaunchSource(saveTarget.launchSource) &&
    !!normalizeReviewMeasurementRole(saveTarget.measurementWorkflowRole) &&
    !!String(saveTarget.reviewWorkflowType || '').trim()
  );
}

function isClinicalReportMeasurementsSaveTarget(saveTarget: any = {}) {
  return (
    saveTarget.mode === CLINICAL_REPORT_MEASUREMENTS_SAVE_TARGET &&
    !!String(saveTarget.seriesId || '').trim() &&
    String(saveTarget.launchSource || '')
      .trim()
      .toLowerCase() === 'report'
  );
}

function getClinicalViewerMeasurementSemanticKey(measurement: any = {}) {
  if (measurement?.mode === 'repeated') {
    return '';
  }

  const domain = normalizeViewerMeasurementDomain(measurement?.domain || 'generic') || 'generic';

  if (domain !== 'echo') {
    return '';
  }

  if (isLAVolumeMeasurement(measurement)) {
    const slot = getLAVolumeSlotFromMeasurement(measurement);

    return slot ? `echo:${LA_VOLUME_MEASUREMENT_KIND}:${slot}` : '';
  }

  if (isLVSimpsonMeasurement(measurement)) {
    const slot = getLVSimpsonSlotFromMeasurement(measurement);

    return slot ? `echo:${LV_SIMPSON_MEASUREMENT_KIND}:${slot}` : '';
  }

  if (isSpectralDopplerViewerMeasurement(measurement)) {
    const spectralDoppler = getSpectralDopplerGeometry(measurement, measurement);
    const targetKey = String(
      measurement?.reportMapping?.targetKey ||
        spectralDoppler?.reportMapping?.targetKey ||
        measurement?.measurements?.spectralDoppler?.reportMapping?.targetKey ||
        ''
    )
      .trim()
      .toLowerCase();

    return targetKey ? `echo:${SPECTRAL_DOPPLER_MEASUREMENT_KIND}:${targetKey}` : '';
  }

  return '';
}

function canonicalizeClinicalViewerMeasurementAnnotations(
  annotations: any[] = [],
  excludedSemanticKeys = new Set<string>()
) {
  const seenSemanticKeys = new Set<string>();
  const canonicalReversed = [];

  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const measurement = annotations[index];
    const semanticKey = getClinicalViewerMeasurementSemanticKey(measurement);

    if (semanticKey) {
      if (excludedSemanticKeys.has(semanticKey) || seenSemanticKeys.has(semanticKey)) {
        continue;
      }

      seenSemanticKeys.add(semanticKey);
    }

    canonicalReversed.push(measurement);
  }

  return canonicalReversed.reverse();
}

function isReviewWorkflowMeasurementEditTarget(saveTarget: any = {}) {
  return (
    isReviewWorkflowMeasurementsSaveTarget(saveTarget) &&
    String(saveTarget.measurementAccess || '')
      .trim()
      .toLowerCase() === 'edit'
  );
}

function getWritableReviewMeasurementWorkflow(saveTarget: any = {}) {
  if (!isReviewWorkflowMeasurementEditTarget(saveTarget)) {
    return '';
  }

  return normalizeReviewMeasurementRole(saveTarget.measurementWorkflowRole) === 'educator'
    ? REVIEWER_MEASUREMENTS_WORKFLOW
    : VIEWER_MEASUREMENTS_WORKFLOW;
}

function getMeasurementWorkflowsForRead(saveTarget: any = {}, requestedWorkflows: string[] = []) {
  if (isReviewWorkflowMeasurementsSaveTarget(saveTarget)) {
    return [VIEWER_MEASUREMENTS_WORKFLOW, REVIEWER_MEASUREMENTS_WORKFLOW];
  }

  return Array.isArray(requestedWorkflows) && requestedWorkflows.length
    ? requestedWorkflows
    : [VIEWER_MEASUREMENTS_WORKFLOW];
}

function getCurrentReviewMeasurementRound(seriesDoc: any = {}) {
  const entries = Array.isArray(seriesDoc?.studentPractice?.feedbackEntries)
    ? seriesDoc.studentPractice.feedbackEntries
    : [];

  const draftRounds = entries
    .filter(
      entry =>
        String(entry?.status || '')
          .trim()
          .toLowerCase() === 'draft'
    )
    .map(entry => Number(entry?.roundNumber) || 0)
    .filter(roundNumber => roundNumber > 0);

  if (draftRounds.length) {
    return Math.max(...draftRounds);
  }

  const latestRound = entries.reduce(
    (maxRound, entry) => Math.max(maxRound, Number(entry?.roundNumber) || 0),
    0
  );

  return latestRound + 1;
}

function getMeasurementAnnotationId(annotation: any = {}) {
  return String(
    annotation?.uid || annotation?.annotationId || annotation?.id || annotation?.annotationUID || ''
  ).trim();
}

function decorateReviewWorkflowAnnotations({ annotations, seriesDoc, saveTarget }) {
  if (!isReviewWorkflowMeasurementsSaveTarget(saveTarget)) {
    return annotations || [];
  }

  const writableWorkflow = getWritableReviewMeasurementWorkflow(saveTarget);
  const currentRound = getCurrentReviewMeasurementRound(seriesDoc);

  return (annotations || []).map(annotation => {
    const workflow = String(annotation?.workflow || '').trim();
    const reviewRound = Number(annotation?.reviewRound) || 0;

    const isCurrentReviewerRound =
      workflow !== REVIEWER_MEASUREMENTS_WORKFLOW ||
      reviewRound === 0 ||
      reviewRound === currentRound;

    const isWritable = workflow === writableWorkflow && isCurrentReviewerRound;

    const sourceRole =
      annotation?.sourceRole ||
      (workflow === REVIEWER_MEASUREMENTS_WORKFLOW
        ? 'educator'
        : workflow === VIEWER_MEASUREMENTS_WORKFLOW
          ? 'learner'
          : '');

    return {
      ...annotation,
      workflow,
      sourceRole,
      isLocked: !isWritable,
      measurementOwner: workflow === REVIEWER_MEASUREMENTS_WORKFLOW ? 'coach' : 'learner',
    };
  });
}

function getBlockedReviewMeasurementIds({ seriesDoc, saveTarget }) {
  const annotations = getRequestedWorkflowAnnotations(seriesDoc?.MeasurementAnnotations, [
    VIEWER_MEASUREMENTS_WORKFLOW,
    REVIEWER_MEASUREMENTS_WORKFLOW,
  ]);

  const decorated = decorateReviewWorkflowAnnotations({
    annotations,
    seriesDoc,
    saveTarget,
  });

  return new Set(
    decorated
      .filter(annotation => annotation?.isLocked)
      .map(getMeasurementAnnotationId)
      .filter(Boolean)
  );
}

function getWritableExistingReviewMeasurementIds({ seriesDoc, saveTarget }) {
  const annotations = getRequestedWorkflowAnnotations(seriesDoc?.MeasurementAnnotations, [
    VIEWER_MEASUREMENTS_WORKFLOW,
    REVIEWER_MEASUREMENTS_WORKFLOW,
  ]);

  const decorated = decorateReviewWorkflowAnnotations({
    annotations,
    seriesDoc,
    saveTarget,
  });

  return new Set(
    decorated
      .filter(annotation => annotation?.isLocked !== true)
      .map(getMeasurementAnnotationId)
      .filter(Boolean)
  );
}

async function getResponseErrorMessage(response, fallback) {
  try {
    const body = await response.json();

    return body?.message || body?.errorMsg || body?.error || fallback;
  } catch {
    return fallback;
  }
}

function isLibraryLaunchSource(launchSource = '') {
  return (
    String(launchSource || '')
      .trim()
      .toLowerCase() === 'library'
  );
}

function isAllowedLibraryMeasurementWorkflowRole(role = '') {
  return ['learner', 'educator'].includes(
    String(role || '')
      .trim()
      .toLowerCase()
  );
}

function isLearnerCopyOnSaveTarget(saveTarget = {}) {
  return (
    saveTarget.mode === 'learnerCopyOnSave' &&
    !!saveTarget.baseSeriesId &&
    isLibraryLaunchSource(saveTarget.launchSource) &&
    isAllowedLibraryMeasurementWorkflowRole(saveTarget.measurementWorkflowRole)
  );
}

function rememberArLearnerSeriesId(seriesId) {
  const id = String(seriesId || '').trim();
  if (!id) {
    return;
  }

  try {
    const parsed = new URL(window.location.href);
    parsed.searchParams.set('arLearnerSeriesId', id);
    window.history.replaceState(window.history.state, '', parsed.toString());
  } catch {}
}

async function fetchSeriesDocById(seriesId) {
  const id = String(seriesId || '').trim();
  if (!id) {
    return null;
  }

  const response = await fetch(
    buildFormApiUrl(`series/${encodeURIComponent(id)}`),
    buildFormApiFetchOptions({
      method: 'GET',
    })
  );

  if (!response.ok) {
    throw new Error(`Series lookup failed: ${response.status}`);
  }

  return response.json();
}

async function ensureLearnerCopyForViewerSave(saveTarget) {
  const response = await fetch(
    buildFormApiUrl('series/ensure-learner-copy'),
    buildFormApiFetchOptions({
      method: 'POST',
      body: JSON.stringify({
        baseSeriesId: saveTarget.baseSeriesId,
      }),
    })
  );

  if (!response.ok) {
    throw new Error(`Unable to resolve learner copy: ${response.status}`);
  }

  const learnerCopy = await response.json();
  rememberArLearnerSeriesId(learnerCopy?._id);

  return learnerCopy;
}

async function resolveViewerReadSeriesDoc(servicesManager, { allowBaseFallback = true } = {}) {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (isClinicalReportMeasurementsSaveTarget(saveTarget)) {
    return fetchSeriesDocById(saveTarget.seriesId);
  }

  if (isLearnerCopyOnSaveTarget(saveTarget)) {
    if (saveTarget.learnerSeriesId) {
      return fetchSeriesDocById(saveTarget.learnerSeriesId);
    }

    if (!allowBaseFallback) {
      return null;
    }
  }

  return fetchSeriesDocForActiveStudy(servicesManager);
}

async function resolveViewerSaveSeriesDoc({ servicesManager, currentSeriesDoc }) {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (isClinicalReportMeasurementsSaveTarget(saveTarget)) {
    if (String(currentSeriesDoc?._id || '') === String(saveTarget.seriesId || '')) {
      return currentSeriesDoc;
    }

    return fetchSeriesDocById(saveTarget.seriesId);
  }

  if (!isLearnerCopyOnSaveTarget(saveTarget)) {
    return currentSeriesDoc || fetchSeriesDocForActiveStudy(servicesManager);
  }

  if (currentSeriesDoc?.isLearnerCopy === true) {
    return currentSeriesDoc;
  }

  return ensureLearnerCopyForViewerSave(saveTarget);
}

function commandsModule({
  servicesManager,
  commandsManager,
  extensionManager,
}: OhifTypes.Extensions.ExtensionParams): OhifTypes.Extensions.CommandsModule {
  const viewerMeasurementsCreatedInSession = new Set<string>();
  const viewerMeasurementsDeletedInSession = new Set<string>();
  const viewerQuizMeasurementComparisonAnnotationIds = new Set<string>();
  const {
    viewportGridService,
    toolGroupService,
    cineService,
    uiDialogService,
    cornerstoneViewportService,
    uiNotificationService,
    measurementService,
    customizationService,
    colorbarService,
    hangingProtocolService,
    syncGroupService,
    segmentationService,
    displaySetService,
  } = servicesManager.services as AppTypes.Services;

  function _getActiveViewportEnabledElement() {
    return getActiveViewportEnabledElement(viewportGridService);
  }

  function _getViewportEnabledElement(viewportId: string) {
    return getViewportEnabledElement(viewportId);
  }

  function _getActiveViewportToolGroupId() {
    const viewport = _getActiveViewportEnabledElement();
    return toolGroupService.getToolGroupForViewport(viewport.id);
  }

  function getViewerQuizMeasurementAnnotationFromService(reference: any = {}) {
    const annotationId = getViewerQuizMeasurementSourceAnnotationId(reference);
    const measurement = findMeasurementServiceMeasurementById(measurementService, annotationId);

    if (measurement) {
      return serializeViewerMeasurement(measurement, 'generic', null, {
        workflow: VIEWER_MEASUREMENTS_WORKFLOW,
        displaySetService,
      });
    }

    const stateAnnotation = annotationId ? annotation.state.getAnnotation?.(annotationId) : null;

    if (!stateAnnotation) {
      return null;
    }

    const metadata = asViewerQuizPlainObject(stateAnnotation.metadata);
    const data = asViewerQuizPlainObject(stateAnnotation.data);
    const handles = asViewerQuizPlainObject(data.handles);
    const referenceValue = getViewerQuizMeasurementReferenceValue(reference);
    const referenceSource = getViewerQuizMeasurementReferenceCandidates(reference)[0] || {};
    const unit = String(referenceSource.unit || '').trim();

    return {
      annotationId,
      uid: annotationId,
      workflow: VIEWER_MEASUREMENTS_WORKFLOW,
      role: data.label || referenceSource.measurementType || '',
      measurementRole: data.label || referenceSource.measurementType || '',
      label: data.label || referenceSource.measurementType || '',
      toolName: metadata.toolName || referenceSource.toolName || 'Length',
      StudyInstanceUID: metadata.StudyInstanceUID || '',
      SeriesInstanceUID: metadata.SeriesInstanceUID || '',
      SOPInstanceUID: metadata.SOPInstanceUID || '',
      FrameOfReferenceUID: metadata.FrameOfReferenceUID || '',
      displaySetInstanceUID: metadata.displaySetInstanceUID || '',
      referencedImageId: metadata.referencedImageId || '',
      frameNumber: getFrameNumberFromReferencedImageId(metadata.referencedImageId || ''),
      points: Array.isArray(handles.points) ? handles.points : [],
      measurements:
        referenceValue !== null
          ? {
              value: referenceValue,
              length: referenceValue,
              unit,
              lengthUnit: unit,
            }
          : {},
      displayText: referenceValue !== null ? [`${referenceValue}${unit ? ` ${unit}` : ''}`] : [],
    };
  }

  async function getViewerQuizMeasurementSeriesDocs() {
    const saveTarget = getArViewerSaveTargetFromUrl();
    const learnerSeriesId = saveTarget.learnerSeriesId || saveTarget.seriesId;
    let learnerSeriesDoc = null;
    let baseSeriesDoc = null;

    try {
      learnerSeriesDoc = learnerSeriesId
        ? await fetchSeriesDocById(learnerSeriesId)
        : await fetchSeriesDocForActiveStudy(servicesManager);
    } catch (error) {
      console.warn('[ViewerQuiz] learner series lookup failed for measurement review', error);
    }

    const baseSeriesId = String(
      saveTarget.baseSeriesId ||
        learnerSeriesDoc?.derivedFrom ||
        learnerSeriesDoc?.baseSeriesId ||
        ''
    ).trim();

    if (baseSeriesId && baseSeriesId !== String(learnerSeriesDoc?._id || '')) {
      try {
        baseSeriesDoc = await fetchSeriesDocById(baseSeriesId);
      } catch (error) {
        console.warn('[ViewerQuiz] base series lookup failed for measurement review', error);
      }
    }

    return {
      learnerSeriesDoc,
      baseSeriesDoc,
    };
  }

  function clearViewerQuizMeasurementComparisonAnnotations() {
    for (const annotationId of viewerQuizMeasurementComparisonAnnotationIds) {
      try {
        annotation.state.removeAnnotation?.(annotationId);
      } catch {}
    }

    viewerQuizMeasurementComparisonAnnotationIds.clear();

    try {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      viewport?.render?.();
    } catch {}
  }

  function _getActiveSegmentationInfo() {
    const viewportId = viewportGridService.getActiveViewportId();
    const activeSegmentation = segmentationService.getActiveSegmentation(viewportId);
    const segmentationId = activeSegmentation?.segmentationId;
    const activeSegmentIndex = segmentationService.getActiveSegment(viewportId).segmentIndex;

    return {
      segmentationId,
      segmentIndex: activeSegmentIndex,
    };
  }

  function excludeViewerMeasurementsDeletedInSession(annotations = []) {
    return (Array.isArray(annotations) ? annotations : []).filter(annotation => {
      const annotationId = getMeasurementAnnotationId(annotation);
      return !annotationId || !viewerMeasurementsDeletedInSession.has(annotationId);
    });
  }

  let activeSpectralDopplerWorkflowSessionId = '';
  let spectralDopplerCompletionHandler: null | ((event: Event) => void) = null;
  let spectralDopplerEscapeHandler: null | ((event: KeyboardEvent) => void) = null;

  function clearSpectralDopplerWorkflowListeners({ resetSession = true } = {}) {
    if (spectralDopplerCompletionHandler) {
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_COMPLETED, spectralDopplerCompletionHandler);
      spectralDopplerCompletionHandler = null;
    }

    if (spectralDopplerEscapeHandler) {
      window.removeEventListener('keydown', spectralDopplerEscapeHandler);
      spectralDopplerEscapeHandler = null;
    }

    if (resetSession) {
      activeSpectralDopplerWorkflowSessionId = '';
    }
  }

  const actions = {
    clearViewerMeasurementsCreatedInSession: () => {
      viewerMeasurementsCreatedInSession.clear();
      viewerMeasurementsDeletedInSession.clear();
      lvSimpsonSessionMeasurementsByUid.clear();
      laVolumeSessionMeasurementsByUid.clear();
      activeLVSimpsonWorkflowSessionId = '';
      activeLAVolumeWorkflowSessionId = '';
      clearSpectralDopplerWorkflowListeners();
      dispatchLVSimpsonSessionMeasurements({ reason: 'viewer-session-cleared' });
      dispatchLAVolumeSessionMeasurements({ reason: 'viewer-session-cleared' });
    },

    markViewerMeasurementCreatedInSession: ({ uid }: { uid?: string } = {}) => {
      const measurementId = String(uid || '').trim();

      if (!measurementId) {
        return '';
      }

      viewerMeasurementsDeletedInSession.delete(measurementId);
      viewerMeasurementsCreatedInSession.add(measurementId);

      const saveTarget = getArViewerSaveTargetFromUrl();
      const workflow = getWritableReviewMeasurementWorkflow(saveTarget);

      const measurement = measurementService.getMeasurement?.(measurementId);

      if (measurement && workflow) {
        const measurementOwner = workflow === REVIEWER_MEASUREMENTS_WORKFLOW ? 'coach' : 'learner';

        measurementService.update(
          measurementId,
          {
            ...measurement,
            workflow,
            measurementOwner,
            isLocked: false,
            arCreatedInViewerSession: true,
          },
          true
        );

        const styleApplied = applyReviewMeasurementAnnotationStyle({
          annotationUID: measurementId,
          workflow,
          measurementOwner,
        });

        if (styleApplied) {
          cornerstoneViewportService.getRenderingEngine()?.render?.();
        }
      }

      return measurementId;
    },
    jumpToMeasurementViewport: ({ annotationUID, measurement }) => {
      cornerstoneTools.annotation.selection.setAnnotationSelected(annotationUID, true);
      const { metadata } = measurement;

      const activeViewportId = viewportGridService.getActiveViewportId();
      // Finds the best viewport to jump to for showing the annotation view reference
      // This may be different from active if there is a viewport already showing the display set.
      const viewportId = cornerstoneViewportService.findNavigationCompatibleViewportId(
        activeViewportId,
        metadata
      );
      if (viewportId) {
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        viewport.setViewReference(metadata);
        viewport.render();
        return;
      }

      const { displaySetInstanceUID: referencedDisplaySetInstanceUID } = measurement;
      if (!referencedDisplaySetInstanceUID) {
        console.warn('ViewportGrid::No display set found in', measurement);
        return;
      }

      // Finds the viewport to update to show the given displayset/orientation.
      // This will choose a view already containing the measurement display set
      // if possible, otherwise will fallback to the active.
      const viewportToUpdate = cornerstoneViewportService.findUpdateableViewportConfiguration(
        activeViewportId,
        measurement
      );

      if (!viewportToUpdate) {
        console.warn('Unable to find a viewport to show this in');
        return;
      }
      const updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
        viewportToUpdate.viewportId,
        referencedDisplaySetInstanceUID
      );

      if (!updatedViewports?.[0]) {
        console.warn(
          'ViewportGrid::Unable to navigate to viewport containing',
          referencedDisplaySetInstanceUID
        );
        return;
      }

      updatedViewports[0].viewportOptions = viewportToUpdate.viewportOptions;

      // Update stored position presentation
      commandsManager.run('updateStoredPositionPresentation', {
        viewportId: viewportToUpdate.viewportId,
        displaySetInstanceUIDs: [referencedDisplaySetInstanceUID],
        referencedImageId: measurement.referencedImageId,
        options: {
          ...measurement.metadata,
        },
      });

      commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate: updatedViewports });
    },

    hydrateSecondaryDisplaySet: async ({ displaySet, viewportId }) => {
      if (!displaySet) {
        return;
      }

      if (displaySet.isOverlayDisplaySet) {
        // update the previously stored segmentationPresentation with the new viewportId
        // presentation so that when we put the referencedDisplaySet back in the viewport
        // it will have the correct segmentation representation hydrated
        commandsManager.runCommand('updateStoredSegmentationPresentation', {
          displaySet,
          type:
            displaySet.Modality === 'SEG'
              ? SegmentationRepresentations.Labelmap
              : SegmentationRepresentations.Contour,
        });
      }

      const referencedDisplaySetInstanceUID = displaySet.referencedDisplaySetInstanceUID;

      const storePositionPresentation = refDisplaySet => {
        // update the previously stored positionPresentation with the new viewportId
        // presentation so that when we put the referencedDisplaySet back in the viewport
        // it will be in the correct position zoom and pan
        commandsManager.runCommand('updateStoredPositionPresentation', {
          viewportId,
          displaySetInstanceUIDs: [refDisplaySet.displaySetInstanceUID],
        });
      };

      if (displaySet.Modality === 'SEG' || displaySet.Modality === 'RTSTRUCT') {
        const referencedDisplaySet = displaySetService.getDisplaySetByUID(
          referencedDisplaySetInstanceUID
        );
        storePositionPresentation(referencedDisplaySet);
        return commandsManager.runCommand('loadSegmentationDisplaySetsForViewport', {
          viewportId,
          displaySetInstanceUIDs: [referencedDisplaySet.displaySetInstanceUID],
        });
      } else if (displaySet.Modality === 'SR') {
        const results = commandsManager.runCommand('hydrateStructuredReport', {
          displaySetInstanceUID: displaySet.displaySetInstanceUID,
        });
        const { SeriesInstanceUIDs } = results;
        const referencedDisplaySets = displaySetService.getDisplaySetsForSeries(
          SeriesInstanceUIDs[0]
        );
        referencedDisplaySets.forEach(storePositionPresentation);

        if (referencedDisplaySets.length) {
          actions.setDisplaySetsForViewports({
            viewportsToUpdate: [
              {
                viewportId: viewportGridService.getActiveViewportId(),
                displaySetInstanceUIDs: [referencedDisplaySets[0].displaySetInstanceUID],
              },
            ],
          });
        }
        return results;
      }
    },
    runSegmentBidirectional: async ({ segmentationId, segmentIndex } = {}) => {
      // Get active segmentation if not specified
      const targetSegmentation =
        segmentationId && segmentIndex
          ? { segmentationId, segmentIndex }
          : _getActiveSegmentationInfo();

      const { segmentationId: targetId, segmentIndex: targetIndex } = targetSegmentation;

      // Get bidirectional measurement data
      const bidirectionalData = await cstUtils.segmentation.getSegmentLargestBidirectional({
        segmentationId: targetId,
        segmentIndices: [targetIndex],
      });

      const activeViewportId = viewportGridService.getActiveViewportId();

      // Process each bidirectional measurement
      bidirectionalData.forEach(measurement => {
        const { segmentIndex, majorAxis, minorAxis } = measurement;

        // Create annotation
        const annotation = cornerstoneTools.SegmentBidirectionalTool.hydrate(
          activeViewportId,
          [majorAxis, minorAxis],
          {
            segmentIndex,
            segmentationId: targetId,
          }
        );

        measurement.annotationUID = annotation.annotationUID;

        // Update segmentation stats
        const updatedSegmentation = updateSegmentBidirectionalStats({
          segmentationId: targetId,
          segmentIndex: targetIndex,
          bidirectionalData: measurement,
          segmentationService,
          annotation,
        });

        // Save changes if needed
        if (updatedSegmentation) {
          segmentationService.addOrUpdateSegmentation({
            segmentationId: targetId,
            segments: updatedSegmentation.segments,
          });
        }
      });

      // get the active segmentIndex bidirectional annotation and jump to it
      const activeBidirectional = bidirectionalData.find(
        measurement => measurement.segmentIndex === targetIndex
      );
      commandsManager.run('jumpToMeasurement', {
        uid: activeBidirectional.annotationUID,
      });
    },
    interpolateLabelmap: () => {
      const { segmentationId, segmentIndex } = _getActiveSegmentationInfo();
      labelmapInterpolation.interpolate({
        segmentationId,
        segmentIndex,
      });
    },
    /**
     * Generates the selector props for the context menu, specific to
     * the cornerstone viewport, and then runs the context menu.
     */
    showCornerstoneContextMenu: options => {
      const element = _getActiveViewportEnabledElement()?.viewport?.element;

      const optionsToUse = { ...options, element };
      const { useSelectedAnnotation, nearbyToolData, event } = optionsToUse;

      // This code is used to invoke the context menu via keyboard shortcuts
      if (useSelectedAnnotation && !nearbyToolData) {
        const firstAnnotationSelected = getFirstAnnotationSelected(element);
        // filter by allowed selected tools from config property (if there is any)
        const isToolAllowed =
          !optionsToUse.allowedSelectedTools ||
          optionsToUse.allowedSelectedTools.includes(firstAnnotationSelected?.metadata?.toolName);
        if (isToolAllowed) {
          optionsToUse.nearbyToolData = firstAnnotationSelected;
        } else {
          return;
        }
      }

      optionsToUse.defaultPointsPosition = [];
      // if (optionsToUse.nearbyToolData) {
      //   optionsToUse.defaultPointsPosition = commandsManager.runCommand(
      //     'getToolDataActiveCanvasPoints',
      //     { toolData: optionsToUse.nearbyToolData }
      //   );
      // }

      // TODO - make the selectorProps richer by including the study metadata and display set.
      optionsToUse.selectorProps = {
        toolName: optionsToUse.nearbyToolData?.metadata?.toolName,
        value: optionsToUse.nearbyToolData,
        uid: optionsToUse.nearbyToolData?.annotationUID,
        nearbyToolData: optionsToUse.nearbyToolData,
        event,
        ...optionsToUse.selectorProps,
      };

      commandsManager.run(options, optionsToUse);
    },
    updateStoredSegmentationPresentation: ({ displaySet, type }) => {
      const { addSegmentationPresentationItem } = useSegmentationPresentationStore.getState();

      const referencedDisplaySetInstanceUID = displaySet.referencedDisplaySetInstanceUID;
      addSegmentationPresentationItem(referencedDisplaySetInstanceUID, {
        segmentationId: displaySet.displaySetInstanceUID,
        hydrated: true,
        type,
      });
    },

    /** Stores the changed position presentation */
    updateStoredPositionPresentation: ({
      viewportId,
      displaySetInstanceUIDs,
      referencedImageId,
      options,
    }) => {
      const presentations = cornerstoneViewportService.getPresentations(viewportId);
      const { positionPresentationStore, setPositionPresentation, getPositionPresentationId } =
        usePositionPresentationStore.getState();

      // Look inside positionPresentationStore and find the key that includes ALL the displaySetInstanceUIDs
      // and the value has viewportId as activeViewportId.
      let previousReferencedDisplaySetStoreKey;

      if (
        displaySetInstanceUIDs &&
        Array.isArray(displaySetInstanceUIDs) &&
        displaySetInstanceUIDs.length > 0
      ) {
        previousReferencedDisplaySetStoreKey = Object.entries(positionPresentationStore).find(
          ([key, value]) => {
            return (
              displaySetInstanceUIDs.every(uid => key.includes(uid)) &&
              value?.viewportId === viewportId
            );
          }
        )?.[0];
      }

      // Create presentation data with referencedImageId and options if provided
      const presentationData =
        referencedImageId || options?.FrameOfReferenceUID
          ? {
              ...presentations.positionPresentation,
              viewReference: {
                referencedImageId,
                ...options,
              },
            }
          : presentations.positionPresentation;

      if (previousReferencedDisplaySetStoreKey) {
        setPositionPresentation(previousReferencedDisplaySetStoreKey, presentationData);
        return;
      }

      // if not found means we have not visited that referencedDisplaySetInstanceUID before
      // so we need to grab the positionPresentationId directly from the store,
      // Todo: this is really hacky, we should have a better way for this
      const positionPresentationId = getPositionPresentationId({
        displaySetInstanceUIDs,
        viewportId,
      });

      setPositionPresentation(positionPresentationId, presentationData);
    },
    getNearbyToolData({ nearbyToolData, element, canvasCoordinates }) {
      return nearbyToolData ?? cstUtils.getAnnotationNearPoint(element, canvasCoordinates);
    },
    getNearbyAnnotation({ element, canvasCoordinates }) {
      const nearbyToolData = actions.getNearbyToolData({
        nearbyToolData: null,
        element,
        canvasCoordinates,
      });

      const isAnnotation = toolName => {
        const enabledElement = getEnabledElement(element);

        if (!enabledElement) {
          return;
        }

        const { renderingEngineId, viewportId } = enabledElement;
        const toolGroup = ToolGroupManager.getToolGroupForViewport(viewportId, renderingEngineId);

        const toolInstance = toolGroup.getToolInstance(toolName);

        return toolInstance?.constructor?.isAnnotation ?? true;
      };

      return nearbyToolData?.metadata?.toolName && isAnnotation(nearbyToolData.metadata.toolName)
        ? nearbyToolData
        : null;
    },
    /**
     * Common logic for handling measurement label updates through dialog
     * @param uid - measurement uid
     * @returns Promise that resolves when the label is updated
     */
    _handleMeasurementLabelDialog: async (
      uid,
      options: {
        title?: string;
        placeholder?: string;
        labelConfigOverride?: any;
        normalizeLabel?: (value: string) => string;
      } = {}
    ) => {
      const labelConfig =
        options.labelConfigOverride || customizationService.getCustomization('measurementLabels');
      const renderContent = customizationService.getCustomization('ui.labellingComponent');
      const measurement = measurementService.getMeasurement(uid);
      const normalizedLabelConfig = normalizeMeasurementLabelConfigForDialog(
        labelConfig,
        options.title
      );
      const dialogTitle = getMeasurementLabelDialogTitle(normalizedLabelConfig, options.title);

      if (!measurement) {
        console.debug('No measurement found for label editing');
        return null;
      }

      if (!normalizedLabelConfig) {
        const label = await callInputDialog({
          uiDialogService,
          title: dialogTitle || 'Measurement Annotation',
          placeholder: options.placeholder || measurement.label || 'Enter new label',
          defaultValue: measurement.label,
        });

        if (label !== undefined && label !== null) {
          const nextLabel = options.normalizeLabel ? options.normalizeLabel(label) : label;
          measurementService.update(uid, { ...measurement, label: nextLabel }, true);
          return nextLabel;
        }
        return null;
      }

      const val = await callInputDialogAutoComplete({
        measurement,
        uiDialogService,
        labelConfig: normalizedLabelConfig,
        renderContent,
        title: dialogTitle,
      });

      if (val !== undefined && val !== null) {
        const nextLabel = options.normalizeLabel ? options.normalizeLabel(val) : val;
        measurementService.update(uid, { ...measurement, label: nextLabel }, true);
        return nextLabel;
      }

      return null;
    },
    /**
     * Show the measurement labelling input dialog and update the label
     * on the measurement with a response if not cancelled.
     */
    setMeasurementLabel: async ({
      uid,
      title,
      placeholder,
      labelConfigOverride,
      normalizeLabel,
    } = {}) => {
      await actions._handleMeasurementLabelDialog(uid, {
        title,
        placeholder,
        labelConfigOverride,
        normalizeLabel,
      });
    },
    startLVSimpsonEFWorkflow: async ({
      slot: requestedSlot = '',
      sessionId: requestedSessionId = '',
      singleSlot = false,
    } = {}) => {
      const workflowSessionId = requestedSessionId || `${csUtils.uuidv4()}`;

      if (!requestedSessionId) {
        activeLVSimpsonWorkflowSessionId = workflowSessionId;
      }

      const isWorkflowCancelled = () => activeLVSimpsonWorkflowSessionId !== workflowSessionId;
      const { viewport } = _getActiveViewportEnabledElement() || {};
      const activeViewportId = viewportGridService.getActiveViewportId();

      if (!viewport?.element || !activeViewportId) {
        uiNotificationService.show({
          title: 'LV EF',
          message: 'No active image viewport is available.',
          type: 'warning',
          duration: 3500,
        });
        if (!requestedSessionId) {
          activeLVSimpsonWorkflowSessionId = '';
        }
        return null;
      }

      if (isWorkflowCancelled()) {
        return null;
      }

      const liveMeasurements = measurementService.getMeasurements?.() || [];
      const sessionLVSimpsonMeasurements = getLVSimpsonSessionMeasurements();

      const slotCandidates = getLVSimpsonSlotCandidates([
        ...liveMeasurements,
        ...sessionLVSimpsonMeasurements,
      ]);
      const explicitSlot = normalizeLVSimpsonSlot(requestedSlot);
      const nextMissingSlot = getNextMissingLVSimpsonSlot(slotCandidates);

      let slotSelection = explicitSlot ? buildLVSimpsonSlotSelection(explicitSlot) : null;

      if (!slotSelection && nextMissingSlot) {
        slotSelection = buildLVSimpsonSlotSelection(nextMissingSlot);
      }

      if (!slotSelection) {
        uiNotificationService.show({
          title: 'LV EF',
          message: 'All four LV EF slots already exist. Choose a slot to replace.',
          type: 'info',
          duration: 4500,
        });

        slotSelection = await resolveLVSimpsonSlot({
          uiDialogService,
          customizationService,
          title: 'Replace LV EF Slot',
          defaultSlot: 'A4C_ED',
        });
      }

      if (!slotSelection) {
        return null;
      }

      const { label, slotInfo } = slotSelection;
      const slotDisplayName = getLVSimpsonSlotDisplayName(slotInfo.slot);
      const stepNumber = getLVSimpsonStepNumber(slotInfo.slot);
      const existingSlotMeasurements = slotCandidates.get(slotInfo.slot) || [];
      const existingSlotMeasurementIds =
        getLVSimpsonExistingMeasurementIds(existingSlotMeasurements);
      const retryCurrentLVSimpsonSlot = ({
        message,
        duration = 7000,
      }: {
        message: string;
        duration?: number;
      }) => {
        if (isWorkflowCancelled()) {
          return null;
        }

        uiNotificationService.show({
          title: 'LV EF',
          message,
          type: 'warning',
          duration,
        });

        window.setTimeout(() => {
          if (activeLVSimpsonWorkflowSessionId !== workflowSessionId) {
            return;
          }

          actions.startLVSimpsonEFWorkflow({
            slot: slotInfo.slot,
            sessionId: workflowSessionId,
            singleSlot,
          });
        }, LV_SIMPSON_AUTO_CONTINUE_DELAY_MS);

        return null;
      };
      const overlay = createLVSimpsonPreviewOverlay(viewport.element);

      uiNotificationService.show({
        title: `LV EF step ${stepNumber}/4`,
        message: `Navigate to ${slotDisplayName}, then draw the mitral annular hinge line. Press Esc to cancel.`,
        type: 'info',
        duration: 7000,
      });

      const hinge = await captureLVSimpsonDrag({
        viewport,
        isCancelled: isWorkflowCancelled,
        onPreview: ({ startWorld, currentWorld }) => {
          drawLVSimpsonPreview({
            overlay,
            viewport,
            baseLeftPoint: startWorld,
            baseRightPoint: currentWorld,
          });
        },
      });

      if (!hinge) {
        clearLVSimpsonPreviewOverlay(viewport.element);
        setLVSimpsonViewportCursor(viewport.element, 'default');
        if (!requestedSessionId) {
          activeLVSimpsonWorkflowSessionId = '';
        }
        return null;
      }

      drawLVSimpsonPreview({
        overlay,
        viewport,
        baseLeftPoint: hinge.startWorld,
        baseRightPoint: hinge.endWorld,
      });

      uiNotificationService.show({
        title: `LV EF step ${stepNumber}/4`,
        message: `Now drag from the hinge midpoint to the LV apex for ${slotDisplayName}.`,
        type: 'info',
        duration: 7000,
      });

      const apexDrag = await captureLVSimpsonDrag({
        viewport,
        isCancelled: isWorkflowCancelled,
        onPreview: ({ currentWorld }) => {
          drawLVSimpsonPreview({
            overlay,
            viewport,
            baseLeftPoint: hinge.startWorld,
            baseRightPoint: hinge.endWorld,
            apexPoint: currentWorld,
          });
        },
      });

      clearLVSimpsonPreviewOverlay(viewport.element);
      setLVSimpsonViewportCursor(viewport.element, 'default');

      if (!apexDrag?.endWorld) {
        activeLVSimpsonWorkflowSessionId = '';
        return null;
      }

      const geometry = buildLVSimpsonContourFromHingeApex({
        baseLeftPoint: hinge.startWorld,
        baseRightPoint: hinge.endWorld,
        apexPoint: apexDrag.endWorld,
      });
      const axisWarning = getLVSimpsonAxisWarning({
        slot: slotInfo.slot,
        axisLengthMM: geometry?.longAxisLengthMM,
        slotCandidates,
      });

      if (axisWarning) {
        return retryCurrentLVSimpsonSlot({
          message: `${axisWarning} Redraw ${slotInfo.slot}; LV EF remains active.`,
        });
      }
      if (!geometry?.points?.length) {
        return retryCurrentLVSimpsonSlot({
          message:
            'Could not generate LV contour from hinge/apex geometry. Redraw the hinge line, then drag from the hinge midpoint to the LV apex; LV EF remains active.',
        });
      }

      for (const existingMeasurementId of existingSlotMeasurementIds) {
        actions.removeMeasurement({ uid: existingMeasurementId });
      }

      dispatchLiveMeasurementsRefresh({
        reason: 'lv-simpson-slot-replaced',
        slot: slotInfo.slot,
      });

      const imageInfo = getCurrentViewportImageInfo(viewport);
      const displaySet = getActiveViewportDisplaySet({
        viewportGridService,
        displaySetService,
        viewportId: activeViewportId,
      });
      const annotationUID = `${csUtils.uuidv4()}`;
      const frameNumber = getFrameNumberFromReferencedImageId(imageInfo.imageId);
      const sopInstanceId =
        getSopInstanceIdFromImageId(imageInfo.imageId) ||
        displaySet?.SOPInstanceUID ||
        displaySet?.sopInstanceUID ||
        '';

      const lvSimpson = {
        measurementKind: LV_SIMPSON_MEASUREMENT_KIND,
        slot: slotInfo.slot,
        view: slotInfo.view,
        phase: slotInfo.phase,
        label,
        contourSource: 'hingeApexGenerated',
        baseLeftPoint: geometry.baseLeftPoint,
        baseRightPoint: geometry.baseRightPoint,
        baseMidpoint: geometry.baseMidpoint,
        apexPoint: geometry.apexPoint,
        contourPoints: geometry.points,
        longAxisLengthMM: geometry.longAxisLengthMM,
        userConfirmed: true,
      };

      let hydrated = null;
      try {
        hydrated = cornerstoneTools.SplineROITool?.hydrate?.(activeViewportId, geometry.points, {
          annotationUID,
        });
      } catch (error) {
        console.warn('[LV EF] SplineROI hydrate failed:', error);
      }

      const targetAnnotation =
        cornerstoneTools.annotation.state.getAnnotation?.(annotationUID) || hydrated;

      if (targetAnnotation) {
        targetAnnotation.annotationUID = annotationUID;
        targetAnnotation.metadata = {
          ...(targetAnnotation.metadata || {}),
          toolName: toolNames.SplineROI || 'SplineROI',
          referencedImageId: imageInfo.imageId,
          FrameOfReferenceUID:
            viewport.getFrameOfReferenceUID?.() ||
            targetAnnotation.metadata?.FrameOfReferenceUID ||
            '',
          SOPInstanceUID: sopInstanceId,
          SeriesInstanceUID: displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '',
          StudyInstanceUID: displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '',
        };
        targetAnnotation.data = {
          ...(targetAnnotation.data || {}),
          label,
          lvSimpson,
          handles: {
            ...(targetAnnotation.data?.handles || {}),
            points: geometry.points,
            activeHandleIndex: null,
          },
          contour: {
            ...(targetAnnotation.data?.contour || {}),
            closed: true,
            polyline: geometry.points,
          },
        };
        targetAnnotation.invalidated = false;
      }

      const measurement = {
        uid: annotationUID,
        annotationUID,
        toolName: toolNames.SplineROI || 'SplineROI',
        label,
        measurementRole: label,
        role: slotInfo.slot,
        slot: slotInfo.slot,
        view: slotInfo.view,
        phase: slotInfo.phase,
        measurementKind: LV_SIMPSON_MEASUREMENT_KIND,
        lvSimpson,
        referenceStudyUID: displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '',
        referenceSeriesUID: displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '',
        SOPInstanceUID: sopInstanceId,
        FrameOfReferenceUID: targetAnnotation?.metadata?.FrameOfReferenceUID || '',
        displaySetInstanceUID: displaySet?.displaySetInstanceUID || '',
        referencedImageId: imageInfo.imageId,
        frameNumber,
        points: geometry.points,
        displayText: [`${slotInfo.slot.replace('_', ' ')} LV EF contour`],
      };

      try {
        measurementService.update(annotationUID, measurement, true);
        actions.markViewerMeasurementCreatedInSession?.({ uid: annotationUID });
      } catch (error) {
        console.warn('[LV EF] measurementService.update failed:', error);
      }

      upsertLVSimpsonSessionMeasurement(measurement);

      dispatchLiveMeasurementsRefresh({
        reason: 'lv-simpson-slot-created',
        annotationUID,
        slot: slotInfo.slot,
      });

      try {
        cornerstoneTools.annotation.selection.setAnnotationSelected(annotationUID, true);
        installLVSimpsonContourTextCleanupForViewport({
          viewport,
          viewportId: activeViewportId,
          toolName: toolNames.SplineROI || 'SplineROI',
        });
        viewport.render?.();
      } catch {}

      const remainingSlotCandidates = getLVSimpsonSlotCandidates([
        ...measurementService.getMeasurements?.(),
        ...getLVSimpsonSessionMeasurements(),
      ]);
      const nextSlot = getNextMissingLVSimpsonSlot(remainingSlotCandidates);

      if (nextSlot && !singleSlot && !isWorkflowCancelled()) {
        uiNotificationService.show({
          title: 'LV EF',
          message: `${slotInfo.slot} created. Next: navigate to ${getLVSimpsonSlotDisplayName(
            nextSlot
          )}. LV EF remains active; draw the hinge line when ready. Press Esc to cancel.`,
          type: 'success',
          duration: 7000,
        });

        window.setTimeout(() => {
          if (activeLVSimpsonWorkflowSessionId !== workflowSessionId) {
            return;
          }

          actions.startLVSimpsonEFWorkflow({
            slot: nextSlot,
            sessionId: workflowSessionId,
            singleSlot,
          });
        }, LV_SIMPSON_AUTO_CONTINUE_DELAY_MS);

        return measurement;
      }

      activeLVSimpsonWorkflowSessionId = '';

      uiNotificationService.show({
        title: 'LV EF',
        message: `${slotInfo.slot} created. All four LV EF slots are now present.`,
        type: 'success',
        duration: 5000,
      });

      return measurement;
    },
    startLAVolumeWorkflow: async ({
      slot: requestedSlot = '',
      sessionId: requestedSessionId = '',
    } = {}) => {
      const workflowSessionId = requestedSessionId || `${csUtils.uuidv4()}`;

      if (!requestedSessionId) {
        activeLAVolumeWorkflowSessionId = workflowSessionId;
      }

      const isWorkflowCancelled = () => activeLAVolumeWorkflowSessionId !== workflowSessionId;
      const { viewport } = _getActiveViewportEnabledElement() || {};
      const activeViewportId = viewportGridService.getActiveViewportId();

      if (!viewport?.element || !activeViewportId) {
        uiNotificationService.show({
          title: 'LA Volume',
          message: 'No active image viewport is available.',
          type: 'warning',
          duration: 3500,
        });
        if (activeLAVolumeWorkflowSessionId === workflowSessionId) {
          activeLAVolumeWorkflowSessionId = '';
        }
        return null;
      }

      if (isWorkflowCancelled()) {
        return null;
      }

      const liveMeasurements = measurementService.getMeasurements?.() || [];
      const slotCandidates = getLAVolumeSlotCandidates([
        ...liveMeasurements,
        ...getLAVolumeSessionMeasurements(),
      ]);
      const explicitSlot = normalizeLAVolumeSlot(requestedSlot);
      const nextMissingSlot = getNextMissingLAVolumeSlot(slotCandidates);

      let slotSelection = explicitSlot ? buildLAVolumeSlotSelection(explicitSlot) : null;

      if (!slotSelection && nextMissingSlot) {
        slotSelection = buildLAVolumeSlotSelection(nextMissingSlot);
      }

      if (!slotSelection) {
        uiNotificationService.show({
          title: 'LA Volume',
          message: 'Both LA volume views already exist. Choose a view to replace.',
          type: 'info',
          duration: 4500,
        });

        slotSelection = await resolveLAVolumeSlot({
          uiDialogService,
          customizationService,
          title: 'Replace LA Volume View',
          defaultSlot: 'A4C',
        });
      }

      if (!slotSelection || isWorkflowCancelled()) {
        activeLAVolumeWorkflowSessionId = '';
        return null;
      }

      const { label, slotInfo } = slotSelection;
      const slotDisplayName = getLAVolumeSlotDisplayName(slotInfo.slot);
      const stepNumber = getLAVolumeStepNumber(slotInfo.slot);
      const existingSlotMeasurements = slotCandidates.get(slotInfo.slot) || [];
      const existingSlotMeasurementIds = getLAVolumeExistingMeasurementIds(
        existingSlotMeasurements
      );
      const overlay = createLVSimpsonPreviewOverlay(viewport.element);

      uiNotificationService.show({
        title: `LA Volume step ${stepNumber}/2`,
        message: `Navigate to ${slotDisplayName}. Draw the mitral annular closure line from one annular edge to the other. Press Esc to cancel.`,
        type: 'info',
        duration: 8000,
      });

      const annulus = await captureLVSimpsonDrag({
        viewport,
        isCancelled: isWorkflowCancelled,
        onPreview: ({ startWorld, currentWorld }) => {
          drawLVSimpsonPreview({
            overlay,
            viewport,
            baseLeftPoint: startWorld,
            baseRightPoint: currentWorld,
          });
        },
      });

      if (!annulus || isWorkflowCancelled()) {
        clearLVSimpsonPreviewOverlay(viewport.element);
        setLVSimpsonViewportCursor(viewport.element, 'default');
        activeLAVolumeWorkflowSessionId = '';
        return null;
      }

      drawLVSimpsonPreview({
        overlay,
        viewport,
        baseLeftPoint: annulus.startWorld,
        baseRightPoint: annulus.endWorld,
      });

      uiNotificationService.show({
        title: `LA Volume step ${stepNumber}/2`,
        message: `Now drag from the annular midpoint to the inner edge of the furthest superior LA wall for ${slotDisplayName}.`,
        type: 'info',
        duration: 8000,
      });

      const superiorDrag = await captureLVSimpsonDrag({
        viewport,
        isCancelled: isWorkflowCancelled,
        onPreview: ({ currentWorld }) => {
          drawLVSimpsonPreview({
            overlay,
            viewport,
            baseLeftPoint: annulus.startWorld,
            baseRightPoint: annulus.endWorld,
            apexPoint: currentWorld,
          });
        },
      });

      clearLVSimpsonPreviewOverlay(viewport.element);
      setLVSimpsonViewportCursor(viewport.element, 'default');

      if (!superiorDrag?.endWorld || isWorkflowCancelled()) {
        activeLAVolumeWorkflowSessionId = '';
        return null;
      }

      const geometry = buildEchoVolumeContourFromBaseAxis({
        baseLeftPoint: annulus.startWorld,
        baseRightPoint: annulus.endWorld,
        axisPoint: superiorDrag.endWorld,
      });

      if (!geometry?.points?.length) {
        activeLAVolumeWorkflowSessionId = '';
        uiNotificationService.show({
          title: 'LA Volume',
          message:
            'Could not generate the LA contour. Redraw the mitral annular line, then drag from the annular midpoint to the superior LA wall.',
          type: 'warning',
          duration: 7000,
        });
        return null;
      }

      for (const existingMeasurementId of existingSlotMeasurementIds) {
        actions.removeMeasurement({ uid: existingMeasurementId });
      }

      dispatchLiveMeasurementsRefresh({
        reason: 'la-volume-slot-replaced',
        slot: slotInfo.slot,
      });

      const imageInfo = getCurrentViewportImageInfo(viewport);
      const displaySet = getActiveViewportDisplaySet({
        viewportGridService,
        displaySetService,
        viewportId: activeViewportId,
      });
      const annotationUID = `${csUtils.uuidv4()}`;
      const frameNumber = getFrameNumberFromReferencedImageId(imageInfo.imageId);
      const sopInstanceId =
        getSopInstanceIdFromImageId(imageInfo.imageId) ||
        displaySet?.SOPInstanceUID ||
        displaySet?.sopInstanceUID ||
        '';

      const laVolume = {
        measurementKind: LA_VOLUME_MEASUREMENT_KIND,
        slot: slotInfo.slot,
        view: slotInfo.view,
        phase: 'ES',
        label,
        contourSource: 'annulusAxisGenerated',
        baseLeftPoint: geometry.baseLeftPoint,
        baseRightPoint: geometry.baseRightPoint,
        baseMidpoint: geometry.baseMidpoint,
        superiorPoint: geometry.axisPoint,
        axisPoint: geometry.axisPoint,
        axisPointIndex: geometry.axisPointIndex,
        contourPoints: geometry.points,
        longAxisLengthMM: geometry.longAxisLengthMM,
        userConfirmed: true,
      };

      let hydrated = null;

      try {
        hydrated = cornerstoneTools.SplineROITool?.hydrate?.(activeViewportId, geometry.points, {
          annotationUID,
        });
      } catch (error) {
        console.warn('[LA Volume] SplineROI hydrate failed:', error);
      }

      const targetAnnotation =
        cornerstoneTools.annotation.state.getAnnotation?.(annotationUID) || hydrated;

      if (targetAnnotation) {
        targetAnnotation.annotationUID = annotationUID;
        targetAnnotation.metadata = {
          ...(targetAnnotation.metadata || {}),
          toolName: toolNames.SplineROI || 'SplineROI',
          referencedImageId: imageInfo.imageId,
          FrameOfReferenceUID:
            viewport.getFrameOfReferenceUID?.() ||
            targetAnnotation.metadata?.FrameOfReferenceUID ||
            '',
          SOPInstanceUID: sopInstanceId,
          SeriesInstanceUID: displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '',
          StudyInstanceUID: displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '',
        };
        targetAnnotation.data = {
          ...(targetAnnotation.data || {}),
          label,
          laVolume,
          handles: {
            ...(targetAnnotation.data?.handles || {}),
            points: geometry.points,
            activeHandleIndex: null,
          },
          contour: {
            ...(targetAnnotation.data?.contour || {}),
            closed: true,
            polyline: geometry.points,
          },
        };
        targetAnnotation.invalidated = false;
      }

      const measurement = {
        uid: annotationUID,
        annotationUID,
        toolName: toolNames.SplineROI || 'SplineROI',
        label,
        measurementRole: label,
        role: slotInfo.slot,
        slot: slotInfo.slot,
        view: slotInfo.view,
        phase: 'ES',
        measurementKind: LA_VOLUME_MEASUREMENT_KIND,
        laVolume,
        referenceStudyUID: displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '',
        referenceSeriesUID: displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '',
        SOPInstanceUID: sopInstanceId,
        FrameOfReferenceUID: targetAnnotation?.metadata?.FrameOfReferenceUID || '',
        displaySetInstanceUID: displaySet?.displaySetInstanceUID || '',
        referencedImageId: imageInfo.imageId,
        frameNumber,
        points: geometry.points,
        displayText: [`${slotInfo.slot} LA volume contour`],
      };

      try {
        measurementService.update(annotationUID, measurement, true);
        actions.markViewerMeasurementCreatedInSession?.({ uid: annotationUID });
      } catch (error) {
        console.warn('[LA Volume] measurementService.update failed:', error);
      }

      upsertLAVolumeSessionMeasurement(measurement);

      dispatchLiveMeasurementsRefresh({
        reason: 'la-volume-slot-created',
        annotationUID,
        slot: slotInfo.slot,
      });

      try {
        cornerstoneTools.annotation.selection.setAnnotationSelected(annotationUID, true);
        installLVSimpsonContourTextCleanupForViewport({
          viewport,
          viewportId: activeViewportId,
          toolName: toolNames.SplineROI || 'SplineROI',
        });
        viewport.render?.();
      } catch {}

      const remainingSlotCandidates = getLAVolumeSlotCandidates([
        ...measurementService.getMeasurements?.(),
        ...getLAVolumeSessionMeasurements(),
      ]);
      const nextSlot = getNextMissingLAVolumeSlot(remainingSlotCandidates);

      if (nextSlot && !isWorkflowCancelled()) {
        uiNotificationService.show({
          title: 'LA Volume',
          message: `${slotInfo.slot} created. Navigate to ${getLAVolumeSlotDisplayName(
            nextSlot
          )}. LA Volume remains active; draw the mitral annular closure line when ready. Press Esc to cancel.`,
          type: 'success',
          duration: 9000,
        });

        window.setTimeout(() => {
          if (activeLAVolumeWorkflowSessionId !== workflowSessionId) {
            return;
          }

          actions.startLAVolumeWorkflow({
            slot: nextSlot,
            sessionId: workflowSessionId,
          });
        }, LA_VOLUME_AUTO_CONTINUE_DELAY_MS);

        return measurement;
      }

      activeLAVolumeWorkflowSessionId = '';

      uiNotificationService.show({
        title: 'LA Volume',
        message:
          'A4C and A2C LA contours are present. Adjust either spline as needed; the biplane volume in AR Measurements updates from the edited contours.',
        type: 'success',
        duration: 8000,
      });

      return measurement;
    },
    startSpectralDopplerVTIWorkflow: async () => {
      clearSpectralDopplerWorkflowListeners();

      const activeViewportId = viewportGridService.getActiveViewportId();
      const { viewport } = _getActiveViewportEnabledElement() || {};

      if (!activeViewportId || !viewport?.element) {
        uiNotificationService.show({
          title: 'VTI Trace',
          message: 'No active image viewport is available.',
          type: 'warning',
          duration: 3500,
        });
        return null;
      }

      const saveTarget = getArViewerSaveTargetFromUrl();
      const isClinicalReportTarget = isClinicalReportMeasurementsSaveTarget(saveTarget);
      const selectedTarget = await resolveSpectralDopplerVtiTarget({
        uiDialogService,
        customizationService,
        allowGeneric: !isClinicalReportTarget,
      });

      if (!selectedTarget) {
        uiNotificationService.show({
          title: 'VTI Trace',
          message: isClinicalReportTarget
            ? 'Choose the AR report measurement that should receive this VTI.'
            : 'VTI tracing cancelled.',
          type: isClinicalReportTarget ? 'warning' : 'info',
          duration: 3500,
        });
        return null;
      }

      const reportMapping = buildViewerReportMapping(selectedTarget);
      const measurementLabel = selectedTarget.reportMapped
        ? selectedTarget.label
        : SPECTRAL_DOPPLER_LABEL;

      const activation = actions.activateViewerMeasurementTool({
        toolName: toolNames.PlanarFreehandROI || 'PlanarFreehandROI',
        stopCine: true,
      });

      if (!activation?.ok) {
        uiNotificationService.show({
          title: 'VTI Trace',
          message: 'The freehand contour tool is not available in this viewport.',
          type: 'warning',
          duration: 4500,
        });
        return null;
      }

      const workflowSessionId = `${csUtils.uuidv4()}`;
      activeSpectralDopplerWorkflowSessionId = workflowSessionId;

      const restoreNavigationTool = () => {
        try {
          const toolGroupReference = toolGroupService.getToolGroupForViewport(activeViewportId);
          actions.setToolActive({
            toolName: toolNames.WindowLevel || 'WindowLevel',
            toolGroupId: toolGroupReference,
          });
        } catch {}
      };

      spectralDopplerEscapeHandler = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || activeSpectralDopplerWorkflowSessionId !== workflowSessionId) {
          return;
        }

        clearSpectralDopplerWorkflowListeners();
        restoreNavigationTool();
        uiNotificationService.show({
          title: 'VTI Trace',
          message: 'VTI tracing cancelled.',
          type: 'info',
          duration: 2500,
        });
      };

      spectralDopplerCompletionHandler = async (event: Event) => {
        if (activeSpectralDopplerWorkflowSessionId !== workflowSessionId) {
          return;
        }

        const eventDetail = (event as CustomEvent)?.detail || {};
        const sourceAnnotation = eventDetail.annotation;
        const sourceToolName = String(sourceAnnotation?.metadata?.toolName || '');

        if (sourceToolName !== (toolNames.PlanarFreehandROI || 'PlanarFreehandROI')) {
          return;
        }

        const annotationId = String(sourceAnnotation?.annotationUID || '').trim();

        if (!annotationId) {
          return;
        }

        clearSpectralDopplerWorkflowListeners({ resetSession: false });
        activeSpectralDopplerWorkflowSessionId = '';
        restoreNavigationTool();

        const mappedMeasurement = await waitForViewerMeasurementServiceEntry(
          measurementService,
          annotationId
        );

        const contourPoints =
          sourceAnnotation?.data?.contour?.polyline ||
          sourceAnnotation?.data?.handles?.points ||
          mappedMeasurement?.points ||
          [];
        const referencedImageId =
          mappedMeasurement?.referencedImageId || sourceAnnotation?.metadata?.referencedImageId || '';
        const workingMeasurement = {
          ...(mappedMeasurement || {}),
          uid: annotationId,
          annotationUID: annotationId,
          toolName: toolNames.PlanarFreehandROI || 'PlanarFreehandROI',
          label: measurementLabel,
          measurementRole: measurementLabel,
          role: measurementLabel,
          measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
          ...(reportMapping ? { reportMapping } : {}),
          points: contourPoints,
          referencedImageId,
          SOPInstanceUID:
            mappedMeasurement?.SOPInstanceUID || sourceAnnotation?.metadata?.SOPInstanceUID || '',
          referenceSeriesUID:
            mappedMeasurement?.referenceSeriesUID ||
            sourceAnnotation?.metadata?.SeriesInstanceUID ||
            '',
          referenceStudyUID:
            mappedMeasurement?.referenceStudyUID || sourceAnnotation?.metadata?.StudyInstanceUID || '',
          FrameOfReferenceUID:
            mappedMeasurement?.FrameOfReferenceUID ||
            sourceAnnotation?.metadata?.FrameOfReferenceUID ||
            '',
        };
        const dicomSource = getInstanceForViewerMeasurement(displaySetService, workingMeasurement);
        const spectralDopplerCalculation = calculateSpectralDopplerVTI({
          points: contourPoints,
          referencedImageId,
          dicomSource,
        });
        const spectralDoppler = {
          ...spectralDopplerCalculation,
          ...(reportMapping ? { reportMapping } : {}),
        };
        const displayText = buildSpectralDopplerDisplayText(spectralDoppler);

        console.info('[VTI Trace] spectral calculation', {
          annotationId,
          status: spectralDoppler.status,
          message: spectralDoppler.message || '',
          calibration: spectralDoppler.calibration || null,
          values: spectralDoppler.values || null,
          reportTarget: reportMapping || null,
          clinicalReportTarget: isClinicalReportTarget,
        });

        const nextMeasurement = {
          ...workingMeasurement,
          spectralDoppler,
          measurements: {
            ...(workingMeasurement?.measurements || {}),
            measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
            spectralDoppler,
            displayText,
          },
          displayText,
        };

        sourceAnnotation.metadata = {
          ...(sourceAnnotation.metadata || {}),
          toolName: toolNames.PlanarFreehandROI || 'PlanarFreehandROI',
          referencedImageId,
        };
        sourceAnnotation.data = {
          ...(sourceAnnotation.data || {}),
          label: measurementLabel,
          spectralDoppler,
          ...(reportMapping ? { reportMapping } : {}),
          arSpectralDopplerDisplayText: displayText,
          arSavedMeasurementDisplayText: displayText,
        };
        sourceAnnotation.invalidated = false;

        try {
          measurementService.update(annotationId, nextMeasurement, true);
          actions.markViewerMeasurementCreatedInSession?.({ uid: annotationId });
        } catch (error) {
          console.warn('[VTI Trace] measurementService.update failed:', error);
        }

        installSpectralDopplerTextOverrideForViewport({
          viewport,
          viewportId: activeViewportId,
        });
        dispatchLiveMeasurementsRefresh({
          reason: 'spectral-doppler-vti-created',
          annotationUID: annotationId,
          status: spectralDoppler.status,
        });

        try {
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(annotationId, true);
          viewport.render?.();
        } catch {}

        uiNotificationService.show({
          title: 'VTI Trace',
          message:
            spectralDoppler.status === 'complete'
              ? `${measurementLabel}: ${getSpectralDopplerSummaryText(spectralDoppler)}`
              : `${spectralDoppler.message || 'Spectral Doppler calibration unavailable.'} The trace was preserved without a calculated VTI.`,
          type: spectralDoppler.status === 'complete' ? 'success' : 'warning',
          duration: spectralDoppler.status === 'complete' ? 6000 : 8000,
        });
      };

      eventTarget.addEventListener(
        Enums.Events.ANNOTATION_COMPLETED,
        spectralDopplerCompletionHandler
      );
      window.addEventListener('keydown', spectralDopplerEscapeHandler);

      uiNotificationService.show({
        title: 'VTI Trace',
        message: `Trace one complete PW/CW Doppler envelope for ${measurementLabel}. Start and finish at the zero-velocity baseline when possible. Press Esc to cancel.`,
        type: 'info',
        duration: 8000,
      });

      return {
        ok: true,
        sessionId: workflowSessionId,
        toolName: toolNames.PlanarFreehandROI || 'PlanarFreehandROI',
      };
    },
    setLVTraceMeasurementLabel: async ({ uid } = {}) => {
      if (!uid) {
        uiNotificationService.show({
          title: 'LV Trace',
          message: 'No LV trace measurement was selected.',
          type: 'warning',
          duration: 3500,
        });
        return null;
      }

      const measurement = measurementService.getMeasurement(uid);

      if (!measurement) {
        uiNotificationService.show({
          title: 'LV Trace',
          message: 'LV trace is not available as a viewer measurement.',
          type: 'warning',
          duration: 3500,
        });
        return null;
      }

      if (measurement.toolName !== toolNames.SplineROI && measurement.toolName !== 'SplineROI') {
        uiNotificationService.show({
          title: 'LV Trace',
          message: 'Please select an LV Trace / Spline ROI contour.',
          type: 'warning',
          duration: 3500,
        });
        return null;
      }

      const nextLabel = await actions._handleMeasurementLabelDialog(uid, {
        title: 'Set LV Slot',
        placeholder: 'Choose LV A4C/A2C ED/ES slot',
        labelConfigOverride: LV_TRACE_MEASUREMENT_LABELS_CONFIG,
        normalizeLabel: normalizeLVTraceSelection,
      });

      if (!nextLabel) {
        return null;
      }

      const slotInfo = parseLVTraceLabel(nextLabel);

      uiNotificationService.show({
        title: 'LV Trace',
        message: slotInfo ? `LV slot set: ${slotInfo.slot}` : `Label set: ${nextLabel}`,
        type: slotInfo ? 'success' : 'warning',
        duration: 3000,
      });

      return nextLabel;
    },
    setSelectedMeasurementLabel: async () => {
      const selectedAnnotationUIDs = cornerstoneTools.annotation.selection.getAnnotationsSelected();
      const uid = selectedAnnotationUIDs?.[0];

      if (!uid) {
        uiNotificationService.show({
          title: 'LV Trace',
          message: 'Select an LV trace first, then choose Set LV Slot.',
          type: 'warning',
          duration: 3500,
        });
        return;
      }

      await actions.setLVTraceMeasurementLabel({ uid });
    },
    hydrateMeasurementAnnotationsForActiveStudy: async ({
      seriesDoc,
      workflows,
      domains,
      notify = false,
    } = {}) => {
      const saveTarget = getArViewerSaveTargetFromUrl();
      let targetSeriesDoc = seriesDoc;

      if (!targetSeriesDoc && isLearnerCopyOnSaveTarget(saveTarget)) {
        targetSeriesDoc = await resolveViewerReadSeriesDoc(servicesManager, {
          allowBaseFallback: false,
        });

        if (!targetSeriesDoc) {
          return {
            seriesDoc: null,
            restoredCount: 0,
            skippedCount: 0,
            restoredAnnotations: [],
            processedAnnotations: [],
          };
        }
      }
      try {
        const resolvedWorkflows = getMeasurementWorkflowsForRead(saveTarget, workflows);

        const result = await hydrateMeasurementAnnotationsForActiveStudyUtil({
          servicesManager,
          seriesDoc: targetSeriesDoc,
          workflows: resolvedWorkflows,
          domains,
        });

        const processedAnnotations = excludeViewerMeasurementsDeletedInSession(
          decorateReviewWorkflowAnnotations({
            annotations: result.processedAnnotations || [],
            seriesDoc: result.seriesDoc,
            saveTarget,
          })
        );

        const decoratedResult = {
          ...result,
          processedAnnotations,
        };

        console.info('[MeasurementAnnotations] hydration result', {
          workflows: resolvedWorkflows,
          domains,
          restoredCount: result.restoredCount,
          skippedCount: result.skippedCount,
          processedCount: processedAnnotations.length,
        });

        dispatchSavedAnnotationsRefresh({
          seriesDoc: result.seriesDoc,
          saveTarget,
          annotations: processedAnnotations,
          processedAnnotations,
          domain: Array.isArray(domains) && domains.length === 1 ? domains[0] : '',
        });

        if (notify && result.restoredCount > 0) {
          uiNotificationService.show({
            title: 'Measurements',
            message: `${result.restoredCount} saved measurement${
              result.restoredCount === 1 ? '' : 's'
            } restored.`,
            type: 'success',
            duration: 2500,
          });
        }

        return decoratedResult;
      } catch (error) {
        console.warn('[MeasurementAnnotations] hydration failed:', error);

        if (notify) {
          uiNotificationService.show({
            title: 'Measurements',
            message: `Could not restore saved measurements: ${error.message}`,
            type: 'warning',
            duration: 4000,
          });
        }

        return {
          seriesDoc,
          restoredCount: 0,
          skippedCount: 0,
          restoredAnnotations: [],
          processedAnnotations: [],
          error,
        };
      }
    },
    renameMeasurement: async ({ uid }) => {
      await actions._handleMeasurementLabelDialog(uid);
    },
    /**
     *
     * @param props - containing the updates to apply
     * @param props.measurementKey - chooses the measurement key to apply the
     *        code to.  This will typically be finding or site to apply a
     *        finding code or a findingSites code.
     * @param props.code - A coding scheme value from DICOM, including:
     *       * CodeValue - the language independent code, for example '1234'
     *       * CodingSchemeDesignator - the issue of the code value
     *       * CodeMeaning - the text value shown to the user
     *       * ref - a string reference in the form `<designator>:<codeValue>`
     *       * type - defaulting to 'finding'.  Will replace other codes of same type
     *       * style - a styling object to use
     *       * Other fields
     *     Note it is a valid option to remove the finding or site values by
     *     supplying null for the code.
     * @param props.uid - the measurement UID to find it with
     * @param props.label - the text value for the code.  Has NOTHING to do with
     *        the measurement label, which can be set with textLabel
     * @param props.textLabel is the measurement label to apply.  Set to null to
     *            delete.
     *
     * If the measurementKey is `site`, then the code will also be added/replace
     * the 0 element of findingSites.  This behaviour is expected to be enhanced
     * in the future with ability to set other site information.
     */
    updateMeasurement: props => {
      const { code, uid, textLabel, label } = props;
      let { style } = props;
      const measurement = measurementService.getMeasurement(uid);
      if (!measurement) {
        console.warn('No measurement found to update', uid);
        return;
      }
      const updatedMeasurement = {
        ...measurement,
      };
      // Call it textLabel as the label value
      // TODO - remove the label setting when direct rendering of findingSites is enabled
      if (textLabel !== undefined) {
        updatedMeasurement.label = textLabel;
      }
      if (code !== undefined) {
        const measurementKey = code.type || 'finding';

        if (code.ref && !code.CodeValue) {
          const split = code.ref.indexOf(':');
          code.CodeValue = code.ref.substring(split + 1);
          code.CodeMeaning = code.text || label;
          code.CodingSchemeDesignator = code.ref.substring(0, split);
        }
        updatedMeasurement[measurementKey] = code;
        if (measurementKey !== 'finding') {
          if (updatedMeasurement.findingSites) {
            updatedMeasurement.findingSites = updatedMeasurement.findingSites.filter(
              it => it.type !== measurementKey
            );
            updatedMeasurement.findingSites.push(code);
          } else {
            updatedMeasurement.findingSites = [code];
          }
        }
      }

      style ||= updatedMeasurement.finding?.style;
      style ||= updatedMeasurement.findingSites?.find(site => site?.style)?.style;

      if (style) {
        // Reset the selected values to preserve appearance on selection
        style.lineDashSelected ||= style.lineDash;
        annotation.config.style.setAnnotationStyles(measurement.uid, style);

        // this is a bit ugly, but given the underlying behavior, this is how it needs to work.
        switch (measurement.toolName) {
          case toolNames.PlanarFreehandROI: {
            const targetAnnotation = annotation.state.getAnnotation(measurement.uid);
            targetAnnotation.data.isOpenUShapeContour = !!style.isOpenUShapeContour;
            break;
          }
          default:
            break;
        }
      }
      measurementService.update(updatedMeasurement.uid, updatedMeasurement, true);
    },

    /**
     * Jumps to the specified (by uid) measurement in the active viewport.
     * Also marks any provided display measurements isActive value
     */
    jumpToMeasurement: ({ uid, displayMeasurements = [] }) => {
      measurementService.jumpToMeasurement(viewportGridService.getActiveViewportId(), uid);
      for (const measurement of displayMeasurements) {
        measurement.isActive = measurement.uid === uid;
      }
    },

    removeMeasurement: ({ uid }) => {
      const measurementIds = (Array.isArray(uid) ? uid : [uid])
        .map(value => String(value || '').trim())
        .filter(Boolean);

      for (const measurementId of measurementIds) {
        const measurement = measurementService.getMeasurement?.(measurementId);
        const sourceAnnotation = annotation.state.getAnnotation?.(measurementId);
        const isReadOnly = !!(
          measurement?.isLocked ||
          sourceAnnotation?.isLocked ||
          sourceAnnotation?.data?.arMeasurementReadOnly
        );

        if (isReadOnly) {
          continue;
        }

        viewerMeasurementsCreatedInSession.delete(measurementId);
        viewerMeasurementsDeletedInSession.add(measurementId);
        removeLVSimpsonSessionMeasurement(measurementId);
        removeLAVolumeSessionMeasurement(measurementId);

        if (sourceAnnotation) {
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(measurementId, false);
        }

        if (measurement) {
          measurementService.remove(measurementId);
        } else if (sourceAnnotation) {
          annotation.state.removeAnnotation?.(measurementId);
        }
      }

      cornerstoneViewportService.getRenderingEngine()?.render?.();

      dispatchSavedAnnotationsRefresh({
        reason: 'viewer-measurement-deleted',
      });
    },

    toggleLockMeasurement: ({ uid }) => {
      measurementService.toggleLockMeasurement(uid);
    },

    toggleVisibilityMeasurement: ({ uid, items, visibility }) => {
      if (visibility === undefined && items?.length) {
        visibility = !items[0].isVisible;
      }
      if (Array.isArray(uid)) {
        measurementService.toggleVisibilityMeasurementMany(uid, visibility);
      } else {
        measurementService.toggleVisibilityMeasurement(uid, visibility);
      }
    },

    /**
     * Download the CSV report for the measurements.
     */
    downloadCSVMeasurementsReport: ({ measurementFilter }) => {
      utils.downloadCSVReport(measurementService.getMeasurements(measurementFilter));
    },

    downloadCSVSegmentationReport: ({ segmentationId }) => {
      const segmentation = segmentationService.getSegmentation(segmentationId);

      const { representationData } = segmentation;
      const { Labelmap } = representationData;
      const { referencedImageIds } = Labelmap;

      const firstImageId = referencedImageIds[0];

      // find displaySet for firstImageId
      const displaySet = displaySetService
        .getActiveDisplaySets()
        .find(ds => ds.imageIds?.some(i => i === firstImageId));

      const {
        SeriesNumber,
        SeriesInstanceUID,
        StudyInstanceUID,
        SeriesDate,
        SeriesTime,
        SeriesDescription,
      } = displaySet;

      const additionalInfo = {
        reference: {
          SeriesNumber,
          SeriesInstanceUID,
          StudyInstanceUID,
          SeriesDate,
          SeriesTime,
          SeriesDescription,
        },
      };

      generateSegmentationCSVReport(segmentation, additionalInfo);
    },

    // Retrieve value commands
    getActiveViewportEnabledElement: _getActiveViewportEnabledElement,

    setViewportActive: ({ viewportId }) => {
      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
      if (!viewportInfo) {
        console.warn('No viewport found for viewportId:', viewportId);
        return;
      }

      viewportGridService.setActiveViewportId(viewportId);
    },
    arrowTextCallback: async ({ callback, data }) => {
      const existingText = String(
        data?.data?.text || data?.text || data?.data?.label || data?.label || ''
      );
      const isCoachingAnnotation = isReviewWorkflowMeasurementsSaveTarget(
        getArViewerSaveTargetFromUrl()
      );

      const value = await callInputDialog({
        uiDialogService,
        title: existingText
          ? isCoachingAnnotation
            ? 'Edit Coaching Annotation'
            : 'Edit Image Annotation'
          : isCoachingAnnotation
            ? 'Add Coaching Annotation'
            : 'Add Image Annotation',
        placeholder: isCoachingAnnotation
          ? 'Describe the finding or area of interest for review'
          : 'Enter annotation text',
        defaultValue: existingText,
      });

      callback?.(value);
    },
    toggleCine: () => {
      const { viewports } = viewportGridService.getState();
      const { isCineEnabled } = cineService.getState();
      const nextIsCineEnabled = !isCineEnabled;

      cineService.setIsCineEnabled(nextIsCineEnabled);
      viewports.forEach((_, index) => cineService.setCine({ id: index, isPlaying: false }));
    },

    setViewportWindowLevel({
      viewportId,
      windowWidth,
      windowCenter,
      displaySetInstanceUID,
    }: {
      viewportId: string;
      windowWidth: number;
      windowCenter: number;
      displaySetInstanceUID?: string;
    }) {
      // convert to numbers
      const windowWidthNum = Number(windowWidth);
      const windowCenterNum = Number(windowCenter);

      // get actor from the viewport
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      const viewport = renderingEngine.getViewport(viewportId);

      const { lower, upper } = csUtils.windowLevel.toLowHighRange(windowWidthNum, windowCenterNum);

      if (viewport instanceof BaseVolumeViewport) {
        const volumeId = actions.getVolumeIdForDisplaySet({
          viewportId,
          displaySetInstanceUID,
        });
        viewport.setProperties(
          {
            voiRange: {
              upper,
              lower,
            },
          },
          volumeId
        );
      } else {
        viewport.setProperties({
          voiRange: {
            upper,
            lower,
          },
        });
      }
      viewport.render();
    },
    toggleViewportColorbar: ({ viewportId, displaySetInstanceUIDs, options = {} }) => {
      const hasColorbar = colorbarService.hasColorbar(viewportId);
      if (hasColorbar) {
        colorbarService.removeColorbar(viewportId);
        return;
      }
      colorbarService.addColorbar(viewportId, displaySetInstanceUIDs, options);
    },
    setWindowLevel(props) {
      const { toolGroupId } = props;
      const { viewportId } = _getActiveViewportEnabledElement();
      const viewportToolGroupId = toolGroupService.getToolGroupForViewport(viewportId);

      if (toolGroupId && toolGroupId !== viewportToolGroupId) {
        return;
      }

      actions.setViewportWindowLevel({ ...props, viewportId });
    },
    setWindowLevelPreset: ({ presetName, presetIndex }) => {
      const windowLevelPresets = customizationService.getCustomization(
        'cornerstone.windowLevelPresets'
      );

      const activeViewport = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewport);
      const metadata = viewport.getImageData().metadata;

      const modality = metadata.Modality;

      if (!modality) {
        return;
      }

      const windowLevelPresetForModality = windowLevelPresets[modality];

      if (!windowLevelPresetForModality) {
        return;
      }

      const windowLevelPreset =
        windowLevelPresetForModality[presetName] ??
        Object.values(windowLevelPresetForModality)[presetIndex];

      actions.setViewportWindowLevel({
        viewportId: activeViewport,
        windowWidth: windowLevelPreset.window,
        windowCenter: windowLevelPreset.level,
      });
    },
    getVolumeIdForDisplaySet: ({ viewportId, displaySetInstanceUID }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (viewport instanceof BaseVolumeViewport) {
        const volumeIds = viewport.getAllVolumeIds();
        const volumeId = volumeIds.find(id => id.includes(displaySetInstanceUID));
        return volumeId;
      }
      return null;
    },
    setToolEnabled: ({ toolName, toggle, toolGroupId }) => {
      const { viewports } = viewportGridService.getState();

      if (!viewports.size) {
        return;
      }

      const toolGroup = toolGroupService.getToolGroup(toolGroupId ?? null);

      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsEnabled = toolGroup.getToolOptions(toolName).mode === Enums.ToolModes.Enabled;

      // Toggle the tool's state only if the toggle is true
      if (toggle) {
        toolIsEnabled ? toolGroup.setToolDisabled(toolName) : toolGroup.setToolEnabled(toolName);
      } else {
        toolGroup.setToolEnabled(toolName);
      }

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    toggleEnabledDisabledToolbar({ value, itemId, toolGroupId }) {
      const toolName = itemId || value;
      toolGroupId = toolGroupId ?? _getActiveViewportToolGroupId();

      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsEnabled = toolGroup.getToolOptions(toolName).mode === Enums.ToolModes.Enabled;

      toolIsEnabled ? toolGroup.setToolDisabled(toolName) : toolGroup.setToolEnabled(toolName);
    },
    toggleActiveDisabledToolbar({ value, itemId, toolGroupId }) {
      const toolName = itemId || value;
      toolGroupId = toolGroupId ?? _getActiveViewportToolGroupId();
      const toolGroup = toolGroupService.getToolGroup(toolGroupId);
      if (!toolGroup || !toolGroup.hasTool(toolName)) {
        return;
      }

      const toolIsActive = [
        Enums.ToolModes.Active,
        Enums.ToolModes.Enabled,
        Enums.ToolModes.Passive,
      ].includes(toolGroup.getToolOptions(toolName).mode);

      toolIsActive
        ? toolGroup.setToolDisabled(toolName)
        : actions.setToolActive({ toolName, toolGroupId });

      // we should set the previously active tool to active after we set the
      // current tool disabled
      if (toolIsActive) {
        const prevToolName = toolGroup.getPrevActivePrimaryToolName();
        if (prevToolName !== toolName) {
          actions.setToolActive({ toolName: prevToolName, toolGroupId });
        }
      }
    },
    setToolActiveToolbar: ({ value, itemId, toolName, toolGroupIds = [] }) => {
      // Sometimes it is passed as value (tools with options), sometimes as itemId (toolbar buttons)
      toolName = toolName || itemId || value;

      toolGroupIds = toolGroupIds.length ? toolGroupIds : toolGroupService.getToolGroupIds();

      toolGroupIds.forEach(toolGroupId => {
        actions.setToolActive({ toolName, toolGroupId });
      });
    },
    setViewerLengthLabelMode: ({ labelMode = VIEWER_LENGTH_LABEL_MODE_PROMPT } = {}) => {
      viewerLengthLabelMode = normalizeViewerLengthLabelMode(labelMode);
      return viewerLengthLabelMode;
    },
    getViewerLengthLabelMode: () => viewerLengthLabelMode,
    resetViewerLengthLabelMode: () => {
      viewerLengthLabelMode = VIEWER_LENGTH_LABEL_MODE_PROMPT;
      return viewerLengthLabelMode;
    },
    activateViewerLengthMeasurementMode: ({
      labelMode = VIEWER_LENGTH_LABEL_MODE_PROMPT,
      toolGroupIds = [],
    } = {}) => {
      viewerLengthLabelMode = normalizeViewerLengthLabelMode(labelMode);
      actions.setToolActiveToolbar({
        toolName: 'Length',
        toolGroupIds,
      });

      return {
        ok: true,
        toolName: 'Length',
        labelMode: viewerLengthLabelMode,
      };
    },
    setToolActive: ({ toolName, toolGroupId = null }) => {
      const { viewports } = viewportGridService.getState();

      if (!viewports.size) {
        return;
      }

      const toolGroupReference = toolGroupId ?? _getActiveViewportToolGroupId();
      const toolGroup =
        typeof toolGroupReference === 'string'
          ? toolGroupService.getToolGroup(toolGroupReference)
          : toolGroupReference;

      if (!toolGroup) {
        return;
      }

      if (!toolGroup?.hasTool(toolName)) {
        return;
      }

      const activeToolName = toolGroup.getActivePrimaryMouseButtonTool();

      if (activeToolName) {
        const activeToolOptions = toolGroup.getToolConfiguration(activeToolName);
        activeToolOptions?.disableOnPassive
          ? toolGroup.setToolDisabled(activeToolName)
          : toolGroup.setToolPassive(activeToolName);
      }

      // Set the new toolName to be active
      toolGroup.setToolActive(toolName, {
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Primary,
          },
        ],
      });
    },
    activateViewerMeasurementTool: ({ toolName = 'Length', stopCine = false } = {}) => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const toolGroupReference = toolGroupService.getToolGroupForViewport(activeViewportId);
      const toolGroup =
        typeof toolGroupReference === 'string'
          ? toolGroupService.getToolGroup(toolGroupReference)
          : toolGroupReference;
      const toolGroupId =
        typeof toolGroupReference === 'string' ? toolGroupReference : toolGroupReference?.id || '';

      if (!toolGroup) {
        return {
          ok: false,
          reason: 'tool-group-not-found',
          activeViewportId,
          toolGroupId,
        };
      }

      if (!toolGroup.hasTool?.(toolName)) {
        return {
          ok: false,
          reason: 'tool-not-found',
          toolName,
          toolGroupId,
        };
      }

      actions.setToolActive({
        toolName,
        toolGroupId: toolGroupReference,
      });

      if (stopCine) {
        const cineState = cineService.getState();
        const currentCineState = cineState.cines?.[activeViewportId];

        cineService.setCine({
          id: activeViewportId,
          frameRate: currentCineState?.frameRate ?? cineState.default?.frameRate ?? 24,
          isPlaying: false,
        });
      }

      return {
        ok: true,
        toolName,
        toolGroupId,
        activeViewportId,
        cineStopped: stopCine,
      };
    },
    activateViewerQuizMeasurementTool: ({ toolName = 'Length' } = {}) =>
      actions.activateViewerMeasurementTool({
        toolName,
        stopCine: true,
      }),
    releaseViewerQuizDrawingTool: () => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const toolGroupReference = toolGroupService.getToolGroupForViewport(activeViewportId);

      const toolGroupId =
        typeof toolGroupReference === 'string' ? toolGroupReference : toolGroupReference?.id || '';

      const toolGroup =
        typeof toolGroupReference === 'string'
          ? toolGroupService.getToolGroup(toolGroupReference)
          : toolGroupReference;

      if (!toolGroup) {
        return {
          ok: false,
          reason: 'tool-group-not-found',
          activeViewportId,
          toolGroupId,
        };
      }

      const activeToolName = toolGroup.getActivePrimaryMouseButtonTool?.() || '';

      if (!activeToolName) {
        return {
          ok: true,
          released: false,
          reason: 'no-active-primary-tool',
          toolGroupId,
        };
      }

      const quizDrawingToolNames = new Set([
        'Length',
        'Bidirectional',
        'ArrowAnnotate',
        'EllipticalROI',
        'RectangleROI',
        'CircleROI',
        'PlanarFreehandROI',
        'SplineROI',
        'LivewireContour',
        'Angle',
        'CobbAngle',
        'CalibrationLine',
        'LVTrace',
        'LVTraceSlot',
      ]);

      const activeTool = toolGroup.getToolInstance?.(activeToolName);
      const isDrawingTool =
        quizDrawingToolNames.has(activeToolName) || activeTool?.constructor?.isAnnotation === true;

      if (!isDrawingTool) {
        return {
          ok: true,
          released: false,
          activeToolName,
          reason: 'active-tool-is-not-drawing-tool',
          toolGroupId,
        };
      }

      const navigationToolNames = new Set([
        'WindowLevel',
        'StackScroll',
        'Pan',
        'Zoom',
        'TrackballRotate',
      ]);

      const fallbackToolName = [
        toolGroup.getPrevActivePrimaryToolName?.(),
        'WindowLevel',
        'StackScroll',
        'Pan',
        'Zoom',
      ].find(candidate => {
        return (
          !!candidate &&
          candidate !== activeToolName &&
          navigationToolNames.has(candidate) &&
          toolGroup.hasTool?.(candidate)
        );
      });

      const activeToolOptions = toolGroup.getToolConfiguration(activeToolName);

      activeToolOptions?.disableOnPassive
        ? toolGroup.setToolDisabled(activeToolName)
        : toolGroup.setToolPassive(activeToolName);

      if (fallbackToolName) {
        toolGroup.setToolActive(fallbackToolName, {
          bindings: [
            {
              mouseButton: Enums.MouseBindings.Primary,
            },
          ],
        });
      }

      return {
        ok: true,
        released: true,
        releasedToolName: activeToolName,
        fallbackToolName: fallbackToolName || '',
        toolGroupId,
      };
    },
    // capture viewport
    showDownloadViewportModal: () => {
      const { activeViewportId } = viewportGridService.getState();

      if (!cornerstoneViewportService.getCornerstoneViewport(activeViewportId)) {
        // Cannot download a non-cornerstone viewport (image).
        uiNotificationService.show({
          title: 'Download Image',
          message: 'Image cannot be downloaded',
          type: 'error',
        });
        return;
      }

      const { uiModalService } = servicesManager.services;

      if (uiModalService) {
        uiModalService.show({
          content: CornerstoneViewportDownloadForm,
          title: 'Download High Quality Image',
          contentProps: {
            activeViewportId,
            cornerstoneViewportService,
          },
          containerClassName: 'max-w-4xl p-4',
        });
      }
    },
    /**
     * Rotates the viewport by `rotation` relative to its current rotation.
     */
    rotateViewportBy: ({ rotation, viewportId }: { rotation: number; viewportId?: string }) => {
      actions._rotateViewport({ rotation, viewportId, rotationMode: 'apply' });
    },
    /**
     * Sets the viewport rotation to an absolute value `rotation`.
     */
    setViewportRotation: ({ rotation, viewportId }: { rotation: number; viewportId?: string }) => {
      actions._rotateViewport({ rotation, viewportId, rotationMode: 'set' });
    },
    flipViewportHorizontal: ({
      viewportId,
      newValue = 'toggle',
    }: {
      viewportId?: string;
      newValue?: 'toggle' | boolean;
    }) => {
      const enabledElement = viewportId
        ? _getViewportEnabledElement(viewportId)
        : _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      let flipHorizontal: boolean;
      if (newValue === 'toggle') {
        const { flipHorizontal: currentHorizontalFlip } = viewport.getCamera();
        flipHorizontal = !currentHorizontalFlip;
      } else {
        flipHorizontal = newValue;
      }

      viewport.setCamera({ flipHorizontal });
      viewport.render();
    },
    flipViewportVertical: ({
      viewportId,
      newValue = 'toggle',
    }: {
      viewportId?: string;
      newValue?: 'toggle' | boolean;
    }) => {
      const enabledElement = viewportId
        ? _getViewportEnabledElement(viewportId)
        : _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      let flipVertical: boolean;
      if (newValue === 'toggle') {
        const { flipVertical: currentVerticalFlip } = viewport.getCamera();
        flipVertical = !currentVerticalFlip;
      } else {
        flipVertical = newValue;
      }
      viewport.setCamera({ flipVertical });
      viewport.render();
    },
    invertViewport: ({ element }) => {
      let enabledElement;

      if (element === undefined) {
        enabledElement = _getActiveViewportEnabledElement();
      } else {
        enabledElement = element;
      }

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      const { invert } = viewport.getProperties();
      viewport.setProperties({ invert: !invert });
      viewport.render();
    },
    resetViewport: () => {
      const enabledElement = _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      viewport.resetProperties?.();
      viewport.resetCamera();

      viewport.render();
    },
    scaleViewport: ({ direction }) => {
      const enabledElement = _getActiveViewportEnabledElement();
      const scaleFactor = direction > 0 ? 0.9 : 1.1;

      if (!enabledElement) {
        return;
      }
      const { viewport } = enabledElement;

      if (viewport instanceof StackViewport) {
        if (direction) {
          const { parallelScale } = viewport.getCamera();
          viewport.setCamera({ parallelScale: parallelScale * scaleFactor });
          viewport.render();
        } else {
          viewport.resetCamera();
          viewport.render();
        }
      }
    },

    /** Jumps the active viewport or the specified one to the given slice index */
    jumpToImage: ({ imageIndex, viewport: gridViewport }): void => {
      // Get current active viewport (return if none active)
      let viewport;
      if (!gridViewport) {
        const enabledElement = _getActiveViewportEnabledElement();
        if (!enabledElement) {
          return;
        }
        viewport = enabledElement.viewport;
      } else {
        viewport = cornerstoneViewportService.getCornerstoneViewport(gridViewport.id);
      }

      // Get number of slices
      // -> Copied from cornerstone3D jumpToSlice\_getImageSliceData()
      let numberOfSlices = 0;

      if (viewport instanceof StackViewport) {
        numberOfSlices = viewport.getImageIds().length;
      } else if (viewport instanceof VolumeViewport) {
        numberOfSlices = csUtils.getImageSliceDataForVolumeViewport(viewport).numberOfSlices;
      } else {
        throw new Error('Unsupported viewport type');
      }

      const jumpIndex = imageIndex < 0 ? numberOfSlices + imageIndex : imageIndex;
      if (jumpIndex >= numberOfSlices || jumpIndex < 0) {
        throw new Error(`Can't jump to ${imageIndex}`);
      }

      // Set slice to last slice
      const options = { imageIndex: jumpIndex };
      csUtils.jumpToSlice(viewport.element, options);
    },
    scroll: (options: ToolTypes.ScrollOptions) => {
      const enabledElement = _getActiveViewportEnabledElement();
      // Allow either or direction for consistency in scroll implementation
      options.delta ??= options.direction || 1;
      options.direction ??= options.delta;

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      csUtils.scroll(viewport, options);
    },
    setViewportColormap: ({
      viewportId,
      displaySetInstanceUID,
      colormap,
      opacity = 1,
      immediate = false,
    }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      let hpOpacity;
      // Retrieve active protocol's viewport match details
      const { viewportMatchDetails } = hangingProtocolService.getActiveProtocol();
      // Get display set options for the specified viewport ID
      const displaySetsInfo = viewportMatchDetails.get(viewportId)?.displaySetsInfo;

      if (displaySetsInfo) {
        // Find the display set that matches the given UID
        const matchingDisplaySet = displaySetsInfo.find(
          displaySet => displaySet.displaySetInstanceUID === displaySetInstanceUID
        );
        // If a matching display set is found, update the opacity with its value
        hpOpacity = matchingDisplaySet?.displaySetOptions?.options?.colormap?.opacity;
      }

      // HP takes priority over the default opacity
      colormap = { ...colormap, opacity: hpOpacity || opacity };

      if (viewport instanceof StackViewport) {
        viewport.setProperties({ colormap });
      }

      if (viewport instanceof VolumeViewport) {
        if (!displaySetInstanceUID) {
          const { viewports } = viewportGridService.getState();
          displaySetInstanceUID = viewports.get(viewportId)?.displaySetInstanceUIDs[0];
        }

        // ToDo: Find a better way of obtaining the volumeId that corresponds to the displaySetInstanceUID
        const volumeId =
          viewport
            .getAllVolumeIds()
            .find((_volumeId: string) => _volumeId.includes(displaySetInstanceUID)) ??
          viewport.getVolumeId();
        viewport.setProperties({ colormap }, volumeId);
      }

      if (immediate) {
        viewport.render();
      }
    },
    changeActiveViewport: ({ direction = 1 }) => {
      const { activeViewportId, viewports } = viewportGridService.getState();
      const viewportIds = Array.from(viewports.keys());
      const currentIndex = viewportIds.indexOf(activeViewportId);
      const nextViewportIndex =
        (currentIndex + direction + viewportIds.length) % viewportIds.length;
      viewportGridService.setActiveViewportId(viewportIds[nextViewportIndex] as string);
    },
    /**
     * If the syncId is given and a synchronizer with that ID already exists, it will
     * toggle it on/off for the provided viewports. If not, it will attempt to create
     * a new synchronizer using the given syncId and type for the specified viewports.
     * If no viewports are provided, you may notice some default behavior.
     * - 'voi' type, we will aim to synchronize all viewports with the same modality
     * -'imageSlice' type, we will aim to synchronize all viewports with the same orientation.
     *
     * @param options
     * @param options.viewports - The viewports to synchronize
     * @param options.syncId - The synchronization group ID
     * @param options.type - The type of synchronization to perform
     */
    toggleSynchronizer: ({ type, viewports, syncId }) => {
      const synchronizer = syncGroupService.getSynchronizer(syncId);

      if (synchronizer) {
        synchronizer.isDisabled() ? synchronizer.setEnabled(true) : synchronizer.setEnabled(false);
        return;
      }

      const fn = toggleSyncFunctions[type];

      if (fn) {
        fn({
          servicesManager,
          viewports,
          syncId,
        });
      }
    },
    setViewportForToolConfiguration: ({ viewportId, toolName }) => {
      if (!viewportId) {
        const { activeViewportId } = viewportGridService.getState();
        viewportId = activeViewportId ?? 'default';
      }

      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);

      if (!toolGroup?.hasTool(toolName)) {
        return;
      }

      const prevConfig = toolGroup?.getToolConfiguration(toolName);
      toolGroup?.setToolConfiguration(
        toolName,
        {
          ...prevConfig,
          sourceViewportId: viewportId,
        },
        true // overwrite
      );

      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      renderingEngine.render();
    },
    storePresentation: ({ viewportId }) => {
      cornerstoneViewportService.storePresentation({ viewportId });
    },
    updateVolumeData: ({ volume }) => {
      // update vtkOpenGLTexture and imageData of computed volume
      const { imageData, vtkOpenGLTexture } = volume;
      const numSlices = imageData.getDimensions()[2];
      const slicesToUpdate = [...Array(numSlices).keys()];
      slicesToUpdate.forEach(i => {
        vtkOpenGLTexture.setUpdatedFrame(i);
      });
      imageData.modified();
    },

    attachProtocolViewportDataListener: ({ protocol, stageIndex }) => {
      const EVENT = cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED;
      const command = protocol.callbacks.onViewportDataInitialized;
      const numPanes = protocol.stages?.[stageIndex]?.viewports.length ?? 1;
      let numPanesWithData = 0;
      const { unsubscribe } = cornerstoneViewportService.subscribe(EVENT, evt => {
        numPanesWithData++;

        if (numPanesWithData === numPanes) {
          commandsManager.run(...command);

          // Unsubscribe from the event
          unsubscribe(EVENT);
        }
      });
    },

    setViewportPreset: ({ viewportId, preset }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport) {
        return;
      }
      viewport.setProperties({
        preset,
      });
      viewport.render();
    },

    /**
     * Sets the volume quality for a given viewport.
     * @param {string} viewportId - The ID of the viewport to set the volume quality.
     * @param {number} volumeQuality - The desired quality level of the volume rendering.
     */

    setVolumeRenderingQulaity: ({ viewportId, volumeQuality }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const mapper = actor.getMapper();
      const image = mapper.getInputData();
      const dims = image.getDimensions();
      const spacing = image.getSpacing();
      const spatialDiagonal = vec3.length(
        vec3.fromValues(dims[0] * spacing[0], dims[1] * spacing[1], dims[2] * spacing[2])
      );

      let sampleDistance = spacing.reduce((a, b) => a + b) / 3.0;
      sampleDistance /= volumeQuality > 1 ? 0.5 * volumeQuality ** 2 : 1.0;
      const samplesPerRay = spatialDiagonal / sampleDistance + 1;
      mapper.setMaximumSamplesPerRay(samplesPerRay);
      mapper.setSampleDistance(sampleDistance);
      viewport.render();
    },

    /**
     * Shifts opacity points for a given viewport id.
     * @param {string} viewportId - The ID of the viewport to set the mapping range.
     * @param {number} shift - The shift value to shift the points by.
     */
    shiftVolumeOpacityPoints: ({ viewportId, shift }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const ofun = actor.getProperty().getScalarOpacity(0);

      const opacityPointValues = []; // Array to hold values
      // Gather Existing Values
      const size = ofun.getSize();
      for (let pointIdx = 0; pointIdx < size; pointIdx++) {
        const opacityPointValue = [0, 0, 0, 0];
        ofun.getNodeValue(pointIdx, opacityPointValue);
        // opacityPointValue now holds [xLocation, opacity, midpoint, sharpness]
        opacityPointValues.push(opacityPointValue);
      }
      // Add offset
      opacityPointValues.forEach(opacityPointValue => {
        opacityPointValue[0] += shift; // Change the location value
      });
      // Set new values
      ofun.removeAllPoints();
      opacityPointValues.forEach(opacityPointValue => {
        ofun.addPoint(...opacityPointValue);
      });
      viewport.render();
    },

    /**
     * Sets the volume lighting settings for a given viewport.
     * @param {string} viewportId - The ID of the viewport to set the lighting settings.
     * @param {Object} options - The lighting settings to be set.
     * @param {boolean} options.shade - The shade setting for the lighting.
     * @param {number} options.ambient - The ambient setting for the lighting.
     * @param {number} options.diffuse - The diffuse setting for the lighting.
     * @param {number} options.specular - The specular setting for the lighting.
     **/

    setVolumeLighting: ({ viewportId, options }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { actor } = viewport.getActors()[0];
      const property = actor.getProperty();

      if (options.shade !== undefined) {
        property.setShade(options.shade);
      }

      if (options.ambient !== undefined) {
        property.setAmbient(options.ambient);
      }

      if (options.diffuse !== undefined) {
        property.setDiffuse(options.diffuse);
      }

      if (options.specular !== undefined) {
        property.setSpecular(options.specular);
      }

      viewport.render();
    },
    resetCrosshairs: ({ viewportId }) => {
      const crosshairInstances = [];

      const getCrosshairInstances = toolGroupId => {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        crosshairInstances.push(toolGroup.getToolInstance('Crosshairs'));
      };

      if (!viewportId) {
        const toolGroupIds = toolGroupService.getToolGroupIds();
        toolGroupIds.forEach(getCrosshairInstances);
      } else {
        const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
        getCrosshairInstances(toolGroup.id);
      }

      crosshairInstances.forEach(ins => {
        ins?.computeToolCenter();
      });
    },
    /**
     * Creates a labelmap for the active viewport
     *
     * The created labelmap will be registered as a display set and also added
     * as a segmentation representation to the viewport.
     */
    createLabelmapForViewport: async ({ viewportId, options = {} }) => {
      const { viewportGridService, displaySetService, segmentationService } =
        servicesManager.services;
      const { viewports } = viewportGridService.getState();
      const targetViewportId = viewportId;

      const viewport = viewports.get(targetViewportId);

      // Todo: add support for multiple display sets
      const displaySetInstanceUID =
        options.displaySetInstanceUID || viewport.displaySetInstanceUIDs[0];

      const segs = segmentationService.getSegmentations();

      const label = options.label || `Segmentation ${segs.length + 1}`;
      const segmentationId = options.segmentationId || `${csUtils.uuidv4()}`;

      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      // This will create the segmentation and register it as a display set
      const generatedSegmentationId = await segmentationService.createLabelmapForDisplaySet(
        displaySet,
        {
          label,
          segmentationId,
          segments: options.createInitialSegment
            ? {
                1: {
                  label: `${i18n.t('Segment')} 1`,
                  active: true,
                },
              }
            : {},
        }
      );

      // Also add the segmentation representation to the viewport
      await segmentationService.addSegmentationRepresentation(viewportId, {
        segmentationId,
        type: Enums.SegmentationRepresentations.Labelmap,
      });

      return generatedSegmentationId;
    },

    /**
     * Sets the active segmentation for a viewport
     * @param props.segmentationId - The ID of the segmentation to set as active
     */
    setActiveSegmentation: ({ segmentationId }) => {
      const { viewportGridService, segmentationService } = servicesManager.services;
      segmentationService.setActiveSegmentation(
        viewportGridService.getActiveViewportId(),
        segmentationId
      );
    },

    /**
     * Adds a new segment to a segmentation
     * @param props.segmentationId - The ID of the segmentation to add the segment to
     */
    addSegmentCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.addSegment(segmentationId);
    },

    /**
     * Sets the active segment and jumps to its center
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment to activate
     */
    setActiveSegmentAndCenterCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      // set both active segmentation and active segment
      segmentationService.setActiveSegmentation(
        viewportGridService.getActiveViewportId(),
        segmentationId
      );
      segmentationService.setActiveSegment(segmentationId, segmentIndex);
      segmentationService.jumpToSegmentCenter(segmentationId, segmentIndex);
    },

    /**
     * Toggles the visibility of a segment
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment
     * @param props.type - The type of visibility to toggle
     */
    toggleSegmentVisibilityCommand: ({ segmentationId, segmentIndex, type }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.toggleSegmentVisibility(
        viewportGridService.getActiveViewportId(),
        segmentationId,
        segmentIndex,
        type
      );
    },

    /**
     * Toggles the lock state of a segment
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment
     */
    toggleSegmentLockCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.toggleSegmentLocked(segmentationId, segmentIndex);
    },

    /**
     * Toggles the visibility of a segmentation representation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.type - The type of representation
     */
    toggleSegmentationVisibilityCommand: ({ segmentationId, type }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.toggleSegmentationRepresentationVisibility(
        viewportGridService.getActiveViewportId(),
        { segmentationId, type }
      );
    },

    /**
     * Downloads a segmentation
     * @param props.segmentationId - The ID of the segmentation to download
     */
    downloadSegmentationCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.downloadSegmentation(segmentationId);
    },

    /**
     * Stores a segmentation and shows it in the viewport
     * @param props.segmentationId - The ID of the segmentation to store
     */
    storeSegmentationCommand: async ({ segmentationId }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;

      const displaySetInstanceUIDs = await createReportAsync({
        servicesManager,
        getReport: () =>
          commandsManager.runCommand('storeSegmentation', {
            segmentationId,
          }),
        reportType: 'Segmentation',
      });

      if (displaySetInstanceUIDs) {
        segmentationService.remove(segmentationId);
        viewportGridService.setDisplaySetsForViewport({
          viewportId: viewportGridService.getActiveViewportId(),
          displaySetInstanceUIDs,
        });
      }
    },

    /**
     * Downloads a segmentation as RTSS
     * @param props.segmentationId - The ID of the segmentation
     */
    downloadRTSSCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.downloadRTSS(segmentationId);
    },

    /**
     * Sets the style for a segmentation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.type - The type of style
     * @param props.key - The style key to set
     * @param props.value - The style value
     */
    setSegmentationStyleCommand: ({ type, key, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { [key]: value });
    },

    /**
     * Deletes a segment from a segmentation
     * @param props.segmentationId - The ID of the segmentation
     * @param props.segmentIndex - The index of the segment to delete
     */
    deleteSegmentCommand: ({ segmentationId, segmentIndex }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.removeSegment(segmentationId, segmentIndex);
    },

    /**
     * Deletes an entire segmentation
     * @param props.segmentationId - The ID of the segmentation to delete
     */
    deleteSegmentationCommand: ({ segmentationId }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.remove(segmentationId);
    },

    /**
     * Removes a segmentation from the viewport
     * @param props.segmentationId - The ID of the segmentation to remove
     */
    removeSegmentationFromViewportCommand: ({ segmentationId }) => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      segmentationService.removeSegmentationRepresentations(
        viewportGridService.getActiveViewportId(),
        { segmentationId }
      );
    },

    /**
     * Toggles rendering of inactive segmentations
     */
    toggleRenderInactiveSegmentationsCommand: () => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();
      const renderInactive = segmentationService.getRenderInactiveSegmentations(viewportId);
      segmentationService.setRenderInactiveSegmentations(viewportId, !renderInactive);
    },

    /**
     * Sets the fill alpha value for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - The alpha value to set
     */
    setFillAlphaCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { fillAlpha: value });
    },

    /**
     * Sets the outline width for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - The width value to set
     */
    setOutlineWidthCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { outlineWidth: value });
    },

    /**
     * Sets whether to render fill for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - Whether to render fill
     */
    setRenderFillCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { renderFill: value });
    },

    /**
     * Sets whether to render outline for a segmentation type
     * @param props.type - The type of segmentation
     * @param props.value - Whether to render outline
     */
    setRenderOutlineCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { renderOutline: value });
    },

    /**
     * Sets the fill alpha for inactive segmentations
     * @param props.type - The type of segmentation
     * @param props.value - The alpha value to set
     */
    setFillAlphaInactiveCommand: ({ type, value }) => {
      const { segmentationService } = servicesManager.services;
      segmentationService.setStyle({ type }, { fillAlphaInactive: value });
    },

    editSegmentLabel: async ({ segmentationId, segmentIndex }) => {
      const { segmentationService, uiDialogService } = servicesManager.services;
      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation) {
        return;
      }

      const segment = segmentation.segments[segmentIndex];

      callInputDialog({
        uiDialogService,
        title: 'Edit Segment Label',
        placeholder: 'Enter new label',
        defaultValue: segment.label,
      }).then(label => {
        segmentationService.setSegmentLabel(segmentationId, segmentIndex, label);
      });
    },

    editSegmentationLabel: ({ segmentationId }) => {
      const { segmentationService, uiDialogService } = servicesManager.services;
      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation) {
        return;
      }

      const { label } = segmentation;

      callInputDialog({
        uiDialogService,
        title: 'Edit Segmentation Label',
        placeholder: 'Enter new label',
        defaultValue: label,
      }).then(label => {
        segmentationService.addOrUpdateSegmentation({ segmentationId, label });
      });
    },

    editSegmentColor: ({ segmentationId, segmentIndex }) => {
      const { segmentationService, uiDialogService, viewportGridService } =
        servicesManager.services;
      const viewportId = viewportGridService.getActiveViewportId();
      const color = segmentationService.getSegmentColor(viewportId, segmentationId, segmentIndex);

      const rgbaColor = {
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3] / 255.0,
      };

      uiDialogService.show({
        content: colorPickerDialog,
        title: 'Segment Color',
        contentProps: {
          value: rgbaColor,
          onSave: newRgbaColor => {
            const color = [newRgbaColor.r, newRgbaColor.g, newRgbaColor.b, newRgbaColor.a * 255.0];
            segmentationService.setSegmentColor(viewportId, segmentationId, segmentIndex, color);
          },
        },
      });
    },

    getRenderInactiveSegmentations: () => {
      const { segmentationService, viewportGridService } = servicesManager.services;
      return segmentationService.getRenderInactiveSegmentations(
        viewportGridService.getActiveViewportId()
      );
    },

    deleteActiveAnnotation: () => {
      const activeAnnotationsUID = cornerstoneTools.annotation.selection.getAnnotationsSelected();
      activeAnnotationsUID.forEach(activeAnnotationUID => {
        measurementService.remove(activeAnnotationUID);
      });
    },
    setDisplaySetsForViewports: ({ viewportsToUpdate }) => {
      const { cineService, viewportGridService } = servicesManager.services;
      // Stopping the cine of modified viewports before changing the viewports to
      // avoid inconsistent state and lost references
      viewportsToUpdate.forEach(viewport => {
        if (viewport.skipCineStop) {
          return;
        }

        const state = cineService.getState();
        const currentCineState = state.cines?.[viewport.viewportId];
        cineService.setCine({
          id: viewport.viewportId,
          frameRate: currentCineState?.frameRate ?? state.default?.frameRate ?? 24,
          isPlaying: false,
        });
      });

      viewportGridService.setDisplaySetsForViewports(
        viewportsToUpdate.map(({ skipCineStop, ...viewport }) => viewport)
      );
    },
    undo: () => {
      DefaultHistoryMemo.undo();
    },
    redo: () => {
      DefaultHistoryMemo.redo();
    },
    toggleSegmentPreviewEdit: ({ toggle }) => {
      let labelmapTools = getLabelmapTools({ toolGroupService });
      labelmapTools = labelmapTools.filter(tool => !tool.toolName.includes('Eraser'));
      labelmapTools.forEach(tool => {
        tool.configuration = {
          ...tool.configuration,
          preview: {
            ...tool.configuration.preview,
            enabled: toggle,
          },
        };
      });
    },
    toggleSegmentSelect: ({ toggle }) => {
      const toolGroupIds = toolGroupService.getToolGroupIds();
      toolGroupIds.forEach(toolGroupId => {
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
        if (toggle) {
          toolGroup.setToolActive(cornerstoneTools.SegmentSelectTool.toolName);
        } else {
          toolGroup.setToolDisabled(cornerstoneTools.SegmentSelectTool.toolName);
        }
      });
    },
    toggleSegmentLabel: () => {
      const toolName = cornerstoneTools.SegmentLabelTool.toolName;
      const toolGroupIds = toolGroupService.getToolGroupIds();

      const isOn = toolGroupIds.some(toolGroupId => {
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
        const mode = toolGroup.getToolInstance(toolName)?.mode;
        return mode === 'Active';
      });

      toolGroupIds.forEach(toolGroupId => {
        const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
        if (isOn) {
          toolGroup.setToolDisabled(toolName);
        } else {
          toolGroup.setToolActive(toolName);
        }
      });
    },
    /**
     * Used to sync the apps initial state with the config file settings.
     *
     * Will mutate the tools object of the given tool group and add the segmentLabelTool to the proper place.
     *
     * Use it before initializing the toolGroup with the tools.
     */
    initializeSegmentLabelTool: ({ tools }) => {
      const appConfig = extensionManager.appConfig;
      const segmentLabelConfig = appConfig.segmentation?.segmentLabel;

      if (segmentLabelConfig?.enabledByDefault) {
        const activeTools = tools?.active ?? [];
        activeTools.push({
          toolName: toolNames.SegmentLabel,
          configuration: {
            hoverTimeout: segmentLabelConfig?.hoverTimeout ?? 1,
            color: segmentLabelConfig?.labelColor,
            background: segmentLabelConfig?.background,
          },
        });

        tools.active = activeTools;
        return tools;
      }

      const disabledTools = tools?.disabled ?? [];
      disabledTools.push({
        toolName: toolNames.SegmentLabel,
        configuration: {
          hoverTimeout: segmentLabelConfig?.hoverTimeout ?? 1,
          color: segmentLabelConfig?.labelColor,
        },
      });
      tools.disabled = disabledTools;
      return tools;
    },
    toggleUseCenterSegmentIndex: ({ toggle }) => {
      let labelmapTools = getLabelmapTools({ toolGroupService });
      labelmapTools = labelmapTools.filter(tool => !tool.toolName.includes('Eraser'));
      labelmapTools.forEach(tool => {
        tool.configuration = {
          ...tool.configuration,
          useCenterSegmentIndex: toggle,
        };
      });
    },
    _handlePreviewAction: action => {
      const { viewport } = _getActiveViewportEnabledElement();
      const previewTools = getPreviewTools({ toolGroupService });

      previewTools.forEach(tool => {
        try {
          tool[`${action}Preview`]();
        } catch (error) {
          console.debug('Error accepting preview for tool', tool.toolName);
        }
      });

      if (segmentAI.enabled) {
        segmentAI[`${action}Preview`](viewport.element);
      }
    },
    acceptPreview: () => {
      actions._handlePreviewAction('accept');
    },
    rejectPreview: () => {
      actions._handlePreviewAction('reject');
    },
    clearMarkersForMarkerLabelmap: () => {
      const { viewport } = _getActiveViewportEnabledElement();
      const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroupForViewport(viewport.id);
      const toolInstance = toolGroup.getToolInstance('MarkerLabelmap');

      if (!toolInstance) {
        return;
      }

      toolInstance.clearMarkers(viewport);
    },
    interpolateScrollForMarkerLabelmap: () => {
      const { viewport } = _getActiveViewportEnabledElement();
      const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroupForViewport(viewport.id);
      const toolInstance = toolGroup.getToolInstance('MarkerLabelmap');

      if (!toolInstance) {
        return;
      }

      toolInstance.interpolateScroll(viewport, 1);
    },
    toggleLabelmapAssist: async () => {
      const { viewport } = _getActiveViewportEnabledElement();
      const newState = !segmentAI.enabled;
      segmentAI.enabled = newState;

      if (!segmentAIEnabled) {
        await segmentAI.initModel();
        segmentAIEnabled = true;
      }

      // set the brush tool to active
      const toolGroupIds = toolGroupService.getToolGroupIds();
      if (newState) {
        actions.setToolActiveToolbar({
          toolName: 'CircularBrushForAutoSegmentAI',
          toolGroupIds: toolGroupIds,
        });
      } else {
        toolGroupIds.forEach(toolGroupId => {
          const toolGroup = cornerstoneTools.ToolGroupManager.getToolGroup(toolGroupId);
          toolGroup.setToolPassive('CircularBrushForAutoSegmentAI');
        });
      }

      if (segmentAI.enabled) {
        segmentAI.initViewport(viewport);
      }
    },
    setBrushSize: ({ value, toolNames }) => {
      const brushSize = Number(value);

      toolGroupService.getToolGroupIds()?.forEach(toolGroupId => {
        if (toolNames?.length === 0) {
          segmentationUtils.setBrushSizeForToolGroup(toolGroupId, brushSize);
        } else {
          toolNames?.forEach(toolName => {
            segmentationUtils.setBrushSizeForToolGroup(toolGroupId, brushSize, toolName);
          });
        }
      });
    },
    setThresholdRange: ({
      value,
      toolNames = [
        'ThresholdCircularBrush',
        'ThresholdSphereBrush',
        'ThresholdCircularBrushDynamic',
        'ThresholdSphereBrushDynamic',
      ],
    }) => {
      const toolGroupIds = toolGroupService.getToolGroupIds();
      if (!toolGroupIds?.length) {
        return;
      }

      for (const toolGroupId of toolGroupIds) {
        const toolGroup = toolGroupService.getToolGroup(toolGroupId);
        toolNames?.forEach(toolName => {
          toolGroup.setToolConfiguration(toolName, {
            threshold: {
              range: value,
            },
          });
        });
      }
    },
    increaseBrushSize: () => {
      const toolGroupIds = toolGroupService.getToolGroupIds();
      if (!toolGroupIds?.length) {
        return;
      }

      for (const toolGroupId of toolGroupIds) {
        const brushSize = segmentationUtils.getBrushSizeForToolGroup(toolGroupId);
        segmentationUtils.setBrushSizeForToolGroup(toolGroupId, brushSize + 3);
      }
    },
    decreaseBrushSize: () => {
      const toolGroupIds = toolGroupService.getToolGroupIds();
      if (!toolGroupIds?.length) {
        return;
      }

      for (const toolGroupId of toolGroupIds) {
        const brushSize = segmentationUtils.getBrushSizeForToolGroup(toolGroupId);
        segmentationUtils.setBrushSizeForToolGroup(toolGroupId, brushSize - 3);
      }
    },
    addNewSegment: () => {
      const { segmentationService } = servicesManager.services;
      const { activeViewportId } = viewportGridService.getState();
      const activeSegmentation = segmentationService.getActiveSegmentation(activeViewportId);
      if (!activeSegmentation) {
        return;
      }
      segmentationService.addSegment(activeSegmentation.segmentationId);
    },
    loadSegmentationDisplaySetsForViewport: ({ viewportId, displaySetInstanceUIDs }) => {
      const updatedViewports = getUpdatedViewportsForSegmentation({
        viewportId,
        servicesManager,
        displaySetInstanceUIDs,
      });

      actions.setDisplaySetsForViewports({
        viewportsToUpdate: updatedViewports.map(viewport => ({
          viewportId: viewport.viewportId,
          displaySetInstanceUIDs: viewport.displaySetInstanceUIDs,
        })),
      });
    },
    setViewportOrientation: ({ viewportId, orientation }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      if (!viewport || viewport.type !== CoreEnums.ViewportType.ORTHOGRAPHIC) {
        console.warn('Orientation can only be set on volume viewports');
        return;
      }

      // Get display sets for this viewport to verify at least one is reconstructable
      const displaySetUIDs = viewportGridService.getDisplaySetsUIDsForViewport(viewportId);
      const displaySets = displaySetUIDs.map(uid => displaySetService.getDisplaySetByUID(uid));

      if (!displaySets.some(ds => ds.isReconstructable)) {
        console.warn('Cannot change orientation: No reconstructable display sets in viewport');
        return;
      }

      viewport.setOrientation(orientation);
      viewport.render();

      // update the orientation in the viewport info
      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
      viewportInfo.setOrientation(orientation);
    },
    /**
     * Toggles the horizontal flip state of the viewport.
     */
    toggleViewportHorizontalFlip: ({ viewportId }: { viewportId?: string } = {}) => {
      actions.flipViewportHorizontal({ viewportId, newValue: 'toggle' });
    },

    /**
     * Explicitly sets the horizontal flip state of the viewport.
     */
    setViewportHorizontalFlip: ({
      flipped,
      viewportId,
    }: {
      flipped: boolean;
      viewportId?: string;
    }) => {
      actions.flipViewportHorizontal({ viewportId, newValue: flipped });
    },

    /**
     * Toggles the vertical flip state of the viewport.
     */
    toggleViewportVerticalFlip: ({ viewportId }: { viewportId?: string } = {}) => {
      actions.flipViewportVertical({ viewportId, newValue: 'toggle' });
    },

    /**
     * Explicitly sets the vertical flip state of the viewport.
     */
    setViewportVerticalFlip: ({
      flipped,
      viewportId,
    }: {
      flipped: boolean;
      viewportId?: string;
    }) => {
      actions.flipViewportVertical({ viewportId, newValue: flipped });
    },
    /**
     * Internal helper to rotate or set absolute rotation for a viewport.
     */
    _rotateViewport: ({
      rotation,
      viewportId,
      rotationMode = 'apply',
    }: {
      rotation: number;
      viewportId?: string;
      rotationMode?: 'apply' | 'set';
    }) => {
      const enabledElement = viewportId
        ? _getViewportEnabledElement(viewportId)
        : _getActiveViewportEnabledElement();

      if (!enabledElement) {
        return;
      }

      const { viewport } = enabledElement;

      if (viewport instanceof BaseVolumeViewport) {
        const camera = viewport.getCamera();
        const rotAngle = (rotation * Math.PI) / 180;
        const rotMat = mat4.identity(new Float32Array(16));
        mat4.rotate(rotMat, rotMat, rotAngle, camera.viewPlaneNormal);
        const rotatedViewUp = vec3.transformMat4(vec3.create(), camera.viewUp, rotMat);
        viewport.setCamera({ viewUp: rotatedViewUp as CoreTypes.Point3 });
        viewport.render();
        return;
      }

      if (viewport.getRotation !== undefined) {
        const { rotation: currentRotation } = viewport.getViewPresentation();
        const newRotation =
          rotationMode === 'apply'
            ? (currentRotation + rotation + 360) % 360
            : (() => {
                // In 'set' mode, account for the effect horizontal/vertical flips
                // have on the perceived rotation direction. A single flip mirrors
                // the image and inverses rotation direction, while two flips
                // restore the original parity. We therefore invert the rotation
                // angle when an odd number of flips are applied so that the
                // requested absolute rotation matches the user expectation.
                const { flipHorizontal = false, flipVertical = false } =
                  viewport.getViewPresentation();

                const flipsParity = (flipHorizontal ? 1 : 0) + (flipVertical ? 1 : 0);
                const effectiveRotation = flipsParity % 2 === 1 ? -rotation : rotation;

                return (effectiveRotation + 360) % 360;
              })();
        viewport.setViewPresentation({ rotation: newRotation });
        viewport.render();
      }
    },
    startRecordingForAnnotationGroup: () => {
      cornerstoneTools.AnnotationTool.startGroupRecording();
    },
    endRecordingForAnnotationGroup: () => {
      cornerstoneTools.AnnotationTool.endGroupRecording();
    },
    triggerCreateAnnotationMemo: ({
      annotation,
      FrameOfReferenceUID,
      options,
    }: {
      annotation: ToolTypes.Annotation;
      FrameOfReferenceUID: string;
      options: { newAnnotation?: boolean; deleting?: boolean };
    }): void => {
      const { newAnnotation, deleting } = options;
      const renderingEngines = getRenderingEngines();
      const viewports = renderingEngines.flatMap(re => re.getViewports());
      const validViewport = viewports.find(
        vp => vp.getFrameOfReferenceUID() === FrameOfReferenceUID
      );

      if (!validViewport) {
        return;
      }

      cornerstoneTools.AnnotationTool.createAnnotationMemo(validViewport.element, annotation, {
        newAnnotation,
        deleting,
      });
    },
    getSerializedViewerMeasurements: ({
      domain: explicitDomain = '',
      workflow = VIEWER_MEASUREMENTS_WORKFLOW,
      measurementIds = null,
    } = {}) => {
      const domain = String(explicitDomain || '').trim() || inferDomainWithoutSeriesDoc('');
      const restrictMeasurementIds = Array.isArray(measurementIds);
      const requestedMeasurementIds = new Set(
        (restrictMeasurementIds ? measurementIds : [])
          .map(value => String(value || '').trim())
          .filter(Boolean)
      );
      const measurements = getCurrentViewerMeasurementSnapshot(measurementService);

      const annotations = measurements
        .filter(measurement => {
          const measurementId = String(measurement?.uid || '').trim();
          return (
            measurement?.toolName &&
            isPersistableViewerMeasurement(measurement) &&
            (!restrictMeasurementIds || requestedMeasurementIds.has(measurementId))
          );
        })
        .map(measurement =>
          serializeViewerMeasurement(measurement, domain, null, {
            workflow,
            displaySetService,
          })
        )
        .filter(annotation => annotation.referencedImageId || annotation.points?.length);

      return { domain, workflow, annotations };
    },
    getViewerMeasurementDomainForActiveStudy: async ({ domain: explicitDomain } = {}) => {
      try {
        const seriesDoc = await resolveViewerReadSeriesDoc(servicesManager, {
          allowBaseFallback: false,
        });

        if (seriesDoc) {
          return inferDomainFromSeriesDoc(seriesDoc, explicitDomain);
        }
      } catch (error) {
        console.warn('[MeasurementAnnotations] domain lookup using path fallback:', error);
      }

      return inferDomainWithoutSeriesDoc(explicitDomain);
    },
    getViewerMeasurementAnnotationsForActiveStudy: async ({
      domain: explicitDomain,
      workflows = ['viewerMeasurements'],
      includeRepeated = false,
    } = {}) => {
      const saveTarget = getArViewerSaveTargetFromUrl();
      const seriesDoc = await resolveViewerReadSeriesDoc(servicesManager, {
        allowBaseFallback: false,
      });

      if (!seriesDoc) {
        return {
          seriesDoc: null,
          saveTarget,
          domain: inferDomainWithoutSeriesDoc(explicitDomain),
          annotations: [],
        };
      }

      const domain = inferDomainFromSeriesDoc(seriesDoc, explicitDomain);

      const resolvedWorkflows = getMeasurementWorkflowsForRead(saveTarget, workflows);

      const requestedAnnotations = getRequestedWorkflowAnnotations(
        seriesDoc.MeasurementAnnotations,
        resolvedWorkflows
      ).filter(annotation => {
        if (!includeRepeated && isRepeatedViewerMeasurement(annotation)) {
          return false;
        }

        return viewerMeasurementDomainsMatch(annotation?.domain || 'generic', domain);
      });

      const annotations = excludeViewerMeasurementsDeletedInSession(
        decorateReviewWorkflowAnnotations({
          annotations: requestedAnnotations,
          seriesDoc,
          saveTarget,
        })
      );

      return {
        seriesDoc,
        saveTarget,
        domain,
        annotations,
      };
    },
    jumpToSavedViewerAnnotation: async ({
      annotation: savedAnnotation,
      selectAnnotation = true,
      runDelayedDisplayRefresh = true,
    } = {}) => {
      const annotationId = getAnnotationId(savedAnnotation);

      if (!annotationId) {
        console.warn('[MeasurementAnnotations] jumpToSavedViewerAnnotation missing annotation id');

        return {
          ok: false,
          reason: 'missing-annotation-id',
        };
      }

      const activeViewportId = viewportGridService.getActiveViewportId();

      const seriesInstanceId =
        savedAnnotation.SeriesInstanceUID || savedAnnotation.referenceSeriesUID;

      const { activeDisplaySet, displaySet } = await waitForDisplaySetForSavedAnnotation({
        displaySetService,
        viewportGridService,
        annotation: savedAnnotation,
      });

      if (!displaySet) {
        console.warn('[MeasurementAnnotations] no displaySet for saved annotation', {
          annotationId,
          seriesInstanceId,
          SOPInstanceUID: savedAnnotation.SOPInstanceUID,
        });

        return {
          ok: false,
          reason: 'display-set-not-found',
          annotationId,
        };
      }

      console.info('[MeasurementAnnotations] resolved saved annotation displaySet', {
        annotationId,
        savedSOPInstanceUID: savedAnnotation.SOPInstanceUID,
        displaySetInstanceUID: displaySet.displaySetInstanceUID,
        displaySetSOPInstanceUID: displaySet.SOPInstanceUID,
        imageCount:
          displaySet.images?.length || displaySet.instances?.length || displaySet.numImageFrames,
      });

      const activeDisplaySetAlreadyMatches =
        activeDisplaySet?.displaySetInstanceUID === displaySet.displaySetInstanceUID;

      const viewportToUpdate = activeDisplaySetAlreadyMatches
        ? null
        : cornerstoneViewportService.findUpdateableViewportConfiguration(activeViewportId, {
            displaySetInstanceUID: displaySet.displaySetInstanceUID,
            metadata: buildHydrationMetadata(savedAnnotation, displaySet),
            referencedImageId: savedAnnotation.referencedImageId,
          });

      const targetViewportId = viewportToUpdate?.viewportId || activeViewportId;

      if (!activeDisplaySetAlreadyMatches) {
        const viewportsToUpdate = getViewportsToUpdateSafely({
          hangingProtocolService,
          viewportId: targetViewportId,
          displaySetInstanceId: displaySet.displaySetInstanceUID,
          viewportOptions: viewportToUpdate?.viewportOptions,
          context: 'MeasurementAnnotations',
        });

        if (viewportsToUpdate.length) {
          actions.setDisplaySetsForViewports({ viewportsToUpdate });
        }
      }

      const viewport = await waitForCurrentSavedAnnotationViewport({
        cornerstoneViewportService,
        viewportGridService,
        viewportId: targetViewportId,
        annotation: savedAnnotation,
      });

      if (!viewport) {
        console.warn(
          '[MeasurementAnnotations] target saved image not ready after displaySet update',
          {
            annotationId,
            targetViewportId,
            SeriesInstanceUID: seriesInstanceId,
            SOPInstanceUID: savedAnnotation.SOPInstanceUID,
            frameNumber: getFrameNumberForAnnotation(savedAnnotation),
          }
        );

        return {
          ok: false,
          reason: 'viewport-target-image-not-ready',
          retryable: true,
          annotationId,
          viewportId: targetViewportId,
        };
      }

      const actualReferencedImageId = await jumpViewportToSavedAnnotationImage(
        viewport,
        savedAnnotation
      );

      if (!actualReferencedImageId) {
        return {
          ok: false,
          reason: 'saved-image-not-ready',
          retryable: true,
          annotationId,
          viewportId: targetViewportId,
        };
      }

      const readyReferencedImageId = await waitForViewportImageReady(
        viewport,
        actualReferencedImageId
      );

      if (!readyReferencedImageId) {
        return {
          ok: false,
          reason: 'saved-image-render-not-ready',
          retryable: true,
          annotationId,
          viewportId: targetViewportId,
          referencedImageId: actualReferencedImageId,
        };
      }

      await sleep(50);

      const hydratedViewport =
        cornerstoneViewportService.getCornerstoneViewport(targetViewportId) ||
        cornerstoneViewportService.getCornerstoneViewport(
          viewportGridService.getActiveViewportId()
        ) ||
        viewport;

      const hydratedAnnotation =
        savedAnnotation.toolName === 'Length'
          ? hydrateSavedLengthAnnotationForActiveViewport({
              annotation: savedAnnotation,
              activeViewportId: hydratedViewport.id || targetViewportId,
              referencedImageIdOverride: readyReferencedImageId || actualReferencedImageId || '',
              selectAnnotation,
            })
          : hydrateSavedViewerAnnotationForViewport({
              annotation: savedAnnotation,
              viewport: hydratedViewport,
              viewportId: hydratedViewport.id || targetViewportId,
              referencedImageIdOverride: readyReferencedImageId || actualReferencedImageId || '',
              fallbackFrameOfReferenceUID:
                hydratedViewport.getFrameOfReferenceUID?.() ||
                savedAnnotation.FrameOfReferenceUID ||
                '',
              selectAnnotation,
            });

      if (!hydratedAnnotation) {
        console.warn('[MeasurementAnnotations] saved annotation hydration failed', {
          annotationId,
          toolName: savedAnnotation.toolName,
          targetViewportId: hydratedViewport.id || targetViewportId,
        });

        return {
          ok: false,
          reason: 'annotation-hydration-failed',
          annotationId,
          viewportId: hydratedViewport.id || targetViewportId,
        };
      }

      if (isSpectralDopplerViewerMeasurement(savedAnnotation)) {
        const hydratedId =
          hydratedAnnotation?.annotationUID || hydratedAnnotation?.uid || annotationId;
        let groupedAnnotations = [];
        let referenceViewable = null;

        try {
          groupedAnnotations =
            annotation.state.getAnnotations?.(
              savedAnnotation.toolName || 'PlanarFreehandROI',
              hydratedViewport.element
            ) || [];
        } catch {}

        try {
          referenceViewable = hydratedViewport.isReferenceViewable?.(
            hydratedAnnotation.metadata,
            {}
          );
        } catch {}

        console.info('[VTI Trace] saved viewport hydration', {
          annotationId: hydratedId,
          stateHit: !!annotation.state.getAnnotation?.(hydratedId),
          groupHit: groupedAnnotations.some(
            candidate => getAnnotationId(candidate) === hydratedId
          ),
          groupedCount: groupedAnnotations.length,
          referenceViewable,
          pointCount: hydratedAnnotation?.data?.contour?.polyline?.length || 0,
          closed: hydratedAnnotation?.data?.contour?.closed,
          referencedImageId: hydratedAnnotation?.metadata?.referencedImageId || '',
          currentImageId: hydratedViewport.getCurrentImageId?.() || '',
        });
      }

      // Saved VTI traces are manually hydrated as PlanarFreehandROI annotations.
      // Do not round-trip them back through MeasurementService here: the generic
      // PlanarFreehandROI source mapping can reconstruct/replace the source annotation
      // and discard the custom open spectral trace. The saved panel row already has
      // the persisted VTI display data; Cornerstone annotation state owns viewport display.
      if (!isSpectralDopplerViewerMeasurement(savedAnnotation)) {
        forceSavedAnnotationDisplayEverywhere({
          measurementService,
          savedAnnotation,
          referencedImageId:
            readyReferencedImageId ||
            actualReferencedImageId ||
            savedAnnotation.referencedImageId ||
            '',
        });
      }

      try {
        const { triggerAnnotationRenderForViewportIds } = await import(
          '@cornerstonejs/tools/utilities'
        );

        triggerAnnotationRenderForViewportIds([hydratedViewport.id || targetViewportId]);
      } catch (error) {
        console.warn('[MeasurementAnnotations] trigger render failed:', error);
      }

      hydratedViewport.render?.();

      if (
        runDelayedDisplayRefresh &&
        isViewerContourTool(savedAnnotation.toolName) &&
        !isSpectralDopplerViewerMeasurement(savedAnnotation)
      ) {
        for (const delayMs of [50, 150, 300, 600, 1000]) {
          await sleep(delayMs);

          forceSavedAnnotationDisplayEverywhere({
            measurementService,
            savedAnnotation,
            referencedImageId:
              readyReferencedImageId ||
              actualReferencedImageId ||
              savedAnnotation.referencedImageId ||
              '',
          });

          try {
            const { triggerAnnotationRenderForViewportIds } = await import(
              '@cornerstonejs/tools/utilities'
            );

            triggerAnnotationRenderForViewportIds([hydratedViewport.id || targetViewportId]);
          } catch (error) {
            console.warn('[MeasurementAnnotations] delayed trigger render failed:', error);
          }

          hydratedViewport.render?.();
        }
      }

      return {
        ok: true,
        annotationId,
        viewportId: hydratedViewport.id || targetViewportId,
        referencedImageId:
          readyReferencedImageId ||
          actualReferencedImageId ||
          savedAnnotation.referencedImageId ||
          '',
      };
    },
    showSavedViewerAnnotationsForSameImage: async ({
      annotations: savedAnnotations = [],
      referenceAnnotation: requestedReferenceAnnotation = null,
      selectReferenceAnnotation = false,
    } = {}) => {
      const availableSavedAnnotations = excludeViewerMeasurementsDeletedInSession(savedAnnotations);

      const availableReferenceAnnotation =
        requestedReferenceAnnotation &&
        !viewerMeasurementsDeletedInSession.has(
          getMeasurementAnnotationId(requestedReferenceAnnotation)
        )
          ? requestedReferenceAnnotation
          : null;

      const sameImageAnnotations = getSavedAnnotationsForSameImage(
        availableSavedAnnotations,
        availableReferenceAnnotation
      );

      const referenceAnnotation = availableReferenceAnnotation || sameImageAnnotations[0];

      const referenceAnnotationId = getAnnotationId(referenceAnnotation);

      const orderedAnnotations = referenceAnnotation
        ? [
            referenceAnnotation,
            ...sameImageAnnotations.filter(
              annotation => getAnnotationId(annotation) !== referenceAnnotationId
            ),
          ]
        : [];

      if (!referenceAnnotation || !orderedAnnotations.length) {
        return {
          ok: false,
          reason: 'no-saved-annotations',
          hydratedCount: 0,
        };
      }
      for (const savedAnnotation of availableSavedAnnotations) {
        const savedAnnotationId = getAnnotationId(savedAnnotation);

        if (savedAnnotationId) {
          annotation.state.removeAnnotation?.(savedAnnotationId);
        }
      }
      const navigationResult = await actions.jumpToSavedViewerAnnotation({
        annotation: referenceAnnotation,
        selectAnnotation: selectReferenceAnnotation,
        runDelayedDisplayRefresh: false,
      });

      if (navigationResult?.ok === false) {
        return navigationResult;
      }

      const viewportId = navigationResult?.viewportId || viewportGridService.getActiveViewportId();

      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      const referencedImageId =
        navigationResult?.referencedImageId || referenceAnnotation.referencedImageId || '';

      if (!viewport) {
        return {
          ok: false,
          reason: 'viewport-not-found-after-navigation',
          viewportId,
          hydratedCount: 0,
        };
      }

      let hydratedCount = 1;

      for (const savedAnnotation of orderedAnnotations.slice(1)) {
        const hydratedAnnotation =
          savedAnnotation.toolName === 'Length'
            ? hydrateSavedLengthAnnotationForActiveViewport({
                annotation: savedAnnotation,
                activeViewportId: viewport.id || viewportId,
                referencedImageIdOverride: referencedImageId,
                selectAnnotation: false,
              })
            : hydrateSavedViewerAnnotationForViewport({
                annotation: savedAnnotation,
                viewport,
                viewportId: viewport.id || viewportId,
                referencedImageIdOverride: referencedImageId,
                fallbackFrameOfReferenceUID:
                  viewport.getFrameOfReferenceUID?.() || savedAnnotation.FrameOfReferenceUID || '',
                selectAnnotation: false,
              });

        if (!hydratedAnnotation) {
          console.warn('[MeasurementAnnotations] batch annotation hydration failed', {
            annotationId: getAnnotationId(savedAnnotation),
            toolName: savedAnnotation.toolName,
            viewportId: viewport.id || viewportId,
          });

          continue;
        }

        if (!isSpectralDopplerViewerMeasurement(savedAnnotation)) {
          forceSavedAnnotationDisplayEverywhere({
            measurementService,
            savedAnnotation,
            referencedImageId,
          });
        }

        hydratedCount += 1;
      }

      try {
        const { triggerAnnotationRenderForViewportIds } = await import(
          '@cornerstonejs/tools/utilities'
        );

        triggerAnnotationRenderForViewportIds([viewport.id || viewportId]);
      } catch (error) {
        console.warn('[MeasurementAnnotations] batch trigger render failed:', error);
      }

      viewport.render?.();

      return {
        ok: true,
        viewportId: viewport.id || viewportId,
        referencedImageId,
        hydratedCount,
        requestedCount: orderedAnnotations.length,
        annotationIds: orderedAnnotations.map(getAnnotationId),
      };
    },
    jumpToViewerQuizTarget: async ({ viewerTarget, questionKey = '' } = {}) => {
      const target = normalizeViewerQuizTarget(viewerTarget);

      if (!hasViewerQuizTargetIdentity(target)) {
        console.info('[ViewerQuiz] no viewer target to navigate', {
          questionKey,
          viewerTarget,
        });

        return {
          ok: false,
          reason: 'empty-target',
        };
      }

      const activeViewportId = viewportGridService.getActiveViewportId();
      const displaySet = getDisplaySetForViewerQuizTarget(displaySetService, target);
      let targetViewportId = activeViewportId;

      if (displaySet?.displaySetInstanceUID) {
        const viewportToUpdate = cornerstoneViewportService.findUpdateableViewportConfiguration(
          activeViewportId,
          {
            displaySetInstanceUID: displaySet.displaySetInstanceUID,
            metadata: {
              StudyInstanceUID: target.studyInstanceId || displaySet.StudyInstanceUID,
              SeriesInstanceUID: target.seriesInstanceId || displaySet.SeriesInstanceUID,
              SOPInstanceUID: target.sopInstanceId || '',
              displaySetInstanceUID: displaySet.displaySetInstanceUID,
              referencedImageId: target.referencedImageId || '',
            },
            referencedImageId: target.referencedImageId || '',
          }
        );

        targetViewportId = viewportToUpdate?.viewportId || activeViewportId;

        const viewportsToUpdate = getViewportsToUpdateSafely({
          hangingProtocolService,
          viewportId: targetViewportId,
          displaySetInstanceId: displaySet.displaySetInstanceUID,
          viewportOptions: viewportToUpdate?.viewportOptions,
          context: 'ViewerQuiz',
        });

        if (viewportsToUpdate.length) {
          actions.setDisplaySetsForViewports({ viewportsToUpdate });
          await sleep(300);
        }
      }

      const viewport =
        cornerstoneViewportService.getCornerstoneViewport(targetViewportId) ||
        cornerstoneViewportService.getCornerstoneViewport(
          viewportGridService.getActiveViewportId()
        );

      if (!viewport) {
        console.warn('[ViewerQuiz] no viewport available for target navigation', {
          questionKey,
          target,
        });

        return {
          ok: false,
          reason: 'viewport-not-found',
        };
      }

      const jumpResult = await jumpViewportToViewerQuizTargetImage(viewport, target);

      return {
        ...jumpResult,
        viewportId: targetViewportId,
      };
    },
    clearViewerQuizMarkerOptions: () => {
      clearAllViewerQuizMarkerOverlays();
      return {
        ok: true,
      };
    },
    showViewerQuizMarkerOptions: async ({
      viewerTarget,
      viewportId = '',
      markerOptions = [],
      questionKey = '',
    } = {}) => {
      let resolvedViewportId = viewportId || viewportGridService.getActiveViewportId();

      if (viewerTarget) {
        const navigationResult = await actions.jumpToViewerQuizTarget({
          viewerTarget,
          questionKey,
        });
        resolvedViewportId = navigationResult?.viewportId || resolvedViewportId;
      }

      const viewport = cornerstoneViewportService.getCornerstoneViewport(resolvedViewportId);

      if (!viewport) {
        return {
          ok: false,
          reason: 'viewport-not-found',
          renderedCount: 0,
        };
      }

      return drawViewerQuizMarkerOptions({
        viewport,
        markerOptions,
      });
    },
    showViewerQuizLearnerMeasurement: async ({
      learnerMeasurement = {},
      viewerTarget = null,
      questionKey = '',
    } = {}) => {
      clearViewerQuizMeasurementComparisonAnnotations();
      clearAllViewerQuizMarkerOverlays();

      const { learnerSeriesDoc, baseSeriesDoc } = await getViewerQuizMeasurementSeriesDocs();
      const learnerAnnotation =
        findViewerQuizMeasurementAnnotationInSeriesDocs(learnerMeasurement, [
          learnerSeriesDoc,
          baseSeriesDoc,
        ]) || getViewerQuizMeasurementAnnotationFromService(learnerMeasurement);

      if (!learnerAnnotation) {
        if (viewerTarget) {
          await actions.jumpToViewerQuizTarget({
            viewerTarget,
            questionKey,
          });
        }

        return {
          ok: false,
          reason: 'learner-measurement-annotation-not-found',
          learnerRendered: false,
        };
      }

      await actions.jumpToSavedViewerAnnotation({
        annotation: learnerAnnotation,
      });

      const learnerAnnotationId = getMeasurementAnnotationId(learnerAnnotation);
      const renderedAnnotation = learnerAnnotationId
        ? annotation.state.getAnnotation?.(learnerAnnotationId)
        : null;

      if (renderedAnnotation) {
        renderedAnnotation.isVisible = true;
        renderedAnnotation.isLocked = true;
        cornerstoneTools.annotation.selection.setAnnotationSelected?.(learnerAnnotationId, true);
      }

      return {
        ok: !!renderedAnnotation,
        reason: renderedAnnotation ? '' : 'learner-measurement-hydration-failed',
        learnerRendered: !!renderedAnnotation,
        annotationId: learnerAnnotationId,
      };
    },
    clearViewerQuizMeasurementComparison: () => {
      clearViewerQuizMeasurementComparisonAnnotations();
      return {
        ok: true,
      };
    },
    showViewerQuizMeasurementComparison: async ({
      learnerMeasurement = {},
      rubricMeasurement = {},
      viewerTarget = null,
      questionKey = '',
      radius = null,
      radiusUnit = 'world',
    } = {}) => {
      clearViewerQuizMeasurementComparisonAnnotations();
      clearAllViewerQuizMarkerOverlays();

      const { learnerSeriesDoc, baseSeriesDoc } = await getViewerQuizMeasurementSeriesDocs();

      const learnerAnnotation =
        findViewerQuizMeasurementAnnotationInSeriesDocs(learnerMeasurement, [
          learnerSeriesDoc,
          baseSeriesDoc,
        ]) || getViewerQuizMeasurementAnnotationFromService(learnerMeasurement);
      const rubricAnnotation =
        findViewerQuizMeasurementAnnotationInSeriesDocs(rubricMeasurement, [
          baseSeriesDoc,
          learnerSeriesDoc,
        ]) || getViewerQuizMeasurementAnnotationFromService(rubricMeasurement);

      if (!learnerAnnotation && !rubricAnnotation) {
        return {
          ok: false,
          reason: 'measurement-annotations-not-found',
          renderedCount: 0,
        };
      }

      const comparisonTarget =
        viewerTarget ||
        getViewerQuizMeasurementReferenceTarget(rubricMeasurement, rubricAnnotation) ||
        getViewerQuizMeasurementReferenceTarget(learnerMeasurement, learnerAnnotation);

      let comparisonViewportId = viewportGridService.getActiveViewportId();

      if (comparisonTarget) {
        const navigationResult = await actions.jumpToViewerQuizTarget({
          viewerTarget: comparisonTarget,
          questionKey,
        });
        comparisonViewportId = navigationResult?.viewportId || comparisonViewportId;
      }

      const viewport = cornerstoneViewportService.getCornerstoneViewport(comparisonViewportId);

      if (!viewport) {
        return {
          ok: false,
          reason: 'viewport-not-found',
          renderedCount: 0,
        };
      }

      const frameOfReferenceId =
        viewport?.getFrameOfReferenceUID?.() ||
        viewport?.getImageData?.()?.metadata?.FrameOfReferenceUID ||
        viewport?.getImageData?.()?.metadata?.frameOfReferenceUID ||
        '';
      const learnerSourceAnnotationId =
        getViewerQuizMeasurementSourceAnnotationId(learnerMeasurement);
      const existingLearnerAnnotation = learnerSourceAnnotationId
        ? annotation.state.getAnnotation?.(learnerSourceAnnotationId)
        : null;
      let learnerRendered = false;
      let rubricRendered = false;
      let renderedCount = 0;

      if (existingLearnerAnnotation) {
        existingLearnerAnnotation.isVisible = true;
        existingLearnerAnnotation.isLocked = true;
        cornerstoneTools.annotation.selection.setAnnotationSelected?.(
          learnerSourceAnnotationId,
          false
        );
        learnerRendered = true;
        renderedCount += 1;
      }

      const entries = [
        {
          sourceAnnotation: learnerRendered ? null : learnerAnnotation,
          variant: 'learner' as const,
        },
        {
          sourceAnnotation: rubricAnnotation,
          variant: 'rubric' as const,
        },
      ].filter(entry => !!entry.sourceAnnotation);

      for (const entry of entries) {
        const comparisonAnnotation = buildViewerQuizMeasurementComparisonAnnotation({
          sourceAnnotation: entry.sourceAnnotation,
          variant: entry.variant,
          questionKey,
        });
        const match = await waitForSavedAnnotationImageMatch(viewport, comparisonAnnotation);
        const hydrated = hydrateViewerQuizMeasurementComparisonAnnotation({
          comparisonAnnotation,
          viewport,
          viewportId: comparisonViewportId,
          referencedImageIdOverride: match.imageId || comparisonAnnotation.referencedImageId || '',
          fallbackFrameOfReferenceUID: frameOfReferenceId,
        });
        const comparisonAnnotationId = String(
          hydrated?.annotationUID || hydrated?.uid || ''
        ).trim();
        const hydratedAnnotation = comparisonAnnotationId
          ? annotation.state.getAnnotation?.(comparisonAnnotationId) || hydrated
          : null;

        if (!comparisonAnnotationId || !hydratedAnnotation) {
          continue;
        }

        hydratedAnnotation.isLocked = true;
        hydratedAnnotation.isVisible = true;
        annotation.config.style.setAnnotationStyles(
          comparisonAnnotationId,
          VIEWER_QUIZ_MEASUREMENT_COMPARISON_STYLES[entry.variant]
        );
        cornerstoneTools.annotation.selection.setAnnotationSelected?.(
          comparisonAnnotationId,
          false
        );
        viewerQuizMeasurementComparisonAnnotationIds.add(comparisonAnnotationId);
        renderedCount += 1;
        if (entry.variant === 'learner') {
          learnerRendered = true;
        } else if (entry.variant === 'rubric') {
          rubricRendered = true;
        }
      }

      const rubricCenter =
        getViewerQuizMeasurementCenterPoint(rubricAnnotation) ||
        getViewerQuizMeasurementCenterPoint(rubricMeasurement);
      const numericRadius = Number(radius);
      let toleranceCircleRendered = false;

      if (rubricCenter && Number.isFinite(numericRadius) && numericRadius > 0) {
        toleranceCircleRendered = appendViewerQuizToleranceCircle({
          viewport,
          point: rubricCenter,
          radius: numericRadius,
          radiusUnit,
        });
      }

      if (!toleranceCircleRendered) {
        console.warn('[ViewerQuiz] measurement tolerance circle was not rendered', {
          questionKey,
          hasRubricCenter: !!rubricCenter,
          radius,
          radiusUnit,
          numericRadius,
          rubricAnnotationId: getAnnotationId(rubricAnnotation),
        });
      }

      try {
        const { triggerAnnotationRenderForViewportIds } = await import(
          '@cornerstonejs/tools/utilities'
        );
        triggerAnnotationRenderForViewportIds([comparisonViewportId]);
      } catch {}

      viewport.render?.();

      return {
        ok: renderedCount > 0,
        reason: renderedCount > 0 ? '' : 'measurement-hydration-failed',
        renderedCount,
        learnerRendered,
        rubricRendered,
        toleranceCircleRendered,
      };
    },
    getCurrentViewerQuizFrameAnswer: async () => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);

      if (!viewport) {
        return {
          ok: false,
          reason: 'viewport-not-found',
        };
      }

      const displaySet = getActiveViewportDisplaySet({
        viewportGridService,
        displaySetService,
        viewportId: activeViewportId,
      });

      const answer = buildViewerQuizFrameAnswer({
        viewport,
        displaySet,
        viewportId: activeViewportId,
      });

      if (!answer) {
        return {
          ok: false,
          reason: 'current-frame-not-found',
        };
      }

      return {
        ok: true,
        answer,
      };
    },
    captureViewerQuizPointAnswer: async () => {
      actions.releaseViewerQuizDrawingTool();

      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);

      if (!viewport) {
        return {
          ok: false,
          reason: 'viewport-not-found',
        };
      }

      const displaySet = getActiveViewportDisplaySet({
        viewportGridService,
        displaySetService,
        viewportId: activeViewportId,
      });

      return captureNextViewerClickPoint({
        viewport,
        displaySet,
        viewportId: activeViewportId,
      });
    },
    getSelectedViewerMeasurementQuizAnswer: async ({
      question = {},
      measurementType = '',
      unit = '',
      measurementId = '',
    } = {}) => {
      const activeEnabledElement = _getActiveViewportEnabledElement();
      const explicitMeasurementId = String(measurementId || '').trim();
      const selectedMeasurementId =
        explicitMeasurementId ||
        getSelectedMeasurementIdFromViewport(activeEnabledElement?.viewport?.element);

      if (!selectedMeasurementId) {
        return {
          ok: false,
          reason: 'no-selected-measurement',
        };
      }

      const measurement = findMeasurementServiceMeasurementById(
        measurementService,
        selectedMeasurementId
      );

      if (!measurement) {
        return {
          ok: false,
          reason: 'selected-measurement-not-found',
          selectedMeasurementId,
        };
      }

      const answer = buildViewerQuizAnswerFromMeasurement({
        measurement,
        question,
        measurementType,
        expectedUnit: unit,
        displaySetService,
      });

      if (!answer) {
        return {
          ok: false,
          reason: 'selected-measurement-has-no-numeric-value',
          selectedMeasurementId,
        };
      }

      return {
        ok: true,
        answer,
        selectedMeasurementId,
      };
    },
  };

  const definitions = {
    // The command here is to show the viewer context menu, as being the
    // context menu
    showCornerstoneContextMenu: {
      commandFn: actions.showCornerstoneContextMenu,
      options: {
        menuCustomizationId: 'measurementsContextMenu',
        commands: [
          {
            commandName: 'showContextMenu',
          },
        ],
      },
    },

    getNearbyToolData: {
      commandFn: actions.getNearbyToolData,
    },
    getNearbyAnnotation: {
      commandFn: actions.getNearbyAnnotation,
      storeContexts: [],
      options: {},
    },
    toggleViewportColorbar: {
      commandFn: actions.toggleViewportColorbar,
    },
    setMeasurementLabel: {
      commandFn: actions.setMeasurementLabel,
    },
    startLVSimpsonEFWorkflow: {
      commandFn: actions.startLVSimpsonEFWorkflow,
    },
    startLAVolumeWorkflow: {
      commandFn: actions.startLAVolumeWorkflow,
    },
    startSpectralDopplerVTIWorkflow: {
      commandFn: actions.startSpectralDopplerVTIWorkflow,
    },
    setLVTraceMeasurementLabel: {
      commandFn: actions.setLVTraceMeasurementLabel,
    },
    setSelectedMeasurementLabel: {
      commandFn: actions.setSelectedMeasurementLabel,
    },
    hydrateMeasurementAnnotationsForActiveStudy: {
      commandFn: actions.hydrateMeasurementAnnotationsForActiveStudy,
    },
    renameMeasurement: {
      commandFn: actions.renameMeasurement,
    },
    updateMeasurement: {
      commandFn: actions.updateMeasurement,
    },
    jumpToMeasurement: actions.jumpToMeasurement,
    removeMeasurement: {
      commandFn: actions.removeMeasurement,
    },
    toggleLockMeasurement: {
      commandFn: actions.toggleLockMeasurement,
    },
    toggleVisibilityMeasurement: {
      commandFn: actions.toggleVisibilityMeasurement,
    },
    downloadCSVMeasurementsReport: {
      commandFn: actions.downloadCSVMeasurementsReport,
    },
    setViewportWindowLevel: {
      commandFn: actions.setViewportWindowLevel,
    },
    setWindowLevel: {
      commandFn: actions.setWindowLevel,
    },
    setWindowLevelPreset: {
      commandFn: actions.setWindowLevelPreset,
    },
    setToolActive: {
      commandFn: actions.setToolActive,
    },
    activateViewerMeasurementTool: {
      commandFn: actions.activateViewerMeasurementTool,
    },
    activateViewerQuizMeasurementTool: {
      commandFn: actions.activateViewerQuizMeasurementTool,
    },
    releaseViewerQuizDrawingTool: {
      commandFn: actions.releaseViewerQuizDrawingTool,
    },
    setToolActiveToolbar: {
      commandFn: actions.setToolActiveToolbar,
    },
    setViewerLengthLabelMode: {
      commandFn: actions.setViewerLengthLabelMode,
    },
    getViewerLengthLabelMode: {
      commandFn: actions.getViewerLengthLabelMode,
    },
    resetViewerLengthLabelMode: {
      commandFn: actions.resetViewerLengthLabelMode,
    },
    activateViewerLengthMeasurementMode: {
      commandFn: actions.activateViewerLengthMeasurementMode,
    },
    setToolEnabled: {
      commandFn: actions.setToolEnabled,
    },
    rotateViewportCW: {
      commandFn: actions.rotateViewportBy,
      options: { rotation: 90 },
    },
    rotateViewportCCW: {
      commandFn: actions.rotateViewportBy,
      options: { rotation: -90 },
    },
    rotateViewportCWSet: {
      commandFn: actions.setViewportRotation,
      options: { rotation: 90 },
    },
    incrementActiveViewport: {
      commandFn: actions.changeActiveViewport,
    },
    decrementActiveViewport: {
      commandFn: actions.changeActiveViewport,
      options: { direction: -1 },
    },
    flipViewportHorizontal: {
      commandFn: actions.toggleViewportHorizontalFlip,
    },
    flipViewportVertical: {
      commandFn: actions.toggleViewportVerticalFlip,
    },
    setViewportHorizontalFlip: {
      commandFn: actions.setViewportHorizontalFlip,
      options: { flipped: true },
    },
    setViewportVerticalFlip: {
      commandFn: actions.setViewportVerticalFlip,
      options: { flipped: true },
    },
    invertViewport: {
      commandFn: actions.invertViewport,
    },
    resetViewport: {
      commandFn: actions.resetViewport,
    },
    scaleUpViewport: {
      commandFn: actions.scaleViewport,
      options: { direction: 1 },
    },
    scaleDownViewport: {
      commandFn: actions.scaleViewport,
      options: { direction: -1 },
    },
    fitViewportToWindow: {
      commandFn: actions.scaleViewport,
      options: { direction: 0 },
    },
    nextImage: {
      commandFn: actions.scroll,
      options: { direction: 1 },
    },
    previousImage: {
      commandFn: actions.scroll,
      options: { direction: -1 },
    },
    firstImage: {
      commandFn: actions.jumpToImage,
      options: { imageIndex: 0 },
    },
    lastImage: {
      commandFn: actions.jumpToImage,
      options: { imageIndex: -1 },
    },
    jumpToImage: {
      commandFn: actions.jumpToImage,
    },
    showDownloadViewportModal: {
      commandFn: actions.showDownloadViewportModal,
    },
    toggleCine: {
      commandFn: actions.toggleCine,
    },
    arrowTextCallback: {
      commandFn: actions.arrowTextCallback,
    },
    setViewportActive: {
      commandFn: actions.setViewportActive,
    },
    setViewportColormap: {
      commandFn: actions.setViewportColormap,
    },
    setViewportForToolConfiguration: {
      commandFn: actions.setViewportForToolConfiguration,
    },
    storePresentation: {
      commandFn: actions.storePresentation,
    },
    attachProtocolViewportDataListener: {
      commandFn: actions.attachProtocolViewportDataListener,
    },
    setViewportPreset: {
      commandFn: actions.setViewportPreset,
    },
    setVolumeRenderingQulaity: {
      commandFn: actions.setVolumeRenderingQulaity,
    },
    shiftVolumeOpacityPoints: {
      commandFn: actions.shiftVolumeOpacityPoints,
    },
    setVolumeLighting: {
      commandFn: actions.setVolumeLighting,
    },
    resetCrosshairs: {
      commandFn: actions.resetCrosshairs,
    },
    toggleSynchronizer: {
      commandFn: actions.toggleSynchronizer,
    },
    updateVolumeData: {
      commandFn: actions.updateVolumeData,
    },
    toggleEnabledDisabledToolbar: {
      commandFn: actions.toggleEnabledDisabledToolbar,
    },
    toggleActiveDisabledToolbar: {
      commandFn: actions.toggleActiveDisabledToolbar,
    },
    updateStoredPositionPresentation: {
      commandFn: actions.updateStoredPositionPresentation,
    },
    updateStoredSegmentationPresentation: {
      commandFn: actions.updateStoredSegmentationPresentation,
    },
    createLabelmapForViewport: {
      commandFn: actions.createLabelmapForViewport,
    },
    setActiveSegmentation: {
      commandFn: actions.setActiveSegmentation,
    },
    addSegment: {
      commandFn: actions.addSegmentCommand,
    },
    setActiveSegmentAndCenter: {
      commandFn: actions.setActiveSegmentAndCenterCommand,
    },
    toggleSegmentVisibility: {
      commandFn: actions.toggleSegmentVisibilityCommand,
    },
    toggleSegmentLock: {
      commandFn: actions.toggleSegmentLockCommand,
    },
    toggleSegmentationVisibility: {
      commandFn: actions.toggleSegmentationVisibilityCommand,
    },
    downloadSegmentation: {
      commandFn: actions.downloadSegmentationCommand,
    },
    storeSegmentation: {
      commandFn: actions.storeSegmentationCommand,
    },
    downloadRTSS: {
      commandFn: actions.downloadRTSSCommand,
    },
    setSegmentationStyle: {
      commandFn: actions.setSegmentationStyleCommand,
    },
    deleteSegment: {
      commandFn: actions.deleteSegmentCommand,
    },
    deleteSegmentation: {
      commandFn: actions.deleteSegmentationCommand,
    },
    removeSegmentationFromViewport: {
      commandFn: actions.removeSegmentationFromViewportCommand,
    },
    toggleRenderInactiveSegmentations: {
      commandFn: actions.toggleRenderInactiveSegmentationsCommand,
    },
    setFillAlpha: {
      commandFn: actions.setFillAlphaCommand,
    },
    setOutlineWidth: {
      commandFn: actions.setOutlineWidthCommand,
    },
    setRenderFill: {
      commandFn: actions.setRenderFillCommand,
    },
    setRenderOutline: {
      commandFn: actions.setRenderOutlineCommand,
    },
    setFillAlphaInactive: {
      commandFn: actions.setFillAlphaInactiveCommand,
    },
    editSegmentLabel: {
      commandFn: actions.editSegmentLabel,
    },
    editSegmentationLabel: {
      commandFn: actions.editSegmentationLabel,
    },
    editSegmentColor: {
      commandFn: actions.editSegmentColor,
    },
    getRenderInactiveSegmentations: {
      commandFn: actions.getRenderInactiveSegmentations,
    },
    deleteActiveAnnotation: {
      commandFn: actions.deleteActiveAnnotation,
    },
    setDisplaySetsForViewports: actions.setDisplaySetsForViewports,
    undo: actions.undo,
    redo: actions.redo,
    interpolateLabelmap: actions.interpolateLabelmap,
    runSegmentBidirectional: actions.runSegmentBidirectional,
    downloadCSVSegmentationReport: actions.downloadCSVSegmentationReport,
    toggleSegmentPreviewEdit: actions.toggleSegmentPreviewEdit,
    toggleSegmentSelect: actions.toggleSegmentSelect,
    acceptPreview: actions.acceptPreview,
    rejectPreview: actions.rejectPreview,
    toggleUseCenterSegmentIndex: actions.toggleUseCenterSegmentIndex,
    toggleLabelmapAssist: actions.toggleLabelmapAssist,
    interpolateScrollForMarkerLabelmap: actions.interpolateScrollForMarkerLabelmap,
    clearMarkersForMarkerLabelmap: actions.clearMarkersForMarkerLabelmap,
    setBrushSize: actions.setBrushSize,
    setThresholdRange: actions.setThresholdRange,
    increaseBrushSize: actions.increaseBrushSize,
    decreaseBrushSize: actions.decreaseBrushSize,
    addNewSegment: actions.addNewSegment,
    loadSegmentationDisplaySetsForViewport: actions.loadSegmentationDisplaySetsForViewport,
    setViewportOrientation: actions.setViewportOrientation,
    hydrateSecondaryDisplaySet: actions.hydrateSecondaryDisplaySet,
    getVolumeIdForDisplaySet: actions.getVolumeIdForDisplaySet,
    triggerCreateAnnotationMemo: actions.triggerCreateAnnotationMemo,
    startRecordingForAnnotationGroup: actions.startRecordingForAnnotationGroup,
    endRecordingForAnnotationGroup: actions.endRecordingForAnnotationGroup,
    toggleSegmentLabel: actions.toggleSegmentLabel,
    jumpToMeasurementViewport: actions.jumpToMeasurementViewport,
    initializeSegmentLabelTool: actions.initializeSegmentLabelTool,
    clearViewerMeasurementsCreatedInSession: {
      commandFn: actions.clearViewerMeasurementsCreatedInSession,
    },

    markViewerMeasurementCreatedInSession: {
      commandFn: actions.markViewerMeasurementCreatedInSession,
    },
    getSerializedViewerMeasurements: {
      commandFn: actions.getSerializedViewerMeasurements,
    },
    saveViewerMeasurementsForActiveStudy: {
      commandFn: async ({
        domain: explicitDomain,
        scoringIntent,
        educationAttemptIntent,
        deleteAnnotationIds = [],
        measurementIds = null,
        suppressSuccessNotification = false,
      } = {}) => {
        const { measurementService, uiNotificationService } = servicesManager.services;

        try {
          const saveTarget = getArViewerSaveTargetFromUrl();
          const explicitDeleteIds = new Set(
            (Array.isArray(deleteAnnotationIds) ? deleteAnnotationIds : [])
              .map(value => String(value || '').trim())
              .filter(Boolean)
          );
          const restrictMeasurementIds = Array.isArray(measurementIds);
          const requestedMeasurementIds = new Set(
            (restrictMeasurementIds ? measurementIds : [])
              .map(value => String(value || '').trim())
              .filter(Boolean)
          );

          const isReviewWorkflowSave = isReviewWorkflowMeasurementsSaveTarget(saveTarget);
          const isClinicalReportSave = isClinicalReportMeasurementsSaveTarget(saveTarget);

          const writableWorkflow = getWritableReviewMeasurementWorkflow(saveTarget);

          if (isReviewWorkflowSave && !writableWorkflow) {
            throw new Error('Measurements and annotations are read-only for this coaching review.');
          }

          let activeSeriesDoc = null;

          if (isClinicalReportSave) {
            activeSeriesDoc = await fetchSeriesDocById(saveTarget.seriesId);
          } else if (isLearnerCopyOnSaveTarget(saveTarget)) {
            if (saveTarget.learnerSeriesId) {
              activeSeriesDoc = await fetchSeriesDocById(saveTarget.learnerSeriesId);
            } else {
              console.info(
                '[MeasurementAnnotations] learner-copy save will resolve learner copy before active lookup',
                {
                  baseSeriesId: saveTarget.baseSeriesId,
                }
              );
            }
          } else {
            try {
              activeSeriesDoc = await fetchSeriesDocForActiveStudy(servicesManager);
            } catch (error) {
              if (error?.code !== 'series_document_not_found') {
                throw error;
              }

              const fallbackDomain = inferDomainWithoutSeriesDoc(explicitDomain);

              console.info(
                '[MeasurementAnnotations] no Series document exists; ensuring viewer measurement container',
                {
                  domain: fallbackDomain,
                  StudyInstanceUID: error?.studyInstanceId || '',
                  SeriesInstanceUID: error?.seriesInstanceId || '',
                }
              );

              activeSeriesDoc = await ensureSeriesDocForActiveStudy(servicesManager, {
                domain: fallbackDomain,
              });
            }
          }

          const seriesDoc = await resolveViewerSaveSeriesDoc({
            servicesManager,
            currentSeriesDoc: activeSeriesDoc,
          });

          if (
            isLearnerCopyOnSaveTarget(saveTarget) &&
            (seriesDoc?.isLearnerCopy === true || seriesDoc?._id)
          ) {
            rememberArLearnerSeriesId(seriesDoc._id);
          }

          const domain = inferDomainFromSeriesDoc(seriesDoc, explicitDomain);

          const normalizedScoringIntent = String(scoringIntent || educationAttemptIntent || '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-');

          const shouldSubmitForScore = [
            'score',
            'score-attempt',
            'submit-score',
            'submit-for-score',
            'submitted-for-score',
          ].includes(normalizedScoringIntent);

          const measurements = getCurrentViewerMeasurementSnapshot(measurementService);

          const targetWorkflow = writableWorkflow || VIEWER_MEASUREMENTS_WORKFLOW;

          const existingById = getExistingAnnotationsById(seriesDoc, targetWorkflow);

          const blockedMeasurementIds = isReviewWorkflowSave
            ? getBlockedReviewMeasurementIds({
                seriesDoc,
                saveTarget,
              })
            : new Set();

          const writableExistingMeasurementIds = isReviewWorkflowSave
            ? getWritableExistingReviewMeasurementIds({
                seriesDoc,
                saveTarget,
              })
            : new Set();

          const existingScorableAnnotations = getExistingScorableViewerAnnotations(
            seriesDoc,
            domain
          );

          const reviewRound = isReviewWorkflowSave
            ? getCurrentReviewMeasurementRound(seriesDoc)
            : 0;

          const liveAnnotations = measurements
            .filter(measurement => {
              const measurementId = getMeasurementAnnotationId(measurement);

              return (
                measurement?.toolName &&
                isPersistableViewerMeasurement(measurement) &&
                !!measurementId &&
                (!restrictMeasurementIds || requestedMeasurementIds.has(measurementId)) &&
                !viewerMeasurementsDeletedInSession.has(measurementId) &&
                !explicitDeleteIds.has(measurementId) &&
                (!isReviewWorkflowSave ||
                  (!blockedMeasurementIds.has(measurementId) &&
                    (writableExistingMeasurementIds.has(measurementId) ||
                      viewerMeasurementsCreatedInSession.has(measurementId))))
              );
            })
            .map(measurement =>
              serializeViewerMeasurement(measurement, domain, existingById.get(measurement.uid), {
                displaySetService,
                workflow: targetWorkflow,
              })
            )
            .map(annotation =>
              isReviewWorkflowSave
                ? {
                    ...annotation,
                    reviewRound,
                  }
                : annotation
            )
            .filter(annotation => annotation.referencedImageId || annotation.points?.length);

          let annotations = liveAnnotations;

          if (isReviewWorkflowSave) {
            const annotationsById = new Map();

            // Preserve writable saved annotations that are currently on other
            // images and therefore may not be hydrated in MeasurementService.
            for (const existingAnnotation of existingById.values()) {
              const existingAnnotationId = getMeasurementAnnotationId(existingAnnotation);

              if (
                !existingAnnotationId ||
                !writableExistingMeasurementIds.has(existingAnnotationId) ||
                viewerMeasurementsDeletedInSession.has(existingAnnotationId)
              ) {
                continue;
              }

              annotationsById.set(existingAnnotationId, existingAnnotation);
            }

            // New or modified live annotations replace the saved version.
            for (const liveAnnotation of liveAnnotations) {
              const liveAnnotationId = getMeasurementAnnotationId(liveAnnotation);

              if (liveAnnotationId) {
                annotationsById.set(liveAnnotationId, liveAnnotation);
              }
            }

            annotations = Array.from(annotationsById.values());
          }

          if (isClinicalReportSave) {
            annotations = canonicalizeClinicalViewerMeasurementAnnotations(annotations);
          }

          if (
            annotations.length === 0 &&
            !isReviewWorkflowSave &&
            shouldSubmitForScore &&
            existingScorableAnnotations.length > 0
          ) {
            annotations = existingScorableAnnotations;
          }

          const hasPendingReviewDeletion =
            isReviewWorkflowSave &&
            Array.from(viewerMeasurementsDeletedInSession).some(measurementId =>
              writableExistingMeasurementIds.has(measurementId)
            );
          const hasExplicitDeletion = explicitDeleteIds.size > 0;

          if (annotations.length === 0 && !hasPendingReviewDeletion && !hasExplicitDeletion) {
            uiNotificationService.show({
              title: 'AR Measurements & Annotations',
              message: shouldSubmitForScore
                ? 'No saved viewer measurements to score.'
                : 'No viewer measurements or annotations to save.',
              type: 'warning',
              duration: 3000,
            });

            return null;
          }

          const savedAnnotationIds = new Set(
            annotations.map(annotation => annotation.annotationId || annotation.uid).filter(Boolean)
          );
          const deletedClinicalSemanticKeys = new Set<string>();

          if (isClinicalReportSave) {
            for (const measurementId of [
              ...viewerMeasurementsDeletedInSession,
              ...explicitDeleteIds,
            ]) {
              const existingAnnotation = existingById.get(String(measurementId));
              const semanticKey = getClinicalViewerMeasurementSemanticKey(existingAnnotation);

              if (semanticKey) {
                deletedClinicalSemanticKeys.add(semanticKey);
              }
            }
          }

          let savedSeriesDoc = seriesDoc;
          let refreshedAnnotations = annotations;
          let clinicalReportFieldUpdates: Record<string, any> = {};

          if (isReviewWorkflowSave) {
            const workflowType = encodeURIComponent(saveTarget.reviewWorkflowType);

            const response = await fetch(
              buildFormApiUrl(
                `series/review-workflows/${encodeURIComponent(
                  seriesDoc._id
                )}/viewer-measurements?workflowType=${workflowType}`
              ),
              buildFormApiFetchOptions({
                method: 'PUT',
                body: JSON.stringify({
                  measurementWorkflowRole: normalizeReviewMeasurementRole(
                    saveTarget.measurementWorkflowRole
                  ),
                  annotations,
                }),
              })
            );

            if (!response.ok) {
              const message = await getResponseErrorMessage(
                response,
                `Save failed: ${response.status}`
              );

              throw new Error(message);
            }

            const result = await response.json();

            savedSeriesDoc = result?.seriesDoc || result?.item || seriesDoc;

            refreshedAnnotations = decorateReviewWorkflowAnnotations({
              annotations: getRequestedWorkflowAnnotations(savedSeriesDoc.MeasurementAnnotations, [
                VIEWER_MEASUREMENTS_WORKFLOW,
                REVIEWER_MEASUREMENTS_WORKFLOW,
              ]).filter(annotation => {
                const annotationDomain = annotation?.domain || 'generic';

                return (
                  annotationDomain === domain ||
                  (domain !== 'generic' && annotationDomain === 'generic')
                );
              }),
              seriesDoc: savedSeriesDoc,
              saveTarget,
            });
          } else {
            const incomingClinicalSemanticKeys = new Set(
              annotations.map(getClinicalViewerMeasurementSemanticKey).filter(Boolean)
            );
            const mergedMeasurementAnnotations = upsertViewerMeasurementAnnotations({
              existingRaw: seriesDoc.MeasurementAnnotations,
              source: 'ar-measurements-panel',
              annotations,
              replaceFilter: existing => {
                if (!viewerMeasurementDomainsMatch(existing?.domain || 'generic', domain)) {
                  return false;
                }

                const existingId = existing?.annotationId || existing?.uid;
                const semanticKey = isClinicalReportSave
                  ? getClinicalViewerMeasurementSemanticKey(existing)
                  : '';

                if (
                  semanticKey &&
                  (incomingClinicalSemanticKeys.has(semanticKey) ||
                    deletedClinicalSemanticKeys.has(semanticKey))
                ) {
                  return true;
                }

                if (
                  existingId &&
                  (viewerMeasurementsDeletedInSession.has(existingId) ||
                    explicitDeleteIds.has(String(existingId)))
                ) {
                  return true;
                }

                return !!existingId && savedAnnotationIds.has(existingId);
              },
            });

            let nextMeasurementAnnotations = mergedMeasurementAnnotations;

            if (isClinicalReportSave) {
              const mergedViewerAnnotations = getRequestedWorkflowAnnotations(
                mergedMeasurementAnnotations,
                [VIEWER_MEASUREMENTS_WORKFLOW]
              );
              const canonicalViewerAnnotations =
                canonicalizeClinicalViewerMeasurementAnnotations(
                  mergedViewerAnnotations,
                  deletedClinicalSemanticKeys
                );

              nextMeasurementAnnotations = upsertViewerMeasurementAnnotations({
                existingRaw: mergedMeasurementAnnotations,
                source: 'ar-measurements-panel',
                annotations: canonicalViewerAnnotations,
                replaceFilter: existing =>
                  !!getClinicalViewerMeasurementSemanticKey(existing),
              });
            }

            if (isClinicalReportSave) {
              const reportAnnotations = getRequestedWorkflowAnnotations(nextMeasurementAnnotations, [
                VIEWER_MEASUREMENTS_WORKFLOW,
              ]);

              clinicalReportFieldUpdates = buildViewerReportFieldUpdates(reportAnnotations);

              if (Object.keys(clinicalReportFieldUpdates).length) {
                console.info('[MeasurementAnnotations] clinical report field updates', {
                  fieldNames: Object.keys(clinicalReportFieldUpdates),
                  updatedFields: clinicalReportFieldUpdates,
                });
              }
            }

            const payload = {
              accessType: 'update',
              ...(isClinicalReportSave
                ? { viewerMeasurementIntent: 'clinical-report' }
                : {}),
              ...clinicalReportFieldUpdates,
              MeasurementAnnotations: nextMeasurementAnnotations,
              scoringIntent: shouldSubmitForScore ? 'score-attempt' : 'draft',
              educationAttemptIntent: shouldSubmitForScore ? 'score-attempt' : 'draft',
            };

            const response = await fetch(
              buildFormApiUrl(`series/${seriesDoc._id}`),
              buildFormApiFetchOptions({
                method: 'PUT',
                body: JSON.stringify(payload),
              })
            );

            if (!response.ok) {
              throw new Error(`Save failed: ${response.status}`);
            }

            const updatedSeries = await response.json().catch(() => null);
            if (updatedSeries?._id) {
              savedSeriesDoc = updatedSeries;
            }

            if (isClinicalReportSave) {
              try {
                const refreshedSeriesDoc = await fetchSeriesDocById(seriesDoc._id);

                if (refreshedSeriesDoc?._id) {
                  savedSeriesDoc = refreshedSeriesDoc;
                }
              } catch (refreshError) {
                console.warn(
                  '[MeasurementAnnotations] clinical report refresh after save failed; using PUT response',
                  refreshError
                );
              }
            }

            const canonicalMeasurementAnnotations =
              savedSeriesDoc?.MeasurementAnnotations || nextMeasurementAnnotations;

            refreshedAnnotations = getRequestedWorkflowAnnotations(
              canonicalMeasurementAnnotations,
              [VIEWER_MEASUREMENTS_WORKFLOW]
            ).filter(annotation =>
              viewerMeasurementDomainsMatch(annotation?.domain || 'generic', domain)
            );
          }

          if (isClinicalReportSave && savedSeriesDoc?._id) {
            // AR's Series schema is the acceptance contract. Notify the opener
            // about every report field that actually changed on the persisted
            // server document, regardless of measurement domain or tool.
            const updatedFields = getChangedPersistedArReportFields(
              activeSeriesDoc,
              savedSeriesDoc
            );
            const fieldNames = Object.keys(updatedFields);

            postArReportMeasurementsUpdated({
              seriesDoc: savedSeriesDoc,
              fieldNames,
              updatedFields,
              source: 'viewer-measurements',
            });
          }

          viewerMeasurementsCreatedInSession.clear();
          viewerMeasurementsDeletedInSession.clear();

          dispatchSavedAnnotationsRefresh({
            seriesDoc: savedSeriesDoc,
            saveTarget,
            domain,
            annotations: refreshedAnnotations,
            processedAnnotations: refreshedAnnotations,
          });

          if (!suppressSuccessNotification) {
            uiNotificationService.show({
              title: 'AR Measurements & Annotations',
              message: isReviewWorkflowSave
                ? normalizeReviewMeasurementRole(saveTarget.measurementWorkflowRole) === 'educator'
                  ? 'Coach measurements and annotations saved.'
                  : 'Learner measurements and annotations saved.'
                : shouldSubmitForScore
                  ? 'Viewer measurements saved and submitted for scoring.'
                  : 'Viewer measurements and annotations saved.',
              type: 'success',
              duration: 3000,
            });
          }

          return {
            seriesDoc: savedSeriesDoc,
            annotations: refreshedAnnotations,
          };
        } catch (error) {
          console.error(
            '[MeasurementAnnotations] saveViewerMeasurementsForActiveStudy failed:',
            error
          );

          uiNotificationService.show({
            title: 'AR Measurements & Annotations',
            message: `Save failed: ${error?.message || error}`,
            type: 'error',
            duration: 5000,
          });

          throw error;
        }
      },
    },
    saveViewerStructuredPayloadForActiveStudy: {
      commandFn: async ({
        payload = {},
        source = 'viewer',
        notificationTitle = 'AR Viewer',
        successMessage = 'Viewer data saved.',
        suppressSuccessNotification = false,
      } = {}) => {
        const cleanPayload =
          payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};

        const fieldNames = Object.keys(cleanPayload).filter(fieldName => fieldName !== 'accessType');
        if (!fieldNames.length) {
          throw new Error('No structured viewer data was provided to save.');
        }

        const currentSeriesDoc = await resolveViewerReadSeriesDoc(servicesManager, {
          allowBaseFallback: true,
        });
        const seriesDoc = await resolveViewerSaveSeriesDoc({
          servicesManager,
          currentSeriesDoc,
        });

        if (!seriesDoc?._id) {
          throw new Error('Unable to resolve the AR Series document for this viewer study.');
        }

        const response = await fetch(
          buildFormApiUrl(`series/${encodeURIComponent(seriesDoc._id)}`),
          buildFormApiFetchOptions({
            method: 'PUT',
            body: JSON.stringify({
              ...cleanPayload,
              accessType: 'update',
            }),
          })
        );

        if (!response.ok) {
          const message = await getResponseErrorMessage(
            response,
            `Structured viewer data save failed: ${response.status}`
          );
          throw new Error(message);
        }

        const updatedSeries = await response.json().catch(() => null);
        const sourceSeries = updatedSeries || seriesDoc;
        const updatedFields = fieldNames.reduce((acc, fieldName) => {
          if (updatedSeries && Object.prototype.hasOwnProperty.call(updatedSeries, fieldName)) {
            acc[fieldName] = updatedSeries[fieldName];
          } else if (Object.prototype.hasOwnProperty.call(cleanPayload, fieldName)) {
            acc[fieldName] = cleanPayload[fieldName];
          }
          return acc;
        }, {});

        postArReportMeasurementsUpdated({
          seriesDoc: sourceSeries,
          fieldNames,
          updatedFields,
          source,
        });

        if (!suppressSuccessNotification) {
          uiNotificationService.show({
            title: notificationTitle,
            message: successMessage,
            type: 'success',
            duration: 3000,
          });
        }

        return {
          seriesDoc: sourceSeries,
          fieldNames,
          updatedFields,
        };
      },
    },

    completeIuscanIntegrationSession: {
      commandFn: async () => {
        const params = getViewerUrlSearchParams();
        const integration = String(params.get('arIntegration') || '')
          .trim()
          .toLowerCase();

        if (integration !== 'iuscan') {
          throw new Error('This viewer is not an external iUSCAN session.');
        }

        const response = await fetch('/formapi/api/integrations/iuscan/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: '{}',
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(body?.message || body?.error || `Completion failed: ${response.status}`);
        }

        if (!body?.returnUrl) {
          throw new Error('The iUSCAN return URL is missing.');
        }

        window.sessionStorage.removeItem('iuscanIntegrationSession');
        window.location.replace(body.returnUrl);

        return body;
      },
    },
    getViewerMeasurementDomainForActiveStudy: {
      commandFn: actions.getViewerMeasurementDomainForActiveStudy,
    },
    getViewerMeasurementAnnotationsForActiveStudy: {
      commandFn: actions.getViewerMeasurementAnnotationsForActiveStudy,
    },
    jumpToSavedViewerAnnotation: {
      commandFn: actions.jumpToSavedViewerAnnotation,
    },
    showSavedViewerAnnotationsForSameImage: {
      commandFn: actions.showSavedViewerAnnotationsForSameImage,
    },
    jumpToViewerQuizTarget: {
      commandFn: actions.jumpToViewerQuizTarget,
    },
    showViewerQuizMarkerOptions: {
      commandFn: actions.showViewerQuizMarkerOptions,
    },
    clearViewerQuizMarkerOptions: {
      commandFn: actions.clearViewerQuizMarkerOptions,
    },
    showViewerQuizLearnerMeasurement: {
      commandFn: actions.showViewerQuizLearnerMeasurement,
    },
    clearViewerQuizMeasurementComparison: {
      commandFn: actions.clearViewerQuizMeasurementComparison,
    },
    showViewerQuizMeasurementComparison: {
      commandFn: actions.showViewerQuizMeasurementComparison,
    },
    getCurrentViewerQuizFrameAnswer: {
      commandFn: actions.getCurrentViewerQuizFrameAnswer,
    },
    captureViewerQuizPointAnswer: {
      commandFn: actions.captureViewerQuizPointAnswer,
    },
    getSelectedViewerMeasurementQuizAnswer: {
      commandFn: actions.getSelectedViewerMeasurementQuizAnswer,
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
}

export default commandsModule;
