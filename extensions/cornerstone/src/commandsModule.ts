import { getSplinePersistence, compactOversampledSpline } from './utils/splinePersistence';
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
import { isSavedLVSimpsonImageMatch } from './utils/savedVolumeContourMetadata';
import { buildFormApiFetchOptions, buildFormApiUrl } from './utils/formApi';
import { callMultilineTextDialog } from './utils/callMultilineTextDialog';
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
  deriveLVSimpsonGeometryFromFreehand,
} from './utils/lvSimpsonContour';
import { buildRVFACContourFromAnnulusApex } from './utils/rvFacContour';
import { resolveSpectralVmaxClick } from './utils/spectralVmaxClick';
import {
  SPECTRAL_DOPPLER_LABEL,
  SPECTRAL_DOPPLER_MEASUREMENT_KIND,
  buildSpectralDopplerDisplayText,
  calculateSpectralDopplerVTI,
  getSpectralDopplerSummaryText,
} from './utils/spectralDoppler';
// AR_DECELERATION_TIME:BEGIN import
import {
  DECELERATION_TIME_MEASUREMENT_KIND,
  buildDecelerationTimeDisplayText,
  calculateDecelerationTimeFromDirectionalStats,
  getDecelerationTimeSummaryText,
  getDecelerationTimeTargetOptions,
  normalizeDecelerationTimeTargetSelection,
} from './utils/decelerationTime';
// AR_DECELERATION_TIME:END import
import {
  buildViewerReportFieldUpdates,
  buildViewerReportMapping,
  getSpectralDopplerVtiTargetOptions,
  normalizeSpectralDopplerVtiTargetSelection,
} from './utils/viewerReportMapping';
import {
  buildUltrasoundDirectionalReportMapping,
  convertUltrasoundDirectionalValueForTarget,
  getUltrasoundDirectionalTargetOptionsForUnit,
  getSpectralVmaxTargetOptionsForUnit,
  normalizeUltrasoundDirectionalTargetSelection,
} from './utils/ultrasoundDirectionalReportMapping';
import { isIuscanBowelViewerContext } from '../../extension-ar-measurements/src/utils/measurementLabelConfig';
import {
  BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
  getBowelCurvedLengthTargetOptions,
  normalizeBowelMeasurementTargetSelection,
} from '../../extension-ar-measurements/src/utils/bowelMeasurementTargets';
import { calculateLVSimpson } from '../../extension-ar-measurements/src/utils/lvSimpson';
import { getEchoAreaSlot } from '../../extension-ar-measurements/src/utils/echoAreaMeasurements';
import { resolveViewerQuizCompositeResult, resolveViewerQuizLVSimpsonForStudy, isViewerQuizCompositeReviewCurrent, getViewerQuizCompositeStatus, calibratedLVContourAreaCM2 } from '../../extension-ar-measurements/src/utils/viewerQuizCompositeResults';
import { createGuidedMouseToolOwnership } from './utils/guidedMouseToolOwnership';
import { calibrateUSContourPoints, worldToImageIndex } from './utils/usRegionLengthCalibration';
import { getQuizEchoAreaSourceMetadata, calculateCalibratedEchoAreaCM2, getSavedQuizEchoAreaDisplayInfo, getQuizCompositeContourViewportLines, getQuizCompositeGoldContourSlotMetadata, getVerifiedEFGoldContourViewportLines } from './utils/quizEchoAreaCalibration';
import { installQuizContourTextRenderer } from './utils/installQuizContourTextRenderer';
import { consumeViewerLengthFirstLabelMode } from './utils/viewerLengthLabelMode';
import { getViewerQuizRouteMeasurementDomain } from '../../extension-ar-learning/src/utils/viewerQuizMeasurementDomain';
import { resolveViewerQuizGoldAreaBackfill, resolveSavedEFGoldContourAreas, resolveVerifiedEFGoldContourAreasFromDicom } from '../../extension-ar-measurements/src/utils/quizGoldAreaBackfill';

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
const ULTRASOUND_DIRECTIONAL_TOOL_NAME = 'UltrasoundDirectionalTool';
const ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND = 'ultrasound-directional';
const CINE_COMMENT_ANNOTATION_KIND = 'cineComment';
const CINE_COMMENT_SCOPE = 'cine';

const lvSimpsonSessionMeasurementsByUid = new Map<string, any>();
const laVolumeSessionMeasurementsByUid = new Map<string, any>();
const cineCommentSessionMeasurementsById = new Map<string, any>();

const clinicalViewerSeriesReadCache = new Map<string, any>();
const clinicalViewerSeriesReadPending = new Map<string, Promise<any>>();
let activeLVSimpsonWorkflowSessionId = '';
let activeLAVolumeWorkflowSessionId = '';
let activeLVSimpsonCaptureCancel: null | (() => void) = null;
let activeLAVolumeCaptureCancel: null | (() => void) = null;

const LV_SIMPSON_MIN_AXIS_MM = 25;
const LV_SIMPSON_MAX_AXIS_MM = 130;
const LV_SIMPSON_SLOT_PAIR_AXIS_WARNING_RATIO = 0.35;
const LV_SIMPSON_GUIDANCE_DURATION_MS = 10000;
const LV_SIMPSON_WARNING_DURATION_MS = 15000;
const LA_VOLUME_AUTO_CONTINUE_DELAY_MS = 250;

function showLVSimpsonNotification(
  uiNotificationService: any,
  {
    title,
    message,
    type = 'info',
    duration = LV_SIMPSON_GUIDANCE_DURATION_MS,
    actionLabel = 'Dismiss',
    onAction = null,
  }: any = {}
) {
  let notificationId = '';

  notificationId = uiNotificationService.show({
    title,
    message,
    type,
    duration,
    action: {
      label: actionLabel,
      onClick: () => {
        if (notificationId) {
          uiNotificationService.hide(notificationId);
        }

        if (typeof onAction === 'function') {
          onAction();
        }
      },
    },
  });

  return notificationId;
}

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
    )} mm, which is outside the expected range. Verify hinge and apex placement if this is unexpected.`;
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
    )} mm. Recheck hinge and apex placement if this difference is unexpected.`;
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

function getCineCommentSessionMeasurements() {
  return Array.from(cineCommentSessionMeasurementsById.values());
}

function upsertCineCommentSessionMeasurement(measurement: any = {}) {
  const measurementId = getMeasurementAnnotationId(measurement);

  if (!measurementId) {
    return '';
  }

  cineCommentSessionMeasurementsById.set(measurementId, measurement);
  return measurementId;
}

function removeCineCommentSessionMeasurement(measurementId = '') {
  const normalizedMeasurementId = String(measurementId || '').trim();

  if (!normalizedMeasurementId) {
    return false;
  }

  return cineCommentSessionMeasurementsById.delete(normalizedMeasurementId);
}

function clearCineCommentSessionMeasurements() {
  cineCommentSessionMeasurementsById.clear();
}

function getViewerMeasurementSnapshotPoints(measurement: any = {}, geometry: any = {}) {
  const directPoints = Array.isArray(measurement?.points) ? measurement.points : [];
  if (directPoints.length >= 6) {
    return directPoints;
  }

  const geometryPoints = Array.isArray(geometry?.contourPoints)
    ? geometry.contourPoints
    : Array.isArray(geometry?.points)
      ? geometry.points
      : [];

  return geometryPoints;
}

function compactViewerVolumeFallbackPoints(points: any[] = [], maxPoints = 400) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const safeMaxPoints = Math.max(6, Math.floor(Number(maxPoints) || 400));

  if (points.length <= safeMaxPoints) {
    return points;
  }

  const lastIndex = points.length - 1;

  return Array.from({ length: safeMaxPoints }, (_unused, index) => {
    const sourceIndex = Math.round((index * lastIndex) / (safeMaxPoints - 1));
    return points[sourceIndex];
  });
}

function isViewerMeasurementSessionFallbackReplacementReady(
  liveMeasurement: any = {},
  sessionMeasurement: any = {}
) {
  if (isLVSimpsonMeasurement(sessionMeasurement)) {
    if (!isLVSimpsonMeasurement(liveMeasurement)) {
      return false;
    }

    const liveGeometry =
      liveMeasurement?.lvSimpson || liveMeasurement?.measurements?.lvSimpson || {};
    const liveSlot = getLVSimpsonSlotFromMeasurement(liveMeasurement);
    const sessionSlot = getLVSimpsonSlotFromMeasurement(sessionMeasurement);
    const livePoints = getViewerMeasurementSnapshotPoints(liveMeasurement, liveGeometry);

    return !!(
      liveMeasurement?.toolName &&
      liveSlot &&
      (!sessionSlot || liveSlot === sessionSlot) &&
      livePoints.length >= 6 &&
      (liveMeasurement?.referencedImageId || liveMeasurement?.referenceSeriesUID)
    );
  }

  if (isLAVolumeMeasurement(sessionMeasurement)) {
    if (!isLAVolumeMeasurement(liveMeasurement)) return false;
    const liveGeometry =
      liveMeasurement?.laVolume || liveMeasurement?.measurements?.laVolume || {};
    const liveSlot = getLAVolumeSlotFromMeasurement(liveMeasurement);
    const sessionSlot = getLAVolumeSlotFromMeasurement(sessionMeasurement);
    const livePoints = getViewerMeasurementSnapshotPoints(liveMeasurement, liveGeometry);
    // A spline is not a valid replacement for LA source evidence until the
    // guided anatomy and calibrated axis have arrived from Cornerstone.
    const hasLandmarks = !!(liveGeometry.baseLeftPoint && liveGeometry.baseRightPoint &&
      (liveGeometry.superiorPoint || liveGeometry.axisPoint || liveGeometry.apexPoint));
    const axisLength = Number(liveGeometry.longAxisLengthMM);
    const matchingSource = !sessionMeasurement?.referencedImageId ||
      liveMeasurement?.referencedImageId === sessionMeasurement.referencedImageId;
    return !!(liveMeasurement?.toolName &&
      liveSlot && (!sessionSlot || liveSlot === sessionSlot) &&
      livePoints.length >= 6 && hasLandmarks &&
      Number.isFinite(axisLength) && axisLength > 0 &&
      matchingSource && liveMeasurement?.referencedImageId);
  }

  return true;
}

function mergeViewerMeasurementSnapshots({
  lvSimpsonSessionMeasurements = [],
  laVolumeSessionMeasurements = [],
  liveMeasurements = [],
}: {
  lvSimpsonSessionMeasurements?: any[];
  laVolumeSessionMeasurements?: any[];
  liveMeasurements?: any[];
} = {}) {
  const measurementsWithoutId: any[] = [];
  const measurementsById = new Map<string, any>();
  const sessionFallbackById = new Map<string, any>();

  for (const sessionMeasurement of [
    ...(Array.isArray(lvSimpsonSessionMeasurements) ? lvSimpsonSessionMeasurements : []),
    ...(Array.isArray(laVolumeSessionMeasurements) ? laVolumeSessionMeasurements : []),
  ]) {
    const measurementId = getMeasurementAnnotationId(sessionMeasurement);

    if (!measurementId) {
      measurementsWithoutId.push(sessionMeasurement);
      continue;
    }

    sessionFallbackById.set(measurementId, sessionMeasurement);
    measurementsById.set(measurementId, sessionMeasurement);
  }

  for (const liveMeasurement of Array.isArray(liveMeasurements) ? liveMeasurements : []) {
    const measurementId = getMeasurementAnnotationId(liveMeasurement);

    if (!measurementId) {
      measurementsWithoutId.push(liveMeasurement);
      continue;
    }

    const sessionFallback = sessionFallbackById.get(measurementId);

    if (
      sessionFallback &&
      !isViewerMeasurementSessionFallbackReplacementReady(liveMeasurement, sessionFallback)
    ) {
      continue;
    }

    measurementsById.set(measurementId, liveMeasurement);
  }

  return [...measurementsWithoutId, ...measurementsById.values()];
}

function synchronizeViewerMeasurementSessionFallbacks(liveMeasurements: any[] = []) {
  for (const liveMeasurement of Array.isArray(liveMeasurements) ? liveMeasurements : []) {
    const measurementId = getMeasurementAnnotationId(liveMeasurement);

    if (!measurementId) {
      continue;
    }

    const lvSimpsonFallback = lvSimpsonSessionMeasurementsByUid.get(measurementId);
    if (
      lvSimpsonFallback &&
      isViewerMeasurementSessionFallbackReplacementReady(liveMeasurement, lvSimpsonFallback)
    ) {
      // This function runs while the panel is resolving its live snapshot.
      // Updating the fallback map is sufficient. Re-dispatching the LV session
      // event here feeds directly back into another panel snapshot and creates
      // an unbounded refresh loop once a live contour replaces its fallback.
      lvSimpsonSessionMeasurementsByUid.set(measurementId, liveMeasurement);
    }

    const laVolumeFallback = laVolumeSessionMeasurementsByUid.get(measurementId);
    if (
      laVolumeFallback &&
      isViewerMeasurementSessionFallbackReplacementReady(liveMeasurement, laVolumeFallback)
    ) {
      // Same rule for LA: session events are emitted by the workflow upsert,
      // never by snapshot synchronization.
      laVolumeSessionMeasurementsByUid.set(measurementId, liveMeasurement);
    }
  }
}

function getCurrentViewerMeasurementSnapshot(
  measurementService: any,
  cornerstoneFallbackMeasurements: any[] = []
) {
  const rawLiveMeasurements = measurementService?.getMeasurements?.() || [];
  const liveMeasurements = rawLiveMeasurements.filter(
    measurement => !isUltrasoundDirectionalViewerMeasurement(measurement)
  );
  const fallbackMeasurements = Array.isArray(cornerstoneFallbackMeasurements)
    ? cornerstoneFallbackMeasurements
    : [];

  synchronizeViewerMeasurementSessionFallbacks(liveMeasurements);

  const mergedMeasurements = mergeViewerMeasurementSnapshots({
    lvSimpsonSessionMeasurements: [
      ...fallbackMeasurements.filter(isLVSimpsonMeasurement),
      ...getLVSimpsonSessionMeasurements(),
    ],
    laVolumeSessionMeasurements: [
      ...fallbackMeasurements.filter(isLAVolumeMeasurement),
      ...getLAVolumeSessionMeasurements(),
    ],
    liveMeasurements,
  });

  const measurementsById = new Map<string, any>();
  const measurementsWithoutId: any[] = [];

  for (const measurement of mergedMeasurements) {
    const measurementId = getMeasurementAnnotationId(measurement);

    if (measurementId) {
      measurementsById.set(measurementId, measurement);
    } else {
      measurementsWithoutId.push(measurement);
    }
  }

  // Cornerstone annotation state is the source of truth for tools that AR owns
  // directly rather than round-tripping through OHIF MeasurementService.
  for (const measurement of fallbackMeasurements.filter(
    measurement =>
      isUltrasoundDirectionalViewerMeasurement(measurement) ||
      isBowelCurvedLengthViewerMeasurement(measurement)
  )) {
    const measurementId = getMeasurementAnnotationId(measurement);

    if (measurementId) {
      measurementsById.set(measurementId, measurement);
    } else {
      measurementsWithoutId.push(measurement);
    }
  }

  // Native hydrate does not emit a completed measurement. MeasurementService
  // update ignores unknown IDs, so new guided RV contours must also be read
  // directly from annotation state before any adapter entry exists.
  for (const native of getAllCornerstoneViewerAnnotations()) {
    const source = getCornerstoneEchoAreaMeasurementFallback(native);
    if (!source) continue;
    measurementsById.set(source.uid, { ...(measurementsById.get(source.uid) || {}), ...source });
  }

  // Cine comments intentionally have no Cornerstone geometry. MeasurementService.update()
  // only updates IDs it already owns, so newly-created comments live in this small
  // session map until the normal viewerMeasurements/reviewerMeasurements save succeeds.
  for (const measurement of getCineCommentSessionMeasurements()) {
    const measurementId = getMeasurementAnnotationId(measurement);

    if (measurementId) {
      measurementsById.set(measurementId, measurement);
    } else {
      measurementsWithoutId.push(measurement);
    }
  }

  // MeasurementService may remap an earlier PlanarFreehandROI when another
  // contour is completed. Prefer the calibrated spectral result retained on the
  // original Cornerstone annotation over generic length/area statistics.
  const restoredMeasurements = [...measurementsWithoutId, ...measurementsById.values()].map(
    measurement => {
      const measurementId = getMeasurementAnnotationId(measurement);
      const annotation = measurementId
        ? cornerstoneTools.annotation.state.getAnnotation?.(measurementId)
        : null;
      const spectralDoppler = annotation?.data?.spectralDoppler;

      // Preserve anatomical LA landmarks while following edited spline points
      // on the exact source frame. The session fallback handles early adapters
      // that have not yet populated the full LA measurement contract.
      if (isLAVolumeMeasurement(measurement) && annotation?.data) {
        const sourceImage = String(annotation?.metadata?.referencedImageId || '');
        const measuredImage = String(measurement?.referencedImageId || '');
        const points = annotation?.data?.contour?.polyline;
        const geometry = annotation?.data?.laVolume ||
          measurement?.laVolume || measurement?.measurements?.laVolume;
        if ((!sourceImage || !measuredImage || sourceImage === measuredImage) &&
          Array.isArray(points) && points.length >= 6 && geometry?.slot) {
          return {
            ...measurement, points,
            laVolume: { ...geometry, contourPoints: points },
          };
        }
      }

      // SplineROI and Length keep calibrated stats on their Cornerstone source
      // annotation. Quiz acquisition can populate MeasurementService before its
      // numeric adapter receives those stats. Preserve only the source tool's
      // calibrated cachedStats, never infer an area/diameter from polygon pixels.
      const sourceKind = String(measurement?.measurementKind ||
        measurement?.measurements?.measurementKind || '').trim();
      const echoAreaSource = getQuizEchoAreaSourceMetadata(annotation?.data);
      const isRightHeartContour = sourceKind === 'echoAreaSlot' ||
        echoAreaSource.measurementKind === 'echoAreaSlot';
      const ivcLabel = String(measurement?.label ||
        measurement?.measurementRole || measurement?.role || '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
      const isIVC = measurement?.toolName === 'Length' &&
        ['ivcexp', 'ivcexpiration', 'ivcinsp', 'ivcinspiration',
         'ivcendexpiration', 'ivcendinspiration',
         'ivcendexpirationdiameter', 'ivcendinspirationdiameter'].includes(ivcLabel);
      if ((isRightHeartContour || isIVC) && annotation?.data) {
        const sourceImage = String(annotation?.metadata?.referencedImageId || '');
        const measuredImage = String(measurement?.referencedImageId || '');
        // Never substitute measurements from a different source frame.
        if (!sourceImage || !measuredImage || sourceImage === measuredImage) {
          const sourceStats = annotation.data.cachedStats ||
            annotation.cachedStats || {};
          const contourPoints = annotation.data?.contour?.polyline ||
            annotation.data?.handles?.points;
          const storedRegions = annotation.data?.echoArea?.calibrationRegions ||
            measurement?.echoArea?.calibrationRegions;
          const regions = Array.isArray(storedRegions) && storedRegions.length
            ? storedRegions : isRightHeartContour ? getEchoAreaCalibrationRegions({
                displaySet: null, imageId: sourceImage || measuredImage,
                sopInstanceId: measurement.SOPInstanceUID,
              }) : [];
          // Once a contour is edited, the original area is stale. Recalculate
          // from the currently drawn contour and its previously verified DICOM
          // region rather than trusting an old MeasurementService value.
          const hasAreaCalibration = isRightHeartContour &&
            Array.isArray(regions) && regions.length > 0 &&
            Array.isArray(contourPoints);
          const updatedArea = hasAreaCalibration
            ? calibratedEchoAreaFromRegions({
                points: contourPoints, imageId: sourceImage || measuredImage,
                regions,
              })
            : null;
          return {
            ...measurement,
            ...echoAreaSource,
            ...(hasAreaCalibration ? {
              echoArea: { ...(echoAreaSource.echoArea || measurement.echoArea), calibrationRegions: regions },
              points: contourPoints,
              area: updatedArea,
              measurements: {
                ...(measurement.measurements || {}),
                area: updatedArea,
                areaUnit: updatedArea != null ? 'cm2' : '',
              },
            } : {}),
            cachedStats: hasAreaCalibration ? {} : sourceStats,
            data: {
              ...(measurement?.data || {}),
              cachedStats: hasAreaCalibration ? {} : sourceStats,
            },
          };
        }
      }

      if (spectralDoppler?.measurementKind !== SPECTRAL_DOPPLER_MEASUREMENT_KIND) {
        return measurement;
      }

      const displayText = buildSpectralDopplerDisplayText(spectralDoppler);

      return {
        ...measurement,
        measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
        spectralDoppler,
        displayText,
        measurements: {
          ...(measurement?.measurements || {}),
          measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
          spectralDoppler,
          displayText,
        },
      };
    }
  );

  return restoredMeasurements;
}

/** Guided RV/RA acquisition can precede the OHIF adapter's first entry.
 * Read only explicitly tagged native contours, as for LV/LA and Doppler. */
function getCornerstoneEchoAreaMeasurementFallback(stateAnnotation: any = {}) {
  const source = getQuizEchoAreaSourceMetadata(stateAnnotation.data);
  if (!source.measurementKind) return null;
  const metadata = stateAnnotation.metadata || {};
  const points = stateAnnotation.data?.contour?.polyline;
  const image = String(metadata.referencedImageId || '');
  const id = getMeasurementAnnotationId(stateAnnotation);
  if (!id || id.startsWith('ar-viewer-quiz-') ||
      metadata.arMeasurementWorkflow === 'viewerQuizGoldDisplay' ||
      !image || !Array.isArray(points) || points.length < 3 ||
      !['SplineROI', 'PlanarFreehandROI', 'LivewireContour'].includes(metadata.toolName)) return null;
  const parsed = parseDicomWebIdsFromReferencedImageId(image);
  if (metadata.SOPInstanceUID && parsed.sopInstanceId &&
      String(metadata.SOPInstanceUID) !== parsed.sopInstanceId) return null;
  return {
    uid: id, annotationUID: id, metadata, ...source,
    toolName: metadata.toolName, label: stateAnnotation.data.label || '',
    referenceStudyUID: metadata.StudyInstanceUID || parsed.studyInstanceId || '',
    referenceSeriesUID: metadata.SeriesInstanceUID || parsed.seriesInstanceId || '',
    SOPInstanceUID: metadata.SOPInstanceUID || parsed.sopInstanceId || '',
    FrameOfReferenceUID: metadata.FrameOfReferenceUID || '',
    referencedImageId: image, frameNumber: parsed.frameNumber || getFrameNumberFromReferencedImageId(image),
    points, data: stateAnnotation.data.cachedStats || {},
    isLocked: !!stateAnnotation.isLocked, isVisible: stateAnnotation.isVisible !== false,
    arMeasurementReadOnly: !!metadata.arMeasurementReadOnly || !!stateAnnotation.data.arMeasurementReadOnly,
  };
}

function getAllCornerstoneViewerAnnotations() {
  let stateAnnotations: any[] = [];
  const annotationState: any = cornerstoneTools.annotation.state;

  try {
    const directAnnotations = annotationState.getAllAnnotations?.();
    if (Array.isArray(directAnnotations)) {
      stateAnnotations = directAnnotations;
    }
  } catch {}

  if (!stateAnnotations.length) {
    try {
      const annotationManager = annotationState.getAnnotationManager?.();
      const managedAnnotations = annotationManager?.getAllAnnotations?.();
      if (Array.isArray(managedAnnotations)) {
        stateAnnotations = managedAnnotations;
      }
    } catch {}
  }

  return stateAnnotations;
}

function parseDicomWebIdsFromReferencedImageId(referencedImageId = '') {
  const match = String(referencedImageId || '').match(
    /\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)(?:\/frames\/(\d+))?/i
  );

  if (!match) {
    return {
      studyInstanceId: '',
      seriesInstanceId: '',
      sopInstanceId: '',
      frameNumber: 1,
    };
  }

  const frameNumber = Number(match[4]);

  return {
    studyInstanceId: decodeURIComponent(match[1]),
    seriesInstanceId: decodeURIComponent(match[2]),
    sopInstanceId: decodeURIComponent(match[3]),
    frameNumber: Number.isFinite(frameNumber) && frameNumber > 0 ? frameNumber : 1,
  };
}

function getUltrasoundDirectionalStatsFromAnnotationData(data: any = {}) {
  const cachedStats = data?.cachedStats || {};

  return (
    Object.values(cachedStats).find((stats: any) => {
      return Array.isArray(stats?.xValues) && Array.isArray(stats?.yValues);
    }) || null
  ) as any;
}

function getUltrasoundDirectionalDistance(stats: any = {}) {
  const xValues = Array.isArray(stats?.xValues) ? stats.xValues.map(Number) : [];
  const yValues = Array.isArray(stats?.yValues) ? stats.yValues.map(Number) : [];
  const units = Array.isArray(stats?.units) ? stats.units.map(value => String(value || '')) : [];
  const isUnitless = stats?.isUnitless === true;
  const isHorizontal = stats?.isHorizontal === true;

  let value = null;
  let unit = '';

  if (isUnitless) {
    if (Number.isFinite(xValues[0]) && Number.isFinite(xValues[1])) {
      value = Math.abs(xValues[1] - xValues[0]);
    }
    unit = 'px';
  } else if (isHorizontal) {
    if (Number.isFinite(xValues[0]) && Number.isFinite(xValues[1])) {
      value = Math.abs(xValues[1] - xValues[0]);
    }
    unit = units[0] || '';
  } else {
    if (Number.isFinite(yValues[0]) && Number.isFinite(yValues[1])) {
      value = Math.abs(yValues[1] - yValues[0]);
    }
    unit = units[1] || units[0] || '';
  }

  if (!Number.isFinite(value)) {
    return {
      value: null,
      unit,
      isUnitless,
      isHorizontal,
    };
  }

  if (isUnitless) {
    return {
      value,
      unit: 'px',
      isUnitless,
      isHorizontal,
    };
  }

  const normalized = normalizeLengthValueAndUnit(value, unit);

  return {
    value: normalized.value,
    unit: normalized.unit,
    isUnitless,
    isHorizontal,
  };
}

function buildUltrasoundDirectionalDisplayText(stats: any = {}) {
  const distance = getUltrasoundDirectionalDistance(stats);

  if (!Number.isFinite(Number(distance.value))) {
    return [];
  }

  const value = Number(distance.value);
  const formattedValue = distance.unit === 'px' ? csUtils.roundNumber(value) : formatLengthMM(value);

  return [`${formattedValue} ${distance.unit || ''}`.trim()];
}

function getCornerstoneUltrasoundDirectionalMeasurementFallback(stateAnnotation: any = {}) {
  // AR_DECELERATION_TIME:fallback
  const measurementId = getMeasurementAnnotationId(stateAnnotation);
  const metadata = stateAnnotation?.metadata || {};
  const data = stateAnnotation?.data || {};
  const toolName = String(metadata.toolName || stateAnnotation?.toolName || '').trim();
  const points = Array.isArray(data?.handles?.points) ? data.handles.points : [];
  const stats = getUltrasoundDirectionalStatsFromAnnotationData(data);

  if (!measurementId || toolName !== ULTRASOUND_DIRECTIONAL_TOOL_NAME || points.length !== 2 || !stats) {
    return null;
  }

  const referencedImageId = String(metadata.referencedImageId || '').trim();
  const parsedIds = parseDicomWebIdsFromReferencedImageId(referencedImageId);
  const distance = getUltrasoundDirectionalDistance(stats);
  const storedDirectional =
    data?.ultrasoundDirectional && typeof data.ultrasoundDirectional === 'object'
      ? data.ultrasoundDirectional
      : {};
  const storedReportMapping =
    data?.reportMapping || stateAnnotation?.reportMapping || storedDirectional?.reportMapping || null;
  const decelerationTarget = normalizeDecelerationTimeTargetSelection(data.arDecelerationTimeTarget);
  const decelerationTime = decelerationTarget
    ? calculateDecelerationTimeFromDirectionalStats({ stats, target: decelerationTarget })
    : null;
  const decelerationReportMapping =
    data.arDecelerationTimeReportMapping ||
    (decelerationTarget?.reportTargetKey
      ? buildViewerReportMapping({ key: decelerationTarget.reportTargetKey, label: decelerationTarget.label })
      : null);
  const reportMapping = decelerationReportMapping || storedReportMapping;
  const label = String(
    decelerationTarget?.label || data.label || 'Ultrasound Directional'
  ).trim();
  const measurementKind = decelerationTarget
    ? DECELERATION_TIME_MEASUREMENT_KIND
    : ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND;
  const displayText = decelerationTarget
    ? buildDecelerationTimeDisplayText(decelerationTime)
    : buildUltrasoundDirectionalDisplayText(stats);

  return {
    uid: measurementId,
    annotationUID: measurementId,
    toolName: ULTRASOUND_DIRECTIONAL_TOOL_NAME,
    measurementKind,
    label,
    measurementRole: label,
    role: label,
    ...(reportMapping ? { reportMapping } : {}),
    ...(decelerationTime
      ? { decelerationTime: { ...decelerationTime, ...(decelerationReportMapping ? { reportMapping: decelerationReportMapping } : {}) } }
      : {}),
    ultrasoundDirectional: {
      ...storedDirectional,
      xValues: Array.isArray(stats.xValues) ? [...stats.xValues] : [],
      yValues: Array.isArray(stats.yValues) ? [...stats.yValues] : [],
      units: Array.isArray(stats.units) ? [...stats.units] : [],
      isHorizontal: stats.isHorizontal === true,
      isUnitless: stats.isUnitless === true,
      value: distance.value,
      unit: distance.unit,
      measurementKind: ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND,
    },
    referenceStudyUID: metadata.StudyInstanceUID || parsedIds.studyInstanceId || '',
    referenceSeriesUID: metadata.SeriesInstanceUID || parsedIds.seriesInstanceId || '',
    SOPInstanceUID: metadata.SOPInstanceUID || parsedIds.sopInstanceId || '',
    FrameOfReferenceUID: metadata.FrameOfReferenceUID || '',
    displaySetInstanceUID: metadata.displaySetInstanceUID || '',
    referencedImageId,
    frameNumber: parsedIds.frameNumber || getFrameNumberFromReferencedImageId(referencedImageId),
    points: points.map(point => (Array.isArray(point) ? [...point] : point)),
    viewPlaneNormal: cloneViewerMeasurementMetadataVector(metadata.viewPlaneNormal),
    viewUp: cloneViewerMeasurementMetadataVector(metadata.viewUp),
    data: data.cachedStats || {},
    value: decelerationTime?.status === 'complete' ? decelerationTime.valueMS : distance.value,
    unit: decelerationTime?.status === 'complete' ? 'ms' : distance.unit,
    displayText,
  };
}

function getCornerstoneUltrasoundDirectionalMeasurementFallbacks({
  studyInstanceUID = '',
  excludedMeasurementIds = new Set<string>(),
}: {
  studyInstanceUID?: string;
  excludedMeasurementIds?: Set<string>;
} = {}) {
  const expectedStudyInstanceUID = String(studyInstanceUID || '').trim();

  return getAllCornerstoneViewerAnnotations()
    .map(getCornerstoneUltrasoundDirectionalMeasurementFallback)
    .filter(Boolean)
    .filter((measurement: any) => {
      const measurementId = getMeasurementAnnotationId(measurement);
      const measurementStudyInstanceUID = String(measurement?.referenceStudyUID || '').trim();

      if (!measurementId || excludedMeasurementIds.has(measurementId)) {
        return false;
      }

      return !(
        expectedStudyInstanceUID &&
        measurementStudyInstanceUID &&
        measurementStudyInstanceUID !== expectedStudyInstanceUID
      );
    });
}

function getCornerstoneBowelCurvedLengthMeasurementFallback(stateAnnotation: any = {}) {
  const measurementId = getMeasurementAnnotationId(stateAnnotation);
  const metadata = stateAnnotation?.metadata || {};
  const data = stateAnnotation?.data || {};
  const toolName = String(metadata.toolName || stateAnnotation?.toolName || '').trim();
  const measurementKind = String(
    data.measurementKind || metadata.measurementKind || stateAnnotation?.measurementKind || ''
  ).trim();
  const reportMapping =
    data.reportMapping || metadata.reportMapping || stateAnnotation?.reportMapping || null;
  const points = Array.isArray(data?.contour?.polyline) ? data.contour.polyline : [];

  if (
    !measurementId ||
    toolName !== (toolNames.PlanarFreehandROI || 'PlanarFreehandROI') ||
    measurementKind !== BOWEL_CURVED_LENGTH_MEASUREMENT_KIND ||
    data?.contour?.closed === true ||
    points.length < 2
  ) {
    return null;
  }

  const referencedImageId = String(metadata.referencedImageId || '').trim();
  const parsedIds = parseDicomWebIdsFromReferencedImageId(referencedImageId);
  const label = String(data.label || '').trim();

  return {
    uid: measurementId,
    annotationUID: measurementId,
    toolName,
    measurementKind: BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
    contourClosed: false,
    label,
    measurementRole: label,
    role: label,
    ...(reportMapping ? { reportMapping } : {}),
    referenceStudyUID: metadata.StudyInstanceUID || parsedIds.studyInstanceId || '',
    referenceSeriesUID: metadata.SeriesInstanceUID || parsedIds.seriesInstanceId || '',
    SOPInstanceUID: metadata.SOPInstanceUID || parsedIds.sopInstanceId || '',
    FrameOfReferenceUID: metadata.FrameOfReferenceUID || '',
    displaySetInstanceUID: metadata.displaySetInstanceUID || '',
    referencedImageId,
    frameNumber: parsedIds.frameNumber || getFrameNumberFromReferencedImageId(referencedImageId),
    points: points.map(point => (Array.isArray(point) ? [...point] : point)),
    viewPlaneNormal: cloneViewerMeasurementMetadataVector(metadata.viewPlaneNormal),
    viewUp: cloneViewerMeasurementMetadataVector(metadata.viewUp),
    data: data.cachedStats || {},
    displayText: Array.isArray(data.arSavedMeasurementDisplayText)
      ? [...data.arSavedMeasurementDisplayText]
      : [],
  };
}

function getCornerstoneBowelCurvedLengthMeasurementFallbacks({
  studyInstanceUID = '',
  excludedMeasurementIds = new Set<string>(),
}: {
  studyInstanceUID?: string;
  excludedMeasurementIds?: Set<string>;
} = {}) {
  const expectedStudyInstanceUID = String(studyInstanceUID || '').trim();

  return getAllCornerstoneViewerAnnotations()
    .map(getCornerstoneBowelCurvedLengthMeasurementFallback)
    .filter(Boolean)
    .filter((measurement: any) => {
      const measurementId = getMeasurementAnnotationId(measurement);
      const measurementStudyInstanceUID = String(measurement?.referenceStudyUID || '').trim();

      if (!measurementId || excludedMeasurementIds.has(measurementId)) {
        return false;
      }

      return !(
        expectedStudyInstanceUID &&
        measurementStudyInstanceUID &&
        measurementStudyInstanceUID !== expectedStudyInstanceUID
      );
    });
}

function getCornerstoneVolumeMeasurementFallback(annotationId = '') {
  const measurementId = String(annotationId || '').trim();

  if (!measurementId) {
    return null;
  }

  const stateAnnotation = cornerstoneTools.annotation.state.getAnnotation?.(measurementId);

  if (!stateAnnotation) {
    return null;
  }

  const metadata = stateAnnotation.metadata || {};
  const data = stateAnnotation.data || {};
  const lvSimpson = data.lvSimpson || null;
  const laVolume = data.laVolume || null;

  if (!lvSimpson && !laVolume) {
    return null;
  }

  const geometry = lvSimpson || laVolume || {};
  const geometryContourPoints = Array.isArray(geometry?.contourPoints)
    ? geometry.contourPoints
    : Array.isArray(geometry?.points)
      ? geometry.points
      : [];
  const handlePoints = Array.isArray(data?.handles?.points) ? data.handles.points : [];
  const renderedPolyline = Array.isArray(data?.contour?.polyline) ? data.contour.polyline : [];
  const contourPoints = compactViewerVolumeFallbackPoints(
    geometryContourPoints.length
      ? geometryContourPoints
      : handlePoints.length
        ? handlePoints
        : renderedPolyline
  );
  const label = String(data.label || geometry.label || '').trim();
  const referencedImageId = String(metadata.referencedImageId || '').trim();
  const measurementKind = lvSimpson
    ? LV_SIMPSON_MEASUREMENT_KIND
    : LA_VOLUME_MEASUREMENT_KIND;

  return {
    uid: measurementId,
    annotationUID: measurementId,
    toolName: metadata.toolName || stateAnnotation.toolName || 'SplineROI',
    label,
    measurementRole: label,
    role: geometry.slot || '',
    slot: geometry.slot || '',
    view: geometry.view || '',
    phase: geometry.phase || '',
    measurementKind,
    ...(lvSimpson ? { lvSimpson } : {}),
    ...(laVolume ? { laVolume } : {}),
    referenceStudyUID: metadata.StudyInstanceUID || '',
    referenceSeriesUID: metadata.SeriesInstanceUID || '',
    SOPInstanceUID: metadata.SOPInstanceUID || '',
    FrameOfReferenceUID: metadata.FrameOfReferenceUID || '',
    displaySetInstanceUID: metadata.displaySetInstanceUID || '',
    referencedImageId,
    frameNumber: getFrameNumberFromReferencedImageId(referencedImageId),
    points: contourPoints,
    data: data.cachedStats || {},
    displayText: [],
  };
}

function getCornerstoneVolumeMeasurementFallbacks({
  studyInstanceUID = '',
  excludedMeasurementIds = new Set<string>(),
}: {
  studyInstanceUID?: string;
  excludedMeasurementIds?: Set<string>;
} = {}) {
  const stateAnnotations = getAllCornerstoneViewerAnnotations();
  const expectedStudyInstanceUID = String(studyInstanceUID || '').trim();

  return stateAnnotations
    .filter(stateAnnotation => {
      const measurementId = getMeasurementAnnotationId(stateAnnotation);
      const metadata = stateAnnotation?.metadata || {};
      const data = stateAnnotation?.data || {};
      const stateStudyInstanceUID = String(metadata.StudyInstanceUID || '').trim();

      if (!measurementId || excludedMeasurementIds.has(measurementId)) {
        return false;
      }

      if (!data.lvSimpson && !data.laVolume) {
        return false;
      }

      if (
        expectedStudyInstanceUID &&
        stateStudyInstanceUID &&
        stateStudyInstanceUID !== expectedStudyInstanceUID
      ) {
        return false;
      }

      return true;
    })
    .map(stateAnnotation =>
      getCornerstoneVolumeMeasurementFallback(getMeasurementAnnotationId(stateAnnotation))
    )
    .filter(Boolean);
}

function isViewerContourTool(toolName) {
  return VIEWER_CONTOUR_TOOL_NAMES.has(toolName);
}

function isUltrasoundDirectionalViewerMeasurement(measurement: any = {}) {
  return (
    String(measurement?.toolName || '').trim() === ULTRASOUND_DIRECTIONAL_TOOL_NAME ||
    measurement?.measurementKind === ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND ||
    measurement?.ultrasoundDirectional?.measurementKind ===
      ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND ||
    measurement?.measurements?.ultrasoundDirectional?.measurementKind ===
      ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND
  );
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
  const viewerRouteDomain = getViewerQuizRouteMeasurementDomain(path);
  if (viewerRouteDomain) return viewerRouteDomain;

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

const ECHO_LENGTH_MEASUREMENT_LABELS_CONFIG = Object.freeze({
  id: 'echoLengthMeasurementLabels',
  domain: 'echo',
  dialogTitle: 'Echo Annotation',
  annotationTitle: 'Echo Annotation',
  labelOnMeasure: true,
  exclusive: true,
  items: [
    { value: 'LVIDd', label: 'LVIDd' },
    { value: 'LVIDs', label: 'LVIDs' },
    { value: 'IVSd', label: 'IVSd' },
    { value: 'PWd', label: 'PWd' },
    { value: 'AO', label: 'Aortic root' },
    { value: 'AscAo', label: 'Ascending aorta' },
    { value: 'LVOTDiam', label: 'LVOT diameter' },
    { value: 'LAd', label: 'Left atrial dimension' },
    { value: 'RVIDd', label: 'RVIDd' },
    { value: 'TAPSE', label: 'TAPSE' },
    { value: 'IVCexp', label: 'IVC expiration (IVCexp)' },
    { value: 'IVCinsp', label: 'IVC inspiration (IVCinsp)' },
  ],
});

const BOWEL_LENGTH_MEASUREMENT_LABELS_CONFIG = Object.freeze({
  id: 'bowelLengthMeasurementLabels',
  domain: 'bowel',
  dialogTitle: 'Bowel Annotation',
  annotationTitle: 'Bowel Annotation',
  labelOnMeasure: true,
  exclusive: true,
  items: [
    { value: 'BowelRectumBWT', label: 'Rectum BWT' },
    { value: 'BowelSigmoidColonBWT', label: 'Sigmoid colon BWT' },
    { value: 'BowelDescendingColonBWT', label: 'Descending colon BWT' },
    { value: 'BowelTransverseColonBWT', label: 'Transverse colon BWT' },
    { value: 'BowelAscendingColonBWT', label: 'Ascending colon BWT' },
    { value: 'BowelCecumBWT', label: 'Cecum BWT' },
    { value: 'BowelTerminalIleumBWT', label: 'Terminal ileum BWT' },
    { value: 'BowelIleocolicAnastomosisBWT', label: 'Ileocolic anastomosis BWT' },
    { value: 'BowelNeoTerminalIleumBWT', label: 'Neo-terminal ileum BWT' },
  ],
});

function getLengthMeasurementLabelConfigForDomain(domain = '') {
  const normalizedDomain = normalizeViewerMeasurementDomain(domain);

  if (normalizedDomain === 'echo') {
    return ECHO_LENGTH_MEASUREMENT_LABELS_CONFIG;
  }

  if (normalizedDomain === 'bowel') {
    return BOWEL_LENGTH_MEASUREMENT_LABELS_CONFIG;
  }

  return null;
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

function getViewerAnnotationViewportReference(viewport, points = []) {
  if (!viewport?.getViewReference) {
    return {};
  }

  const firstPoint = Array.isArray(points) && points.length > 0 ? points[0] : null;

  try {
    const reference = firstPoint
      ? viewport.getViewReference({ points: [firstPoint] })
      : viewport.getViewReference();

    return reference && typeof reference === 'object' && !Array.isArray(reference)
      ? reference
      : {};
  } catch {
    try {
      const reference = viewport.getViewReference();
      return reference && typeof reference === 'object' && !Array.isArray(reference)
        ? reference
        : {};
    } catch {
      return {};
    }
  }
}

function buildSavedUltrasoundDirectionalCachedStats(savedAnnotation: any = {}, referencedImageId = '') {
  const targetId = referencedImageId ? `imageId:${referencedImageId}` : '';
  const directional = getUltrasoundDirectionalGeometry(savedAnnotation, savedAnnotation) || {};
  const xValues = Array.isArray(directional.xValues) ? [...directional.xValues] : [];
  const yValues = Array.isArray(directional.yValues) ? [...directional.yValues] : [];
  const units = Array.isArray(directional.units) ? [...directional.units] : [];

  if (!targetId || xValues.length < 2 || yValues.length < 2) {
    return {};
  }

  return {
    [targetId]: {
      xValues,
      yValues,
      units,
      isHorizontal: directional.isHorizontal === true,
      isUnitless: directional.isUnitless === true,
    },
  };
}

function getViewerAnnotationGroupKeyForViewport(viewport) {
  const element = viewport?.element;

  try {
    const annotationManager = annotation.state.getAnnotationManager?.();

    if (element && annotationManager?.getGroupKey) {
      return annotationManager.getGroupKey(element);
    }
  } catch {}

  try {
    return viewport?.getFrameOfReferenceUID?.();
  } catch {}

  return undefined;
}

function hydrateSavedUltrasoundDirectionalForViewport({
  savedAnnotation,
  viewport,
  viewportId = '',
  referencedImageIdOverride = '',
  fallbackFrameOfReferenceUID = '',
  selectAnnotation = true,
}: {
  savedAnnotation: any;
  viewport?: any;
  viewportId?: string;
  referencedImageIdOverride?: string;
  fallbackFrameOfReferenceUID?: string;
  selectAnnotation?: boolean;
}) {
  const annotationId = getAnnotationId(savedAnnotation);
  const points = cloneSavedAnnotationPoints(savedAnnotation?.points);
  const referencedImageId = String(
    referencedImageIdOverride || savedAnnotation?.referencedImageId || ''
  ).trim();

  if (!annotationId || !viewport || !referencedImageId || points.length !== 2) {
    return null;
  }

  const workflow = String(savedAnnotation?.workflow || '').trim();
  const domain = normalizeViewerMeasurementDomain(savedAnnotation?.domain || '');
  const readOnly = !!savedAnnotation?.isLocked;
  const reviewRound = Number(savedAnnotation?.reviewRound) || null;
  const viewportReference = getViewerAnnotationViewportReference(viewport, points);
  const camera = viewport?.getCamera?.() || {};
  const cachedStats = buildSavedUltrasoundDirectionalCachedStats(
    savedAnnotation,
    referencedImageId
  );
  // AR_DECELERATION_TIME:BEGIN hydration
  const savedDecelerationTime = getDecelerationTimeGeometry(savedAnnotation, savedAnnotation);
  const decelerationTarget = isDecelerationTimeViewerMeasurement(savedAnnotation, savedAnnotation)
    ? normalizeDecelerationTimeTargetSelection(
        savedDecelerationTime?.target || savedAnnotation?.label || savedAnnotation?.measurementRole
      )
    : null;
  if (decelerationTarget) {
    installDecelerationTimeTextOverrideForViewport({ viewport, viewportId });
  }
  // AR_DECELERATION_TIME:END hydration
  const baseData: any = {
    annotationUID: annotationId,
    highlighted: false,
    invalidated: false,
    isLocked: readOnly,
    isVisible: savedAnnotation?.isVisible !== false,
    data: {
      label: getSavedAnnotationViewportLabel(savedAnnotation) || 'Ultrasound Directional',
      ...(savedAnnotation?.ultrasoundDirectional
        ? { ultrasoundDirectional: { ...savedAnnotation.ultrasoundDirectional } }
        : {}),
      ...(savedAnnotation?.reportMapping ? { reportMapping: { ...savedAnnotation.reportMapping } } : {}),
      handles: {
        points,
        activeHandleIndex: null,
        textBox: {
          hasMoved: false,
          worldPosition: points[0] || [0, 0, 0],
          worldBoundingBox: null,
        },
      },
      cachedStats,
      arMeasurementWorkflow: workflow,
      arMeasurementReadOnly: readOnly,
      arMeasurementReviewRound: reviewRound,
      arMeasurementDomain: domain,
      ...(decelerationTarget
        ? {
            arDecelerationTimeTarget: decelerationTarget,
            arDecelerationTimeReportMapping:
              savedAnnotation?.reportMapping || savedDecelerationTime?.reportMapping || null,
            arSavedMeasurementDisplayText:
              savedAnnotation?.displayText || buildDecelerationTimeDisplayText(savedDecelerationTime),
          }
        : {}), // AR_DECELERATION_TIME
    },
  };

  let cornerstoneAnnotation: any = null;

  try {
    const ToolClass: any = (cornerstoneTools as any).UltrasoundDirectionalTool;

    if (typeof ToolClass?.createAnnotationForViewport === 'function') {
      cornerstoneAnnotation = ToolClass.createAnnotationForViewport(viewport, baseData);
    }
  } catch (error) {
    console.warn(
      '[MeasurementAnnotations] UltrasoundDirectionalTool viewport factory failed; using viewport reference fallback',
      error
    );
  }

  if (!cornerstoneAnnotation) {
    cornerstoneAnnotation = {
      ...baseData,
      metadata: {
        ...viewportReference,
        toolName: ULTRASOUND_DIRECTIONAL_TOOL_NAME,
      },
    };
  }

  const factoryMetadata = cornerstoneAnnotation.metadata || {};
  const viewPlaneNormal =
    cloneViewerMeasurementMetadataVector(factoryMetadata.viewPlaneNormal) ||
    cloneViewerMeasurementMetadataVector(camera.viewPlaneNormal) ||
    cloneViewerMeasurementMetadataVector(viewportReference?.viewPlaneNormal) ||
    getViewerMeasurementMetadataVector(savedAnnotation, savedAnnotation, 'viewPlaneNormal');
  const viewUp =
    cloneViewerMeasurementMetadataVector(factoryMetadata.viewUp) ||
    cloneViewerMeasurementMetadataVector(camera.viewUp) ||
    cloneViewerMeasurementMetadataVector(viewportReference?.viewUp) ||
    getViewerMeasurementMetadataVector(savedAnnotation, savedAnnotation, 'viewUp');

  let enabledElementFrameOfReferenceUID;
  try {
    enabledElementFrameOfReferenceUID = getEnabledElement(viewport.element)?.FrameOfReferenceUID;
  } catch {}

  const directionalFrameOfReferenceUID = [
    factoryMetadata.FrameOfReferenceUID,
    viewportReference?.FrameOfReferenceUID,
    enabledElementFrameOfReferenceUID,
    viewport?.getFrameOfReferenceUID?.(),
    fallbackFrameOfReferenceUID,
    savedAnnotation?.FrameOfReferenceUID,
  ].find(value => value != null && (typeof value !== 'string' || value.trim() !== ''));

  cornerstoneAnnotation.annotationUID = annotationId;
  cornerstoneAnnotation.metadata = {
    ...viewportReference,
    ...factoryMetadata,
    toolName: ULTRASOUND_DIRECTIONAL_TOOL_NAME,
    referencedImageId,
    FrameOfReferenceUID: directionalFrameOfReferenceUID,
    SOPInstanceUID: savedAnnotation?.SOPInstanceUID || '',
    SeriesInstanceUID:
      savedAnnotation?.SeriesInstanceUID || savedAnnotation?.referenceSeriesUID || '',
    StudyInstanceUID:
      savedAnnotation?.StudyInstanceUID || savedAnnotation?.referenceStudyUID || '',
    ...(viewPlaneNormal ? { viewPlaneNormal } : {}),
    ...(viewUp ? { viewUp } : {}),
    arMeasurementWorkflow: workflow,
    arMeasurementReadOnly: readOnly,
    arMeasurementReviewRound: reviewRound,
    arMeasurementDomain: domain,
  };
  cornerstoneAnnotation.data = {
    ...(cornerstoneAnnotation.data || {}),
    ...baseData.data,
  };
  cornerstoneAnnotation.highlighted = false;
  cornerstoneAnnotation.invalidated = false;
  cornerstoneAnnotation.isLocked = readOnly;
  cornerstoneAnnotation.isVisible = savedAnnotation?.isVisible !== false;

  const annotationGroupKey = getViewerAnnotationGroupKeyForViewport(viewport);
  const annotationGroupSelector =
    viewport?.element ||
    annotationGroupKey ||
    cornerstoneAnnotation.metadata?.FrameOfReferenceUID ||
    viewportId ||
    referencedImageId;

  annotation.state.removeAnnotation?.(annotationId);
  annotation.state.addAnnotation(cornerstoneAnnotation, annotationGroupSelector);

  const storedAnnotation = annotation.state.getAnnotation?.(annotationId) || cornerstoneAnnotation;

  try {
    annotation.visibility?.setAnnotationVisibility?.(annotationId, true);
  } catch {}

  applyReviewMeasurementAnnotationStyle({
    annotationUID: annotationId,
    workflow,
    measurementOwner: savedAnnotation?.measurementOwner,
  });

  if (selectAnnotation) {
    annotation.selection.setAnnotationSelected?.(annotationId, true);
  }

  let groupedAnnotations: any[] = [];
  let referenceViewable = null;

  try {
    groupedAnnotations =
      annotation.state.getAnnotations?.(ULTRASOUND_DIRECTIONAL_TOOL_NAME, viewport.element) || [];
  } catch {}

  try {
    referenceViewable = viewport.isReferenceViewable?.(storedAnnotation.metadata, {});
  } catch {}

  console.info('[Ultrasound Directional] saved viewport hydration', {
    annotationId,
    stateHit: !!annotation.state.getAnnotation?.(annotationId),
    groupHit: groupedAnnotations.some(candidate => getAnnotationId(candidate) === annotationId),
    groupedCount: groupedAnnotations.length,
    annotationGroupKey,
    enabledElementFrameOfReferenceUID,
    storedFrameOfReferenceUID: storedAnnotation?.metadata?.FrameOfReferenceUID,
    referenceViewable,
    pointCount: storedAnnotation?.data?.handles?.points?.length || 0,
    referencedImageId: storedAnnotation?.metadata?.referencedImageId || '',
    currentImageId: viewport?.getCurrentImageId?.() || '',
  });

  return storedAnnotation;
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
    arMeasurementDomain: normalizeViewerMeasurementDomain(savedAnnotation.domain || ''),
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
    arMeasurementDomain: normalizeViewerMeasurementDomain(savedAnnotation.domain || ''),
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

function getViewerAnnotationKind(measurement, existingAnnotation = null) {
  return String(
    measurement?.annotationKind ||
      measurement?.measurements?.annotationKind ||
      existingAnnotation?.annotationKind ||
      existingAnnotation?.measurements?.annotationKind ||
      ''
  ).trim();
}

function getViewerCommentScope(measurement, existingAnnotation = null) {
  return String(
    measurement?.commentScope ||
      measurement?.measurements?.commentScope ||
      existingAnnotation?.commentScope ||
      existingAnnotation?.measurements?.commentScope ||
      ''
  ).trim();
}

function isCineCommentViewerMeasurement(measurement, existingAnnotation = null) {
  return (
    measurement?.toolName === 'ArrowAnnotate' &&
    getViewerAnnotationKind(measurement, existingAnnotation) === CINE_COMMENT_ANNOTATION_KIND
  );
}

function getArrowAnnotateMeasurementPayload(measurement, existingAnnotation = null) {
  const text = getArrowAnnotateText(measurement, existingAnnotation);
  const annotationKind = getViewerAnnotationKind(measurement, existingAnnotation);
  const commentScope = getViewerCommentScope(measurement, existingAnnotation);

  return {
    text,
    displayText: text ? [text] : [],
    ...(annotationKind ? { annotationKind } : {}),
    ...(commentScope ? { commentScope } : {}),
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
  const identifier = getMeasurementAnnotationId(measurement);
  // Temporary gold/comparison overlays must never enter Series annotations,
  // even if a later save captures a Cornerstone/MeasurementService snapshot.
  if (identifier.startsWith('ar-viewer-quiz-') ||
      measurement?.workflow === 'viewerQuizGoldDisplay' ||
      measurement?.metadata?.arMeasurementWorkflow === 'viewerQuizGoldDisplay') {
    return false;
  }
  return !!(
    measurement?.toolName === 'Length' ||
    isUltrasoundDirectionalViewerMeasurement(measurement) ||
    hasViewerMeasurementSemanticLabel(measurement)
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

  const persistedGeometry = stripPersistedViewerVolumeGeometryPoints(updatedGeometry);

  return {
    measurementKind: LV_SIMPSON_MEASUREMENT_KIND,
    lvSimpson: {
      ...persistedGeometry,
      apexPoint: persistedGeometry.apexPoint || persistedGeometry.axisPoint,
      axisPoint: persistedGeometry.axisPoint || persistedGeometry.apexPoint,
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

function stripPersistedViewerVolumeGeometryPoints(geometry: any = {}) {
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
    return geometry;
  }

  const metadata = { ...geometry };
  delete metadata.contourPoints;
  delete metadata.points;
  return metadata;
}

function getPersistedViewerVolumePoints(annotation: any = {}, geometry: any = {}) {
  const directPoints = Array.isArray(annotation?.points) ? annotation.points : [];

  if (directPoints.length >= 6) {
    return directPoints;
  }

  const geometryPoints = Array.isArray(geometry?.contourPoints)
    ? geometry.contourPoints
    : Array.isArray(geometry?.points)
      ? geometry.points
      : [];

  return geometryPoints;
}

function compactClinicalViewerVolumeAnnotationStorage(annotation: any = {}) {
  const lvSimpson = getLVSimpsonGeometry(annotation, annotation);
  const laVolume = getLAVolumeGeometry(annotation, annotation);

  if (!lvSimpson && !laVolume) {
    return annotation;
  }

  const volumeGeometry = lvSimpson || laVolume || {};
  const persistedPoints = getPersistedViewerVolumePoints(annotation, volumeGeometry);
  const measurements = { ...(annotation?.measurements || {}) };
  const geometryContainer =
    annotation?.geometry && typeof annotation.geometry === 'object' && !Array.isArray(annotation.geometry)
      ? { ...annotation.geometry }
      : null;

  // The top-level points array is the single persisted contour source of truth.
  // Hydration and FormAPI report derivation both read it first. Keep every point
  // exactly as captured; remove only redundant copies from volume metadata.
  delete measurements.lvSimpson;
  delete measurements.laVolume;

  if (geometryContainer) {
    delete geometryContainer.lvSimpson;
    delete geometryContainer.laVolume;
  }

  const compactAnnotation: any = {
    ...annotation,
    ...(persistedPoints.length ? { points: persistedPoints } : {}),
    measurements,
    ...(geometryContainer ? { geometry: geometryContainer } : {}),
  };

  if (lvSimpson) {
    compactAnnotation.lvSimpson = stripPersistedViewerVolumeGeometryPoints(lvSimpson);
    delete compactAnnotation.laVolume;
  } else {
    compactAnnotation.laVolume = stripPersistedViewerVolumeGeometryPoints(laVolume);
    delete compactAnnotation.lvSimpson;
  }

  return compactAnnotation;
}

function compactClinicalViewerMeasurementAnnotationsRaw(raw: any) {
  if (!raw) {
    return raw;
  }

  const returnAsString = typeof raw === 'string';
  let parsed = raw;

  if (returnAsString) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return raw;
  }

  const workflow = parsed?.workflows?.[VIEWER_MEASUREMENTS_WORKFLOW];
  const annotations = Array.isArray(workflow?.annotations) ? workflow.annotations : null;

  if (!annotations) {
    return raw;
  }

  const compactAnnotations = annotations.map(compactClinicalViewerVolumeAnnotationStorage);
  const nextParsed = {
    ...parsed,
    workflows: {
      ...(parsed.workflows || {}),
      [VIEWER_MEASUREMENTS_WORKFLOW]: {
        ...workflow,
        annotations: compactAnnotations,
      },
    },
  };

  return returnAsString ? JSON.stringify(nextParsed) : nextParsed;
}

function getLAVolumeMeasurementPayload(measurement, existingAnnotation = null) {
  const liveLAVolume = getLAVolumeGeometry(measurement, null);
  const savedLAVolume = existingAnnotation
    ? getLAVolumeGeometry(existingAnnotation, null)
    : null;
  const laVolume = savedLAVolume || liveLAVolume;

  if (!laVolume) {
    return {};
  }

  const contourPoints = Array.isArray(measurement?.points) ? measurement.points : [];

  // SplineROI is a closed contour. Its first and last sampled points can be the
  // same point and its resampling can move indices, so the contour must never
  // redefine the user-confirmed annular endpoints or superior long-axis point.
  // For an existing slot, keep the exact saved guided geometry authoritative
  // and replace only the editable contour points. This matches the AR Measurements
  // panel, which displays live contour points against the saved LA axis geometry.
  // Live geometry remains the source for a newly-created slot with no saved copy.
  const updatedGeometry = {
    ...(liveLAVolume || {}),
    ...(savedLAVolume || {}),
    ...(contourPoints.length >= 3 ? { contourPoints } : {}),
  };

  const persistedGeometry = stripPersistedViewerVolumeGeometryPoints(updatedGeometry);

  return {
    measurementKind: LA_VOLUME_MEASUREMENT_KIND,
    laVolume: {
      ...persistedGeometry,
      superiorPoint: persistedGeometry.superiorPoint || persistedGeometry.axisPoint,
      axisPoint: persistedGeometry.axisPoint || persistedGeometry.superiorPoint,
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

function getUltrasoundDirectionalGeometry(measurement: any = {}, existingAnnotation: any = null) {
  return (
    measurement?.ultrasoundDirectional ||
    measurement?.measurements?.ultrasoundDirectional ||
    existingAnnotation?.ultrasoundDirectional ||
    existingAnnotation?.measurements?.ultrasoundDirectional ||
    null
  );
}

function getUltrasoundDirectionalMeasurementPayload(measurement, existingAnnotation = null) {
  const directional = getUltrasoundDirectionalGeometry(measurement, existingAnnotation);
  const stats = getUltrasoundDirectionalStatsFromAnnotationData({
    cachedStats: measurement?.data || measurement?.cachedStats || {},
  });
  const derivedDirectional = stats
    ? {
        xValues: Array.isArray(stats.xValues) ? [...stats.xValues] : [],
        yValues: Array.isArray(stats.yValues) ? [...stats.yValues] : [],
        units: Array.isArray(stats.units) ? [...stats.units] : [],
        isHorizontal: stats.isHorizontal === true,
        isUnitless: stats.isUnitless === true,
        ...getUltrasoundDirectionalDistance(stats),
      }
    : null;
  const nextDirectional = {
    ...(existingAnnotation?.ultrasoundDirectional || {}),
    ...(directional || {}),
    ...(derivedDirectional || {}),
    measurementKind: ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND,
  };
  const numericValue = Number(nextDirectional.value);
  const unit = String(nextDirectional.unit || '').trim();
  const displayText = Number.isFinite(numericValue)
    ? [
        `${
          unit === 'px' ? csUtils.roundNumber(numericValue) : formatLengthMM(numericValue)
        } ${unit}`.trim(),
      ]
    : measurement?.displayText || existingAnnotation?.displayText || [];

  return {
    measurementKind: ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND,
    ultrasoundDirectional: nextDirectional,
    ...(Number.isFinite(numericValue)
      ? {
          value: numericValue,
          length: numericValue,
          unit,
          lengthUnit: unit,
        }
      : {}),
    displayText,
  };
}


// AR_DECELERATION_TIME:BEGIN helpers
function getDecelerationTimeGeometry(measurement: any = {}, existingAnnotation: any = null) {
  return (
    measurement?.decelerationTime ||
    measurement?.measurements?.decelerationTime ||
    existingAnnotation?.decelerationTime ||
    existingAnnotation?.measurements?.decelerationTime ||
    null
  );
}

function isDecelerationTimeViewerMeasurement(measurement: any = {}, existingAnnotation: any = null) {
  const decelerationTime = getDecelerationTimeGeometry(measurement, existingAnnotation);
  return !!(
    measurement?.measurementKind === DECELERATION_TIME_MEASUREMENT_KIND ||
    measurement?.measurements?.measurementKind === DECELERATION_TIME_MEASUREMENT_KIND ||
    decelerationTime?.measurementKind === DECELERATION_TIME_MEASUREMENT_KIND ||
    existingAnnotation?.measurementKind === DECELERATION_TIME_MEASUREMENT_KIND
  );
}

function getDecelerationTimeMeasurementPayload(measurement: any = {}, existingAnnotation: any = null) {
  const existingDecelerationTime = getDecelerationTimeGeometry(measurement, existingAnnotation);
  const target = normalizeDecelerationTimeTargetSelection(
    existingDecelerationTime?.target ||
      measurement?.label ||
      measurement?.measurementRole ||
      existingAnnotation?.label ||
      existingAnnotation?.measurementRole
  );
  const directional = getUltrasoundDirectionalGeometry(measurement, existingAnnotation) || {};
  const calculated = calculateDecelerationTimeFromDirectionalStats({ stats: directional, target });
  const reportMapping =
    measurement?.reportMapping ||
    existingDecelerationTime?.reportMapping ||
    existingAnnotation?.reportMapping ||
    existingAnnotation?.decelerationTime?.reportMapping ||
    null;
  const decelerationTime = {
    ...existingDecelerationTime,
    ...calculated,
    ...(reportMapping ? { reportMapping } : {}),
  };

  return {
    measurementKind: DECELERATION_TIME_MEASUREMENT_KIND,
    ultrasoundDirectional: directional,
    decelerationTime,
    ...(decelerationTime.status === 'complete'
      ? { value: decelerationTime.valueMS, unit: 'ms' }
      : {}),
    displayText: buildDecelerationTimeDisplayText(decelerationTime),
  };
}
// AR_DECELERATION_TIME:END helpers

function isCornerstoneOwnedViewerMeasurement(measurement: any = {}) {
  return (
    isSpectralDopplerViewerMeasurement(measurement) ||
    isUltrasoundDirectionalViewerMeasurement(measurement) ||
    isBowelCurvedLengthViewerMeasurement(measurement)
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

function isBowelCurvedLengthViewerMeasurement(measurement: any = {}, existingAnnotation: any = null) {
  return (
    measurement?.measurementKind === BOWEL_CURVED_LENGTH_MEASUREMENT_KIND ||
    measurement?.measurements?.measurementKind === BOWEL_CURVED_LENGTH_MEASUREMENT_KIND ||
    existingAnnotation?.measurementKind === BOWEL_CURVED_LENGTH_MEASUREMENT_KIND ||
    existingAnnotation?.measurements?.measurementKind === BOWEL_CURVED_LENGTH_MEASUREMENT_KIND
  );
}

function getBowelCurvedLengthPhysicalStatsFromCachedStats(
  cachedStats: any = {},
  referencedImageId = ''
) {
  const stats = getMeasurementStats({
    data: cachedStats || {},
    referencedImageId,
  });
  const length = finiteNumberOrNull(stats?.length);
  const unit = String(stats?.lengthUnit || stats?.unit || '').trim();

  if (length == null || length <= 0 || !/^(mm|cm)\b/i.test(stripMeasurementSourceSuffix(unit))) {
    return null;
  }

  return { length, unit };
}

async function waitForBowelCurvedLengthPhysicalStats({
  annotation,
  referencedImageId = '',
  viewport,
}: {
  annotation: any;
  referencedImageId?: string;
  viewport?: any;
}) {
  const delays = [0, 20, 50, 100, 200, 350];

  for (const delayMs of delays) {
    if (delayMs > 0) {
      await new Promise(resolve => window.setTimeout(resolve, delayMs));
    }

    const physicalStats = getBowelCurvedLengthPhysicalStatsFromCachedStats(
      annotation?.data?.cachedStats || {},
      referencedImageId
    );

    if (physicalStats) {
      return physicalStats;
    }

    try {
      annotation.invalidated = true;
      viewport?.render?.();
    } catch {}
  }

  return null;
}

function getBowelCurvedLengthMeasurementPayload(measurement, existingAnnotation = null) {
  const stats = getMeasurementStats(measurement);
  const existingMeasurements = existingAnnotation?.measurements || {};
  const rawLength =
    finiteNumberOrNull(stats?.length) ??
    finiteNumberOrNull(measurement?.measurements?.length) ??
    finiteNumberOrNull(existingMeasurements.length);
  const rawUnit = String(
    stats?.lengthUnit ||
      stats?.unit ||
      measurement?.measurements?.lengthUnit ||
      measurement?.measurements?.unit ||
      existingMeasurements.lengthUnit ||
      existingMeasurements.unit ||
      ''
  ).trim();
  const sourceUnit = stripMeasurementSourceSuffix(rawUnit);
  let lengthMM = null;

  if (rawLength != null && rawLength > 0) {
    if (/^cm\b/i.test(sourceUnit)) {
      lengthMM = rawLength * 10;
    } else if (/^mm\b/i.test(sourceUnit)) {
      lengthMM = rawLength;
    }
  }

  const displayText =
    lengthMM != null
      ? [`${formatLengthMM(lengthMM)} mm`]
      : existingMeasurements.displayText || existingAnnotation?.displayText || [];

  return {
    measurementKind: BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
    contourClosed: false,
    ...(lengthMM != null
      ? {
          value: lengthMM,
          length: lengthMM,
          unit: 'mm',
          lengthUnit: 'mm',
        }
      : {}),
    displayText,
  };
}

function serializeViewerMeasurement(measurement, domain, existingAnnotation = null, options = {}) {
  const isArrowAnnotateMeasurement = measurement?.toolName === 'ArrowAnnotate';
  const arrowText = isArrowAnnotateMeasurement
    ? getArrowAnnotateText(measurement, existingAnnotation)
    : '';
  const annotationKind = isArrowAnnotateMeasurement
    ? getViewerAnnotationKind(measurement, existingAnnotation)
    : '';
  const commentScope = isArrowAnnotateMeasurement
    ? getViewerCommentScope(measurement, existingAnnotation)
    : '';
  const label = measurement?.label || arrowText || '';
  const isContourMeasurement = isViewerContourTool(measurement?.toolName);
  const lvTrace = domain === 'echo' && isContourMeasurement ? parseLVTraceLabel(label) : null;
  const lvSimpson = getLVSimpsonGeometry(measurement, existingAnnotation);
  const laVolume = getLAVolumeGeometry(measurement, existingAnnotation);
  const echoArea = measurement?.echoArea || measurement?.measurements?.echoArea || existingAnnotation?.echoArea || null;
  const echoAreaSlot = getEchoAreaSlot(measurement) || getEchoAreaSlot(existingAnnotation);
  const spectralDoppler = getSpectralDopplerGeometry(measurement, existingAnnotation);
  const decelerationTime = getDecelerationTimeGeometry(measurement, existingAnnotation); // AR_DECELERATION_TIME
  const ultrasoundDirectional = getUltrasoundDirectionalGeometry(measurement, existingAnnotation);
  const reportMapping =
    measurement?.reportMapping ||
    decelerationTime?.reportMapping || // AR_DECELERATION_TIME
    existingAnnotation?.decelerationTime?.reportMapping ||
    existingAnnotation?.measurements?.decelerationTime?.reportMapping ||
    spectralDoppler?.reportMapping ||
    ultrasoundDirectional?.reportMapping ||
    existingAnnotation?.reportMapping ||
    existingAnnotation?.spectralDoppler?.reportMapping ||
    existingAnnotation?.measurements?.spectralDoppler?.reportMapping ||
    existingAnnotation?.ultrasoundDirectional?.reportMapping ||
    existingAnnotation?.measurements?.ultrasoundDirectional?.reportMapping ||
    null;
  const isLVSimpson = domain === 'echo' && !!lvSimpson;
  const isLAVolume = domain === 'echo' && !!laVolume;
  const isEchoArea = domain === 'echo' && isContourMeasurement && !!echoAreaSlot && !!echoArea;
  const isSpectralDoppler =
    measurement?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND ||
    spectralDoppler?.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND;
  const isDecelerationTime =
    domain === 'echo' && isDecelerationTimeViewerMeasurement(measurement, existingAnnotation); // AR_DECELERATION_TIME
  const isBowelCurvedLength =
    ['bowel', 'iuscan'].includes(domain) &&
    isBowelCurvedLengthViewerMeasurement(measurement, existingAnnotation);
  const isUltrasoundDirectional =
    !isDecelerationTime && isUltrasoundDirectionalViewerMeasurement(measurement); // AR_DECELERATION_TIME
  const frameNumber =
    measurement.frameNumber && measurement.frameNumber > 1
      ? measurement.frameNumber
      : getFrameNumberFromReferencedImageId(measurement.referencedImageId);

  const nextMeasurements = {
    ...(isDecelerationTime
      ? getDecelerationTimeMeasurementPayload(measurement, existingAnnotation) // AR_DECELERATION_TIME
      : isUltrasoundDirectional
        ? getUltrasoundDirectionalMeasurementPayload(measurement, existingAnnotation)
        : isBowelCurvedLength
          ? getBowelCurvedLengthMeasurementPayload(measurement, existingAnnotation)
          : isContourMeasurement && !isSpectralDoppler
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
  const persistedMeasurements = {
    ...(existingAnnotation?.measurements || {}),
    ...(nextMeasurements || {}),
  };

  // Volume contour geometry is persisted only once at annotation.points. Keep
  // the small top-level lvSimpson/laVolume metadata, but never persist another
  // contour copy inside measurements.
  delete persistedMeasurements.lvSimpson;
  delete persistedMeasurements.laVolume;
  delete persistedMeasurements.echoArea;
  delete persistedMeasurements.ultrasoundDirectional;
  delete persistedMeasurements.decelerationTime; // AR_DECELERATION_TIME

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
          ...(annotationKind ? { annotationKind } : {}),
          ...(commentScope ? { commentScope } : {}),
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

    ...(isEchoArea
      ? {
          measurementKind: 'echoAreaSlot',
          slot: echoAreaSlot,
          view: 'A4C',
          phase: echoAreaSlot === 'RV_ED' ? 'ED' : 'ES',
          // Geometry exists only once at annotation.points.
          echoArea: {
            slot: echoAreaSlot,
            view: 'A4C',
            phase: echoAreaSlot === 'RV_ED' ? 'ED' : 'ES',
            method: echoArea?.method || 'closed-contour-planimetry',
            ...(Array.isArray(echoArea?.calibrationRegions)
              ? { calibrationRegions: echoArea.calibrationRegions } : {}),
          },
        }
      : {}),

    ...(isSpectralDoppler
      ? {
          measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
          spectralDoppler: nextMeasurements.spectralDoppler,
          ...(reportMapping ? { reportMapping } : {}),
        }
      : {}),

    ...(isBowelCurvedLength
      ? {
          measurementKind: BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
          contourClosed: false,
          ...(reportMapping ? { reportMapping } : {}),
        }
      : {}),

    ...(isUltrasoundDirectional
      ? {
          measurementKind: ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND,
          ultrasoundDirectional: nextMeasurements.ultrasoundDirectional,
          ...(reportMapping ? { reportMapping } : {}),
        }
      : {}),

    ...(isDecelerationTime
      ? {
          measurementKind: DECELERATION_TIME_MEASUREMENT_KIND,
          decelerationTime: nextMeasurements.decelerationTime,
          ultrasoundDirectional: nextMeasurements.ultrasoundDirectional,
          ...(reportMapping ? { reportMapping } : {}),
        }
      : {}), // AR_DECELERATION_TIME

    StudyInstanceUID: measurement.referenceStudyUID || '',
    SeriesInstanceUID: measurement.referenceSeriesUID || '',
    SOPInstanceUID: measurement.SOPInstanceUID,
    FrameOfReferenceUID: measurement.FrameOfReferenceUID || '',
    displaySetInstanceUID: measurement.displaySetInstanceUID || '',

    referenceSeriesUID: measurement.referenceSeriesUID,
    referencedImageId: measurement.referencedImageId,
    frameNumber,
    points: measurement.toolName === 'SplineROI' && isEchoArea
      ? compactOversampledSpline(measurement.points) : measurement.points,
    ...getSplinePersistence(measurement,
      cornerstoneTools.annotation.state.getAnnotation?.(measurement.uid)),
    viewPlaneNormal: getViewerMeasurementMetadataVector(
      measurement,
      existingAnnotation,
      'viewPlaneNormal'
    ),
    viewUp: getViewerMeasurementMetadataVector(measurement, existingAnnotation, 'viewUp'),

    measurements: persistedMeasurements,
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

function getScalarMeasurementKindForQuiz(measurement, fallbackKind) {
  const explicitKind = String(
    measurement?.measurementKind ||
      measurement?.measurements?.measurementKind ||
      measurement?.metadata?.measurementKind ||
      ''
  ).trim();
  const normalizedKind = explicitKind.replace(/[\s_-]+/g, '').toLowerCase();

  if (normalizedKind === 'bowelcurvedlength' || normalizedKind === 'curvedlength') {
    return fallbackKind === 'length' ? 'curvedLength' : fallbackKind;
  }

  if (normalizedKind === 'length' || normalizedKind === 'straightlength') {
    return fallbackKind === 'length' ? 'length' : fallbackKind;
  }

  return fallbackKind;
}

function isCompositeQuizSourceAnnotation(measurement) {
  const kind = String(
    measurement?.measurementKind ||
      measurement?.measurements?.measurementKind ||
      measurement?.metadata?.measurementKind ||
      ''
  ).trim();
  return kind === LV_SIMPSON_MEASUREMENT_KIND || kind === LA_VOLUME_MEASUREMENT_KIND ||
    Boolean(measurement?.lvSimpson || measurement?.laVolume ||
      measurement?.measurements?.lvSimpson || measurement?.measurements?.laVolume);
}

function getMeasurementValueAndUnitForQuiz(measurement, requestedKind = '') {
  // TR-specific quiz values must come from the calibrated clinical acquisition,
  // never from an incidental ROI length/area or a question-provided number.
  if (requestedKind === 'trVTI') {
    const spectral = getSpectralDopplerGeometry(measurement, measurement);
    const vti = Number(spectral?.values?.vtiCM);
    const trace = spectral?.trace || {};
    if (
      String(getMeasurementDisplayLabel(measurement)).trim().toLowerCase() === 'tr vti' &&
      spectral?.status === 'complete' &&
      spectral?.calibration?.source === 'SequenceOfUltrasoundRegions' &&
      Number(trace.calibratedPointCount) >= 2 &&
      Number(trace.envelopeColumnCount) >= 2 &&
      Number.isFinite(vti) && vti > 0 &&
      isSpectralDopplerViewerMeasurement(measurement)
    ) {
      return { value: vti, unit: 'cm', measurementKind: 'trVTI' };
    }
    return { value: null, unit: '', measurementKind: '' };
  }
  if (requestedKind === 'trVmax') {
    const directional = getUltrasoundDirectionalGeometry(measurement, measurement);
    const label = String(getMeasurementDisplayLabel(measurement)).trim().toLowerCase();
    const value = Number(directional?.reportValue);
    if (
      label === 'tr peak velocity' &&
      directional?.acquisitionMode === 'spectralVmax' &&
      directional?.reportUnit === 'm/s' &&
      Number.isFinite(value) && value > 0 && value <= 8
    ) {
      return { value, unit: 'm/s', measurementKind: 'trVmax' };
    }
    return { value: null, unit: '', measurementKind: '' };
  }
  // A contour's incidental length/area is not its composite clinical result.
  // Prevent it from becoming an accepted scalar quiz answer.
  if (isCompositeQuizSourceAnnotation(measurement)) {
    return { value: null, unit: '', measurementKind: '' };
  }

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
      measurementKind: getScalarMeasurementKindForQuiz(measurement, 'length'),
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

/**
 * Physical locations for bowel quiz calipers. Cornerstone world coordinates
 * are NOT assumed to be millimetres. Transform them into image indices, then
 * apply DICOM ultrasound-region / pixel calibration for that exact image.
 * Return null if any part of that provenance is unavailable.
 */
function getBowelQuizCalibratedPointContext({ viewport, displaySetService, measurement, points, onFailure }) {
  const reject = reason => {
    onFailure?.(reason);
    return null;
  };
  const imageInfo = getCurrentViewportImageInfo(viewport);
  const sourceImageId = String(
    measurement?.referencedImageId || measurement?.metadata?.referencedImageId || ''
  );
  if (!imageInfo.imageId) return reject('active-image-unavailable');
  if (sourceImageId && imageInfo.imageId !== sourceImageId) {
    // Loader URI equality is not DICOM identity. Match the same SOP/frame.
    const currentSop = String(getSopInstanceIdFromImageId(imageInfo.imageId) || '');
    const sourceSop = String(
      measurement?.SOPInstanceUID || measurement?.metadata?.SOPInstanceUID ||
      getSopInstanceIdFromImageId(sourceImageId) || ''
    );
    const sourceFrame = getFrameNumberFromReferencedImageId(sourceImageId);
    const currentFrame = getFrameNumberFromReferencedImageId(imageInfo.imageId);
    if (!currentSop || !sourceSop || currentSop !== sourceSop ||
        !Number.isInteger(sourceFrame) || sourceFrame !== currentFrame) {
      return reject('selected-caliper-is-not-on-the-active-dicom-frame');
    }
  } else if (!sourceImageId) {
    const currentSop = String(getSopInstanceIdFromImageId(imageInfo.imageId) || '');
    const measurementSop = String(
      measurement?.SOPInstanceUID || measurement?.metadata?.SOPInstanceUID || ''
    );
    const measurementFrame = Number(measurement?.frameNumber || 1);
    if (!currentSop || !measurementSop || currentSop !== measurementSop ||
        measurementFrame !== getFrameNumberFromReferencedImageId(imageInfo.imageId)) {
      return reject('selected-caliper-source-image-not-identified');
    }
  }
  const imageData = viewport?.getImageData?.();
  if (!imageData || !Array.isArray(points) || !points.length ||
      points.some(p => !Array.isArray(p) || p.length !== 3 ||
        p.some(n => !Number.isFinite(Number(n))))) return reject('caliper-world-endpoints-missing');
  // Try the viewport's native mapping, including the affine basis. Certain
  // ultrasound StackViewports expose imageData without the vtk transform API;
  // their BWT Length tool already uses worldToImageIndex from the DICOM
  // imagePlaneModule for this same coordinate conversion.
  const basis = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const worldSamples = [...points, ...basis];
  const toFiniteIndex = value =>
    value && typeof value.length === 'number' && value.length >= 2 &&
      [Number(value[0]), Number(value[1])].every(Number.isFinite)
      ? [Number(value[0]), Number(value[1])] : null;
  let transformed = null;
  try {
    const native = worldSamples.map(point =>
      toFiniteIndex(csUtils.transformWorldToIndex(imageData, point))
    );
    if (native.every(Boolean)) transformed = native;
  } catch {
    // Use the same image-plane conversion as the existing native BWT
    // calibration utility, not unscaled world coordinates.
  }
  if (!transformed) {
    const plane = metaData.get?.('imagePlaneModule', imageInfo.imageId);
    const validVector = value =>
      value && typeof value.length === 'number' && value.length === 3 &&
      Array.from(value).every(n => Number.isFinite(Number(n)));
    if (!plane || !validVector(plane.imagePositionPatient) ||
        !validVector(plane.rowCosines) || !validVector(plane.columnCosines)) {
      return reject('world-to-image-conversion-failed-no-dicom-image-plane');
    }
    transformed = worldSamples.map(point =>
      toFiniteIndex(worldToImageIndex(plane, point))
    );
    if (transformed.some(point => !point)) {
      return reject('world-to-image-conversion-failed-invalid-image-plane');
    }
  }
  const indexPoints = transformed.slice(0, points.length);
  const samples = transformed.slice(points.length);
  const base = samples[0];
  const affine = [0, 1].map(axis => [
    samples[1][axis] - base[axis],
    samples[2][axis] - base[axis],
    samples[3][axis] - base[axis],
    base[axis],
  ]);
  if (affine.some(row => row.some(n => !Number.isFinite(n))) ||
      points.some((point, index) => affine.some((row, axis) =>
        Math.abs(row[0] * point[0] + row[1] * point[1] +
          row[2] * point[2] + row[3] - indexPoints[index][axis]) > 0.1
      ))) return reject('world-to-image-transform-inconsistent');
  const instance = getInstanceForViewerMeasurement(displaySetService, measurement);
  const requestedSopInstance = String(measurement?.SOPInstanceUID || '').trim();
  if (instance && requestedSopInstance &&
      String(getSopInstanceIdFromSource(instance) || '').trim() !== requestedSopInstance) {
    // Existing general-purpose lookup can fall back to the first instance.
    // Physical quiz scoring must never inherit calibration from that fallback.
    return reject('dicom-instance-calibration-mismatch');
  }
  const rawRegions = getUltrasoundRegionsFromSource(instance);
  const regions = rawRegions.map(normalizeUltrasoundRegion).filter(Boolean);
  // If the DICOM declares ultrasound regions but none are physically valid,
  // never silently fall back to generic pixel spacing.
  if (rawRegions.length && !regions.length) return reject('dicom-ultrasound-region-has-no-physical-calibration');
  let spacing;
  if (regions.length) {
    // All points must be unambiguously located in the same calibrated region.
    const candidates = regions.filter(region =>
      [region.minX, region.maxX, region.minY, region.maxY].every(Number.isFinite) &&
      indexPoints.every(point =>
        point[0] >= region.minX && point[0] <= region.maxX &&
        point[1] >= region.minY && point[1] <= region.maxY
      )
    );
    if (candidates.length !== 1) return reject(
      candidates.length === 0 ? 'caliper-outside-dicom-calibrated-ultrasound-region' :
      'overlapping-dicom-ultrasound-calibration-regions'
    );
    spacing = candidates[0];
  } else {
    spacing = getCornerstonePixelSpacingMM(imageInfo.imageId);
  }
  if (!spacing || !(spacing.column > 0) || !(spacing.row > 0) ||
      !Number.isFinite(spacing.column) || !Number.isFinite(spacing.row)) {
    return reject('physical-pixel-spacing-unavailable');
  }
  return {
    source: 'dicom-calibrated-image-index-v1',
    calibrationSource: spacing.source,
    pixelSpacing: { row: spacing.row, column: spacing.column },
    worldPoints: points.map(point => [...point]),
    worldToImageAffine: affine,
    indexPoints: indexPoints.map(point => [point[0], point[1], 0]),
    physicalPoints: indexPoints.map(point => [
      point[0] * spacing.column, point[1] * spacing.row, 0,
    ]),
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
  const requestedKind = String(question?.answerConfig?.measurementKind || '').trim();
  const valueAndUnit = getMeasurementValueAndUnitForQuiz(measurement, requestedKind);

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

  // The question's expected type is not evidence of what the educator actually drew.
  // Always capture the annotation's label so incompatible Echo measurements cannot cross-bind.
  const resolvedMeasurementType = String(
    getMeasurementDisplayLabel(measurement) || measurement?.measurementType || ''
  ).trim();

  // Preserve the physical unit reported by the measurement; pixels are not millimetres.
  const resolvedUnit = String(valueAndUnit.unit || '').trim();

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

/**
 * DICOM ultrasound-region calibration is the same source used by the EF tool.
 * A contour can be used as an area only when *every* point is inside one
 * unambiguous spatial region with physical centimetre/mm spacing.
 * This never estimates an area from uncalibrated viewport/world pixels.
 */
function calibratedEchoAreaFromRegions({
  points, imageId, regions,
}: { points: number[][]; imageId: string; regions: any[] }) {
  if (!imageId || !Array.isArray(regions) || !regions.length) return null;
  const imagePlane = metaData.get?.('imagePlaneModule', imageId);
  const physical = calibrateUSContourPoints({ points, imagePlane, regions });
  if (!physical || physical.length < 6) return null;
  return calculateCalibratedEchoAreaCM2(physical);
}

/** Resolve calibration for the exact image, including metadata populated by
 * the image loader after the display set's lightweight instance was created. */
function getEchoAreaCalibrationRegions({ displaySet, imageId, sopInstanceId }) {
  if (!imageId || !sopInstanceId ||
      getSopInstanceIdFromImageId(imageId) !== String(sopInstanceId)) return [];
  const sources = getDisplaySetInstances(displaySet).filter(instance =>
    String(getSopInstanceIdFromSource(instance) || '') === String(sopInstanceId));
  const loaded = metaData.get?.('instance', imageId);
  const loadedSOP = String(getSopInstanceIdFromSource(loaded) || '');
  if (loaded && (!loadedSOP || loadedSOP === String(sopInstanceId))) sources.push(loaded);
  const direct = metaData.get?.('ultrasoundRegions', imageId);
  const raw = sources.flatMap(getUltrasoundRegionsFromSource);
  raw.push(...(Array.isArray(direct) ? direct : getUltrasoundRegionsFromSource(direct)));
  return raw.map(normalizeUltrasoundRegion).filter(Boolean);
}

function getVerifiedEchoAreaCalibration({
  displaySet, imageId, sopInstanceId, points,
}: { displaySet: any; imageId: string; sopInstanceId: string; points: number[][] }) {
  if (!imageId || !sopInstanceId) return null;
  const regions = getEchoAreaCalibrationRegions({ displaySet, imageId, sopInstanceId });
  const areaCM2 = calibratedEchoAreaFromRegions({ points, imageId, regions });
  return areaCM2 == null ? null : { areaCM2, regions };
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

  // The snapshot recomputes guided areas from the current source contour and
  // DICOM region. Prefer that value over native ROI statistics and old saves.
  const hasVerifiedArea = !!getEchoAreaSlot(measurement) &&
    Object.prototype.hasOwnProperty.call(measurement?.measurements || {}, 'area');
  const rawArea = hasVerifiedArea
    ? (measurement.measurements.area == null ? null : finiteNumberOrNull(measurement.measurements.area))
    : finiteNumberOrNull(stats?.area) ?? finiteNumberOrNull(existingAnnotation?.measurements?.area);
  const rawAreaUnit = hasVerifiedArea
    ? measurement.measurements.areaUnit || ''
    : stats?.areaUnit || existingAnnotation?.measurements?.areaUnit || '';

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

function isSavedQuizEchoContour(savedAnnotation) {
  return savedAnnotation?.measurementKind === 'echoAreaSlot' ||
    !!getEchoAreaSlot(savedAnnotation) ||
    isLAVolumeMeasurement(savedAnnotation);
}

function getSavedQuizEchoContourAreaDisplay(savedAnnotation) {
  if (!isSavedQuizEchoContour(savedAnnotation)) return null;
  const measurements = savedAnnotation?.measurements || {};
  const physical = getSavedQuizEchoAreaDisplayInfo(measurements.area, measurements.areaUnit);
  if (!physical) return null;
  // The quiz panel uses cm². Convert only explicit physically calibrated mm².
  const value = physical.areaUnit === 'mm²' ? physical.value / 100 : physical.value;
  return Number.isFinite(value) && value > 0
    ? { value, areaUnit: 'cm²', linearUnit: 'cm' }
    : null;
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
  // Quiz RV/LA contour areas already carry explicit physical units from
  // calibrated measurement data. Do not reuse stale generic ROI displayText.
  const quizArea = getSavedQuizEchoContourAreaDisplay(savedAnnotation);
  if (isSavedQuizEchoContour(savedAnnotation)) {
    return quizArea ? [`${quizArea.value.toFixed(2)} cm²`] : ['Calibrated area unavailable'];
  }
  const measurements = savedAnnotation?.measurements || {};
  const isCurvedLength = isBowelCurvedLengthViewerMeasurement(savedAnnotation, savedAnnotation);
  const unitType =
    isViewerContourTool(savedAnnotation?.toolName) && !isCurvedLength ? 'area' : 'length';

  if (Array.isArray(measurements.displayText) && measurements.displayText.length > 0) {
    return normalizeDisplayTextUnits(measurements.displayText, unitType);
  }

  if (Array.isArray(savedAnnotation?.displayText) && savedAnnotation.displayText.length > 0) {
    return normalizeDisplayTextUnits(savedAnnotation.displayText, unitType);
  }

  if (
    savedAnnotation?.toolName === 'Length' ||
    isBowelCurvedLengthViewerMeasurement(savedAnnotation, savedAnnotation)
  ) {
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

  if (
    savedAnnotation?.toolName === 'Length' ||
    isBowelCurvedLengthViewerMeasurement(savedAnnotation, savedAnnotation)
  ) {
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
    const quizArea = getSavedQuizEchoContourAreaDisplay(savedAnnotation);
    // A quiz contour without explicit physical calibration must not fall back
    // to native pixel-area statistics and be shown as valid millimetre area.
    if (isSavedQuizEchoContour(savedAnnotation) && !quizArea) return {};
    const area = quizArea?.value ?? getSavedContourAreaForDisplay(
      savedAnnotation,
      referencedImageId || savedAnnotation?.referencedImageId || ''
    );

    if (area == null) {
      return {};
    }

    return {
      [statsKey]: {
        area,
        areaUnit: quizArea?.areaUnit || 'mm²',
        areaUnits: quizArea?.areaUnit || 'mm²',
        unit: quizArea?.linearUnit || 'mm',
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

  if (
    savedAnnotation?.toolName === 'Length' ||
    isBowelCurvedLengthViewerMeasurement(savedAnnotation, savedAnnotation)
  ) {
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
    const quizArea = getSavedQuizEchoContourAreaDisplay(savedAnnotation);
    // A quiz contour without explicit physical calibration must not fall back
    // to native pixel-area statistics and be shown as valid millimetre area.
    if (isSavedQuizEchoContour(savedAnnotation) && !quizArea) return {};
    const area = quizArea?.value ?? getSavedContourAreaForDisplay(
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
          areaUnit: quizArea?.areaUnit || 'mm²',
          areaUnits: quizArea?.areaUnit || 'mm²',
          unit: quizArea?.linearUnit || 'mm',
          units: quizArea?.linearUnit || 'mm',
          modalityUnit: quizArea?.linearUnit || 'mm',
          modalityUnitOptions: {
            areaUnit: quizArea?.areaUnit || 'mm²',
            unit: quizArea?.linearUnit || 'mm',
          },
          arSavedMeasurementArea: area,
          arSavedMeasurementAreaUnit: quizArea?.areaUnit || 'mm²',
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
    ...(isBowelCurvedLengthViewerMeasurement(savedAnnotation, savedAnnotation)
      ? {
          measurementKind: BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
          reportMapping: savedAnnotation?.reportMapping || null,
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
    savedAnnotation?.measurementKind !== SPECTRAL_DOPPLER_MEASUREMENT_KIND &&
    !isBowelCurvedLengthViewerMeasurement(savedAnnotation, savedAnnotation)
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

function getEFContourFrameTarget(targets: any, slot: string) {
  if (!targets || typeof targets !== 'object' || Array.isArray(targets) ||
      !LV_TRACE_REQUIRED_SLOTS.includes(slot)) {
    return null;
  }
  const target = targets[slot];
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const normalized = normalizeViewerQuizTarget(target);
  if (!normalized.referencedImageId || !normalized.sopInstanceId ||
      !Number.isInteger(normalized.frameNumber) || normalized.frameNumber < 1) return null;
  return target;
}

// An EF contour's authored frame is an exact target, not merely an instance.
// Never allow the generic quiz navigator's SOP or image-index fallbacks to
// silently put an EF contour on the wrong cine frame.
function didNavigateToExactEFContourFrame(result: any, target: any) {
  if (result?.ok !== true || !result.imageId) return false;
  const expected = normalizeViewerQuizTarget(target);
  const actualImageId = normalizeImageIdForCompare(result.imageId);
  const expectedImageId = normalizeImageIdForCompare(expected.referencedImageId);
  if (result.source === 'referencedImageId' && expectedImageId &&
      (actualImageId === expectedImageId || actualImageId.endsWith(expectedImageId))) {
    return true;
  }
  // The generic navigator's /frames/N substring match can also match
  // /frames/N0. Confirm the actual DICOM frame and instance ourselves.
  return result.source === 'sop-frame' &&
    getSopInstanceIdFromImageId(result.imageId) === expected.sopInstanceId &&
    getFrameNumberFromReferencedImageId(result.imageId) === expected.frameNumber;
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

  // DICOM SOP identity wins over a display-set hint: the saved hint can
  // become stale when the same cine series is regrouped by OHIF.
  if (target.sopInstanceId && displaySetService.getDisplaySetForSOPInstanceUID) {
    const displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
      target.sopInstanceId, target.seriesInstanceId
    );
    if (displaySet && displaySetContainsSavedAnnotation(displaySet, {
      SOPInstanceUID: target.sopInstanceId,
    })) return displaySet;
  }

  if (target.displaySetInstanceId && displaySetService.getDisplaySetByUID) {
    const displaySet = displaySetService.getDisplaySetByUID(target.displaySetInstanceId);
    if (displaySet && (!target.sopInstanceId ||
        displaySetContainsSavedAnnotation(displaySet, {
          SOPInstanceUID: target.sopInstanceId,
        }))) return displaySet;
  }

  const seriesDisplaySets =
    target.seriesInstanceId && displaySetService.getDisplaySetsForSeries
      ? displaySetService.getDisplaySetsForSeries(target.seriesInstanceId) || []
      : [];

  // A series can contain multiple separately rendered cine instances. Do not
  // default to its first display set if another contains the authored SOP.
  if (target.sopInstanceId) {
    const exact = seriesDisplaySets.find(displaySet =>
      displaySetContainsSavedAnnotation(displaySet, { SOPInstanceUID: target.sopInstanceId })
    );
    if (exact) return exact;
    if (seriesDisplaySets.length > 1) return null;
  }

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

async function waitForViewerQuizTargetImageMatch(
  viewport, target = {}, attempts = 20, resolveViewport = null
) {
  let lastMatch = {
    index: -1,
    imageId: '',
    imageIds: [],
    source: 'not-started',
  };
  let latestViewport = viewport;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // A display-set update can recreate the viewport; retry against the
    // current instance instead of a stale previous image stack.
    const resolved = typeof resolveViewport === 'function' ? resolveViewport() : null;
    latestViewport = resolved || latestViewport;
    lastMatch = findImageIdIndexForViewerQuizTarget(latestViewport, target);

    if (lastMatch.index >= 0) {
      return { ...lastMatch, viewport: latestViewport };
    }

    await sleep(100);
  }

  return { ...lastMatch, viewport: latestViewport };
}

async function jumpViewportToViewerQuizTargetImage(viewport, target = {}, resolveViewport = null) {
  // Instance-only quiz guidance has no gold frame and may require an
  // asynchronous cine display-set transition.
  const attempts = target.sopInstanceId && !Number.isFinite(target.frameNumber) ? 70 : 20;
  const { viewport: latestViewport, ...match } =
    await waitForViewerQuizTargetImageMatch(viewport, target, attempts, resolveViewport);

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
    const targetViewport = latestViewport || viewport;
    if (targetViewport.setImageIdIndex) {
      await targetViewport.setImageIdIndex(match.index);
    } else if (targetViewport.element) {
      csUtils.jumpToSlice(targetViewport.element, {
        imageIndex: match.index,
      });
    }

    targetViewport.render?.();

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

/**
 * Quiz-only physical area labels. Cornerstone's generic SplineROI cachedStats
 * text may be based on a different ultrasound-region scale than the validated
 * RV/LA calculation. Never display that native number for a quiz contour.
 * The Case Questions panel and this viewport use the exact same calculator.
 */
function installQuizCompositeContourTextOverrideForViewport({
  viewport, viewportId = '', measurementService, viewportGridService,
  displaySetService, toolGroupService,
}) {
  if (!viewport) return;
  // The hook is safe for any viewport: only explicit quiz composite contour
  // metadata is intercepted. Depending on URL query parameters missed some
  // legitimate quiz launches and left the native ROI mm² renderer active.
  const resolvedViewportId = viewport.id || viewportId;
  let toolGroup = null;
  try {
    const groupRef = toolGroupService?.getToolGroupForViewport?.(resolvedViewportId);
    toolGroup = typeof groupRef === 'string'
      ? toolGroupService?.getToolGroup?.(groupRef) ||
        ToolGroupManager.getToolGroup?.(groupRef)
      : groupRef;
    toolGroup ||= ToolGroupManager.getToolGroupForViewport?.(
      resolvedViewportId, viewport.renderingEngineId
    ) || ToolGroupManager.getToolGroupForViewport?.(resolvedViewportId);
  } catch (error) {
    console.warn('[Quiz contour units] tool group lookup failed', error);
  }
  if (!toolGroup) {
    console.warn('[Quiz contour units] no tool group for viewport', resolvedViewportId);
    return;
  }

  // The rendering tool receives (data, targetId), not the annotation itself.
  // Resolve the same validated phase value as Case Questions, but tie it to
  // the annotation's actual image (and annotation id where supplied) instead
  // of a stale active viewport captured when the tool group was first made.
  const formatQuizContour = (data, rawTargetId = '') => {
    const contourData = data?.annotation?.data || data?.data || data;
    const slot = String(contourData?.echoArea?.slot ||
      contourData?.laVolume?.slot || '').trim().toUpperCase();
    const echoSlot = !!contourData?.echoArea?.slot &&
      ['RV_ED', 'RV_ES', 'RA_ES'].includes(slot);
    const laSlot = !!contourData?.laVolume?.slot &&
      ['A4C', 'A2C'].includes(slot);
    if (!echoSlot && !laSlot) return null;

    const kind = echoSlot ? (slot === 'RA_ES' ? 'raArea' : 'rvFAC')
      : 'laVolumeBiplane';
    const targetImage = String(rawTargetId || '')
      .replace(/^(?:imageId|volumeId):/i, '');
    const annotationId = String(contourData?.arQuizSourceAnnotationId || '').trim();
    const allMeasurements = getCurrentViewerMeasurementSnapshot(measurementService);
    const matches = allMeasurements.filter(measurement => {
      const candidateSlot = echoSlot
        ? getEchoAreaSlot(measurement)
        : String(measurement?.laVolume?.slot ||
          measurement?.measurements?.laVolume?.slot || '').trim().toUpperCase();
      if (candidateSlot !== slot) return false;
      const candidateId = String(measurement?.uid || measurement?.annotationUID ||
        measurement?.annotationId || '').trim();
      if (annotationId && annotationId !== candidateId) return false;
      const sourceImage = String(measurement?.referencedImageId ||
        measurement?.metadata?.referencedImageId || '').trim();
      return !targetImage || (sourceImage && sourceImage === targetImage);
    });
    // Duplicate or missing exact source references are not physical evidence.
    // Saved contours may still have explicit previously validated cm² display
    // text; the formatter handles that without adopting native pixel statistics.
    let areaCM2 = null;
    if (matches.length === 1) {
      const study = String(matches[0]?.referenceStudyUID ||
        matches[0]?.StudyInstanceUID || '').trim();
      if (study) {
        const scoped = allMeasurements.filter(measurement =>
          String(measurement?.referenceStudyUID ||
            measurement?.StudyInstanceUID || '').trim() === study);
        const status = getViewerQuizCompositeStatus(kind as any, scoped);
        areaCM2 = status?.phaseValues?.[slot] ?? null;
      }
    }
    return getQuizCompositeContourViewportLines(contourData, areaCM2);
  };

  for (const toolName of new Set([
    toolNames.SplineROI || 'SplineROI',
    toolNames.PlanarFreehandROI || 'PlanarFreehandROI',
  ])) {
    const installed = installQuizContourTextRenderer({
      toolGroup, toolName, formatQuizContour,
      sanitizeFallback: sanitizeContourTextLines,
    });
    if (!installed) {
      console.warn('[Quiz contour units] text renderer not active for', toolName);
    }
  }
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
      const raw = args[0];
      const data = raw?.annotation?.data || raw?.data || raw;
      const goldEFText = getVerifiedEFGoldContourViewportLines(
        data?.arVerifiedQuizEFGoldContour
      );
      if (goldEFText) return goldEFText;
      const lv = data?.lvSimpson || {};
      // Cornerstone's native ROI statistics can be expressed in image pixels.
      // EF's physical contour coordinates were independently calibrated in mm.
      // Display a physical area only when those exact coordinates exist.
      if (['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'].includes(String(lv.slot || '')) &&
          !lv.calibrationError) {
        const area = calibratedLVContourAreaCM2(lv.calibratedContourPoints);
        return area !== null
          ? [`LV contour area: ${area.toFixed(2)} cm²`]
          : ['Calibrated LV contour area unavailable'];
      }
      return sanitizeContourTextLines(lines);
    },
  };

  toolInstance.configuration = nextConfiguration;
  toolGroup?.setToolConfiguration?.(toolName, nextConfiguration, true);
  toolInstance.__arLVSimpsonTextCleanupInstalled = true;
}


// AR_DECELERATION_TIME:BEGIN text-override
function installDecelerationTimeTextOverrideForViewport({ viewport, viewportId = '' }) {
  if (!viewport) return;
  let toolGroup = null;
  try {
    toolGroup =
      ToolGroupManager.getToolGroupForViewport?.(viewport.id || viewportId, viewport.renderingEngineId) ||
      ToolGroupManager.getToolGroupForViewport?.(viewport.id || viewportId);
  } catch {
    toolGroup = null;
  }
  const toolInstance = toolGroup?.getToolInstance?.(ULTRASOUND_DIRECTIONAL_TOOL_NAME);
  if (!toolInstance || toolInstance.__arDecelerationTimeTextOverrideInstalled) return;
  const previousGetTextLines = toolInstance.configuration?.getTextLines;
  const nextConfiguration = {
    ...(toolInstance.configuration || {}),
    getTextLines: function (...args) {
      for (const arg of args) {
        const candidates = [arg?.data, arg?.annotation?.data, arg?.annotationData, arg].filter(Boolean);
        for (const candidate of candidates) {
          const target = normalizeDecelerationTimeTargetSelection(candidate?.arDecelerationTimeTarget);
          if (!target) continue;
          const stats = getUltrasoundDirectionalStatsFromAnnotationData(candidate);
          const calculation = calculateDecelerationTimeFromDirectionalStats({ stats, target });
          return buildDecelerationTimeDisplayText(calculation);
        }
      }
      return typeof previousGetTextLines === 'function'
        ? previousGetTextLines.call(this, ...args)
        : [];
    },
  };
  toolInstance.configuration = nextConfiguration;
  toolGroup?.setToolConfiguration?.(ULTRASOUND_DIRECTIONAL_TOOL_NAME, nextConfiguration, true);
  toolInstance.__arDecelerationTimeTextOverrideInstalled = true;
}
// AR_DECELERATION_TIME:END text-override

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

/**
 * Reusable education click-to-trace capture. Avoids the shared PlanarFreehandROI
 * drag gesture; returns world points only, with no temporary annotation persisted.
 * EF, LA and quiz-only right-heart acquisitions call their own validated calculators.
 */
function captureViewerClickTrace({ viewport, isCancelled, setCancelHandler, previewLabel = '' }) {
  const element = viewport?.element;
  if (!element?.addEventListener || !viewport?.canvasToWorld || !viewport?.worldToCanvas) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    const overlay = createLVSimpsonPreviewOverlay(element);
    const previousCursor = element.style.cursor;
    const points = [];
    let started = false;
    let done = false;
    let lastCanvasPoint = null;

    function finish(result) {
      if (done) return;
      done = true;
      element.removeEventListener('mousedown', onMouseDown, true);
      element.removeEventListener('mouseup', stopMouseEvent, true);
      element.removeEventListener('click', stopMouseEvent, true);
      element.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('keydown', onKeyDown, true);
      setCancelHandler?.(null);
      clearLVSimpsonPreviewOverlay(element);
      restoreLVSimpsonViewportCursor(element, previousCursor);
      resolve(result);
    }

    function stopMouseEvent(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function drawPreview(cursorPoint) {
      if (!overlay || !points.length) return;
      const polylinePoints = cursorPoint ? [...points, cursorPoint] : points;
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', polylinePoints
        .map(point => viewport.worldToCanvas(point))
        .map(point => `${point[0]},${point[1]}`).join(' '));
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', '#facc15');
      polyline.setAttribute('stroke-width', '2');
      polyline.setAttribute('stroke-linejoin', 'round');
      polyline.setAttribute('stroke-linecap', 'round');
      // A viewport/tool initialization refresh can detach the preview overlay
      // during the first EF trace. Reattach it before updating its geometry.
      if (!overlay.isConnected || overlay.parentElement !== element) {
        element.appendChild(overlay);
      }
      overlay.style.zIndex = '999';
      if (previewLabel) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', '12');
        label.setAttribute('y', '22');
        label.setAttribute('fill', '#facc15');
        label.setAttribute('font-size', '14');
        label.setAttribute('font-weight', '600');
        label.textContent = previewLabel + ' · tracing (not yet calculated)';
        overlay.replaceChildren(polyline, label);
      } else {
        overlay.replaceChildren(polyline);
      }
    }

    function onMouseDown(event) {
      if (event.button !== 0) return;
      stopMouseEvent(event);
      if (isCancelled?.()) return finish(null);
      const canvasPoint = getCanvasPointFromMouseEvent(event, element);
      const worldPoint = getWorldPointFromMouseEvent(event, viewport);
      if (!worldPoint || !canvasPoint) return;
      if (!started) {
        started = true;
        points.push(worldPoint);
        lastCanvasPoint = canvasPoint;
        drawPreview();
        return;
      }
      // A second click near the start of drawing must not commit a dot.
      const startCanvas = viewport.worldToCanvas(points[0]);
      const distanceFromStart = Math.hypot(
        canvasPoint.x - startCanvas[0], canvasPoint.y - startCanvas[1]
      );
      if (points.length < 6 || distanceFromStart < 8) return;
      points.push(worldPoint);
      finish(points);
    }

    function onMouseMove(event) {
      if (!started || done) return;
      if (isCancelled?.()) return finish(null);
      const canvasPoint = getCanvasPointFromMouseEvent(event, element);
      const worldPoint = getWorldPointFromMouseEvent(event, viewport);
      if (!canvasPoint || !worldPoint) return;
      if (Math.hypot(
        canvasPoint.x - lastCanvasPoint.x, canvasPoint.y - lastCanvasPoint.y
      ) >= 2) {
        points.push(worldPoint);
        lastCanvasPoint = canvasPoint;
      }
      drawPreview(worldPoint);
    }

    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    }

    setCancelHandler?.(() => finish(null));
    setLVSimpsonViewportCursor(element, 'crosshair');
    element.addEventListener('mousedown', onMouseDown, true);
    element.addEventListener('mouseup', stopMouseEvent, true);
    element.addEventListener('click', stopMouseEvent, true);
    element.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('keydown', onKeyDown, true);
  });
}

function captureLVSimpsonDrag({ viewport, onPreview, isCancelled, setCancelHandler, toolGroup, restorePreviousTool = true }) {
  const element = viewport?.element;

  if (!element) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    const previousCursor = element.style.cursor;
    // EF captures pointer drags directly; a previously active Length tool must
    // not also handle the same gesture and create an accidental measurement.
    const previousToolName = toolGroup?.getActivePrimaryMouseButtonTool?.() || '';
    if (previousToolName) {
      toolGroup?.setToolPassive?.(previousToolName);
    }
    let startWorld = null;
    let done = false;

    function finish(result) {
      if (done) {
        return;
      }

      done = true;
      if (restorePreviousTool && previousToolName && toolGroup?.hasTool?.(previousToolName)) {
        toolGroup.setToolActive(previousToolName, {
          bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
        });
      }
      restoreLVSimpsonViewportCursor(element, previousCursor);
      element.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      setCancelHandler?.(null);
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

    setCancelHandler?.(() => finish(null));
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

const LV_SIMPSON_PROGRESS_PANEL_ID = 'ar-lv-simpson-progress-panel';
// The current viewer provides study-scoped actions and authoritative progress.
let lvSimpsonPanelController: any = null;
const AR_LV_SIMPSON_GOLD_CAPTURED_EVENT = 'ar-measurements:lv-simpson-gold-captured';
const AR_LV_SIMPSON_CAPTURE_REQUESTED_EVENT = 'ar-measurements:lv-simpson-capture-requested';

function requestLVSimpsonQuizCapture({ studyInstanceId, value, mode }: {
  studyInstanceId: string;
  value: number;
  mode: 'completed' | 'manual';
}) {
  if (typeof window !== 'undefined' && studyInstanceId && Number.isFinite(value)) {
    window.dispatchEvent(new CustomEvent(AR_LV_SIMPSON_CAPTURE_REQUESTED_EVENT, {
      detail: { studyInstanceId, value, mode },
    }));
  }
}

// Keep the completed result stable across MeasurementService normalization and
// quiz/panel reads. An actual user edit to Cornerstone contour geometry invalidates it.
let completedLVSimpsonResult: {
  studyInstanceId: string;
  composite: any;
  result: any;
  contourRevisions: Map<string, string>;
} | null = null;

function getLVSimpsonAnnotationRevision(annotationId: string): string | null {
  const annotation = cornerstoneTools.annotation.state.getAnnotation?.(annotationId);
  if (!annotation) return null;
  // The renderer may recompute a densely sampled spline without any user
  // edit. Revision tracking must use the editable handles, not its cache.
  const points = annotation.data?.handles?.points || annotation.data?.contour?.polyline;
  if (!Array.isArray(points) || points.length < 3) return null;
  // The revision is internal only; never log identifiers or coordinates.
  return JSON.stringify(points);
}

function getCompletedLVSimpsonResult(studyInstanceId: string) {
  const saved = completedLVSimpsonResult;
  if (!saved || saved.studyInstanceId !== studyInstanceId) return null;
  for (const [annotationId, revision] of saved.contourRevisions) {
    if (getLVSimpsonAnnotationRevision(annotationId) !== revision) {
      completedLVSimpsonResult = null;
      return null;
    }
  }
  return {
    studyInstanceId: saved.studyInstanceId,
    composite: saved.composite,
    result: saved.result,
  };
}

function retainCompletedLVSimpsonResult(studyInstanceId: string, composite: any, result: any) {
  const contours = new Map<string, string>();
  for (const component of composite?.components || []) {
    const annotationId = String(component.annotationId || '');
    const revision = getLVSimpsonAnnotationRevision(annotationId);
    if (!annotationId || !revision || contours.has(annotationId)) {
      completedLVSimpsonResult = null;
      return false;
    }
    contours.set(annotationId, revision);
  }
  if (contours.size !== 4 || result?.status !== 'complete') {
    completedLVSimpsonResult = null;
    return false;
  }
  completedLVSimpsonResult = {
    studyInstanceId,
    composite: structuredClone(composite),
    result: structuredClone(result),
    contourRevisions: contours,
  };
  return true;
}

let explicitLVSimpsonResult: { studyInstanceId: string; composite: any; result: any; contourRevisions: Map<string, string> } | null = null;
function getExplicitLVSimpsonResult(studyInstanceId: string) {
  return explicitLVSimpsonResult?.studyInstanceId === studyInstanceId ? explicitLVSimpsonResult : null;
}
// Direct edits and deletions after Calculate EF invalidate the only quiz result.
// This also fails closed if Cornerstone emits a late normalization change.
function invalidateExplicitLVSimpsonAfterAnnotationChange(event: Event) {
  const detail = (event as CustomEvent)?.detail || {};
  const annotationId = String(
    detail.annotation?.annotationUID || detail.annotation?.uid ||
    detail.annotationUID || ''
  );
  if (!annotationId) return;

  const result = explicitLVSimpsonResult;
  if (result?.composite?.components?.some((component: any) =>
    String(component.annotationId) === annotationId
  )) {
    // SplineROI sends ANNOTATION_MODIFIED during routine cached-stat
    // recalculation and rendering. Only revoke EF if an editable handle
    // actually changed or the source annotation was removed.
    const revision = result.contourRevisions?.get(annotationId);
    if (event.type !== Enums.Events.ANNOTATION_REMOVED &&
        revision && getLVSimpsonAnnotationRevision(annotationId) === revision) {
      return;
    }
    // A changed or removed source contour must never leave a capturable EF.
    explicitLVSimpsonResult = null;
    reviewedLVSimpsonEF = null;
    if (typeof document !== 'undefined' &&
        document.getElementById(LV_SIMPSON_PROGRESS_PANEL_ID)) {
      const currentMeasurements = lvSimpsonPanelController?.getMeasurements?.() || [];
      const missingSlot = getNextMissingLVSimpsonSlot(getLVSimpsonSlotCandidates(currentMeasurements));
      renderLVSimpsonWorkflowPanel({
        measurements: currentMeasurements,
        resultText: 'EF needs recalculation',
        warnings: ['A source contour changed or was removed after EF calculation.'],
        instruction: missingSlot
          ? 'Choose the missing contour below to redraw it; other contours are preserved.'
          : 'Review the contours, then select Calculate EF again.',
        onCalculate: missingSlot ? null : lvSimpsonPanelController?.onCalculate,
        onCancel: hideLVSimpsonWorkflowPanel,
      });
    }
  }
  // A deletion from the image or Measurements panel uses the same refresh
  // path as a deletion from the EF panel.
  if (event.type === Enums.Events.ANNOTATION_REMOVED) {
    lvSimpsonPanelController?.onAnnotationRemoved?.(annotationId);
  }
}

eventTarget.addEventListener(
  Enums.Events.ANNOTATION_MODIFIED,
  invalidateExplicitLVSimpsonAfterAnnotationChange
);
eventTarget.addEventListener(
  Enums.Events.ANNOTATION_REMOVED,
  invalidateExplicitLVSimpsonAfterAnnotationChange
);

let reviewedLVSimpsonEF: { studyInstanceId: string; value: number } | null = null;

function hideLVSimpsonWorkflowPanel() {
  reviewedLVSimpsonEF = null;
  lvSimpsonPanelController = null;
  document.getElementById(LV_SIMPSON_PROGRESS_PANEL_ID)?.remove();
}

// The panel is mounted outside the viewport so changing the cine image/frame
// cannot destroy the guidance. Progress is derived from actual measurements.
// Keep the EF panel's selected-slot label synchronized with successful
// authored-frame navigation. Do not rebuild the panel: that would discard
// the current drawing instructions or calculated EF result.
function updateLVSimpsonCurrentSlotLabel(slot: string) {
  const panel = document.getElementById(LV_SIMPSON_PROGRESS_PANEL_ID);
  if (!panel) return;
  for (const rowLabel of panel.querySelectorAll<HTMLElement>('[data-lv-simpson-slot]')) {
    const isCurrent = rowLabel.dataset.lvSimpsonSlot === slot;
    const baseText = rowLabel.dataset.lvSimpsonLabel || '';
    rowLabel.textContent = isCurrent ? `Current: ${baseText}` : baseText;
    rowLabel.style.fontWeight = isCurrent ? '700' : '';
    if (isCurrent) {
      rowLabel.setAttribute('aria-current', 'true');
    } else {
      rowLabel.removeAttribute('aria-current');
    }
  }
}

function renderLVSimpsonWorkflowPanel({
  measurements = [],
  instruction = '',
  continueLabel = '',
  onContinue = null,
  onCancel = null,
  onCapture = null,
  onCalculate = null,
  resultText = '',
  resultDetails = [],
  warnings = [],
}: {
  measurements?: any[];
  instruction?: string;
  continueLabel?: string;
  onContinue?: null | (() => void);
  onCancel?: null | (() => void);
  onCapture?: null | (() => void);
  onCalculate?: null | (() => void);
  resultText?: string;
  resultDetails?: string[];
  warnings?: string[];
} = {}) {
  if (typeof document === 'undefined') return;

  let panel = document.getElementById(LV_SIMPSON_PROGRESS_PANEL_ID);
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = LV_SIMPSON_PROGRESS_PANEL_ID;
    panel.setAttribute('aria-label', 'LV Simpson EF measurement progress');
    Object.assign(panel.style, {
      position: 'fixed',
      top: '88px',
      right: '16px',
      width: 'min(330px, calc(100vw - 32px))',
      zIndex: '999',
      background: '#111827',
      color: '#f9fafb',
      padding: '14px',
      border: '1px solid #64748b',
      borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      fontSize: '13px',
      lineHeight: '1.45',
    });
    document.body.appendChild(panel);
  }
  panel.replaceChildren();
  // Deleted contours must never reappear from a stale render argument.
  const currentMeasurements = lvSimpsonPanelController?.getMeasurements?.() || measurements;
  const slots = getLVSimpsonSlotCandidates(currentMeasurements);
  lvSimpsonPanelController?.setObservedIds?.(
    currentMeasurements.map(getMeasurementAnnotationId).filter(Boolean)
  );
  const completeCount = LV_TRACE_REQUIRED_SLOTS.filter(slot => slots.get(slot)?.length).length;
  const addText = (text, style: any = {}) => {
    const node = document.createElement('div');
    node.textContent = text;
    Object.assign(node.style, style);
    panel?.appendChild(node);
    return node;
  };
  addText('LV Simpson Biplane EF', { fontWeight: '700', fontSize: '15px' });
  addText(`${completeCount} of 4 contours complete`, { marginBottom: '8px', color: '#cbd5e1' });
  for (const slot of LV_TRACE_REQUIRED_SLOTS) {
    const matching = slots.get(slot) || [];
    const measurement = matching[0];
    const geometry = measurement?.lvSimpson || measurement?.measurements?.lvSimpson || {};
    const axis = Number(geometry.longAxisLengthMM);
    const detail = measurement && Number.isFinite(axis) && axis > 0 ? ` — long axis ${axis.toFixed(1)} mm` : '';
    const displayName = getLVSimpsonSlotDisplayName(slot);
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
      padding: '6px 0', borderTop: '1px solid #334155',
    });
    const canNavigateSlot = !!lvSimpsonPanelController?.canNavigateSlot?.(slot);
    const rowLabel = document.createElement(canNavigateSlot ? 'button' : 'span');
    rowLabel.textContent = `${measurement ? '✓' : '○'}  ${displayName}${detail}`;
    rowLabel.dataset.lvSimpsonSlot = slot;
    rowLabel.dataset.lvSimpsonLabel = rowLabel.textContent;
    rowLabel.style.flex = '1 1 100%';
    if (lvSimpsonPanelController?.activeSlot === slot) {
      rowLabel.style.fontWeight = '700';
      rowLabel.textContent = `Current: ${rowLabel.dataset.lvSimpsonLabel}`;
      rowLabel.setAttribute('aria-current', 'true');
    }
    if (canNavigateSlot) {
      (rowLabel as HTMLButtonElement).type = 'button';
      rowLabel.setAttribute('aria-label', `Open educator-assigned image and frame for ${displayName}`);
      Object.assign(rowLabel.style, {
        textAlign: 'left', cursor: 'pointer', background: 'transparent',
        color: '#f9fafb', border: '1px solid #64748b',
        borderRadius: '4px', padding: '4px',
      });
      rowLabel.addEventListener('click', () => {
        void lvSimpsonPanelController?.onNavigateSlot?.(slot);
      });
    }
    row.appendChild(rowLabel);
    const ids = matching.map(getMeasurementAnnotationId).filter(Boolean);
    const readOnly = matching.some(item => {
      const id = getMeasurementAnnotationId(item);
      const source = id && cornerstoneTools.annotation.state.getAnnotation?.(id);
      return item?.isLocked || source?.isLocked || source?.data?.arMeasurementReadOnly;
    });
    const rowButton = (label: string, title: string, action: () => void) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = label;
      control.setAttribute('aria-label', title);
      control.disabled = !!readOnly;
      Object.assign(control.style, {
        border: '1px solid #94a3b8', borderRadius: '6px', padding: '4px 8px',
        background: '#334155', color: '#ffffff',
        cursor: readOnly ? 'not-allowed' : 'pointer', opacity: readOnly ? '0.5' : '1',
      });
      control.addEventListener('click', action);
      row.appendChild(control);
    };
    if (lvSimpsonPanelController?.onDrawSlot) {
      rowButton('Freehand', `Trace ${displayName} freehand`,
        () => lvSimpsonPanelController?.onDrawSlot?.(slot, 'freehand'));
      rowButton('Axis + Apex', `Draw ${displayName} with axis and apex`,
        () => lvSimpsonPanelController?.onDrawSlot?.(slot, 'axisApex'));
    }
    if (ids.length && lvSimpsonPanelController?.onDeleteSlot) {
      rowButton('Delete', `Delete ${displayName} contour`,
        () => lvSimpsonPanelController?.onDeleteSlot?.(slot, ids));
    }
    panel.appendChild(row);
  }
  if (resultText) addText(resultText, { fontWeight: '700', fontSize: '18px', marginTop: '9px' });
  for (const detail of resultDetails) {
    addText(detail, { fontSize: '13px', paddingTop: '3px', color: '#e2e8f0' });
  }
  for (const warning of warnings) {
    addText(warning, { color: '#fcd34d', paddingTop: '5px' });
  }
  if (instruction) {
    const hint = addText(instruction, {
      marginTop: '10px',
      paddingTop: '8px',
      borderTop: '1px solid #475569',
    });
    hint.setAttribute('role', 'status');
  }
  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', gap: '8px', marginTop: '10px' });
  const button = (label: string, callback: () => void, once = true) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    Object.assign(item.style, {
      border: '1px solid #94a3b8',
      borderRadius: '6px',
      padding: '5px 10px',
      background: '#334155',
      color: '#ffffff',
      cursor: 'pointer',
    });
    item.addEventListener('click', callback, { once });
    controls.appendChild(item);
  };
  if (onContinue) button(continueLabel || 'Continue', onContinue);
  if (onCalculate) button('Calculate EF', onCalculate);
  if (onCapture) button('Capture calculated measurement', onCapture, false);
  if (onCancel) button(resultText ? 'Close panel' : 'Cancel EF', onCancel);
  panel.appendChild(controls);
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


// AR_DECELERATION_TIME:BEGIN target-dialog
function getDecelerationTimeTargetDialogConfig() {
  return {
    id: 'spectralDopplerDecelerationTimeTarget',
    labelOnMeasure: false,
    exclusive: true,
    items: getDecelerationTimeTargetOptions(),
  };
}

async function resolveDecelerationTimeTarget({ uiDialogService, customizationService } = {}) {
  const renderContent = customizationService.getCustomization('ui.labellingComponent');
  const options = getDecelerationTimeTargetOptions();
  let value = null;

  try {
    value = await callInputDialogAutoComplete({
      uiDialogService,
      labelConfig: getDecelerationTimeTargetDialogConfig(),
      renderContent,
      title: 'Deceleration Time Valve',
    });
  } catch (error) {
    console.warn('[Deceleration Time] target autocomplete failed; falling back to text input:', error);
    value = await callInputDialog({
      uiDialogService,
      title: 'Deceleration Time Valve',
      placeholder: options.map(option => option.label).join(', '),
      defaultValue: options[0]?.label || 'MV Deceleration Time',
    });
  }

  return normalizeDecelerationTimeTargetSelection(value);
}
// AR_DECELERATION_TIME:END target-dialog

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


function getBowelCurvedLengthTargetDialogConfig({ isIuscan = false } = {}) {
  return {
    id: 'bowelCurvedLengthReportTarget',
    labelOnMeasure: false,
    exclusive: true,
    items: getBowelCurvedLengthTargetOptions({ isIuscan }),
  };
}

async function resolveBowelCurvedLengthTarget({
  uiDialogService,
  customizationService,
} = {}) {
  const renderContent = customizationService.getCustomization('ui.labellingComponent');
  const isIuscan = isIuscanBowelViewerContext();
  const options = getBowelCurvedLengthTargetOptions({ isIuscan });
  let value = null;

  if (!options.length) {
    return null;
  }

  try {
    value = await callInputDialogAutoComplete({
      uiDialogService,
      labelConfig: getBowelCurvedLengthTargetDialogConfig({ isIuscan }),
      renderContent,
      title: 'Curved Length Measurement Type',
    });
  } catch (error) {
    console.warn(
      '[Bowel Curved Length] target autocomplete failed; falling back to text input:',
      error
    );

    value = await callInputDialog({
      uiDialogService,
      title: 'Curved Length Measurement Type',
      placeholder: options.map(option => option.label).join(', '),
      defaultValue: options[0]?.label || '',
    });
  }

  return normalizeBowelMeasurementTargetSelection(value, {
    measurementKind: BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
  });
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

/**
 * Educator-only reference-location circle for multiple BWT gold calipers.
 * `radiusMm` is calibrated millimetres, not Cornerstone world coordinates.
 * Derive a true circle in image-physical space from the saved 2x4
 * world-to-image affine and DICOM pixel spacing. Project each point to the
 * current viewport; this handles unequal row/column spacing and rotation.
 * This visual guide does NOT participate in multi-BWT scoring.
 */
function appendViewerQuizBowelGoldRadiusOutline({
  viewport, quizSpatialEvidence, radiusMm, focused = false,
}: {
  viewport: any;
  quizSpatialEvidence: any;
  radiusMm: number;
  focused?: boolean;
}) {
  const element = viewport?.element;
  const evidence = quizSpatialEvidence;
  const worldPoints = evidence?.worldPoints;
  const affine = evidence?.worldToImageAffine;
  const spacing = evidence?.pixelSpacing;
  const rowMm = Number(spacing?.row);
  const columnMm = Number(spacing?.column);
  const radius = Number(radiusMm);
  const point3 = (p: any) =>
    Array.isArray(p) && p.length === 3 &&
    p.every((v: any) => typeof v === 'number' && Number.isFinite(v));
  if (!element || typeof viewport.worldToCanvas !== 'function' ||
      !(radius > 0) || !Number.isFinite(radius) ||
      !Number.isFinite(rowMm) || !Number.isFinite(columnMm) ||
      !(rowMm > 0) || !(columnMm > 0) ||
      !Array.isArray(worldPoints) || worldPoints.length !== 2 ||
      !worldPoints.every(point3) ||
      !Array.isArray(affine) || affine.length !== 2 ||
      affine.some((row: any) => !Array.isArray(row) || row.length !== 4 ||
        row.some((v: any) => typeof v !== 'number' || !Number.isFinite(v)))) {
    return false;
  }
  const axisI = affine[0].slice(0, 3);
  const axisJ = affine[1].slice(0, 3);
  const dot3 = (a: number[], b: number[]) =>
    a.reduce((sum, value, i) => sum + value * b[i], 0);
  const aa = dot3(axisI, axisI);
  const ab = dot3(axisI, axisJ);
  const bb = dot3(axisJ, axisJ);
  const determinant = aa * bb - ab * ab;
  if (!Number.isFinite(determinant) || determinant <= 1e-12) return false;
  const midpoint = worldPoints[0].map((value: number, i: number) =>
    (value + worldPoints[1][i]) / 2);
  const canvasPoints: Array<[number, number]> = [];
  for (let step = 0; step < 64; step++) {
    const theta = 2 * Math.PI * step / 64;
    const dx = radius * Math.cos(theta) / columnMm;
    const dy = radius * Math.sin(theta) / rowMm;
    const a = (bb * dx - ab * dy) / determinant;
    const b = (aa * dy - ab * dx) / determinant;
    const world = midpoint.map((value: number, i: number) =>
      value + a * axisI[i] + b * axisJ[i]);
    let canvas: number[];
    try { canvas = viewport.worldToCanvas(world); } catch { return false; }
    if (!Array.isArray(canvas) || canvas.length < 2 ||
        !Number.isFinite(canvas[0]) || !Number.isFinite(canvas[1])) {
      return false;
    }
    canvasPoints.push([canvas[0], canvas[1]]);
  }
  const previousPosition = element.style.position;
  if (!previousPosition || previousPosition === 'static') {
    element.style.position = 'relative';
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add(VIEWER_QUIZ_MARKER_OVERLAY_CLASS);
  svg.dataset.reviewState = 'bowel-gold-reference-radius';
  svg.setAttribute('width', String(element.clientWidth));
  svg.setAttribute('height', String(element.clientHeight));
  svg.setAttribute('viewBox', `0 0 ${element.clientWidth} ${element.clientHeight}`);
  svg.setAttribute('aria-label', `Gold BWT reference radius ${radius} mm, visual guide only`);
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '29';
  const outline = document.createElementNS(ns, 'path');
  outline.setAttribute('d', canvasPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' Z');
  outline.setAttribute('stroke', focused ? '#fbbf24' : '#c084fc');
  outline.setAttribute('stroke-width', focused ? '2.5' : '2');
  outline.setAttribute('stroke-dasharray', '5 3');
  outline.setAttribute('fill', focused ? 'rgba(251, 191, 36, 0.09)' : 'rgba(192, 132, 252, 0.06)');
  svg.appendChild(outline);
  element.appendChild(svg);
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

/**
 * The quiz definition exclusively owns educator multi-BWT gold geometry.
 * Reconstruct a display-only Length annotation from that JSON, independently
 * of any Series MeasurementAnnotations. No scoring/persistence uses this.
 */
function buildViewerQuizGoldBwtDisplaySource(reference: any = {}) {
  const clean = (value: any) => String(value ?? '').trim();
  const target = asViewerQuizPlainObject(reference?.viewerTarget);
  const evidence = asViewerQuizPlainObject(reference?.quizSpatialEvidence);
  const validPoint = (p: any) =>
    Array.isArray(p) && p.length === 3 && p.every((n: any) =>
      typeof n === 'number' && Number.isFinite(n));
  const sourceAnnotationId = getViewerQuizMeasurementSourceAnnotationId(reference);
  const points = evidence.worldPoints;
  const frame = Number(target.frameNumber);
  const value = Number(reference.value);
  if (!sourceAnnotationId || reference.measurementKind !== 'length' ||
      !/BWT/i.test(clean(reference.measurementType)) ||
      clean(reference.unit).toLowerCase() !== 'mm' ||
      !Number.isFinite(value) || value <= 0 ||
      evidence.source !== 'dicom-calibrated-image-index-v1' ||
      !Array.isArray(points) || points.length !== 2 ||
      !points.every(validPoint) ||
      !clean(target.studyInstanceUID) ||
      !clean(target.seriesInstanceUID) ||
      !clean(target.sopInstanceUID) ||
      !clean(target.referencedImageId) ||
      !Number.isSafeInteger(frame) || frame < 1) {
    return null;
  }
  return {
    annotationId: sourceAnnotationId,
    uid: sourceAnnotationId,
    // Explicitly a temporary display overlay, never a persisted measurement.
    workflow: 'viewerQuizGoldDisplay',
    toolName: 'Length',
    label: clean(reference.measurementType),
    measurementRole: clean(reference.measurementType),
    StudyInstanceUID: clean(target.studyInstanceUID),
    SeriesInstanceUID: clean(target.seriesInstanceUID),
    SOPInstanceUID: clean(target.sopInstanceUID),
    referencedImageId: clean(target.referencedImageId),
    frameNumber: frame,
    points: points.map((point: number[]) => [...point]),
    measurements: {
      value,
      length: value,
      unit: 'mm',
      lengthUnit: 'mm',
    },
    isLocked: true,
  };
}

/**
 * Multi-BWT review must read verified learner evidence from the learner copy,
 * not from a client-supplied annotation snapshot or the source teaching case.
 */
function findViewerQuizBowelLearnerAnnotation(reference: any, learnerSeriesDoc: any) {
  if (learnerSeriesDoc?.isLearnerCopy !== true) return null;
  const sourceId = getViewerQuizMeasurementSourceAnnotationId(reference);
  if (!sourceId) return null;
  const matches = getRequestedWorkflowAnnotations(
    learnerSeriesDoc.MeasurementAnnotations
  ).filter(item => getMeasurementAnnotationId(item) === sourceId);
  return matches.length === 1 ? matches[0] : null;
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
  rubricFocused: buildViewerQuizMeasurementStateStyle({
    color: 'rgb(251, 191, 36)',
    background: 'rgba(92, 53, 5, 0.9)',
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
    attemptOwner: String(qs.get('arAttemptOwner') || '').trim(),
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

function isReportOwnedLearnerMeasurementTarget(saveTarget: any = {}) {
  return (
    saveTarget.attemptOwner === 'report' &&
    !!String(saveTarget.learnerSeriesId || '').trim() &&
    isLearnerCopyOnSaveTarget(saveTarget)
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

    canonicalReversed.push(compactClinicalViewerVolumeAnnotationStorage(measurement));
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

async function fetchClinicalViewerSeriesDocCached(seriesId) {
  const id = String(seriesId || '').trim();

  if (!id) {
    return null;
  }

  if (clinicalViewerSeriesReadCache.has(id)) {
    return clinicalViewerSeriesReadCache.get(id);
  }

  const pendingRequest = clinicalViewerSeriesReadPending.get(id);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = fetchSeriesDocById(id)
    .then(seriesDoc => {
      if (seriesDoc?._id) {
        clinicalViewerSeriesReadCache.set(id, seriesDoc);
      }

      return seriesDoc;
    })
    .finally(() => {
      clinicalViewerSeriesReadPending.delete(id);
    });

  clinicalViewerSeriesReadPending.set(id, request);

  return request;
}

function rememberClinicalViewerSeriesDoc(seriesDoc: any = null) {
  const id = String(seriesDoc?._id || '').trim();

  if (!id) {
    return;
  }

  clinicalViewerSeriesReadCache.set(id, seriesDoc);
  clinicalViewerSeriesReadPending.delete(id);
}

async function resolveViewerReadSeriesDoc(servicesManager, { allowBaseFallback = true } = {}) {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (isClinicalReportMeasurementsSaveTarget(saveTarget)) {
    return fetchClinicalViewerSeriesDocCached(saveTarget.seriesId);
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

  // Report-first attempts must use the exact report-selected learner copy.
  // Never fall through to a viewer-owned ensure-learner-copy operation.
  if (saveTarget.attemptOwner === 'report') {
    if (!isReportOwnedLearnerMeasurementTarget(saveTarget)) {
      throw new Error('Open View Echo from the report to resolve its learner attempt before saving measurements.');
    }
    return fetchSeriesDocById(saveTarget.learnerSeriesId);
  }

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
  const viewerMeasurementsModifiedInSession = new Set<string>();
  const viewerMeasurementsDeletedInSession = new Set<string>();
  const viewerQuizMeasurementComparisonAnnotationIds = new Set<string>();
  const viewerQuizGoldEFDisplayAnnotationIds = new Set<string>();
  const {
    viewportGridService,
    toolGroupService,
    cineService,
    uiDialogService,
    cornerstoneViewportService,
    uiNotificationService,
    measurementService,
    customizationService,
    toolbarService,
    colorbarService,
    hangingProtocolService,
    syncGroupService,
    segmentationService,
    displaySetService,
  } = servicesManager.services as AppTypes.Services;

  // The guided EF workflow captures drags directly, without a native EF tool
  // binding. Keep Length passive until EF finishes or is cancelled; otherwise
  // both the quiz and AR Measurements panels can steal the mouse between steps.
  const lvSimpsonMouseTools = createGuidedMouseToolOwnership([
    { mouseButton: Enums.MouseBindings.Primary },
  ]);
  // LA Volume uses the same direct-drag interaction, but has its own
  // independent session and must not activate Length between the two slots.
  const laVolumeMouseTools = createGuidedMouseToolOwnership([
    { mouseButton: Enums.MouseBindings.Primary },
  ]);
  const refreshLVSimpsonToolbarState = () => {
    toolbarService?.refreshToolbarState?.({
      viewportId: viewportGridService.getActiveViewportId(),
    });
  };
  // EF owns direct pointer drags rather than a native primary mouse tool.
  toolbarService?.registerEvaluateFunction?.('evaluate.arGuidedLVSimpson', () => ({
    disabled: false,
    isActive: lvSimpsonMouseTools.isActive(),
  }));
  // Quiz context highlights existing custom measurement toolbar buttons without
  // activating a generic annotation or changing clinical tool acquisition.
  let activeQuizMeasurementKind = '';
  const quizToolbarEvaluators = {
    'evaluate.arQuizLAVolume': ['laVolumeBiplane', 'laVolumeBiplaneDisks'],
    'evaluate.arQuizRAArea': ['raArea'],
    'evaluate.arQuizRVFAC': ['rvFAC'],
    'evaluate.arQuizSpectralVmax': ['trVmax'],
  };
  Object.entries(quizToolbarEvaluators).forEach(([name, kinds]) => {
    toolbarService?.registerEvaluateFunction?.(name, () =>
      kinds.includes(activeQuizMeasurementKind) ? { isActive: true } : {}
    );
  });
  const setQuizToolbarMeasurementKind = (measurementKind = '') => {
    const next = String(measurementKind || '').trim();
    if (activeQuizMeasurementKind === next) return;
    activeQuizMeasurementKind = next;
    toolbarService?.refreshToolbarState?.({
      viewportId: viewportGridService.getActiveViewportId(),
    });
  };
  let suppressLVSimpsonRecoveryEvents = 0;

  // Length's label-dialog cancellation only runs after the second click.
  // While its drawing is still in progress, delegate Escape to Cornerstone's
  // native LengthTool.cancel rather than completing/labeling the annotation.
  let cancelPendingLengthOnEscape: null | ((event: KeyboardEvent) => void) = null;

  function updatePendingLengthEscapeHandler(toolName: string, toolGroup: any) {
    if (cancelPendingLengthOnEscape) {
      window.removeEventListener('keydown', cancelPendingLengthOnEscape, true);
      cancelPendingLengthOnEscape = null;
    }
    if (toolName !== 'Length') return;

    cancelPendingLengthOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"]')) {
        return;
      }

      const activeViewportId = viewportGridService.getActiveViewportId();
      const activeReference = toolGroupService.getToolGroupForViewport(activeViewportId);
      const activeGroup = typeof activeReference === 'string'
        ? toolGroupService.getToolGroup(activeReference)
        : activeReference;
      if (activeGroup !== toolGroup || activeGroup?.getActivePrimaryMouseButtonTool?.() !== 'Length') return;

      const lengthTool = activeGroup.getToolInstance?.('Length');
      if (!lengthTool?.isDrawing || typeof lengthTool.cancel !== 'function') return;
      const viewportElement = _getActiveViewportEnabledElement()?.viewport?.element;
      if (!viewportElement) return;

      const cancelledAnnotationId = lengthTool.cancel(viewportElement);
      if (!cancelledAnnotationId) return;

      // Native cancellation may leave a provisional state annotation behind.
      // Remove it only when it has never become a persisted measurement.
      const unfinished = cornerstoneTools.annotation.state.getAnnotation?.(cancelledAnnotationId);
      if (
        unfinished?.metadata?.toolName === 'Length' &&
        !measurementService.getMeasurement?.(cancelledAnnotationId)
      ) {
        cornerstoneTools.annotation.state.removeAnnotation?.(cancelledAnnotationId);
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', cancelPendingLengthOnEscape, true);
  }

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

  async function getViewerQuizMeasurementSeriesDocs({ includeBaseSeries = true } = {}) {
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

    if (includeBaseSeries && baseSeriesId && baseSeriesId !== String(learnerSeriesDoc?._id || '')) {
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

  function applyVerifiedEFGoldLabel(annotationId: string, slot: string, gold: any, hydrated?: any) {
    const areaRaw = gold?.compositeResult?.derived?.slotAreaCM2?.[slot];
    if (areaRaw === null || areaRaw === undefined || areaRaw === '') return;
    const area = Number(areaRaw);
    if (!Number.isFinite(area) || area <= 0) return;
    const savedComponent = gold?.compositeResult?.components?.find(
      (component: any) => component?.slot === slot
    );
    if (!savedComponent?.annotationId ||
        !['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'].includes(slot)) return;
    const source = annotation.state.getAnnotation?.(annotationId) || hydrated;
    if (!source) return;
    const rawAxis = gold?.compositeResult?.derived?.slotLongAxisMM?.[slot];
    const axis = rawAxis == null || rawAxis === '' ? null : Number(rawAxis);
    const lv = source.data?.lvSimpson;
    const sourceArea = lv && !lv.calibrationError
      ? calibratedLVContourAreaCM2(lv.calibratedContourPoints) : null;
    if (sourceArea != null && Math.abs(sourceArea - area) > 0.02) {
      // Aggregate, no DICOM identifiers or coordinates in diagnostics.
      console.warn('[ViewerQuiz] calibrated EF source area differs from saved gold', {
        slot, goldAreaCM2: area, sourceAreaCM2: sourceArea,
      });
    }
    source.data = {
      ...(source.data || {}),
      arVerifiedQuizEFGoldContour: {
        origin: 'quiz-gold', slot, areaCM2: area,
        sourceAreaCM2: sourceArea,
        axisMM: Number.isFinite(axis) && axis > 0 ? axis : null,
      },
    };
    viewerQuizGoldEFDisplayAnnotationIds.add(annotationId);
  }

  function clearViewerQuizMeasurementComparisonAnnotations() {
    for (const annotationId of viewerQuizGoldEFDisplayAnnotationIds) {
      const source = annotation.state.getAnnotation?.(annotationId);
      if (source?.data?.arVerifiedQuizEFGoldContour?.origin === 'quiz-gold') {
        delete source.data.arVerifiedQuizEFGoldContour;
      }
    }
    viewerQuizGoldEFDisplayAnnotationIds.clear();
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

  // These one-contour chamber-area sessions share a single ownership boundary.
  // Cancelling or switching tools must never label an unrelated freehand ROI.
  let activeEchoAreaSessionId = '';
  let rvFACGuidedCancel: null | (() => void) = null;
  let echoAreaCompletionHandler: null | ((event: Event) => void) = null;
  let echoAreaEscapeHandler: null | ((event: KeyboardEvent) => void) = null;

  function clearEchoAreaWorkflowListeners() {
    const cancelGuided = rvFACGuidedCancel;
    rvFACGuidedCancel = null;
    cancelGuided?.();
    if (echoAreaCompletionHandler) {
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_COMPLETED, echoAreaCompletionHandler);
      echoAreaCompletionHandler = null;
    }
    if (echoAreaEscapeHandler) {
      window.removeEventListener('keydown', echoAreaEscapeHandler);
      echoAreaEscapeHandler = null;
    }
    activeEchoAreaSessionId = '';
  }

  let activeSpectralDopplerWorkflowSessionId = '';
  let spectralDopplerCompletionHandler: null | ((event: Event) => void) = null;
  let spectralDopplerEscapeHandler: null | ((event: KeyboardEvent) => void) = null;

  // AR_DECELERATION_TIME:BEGIN listener-state
  let activeDecelerationTimeWorkflowSessionId = '';
  let decelerationTimeCompletionHandler: null | ((event: Event) => void) = null;
  let decelerationTimeEscapeHandler: null | ((event: KeyboardEvent) => void) = null;

  function clearDecelerationTimeWorkflowListeners({ resetSession = true } = {}) {
    if (decelerationTimeCompletionHandler) {
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_COMPLETED, decelerationTimeCompletionHandler);
      decelerationTimeCompletionHandler = null;
    }
    if (decelerationTimeEscapeHandler) {
      window.removeEventListener('keydown', decelerationTimeEscapeHandler);
      decelerationTimeEscapeHandler = null;
    }
    if (resetSession) activeDecelerationTimeWorkflowSessionId = '';
  }
  // AR_DECELERATION_TIME:END listener-state

  let activeUltrasoundDirectionalWorkflowSessionId = '';
  let ultrasoundDirectionalCompletionHandler: null | ((event: Event) => void) = null;
  let spectralVmaxClickCleanup: null | (() => void) = null;

  function clearUltrasoundDirectionalWorkflowListeners({ resetSession = true } = {}) {
    spectralVmaxClickCleanup?.();
    spectralVmaxClickCleanup = null;
    if (ultrasoundDirectionalCompletionHandler) {
      eventTarget.removeEventListener(
        Enums.Events.ANNOTATION_COMPLETED,
        ultrasoundDirectionalCompletionHandler
      );
      ultrasoundDirectionalCompletionHandler = null;
    }

    if (resetSession) {
      activeUltrasoundDirectionalWorkflowSessionId = '';
    }
  }

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

  let activeBowelCurvedLengthWorkflowSessionId = '';
  let bowelCurvedLengthCompletionHandler: null | ((event: Event) => void) = null;
  let bowelCurvedLengthEscapeHandler: null | ((event: KeyboardEvent) => void) = null;

  function clearBowelCurvedLengthWorkflowListeners({ resetSession = true } = {}) {
    if (bowelCurvedLengthCompletionHandler) {
      eventTarget.removeEventListener(
        Enums.Events.ANNOTATION_COMPLETED,
        bowelCurvedLengthCompletionHandler
      );
      bowelCurvedLengthCompletionHandler = null;
    }

    if (bowelCurvedLengthEscapeHandler) {
      window.removeEventListener('keydown', bowelCurvedLengthEscapeHandler);
      bowelCurvedLengthEscapeHandler = null;
    }

    if (resetSession) {
      activeBowelCurvedLengthWorkflowSessionId = '';
    }
  }

  function cancelActiveLVSimpsonCapture() {
    const cancel = activeLVSimpsonCaptureCancel;
    activeLVSimpsonCaptureCancel = null;
    cancel?.();
  }

  function cancelActiveLAVolumeCapture() {
    const cancel = activeLAVolumeCaptureCancel;
    activeLAVolumeCaptureCancel = null;
    cancel?.();
  }

  function clearLVSimpsonWorkflowIfCurrent(workflowSessionId = '') {
    if (activeLVSimpsonWorkflowSessionId !== workflowSessionId) {
      return false;
    }

    activeLVSimpsonWorkflowSessionId = '';
    cancelActiveLVSimpsonCapture();
    lvSimpsonMouseTools.restore();
    refreshLVSimpsonToolbarState();
    hideLVSimpsonWorkflowPanel();
    return true;
  }

  function clearLAVolumeWorkflowIfCurrent(workflowSessionId = '') {
    if (activeLAVolumeWorkflowSessionId !== workflowSessionId) {
      return false;
    }

    activeLAVolumeWorkflowSessionId = '';
    cancelActiveLAVolumeCapture();
    laVolumeMouseTools.restore();
    return true;
  }

  const actions = {
    clearViewerMeasurementsCreatedInSession: () => {
      viewerMeasurementsCreatedInSession.clear();
      viewerMeasurementsModifiedInSession.clear();
      viewerMeasurementsDeletedInSession.clear();
      lvSimpsonSessionMeasurementsByUid.clear();
      laVolumeSessionMeasurementsByUid.clear();
      clearCineCommentSessionMeasurements();
      cancelActiveLVSimpsonCapture();
      lvSimpsonMouseTools.restore();
      refreshLVSimpsonToolbarState();
      cancelActiveLAVolumeCapture();
      laVolumeMouseTools.restore();
      activeLVSimpsonWorkflowSessionId = '';
      activeLAVolumeWorkflowSessionId = '';
      hideLVSimpsonWorkflowPanel();
      clearSpectralDopplerWorkflowListeners();
      clearEchoAreaWorkflowListeners();
      clearDecelerationTimeWorkflowListeners(); // AR_DECELERATION_TIME
      clearBowelCurvedLengthWorkflowListeners();
      dispatchLVSimpsonSessionMeasurements({ reason: 'viewer-session-cleared' });
      dispatchLAVolumeSessionMeasurements({ reason: 'viewer-session-cleared' });
    },

    markViewerMeasurementCreatedInSession: ({ uid }: { uid?: string } = {}) => {
      const measurementId = String(uid || '').trim();

      if (!measurementId) {
        return '';
      }

      viewerMeasurementsDeletedInSession.delete(measurementId);
      viewerMeasurementsModifiedInSession.delete(measurementId);
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

    markViewerMeasurementModifiedInSession: ({ uid }: { uid?: string } = {}) => {
      const measurementId = String(uid || '').trim();

      if (
        !measurementId ||
        viewerMeasurementsCreatedInSession.has(measurementId) ||
        viewerMeasurementsDeletedInSession.has(measurementId)
      ) {
        return measurementId;
      }

      viewerMeasurementsModifiedInSession.add(measurementId);
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
      const renderContent = customizationService.getCustomization('ui.labellingComponent');
      const measurement = measurementService.getMeasurement(uid);

      // Cancellation must not delete an existing/rehydrated annotation.
      // Only the freshly completed Length awaiting its first label is discardable.
      const discardPendingLength = () => {
        const currentAnnotation = cornerstoneTools.annotation.state.getAnnotation?.(uid);
        if (
          currentAnnotation?.metadata?.toolName !== 'Length' ||
          currentAnnotation?.data?.arPendingLengthLabel !== true
        ) {
          return;
        }

        viewerMeasurementsCreatedInSession.delete(uid);
        viewerMeasurementsModifiedInSession.delete(uid);
        viewerMeasurementsDeletedInSession.delete(uid);
        cornerstoneTools.annotation.selection.setAnnotationSelected?.(uid, false);
        if (measurementService.getMeasurement?.(uid)) {
          measurementService.remove(uid);
        }
        cornerstoneTools.annotation.state.removeAnnotation?.(uid);
        cornerstoneViewportService.getRenderingEngine()?.render?.();
      };
      const finishPendingLength = () => {
        const currentAnnotation = cornerstoneTools.annotation.state.getAnnotation?.(uid);
        if (currentAnnotation?.data?.arPendingLengthLabel) {
          delete currentAnnotation.data.arPendingLengthLabel;
        }
      };

      if (!measurement) {
        console.debug('No measurement found for label editing');
        return null;
      }

      // Learner IVC phase buttons already identify expiration/inspiration.
      // The question panel assigns the actual label by validated annotation
      // ID and DICOM source. Suppress only the first-label dialog for a newly
      // drawn Length in explicitly requested quiz measure-only mode.
      // Do not bypass ordinary clinical/bowel labeling or manual relabeling.
      const pendingAnnotation = cornerstoneTools.annotation.state.getAnnotation?.(uid);
      const labelDecision = consumeViewerLengthFirstLabelMode({
        mode: viewerLengthLabelMode,
        toolName: measurement.toolName,
        pendingFirstLabel: pendingAnnotation?.metadata?.toolName === 'Length' &&
          pendingAnnotation?.data?.arPendingLengthLabel === true,
      });
      if (labelDecision.suppress) {
        // The IVC exemption is single-use; the next Length must prompt.
        viewerLengthLabelMode = labelDecision.nextMode;
        window.dispatchEvent(new CustomEvent('ar-learning:quiz-measurement-added', {
          detail: { measurementId: uid },
        }));
        return String(measurement.label || 'Length');
      }

      let labelConfig = options.labelConfigOverride;

      if (!labelConfig && measurement?.toolName === 'Length') {
        const stateAnnotation = cornerstoneTools.annotation.state.getAnnotation?.(uid);
        let measurementDomain = normalizeViewerMeasurementDomain(
          measurement?.domain ||
            measurement?.measurementDomain ||
            stateAnnotation?.metadata?.arMeasurementDomain ||
            stateAnnotation?.data?.arMeasurementDomain ||
            ''
        );

        // The active viewer context is more reliable for label UI than a generic
        // series lookup. In particular, an echo Length must never inherit the
        // bowel customization simply because another measurement container was
        // resolved first.
        if (!measurementDomain || measurementDomain === 'generic') {
          const viewerContextDomain = inferDomainWithoutSeriesDoc('');

          if (viewerContextDomain && viewerContextDomain !== 'generic') {
            measurementDomain = viewerContextDomain;
          }
        }

        if (!measurementDomain || measurementDomain === 'generic') {
          try {
            const seriesDoc = await resolveViewerReadSeriesDoc(servicesManager, {
              allowBaseFallback: false,
            });

            if (seriesDoc) {
              measurementDomain = inferDomainFromSeriesDoc(seriesDoc, '');
            }
          } catch (error) {
            console.warn('[AR Measurements] could not resolve Length label domain:', error);
          }
        }

        labelConfig = getLengthMeasurementLabelConfigForDomain(measurementDomain);
      }

      if (!labelConfig) {
        labelConfig = customizationService.getCustomization('measurementLabels');
      }

      const normalizedLabelConfig = normalizeMeasurementLabelConfigForDialog(
        labelConfig,
        options.title
      );
      const dialogTitle = getMeasurementLabelDialogTitle(normalizedLabelConfig, options.title);

      if (!normalizedLabelConfig) {
        const label = await callInputDialog({
          uiDialogService,
          title: dialogTitle || 'Measurement Annotation',
          placeholder: options.placeholder || measurement.label || 'Enter new label',
          defaultValue: measurement.label,
        });

        if (label !== undefined && label !== null) {
          const nextLabel = options.normalizeLabel ? options.normalizeLabel(label) : label;
          finishPendingLength();
          measurementService.update(uid, { ...measurement, label: nextLabel }, true);
          if (measurement?.toolName === 'Length' && String(nextLabel).trim()) {
            window.dispatchEvent(new CustomEvent('ar-learning:quiz-measurement-labelled', {
              detail: { measurementId: uid },
            }));
          }
          return nextLabel;
        }
        discardPendingLength();
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
        finishPendingLength();
        measurementService.update(uid, { ...measurement, label: nextLabel }, true);
        if (measurement?.toolName === 'Length' && String(nextLabel).trim()) {
          window.dispatchEvent(new CustomEvent('ar-learning:quiz-measurement-labelled', {
            detail: { measurementId: uid },
          }));
        }
        return nextLabel;
      }

      discardPendingLength();
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
      return actions._handleMeasurementLabelDialog(uid, {
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
      efContourTargets = null,
      questionKey = '',
      viewportId: requestedViewportId = '',
      captureMethod = 'axisApex',
    } = {}) => {
      clearUltrasoundDirectionalWorkflowListeners();
      const isClinicalReportWorkflow = isClinicalReportMeasurementsSaveTarget(getArViewerSaveTargetFromUrl());
      const workflowSessionId = requestedSessionId || `${csUtils.uuidv4()}`;

      if (!requestedSessionId) {
        // A new contour workflow invalidates any previous explicit EF.
        explicitLVSimpsonResult = null;
        reviewedLVSimpsonEF = null;
        cancelActiveLVSimpsonCapture();
        lvSimpsonMouseTools.restore();
        activeLVSimpsonWorkflowSessionId = workflowSessionId;
      }

      const isWorkflowCancelled = () => activeLVSimpsonWorkflowSessionId !== workflowSessionId;
      let { viewport } = _getActiveViewportEnabledElement() || {};
      let activeViewportId = requestedViewportId || viewportGridService.getActiveViewportId();
      if (requestedViewportId) {
        viewport = cornerstoneViewportService.getCornerstoneViewport(requestedViewportId) || viewport;
      }

      if (!viewport?.element || !activeViewportId) {
        uiNotificationService.show({
          title: 'LV EF',
          message: 'No active image viewport is available.',
          type: 'warning',
          duration: 3500,
        });
        clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
        return null;
      }

      if (isWorkflowCancelled()) {
        return null;
      }

      // EF-specific, read-only persistence diagnostic. On reopen the normal
      // initial hydrate is panel-only, so restoredCount=0 says nothing about
      // whether source contours were saved. Query the learner Series itself.
      if (!requestedSessionId) {
        try {
          const stored = await actions.getViewerMeasurementAnnotationsForActiveStudy({
            workflows: ['viewerMeasurements'],
            includeRepeated: false,
          });
          const saved = Array.isArray(stored?.annotations) ? stored.annotations : [];
          const efSaved = saved.filter(entry => Boolean(getLVSimpsonSlotFromMeasurement(entry)));
          const bySlot = getLVSimpsonSlotCandidates(efSaved);
          console.info('[LV EF saved-slot audit]', {
            persistedAnnotationCount: saved.length,
            persistedEFCount: efSaved.length,
            persistedSlots: Object.fromEntries(
              LV_TRACE_REQUIRED_SLOTS.map(slot => [slot, bySlot.get(slot)?.length || 0])
            ),
            allEFSlotsPresent: LV_TRACE_REQUIRED_SLOTS.every(slot => bySlot.get(slot)?.length === 1),
            saveTargetPresent: Boolean(stored?.saveTarget),
          });
          // Initial study hydration is deliberately panel-only. On explicit EF
          // question opening, recover each saved source on its own DICOM frame
          // via the existing saved-annotation navigation/hydration service.
          // Never mistake a persisted quiz answer for a persisted contour.
          const slotRestoration: Record<string, string> = {};
          if (efSaved.length > 0) {
            for (const slot of LV_TRACE_REQUIRED_SLOTS) {
              if (isWorkflowCancelled()) return null;
              const candidates = bySlot.get(slot) || [];
              if (candidates.length !== 1) {
                slotRestoration[slot] = candidates.length ? 'duplicate' : 'missing';
                continue;
              }
              const savedContour = candidates[0];
              const savedId = getMeasurementAnnotationId(savedContour);
              if (!savedId) {
                slotRestoration[slot] = 'missing-id';
                continue;
              }
              const existing = cornerstoneTools.annotation.state.getAnnotation?.(savedId);
              if (existing &&
                  !isSavedLVSimpsonImageMatch(savedContour, existing?.metadata?.referencedImageId)) {
                // Remove misplaced legacy state; the authoritative source is
                // the saved SOP/frame, not the image currently shown.
                cornerstoneTools.annotation.state.removeAnnotation?.(savedId);
              }
              if (!cornerstoneTools.annotation.state.getAnnotation?.(savedId)) {
                const outcome = await actions.jumpToSavedViewerAnnotation({
                  annotation: savedContour,
                  selectAnnotation: false,
                  runDelayedDisplayRefresh: false,
                });
                if (outcome?.ok !== true) {
                  slotRestoration[slot] = outcome?.reason || 'hydration-failed';
                  continue;
                }
              }
              const restored = getCornerstoneVolumeMeasurementFallback(savedId);
              // Cornerstone may group cine images under one FrameOfReferenceUID.
              // A live state hit is not sufficient: verify SOP and frame before
              // trusting saved EF geometry for review or recalculation.
              if (restored && !isSavedLVSimpsonImageMatch(savedContour, restored.referencedImageId)) {
                slotRestoration[slot] = 'image-frame-mismatch';
                continue;
              }
              if (!restored?.lvSimpson || getLVSimpsonSlotFromMeasurement(restored) !== slot) {
                slotRestoration[slot] = 'missing-live-geometry';
                continue;
              }
              upsertLVSimpsonSessionMeasurement({
                ...restored,
                lvSimpson: savedContour.lvSimpson || savedContour.measurements?.lvSimpson,
                referenceStudyUID: savedContour.StudyInstanceUID || restored.referenceStudyUID,
                referenceSeriesUID: savedContour.SeriesInstanceUID || restored.referenceSeriesUID,
              });
              slotRestoration[slot] = 'restored';
            }
            console.info('[LV EF saved-slot restoration]', {
              restored: Object.values(slotRestoration).filter(value => value === 'restored').length,
              slots: slotRestoration,
            });
          }
        } catch (error) {
          console.warn('[LV EF saved-slot audit] read failed', {
            errorType: error?.name || 'Error',
            status: Number(error?.response?.status || error?.status || 0) || null,
          });
        }
        if (isWorkflowCancelled()) return null;
      }

      const liveMeasurements = measurementService.getMeasurements?.() || [];
      const sessionLVSimpsonMeasurements = getLVSimpsonSessionMeasurements();

      const slotCandidates = getLVSimpsonSlotCandidates([
        ...liveMeasurements,
        ...sessionLVSimpsonMeasurements,
      ]);
      const explicitSlot = normalizeLVSimpsonSlot(requestedSlot);
      const nextMissingSlot = getNextMissingLVSimpsonSlot(slotCandidates);
      // When every restored slot already exists, opening the EF quiz question
      // is a review action, not permission to overwrite A4C ED or restart
      // the 4-step guided drawing workflow.
      const reviewExistingContours = !requestedSessionId && !explicitSlot && !nextMissingSlot;

      let slotSelection = explicitSlot ? buildLVSimpsonSlotSelection(explicitSlot) : null;

      if (!slotSelection && nextMissingSlot) {
        slotSelection = buildLVSimpsonSlotSelection(nextMissingSlot);
      }

      if (!slotSelection && reviewExistingContours) {
        // Needed only to initialize the shared EF panel controller. No
        // drawing is started and the choice does not identify a Current slot.
        slotSelection = buildLVSimpsonSlotSelection('A4C_ED');
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
        clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
        return null;
      }

      // Selecting a guided EF question opens its first authored frame. A later
      // Continue performs its own jump before invoking this next slot.
      const initialTarget = !requestedSessionId && !reviewExistingContours
        ? getEFContourFrameTarget(efContourTargets, slotSelection.slotInfo.slot)
        : null;
      if (initialTarget && !isWorkflowCancelled()) {
        const currentImageId = String(viewport?.getCurrentImageId?.() || '');
        if (normalizeImageIdForCompare(currentImageId) !==
            normalizeImageIdForCompare(initialTarget.referencedImageId)) {
          const navigation = await actions.jumpToViewerQuizTarget({
            viewerTarget: initialTarget,
            questionKey,
          });
          if (isWorkflowCancelled()) return null;
          if (!didNavigateToExactEFContourFrame(navigation, initialTarget)) {
            uiNotificationService.show({
              title: 'LV EF',
              message: 'The authored contour instance/frame could not be opened. EF capture was not started.',
              type: 'warning',
              duration: 6000,
            });
            clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
            return null;
          }
          activeViewportId = navigation.viewportId || activeViewportId;
          viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId) || viewport;
        }
      }

      // Suspend the previously active mouse tool once for the full four-slot
      // workflow. A later Continue may switch to a different viewport/group.
      if (!lvSimpsonMouseTools.isActive()) {
        lvSimpsonMouseTools.start();
      }
      const efToolGroupReference = toolGroupService.getToolGroupForViewport(activeViewportId);
      const efToolGroup = typeof efToolGroupReference === 'string'
        ? toolGroupService.getToolGroup(efToolGroupReference)
        : efToolGroupReference;
      lvSimpsonMouseTools.suspend(efToolGroup);
      refreshLVSimpsonToolbarState();

      const { label, slotInfo } = slotSelection;
      const slotDisplayName = getLVSimpsonSlotDisplayName(slotInfo.slot);
      const stepNumber = getLVSimpsonStepNumber(slotInfo.slot);

      // The controller persists while the EF panel is open, including after
      // the four-contour drawing session has finished. Reuse the same actions
      // used by the Measurements panel rather than storing duplicate contours.
      if (!requestedSessionId || !lvSimpsonPanelController) {
        const activeDisplaySet = getActiveViewportDisplaySet({
          viewportGridService, displaySetService, viewportId: activeViewportId,
        });
        const efStudyInstanceId = String(
          activeDisplaySet?.StudyInstanceUID || activeDisplaySet?.studyInstanceUID || ''
        ).trim();
        const observedIds = new Set<string>();
        const isActiveStudy = () => {
          const viewportId = viewportGridService.getActiveViewportId();
          const displaySet = getActiveViewportDisplaySet({
            viewportGridService, displaySetService, viewportId,
          });
          const activeStudy = String(
            displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || ''
          ).trim();
          // Do not act on a stale EF panel after changing studies.
          return !!efStudyInstanceId && activeStudy === efStudyInstanceId;
        };
        const getStudyMeasurements = () => {
          // Read existing sources without running a synchronization/recalculation
          // pass during every UI render. In particular, panel refresh must not
          // substitute live geometry into EF session records.
          const byId = new Set<string>();
          return [
            ...(measurementService.getMeasurements?.() || []),
            ...getLVSimpsonSessionMeasurements(),
          ].filter(entry => {
            if (!getLVSimpsonSlotFromMeasurement(entry)) return false;
            const entryStudy = String(entry?.referenceStudyUID || entry?.StudyInstanceUID || '').trim();
            if (efStudyInstanceId && entryStudy && entryStudy !== efStudyInstanceId) return false;
            const id = getMeasurementAnnotationId(entry);
            if (id && byId.has(id)) return false;
            if (id) byId.add(id);
            return true;
          });
        };
        const cancelDrawingWithoutClosingPanel = () => {
          if (!activeLVSimpsonWorkflowSessionId) return;
          activeLVSimpsonWorkflowSessionId = '';
          cancelActiveLVSimpsonCapture();
          lvSimpsonMouseTools.restore();
          refreshLVSimpsonToolbarState();
        };
        const showRecovery = (message: string) => {
          const measurements = getStudyMeasurements();
          const missingSlot = getNextMissingLVSimpsonSlot(getLVSimpsonSlotCandidates(measurements));
          renderLVSimpsonWorkflowPanel({
            measurements,
            instruction: message,
            onCalculate: missingSlot ? null : lvSimpsonPanelController?.onCalculate,
            onCancel: () => {
              if (activeLVSimpsonWorkflowSessionId) {
                clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
              } else {
                hideLVSimpsonWorkflowPanel();
              }
            },
          });
        };
        lvSimpsonPanelController = {
          activeSlot: reviewExistingContours ? '' : slotInfo.slot,
          onCalculate: null,
          getMeasurements: getStudyMeasurements,
          setObservedIds(ids: string[]) {
            observedIds.clear();
            ids.forEach(id => observedIds.add(id));
          },
          canNavigateSlot(slot: string) {
            return isActiveStudy() && !!getEFContourFrameTarget(efContourTargets, slot);
          },
          async onNavigateSlot(slot: string) {
            if (!isActiveStudy()) return;
            const target = getEFContourFrameTarget(efContourTargets, slot);
            if (!target) return;
            cancelDrawingWithoutClosingPanel();
            let navigation: any = null;
            try {
              navigation = await actions.jumpToViewerQuizTarget({
                viewerTarget: target, questionKey,
              });
            } catch (error) {
              console.warn('[LV EF] authored contour selection jump failed:', error);
            }
            if (!didNavigateToExactEFContourFrame(navigation, target)) {
              uiNotificationService.show({
                title: 'LV EF',
                message: 'Could not open the educator-assigned instance and frame for this contour.',
                type: 'warning',
                duration: 6000,
              });
              return;
            }
            // Only mark the slot current after the requested frame is actually
            // displayed. Keep instructions/results intact and avoid a rerender.
            if (!isActiveStudy() || lvSimpsonPanelController !== this) return;
            this.activeSlot = slot;
            updateLVSimpsonCurrentSlotLabel(slot);
          },
          onDrawSlot(slot: string, method: string = 'freehand') {
            if (!LV_TRACE_REQUIRED_SLOTS.includes(slot) || !isActiveStudy()) return;
            // Starting a new session preserves authored frame targets from the
            // current EF question and reuses exact-frame navigation.
            if (activeLVSimpsonWorkflowSessionId) {
              clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
            } else {
              hideLVSimpsonWorkflowPanel();
            }
            void actions.startLVSimpsonEFWorkflow({
              slot, efContourTargets, questionKey, captureMethod: method,
              viewportId: viewportGridService.getActiveViewportId(),
            }).catch(error => console.warn('[LV EF] selected contour redraw failed:', error));
          },
          onDeleteSlot(slot: string, ids: string[]) {
            if (!LV_TRACE_REQUIRED_SLOTS.includes(slot) || !ids.length || !isActiveStudy()) return;
            const currentItems = getStudyMeasurements()
              .filter(item => getLVSimpsonSlotFromMeasurement(item) === slot);
            if (currentItems.some(item => {
              const id = getMeasurementAnnotationId(item);
              const source = id && cornerstoneTools.annotation.state.getAnnotation?.(id);
              return item?.isLocked || source?.isLocked || source?.data?.arMeasurementReadOnly;
            })) return;
            const currentIds = currentItems.map(getMeasurementAnnotationId).filter(Boolean);
            const targets = ids.filter(id => currentIds.includes(id));
            if (!targets.length) return;
            if (!window.confirm(`Delete ${getLVSimpsonSlotDisplayName(slot)}? The other EF contours will be kept.`)) return;
            cancelDrawingWithoutClosingPanel();
            this.onCalculate = null;
            this.activeSlot = '';
            explicitLVSimpsonResult = null;
            reviewedLVSimpsonEF = null;
            actions.removeMeasurement({ uid: targets });
            showRecovery(`${getLVSimpsonSlotDisplayName(slot)} deleted. Select Draw to replace it, or choose another contour.`);
          },
          onAnnotationRemoved(annotationId: string) {
            if (suppressLVSimpsonRecoveryEvents || !observedIds.has(annotationId)) return;
            // Disarm this ID before invoking removeMeasurement: the service
            // and Cornerstone can each emit a removal event for the same ID.
            observedIds.delete(annotationId);
            cancelDrawingWithoutClosingPanel();
            this.onCalculate = null;
            this.activeSlot = '';
            // A direct Cornerstone deletion can leave a live service record.
            // Clear both through the same established removal command.
            if (measurementService.getMeasurement?.(annotationId) ||
                lvSimpsonSessionMeasurementsByUid.has(annotationId)) {
              actions.removeMeasurement({ uid: annotationId });
            }
            showRecovery('A contour was deleted. Select its row to draw it again; completed contours are preserved.');
          },
        };
      } else {
        lvSimpsonPanelController.activeSlot = slotInfo.slot;
      }

      const currentStudyDisplaySet = getActiveViewportDisplaySet({
        viewportGridService, displaySetService, viewportId: activeViewportId,
      });
      const currentStudyId = String(
        currentStudyDisplaySet?.StudyInstanceUID || currentStudyDisplaySet?.studyInstanceUID || ''
      ).trim();

      const calculateEF = () => {
        // EF-only live geometry gate. Session fallbacks may retain the original
        // capture points after Cornerstone edits its annotation; reconcile with
        // the actual editable handles immediately before calculation.
        const measurementsForCalculation = getCurrentViewerMeasurementSnapshot(measurementService)
          .filter(entry => String(entry?.referenceStudyUID || entry?.StudyInstanceUID || '').trim() === currentStudyId)
          .map(entry => {
            if (!isLVSimpsonMeasurement(entry)) return entry;
            const measurementId = getMeasurementAnnotationId(entry);
            const annotation = measurementId
              ? cornerstoneTools.annotation.state.getAnnotation?.(measurementId)
              : null;
            const handles = annotation?.data?.handles?.points;
            // An absent annotation must not silently inherit an unedited
            // session snapshot when computing clinically meaningful EF.
            return {
              ...entry,
              lvSimpsonControlPoints: Array.isArray(handles)
                ? handles.map(point => Array.isArray(point) ? [...point] : point)
                : [],
            };
          });
        const resolved = resolveViewerQuizLVSimpsonForStudy(currentStudyId, measurementsForCalculation);
        if (!resolved || !Number.isFinite(Number(resolved.composite?.value))) {
          const clinicalResult = calculateLVSimpson(measurementsForCalculation);
          const slotCounts = getLVSimpsonSlotCandidates(measurementsForCalculation);
          const duplicateSlots = LV_TRACE_REQUIRED_SLOTS.filter(slot => (slotCounts.get(slot)?.length || 0) > 1);
          const missingSlots = LV_TRACE_REQUIRED_SLOTS.filter(slot => !slotCounts.get(slot)?.length);
          const geometryMessages = Array.isArray(clinicalResult?.messages)
            ? clinicalResult.messages.filter(message => typeof message === 'string' && message.trim())
            : [];
          const warnings = [
            ...missingSlots.map(slot => `Missing EF contour: ${getLVSimpsonSlotDisplayName(slot)}.`),
            ...duplicateSlots.map(slot => `Multiple EF contours found for ${getLVSimpsonSlotDisplayName(slot)}; delete the extra contour.`),
            ...geometryMessages,
          ];
          if (!warnings.length) {
            warnings.push('The four EF contours could not be assembled into a valid calculation. Review the contour points and measurement registration.');
          }
          renderLVSimpsonWorkflowPanel({
            measurements: measurementsForCalculation,
            resultText: 'EF calculation unavailable',
            warnings: [...new Set(warnings)].slice(0, 8),
            instruction: 'Correct the indicated contour(s), then retry Calculate EF.',
            onCalculate: calculateEF,
            onCancel: hideLVSimpsonWorkflowPanel,
          });
          return;
        }
        const contourRevisions = new Map<string, string>();
        for (const component of resolved.composite?.components || []) {
          const annotationId = String(component.annotationId || '');
          const revision = annotationId && getLVSimpsonAnnotationRevision(annotationId);
          if (revision) contourRevisions.set(annotationId, revision);
        }
        if (contourRevisions.size !== 4) {
          renderLVSimpsonWorkflowPanel({
            measurements: measurementsForCalculation,
            resultText: 'EF calculation unavailable',
            warnings: ['The live source contours could not be verified. Reopen the EF workflow and recalculate.'],
            onCalculate: calculateEF,
            onCancel: hideLVSimpsonWorkflowPanel,
          });
          return;
        }
        explicitLVSimpsonResult = {
          studyInstanceId: currentStudyId,
          composite: structuredClone(resolved.composite),
          result: structuredClone(resolved.result),
          contourRevisions,
        };
        reviewedLVSimpsonEF = { studyInstanceId: currentStudyId, value: resolved.composite.value };
        renderLVSimpsonWorkflowPanel({
          measurements: measurementsForCalculation,
          resultText: `Calculated LVEF: ${roundQuizMeasurementValue(resolved.composite.value, 2).toFixed(2)}%`,
          resultDetails: [
            `End-diastolic volume (EDV): ${Number(resolved.result.values.edvML).toFixed(2)} mL`,
            `End-systolic volume (ESV): ${Number(resolved.result.values.esvML).toFixed(2)} mL`,
          ],
          instruction: isClinicalReportWorkflow
            ? 'Review the four contours and calculated EF. Save through AR Measurements to review and apply EF, EDV and ESV to the clinical report.'
            : 'EF calculation complete.',
          onCapture: isClinicalReportWorkflow ? null : () => requestLVSimpsonQuizCapture({
            studyInstanceId: currentStudyId, value: resolved.composite.value, mode: 'manual',
          }),
          onCancel: hideLVSimpsonWorkflowPanel,
        });
      };
      if (reviewExistingContours) {
        // There is nothing left to draw. Do not hold the mouse-capture
        // workflow open or show Step 1/4 on a completed saved assessment.
        activeLVSimpsonWorkflowSessionId = '';
        cancelActiveLVSimpsonCapture();
        lvSimpsonMouseTools.restore();
        refreshLVSimpsonToolbarState();
        if (lvSimpsonPanelController) {
          lvSimpsonPanelController.activeSlot = '';
          lvSimpsonPanelController.onCalculate = calculateEF;
        }
        // Revalidate restored live geometry before displaying calculated
        // volumes. This never writes/overwrites the saved quiz EF answer.
        calculateEF();
        return null;
      }

      const existingSlotMeasurements = slotCandidates.get(slotInfo.slot) || [];
      const existingSlotMeasurementIds =
        getLVSimpsonExistingMeasurementIds(existingSlotMeasurements);
      const retryCurrentLVSimpsonSlot = ({
        message,
        duration = LV_SIMPSON_WARNING_DURATION_MS,
      }: {
        message: string;
        duration?: number;
      }) => {
        if (isWorkflowCancelled()) {
          return null;
        }

        let retried = false;

        const retrySlot = () => {
          if (
            retried ||
            activeLVSimpsonWorkflowSessionId !== workflowSessionId
          ) {
            return;
          }

          retried = true;

          actions.startLVSimpsonEFWorkflow({
            slot: slotInfo.slot,
            sessionId: workflowSessionId,
            singleSlot,
            captureMethod,
            efContourTargets,
            questionKey,
            viewportId: activeViewportId,
          });
        };

        showLVSimpsonNotification(uiNotificationService, {
          title: `LV EF step ${stepNumber}/4 - redraw required`,
          message,
          type: 'warning',
          duration,
          actionLabel: 'Retry',
          onAction: retrySlot,
        });

        window.setTimeout(retrySlot, duration);

        return null;
      };
      let geometry: any = null;
      let capturedFreehandAnnotationId = '';
      if (captureMethod === 'freehand') {
        renderLVSimpsonWorkflowPanel({
          measurements: [...liveMeasurements, ...sessionLVSimpsonMeasurements],
          instruction: `Step ${stepNumber}/4: Click at one mitral hinge to start, move around the apex without holding the mouse button, then click the opposite hinge to finish. Esc cancels.`,
          onCancel: () => clearLVSimpsonWorkflowIfCurrent(workflowSessionId),
        });
        const points = await captureViewerClickTrace({
          viewport, previewLabel: slotDisplayName + ' LA volume',
          isCancelled: isWorkflowCancelled,
          setCancelHandler: cancel => {
            if (activeLVSimpsonWorkflowSessionId === workflowSessionId) {
              activeLVSimpsonCaptureCancel = cancel;
            }
          },
        });
        if (!points || isWorkflowCancelled()) {
          clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
          return null;
        }
        geometry = deriveLVSimpsonGeometryFromFreehand(points);
        if (!geometry) {
          uiNotificationService.show({
            title: 'LV EF', type: 'warning', duration: 6500,
            message: 'Cannot derive reliable hinges and apex. Start tracing at one mitral hinge and finish at the opposite hinge; or select Axis + Apex.',
          });
          clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
          return null;
        }
      } else {
      const overlay = createLVSimpsonPreviewOverlay(viewport.element);

      renderLVSimpsonWorkflowPanel({
        measurements: [...liveMeasurements, ...sessionLVSimpsonMeasurements],
        instruction: `Step ${stepNumber}/4: On the correct ${slotDisplayName} frame, draw hinge-to-hinge across the mitral annulus.`,
        onCancel: () => clearLVSimpsonWorkflowIfCurrent(workflowSessionId),
      });

      const hinge = await captureLVSimpsonDrag({
        viewport,
        toolGroup: efToolGroup,
        restorePreviousTool: false,
        isCancelled: isWorkflowCancelled,
        setCancelHandler: cancel => {
          if (activeLVSimpsonWorkflowSessionId === workflowSessionId) {
            activeLVSimpsonCaptureCancel = cancel;
          }
        },
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
        // Escape/cancel during any of the four contour steps ends the entire EF
        // session. Do not leave Length suppressed after a later-step cancel.
        clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
        return null;
      }

      drawLVSimpsonPreview({
        overlay,
        viewport,
        baseLeftPoint: hinge.startWorld,
        baseRightPoint: hinge.endWorld,
      });

      renderLVSimpsonWorkflowPanel({
        measurements: [...liveMeasurements, ...sessionLVSimpsonMeasurements],
        instruction: `Step ${stepNumber}/4: Drag from the hinge midpoint to the true LV apex for ${slotDisplayName}.`,
        onCancel: () => clearLVSimpsonWorkflowIfCurrent(workflowSessionId),
      });

      const apexDrag = await captureLVSimpsonDrag({
        viewport,
        toolGroup: efToolGroup,
        restorePreviousTool: false,
        isCancelled: isWorkflowCancelled,
        setCancelHandler: cancel => {
          if (activeLVSimpsonWorkflowSessionId === workflowSessionId) {
            activeLVSimpsonCaptureCancel = cancel;
          }
        },
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
        clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
        return null;
      }

      geometry = buildLVSimpsonContourFromHingeApex({
        baseLeftPoint: hinge.startWorld,
        baseRightPoint: hinge.endWorld,
        apexPoint: apexDrag.endWorld,
      });
      }
      const axisLengthMM = Number(geometry?.longAxisLengthMM);

      if (!Number.isFinite(axisLengthMM) || axisLengthMM <= 0) {
        return retryCurrentLVSimpsonSlot({
          message:
            'Could not calculate the LV long-axis length. Redraw the hinge line, then drag from the hinge midpoint to the LV apex; LV EF remains active.',
        });
      }

      if (!geometry?.points?.length) {
        return retryCurrentLVSimpsonSlot({
          message:
            'Could not generate LV contour from hinge/apex geometry. Redraw the hinge line, then drag from the hinge midpoint to the LV apex; LV EF remains active.',
        });
      }

      const axisWarning = getLVSimpsonAxisWarning({
        slot: slotInfo.slot,
        axisLengthMM,
        slotCandidates,
      });

      // Keep non-blocking geometry warnings until the step result is known.
      // They are shown with the next-step/final-result notification instead
      // of being immediately replaced by another toast.

      // Replacing a selected slot is not an accidental deletion and must not
      // cancel the new drawing session while clearing old spline annotations.
      suppressLVSimpsonRecoveryEvents += 1;
      try {
        for (const existingMeasurementId of existingSlotMeasurementIds) {
          actions.removeMeasurement({ uid: existingMeasurementId });
        }
      } finally {
        suppressLVSimpsonRecoveryEvents -= 1;
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

      // Build physical coordinates independently from world geometry.
      // The existing ultrasound-region lookup reads the matching DICOM
      // instance; all contour points must lie in one unambiguous region.
      const sourceInstances = getDisplaySetInstances(displaySet);
      // Never silently substitute the first instance if the active SOP
      // cannot be identified: cine frames can carry different region metadata.
      const sourceInstance = sopInstanceId
        ? sourceInstances.find(
            instance => String(getSopInstanceIdFromSource(instance) || '') === String(sopInstanceId)
          )
        : sourceInstances.length === 1 ? sourceInstances[0] : null;
      const sourceRegions = getUltrasoundRegionsFromSource(sourceInstance);
      const normalizedRegions = sourceRegions.map(normalizeUltrasoundRegion).filter(Boolean);
      const imagePlane = metaData.get?.('imagePlaneModule', imageInfo.imageId);
      const calibratedContourPoints = calibrateUSContourPoints({
        points: geometry.points,
        imagePlane,
        regions: normalizedRegions,
      });
      const calibrationError = !sourceInstance
        ? 'source_instance_not_found'
        : !sourceRegions.length
          ? 'ultrasound_regions_missing'
          : !normalizedRegions.length
            ? 'ultrasound_regions_invalid'
            : !calibratedContourPoints
              ? 'contour_outside_region_or_conflicting_spacing'
              : null;
      // Preserve the exact apex handle selected by each capture method.
      // Freehand has already inferred the index; Axis+Apex constructed it.
      const calibratedAxisIndex = geometry.axisPointIndex;
      const calibratedAxisPoint = calibratedContourPoints?.[calibratedAxisIndex];
      const calibratedBaseLeft = calibratedContourPoints?.[0];
      const calibratedBaseRight = calibratedContourPoints?.[calibratedContourPoints.length - 1];
      const calibratedBaseMidpoint = calibratedBaseLeft?.map(
        (value, index) => (value + calibratedBaseRight[index]) / 2
      );
      const calibratedAxisLengthMM =
        calibratedAxisPoint && calibratedBaseMidpoint
          ? Math.hypot(...calibratedAxisPoint.map(
              (value, index) => value - calibratedBaseMidpoint[index]
            ))
          : null;
      const lvSimpson = {
        measurementKind: LV_SIMPSON_MEASUREMENT_KIND,
        slot: slotInfo.slot,
        view: slotInfo.view,
        phase: slotInfo.phase,
        label,
        contourSource: captureMethod === 'freehand' ? 'freehandDerived' : 'hingeApexGenerated',
        axisPointIndex: geometry.axisPointIndex,
        baseLeftPoint: geometry.baseLeftPoint,
        baseRightPoint: geometry.baseRightPoint,
        baseMidpoint: geometry.baseMidpoint,
        apexPoint: geometry.apexPoint,
        contourPoints: geometry.points,
        calibratedContourPoints,
        calibrationError,
        originalContourPoints: calibratedContourPoints ? geometry.points.map(point => [...point]) : null,
        longAxisLengthMM: calibratedAxisLengthMM || geometry.longAxisLengthMM,
        calibratedLongAxisLengthMM: calibratedAxisLengthMM,
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
      if (!targetAnnotation) {
        clearLAVolumeWorkflowIfCurrent(workflowSessionId);
        uiNotificationService.show({
          title: 'LA Volume',
          message: 'Could not create the editable contour. Previous measurements were not replaced.',
          type: 'error', duration: 6500,
        });
        return { ok: false, reason: 'la-spline-hydration-failed' };
      }

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

      // Temporary EF-only diagnostic. Do not log DICOM identifiers, raw
      // coordinates, or full measurement / annotation objects.
      const summarizeEFCalibration = item => ({
        present: Boolean(item),
        calibrationError: item?.lvSimpson?.calibrationError || null,
        calibratedPoints: item?.lvSimpson?.calibratedContourPoints?.length ?? 0,
        originalPoints: item?.lvSimpson?.originalContourPoints?.length ?? 0,
        axisMM: item?.lvSimpson?.calibratedLongAxisLengthMM ?? null,
      });
      console.info('[LV EF calibration] BEFORE update', {
        slot: slotInfo.slot,
        ...summarizeEFCalibration(measurement),
        activeInstanceFound: Boolean(sourceInstance),
        regionCount: sourceRegions.length,
        spatialRegionCount: normalizedRegions.length,
        imagePlaneFound: Boolean(imagePlane),
      });
      try {
        measurementService.update(annotationUID, measurement, true);
        const updatedMeasurement = measurementService
          .getMeasurements?.()
          ?.find(item => item.uid === annotationUID || item.annotationUID === annotationUID);
        const updatedAnnotation = cornerstoneTools.annotation.state.getAnnotation?.(annotationUID);
        console.info('[LV EF calibration] AFTER update', {
          slot: slotInfo.slot,
          measurement: summarizeEFCalibration(updatedMeasurement),
          annotation: summarizeEFCalibration(updatedAnnotation?.data),
        });
        actions.markViewerMeasurementCreatedInSession?.({ uid: annotationUID });
      } catch (error) {
        console.warn('[LV EF] measurementService.update failed:', error);
      }

      if (capturedFreehandAnnotationId && capturedFreehandAnnotationId !== annotationUID) {
        actions.removeMeasurement({ uid: capturedFreehandAnnotationId });
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

      if (lvSimpsonPanelController) {
        lvSimpsonPanelController.activeSlot = '';
      }
      const currentLVSimpsonMeasurements = [
        ...measurementService.getMeasurements?.(),
        ...getLVSimpsonSessionMeasurements(),
      ];
      const remainingSlotCandidates = getLVSimpsonSlotCandidates(
        currentLVSimpsonMeasurements
      );
      const nextSlot = getNextMissingLVSimpsonSlot(remainingSlotCandidates);
      // Match the quiz capture path: live and session measurements are reconciled
      // before calculating the composite gold-answer value.
      const snapshotMeasurements = getCurrentViewerMeasurementSnapshot(measurementService);

      const studyMeasurements = snapshotMeasurements.filter(entry =>
        String(entry?.referenceStudyUID || entry?.StudyInstanceUID || '').trim() === currentStudyId
      );
      // EF is deliberately not calculated at contour completion.

      if (nextSlot && !singleSlot && !isWorkflowCancelled()) {
        const nextDisplayName = getLVSimpsonSlotDisplayName(nextSlot);
        const nextTarget = getEFContourFrameTarget(efContourTargets, nextSlot);
        const normalInstruction = nextTarget
          ? `${slotDisplayName} recorded. Select Continue to open the educator-assigned ${nextDisplayName} instance/frame.`
          : `${slotDisplayName} recorded. Navigate to the correct ${nextDisplayName} image/frame, then continue.`;
        let advancing = false;
        const continueToNextSlot = async () => {
          if (advancing || isWorkflowCancelled()) return;
          advancing = true;
          let nextViewportId = activeViewportId;
          if (nextTarget) {
            let navigation: any = null;
            try {
              navigation = await actions.jumpToViewerQuizTarget({
                viewerTarget: nextTarget,
                questionKey,
              });
            } catch (error) {
              console.warn('[LV EF] authored contour frame navigation failed:', error);
            }
            if (isWorkflowCancelled()) return;
            if (!didNavigateToExactEFContourFrame(navigation, nextTarget)) {
              advancing = false;
              renderLVSimpsonWorkflowPanel({
                measurements: currentLVSimpsonMeasurements,
                instruction: `Could not open the saved ${nextDisplayName} instance/frame. Check that the assigned DICOM image is available, then retry Continue.`,
                continueLabel: 'Retry Continue',
                onContinue: continueToNextSlot,
                onCancel: () => clearLVSimpsonWorkflowIfCurrent(workflowSessionId),
                warnings: axisWarning ? [axisWarning] : [],
              });
              return;
            }
            nextViewportId = navigation.viewportId || nextViewportId;
          }
          if (isWorkflowCancelled()) return;
          void actions.startLVSimpsonEFWorkflow({
            slot: nextSlot,
            sessionId: workflowSessionId,
            singleSlot,
            captureMethod,
            efContourTargets,
            questionKey,
            viewportId: nextViewportId,
          }).catch(error => {
            console.warn('[LV EF] next contour workflow failed:', error);
            clearLVSimpsonWorkflowIfCurrent(workflowSessionId);
          });
        };
        renderLVSimpsonWorkflowPanel({
          measurements: currentLVSimpsonMeasurements,
          instruction: normalInstruction,
          warnings: axisWarning ? [axisWarning] : [],
          continueLabel: 'Continue to next contour',
          onContinue: continueToNextSlot,
          onCancel: () => clearLVSimpsonWorkflowIfCurrent(workflowSessionId),
        });

        return measurement;
      }

      if (nextSlot && singleSlot) {
        clearLVSimpsonWorkflowIfCurrent(workflowSessionId);

        showLVSimpsonNotification(uiNotificationService, {
          title: 'LV EF',
          message: `${slotDisplayName} recorded. Simpson LVEF still requires all four A4C/A2C end-diastolic and end-systolic contours. Next missing: ${getLVSimpsonSlotDisplayName(
            nextSlot
          )}.`,
          type: axisWarning ? 'warning' : 'info',
          duration: axisWarning
            ? LV_SIMPSON_WARNING_DURATION_MS
            : LV_SIMPSON_GUIDANCE_DURATION_MS,
        });

        return measurement;
      }

      // End interactive drawing, but retain the result panel until the
      // educator captures a gold answer or the user explicitly closes it.
      activeLVSimpsonWorkflowSessionId = '';
      cancelActiveLVSimpsonCapture();
      lvSimpsonMouseTools.restore();
      refreshLVSimpsonToolbarState();

      // The four contour measurements are displayed for review first.
      // Only a deliberate Calculate EF click creates a quiz-authoritative EF.
      explicitLVSimpsonResult = null;
      reviewedLVSimpsonEF = null;
      if (lvSimpsonPanelController) {
        lvSimpsonPanelController.onCalculate = calculateEF;
      }
      renderLVSimpsonWorkflowPanel({
        measurements: currentLVSimpsonMeasurements,
        instruction: 'Review the four contours and their long-axis measurements, then select Calculate EF.',
        onCalculate: calculateEF,
        onCancel: hideLVSimpsonWorkflowPanel,
      });

      return measurement;
    },
    startLAVolumeWorkflow: async ({
      slot: requestedSlot = '',
      sessionId: requestedSessionId = '',
      contourTechnique = 'axisApex',
      autoContinue = true,
    } = {}) => {
      const useFreehand = contourTechnique === 'freehand';
      clearUltrasoundDirectionalWorkflowListeners();
      const workflowSessionId = requestedSessionId || `${csUtils.uuidv4()}`;

      if (!requestedSessionId) {
        cancelActiveLAVolumeCapture();
        laVolumeMouseTools.restore();
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
        clearLAVolumeWorkflowIfCurrent(workflowSessionId);
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
        clearLAVolumeWorkflowIfCurrent(workflowSessionId);
        return null;
      }

      const { label, slotInfo } = slotSelection;
      const slotDisplayName = getLAVolumeSlotDisplayName(slotInfo.slot);
      const stepNumber = getLAVolumeStepNumber(slotInfo.slot);
      if (!laVolumeMouseTools.isActive()) laVolumeMouseTools.start();
      const laToolGroupReference = toolGroupService.getToolGroupForViewport(activeViewportId);
      const laToolGroup = typeof laToolGroupReference === 'string'
        ? toolGroupService.getToolGroup(laToolGroupReference)
        : laToolGroupReference;
      laVolumeMouseTools.suspend(laToolGroup);
      const existingSlotMeasurements = slotCandidates.get(slotInfo.slot) || [];
      const existingSlotMeasurementIds = getLAVolumeExistingMeasurementIds(
        existingSlotMeasurements
      );
      // Freeze the active source before landmark drawing; each phase must
      // remain on the same DICOM image/frame through freehand acquisition.
      const acquisitionImageId = getCurrentViewportImageInfo(viewport)?.imageId || '';
      // Axis + apex retains the existing two-drag acquisition. Freehand is a
      // distinct, single click-to-trace acquisition (matching the EF tool).
      let geometry: any = null;
      if (useFreehand) {
        uiNotificationService.show({
          title: `LA Volume ${slotDisplayName} freehand`,
          message: 'Click the first mitral hinge, move around the atrial wall without holding ' +
            'the mouse button, then click the opposite hinge to finish. Esc cancels.',
          type: 'info', duration: 9500,
        });
        const points = await captureViewerClickTrace({
          viewport,
          previewLabel: `LA ${slotDisplayName}`,
          isCancelled: isWorkflowCancelled,
          setCancelHandler: cancel => {
            if (activeLAVolumeWorkflowSessionId === workflowSessionId) {
              activeLAVolumeCaptureCancel = cancel;
            }
          },
        });
        if (!points || isWorkflowCancelled()) {
          clearLAVolumeWorkflowIfCurrent(workflowSessionId);
          return { ok: false, reason: 'la-freehand-cancelled' };
        }
        // The existing EF geometry derivation determines annular hinges and
        // the farthest superior-wall point from a single freehand contour.
        // The LA area-length/disks calculations continue to use LA geometry.
        geometry = deriveLVSimpsonGeometryFromFreehand(points);
        if (!geometry) {
          clearLAVolumeWorkflowIfCurrent(workflowSessionId);
          uiNotificationService.show({
            title: 'LA Volume',
            message: 'The contour could not identify both mitral hinges and the superior LA wall. ' +
              'Start at one hinge and finish at the other, or use Axis + apex.',
            type: 'warning', duration: 7000,
          });
          return { ok: false, reason: 'la-freehand-landmarks-invalid' };
        }
      } else {
        const overlay = createLVSimpsonPreviewOverlay(viewport.element);
  
        uiNotificationService.show({
          title: `LA Volume step ${stepNumber}/2`,
          message: `Navigate to ${slotDisplayName}. Draw the mitral annular closure line from one annular edge to the other. Press Esc to cancel.`,
          type: 'info',
          duration: 8000,
        });
  
        const annulus = await captureLVSimpsonDrag({
          viewport,
          toolGroup: laToolGroup,
          restorePreviousTool: false,
          isCancelled: isWorkflowCancelled,
          setCancelHandler: cancel => {
            if (activeLAVolumeWorkflowSessionId === workflowSessionId) {
              activeLAVolumeCaptureCancel = cancel;
            }
          },
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
          clearLAVolumeWorkflowIfCurrent(workflowSessionId);
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
          toolGroup: laToolGroup,
          restorePreviousTool: false,
          isCancelled: isWorkflowCancelled,
          setCancelHandler: cancel => {
            if (activeLAVolumeWorkflowSessionId === workflowSessionId) {
              activeLAVolumeCaptureCancel = cancel;
            }
          },
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
          clearLAVolumeWorkflowIfCurrent(workflowSessionId);
          return null;
        }
  
  
        geometry = buildEchoVolumeContourFromBaseAxis({
          baseLeftPoint: annulus.startWorld,
          baseRightPoint: annulus.endWorld,
          axisPoint: superiorDrag.endWorld,
        });
      }

      if (!geometry?.points?.length) {
        clearLAVolumeWorkflowIfCurrent(workflowSessionId);
        uiNotificationService.show({
          title: 'LA Volume',
          message:
            'Could not generate the LA contour. Redraw the mitral annular line, then drag from the annular midpoint to the superior LA wall.',
          type: 'warning',
          duration: 7000,
        });
        return null;
      }

      const imageInfo = getCurrentViewportImageInfo(viewport);
      if (!acquisitionImageId || imageInfo?.imageId !== acquisitionImageId) {
        clearLAVolumeWorkflowIfCurrent(workflowSessionId);
        uiNotificationService.show({
          title: 'LA Volume',
          message: 'Image/frame changed during capture. Return to the selected source and retry; the previous contour is preserved.',
          type: 'warning', duration: 7000,
        });
        return { ok: false, reason: 'la-source-frame-changed' };
      }
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
        contourSource: useFreehand ? 'freehandWithAnnulusAxis' : 'annulusAxisGenerated',
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

      // Only replace old contours after the new hydrated annotation and
      // session measurement exist. Failed/cancelled capture stays non-destructive.
      for (const existingMeasurementId of existingSlotMeasurementIds) {
        if (existingMeasurementId !== annotationUID) {
          actions.removeMeasurement({ uid: existingMeasurementId });
        }
      }

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
        installQuizCompositeContourTextOverrideForViewport({
          viewport, viewportId: activeViewportId,
          measurementService, viewportGridService, displaySetService, toolGroupService,
        });
        viewport.render?.();
      } catch {}

      const remainingSlotCandidates = getLAVolumeSlotCandidates([
        ...measurementService.getMeasurements?.(),
        ...getLAVolumeSessionMeasurements(),
      ]);
      const nextSlot = getNextMissingLAVolumeSlot(remainingSlotCandidates);

      if (nextSlot && !isWorkflowCancelled() && !useFreehand && autoContinue) {
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

      clearLAVolumeWorkflowIfCurrent(workflowSessionId);

      if (nextSlot && (useFreehand || !autoContinue)) {
        uiNotificationService.show({
          title: 'LA Volume',
          message: `${slotInfo.slot} saved. Select the next LA phase source and start its chosen contour technique.`,
          type: 'success', duration: 7000,
        });
        return measurement;
      }

      uiNotificationService.show({
        title: 'LA Volume',
        message:
          'A4C and A2C LA contours are present. Adjust either spline as needed; the biplane volume in AR Measurements updates from the edited contours.',
        type: 'success',
        duration: 8000,
      });

      return measurement;
    },
    startUltrasoundDirectionalWorkflow: async ({
      spectralVmax = false,
      preferredTargetKey = '',
      quizCapture = false,
    } = {}) => {
      // The Vmax toolbar uses this same clinical acquisition command. When a
      // TR Vmax quiz question is active, bind the known spectral target rather
      // than falling back to generic Ultrasound Directional target selection.
      // Outside that exact quiz context, retain the existing clinical UI.
      if (spectralVmax && activeQuizMeasurementKind === 'trVmax') {
        preferredTargetKey = 'echo.trPeakVelocity';
        quizCapture = true;
      }
      clearEchoAreaWorkflowListeners();
      clearUltrasoundDirectionalWorkflowListeners();

      const measurementDomain = inferDomainWithoutSeriesDoc('');
      const saveTarget = getArViewerSaveTargetFromUrl();
      const activation = actions.activateViewerMeasurementTool({
        toolName: ULTRASOUND_DIRECTIONAL_TOOL_NAME,
        stopCine: true,
      });

      if (!activation?.ok) {
        uiNotificationService.show({
          title: 'Ultrasound Directional',
          message: 'The Ultrasound Directional tool is not available in this viewport.',
          type: 'warning',
          duration: 4500,
        });
        return activation;
      }

      // Outside the clinical Echo report workflow this remains a generic calibrated
      // ultrasound annotation tool. Learning/research/review workflows must not
      // accidentally acquire clinical AR report mappings.
      if (
        (!spectralVmax && (measurementDomain !== 'echo' ||
          !isClinicalReportMeasurementsSaveTarget(saveTarget))) ||
        (spectralVmax && ['bowel', 'iuscan'].includes(measurementDomain))
      ) {
        return activation;
      }

      const workflowSessionId = `${csUtils.uuidv4()}`;
      activeUltrasoundDirectionalWorkflowSessionId = workflowSessionId;

      ultrasoundDirectionalCompletionHandler = async (event: Event) => {
        if (activeUltrasoundDirectionalWorkflowSessionId !== workflowSessionId) {
          return;
        }

        const eventDetail = (event as CustomEvent)?.detail || {};
        const sourceAnnotation = eventDetail.annotation;
        const sourceToolName = String(sourceAnnotation?.metadata?.toolName || '').trim();

        if (sourceToolName !== ULTRASOUND_DIRECTIONAL_TOOL_NAME) {
          return;
        }

        const annotationId = String(sourceAnnotation?.annotationUID || '').trim();
        if (!annotationId) {
          return;
        }

        let stateAnnotation = sourceAnnotation;
        let stats = getUltrasoundDirectionalStatsFromAnnotationData(stateAnnotation?.data || {});

        // Cached ultrasound-region values can land just after ANNOTATION_COMPLETED.
        // Wait briefly before deciding that the measurement is generic/unmapped.
        for (let attempt = 0; attempt < 20 && !stats; attempt += 1) {
          await sleep(50);
          stateAnnotation =
            cornerstoneTools.annotation.state.getAnnotation?.(annotationId) || stateAnnotation;
          stats = getUltrasoundDirectionalStatsFromAnnotationData(stateAnnotation?.data || {});
        }

        const distance = stats ? getUltrasoundDirectionalDistance(stats) : null;
        const rawValue = Number(distance?.value);
        const rawUnit = String(distance?.unit || '').trim();
        const renderContent = customizationService.getCustomization('ui.labellingComponent');
        const targetOptions = spectralVmax
          ? getSpectralVmaxTargetOptionsForUnit(rawUnit, { includeGeneric: true })
          : getUltrasoundDirectionalTargetOptionsForUnit(rawUnit, { includeGeneric: true });
        const mappedTargetOptions = targetOptions.filter(option => option.value !== 'generic');
        // Education questions know the measurement target already. Restrict
        // automatic selection to a target supported by the actual calibrated
        // spectral units; leave clinical and generic target selection intact.
        let selectedTarget = Number.isFinite(rawValue) && preferredTargetKey
          ? normalizeUltrasoundDirectionalTargetSelection(preferredTargetKey, rawUnit)
          : null;
        if (selectedTarget && !targetOptions.some(option => option.value === selectedTarget.key)) {
          selectedTarget = null;
        }

        if (!preferredTargetKey && Number.isFinite(rawValue) && mappedTargetOptions.length > 0) {
          let selection = null;

          try {
            selection = await callInputDialogAutoComplete({
              uiDialogService,
              labelConfig: {
                id: spectralVmax ? 'echoSpectralVmaxTarget' : 'echoUltrasoundDirectionalReportTarget',
                domain: 'echo',
                dialogTitle: spectralVmax ? 'Spectral Vmax Target' : 'Ultrasound Directional Measurement',
                annotationTitle: spectralVmax ? 'Spectral Vmax Target' : 'Ultrasound Directional Measurement',
                labelOnMeasure: false,
                exclusive: true,
                items: targetOptions,
              },
              renderContent,
              title: spectralVmax ? 'Spectral Vmax Target' : 'Ultrasound Directional Measurement',
            });
          } catch (error) {
            console.warn(
              '[Ultrasound Directional] target autocomplete failed; falling back to text input:',
              error
            );

            selection = await callInputDialog({
              uiDialogService,
              title: spectralVmax ? 'Spectral Vmax Target' : 'Ultrasound Directional Measurement',
              placeholder: targetOptions.map(option => option.label).join(', '),
              defaultValue: mappedTargetOptions[0]?.label || targetOptions[0]?.label || '',
            });
          }

          selectedTarget = normalizeUltrasoundDirectionalTargetSelection(selection, rawUnit);
          if (spectralVmax && selectedTarget &&
              !targetOptions.some(option => option.value === selectedTarget.key)) {
            selectedTarget = null;
          }
        }

        // Cancelled or unsupported units remain valid annotations, but they do not
        // write to the AR report.
        if (!selectedTarget) {
          selectedTarget = normalizeUltrasoundDirectionalTargetSelection('generic', rawUnit);
        }

        // A learner measurement captured inside a report-owned assessment may
        // be offered as a *reviewable* clinical report value. This does not
        // write TRVel automatically: the existing report preview/selection
        // still decides which mapped fields are applied. Standalone learning
        // quizzes continue to have no clinical mapping.
        const allowReportOwnedQuizTR = quizCapture && spectralVmax &&
          selectedTarget?.key === 'echo.trPeakVelocity' &&
          isReportOwnedLearnerMeasurementTarget(saveTarget) &&
          isClinicalReportMeasurementsSaveTarget(saveTarget);
        const reportMapping = isClinicalReportMeasurementsSaveTarget(saveTarget) &&
          (!quizCapture || allowReportOwnedQuizTR)
          ? buildUltrasoundDirectionalReportMapping(selectedTarget)
          : null;
        const convertedReportValue = convertUltrasoundDirectionalValueForTarget({
          value: rawValue,
          unit: rawUnit,
          target: selectedTarget,
        });
        const measurementLabel =
          selectedTarget?.label || 'Generic Ultrasound Directional (no AR report mapping)';
        const directional = {
          ...(stateAnnotation?.data?.ultrasoundDirectional || {}),
          xValues: Array.isArray(stats?.xValues) ? [...stats.xValues] : [],
          yValues: Array.isArray(stats?.yValues) ? [...stats.yValues] : [],
          units: Array.isArray(stats?.units) ? [...stats.units] : [],
          isHorizontal: stats?.isHorizontal === true,
          isUnitless: stats?.isUnitless === true,
          value: Number.isFinite(rawValue) ? rawValue : null,
          unit: rawUnit,
          measurementKind: ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND,
          ...(spectralVmax ? { acquisitionMode: 'spectralVmax' } : {}),
          ...(convertedReportValue
            ? {
                reportValue: convertedReportValue.value,
                reportUnit: convertedReportValue.unit,
              }
            : {}),
          ...(reportMapping ? { reportMapping } : {}),
        };

        stateAnnotation.data = {
          ...(stateAnnotation.data || {}),
          label: measurementLabel,
          ultrasoundDirectional: directional,
          ...(reportMapping ? { reportMapping } : {}),
        };

        if (!reportMapping && stateAnnotation.data?.reportMapping) {
          delete stateAnnotation.data.reportMapping;
        }

        stateAnnotation.invalidated = false;

        try {
          const mappedMeasurement = measurementService.getMeasurement?.(annotationId);
          if (mappedMeasurement) {
            measurementService.update(
              annotationId,
              {
                ...mappedMeasurement,
                label: measurementLabel,
                measurementRole: measurementLabel,
                role: measurementLabel,
                measurementKind: ULTRASOUND_DIRECTIONAL_MEASUREMENT_KIND,
                ultrasoundDirectional: directional,
                ...(reportMapping ? { reportMapping } : {}),
              },
              true
            );
          }
        } catch (error) {
          console.warn('[Ultrasound Directional] measurementService.update failed:', error);
        }

        actions.markViewerMeasurementCreatedInSession?.({ uid: annotationId });
        // The educator/learner quiz panel captures this exact calibrated
        // annotation after its final label and physical m/s conversion exist.
        // Do not emit a gradeable quiz event for generic or unsupported
        // spectral measurements.
        if (quizCapture && spectralVmax &&
            selectedTarget?.key === 'echo.trPeakVelocity' &&
            convertedReportValue?.unit === 'm/s' &&
            Number.isFinite(Number(convertedReportValue?.value)) &&
            Number(convertedReportValue.value) > 0 &&
            Number(convertedReportValue.value) <= 8) {
          window.dispatchEvent(new CustomEvent('ar-learning:quiz-measurement-added', {
            detail: { measurementId: annotationId },
          }));
        }
        dispatchLiveMeasurementsRefresh({
          reason: 'ultrasound-directional-labelled',
          annotationUID: annotationId,
          label: measurementLabel,
          reportTarget: reportMapping || null,
        });

        try {
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(annotationId, true);
          const activeViewportId = viewportGridService.getActiveViewportId();
          const activeViewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
          activeViewport?.render?.();
        } catch {}

        uiNotificationService.show({
          title: spectralVmax ? 'Spectral Vmax' : 'Ultrasound Directional',
          message:
            reportMapping && convertedReportValue
              ? `${measurementLabel}: ${formatLengthMM(convertedReportValue.value)} ${convertedReportValue.unit}`
              : Number.isFinite(rawValue)
                ? `${measurementLabel}: ${formatLengthMM(rawValue)} ${rawUnit || ''}`.trim()
                : `${measurementLabel} saved without an AR report mapping.`,
          type: reportMapping && convertedReportValue ? 'success' : 'info',
          duration: 5500,
        });
      };

      eventTarget.addEventListener(
        Enums.Events.ANNOTATION_COMPLETED,
        ultrasoundDirectionalCompletionHandler
      );

      if (spectralVmax) {
        const activeViewportId = viewportGridService.getActiveViewportId();
        const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
        const element = viewport?.element;
        const imageId = viewport?.getCurrentImageId?.() || '';
        const instance = imageId ? metaData.get('instance', imageId) : null;
        const directRegions = metaData.get('ultrasoundRegions', imageId);
        const regionSources = [
          ...getUltrasoundRegionsFromSource(instance),
          ...(Array.isArray(directRegions)
            ? directRegions
            : getUltrasoundRegionsFromSource(directRegions)),
        ];
        const readRegion = (region: any) => ({
          minX: readDicomNumber(region, ['RegionLocationMinX0', 'regionLocationMinX0', '00186018', 'x00186018']),
          maxX: readDicomNumber(region, ['RegionLocationMaxX1', 'regionLocationMaxX1', '0018601C', 'x0018601C']),
          minY: readDicomNumber(region, ['RegionLocationMinY0', 'regionLocationMinY0', '0018601A', 'x0018601A']),
          maxY: readDicomNumber(region, ['RegionLocationMaxY1', 'regionLocationMaxY1', '0018601E', 'x0018601E']),
          referenceY: readDicomNumber(region, ['ReferencePixelY0', 'referencePixelY0', '00186022', 'x00186022']),
          referencePhysicalY: readDicomNumber(region, ['ReferencePixelPhysicalValueY', 'referencePixelPhysicalValueY', '0018602A', 'x0018602A']),
          physicalDeltaY: readDicomNumber(region, ['PhysicalDeltaY', 'physicalDeltaY', '0018602E', 'x0018602E']),
          spatialFormat: readDicomNumber(region, ['RegionSpatialFormat', 'regionSpatialFormat', '00186012', 'x00186012']),
          unitsY: readDicomNumber(region, ['PhysicalUnitsYDirection', 'physicalUnitsYDirection', '00186026', 'x00186026']),
        });
        const regions = regionSources.map(readRegion);
        if (element && imageId && regions.length > 0) {
          const captureClick = (event: PointerEvent) => {
            if (event.button !== 0 || activeUltrasoundDirectionalWorkflowSessionId !== workflowSessionId) return;
            const bounds = element.getBoundingClientRect();
            const canvasPoint: [number, number] = [event.clientX - bounds.left, event.clientY - bounds.top];
            const imageData = viewport.getImageData?.();
            if (!imageData) return;
            const worldPoint = viewport.canvasToWorld?.(canvasPoint);
            if (!worldPoint) return;
            const peakIndex = csUtils.transformWorldToIndex(imageData, worldPoint);
            if (!peakIndex || !Number.isFinite(peakIndex[0]) || !Number.isFinite(peakIndex[1])) return;
            const resolved = regions.map(region => ({
              region,
              result: resolveSpectralVmaxClick(region as any, peakIndex[0], peakIndex[1]),
            })).find(candidate => candidate.result);
            if (!resolved?.result) return; // Existing two-point workflow remains available.
            event.preventDefault();
            event.stopImmediatePropagation();
            spectralVmaxClickCleanup?.();
            spectralVmaxClickCleanup = null;
            const baselineIndex: [number, number, number] = [peakIndex[0], resolved.result.baselineY, peakIndex[2] || 0];
            const baselineWorld = csUtils.transformIndexToWorld(imageData, baselineIndex);
            const annotationId = csUtils.uuidv4();
            const stats = {
              xValues: [0, 0],
              yValues: [0, resolved.result.velocityMps * 100],
              units: ['s', 'cm/s'],
              isHorizontal: false,
              isUnitless: false,
            };
            const data = {
              handles: { points: [baselineWorld, worldPoint], activeHandleIndex: null,
                textBox: { hasMoved: false, worldPosition: worldPoint, worldBoundingBox: null } },
              cachedStats: { [`imageId:${imageId}`]: stats },
              ultrasoundDirectional: { acquisitionMode: 'spectralVmax', value: resolved.result.velocityMps * 100, unit: 'cm/s' },
            };
            const viewReference = getViewerAnnotationViewportReference(viewport, [baselineWorld, worldPoint]);
            const ToolClass: any = (cornerstoneTools as any).UltrasoundDirectionalTool;
            const baseData = {
              annotationUID: annotationId,
              highlighted: true,
              invalidated: false,
              metadata: { ...viewReference, toolName: ULTRASOUND_DIRECTIONAL_TOOL_NAME, referencedImageId: imageId },
              data,
            };
            const created = typeof ToolClass?.createAnnotationForViewport === 'function'
              ? ToolClass.createAnnotationForViewport(viewport, baseData)
              : baseData;
            created.annotationUID = annotationId;
            created.data = { ...(created.data || {}), ...data };
            created.metadata = { ...(created.metadata || {}), ...baseData.metadata };
            created.invalidated = false;
            annotation.state.addAnnotation(created, element);
            eventTarget.dispatchEvent(new CustomEvent(Enums.Events.ANNOTATION_COMPLETED, {
              detail: { annotation: created },
            }));
            viewport.render?.();
          };
          element.addEventListener('pointerdown', captureClick, true);
          spectralVmaxClickCleanup = () => element.removeEventListener('pointerdown', captureClick, true);
        }
      }

      uiNotificationService.show({
        title: spectralVmax ? 'Spectral Vmax' : 'Ultrasound Directional',
        message: spectralVmax
          ? 'Click the dense spectral peak once when DICOM zero-velocity calibration is available. Otherwise draw from the zero baseline to the peak. Select the flow target; Esc cancels.'
          : 'Draw along a calibrated Doppler/time axis. After completion, choose the matching Echo measurement. Unsupported units remain generic annotations.',
        type: 'info',
        duration: 7000,
      });

      return {
        ...activation,
        sessionId: workflowSessionId,
      };
    },
    // AR_DECELERATION_TIME:BEGIN action
    startDecelerationTimeWorkflow: async () => {
      clearDecelerationTimeWorkflowListeners();
      const activeViewportId = viewportGridService.getActiveViewportId();
      const { viewport } = _getActiveViewportEnabledElement() || {};
      if (!activeViewportId || !viewport?.element) {
        uiNotificationService.show({ title: 'Deceleration Time', message: 'No active image viewport is available.', type: 'warning', duration: 3500 });
        return null;
      }

      const selectedTarget = await resolveDecelerationTimeTarget({ uiDialogService, customizationService });
      if (!selectedTarget) {
        uiNotificationService.show({ title: 'Deceleration Time', message: 'Deceleration-time measurement cancelled.', type: 'info', duration: 2500 });
        return null;
      }

      const reportMapping = selectedTarget.reportTargetKey
        ? buildViewerReportMapping({ key: selectedTarget.reportTargetKey, label: selectedTarget.label })
        : null;
      const activation = actions.activateViewerMeasurementTool({ toolName: ULTRASOUND_DIRECTIONAL_TOOL_NAME, stopCine: true });
      if (!activation?.ok) {
        uiNotificationService.show({ title: 'Deceleration Time', message: 'The calibrated Doppler directional tool is not available in this viewport.', type: 'warning', duration: 4500 });
        return null;
      }

      installDecelerationTimeTextOverrideForViewport({ viewport, viewportId: activeViewportId });
      const workflowSessionId = `${csUtils.uuidv4()}`;
      activeDecelerationTimeWorkflowSessionId = workflowSessionId;

      const restoreNavigationTool = () => {
        try {
          const toolGroupReference = toolGroupService.getToolGroupForViewport(activeViewportId);
          actions.setToolActive({ toolName: toolNames.WindowLevel || 'WindowLevel', toolGroupId: toolGroupReference });
        } catch {}
      };

      decelerationTimeEscapeHandler = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || activeDecelerationTimeWorkflowSessionId !== workflowSessionId) return;
        clearDecelerationTimeWorkflowListeners();
        restoreNavigationTool();
        uiNotificationService.show({ title: 'Deceleration Time', message: 'Deceleration-time measurement cancelled.', type: 'info', duration: 2500 });
      };

      decelerationTimeCompletionHandler = (event: Event) => {
        if (activeDecelerationTimeWorkflowSessionId !== workflowSessionId) return;
        const sourceAnnotation = (event as CustomEvent)?.detail?.annotation;
        if (String(sourceAnnotation?.metadata?.toolName || '') !== ULTRASOUND_DIRECTIONAL_TOOL_NAME) return;
        const annotationId = String(sourceAnnotation?.annotationUID || '').trim();
        if (!annotationId) return;

        clearDecelerationTimeWorkflowListeners({ resetSession: false });
        activeDecelerationTimeWorkflowSessionId = '';
        restoreNavigationTool();

        const stats = getUltrasoundDirectionalStatsFromAnnotationData(sourceAnnotation?.data || {});
        const calculation = calculateDecelerationTimeFromDirectionalStats({ stats, target: selectedTarget });
        const displayText = buildDecelerationTimeDisplayText(calculation);
        sourceAnnotation.data = {
          ...(sourceAnnotation.data || {}),
          label: selectedTarget.label,
          arDecelerationTimeTarget: selectedTarget,
          arDecelerationTimeReportMapping: reportMapping,
          arSavedMeasurementDisplayText: displayText,
        };
        sourceAnnotation.invalidated = false;

        actions.markViewerMeasurementCreatedInSession?.({ uid: annotationId });
        dispatchLiveMeasurementsRefresh({
          reason: 'spectral-doppler-deceleration-time-created',
          annotationUID: annotationId,
          status: calculation.status,
        });
        try {
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(annotationId, true);
          viewport.render?.();
        } catch {}
        uiNotificationService.show({
          title: 'Deceleration Time',
          message: calculation.status === 'complete'
            ? getDecelerationTimeSummaryText(calculation)
            : `${calculation.message || 'Doppler time-axis calibration unavailable.'} The line was preserved without a calculated DecT.`,
          type: calculation.status === 'complete' ? 'success' : 'warning',
          duration: calculation.status === 'complete' ? 5000 : 8000,
        });
      };

      eventTarget.addEventListener(Enums.Events.ANNOTATION_COMPLETED, decelerationTimeCompletionHandler);
      window.addEventListener('keydown', decelerationTimeEscapeHandler);
      uiNotificationService.show({
        title: 'Deceleration Time',
        message: `For ${selectedTarget.label}, draw from the E-wave peak down the deceleration slope to the baseline intercept. Press Esc to cancel.`,
        type: 'info',
        duration: 8000,
      });
      return { ok: true, sessionId: workflowSessionId, toolName: ULTRASOUND_DIRECTIONAL_TOOL_NAME, target: selectedTarget.key };
    },
    // AR_DECELERATION_TIME:END action

    startGuidedRVFACContourWorkflow: async ({ slot = '' } = {}) => {
      const chosen = String(slot || '').toUpperCase();
      if (!['RV_ED', 'RV_ES'].includes(chosen)) return { ok: false, reason: 'invalid-slot' };
      const existing = getCurrentViewerMeasurementSnapshot(measurementService);
      if (existing.some(item => getEchoAreaSlot(item) === chosen)) {
        return { ok: false, reason: 'slot-already-captured' };
      }
      if (activeLVSimpsonWorkflowSessionId) clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
      if (activeLAVolumeWorkflowSessionId) clearLAVolumeWorkflowIfCurrent(activeLAVolumeWorkflowSessionId);
      clearEchoAreaWorkflowListeners();
      clearUltrasoundDirectionalWorkflowListeners();
      clearSpectralDopplerWorkflowListeners();

      const { viewport } = _getActiveViewportEnabledElement() || {};
      const viewportId = viewportGridService.getActiveViewportId();
      const groupRef = toolGroupService.getToolGroupForViewport(viewportId);
      const group = typeof groupRef === 'string' ? toolGroupService.getToolGroup(groupRef) : groupRef;
      if (!viewport?.element || !viewportId || !group) {
        return { ok: false, reason: 'viewport-not-ready' };
      }

      const sessionId = csUtils.uuidv4();
      activeEchoAreaSessionId = sessionId;
      const isCancelled = () => activeEchoAreaSessionId !== sessionId;
      const label = chosen === 'RV_ED' ? 'RVEDA' : 'RVESA';
      const phase = chosen === 'RV_ED' ? 'ED' : 'ES';

      try {
        uiNotificationService.show({
          title: label,
          message: 'Select the RV-focused A4C ' + phase +
            ' frame. Drag from the free-wall tricuspid annulus hinge to the septal hinge. Esc cancels.',
          type: 'info',
          duration: 8000,
        });
        const annulus = await captureLVSimpsonDrag({
          viewport, toolGroup: group, isCancelled,
          setCancelHandler: cancel => { if (!isCancelled()) rvFACGuidedCancel = cancel; },
        });
        if (!annulus || isCancelled()) return { ok: false, reason: 'annulus-cancelled' };

        uiNotificationService.show({
          title: label,
          message: 'Now drag from the annular midpoint to the RV apex. Refine the resulting editable spline against the true endocardial border.',
          type: 'info',
          duration: 9000,
        });
        const apex = await captureLVSimpsonDrag({
          viewport, toolGroup: group, isCancelled,
          setCancelHandler: cancel => { if (!isCancelled()) rvFACGuidedCancel = cancel; },
        });
        if (!apex || isCancelled()) return { ok: false, reason: 'apex-cancelled' };

        const geometry = buildRVFACContourFromAnnulusApex({
          freeWallHingePoint: annulus.startWorld,
          septalHingePoint: annulus.endWorld,
          apexPoint: apex.endWorld,
        });
        if (!geometry) return { ok: false, reason: 'invalid-rv-landmarks' };

        const info = getCurrentViewportImageInfo(viewport);
        const displaySet = getActiveViewportDisplaySet({
          viewportGridService, displaySetService, viewportId,
        });
        const study = String(displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '');
        const series = String(displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '');
        if (!info?.imageId || !study || !series) return { ok: false, reason: 'missing-image-reference' };

        const annotationId = csUtils.uuidv4();
        let hydrated = null;
        try {
          hydrated = cornerstoneTools.SplineROITool?.hydrate?.(viewportId, geometry.points, {
            annotationUID: annotationId,
          });
        } catch (error) {
          console.warn('[RV FAC] Spline hydration failed:', error);
        }
        const state = cornerstoneTools.annotation.state.getAnnotation?.(annotationId) || hydrated;
        if (!state) return { ok: false, reason: 'spline-hydration-failed' };

        const sop = getSopInstanceIdFromImageId(info.imageId) ||
          displaySet?.SOPInstanceUID || displaySet?.sopInstanceUID || '';
        const verifiedArea = getVerifiedEchoAreaCalibration({
          displaySet, imageId: info.imageId, sopInstanceId: sop,
          points: geometry.points,
        });
        const echoArea = {
          ...(verifiedArea ? { calibrationRegions: verifiedArea.regions } : {}),
          slot: chosen, phase, view: 'A4C',
          method: 'closed-contour-planimetry',
          contourSource: geometry.contourSource,
          freeWallHingePoint: geometry.freeWallHingePoint,
          septalHingePoint: geometry.septalHingePoint,
          apexPoint: geometry.apexPoint,
        };
        state.metadata = {
          ...(state.metadata || {}),
          toolName: toolNames.SplineROI || 'SplineROI',
          referencedImageId: info.imageId,
          StudyInstanceUID: study,
          SeriesInstanceUID: series,
          SOPInstanceUID: sop,
          FrameOfReferenceUID: viewport.getFrameOfReferenceUID?.() || '',
        };
        state.data = {
          ...(state.data || {}),
          label, echoArea,
          handles: { ...(state.data?.handles || {}), points: geometry.points },
          contour: { ...(state.data?.contour || {}), polyline: geometry.points, closed: true },
        };
        state.invalidated = true;

        measurementService.update(annotationId, {
          uid: annotationId,
          annotationUID: annotationId,
          toolName: toolNames.SplineROI || 'SplineROI',
          label, measurementRole: label, role: chosen,
          measurementKind: 'echoAreaSlot',
          echoArea, slot: chosen, phase, view: 'A4C',
          referenceStudyUID: study,
          referenceSeriesUID: series,
          SOPInstanceUID: sop,
          referencedImageId: info.imageId,
          FrameOfReferenceUID: state.metadata.FrameOfReferenceUID,
          frameNumber: getFrameNumberFromReferencedImageId(info.imageId),
          points: geometry.points,
          ...(verifiedArea ? { measurements: {
            area: verifiedArea.areaCM2, areaUnit: 'cm2',
          }} : {}),
        }, true);
        actions.markViewerMeasurementCreatedInSession?.({ uid: annotationId });
        installQuizCompositeContourTextOverrideForViewport({
          viewport, viewportId, measurementService, viewportGridService, displaySetService, toolGroupService,
        });
        dispatchLiveMeasurementsRefresh({ reason: 'guided-rv-area-created', annotationUID: annotationId });
        viewport.render?.();
        uiNotificationService.show({
          title: label,
          message: 'Adjust the spline handles to the RV blood-tissue boundary. ' +
            (phase === 'ED' ? 'Then capture RVESA on the intended end-systolic frame in the same study.' : 'Review RV FAC before saving.'),
          type: 'success',
          duration: 9000,
        });
        return { ok: true, slot: chosen, annotationId };
      } finally {
        if (activeEchoAreaSessionId === sessionId) clearEchoAreaWorkflowListeners();
      }
    },
    startEchoAreaContourWorkflow: async ({ slot = '', clickTrace = false } = {}) => {
      const configuredSlots = {
        RA_ES: {
          label: 'RAa',
          phase: 'ES',
          title: 'RA area',
          prompt: 'At end-systole, free-trace the RA wall and close across the tricuspid annulus. Exclude the venous openings and appendage.',
        },
        RV_ED: {
          label: 'RVEDA',
          phase: 'ED',
          title: 'RV end-diastolic area',
          prompt: 'Select end-diastole in an RV-focused A4C cine. Free-trace between both tricuspid annular hinges around the RV apex, free wall and septal boundary.',
        },
        RV_ES: {
          label: 'RVESA',
          phase: 'ES',
          title: 'RV end-systolic area',
          prompt: 'Select the configured end-systolic RV-focused A4C frame in the same study as RVEDA. Trace the RV cavity and close across the tricuspid annular hinge line.',
        },
      };
      const selectedSlot = String(slot || '').toUpperCase();
      const target = configuredSlots[selectedSlot];
      if (!target) {
        return { ok: false, reason: 'invalid-echo-area-slot' };
      }

      // Forcing the user to delete/replace a previous slot prevents silently
      // scoring or reporting a stale contour from an earlier attempt.
      const current = getCurrentViewerMeasurementSnapshot(measurementService);
      if (current.some(measurement => getEchoAreaSlot(measurement) === selectedSlot)) {
        uiNotificationService.show({
          title: target.title,
          message: 'A contour already exists for this measurement. Delete the previous contour before drawing a replacement.',
          type: 'warning',
          duration: 7000,
        });
        return { ok: false, reason: 'echo-area-slot-already-exists', slot: selectedSlot };
      }

      if (clickTrace) {
        // This branch is restricted to quiz acquisition. Clinical freehand ROIs
        // retain their established Cornerstone drag workflow and configuration.
        clearEchoAreaWorkflowListeners();
        clearSpectralDopplerWorkflowListeners();
        clearUltrasoundDirectionalWorkflowListeners();
        const { viewport } = _getActiveViewportEnabledElement() || {};
        const viewportId = viewportGridService.getActiveViewportId();
        if (!viewport?.element || !viewportId) {
          return { ok: false, reason: 'viewport-not-ready' };
        }
        const sessionId = csUtils.uuidv4();
        activeEchoAreaSessionId = sessionId;
        const isCancelled = () => activeEchoAreaSessionId !== sessionId;
        const imageInfo = getCurrentViewportImageInfo(viewport);
        const sourceImageId = String(imageInfo?.imageId || '');
        uiNotificationService.show({
          title: target.title,
          message: 'Click once at an annular hinge to start, trace without holding the mouse ' +
            'button, then click again to finish and close the contour. Press Esc to cancel.',
          type: 'info', duration: 9000,
        });
        try {
          const traced = await captureViewerClickTrace({
            viewport, previewLabel: target.label,
            isCancelled,
            setCancelHandler: cancel => {
              if (!isCancelled()) rvFACGuidedCancel = cancel;
            },
          });
          if (!traced || isCancelled() ||
              !sourceImageId || sourceImageId !== getCurrentViewportImageInfo(viewport)?.imageId) {
            return { ok: false, reason: 'echo-area-trace-cancelled-or-frame-changed' };
          }
          if (traced.length < 6) return { ok: false, reason: 'echo-area-contour-too-short' };
          const points = [...traced, traced[0]];
          const displaySet = getActiveViewportDisplaySet({
            viewportGridService, displaySetService, viewportId,
          });
          const study = String(displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '');
          const series = String(displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '');
          const sop = getSopInstanceIdFromImageId(sourceImageId) ||
            displaySet?.SOPInstanceUID || displaySet?.sopInstanceUID || '';
          const frameNumber = getFrameNumberFromReferencedImageId(sourceImageId);
          if (!study || !series || !sop || !(frameNumber > 0)) {
            return { ok: false, reason: 'echo-area-source-identity-missing' };
          }
          const annotationId = csUtils.uuidv4();
          let hydrated = null;
          try {
            hydrated = cornerstoneTools.SplineROITool?.hydrate?.(viewportId, points, {
              annotationUID: annotationId,
            });
          } catch (error) {
            console.warn('[Echo Area] click-trace spline hydration failed:', error);
          }
          const state = cornerstoneTools.annotation.state.getAnnotation?.(annotationId) || hydrated;
          if (!state) return { ok: false, reason: 'echo-area-spline-hydration-failed' };
          const verifiedArea = getVerifiedEchoAreaCalibration({
            displaySet, imageId: sourceImageId, sopInstanceId: sop, points,
          });
          const echoArea = {
            ...(verifiedArea ? { calibrationRegions: verifiedArea.regions } : {}),
            slot: selectedSlot, phase: target.phase, view: 'A4C',
            method: 'closed-contour-planimetry', contourSource: 'freehand-click-trace',
          };
          state.metadata = {
            ...(state.metadata || {}),
            toolName: toolNames.SplineROI || 'SplineROI',
            referencedImageId: sourceImageId,
            StudyInstanceUID: study,
            SeriesInstanceUID: series,
            SOPInstanceUID: sop,
            FrameOfReferenceUID: viewport.getFrameOfReferenceUID?.() || '',
          };
          state.data = {
            ...(state.data || {}), label: target.label, echoArea,
            measurementKind: 'echoAreaSlot',
            handles: { ...(state.data?.handles || {}), points },
            contour: { ...(state.data?.contour || {}), polyline: points, closed: true },
          };
          state.invalidated = true;
          measurementService.update(annotationId, {
            uid: annotationId, annotationUID: annotationId,
            toolName: toolNames.SplineROI || 'SplineROI',
            label: target.label, measurementRole: target.label,
            role: target.label, measurementKind: 'echoAreaSlot',
            echoArea, slot: selectedSlot, phase: target.phase, view: 'A4C',
            referenceStudyUID: study, referenceSeriesUID: series,
            SOPInstanceUID: sop, referencedImageId: sourceImageId,
            FrameOfReferenceUID: state.metadata.FrameOfReferenceUID,
            frameNumber, points,
            ...(verifiedArea ? { measurements: {
              area: verifiedArea.areaCM2, areaUnit: 'cm2',
            }} : {}),
          }, true);
          actions.markViewerMeasurementCreatedInSession?.({ uid: annotationId });
          installQuizCompositeContourTextOverrideForViewport({
            viewport, viewportId, measurementService, viewportGridService, displaySetService, toolGroupService,
          });
          dispatchLiveMeasurementsRefresh({ reason: 'quiz-echo-area-created', annotationUID: annotationId });
          viewport.render?.();
          return { ok: true, slot: selectedSlot, annotationId };
        } finally {
          if (activeEchoAreaSessionId === sessionId) clearEchoAreaWorkflowListeners();
        }
      }

      clearEchoAreaWorkflowListeners();
      clearSpectralDopplerWorkflowListeners();
      clearUltrasoundDirectionalWorkflowListeners();

      const activation = actions.activateViewerMeasurementTool({
        toolName: toolNames.PlanarFreehandROI || 'PlanarFreehandROI',
        stopCine: true,
      });
      if (!activation?.ok) return activation;
      const viewportId = activation.activeViewportId;
      const sessionId = csUtils.uuidv4();
      activeEchoAreaSessionId = sessionId;

      const restoreTool = () => {
        try {
          const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
          actions.setToolActive({
            toolName: toolNames.WindowLevel || 'WindowLevel',
            toolGroupId: toolGroup,
          });
        } catch {}
      };

      echoAreaEscapeHandler = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || activeEchoAreaSessionId !== sessionId) return;
        clearEchoAreaWorkflowListeners();
        restoreTool();
        uiNotificationService.show({
          title: target.title,
          message: 'Area tracing cancelled.',
          type: 'info',
          duration: 3000,
        });
      };

      echoAreaCompletionHandler = async (event: Event) => {
        if (activeEchoAreaSessionId !== sessionId) return;
        const sourceAnnotation = (event as CustomEvent)?.detail?.annotation;
        const sourceToolName = String(sourceAnnotation?.metadata?.toolName || '');
        if (sourceToolName !== (toolNames.PlanarFreehandROI || 'PlanarFreehandROI')) return;
        const annotationId = String(sourceAnnotation?.annotationUID || '').trim();
        if (!annotationId) return;

        clearEchoAreaWorkflowListeners();
        restoreTool();

        const existing = await waitForViewerMeasurementServiceEntry(measurementService, annotationId);
        const echoArea = {
          slot: selectedSlot,
          phase: target.phase,
          view: 'A4C',
          method: 'closed-contour-planimetry',
        };

        sourceAnnotation.data = {
          ...(sourceAnnotation.data || {}),
          label: target.label,
          echoArea,
          measurementKind: 'echoAreaSlot',
        };
        sourceAnnotation.invalidated = true;

        const resultMeasurement = {
          ...(existing || {}),
          uid: annotationId,
          annotationUID: annotationId,
          toolName: sourceToolName,
          label: target.label,
          measurementRole: target.label,
          role: target.label,
          measurementKind: 'echoAreaSlot',
          echoArea,
          points: sourceAnnotation?.data?.contour?.polyline || existing?.points || [],
          measurements: {
            ...(existing?.measurements || {}),
            measurementKind: 'echoAreaSlot',
            echoArea,
          },
        };
        try {
          measurementService.update(annotationId, resultMeasurement, true);
          actions.markViewerMeasurementCreatedInSession?.({ uid: annotationId });
        } catch (error) {
          console.warn('[Echo Area] measurement service update failed:', error);
        }
        const displayViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (displayViewport) {
          installQuizCompositeContourTextOverrideForViewport({
            viewport: displayViewport, viewportId,
            measurementService, viewportGridService, displaySetService, toolGroupService,
          });
          displayViewport.render?.();
        }
        dispatchLiveMeasurementsRefresh({ reason: 'echo-area-created', annotationUID: annotationId });
        uiNotificationService.show({
          title: target.title,
          message: selectedSlot === 'RV_ED'
            ? 'RVEDA contour recorded. Select the end-systolic frame in the same cine and choose RV FAC again to capture RVESA.'
            : selectedSlot === 'RV_ES'
              ? 'RVESA contour recorded. Review RV FAC in AR Measurements.'
              : 'RA area contour recorded. Review its calibrated area in AR Measurements.',
          type: 'success',
          duration: 8500,
        });
      };

      eventTarget.addEventListener(Enums.Events.ANNOTATION_COMPLETED, echoAreaCompletionHandler);
      window.addEventListener('keydown', echoAreaEscapeHandler);
      uiNotificationService.show({
        title: target.title,
        message: target.prompt + ' Finish the closed trace to record; Esc cancels.',
        type: 'info',
        duration: 9000,
      });
      return { ok: true, sessionId, slot: selectedSlot };
    },
    startRAAreaWorkflow: (options: { clickTrace?: boolean } = {}) =>
      actions.startEchoAreaContourWorkflow({ ...options, slot: 'RA_ES' }),
    startRVFACWorkflow: () => {
      const measurements = getCurrentViewerMeasurementSnapshot(measurementService);
      const occupied = new Set(measurements.map(getEchoAreaSlot).filter(Boolean));
      const next = !occupied.has('RV_ED') ? 'RV_ED' : !occupied.has('RV_ES') ? 'RV_ES' : '';
      if (!next) {
        uiNotificationService.show({
          title: 'RV FAC',
          message: 'Both RV contours are present. Review FAC or delete the contour you intend to replace.',
          type: 'info',
          duration: 6000,
        });
        return { ok: false, reason: 'rv-fac-contours-complete' };
      }
      return actions.startGuidedRVFACContourWorkflow({ slot: next });
    },
    startSpectralDopplerVTIWorkflow: async ({
      preferredTargetKey = '',
      quizCapture = false,
    } = {}) => {
      clearEchoAreaWorkflowListeners();
      clearUltrasoundDirectionalWorkflowListeners();
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
      // A quiz's TR VTI target is already configured by its question.
      // Retain the target picker for existing clinical and general workflows.
      const selectedTarget = preferredTargetKey && quizCapture
        ? normalizeSpectralDopplerVtiTargetSelection(preferredTargetKey, {
            allowGeneric: true,
          })
        : await resolveSpectralDopplerVtiTarget({
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

      const reportMapping = quizCapture ? null : buildViewerReportMapping(selectedTarget);
      const measurementLabel = selectedTarget.reportMapped ||
        selectedTarget.key === 'spectral.trVti'
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
    startBowelCurvedLengthWorkflow: async () => {
      clearBowelCurvedLengthWorkflowListeners();

      const activeViewportId = viewportGridService.getActiveViewportId();
      const { viewport } = _getActiveViewportEnabledElement() || {};

      if (!activeViewportId || !viewport?.element) {
        uiNotificationService.show({
          title: 'Curved Length',
          message: 'No active image viewport is available.',
          type: 'warning',
          duration: 3500,
        });
        return null;
      }

      const selectedTarget = await resolveBowelCurvedLengthTarget({
        uiDialogService,
        customizationService,
      });

      if (!selectedTarget) {
        uiNotificationService.show({
          title: 'Curved Length',
          message: 'Choose the bowel report measurement that should receive this curved length.',
          type: 'warning',
          duration: 3500,
        });
        return null;
      }

      const reportMapping = buildViewerReportMapping(selectedTarget);
      const measurementLabel = selectedTarget.label;
      const freehandToolName = toolNames.PlanarFreehandROI || 'PlanarFreehandROI';
      const toolGroupReference = toolGroupService.getToolGroupForViewport(activeViewportId);
      const toolGroup =
        typeof toolGroupReference === 'string'
          ? toolGroupService.getToolGroup(toolGroupReference)
          : toolGroupReference;
      const previousToolConfiguration = toolGroup?.getToolConfiguration?.(freehandToolName) || {};

      try {
        toolGroup?.setToolConfiguration?.(
          freehandToolName,
          {
            ...previousToolConfiguration,
            allowOpenContours: true,
            calculateStats: true,
          },
          true
        );
      } catch (error) {
        console.warn('[Bowel Curved Length] could not enable open contours:', error);
      }

      const restoreToolConfiguration = () => {
        try {
          toolGroup?.setToolConfiguration?.(freehandToolName, previousToolConfiguration, true);
        } catch {}
      };

      const activation = actions.activateViewerMeasurementTool({
        toolName: freehandToolName,
        stopCine: true,
      });

      if (!activation?.ok) {
        restoreToolConfiguration();
        uiNotificationService.show({
          title: 'Curved Length',
          message: 'The freehand contour tool is not available in this viewport.',
          type: 'warning',
          duration: 4500,
        });
        return null;
      }

      const workflowSessionId = `${csUtils.uuidv4()}`;
      activeBowelCurvedLengthWorkflowSessionId = workflowSessionId;

      const restoreNavigationTool = () => {
        restoreToolConfiguration();
        try {
          const reference = toolGroupService.getToolGroupForViewport(activeViewportId);
          actions.setToolActive({
            toolName: toolNames.WindowLevel || 'WindowLevel',
            toolGroupId: reference,
          });
        } catch {}
      };

      bowelCurvedLengthEscapeHandler = (event: KeyboardEvent) => {
        if (
          event.key !== 'Escape' ||
          activeBowelCurvedLengthWorkflowSessionId !== workflowSessionId
        ) {
          return;
        }

        clearBowelCurvedLengthWorkflowListeners();
        restoreNavigationTool();
        uiNotificationService.show({
          title: 'Curved Length',
          message: 'Curved length measurement cancelled.',
          type: 'info',
          duration: 2500,
        });
      };

      bowelCurvedLengthCompletionHandler = async (event: Event) => {
        if (activeBowelCurvedLengthWorkflowSessionId !== workflowSessionId) {
          return;
        }

        const eventDetail = (event as CustomEvent)?.detail || {};
        const sourceAnnotation = eventDetail.annotation;
        const sourceToolName = String(sourceAnnotation?.metadata?.toolName || '');

        if (sourceToolName !== freehandToolName) {
          return;
        }

        const annotationId = String(sourceAnnotation?.annotationUID || '').trim();
        if (!annotationId) {
          return;
        }

        const contourClosed = sourceAnnotation?.data?.contour?.closed === true;

        clearBowelCurvedLengthWorkflowListeners({ resetSession: false });
        activeBowelCurvedLengthWorkflowSessionId = '';
        restoreNavigationTool();

        const mappedMeasurement = await waitForViewerMeasurementServiceEntry(
          measurementService,
          annotationId
        );

        if (contourClosed) {
          actions.removeMeasurement({ uid: annotationId });
          uiNotificationService.show({
            title: 'Curved Length',
            message:
              'The trace closed as an ROI, so it was removed. Curved length must be an open contour; redraw it and release with the endpoint away from the starting point.',
            type: 'warning',
            duration: 8000,
          });
          return null;
        }

        const contourPoints =
          sourceAnnotation?.data?.contour?.polyline ||
          sourceAnnotation?.data?.handles?.points ||
          mappedMeasurement?.points ||
          [];
        const referencedImageId =
          mappedMeasurement?.referencedImageId ||
          sourceAnnotation?.metadata?.referencedImageId ||
          '';

        const workingMeasurement = {
          ...(mappedMeasurement || {}),
          uid: annotationId,
          annotationUID: annotationId,
          toolName: freehandToolName,
          label: measurementLabel,
          measurementRole: measurementLabel,
          role: measurementLabel,
          measurementKind: BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
          reportMapping,
          contourClosed: false,
          points: contourPoints,
          referencedImageId,
          SOPInstanceUID:
            mappedMeasurement?.SOPInstanceUID || sourceAnnotation?.metadata?.SOPInstanceUID || '',
          referenceSeriesUID:
            mappedMeasurement?.referenceSeriesUID ||
            sourceAnnotation?.metadata?.SeriesInstanceUID ||
            '',
          referenceStudyUID:
            mappedMeasurement?.referenceStudyUID ||
            sourceAnnotation?.metadata?.StudyInstanceUID ||
            '',
          FrameOfReferenceUID:
            mappedMeasurement?.FrameOfReferenceUID ||
            sourceAnnotation?.metadata?.FrameOfReferenceUID ||
            '',
        };

        const cornerstonePhysicalStats = await waitForBowelCurvedLengthPhysicalStats({
          annotation: sourceAnnotation,
          referencedImageId,
          viewport,
        });
        const measurementForCurvedPayload = {
          ...workingMeasurement,
          data:
            sourceAnnotation?.data?.cachedStats &&
            Object.keys(sourceAnnotation.data.cachedStats).length > 0
              ? sourceAnnotation.data.cachedStats
              : workingMeasurement?.data || {},
          ...(cornerstonePhysicalStats
            ? {
                measurements: {
                  ...(workingMeasurement?.measurements || {}),
                  length: cornerstonePhysicalStats.length,
                  lengthUnit: cornerstonePhysicalStats.unit,
                  unit: cornerstonePhysicalStats.unit,
                },
              }
            : {}),
        };
        const curvedPayload = getBowelCurvedLengthMeasurementPayload(measurementForCurvedPayload);
        const lengthMM = finiteNumberOrNull(curvedPayload?.length);
        const displayText = curvedPayload?.displayText || [];

        const nextMeasurement = {
          ...workingMeasurement,
          measurements: {
            ...(workingMeasurement?.measurements || {}),
            ...curvedPayload,
          },
          displayText,
        };

        sourceAnnotation.metadata = {
          ...(sourceAnnotation.metadata || {}),
          toolName: freehandToolName,
          referencedImageId,
        };
        const curvedStatsKey = referencedImageId ? `imageId:${referencedImageId}` : '';
        const existingCurvedStats = sourceAnnotation.data?.cachedStats || {};

        sourceAnnotation.data = {
          ...(sourceAnnotation.data || {}),
          label: measurementLabel,
          measurementKind: BOWEL_CURVED_LENGTH_MEASUREMENT_KIND,
          reportMapping,
          contour: {
            ...(sourceAnnotation.data?.contour || {}),
            closed: false,
            polyline: contourPoints,
          },
          handles: {
            ...(sourceAnnotation.data?.handles || {}),
            points:
              contourPoints.length > 1
                ? [contourPoints[0], contourPoints[contourPoints.length - 1]]
                : contourPoints,
          },
          cachedStats:
            curvedStatsKey && lengthMM != null
              ? {
                  ...existingCurvedStats,
                  [curvedStatsKey]: {
                    ...(existingCurvedStats[curvedStatsKey] || {}),
                    length: lengthMM,
                    lengthUnit: 'mm',
                    unit: 'mm',
                  },
                }
              : existingCurvedStats,
          arSavedMeasurementDisplayText: displayText,
        };
        sourceAnnotation.invalidated = false;

        try {
          measurementService.update(annotationId, nextMeasurement, true);
          actions.markViewerMeasurementCreatedInSession?.({ uid: annotationId });
        } catch (error) {
          console.warn('[Bowel Curved Length] measurementService.update failed:', error);
        }

        installSpectralDopplerTextOverrideForViewport({
          viewport,
          viewportId: activeViewportId,
        });

        dispatchLiveMeasurementsRefresh({
          reason: 'bowel-curved-length-created',
          annotationUID: annotationId,
          calibrated: lengthMM != null,
        });

        try {
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(annotationId, true);
          viewport.render?.();
        } catch {}

        uiNotificationService.show({
          title: 'Curved Length',
          message:
            lengthMM != null
              ? `${measurementLabel}: ${formatLengthMM(lengthMM)} mm`
              : 'The open trace was preserved, but calibrated physical length was unavailable. It will not overwrite an AR report value.',
          type: lengthMM != null ? 'success' : 'warning',
          duration: lengthMM != null ? 6000 : 8000,
        });

        return nextMeasurement;
      };

      eventTarget.addEventListener(
        Enums.Events.ANNOTATION_COMPLETED,
        bowelCurvedLengthCompletionHandler
      );
      window.addEventListener('keydown', bowelCurvedLengthEscapeHandler);

      uiNotificationService.show({
        title: 'Curved Length',
        message: `Trace the open path for ${measurementLabel}. Release to finish, keeping the endpoint away from the start so the contour remains open. Press Esc to cancel.`,
        type: 'info',
        duration: 8000,
      });

      return {
        ok: true,
        sessionId: workflowSessionId,
        toolName: freehandToolName,
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
        viewerMeasurementsModifiedInSession.delete(measurementId);
        viewerMeasurementsDeletedInSession.add(measurementId);
        removeLVSimpsonSessionMeasurement(measurementId);
        removeLAVolumeSessionMeasurement(measurementId);
        removeCineCommentSessionMeasurement(measurementId);

        if (sourceAnnotation) {
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(measurementId, false);
        }

        if (measurement) {
          measurementService.remove(measurementId);
        }

        // Viewer-owned LV/LA contours are manually hydrated into Cornerstone and can
        // outlive their MeasurementService entry. Always remove any remaining source
        // annotation so delete/recreate cycles cannot accumulate ghost spline geometry.
        if (annotation.state.getAnnotation?.(measurementId)) {
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

      const title = existingText
        ? isCoachingAnnotation
          ? 'Edit Coaching Annotation'
          : 'Edit Image Annotation'
        : isCoachingAnnotation
          ? 'Add Coaching Annotation'
          : 'Add Image Annotation';

      const value = await callMultilineTextDialog({
        uiDialogService,
        title,
        placeholder: isCoachingAnnotation
          ? 'Describe the finding or area of interest for review'
          : 'Enter annotation text',
        defaultValue: existingText,
        helperText: 'Use Enter for new lines. Ctrl/Cmd+Enter saves the annotation.',
        saveLabel: existingText ? 'Update Annotation' : 'Add Annotation',
      });

      callback?.(value);
    },
    addViewerCineComment: async () => {
      const saveTarget = getArViewerSaveTargetFromUrl();
      const isReviewWorkflow = isReviewWorkflowMeasurementsSaveTarget(saveTarget);
      const reviewWorkflow = getWritableReviewMeasurementWorkflow(saveTarget);

      if (isReviewWorkflow && !reviewWorkflow) {
        return {
          ok: false,
          reason: 'review-workflow-read-only',
        };
      }

      const workflow = reviewWorkflow || VIEWER_MEASUREMENTS_WORKFLOW;

      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      const displaySet = getActiveViewportDisplaySet({
        viewportGridService,
        displaySetService,
        viewportId: activeViewportId,
      });
      const imageInfo = viewport ? getCurrentViewportImageInfo(viewport) : null;

      if (!viewport || !displaySet || !imageInfo?.imageId) {
        uiNotificationService.show({
          title: 'Cine Comment',
          message: 'Open the cine you want to comment on, then try again.',
          type: 'warning',
          duration: 4000,
        });

        return {
          ok: false,
          reason: 'active-cine-not-found',
        };
      }

      const value = await callMultilineTextDialog({
        uiDialogService,
        title: 'Add Cine Comment',
        placeholder: 'Enter a general comment about this cine loop',
        helperText:
          'This comment applies to the cine as a whole; no arrow or shape is required. Use Enter for new lines.',
        saveLabel: 'Add Cine Comment',
      });

      const text = String(value || '').trim();

      if (!text) {
        return {
          ok: false,
          reason: 'cancelled',
        };
      }

      const annotationUID = `${csUtils.uuidv4()}`;
      const frameNumber = getFrameNumberFromReferencedImageId(imageInfo.imageId);
      let anchorWorldPoint = [0, 0, 0];

      try {
        const element = viewport.element;
        const width = Number(element?.clientWidth || element?.getBoundingClientRect?.()?.width || 0);
        const height = Number(element?.clientHeight || element?.getBoundingClientRect?.()?.height || 0);
        const worldPoint =
          width > 0 && height > 0
            ? viewport.canvasToWorld?.([width / 2, height / 2])
            : viewport.getCamera?.()?.focalPoint;

        if (worldPoint && Array.from(worldPoint).length >= 3) {
          const candidatePoint = Array.from(worldPoint).slice(0, 3).map(Number);

          if (candidatePoint.every(Number.isFinite)) {
            anchorWorldPoint = candidatePoint;
          }
        }
      } catch {}

      const sopInstanceId =
        getSopInstanceIdFromImageId(imageInfo.imageId) ||
        displaySet?.SOPInstanceUID ||
        displaySet?.sopInstanceUID ||
        '';
      const measurementOwner = isReviewWorkflow
        ? workflow === REVIEWER_MEASUREMENTS_WORKFLOW
          ? 'coach'
          : 'learner'
        : '';

      const measurement = {
        uid: annotationUID,
        annotationUID,
        toolName: 'ArrowAnnotate',
        label: 'Cine comment',
        measurementRole: 'Cine comment',
        role: 'Cine comment',
        annotationKind: CINE_COMMENT_ANNOTATION_KIND,
        commentScope: CINE_COMMENT_SCOPE,
        text,
        textBox: null,
        workflow,
        ...(measurementOwner ? { measurementOwner } : {}),
        isLocked: false,
        arCreatedInViewerSession: true,
        referenceStudyUID: displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || '',
        referenceSeriesUID: displaySet?.SeriesInstanceUID || displaySet?.seriesInstanceUID || '',
        SOPInstanceUID: sopInstanceId,
        FrameOfReferenceUID: viewport.getFrameOfReferenceUID?.() || '',
        displaySetInstanceUID: displaySet?.displaySetInstanceUID || '',
        referencedImageId: imageInfo.imageId,
        frameNumber,
        // Keep one invisible viewport-center anchor so cine comments use the same
        // canonical viewer-annotation persistence/navigation contract in every workflow,
        // while never hydrating that anchor as visible ArrowAnnotate geometry.
        points: [anchorWorldPoint],
        displayText: [text],
        measurements: {
          text,
          displayText: [text],
          annotationKind: CINE_COMMENT_ANNOTATION_KIND,
          commentScope: CINE_COMMENT_SCOPE,
        },
      };

      viewerMeasurementsDeletedInSession.delete(annotationUID);
      viewerMeasurementsModifiedInSession.delete(annotationUID);
      viewerMeasurementsCreatedInSession.add(annotationUID);
      upsertCineCommentSessionMeasurement(measurement);

      dispatchLiveMeasurementsRefresh({
        reason: 'cine-comment-created',
        annotationUID,
      });

      uiNotificationService.show({
        title: 'Cine Comment',
        message: 'Cine comment added. Save measurements & annotations to persist it.',
        type: 'success',
        duration: 3000,
      });

      return {
        ok: true,
        annotationUID,
      };
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
      setQuizToolbarMeasurementKind('');
      // Sometimes it is passed as value (tools with options), sometimes as itemId (toolbar buttons)
      toolName = toolName || itemId || value;
      if (lvSimpsonMouseTools.isActive() && activeLVSimpsonWorkflowSessionId) {
        clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
      }

      if (
        toolName === ULTRASOUND_DIRECTIONAL_TOOL_NAME &&
        inferDomainWithoutSeriesDoc('') === 'echo' &&
        isClinicalReportMeasurementsSaveTarget(getArViewerSaveTargetFromUrl())
      ) {
        return actions.startUltrasoundDirectionalWorkflow();
      }

      clearUltrasoundDirectionalWorkflowListeners();
      clearEchoAreaWorkflowListeners();
      toolGroupIds = toolGroupIds.length ? toolGroupIds : toolGroupService.getToolGroupIds();

      toolGroupIds.forEach(toolGroupId => {
        actions.setToolActive({ toolName, toolGroupId });
      });
    },
    setViewerLengthLabelMode: ({ labelMode = VIEWER_LENGTH_LABEL_MODE_PROMPT } = {}) => {
      viewerLengthLabelMode = normalizeViewerLengthLabelMode(labelMode);
      return viewerLengthLabelMode;
    },
    /**
     * Quiz-only: the learner explicitly selected expiration/inspiration in
     * the question panel, so no second Length label selection is necessary.
     * Only a new, unlabeled Length measurement on the requested DICOM frame
     * is eligible. This never assigns labels in general clinical or bowel UI.
     */
    setViewerQuizIVCPhaseLabel: ({
      measurementId = '', slot = '', expectedTarget = null,
    } = {}) => {
      const id = String(measurementId || '').trim();
      const phase = String(slot || '').trim().toUpperCase();
      if (!id || !['IVC_EXP', 'IVC_INSP'].includes(phase)) {
        return { ok: false, reason: 'invalid-ivc-phase-selection' };
      }
      const measurement = measurementService.getMeasurement?.(id);
      if (!measurement || String(measurement.toolName || '') !== 'Length') {
        return { ok: false, reason: 'length-measurement-unavailable' };
      }
      const activeLabel = String(
        measurement.label || measurement.measurementRole || ''
      ).trim();
      const requestedLabel = phase === 'IVC_EXP' ? 'IVCexp' : 'IVCinsp';
      if (activeLabel && !['Length', requestedLabel].includes(activeLabel)) {
        return { ok: false, reason: 'already-labelled-differently' };
      }
      const target = expectedTarget || {};
      if (target && Object.keys(target).length > 0) {
        const actual = {
          study: String(measurement.referenceStudyUID || measurement.StudyInstanceUID || ''),
          series: String(measurement.referenceSeriesUID || measurement.SeriesInstanceUID || ''),
          sop: String(measurement.SOPInstanceUID || measurement.metadata?.SOPInstanceUID || ''),
          image: String(measurement.referencedImageId || measurement.metadata?.referencedImageId || ''),
          frame: getFrameNumberFromReferencedImageId(
            measurement.referencedImageId || measurement.metadata?.referencedImageId || ''
          ),
        };
        if (!actual.study || !actual.series || !actual.sop ||
            !target.studyInstanceUID || !target.seriesInstanceUID ||
            !target.sopInstanceUID ||
            actual.study !== String(target.studyInstanceUID) ||
            actual.series !== String(target.seriesInstanceUID) ||
            actual.sop !== String(target.sopInstanceUID) ||
            Number(target.frameNumber) !== actual.frame ||
            (target.referencedImageId && normalizeImageIdForCompare(actual.image) !==
              normalizeImageIdForCompare(String(target.referencedImageId)))) {
          return { ok: false, reason: 'ivc-source-frame-mismatch' };
        }
      }
      const cornerstoneAnnotation = cornerstoneTools.annotation.state.getAnnotation?.(id);
      if (cornerstoneAnnotation?.data?.arPendingLengthLabel === true) {
        delete cornerstoneAnnotation.data.arPendingLengthLabel;
      }
      if (activeLabel !== requestedLabel) {
        measurementService.update(id, {
          ...measurement, label: requestedLabel,
          measurementRole: requestedLabel,
        }, true);
        viewerMeasurementsModifiedInSession.add(id);
      }
      viewerLengthLabelMode = VIEWER_LENGTH_LABEL_MODE_PROMPT;
      window.dispatchEvent(new CustomEvent('ar-learning:quiz-measurement-labelled', {
        detail: { measurementId: id },
      }));
      dispatchLiveMeasurementsRefresh({ kind: 'ivc-quiz-phase-labelled' });
      return { ok: true, slot: phase, label: requestedLabel };
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
      // Unlike automatic quiz Length activation, a deliberate toolbar click
      // requests a different tool and should leave the guided EF workflow.
      if (lvSimpsonMouseTools.isActive() && activeLVSimpsonWorkflowSessionId) {
        clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
      }
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
      if (
        lvSimpsonMouseTools.shouldDeferLengthActivation(toolName) ||
        laVolumeMouseTools.shouldDeferLengthActivation(toolName)
      ) {
        return;
      }
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

      // Cancel only a currently unfinished Length drawing on Escape.
      updatePendingLengthEscapeHandler(toolName, toolGroup);

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

      if (
        lvSimpsonMouseTools.shouldDeferLengthActivation(toolName) ||
        laVolumeMouseTools.shouldDeferLengthActivation(toolName)
      ) {
        return {
          ok: true,
          deferred: true,
          reason: 'lv-simpson-owns-primary-mouse',
          toolName,
          toolGroupId,
          activeViewportId,
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
    setViewerQuizMeasurementContext: ({ measurementKind = '' } = {}) => {
      if (activeQuizMeasurementKind !== String(measurementKind || '').trim()) {
        // A question switch ends the previous acquisition before the next tool
        // activates. Otherwise EF/LA can retain primary mouse ownership while
        // TR or an IVC caliper is being started in the new question.
        clearEchoAreaWorkflowListeners();
        clearUltrasoundDirectionalWorkflowListeners();
        if (activeLVSimpsonWorkflowSessionId) {
          clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
        }
        if (activeLAVolumeWorkflowSessionId) {
          clearLAVolumeWorkflowIfCurrent(activeLAVolumeWorkflowSessionId);
        }
      }
      setQuizToolbarMeasurementKind(measurementKind);
      return { ok: true, measurementKind: activeQuizMeasurementKind };
    },
    activateViewerQuizMeasurementTool: ({
      toolName = 'Length',
      measurementKind = '',
      efContourTargets = null,
      questionKey = '',
    } = {}) => {
      setQuizToolbarMeasurementKind(measurementKind);
      if (measurementKind === 'lvSimpsonEF') {
        if (activeLAVolumeWorkflowSessionId) {
          clearLAVolumeWorkflowIfCurrent(activeLAVolumeWorkflowSessionId);
        }
        if (activeLVSimpsonWorkflowSessionId) {
          clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
        }
        // Opening the EF question must *not* explicitly request A4C ED:
        // the workflow first restores any saved contours and then chooses
        // review mode (4/4 complete) or the next missing slot. Explicit
        // replacement still comes from each row's Freehand/Axis+Apex action.
        // Duplicate focus/click events are suppressed by Case Questions.
        void actions.startLVSimpsonEFWorkflow({
          efContourTargets,
          questionKey,
        }).catch(error =>
          console.warn('[Viewer quiz] EF activation failed:', error)
        );
        return { ok: true, measurementKind, workflowStarted: true };
      }
      if (measurementKind === 'trVmax') {
        void actions.startUltrasoundDirectionalWorkflow({
          spectralVmax: true,
          preferredTargetKey: 'echo.trPeakVelocity',
          quizCapture: true,
        }).catch(error => console.warn('[Viewer quiz] TR Vmax activation failed:', error));
        return { ok: true, measurementKind, workflowStarted: true };
      }
      if (measurementKind === 'trVTI') {
        void actions.startSpectralDopplerVTIWorkflow({
          preferredTargetKey: 'spectral.trVti',
          quizCapture: true,
        }).catch(error => console.warn('[Viewer quiz] TR VTI activation failed:', error));
        return { ok: true, measurementKind, workflowStarted: true };
      }
      if (measurementKind === 'ivcCollapsibility' || measurementKind === 'ivcRapRvsp') {
        // Uses the same calibrated Length tool and AR measurement labels as
        // clinical IVC. Capture IVCexp and IVCinsp on distinct cine frames;
        // quiz capture verifies both labels and values before submission.
        return actions.activateViewerMeasurementTool({ toolName: 'Length', stopCine: true });
      }
      if (measurementKind === 'rvFAC') {
        // RV FAC education offers freehand and axis+apex separately for ED/ES.
        // Do not start a guided contour before the user chooses a technique.
        return { ok: true, measurementKind, awaitingTechnique: true };
      }
      if (measurementKind === 'raArea') {
        if (activeLVSimpsonWorkflowSessionId) {
          clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
        }
        if (activeLAVolumeWorkflowSessionId) {
          clearLAVolumeWorkflowIfCurrent(activeLAVolumeWorkflowSessionId);
        }
        const command = actions.startRAAreaWorkflow({ clickTrace: true });
        void Promise.resolve(command).catch(error =>
          console.warn('[Viewer quiz] right-heart capture activation failed:', error)
        );
        return { ok: true, measurementKind, workflowStarted: true };
      }
      if (measurementKind === 'laVolumeBiplane' || measurementKind === 'laVolumeBiplaneDisks') {
        // The educational asset defines independently selected A4C/A2C frames.
        // Both roles choose a contour technique for each view rather than
        // silently starting axis+apex on whichever image happens to be active.
        if (activeLAVolumeWorkflowSessionId) {
          clearLAVolumeWorkflowIfCurrent(activeLAVolumeWorkflowSessionId);
        }
        return { ok: true, measurementKind, awaitingTechnique: true };
      }
      if (activeLVSimpsonWorkflowSessionId) {
        clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
      }
      if (activeLAVolumeWorkflowSessionId) {
        clearLAVolumeWorkflowIfCurrent(activeLAVolumeWorkflowSessionId);
      }
      return actions.activateViewerMeasurementTool({ toolName, stopCine: true });
    },
    releaseViewerQuizDrawingTool: () => {
      setQuizToolbarMeasurementKind('');
      if (activeLVSimpsonWorkflowSessionId) {
        clearLVSimpsonWorkflowIfCurrent(activeLVSimpsonWorkflowSessionId);
      }
      if (activeLAVolumeWorkflowSessionId) {
        clearLAVolumeWorkflowIfCurrent(activeLAVolumeWorkflowSessionId);
      }
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
      const cornerstoneFallbackMeasurements =
        getCornerstoneUltrasoundDirectionalMeasurementFallbacks({
          excludedMeasurementIds: viewerMeasurementsDeletedInSession,
        });
      const measurements = getCurrentViewerMeasurementSnapshot(
        measurementService,
        cornerstoneFallbackMeasurements
      );

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
    getViewerQuizLVSimpsonForActiveStudy: () => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const activeDisplaySet = getActiveViewportDisplaySet({
        viewportGridService,
        displaySetService,
        viewportId: activeViewportId,
      });
      const studyInstanceId = String(
        activeDisplaySet?.StudyInstanceUID || activeDisplaySet?.studyInstanceUID || ''
      ).trim();
      return getExplicitLVSimpsonResult(studyInstanceId);
    },
    getViewerMeasurementSnapshotForPanel: () => {
      const saveTarget = getArViewerSaveTargetFromUrl();
      const writableWorkflow = getWritableReviewMeasurementWorkflow(saveTarget);
      const directionalFallbacks = getCornerstoneUltrasoundDirectionalMeasurementFallbacks({
        excludedMeasurementIds: viewerMeasurementsDeletedInSession,
      });

      return getCurrentViewerMeasurementSnapshot(measurementService, directionalFallbacks).map(
        measurement => {
          if (!isUltrasoundDirectionalViewerMeasurement(measurement)) {
            return measurement;
          }

          const measurementId = getMeasurementAnnotationId(measurement);
          const createdInViewerSession =
            !!measurementId && viewerMeasurementsCreatedInSession.has(measurementId);

          return {
            ...measurement,
            arCreatedInViewerSession: createdInViewerSession,
            ...(createdInViewerSession && writableWorkflow
              ? {
                  workflow: writableWorkflow,
                  measurementOwner:
                    writableWorkflow === REVIEWER_MEASUREMENTS_WORKFLOW ? 'coach' : 'learner',
                  isLocked: false,
                }
              : {}),
          };
        }
      );
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

      if (isCineCommentViewerMeasurement(savedAnnotation)) {
        hydratedViewport.render?.();

        return {
          ok: true,
          source: 'cine-comment',
          annotationId,
          viewportId: hydratedViewport.id || targetViewportId,
          referencedImageId:
            readyReferencedImageId ||
            actualReferencedImageId ||
            savedAnnotation.referencedImageId ||
            '',
        };
      }

      const hydratedAnnotation = isUltrasoundDirectionalViewerMeasurement(savedAnnotation)
        ? hydrateSavedUltrasoundDirectionalForViewport({
            savedAnnotation,
            viewport: hydratedViewport,
            viewportId: hydratedViewport.id || targetViewportId,
            referencedImageIdOverride: readyReferencedImageId || actualReferencedImageId || '',
            fallbackFrameOfReferenceUID:
              hydratedViewport.getFrameOfReferenceUID?.() ||
              savedAnnotation.FrameOfReferenceUID ||
              '',
            selectAnnotation,
          })
        : savedAnnotation.toolName === 'Length'
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

      // Reattach the renderer override on restored quiz contours as well as
      // newly drawn ones. Saved display text metadata does not itself alter
      // Cornerstone's native getTextLines output.
      if (!isSpectralDopplerViewerMeasurement(savedAnnotation) &&
          (getEchoAreaSlot(savedAnnotation) || isLAVolumeMeasurement(savedAnnotation))) {
        installQuizCompositeContourTextOverrideForViewport({
          viewport: hydratedViewport,
          viewportId: hydratedViewport.id || targetViewportId,
          measurementService, viewportGridService, displaySetService, toolGroupService,
        });
      }

      // Cornerstone-owned AR annotations (VTI traces and directional US measurements)
      // must not round-trip through MeasurementService here. Their persisted AR payload
      // and Cornerstone annotation state are the source of truth for viewport display.
      if (!isCornerstoneOwnedViewerMeasurement(savedAnnotation)) {
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

      if (isUltrasoundDirectionalViewerMeasurement(savedAnnotation)) {
        for (const delayMs of [50, 150, 300]) {
          await sleep(delayMs);

          try {
            const { triggerAnnotationRenderForViewportIds } = await import(
              '@cornerstonejs/tools/utilities'
            );

            triggerAnnotationRenderForViewportIds([hydratedViewport.id || targetViewportId]);
          } catch (error) {
            console.warn('[MeasurementAnnotations] directional delayed render failed:', error);
          }

          hydratedViewport.render?.();
        }
      }

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
        if (isCineCommentViewerMeasurement(savedAnnotation)) {
          continue;
        }

        const hydratedAnnotation = isUltrasoundDirectionalViewerMeasurement(savedAnnotation)
          ? hydrateSavedUltrasoundDirectionalForViewport({
              savedAnnotation,
              viewport,
              viewportId: viewport.id || viewportId,
              referencedImageIdOverride: referencedImageId,
              fallbackFrameOfReferenceUID:
                viewport.getFrameOfReferenceUID?.() || savedAnnotation.FrameOfReferenceUID || '',
              selectAnnotation: false,
            })
          : savedAnnotation.toolName === 'Length'
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

        if (!isCornerstoneOwnedViewerMeasurement(savedAnnotation)) {
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
          await Promise.resolve(actions.setDisplaySetsForViewports({ viewportsToUpdate }));
          await sleep(300);
        }
      }

      const resolveTargetViewport = () =>
        cornerstoneViewportService.getCornerstoneViewport(targetViewportId) ||
        cornerstoneViewportService.getCornerstoneViewport(
          viewportGridService.getActiveViewportId()
        );
      const viewport = resolveTargetViewport();

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

      const jumpResult = await jumpViewportToViewerQuizTargetImage(
        viewport, target, resolveTargetViewport
      );

      // Navigating between saved quiz source frames can change the viewport's
      // tool group; keep the area renderer attached before displaying contours.
      if (jumpResult?.ok !== false) {
        installQuizCompositeContourTextOverrideForViewport({
          viewport: resolveTargetViewport(),
          viewportId: targetViewportId,
          measurementService, viewportGridService, displaySetService, toolGroupService,
        });
      }

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
    // Saved multi-BWT answers contain a collection of annotation IDs, not one
    // top-level measurement reference. Resolve exactly those learner calipers
    // and render them together on their captured DICOM frame.
    showViewerQuizLearnerBwtMeasurementSet: async ({
      learnerMeasurements = [],
      selectedSourceAnnotationId = '',
      questionKey = '',
    } = {}) => {
      const references = Array.isArray(learnerMeasurements) ? learnerMeasurements : [];
      const ids = references.map(item => getViewerQuizMeasurementSourceAnnotationId(item));
      const selectedId = String(selectedSourceAnnotationId || '').trim();
      if (!references.length || references.length > 4 || ids.some(id => !id) ||
          new Set(ids).size !== ids.length ||
          (selectedId && !ids.includes(selectedId))) {
        return { ok: false, reason: 'invalid-learner-bwt-reference', renderedCount: 0 };
      }

      // A learner quiz must never retrieve a BWT annotation from the educator
      // base study. Persisted data comes from the identified learner copy only.
      // Newly captured, not-yet-saved calipers can come from the live service.
      const { learnerSeriesDoc } = await getViewerQuizMeasurementSeriesDocs({ includeBaseSeries: false });
      const annotations = references.map(reference => {
        const saved = findViewerQuizBowelLearnerAnnotation(reference, learnerSeriesDoc);
        if (saved) return saved;
        const sourceId = getViewerQuizMeasurementSourceAnnotationId(reference);
        // Only this viewer session's newly drawn calipers may use a live
        // MeasurementService fallback. Never resolve an educator/base annotation.
        return viewerMeasurementsCreatedInSession.has(sourceId)
          ? getViewerQuizMeasurementAnnotationFromService(reference)
          : null;
      });
      if (annotations.some(item => !item)) {
        console.warn('[ViewerQuiz] learner BWT source annotations missing', {
          questionKey,
          requestedCount: references.length,
          resolvedCount: annotations.filter(Boolean).length,
        });
        return { ok: false, reason: 'learner-bwt-source-annotation-not-found', renderedCount: 0 };
      }

      // Check captured SOP/frame identity before handing anything to a
      // viewport hydration command. Never substitute a similar gold annotation.
      const frameKey = (target: any) => [
        String(target?.studyInstanceUID || '').trim(),
        String(target?.seriesInstanceUID || '').trim(),
        String(target?.sopInstanceUID || '').trim(),
        Number(target?.frameNumber || 0),
      ].join('|');
      const initialTarget = references[0]?.viewerTarget || {};
      const expectedFrame = frameKey(initialTarget);
      if (!initialTarget.studyInstanceUID || !initialTarget.seriesInstanceUID ||
          !initialTarget.sopInstanceUID || Number(initialTarget.frameNumber || 0) < 1 ||
          references.some(item => frameKey(item.viewerTarget) !== expectedFrame)) {
        return { ok: false, reason: 'learner-bwt-frame-mismatch', renderedCount: 0 };
      }
      const verified = annotations.map((saved, index) => {
        const target = references[index]?.viewerTarget || {};
        const expectedSop = String(target.sopInstanceUID || '').trim();
        const actualSop = String(saved?.SOPInstanceUID || '').trim();
        const expectedFrameNumber = Number(target.frameNumber || 0);
        const actualFrameNumber = Number(getFrameNumberForAnnotation(saved));
        if (!expectedSop || actualSop !== expectedSop || expectedFrameNumber < 1 ||
            (actualFrameNumber > 0 && actualFrameNumber !== expectedFrameNumber)) {
          return null;
        }
        return saved;
      });
      if (verified.some(item => !item)) {
        return { ok: false, reason: 'learner-bwt-annotation-target-mismatch', renderedCount: 0 };
      }

      // Quiz responses intentionally omit geometric evidence. Recover it only
      // from exact, verified learner-owned persisted annotations (never quiz
      // JSON or educator/base study snapshots). The panel uses this for
      // informational spacing and angle, not for scoring or quiz persistence.
      const trustedSpatialEvidence = verified.map((source, index) => {
        const evidence = findViewerQuizBowelLearnerAnnotation(
          references[index], learnerSeriesDoc
        )?.quizSpatialEvidence;
        return {
          sourceAnnotationId: ids[index],
          ...(evidence?.source === 'dicom-calibrated-image-index-v1'
            ? { quizSpatialEvidence: evidence } : {}),
        };
      });

      const selectedIndex = selectedId ? ids.indexOf(selectedId) : 0;
      // All BWT answer targets have passed SOP/frame verification. Normalize
      // their saved image aliases for the shared same-image group renderer,
      // retaining each learner-owned annotation's actual calibrated points.
      const imageId = String(
        references[selectedIndex]?.viewerTarget?.referencedImageId ||
        verified[selectedIndex]?.referencedImageId || ''
      ).trim();
      const sourcesToDisplay = verified.map(source => ({
        ...source,
        ...(imageId ? { referencedImageId: imageId } : {}),
      }));
      const displayed = await actions.showSavedViewerAnnotationsForSameImage({
        annotations: sourcesToDisplay,
        referenceAnnotation: sourcesToDisplay[selectedIndex],
        selectReferenceAnnotation: true,
      });
      const renderedCount = Number(displayed?.hydratedCount || 0);
      if (displayed?.ok !== true || renderedCount !== verified.length) {
        console.warn('[ViewerQuiz] learner BWT set not fully displayed', {
          questionKey,
          reason: displayed?.reason || 'incomplete-bwt-hydration',
          expectedCount: verified.length,
          renderedCount,
        });
        return {
          ...displayed,
          ok: false,
          reason: displayed?.reason || 'incomplete-bwt-hydration',
          renderedCount,
        };
      }

      // Length hydration can return a Cornerstone annotation object without
      // indexing it under the active stack viewport's actual annotation group.
      // Confirm real viewport registration, not only the hydration count.
      const viewportId = displayed.viewportId || viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport?.element) {
        return { ok: false, reason: 'learner-bwt-viewport-unavailable', renderedCount: 0 };
      }
      const manager = annotation.state.getAnnotationManager?.();
      const groupKey = manager?.getGroupKey?.(viewport.element);
      // Cornerstone uses annotationUID; saved AR rows use uid/annotationId.
      // Comparing them with getAnnotationId() falsely reports zero overlays
      // even when the calipers are visibly registered on the viewport.
      const visibleOnViewport = (annotationId: string) =>
        (annotation.state.getAnnotations?.('Length', viewport.element) || []).some(
          item => getMeasurementAnnotationId(item) === annotationId
        );

      let indexedCount = 0;
      for (const source of sourcesToDisplay) {
        const annotationId = getAnnotationId(source);
        const live = annotation.state.getAnnotation?.(annotationId);
        if (!live) continue;
        if (!visibleOnViewport(annotationId) && manager?.addAnnotation && groupKey != null) {
          annotation.state.removeAnnotation?.(annotationId);
          live.metadata = {
            ...(live.metadata || {}),
            FrameOfReferenceUID: groupKey,
          };
          manager.addAnnotation(live, groupKey);
        }
        if (visibleOnViewport(annotationId)) {
          live.isVisible = true;
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(
            annotationId, annotationId === ids[selectedIndex]
          );
          indexedCount += 1;
        }
      }
      try {
        const { triggerAnnotationRenderForViewportIds } = await import(
          '@cornerstonejs/tools/utilities'
        );
        triggerAnnotationRenderForViewportIds([viewport.id || viewportId]);
      } catch {}
      viewport.render?.();
      if (indexedCount !== verified.length) {
        console.warn('[ViewerQuiz] BWT annotations not indexed in viewport', {
          questionKey, expectedCount: verified.length, indexedCount,
        });
        return {
          ...displayed, ok: false, reason: 'learner-bwt-viewport-registration-failed',
          renderedCount: indexedCount,
          trustedSpatialEvidence,
        };
      }

      return {
        ...displayed, ok: true, renderedCount: indexedCount,
        learnerRendered: true, trustedSpatialEvidence,
      };
    },

    /**
     * Learner composite quiz reopen: restore EACH exact, persisted learner
     * source annotation on its own referenced DICOM image/frame. Never use
     * educator gold or an approximate measurement lookup as a substitute.
     * This restores drawing evidence without changing quiz scores or report.
     */
    showViewerQuizLearnerCompositeMeasurement: async ({
      learnerMeasurement = {}, viewerTarget = null, questionKey = '',
    } = {}) => {
      const kind = String(learnerMeasurement?.measurementKind || '').trim();
      const slots = kind === 'rvFAC' ? ['RV_ED', 'RV_ES']
        : ['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(kind)
          ? ['A4C', 'A2C']
          : kind === 'ivcCollapsibility' || kind === 'ivcRapRvsp'
            ? ['IVC_EXP', 'IVC_INSP'] : [];
      const sourceComposite = kind === 'ivcRapRvsp'
        ? learnerMeasurement?.compositeResult?.ivc?.compositeResult
        : learnerMeasurement?.compositeResult;
      const components = Array.isArray(sourceComposite?.components)
        ? sourceComposite.components : [];
      if (slots.length !== 2 || components.length !== slots.length ||
          slots.some(slot => components.filter(item => item?.slot === slot).length !== 1)) {
        return { ok: false, restoredCount: 0, reason: 'learner-composite-source-incomplete' };
      }
      const saveTarget = getArViewerSaveTargetFromUrl();
      const learnerId = String(
        saveTarget.learnerSeriesId || saveTarget.seriesId || ''
      ).trim();
      const { learnerSeriesDoc } = await getViewerQuizMeasurementSeriesDocs({
        includeBaseSeries: false,
      });
      // A learner view can only use its isolated copy; never load a source
      // teaching study (or a previously opened educator's measurements).
      if (!learnerId || !learnerSeriesDoc ||
          String(learnerSeriesDoc._id || '') !== learnerId ||
          learnerSeriesDoc.isLearnerCopy !== true) {
        return { ok: false, restoredCount: 0, reason: 'learner-copy-not-available' };
      }
      const existing = getRequestedWorkflowAnnotations(
        learnerSeriesDoc.MeasurementAnnotations, [VIEWER_MEASUREMENTS_WORKFLOW]
      );
      const sources = [];
      const sourceFrames = new Set<string>();
      const sourceIds = new Set<string>();
      for (const slot of slots) {
        const component = components.find(item => item.slot === slot);
        const expected = component?.target || {};
        const sourceId = String(component?.annotationId || '').trim();
        const saved = existing.filter(item =>
          getMeasurementAnnotationId(item) === sourceId
        );
        const sourceFrame = [
          expected.studyInstanceUID, expected.seriesInstanceUID,
          expected.sopInstanceUID, expected.frameNumber,
        ].map(value => String(value || '')).join('|');
        if (!sourceId || sourceIds.has(sourceId) ||
            sourceFrames.has(sourceFrame) || saved.length !== 1 ||
            !expected.studyInstanceUID || !expected.seriesInstanceUID ||
            !expected.sopInstanceUID ||
            !Number.isSafeInteger(Number(expected.frameNumber)) ||
            Number(expected.frameNumber) < 1 ||
            !Array.isArray(component?.points) ||
            component.points.length < (kind === 'ivcCollapsibility' || kind === 'ivcRapRvsp' ? 2 : 3)) {
          return { ok: false, restoredCount: 0, reason: 'learner-source-annotation-unavailable', slot };
        }
        const annotation = saved[0];
        const image = String(annotation.referencedImageId || '').trim();
        const savedFrame = getFrameNumberFromReferencedImageId(image);
        const expectedImage = String(expected.referencedImageId || '').trim();
        if (String(annotation.StudyInstanceUID || '') !== String(expected.studyInstanceUID) ||
            String(annotation.SeriesInstanceUID || '') !== String(expected.seriesInstanceUID) ||
            String(annotation.SOPInstanceUID || '') !== String(expected.sopInstanceUID) ||
            !image || !expectedImage ||
            normalizeImageIdForCompare(image) !== normalizeImageIdForCompare(expectedImage) ||
            savedFrame !== Number(expected.frameNumber) ||
            (annotation.frameNumber && Number(annotation.frameNumber) !== savedFrame)) {
          return { ok: false, restoredCount: 0, reason: 'learner-source-frame-mismatch', slot };
        }
        if (!Array.isArray(annotation.points) ||
            annotation.points.length < (kind === 'ivcCollapsibility' || kind === 'ivcRapRvsp' ? 2 : 3)) {
          return { ok: false, restoredCount: 0,
            reason: 'learner-saved-contour-geometry-unavailable', slot };
        }
        sourceIds.add(sourceId);
        sourceFrames.add(sourceFrame);
        sources.push({ slot, annotation });
      }
      clearViewerQuizMeasurementComparisonAnnotations();
      let restoredCount = 0;
      const errors = [];
      // Cornerstone needs the referenced frame to be available when a saved
      // annotation is hydrated. Navigate to each in sequence, then return to
      // the question target so learners are not stranded on the last phase.
      for (const { slot, annotation: saved } of sources) {
        const restored = await actions.jumpToSavedViewerAnnotation({
          annotation: saved, selectAnnotation: false,
          runDelayedDisplayRefresh: false,
        });
        if (restored?.ok !== true) {
          errors.push({ slot, reason: restored?.reason || 'hydration-failed' });
          continue;
        }
        const sourceId = getMeasurementAnnotationId(saved);
        const hydrated = sourceId ? annotation.state.getAnnotation?.(sourceId) : null;
        if (!hydrated ||
            normalizeImageIdForCompare(hydrated.metadata?.referencedImageId || '') !==
              normalizeImageIdForCompare(saved.referencedImageId || '')) {
          errors.push({ slot, reason: 'learner-contour-viewport-hydration-mismatch' });
          continue;
        }
        hydrated.isVisible = true;
        restoredCount++;
      }
      if (viewerTarget) {
        try {
          await actions.jumpToViewerQuizTarget({ viewerTarget, questionKey });
        } catch (error) {
          console.warn('[ViewerQuiz] could not return to learner question frame', error);
        }
      }
      return {
        ok: errors.length === 0 && restoredCount === slots.length,
        learnerRendered: restoredCount > 0, restoredCount,
        expectedCount: slots.length,
        reason: errors[0]?.reason || '',
        failedSlots: errors.map(item => item.slot),
      };
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

      const navigationOutcome = await actions.jumpToSavedViewerAnnotation({
        annotation: learnerAnnotation,
      });
      if (navigationOutcome?.ok !== true) {
        // A cached annotation in Cornerstone state is not evidence that its
        // saved SOP/frame is visible. Report the real navigation failure.
        return {
          ok: false,
          reason: navigationOutcome?.reason || 'learner-measurement-navigation-failed',
          learnerRendered: false,
        };
      }

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
    // Educator multi-BWT authoring: the quiz definition is the ONLY gold
    // source. Do not fetch or write a Series document in this display path.
    // Quiz-authored multiple BWT gold is a self-contained, read-only display
    // source. Display the full set together; selection only changes emphasis.
    // Never fetch Series annotations or persist these temporary overlays.
    showViewerQuizAuthoringGoldCaliper: async ({
      goldMeasurements = [],
      goldMeasurement = null,
      highlightedSourceAnnotationId = '',
      referenceRadiusMm = null,
      questionKey = '',
    } = {}) => {
      const quizAuthoringFlag = String(getViewerUrlSearchParams().get('arQuizAuthoring') || '').toLowerCase();
      if (!['1', 'true', 'yes', 'y'].includes(quizAuthoringFlag)) {
        return { ok: false, rubricRendered: false, reason: 'gold-authoring-only' };
      }
      clearViewerQuizMeasurementComparisonAnnotations();
      clearAllViewerQuizMarkerOverlays();

      const saved = Array.isArray(goldMeasurements) && goldMeasurements.length
        ? goldMeasurements
        : goldMeasurement ? [goldMeasurement] : [];
      if (!saved.length) {
        return { ok: false, rubricRendered: false, reason: 'no-quiz-gold-calipers' };
      }
      const sources = saved.map(buildViewerQuizGoldBwtDisplaySource);
      if (sources.some(item => !item)) {
        console.warn('[ViewerQuiz] quiz gold set has incomplete saved geometry', {
          questionKey,
          count: saved.length,
          missingGeometryIndices: sources.flatMap((item, i) => item ? [] : [i + 1]),
        });
        return { ok: false, rubricRendered: false, reason: 'quiz-gold-geometry-incomplete' };
      }
      // A multi-BWT question must use one identified SOP/frame. Fail closed
      // instead of placing an overlay on a different image.
      const frameKey = (source: any) => [
        source.StudyInstanceUID,
        source.SeriesInstanceUID,
        source.SOPInstanceUID,
        source.frameNumber,
      ].join('|');
      if (new Set(sources.map(frameKey)).size !== 1) {
        return { ok: false, rubricRendered: false, reason: 'quiz-gold-frame-mismatch' };
      }
      const selectedSource = String(highlightedSourceAnnotationId || '').trim();
      if (selectedSource && !sources.some(source => source.annotationId === selectedSource)) {
        return { ok: false, rubricRendered: false, reason: 'quiz-gold-caliper-not-in-set' };
      }

      const navigated = await actions.jumpToViewerQuizTarget({
        viewerTarget: saved[0].viewerTarget,
        questionKey,
      });
      if (!navigated?.ok) {
        return {
          ok: false, rubricRendered: false,
          reason: navigated?.reason || 'gold-frame-navigation-failed',
        };
      }
      const viewportId = navigated.viewportId || viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport?.element) {
        return { ok: false, rubricRendered: false, reason: 'gold-viewport-unavailable' };
      }
      const imageMatch = await waitForSavedAnnotationImageMatch(viewport, sources[0]);
      if (imageMatch.index < 0) {
        return { ok: false, rubricRendered: false, reason: 'gold-image-not-in-viewport' };
      }

      const frameOfReferenceId =
        viewport.getFrameOfReferenceUID?.() ||
        viewport.getImageData?.()?.metadata?.FrameOfReferenceUID || '';
      const manager = annotation.state.getAnnotationManager?.();
      const groupKey = manager?.getGroupKey?.(viewport.element);
      const displayed: string[] = [];
      const fail = (reason: string) => {
        // Never leave a partially displayed reference set on the image.
        for (const overlayId of displayed) {
          annotation.state.removeAnnotation?.(overlayId);
          viewerQuizMeasurementComparisonAnnotationIds.delete(overlayId);
        }
        return { ok: false, rubricRendered: false, reason, renderedCount: 0 };
      };

      for (let i = 0; i < sources.length; i++) {
        const overlay = buildViewerQuizMeasurementComparisonAnnotation({
          sourceAnnotation: sources[i],
          variant: 'rubric',
          questionKey: `${questionKey}-gold-${i + 1}`,
        });
        const hydrated = hydrateViewerQuizMeasurementComparisonAnnotation({
          comparisonAnnotation: overlay,
          viewport,
          viewportId,
          referencedImageIdOverride: imageMatch.imageId,
          fallbackFrameOfReferenceUID: frameOfReferenceId,
        });
        const overlayId = String(hydrated?.annotationUID || hydrated?.uid || '').trim();
        const indexed = overlayId
          ? annotation.state.getAnnotation?.(overlayId) || hydrated : null;
        if (!overlayId || !indexed) {
          console.warn('[ViewerQuiz] quiz gold set Length hydration failed', {
            questionKey, caliperIndex: i + 1,
          });
          return fail('gold-length-hydration-failed');
        }
        // Track before checking registration so cleanup also removes failures.
        displayed.push(overlayId);
        viewerQuizMeasurementComparisonAnnotationIds.add(overlayId);
        const visibleInViewport = () =>
          (annotation.state.getAnnotations?.('Length', viewport.element) || []).some(
            item => item.annotationUID === overlayId
          );
        if (!visibleInViewport() && manager?.addAnnotation && groupKey != null) {
          annotation.state.removeAnnotation?.(overlayId);
          indexed.metadata = {
            ...(indexed.metadata || {}),
            FrameOfReferenceUID: groupKey,
          };
          manager.addAnnotation(indexed, groupKey);
        }
        if (!visibleInViewport()) {
          console.warn('[ViewerQuiz] quiz gold set caliper not indexed', {
            questionKey, caliperIndex: i + 1,
          });
          return fail('gold-length-not-indexed');
        }
        indexed.isLocked = true;
        indexed.isVisible = true;
        indexed.metadata = {
          ...(indexed.metadata || {}),
          arMeasurementWorkflow: 'viewerQuizGoldDisplay',
          arMeasurementReadOnly: true,
        };
        indexed.data = {
          ...(indexed.data || {}),
          // Helpful when both reference calipers are visible together.
          label: `Gold BWT #${i + 1}`,
          arMeasurementWorkflow: 'viewerQuizGoldDisplay',
          arMeasurementReadOnly: true,
        };
        const focused = !!selectedSource && sources[i].annotationId === selectedSource;
        annotation.config.style.setAnnotationStyles(
          overlayId,
          focused
            ? VIEWER_QUIZ_MEASUREMENT_COMPARISON_STYLES.rubricFocused
            : VIEWER_QUIZ_MEASUREMENT_COMPARISON_STYLES.rubric
        );
        cornerstoneTools.annotation.selection.setAnnotationSelected?.(overlayId, focused);
      }
      const radius = Number(referenceRadiusMm);
      let referenceRadiusCount = 0;
      if (referenceRadiusMm !== null && referenceRadiusMm !== '' &&
          Number.isFinite(radius) && radius > 0) {
        for (let i = 0; i < saved.length; i++) {
          // Show the focused reference radius on Highlight. "Show all"
          // displays the guide around every captured gold caliper.
          const isFocused = !!selectedSource && sources[i].annotationId === selectedSource;
          if (selectedSource && !isFocused) continue;
          const rendered = appendViewerQuizBowelGoldRadiusOutline({
            viewport,
            quizSpatialEvidence: saved[i].quizSpatialEvidence,
            radiusMm: radius,
            focused: isFocused,
          });
          if (rendered) referenceRadiusCount++;
          else console.warn('[ViewerQuiz] calibrated BWT reference radius unavailable', {
            questionKey, caliperIndex: i + 1, radiusMm: radius,
          });
        }
      }
      try {
        const { triggerAnnotationRenderForViewportIds } = await import(
          '@cornerstonejs/tools/utilities'
        );
        triggerAnnotationRenderForViewportIds([viewportId]);
      } catch (error) {
        console.warn('[ViewerQuiz] quiz gold set annotation render trigger failed', error);
      }
      viewport.render?.();
      return {
        ok: true, rubricRendered: true, renderedCount: displayed.length,
        referenceRadiusCount,
      };
    },
    showViewerQuizMeasurementComparison: async ({
      learnerMeasurement = {},
      rubricMeasurement = {},
      viewerTarget = null,
      focusedCompositeSlot = '',
      questionKey = '',
      radius = null,
      radiusUnit = 'world',
      endpointToleranceMM = null,
      ivcEndpointToleranceEnabled = false,
    } = {}) => {
      clearViewerQuizMeasurementComparisonAnnotations();
      clearAllViewerQuizMarkerOverlays();

      const { learnerSeriesDoc, baseSeriesDoc } = await getViewerQuizMeasurementSeriesDocs();

      // Opt-in BWT comparisons use two separate authorities: learner-copy
      // Series for learner evidence and versioned quiz JSON for educator gold.
      const isBowelGoldReference =
        String(rubricMeasurement?.measurementKind || '') === 'length' &&
        /BWT/i.test(String(rubricMeasurement?.measurementType || '')) &&
        !!rubricMeasurement?.quizSpatialEvidence;
      const learnerAnnotation = isBowelGoldReference
        ? findViewerQuizBowelLearnerAnnotation(learnerMeasurement, learnerSeriesDoc)
        : findViewerQuizMeasurementAnnotationInSeriesDocs(learnerMeasurement, [
            learnerSeriesDoc, baseSeriesDoc,
          ]) || getViewerQuizMeasurementAnnotationFromService(learnerMeasurement);
      const embeddedGoldAnnotation = buildViewerQuizGoldBwtDisplaySource(rubricMeasurement);
      const persistedRubricAnnotation = isBowelGoldReference ? null :
        findViewerQuizMeasurementAnnotationInSeriesDocs(rubricMeasurement, [
          baseSeriesDoc,
          learnerSeriesDoc,
        ]) || getViewerQuizMeasurementAnnotationFromService(rubricMeasurement);
      const rubricAnnotation = isBowelGoldReference
        ? embeddedGoldAnnotation : persistedRubricAnnotation;
      const goldSourceId = getViewerQuizMeasurementSourceAnnotationId(rubricMeasurement);

      // Composite answers retain several source contour IDs rather than a
      // single drawable annotation. Resolve each exact persisted contour and
      // keep the original image/frame association; never substitute a nearby
      // unrelated measurement for a missing slot.
      const rubricComponents = Array.isArray(rubricMeasurement?.compositeResult?.components)
        ? rubricMeasurement.compositeResult.components
        : [];
      const expectedSlots =
        rubricMeasurement?.measurementKind === 'lvSimpsonEF'
          ? ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES']
          : ['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(rubricMeasurement?.measurementKind)
            ? ['A4C', 'A2C']
            : rubricMeasurement?.measurementKind === 'rvFAC'
              ? ['RV_ED', 'RV_ES']
              : rubricMeasurement?.measurementKind === 'raArea'
                ? ['RA_ES']
                : rubricMeasurement?.measurementKind === 'ivcCollapsibility'
                  ? ['IVC_EXP', 'IVC_INSP']
                  : [];
      const compositeRubric = expectedSlots.length > 0;
      const embeddedContourFromComponent = (component: any, slot: string) => {
        const points = component?.points;
        const target = component?.target || {};
        const imageId = String(target.referencedImageId || '').trim();
        const expectedStudy = String(
          rubricMeasurement?.viewerTarget?.studyInstanceUID ||
          rubricMeasurement?.sourceRefs?.studyInstanceUID || ''
        ).trim();
        const study = String(target.studyInstanceUID || '').trim();
        if (
          !Array.isArray(points) ||
          points.length < (rubricMeasurement?.measurementKind === 'ivcCollapsibility' ? 2 : 3) ||
          points.length > 5000 || !imageId ||
          (expectedStudy && (!study || study !== expectedStudy))
        ) {
          return null;
        }
        const safePoints = points.map(point =>
          Array.isArray(point) && point.length >= 2 && point.length <= 3
            ? [Number(point[0]), Number(point[1]), Number(point[2] ?? 0)]
            : null
        );
        if (safePoints.some(point => !point || point.some(value => !Number.isFinite(value)))) {
          return null;
        }
        const derived = rubricMeasurement?.compositeResult?.derived || {};
        const ivcValue = slot === 'IVC_EXP' ? derived.expirationDiameterMM
          : slot === 'IVC_INSP' ? derived.inspirationDiameterMM : null;
        const areaValue = slot === 'RV_ED' ? derived.edaCM2
          : slot === 'RV_ES' ? derived.esaCM2
          : slot === 'A4C' ? derived.a4cAreaCM2
          : slot === 'A2C' ? derived.a2cAreaCM2
          : slot === 'RA_ES' ? derived.areaCM2 : null;
        const physical = Number(
          rubricMeasurement?.measurementKind === 'ivcCollapsibility' ? ivcValue : areaValue
        );
        const hasPhysical = (rubricMeasurement?.measurementKind === 'ivcCollapsibility'
          ? ivcValue : areaValue) != null && Number.isFinite(physical) && physical > 0;
        const unit = rubricMeasurement?.measurementKind === 'ivcCollapsibility'
          ? 'mm' : 'cm²';
        return {
          annotationId: String(component.annotationId || '').trim(),
          uid: String(component.annotationId || '').trim(),
          workflow: VIEWER_MEASUREMENTS_WORKFLOW,
          toolName: rubricMeasurement?.measurementKind === 'ivcCollapsibility'
            ? 'Length' : 'PlanarFreehandROI',
          label: slot,
          measurementRole: slot,
          measurementKind: rubricMeasurement.measurementKind,
          // Temporary gold overlays need the same explicit contour slot as
          // original acquisition. Otherwise Cornerstone treats them as generic
          // ROI annotations and displays a separate native mm² measurement.
          ...getQuizCompositeGoldContourSlotMetadata(
            rubricMeasurement.measurementKind, slot
          ),
          ...(hasPhysical ? {
            displayText: [slot + ': ' + physical.toFixed(2) + ' ' + unit],
            measurements: rubricMeasurement?.measurementKind === 'ivcCollapsibility'
              ? { length: physical, lengthUnit: 'mm' }
              : { area: physical, areaUnit: 'cm2' },
          } : {}),
          StudyInstanceUID: study,
          SeriesInstanceUID: String(target.seriesInstanceUID || ''),
          SOPInstanceUID: String(target.sopInstanceUID || ''),
          referencedImageId: imageId,
          frameNumber: Number(target.frameNumber || 0),
          points: safePoints,
          contourClosed: rubricMeasurement?.measurementKind !== 'ivcCollapsibility',
        };
      };
      const resolvedRubricContours = compositeRubric
        ? expectedSlots.map(slot => {
            const component = rubricComponents.find(item => item?.slot === slot);
            const sourceId = String(component?.annotationId || '').trim();
            if (!sourceId) return null;
            const reference = { sourceAnnotationId: sourceId };
            const persisted = [baseSeriesDoc, learnerSeriesDoc].flatMap(seriesDoc =>
              getRequestedWorkflowAnnotations(seriesDoc?.MeasurementAnnotations)
            ).find(item => getMeasurementAnnotationId(item) === sourceId);
            const sourceAnnotation =
              embeddedContourFromComponent(component, slot) ||
              persisted ||
              getViewerQuizMeasurementAnnotationFromService(reference);
            return sourceAnnotation ? { sourceAnnotation, slot } : null;
          }).filter(Boolean)
        : [];

      if (compositeRubric) {
        console.info('[ViewerQuiz] composite gold contour resolution', {
          questionKey,
          expected: expectedSlots.length,
          resolved: resolvedRubricContours.length,
          sources: resolvedRubricContours.map(entry => ({
            slot: entry.slot,
            pointCount: entry.sourceAnnotation?.points?.length || 0,
            hasImageReference: !!entry.sourceAnnotation?.referencedImageId,
          })),
        });
      }

      if (!learnerAnnotation && !rubricAnnotation && resolvedRubricContours.length === 0) {
        console.warn('[ViewerQuiz] no source annotation available for highlight', {
          questionKey,
          hasSourceId: !!goldSourceId,
          hasCalibratedGeometry: !!embeddedGoldAnnotation,
          isBowelGoldReference,
          hasSeriesAnnotations: !!(learnerSeriesDoc?.MeasurementAnnotations || baseSeriesDoc?.MeasurementAnnotations),
        });
        return {
          ok: false,
          reason: compositeRubric ? 'composite-source-contours-not-found' : 'measurement-annotations-not-found',
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

      // Gold measurement comparison is a separate hydration path from
      // jumpToSavedViewerAnnotation. Install the scoped area renderer here too:
      // restoring the annotation alone does not install getTextLines.
      if (['rvFAC', 'raArea', 'laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(
        String(rubricMeasurement?.measurementKind || '')
      )) {
        installQuizCompositeContourTextOverrideForViewport({
          viewport, viewportId: comparisonViewportId,
          measurementService, viewportGridService, displaySetService, toolGroupService,
        });
      }

      if (rubricMeasurement?.measurementKind === 'lvSimpsonEF') {
        for (const toolName of [toolNames.SplineROI || 'SplineROI',
          toolNames.PlanarFreehandROI || 'PlanarFreehandROI']) {
          installLVSimpsonContourTextCleanupForViewport({
            viewport, viewportId: comparisonViewportId, toolName,
          });
        }
      }

      // Authoring gold calipers already loaded in Cornerstone should be selected
      // directly. Reconstructing a temporary comparison overlay can fail when
      // the saved source annotation has not yet been rehydrated into this viewport.
      if (!compositeRubric && goldSourceId &&
          !getViewerQuizMeasurementSourceAnnotationId(learnerMeasurement) &&
          !(endpointToleranceMM !== null && endpointToleranceMM !== '' &&
            Number.isFinite(Number(endpointToleranceMM)) && Number(endpointToleranceMM) > 0)) {
        const liveGold = annotation.state.getAnnotation?.(goldSourceId);
        const goldTarget = getViewerQuizMeasurementReferenceTarget(rubricMeasurement, rubricAnnotation);
        const expectedImage = normalizeImageIdForCompare(
          goldTarget?.referencedImageId || ''
        );
        const liveImage = normalizeImageIdForCompare(
          liveGold?.metadata?.referencedImageId || ''
        );
        if (liveGold && (!expectedImage || (liveImage && expectedImage === liveImage))) {
          liveGold.isVisible = true;
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(goldSourceId, true);
          try {
            const { triggerAnnotationRenderForViewportIds } = await import(
              '@cornerstonejs/tools/utilities'
            );
            triggerAnnotationRenderForViewportIds([comparisonViewportId]);
          } catch {}
          viewport.render?.();
          return {
            ok: true, reason: '', renderedCount: 1,
            learnerRendered: false, rubricRendered: true,
            compositeContoursExpected: 0, compositeContoursResolved: 0,
            toleranceCircleRendered: false,
          };
        }
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
          slot: '',
        },
        ...(compositeRubric
          ? resolvedRubricContours.map(entry => ({
              sourceAnnotation: entry.sourceAnnotation,
              variant: 'rubric' as const,
              slot: entry.slot,
            }))
          : [{ sourceAnnotation: rubricAnnotation, variant: 'rubric' as const, slot: '' }]),
      ].filter(entry => !!entry.sourceAnnotation);

      for (const entry of entries) {
        const sourceId = String(entry.sourceAnnotation?.annotationId ||
          entry.sourceAnnotation?.uid || '').trim();
        const native = compositeRubric && entry.variant === 'rubric' && sourceId
          ? annotation.state.getAnnotation?.(sourceId) : null;
        const expectedImage = normalizeImageIdForCompare(
          entry.sourceAnnotation?.referencedImageId || '');
        const nativeImage = normalizeImageIdForCompare(
          native?.metadata?.referencedImageId || '');
        if (native && expectedImage && nativeImage === expectedImage) {
          if (entry.variant === 'rubric' &&
              rubricMeasurement?.measurementKind === 'lvSimpsonEF') {
            applyVerifiedEFGoldLabel(sourceId, entry.slot, rubricMeasurement);
          }
          native.isVisible = true;
          cornerstoneTools.annotation.selection.setAnnotationSelected?.(
            sourceId, !focusedCompositeSlot || entry.slot === focusedCompositeSlot
          );
          renderedCount++;
          rubricRendered = true;
          continue;
        }
        const comparisonAnnotation = buildViewerQuizMeasurementComparisonAnnotation({
          sourceAnnotation: entry.sourceAnnotation,
          variant: entry.variant,
          questionKey: entry.slot ? `${questionKey}-${entry.slot}` : questionKey,
        });
        // A composite can span different source frames. Rehydrate every
        // contour against its own image rather than navigating the viewport to
        // each subsequent frame (which would leave the wrong frame visible).
        const match = entry.slot
          ? { imageId: comparisonAnnotation.referencedImageId || '' }
          : await waitForSavedAnnotationImageMatch(viewport, comparisonAnnotation);
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
          console.warn('[ViewerQuiz] gold comparison overlay hydration failed', {
            questionKey,
            sourceIdPresent: !!getViewerQuizMeasurementSourceAnnotationId(rubricMeasurement),
            usedEmbeddedGeometry: entry.variant === 'rubric' && !!embeddedGoldAnnotation && !persistedRubricAnnotation,
            hasReferencedImageId: !!comparisonAnnotation.referencedImageId,
            hasPoints: Array.isArray(comparisonAnnotation.points) && comparisonAnnotation.points.length === 2,
            hasMatchedImage: !!match.imageId,
          });
          continue;
        }

        // A successful hydration call does not prove that Cornerstone indexed
        // the contour in the active stack viewport's annotation group.
        // Quiz overlays are temporary, so re-register only these composite
        // gold contours under the viewport element when necessary.
        if ((entry.slot || (entry.variant === 'rubric' && !!embeddedGoldAnnotation && !persistedRubricAnnotation)) && viewport.element) {
          const toolName = String(hydratedAnnotation.metadata?.toolName || '');
          const visibleInViewport = () =>
            (annotation.state.getAnnotations?.(toolName, viewport.element) || []).some(
              candidate => candidate.annotationUID === comparisonAnnotationId
            );
          if (!visibleInViewport()) {
            // Ultrasound stack viewports can have an undefined/empty annotation
            // group key. The manager's exact key (not the viewport element or
            // an inferred FrameOfReferenceUID) must be used for reindexing.
            const annotationManager = annotation.state.getAnnotationManager?.();
            if (annotationManager?.getGroupKey && annotationManager?.addAnnotation) {
              const activeGroupKey = annotationManager.getGroupKey(viewport.element);
              annotation.state.removeAnnotation?.(comparisonAnnotationId);
              hydratedAnnotation.metadata = {
                ...(hydratedAnnotation.metadata || {}),
                FrameOfReferenceUID: activeGroupKey,
              };
              annotationManager.addAnnotation(hydratedAnnotation, activeGroupKey);
            }
          }
          if (!visibleInViewport()) {
            console.warn('[ViewerQuiz] saved composite contour not indexed for viewport', {
              questionKey,
              slot: entry.slot,
              toolName,
              hasReferencedImageId: !!hydratedAnnotation.metadata?.referencedImageId,
            });
            continue;
          }
        }

        if (entry.variant === 'rubric' && entry.slot &&
            rubricMeasurement?.measurementKind === 'lvSimpsonEF') {
          applyVerifiedEFGoldLabel(comparisonAnnotationId, entry.slot, rubricMeasurement, hydratedAnnotation);
        }
        hydratedAnnotation.isLocked = true;
        hydratedAnnotation.isVisible = true;
        const focused = entry.variant === 'rubric' && !!focusedCompositeSlot &&
          entry.slot === focusedCompositeSlot;
        annotation.config.style.setAnnotationStyles(
          comparisonAnnotationId,
          focused ? VIEWER_QUIZ_MEASUREMENT_COMPARISON_STYLES.rubricFocused
            : VIEWER_QUIZ_MEASUREMENT_COMPARISON_STYLES[entry.variant]
        );
        cornerstoneTools.annotation.selection.setAnnotationSelected?.(
          comparisonAnnotationId, focused
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
      const endpointRadius = endpointToleranceMM === null || endpointToleranceMM === ''
        ? null : Number(endpointToleranceMM);
      const isIVC = rubricMeasurement?.measurementKind === 'ivcCollapsibility';
      const useEndpointTolerance =
        isIVC ? ivcEndpointToleranceEnabled === true
          : rubricMeasurement?.measurementKind === 'length' &&
            endpointRadius !== null;
      let toleranceCircleRendered = false;
      let endpointCirclesRendered = 0;

      if (useEndpointTolerance && endpointRadius !== null &&
          Number.isFinite(endpointRadius) && endpointRadius > 0) {
        const activeImage = normalizeImageIdForCompare(
          viewport.getCurrentImageId?.() || ''
        );
        const goldParts = isIVC
          ? (Array.isArray(rubricMeasurement?.compositeResult?.components)
              ? rubricMeasurement.compositeResult.components : [])
          : [rubricAnnotation || rubricMeasurement];
        for (const part of goldParts) {
          if (isIVC && focusedCompositeSlot && part?.slot !== focusedCompositeSlot) continue;
          const sourceTarget = part?.target ||
            getViewerQuizMeasurementReferenceTarget(rubricMeasurement, rubricAnnotation) || {};
          const expectedImage = normalizeImageIdForCompare(
            sourceTarget.referencedImageId || part?.referencedImageId || ''
          );
          const expectedInstanceFrame = sourceTarget.sopInstanceUID &&
            Number.isInteger(Number(sourceTarget.frameNumber)) &&
            Number(sourceTarget.frameNumber) > 0
            ? `/instances/${String(sourceTarget.sopInstanceUID).toLowerCase()}/frames/${Number(sourceTarget.frameNumber)}`
            : '';
          const frameMatches = activeImage && (
            (expectedImage && (activeImage === expectedImage ||
              activeImage.endsWith(expectedImage))) ||
            (expectedInstanceFrame && activeImage.includes(expectedInstanceFrame))
          );
          // Composite phase geometry must only appear on its exact gold image/frame.
          if (isIVC && !frameMatches) continue;
          const points = getViewerQuizMeasurementPoints(part);
          if (points.length !== 2) continue;
          for (const coordinates of points) {
            const point = {
              x: Number(coordinates[0]),
              y: Number(coordinates[1]),
              z: Number(coordinates[2] || 0),
              coordinateSpace: 'world',
            };
            if (appendViewerQuizToleranceCircle({
              viewport, point, radius: endpointRadius, radiusUnit: 'mm',
            })) endpointCirclesRendered += 1;
          }
        }
        toleranceCircleRendered = endpointCirclesRendered > 0;
      } else if (!useEndpointTolerance && rubricCenter &&
          Number.isFinite(numericRadius) && numericRadius > 0) {
        // Retain the older centre-radius display for saved legacy questions.
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
        compositeContoursExpected: compositeRubric ? expectedSlots.length : 0,
        compositeContoursResolved: resolvedRubricContours.length,
        toleranceCircleRendered,
        endpointCirclesRendered,
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
    captureBowelQuizLumenCenter: async () => {
      actions.releaseViewerQuizDrawingTool();
      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!viewport) return { ok: false, reason: 'viewport-not-found' };
      const displaySet = getActiveViewportDisplaySet({
        viewportGridService, displaySetService, viewportId: activeViewportId,
      });
      const captured = await captureNextViewerClickPoint({
        viewport, displaySet, viewportId: activeViewportId,
      });
      if (!captured?.ok || captured?.answer?.point?.coordinateSpace !== 'world') {
        return captured?.ok
          ? { ok: false, reason: 'no-calibrated-world-position' }
          : captured;
      }
      const target = captured.answer.viewerTarget || {};
      const imageId = getCurrentViewportImageInfo(viewport).imageId;
      if (!imageId || imageId !== target.referencedImageId) {
        return { ok: false, reason: 'frame-changed-during-capture' };
      }
      const point = captured.answer.point;
      const pseudoMeasurement = {
        referencedImageId: imageId,
        SOPInstanceUID: target.sopInstanceUID,
        referenceSeriesUID: target.seriesInstanceUID,
        displaySetInstanceUID: target.displaySetInstanceUID,
      };
      const evidence = getBowelQuizCalibratedPointContext({
        viewport, displaySetService, measurement: pseudoMeasurement,
        points: [[point.x, point.y, point.z]],
      });
      if (!evidence || evidence.physicalPoints.length !== 1) {
        return { ok: false, reason: 'lumen-centre-physical-calibration-unavailable' };
      }
      return {
        ok: true,
        answer: {
          ...captured.answer,
          physicalPoint: evidence.physicalPoints[0],
          spatialCalibration: {
            pixelSpacing: evidence.pixelSpacing,
            calibrationSource: evidence.calibrationSource,
          },
        },
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
    /**
     * Restore missing physical RV/LA phase areas from the immutable gold
     * contours and the original DICOM US-region calibration. This is an
     * explicit authoring action, not a learner or scoring calculation.
     * Never derive areas from uncalibrated world/pixel geometry.
     */
    recoverViewerQuizGoldAreas: async ({
      rubricMeasurement = {}, questionKey = '',
    } = {}) => {
      const kind = String(rubricMeasurement?.measurementKind || '').trim();
      if (kind === 'lvSimpsonEF') {
        // EF is already calculated and educator-approved. Recover display
        // areas only from the matching persisted calibrated annotations.
        const { baseSeriesDoc, learnerSeriesDoc } =
          await getViewerQuizMeasurementSeriesDocs();
        // Educator authoring can open the original series directly, with no
        // derivedFrom/baseSeriesId. Searching only baseSeriesDoc then always
        // returns zero gold annotations. The resolver independently requires
        // exact annotation ID, study/series/SOP/image, and contour agreement.
        let recovery: ReturnType<typeof resolveSavedEFGoldContourAreas> = {
          ok: false, reason: 'No saved EF source series available',
        };
        for (const seriesDoc of [baseSeriesDoc, learnerSeriesDoc].filter(Boolean)) {
          // A derived series may carry a second copy of the original
          // annotation. Never concatenate the two and treat that as two
          // independent gold sources; independently validate each full set.
          recovery = resolveSavedEFGoldContourAreas({
            gold: rubricMeasurement,
            savedAnnotations: getRequestedWorkflowAnnotations(
              seriesDoc.MeasurementAnnotations
            ),
          });
          if (recovery.ok) return recovery;
          // An existing but altered source is not evidence of a missing
          // container. Never bypass a known image/contour disagreement.
          if (/source frames invalid|source identity conflict|image\/frame mismatch|contour changed|physical area mismatch/i
            .test(String(recovery.reason || ''))) return recovery;
        }
        // An educator can have exact calibrated saved source annotations
        // hydrated into MeasurementService even when the Series lookup fails.
        // Run the same immutable-ID/frame/contour verification before falling
        // back to raw DICOM evidence. This also restores retained LV axes.
        const liveRecovery = resolveSavedEFGoldContourAreas({
          gold: rubricMeasurement,
          savedAnnotations: getCurrentViewerMeasurementSnapshot(measurementService),
        });
        if (liveRecovery.ok) return liveRecovery;
        if (/source frames invalid|source identity conflict|image\/frame mismatch|contour changed|physical area mismatch|axis disagrees/i
          .test(String(liveRecovery.reason || ''))) return liveRecovery;
        // A truly missing source can instead be checked against the original
        // exact-frame DICOM US-region calibration below. That contour evidence
        // has no trusted apex index, so do not invent a legacy LV long axis.
        console.info('[ViewerQuiz] EF saved-source area recovery unavailable; attempting verified DICOM calibration', {
          reason: liveRecovery.reason || recovery.reason,
        });
      }
      const previousFrame = await actions.getCurrentViewerQuizFrameAnswer();
      const previousTarget = previousFrame?.ok ? previousFrame.answer?.selectedTarget : null;
      const previousViewportId = viewportGridService.getActiveViewportId();
      let navigatedForCalibration = false;
      try {
        const recover = kind === 'lvSimpsonEF'
          ? resolveVerifiedEFGoldContourAreasFromDicom
          : resolveViewerQuizGoldAreaBackfill;
        return await recover({
          kind,
          gold: rubricMeasurement,
          calibrate: async component => {
            const target = component?.target || {};
            // The saved image's metadata may already be available on
            // question open. Prefer a read-only calculation without changing
            // the active viewport; navigate only if metadata must be loaded.
            const displaySet = getDisplaySetForSavedAnnotation(displaySetService, {
              SOPInstanceUID: target.sopInstanceUID,
              SeriesInstanceUID: target.seriesInstanceUID,
            });
            if (!displaySet) return null;
            const sourceStudy = String(displaySet.StudyInstanceUID || '').trim();
            const sourceSeries = String(displaySet.SeriesInstanceUID || '').trim();
            if ((sourceStudy && sourceStudy !== String(target.studyInstanceUID || '')) ||
                (sourceSeries && sourceSeries !== String(target.seriesInstanceUID || ''))) {
              return null;
            }
            const savedImageId = String(target.referencedImageId || '');
            const fromCachedMetadata = getVerifiedEchoAreaCalibration({
              displaySet,
              imageId: savedImageId,
              sopInstanceId: String(target.sopInstanceUID || ''),
              points: component.points || [],
            });
            if (fromCachedMetadata?.areaCM2 != null) {
              return fromCachedMetadata.areaCM2;
            }
            const navigation = await actions.jumpToViewerQuizTarget({
              viewerTarget: target, questionKey,
            });
            if (!navigation?.ok) return null;
            navigatedForCalibration = true;
            const sourceViewport = cornerstoneViewportService.getCornerstoneViewport(
              navigation.viewportId || viewportGridService.getActiveViewportId()
            );
            const actualImageId = sourceViewport
              ? String(getCurrentViewportImageInfo(sourceViewport)?.imageId || '')
              : '';
            // Never apply DICOM metadata from a different cine frame, even
            // if a viewer navigation reported success before the image changed.
            if (!actualImageId ||
                getSopInstanceIdFromImageId(actualImageId) !== String(target.sopInstanceUID || '') ||
                getFrameNumberFromReferencedImageId(actualImageId) !== Number(target.frameNumber)) {
              return null;
            }
            const calibrated = getVerifiedEchoAreaCalibration({
              displaySet,
              imageId: actualImageId,
              sopInstanceId: String(target.sopInstanceUID || ''),
              points: component.points || [],
            });
            return calibrated?.areaCM2 ?? null;
          },
        });
      } catch (error) {
        console.warn('[ViewerQuiz] gold area recovery failed', error);
        return { ok: false, reason: 'gold-area-recovery-error' };
      } finally {
        // Recovery is read-only until the educator explicitly saves the
        // updated draft. Restore their original viewing context.
        if (navigatedForCalibration && previousTarget?.sopInstanceUID) {
          try {
            const restored = await actions.jumpToViewerQuizTarget({
              viewerTarget: previousTarget, questionKey,
            });
            if (restored?.ok && previousViewportId) {
              await Promise.resolve(actions.setViewportActive({ viewportId: previousViewportId }));
            }
          } catch (error) {
            console.warn('[ViewerQuiz] could not restore pre-recovery frame', error);
          }
        }
      }
    },
    getViewerQuizCompositeStatusForActiveStudy: ({ measurementKind = '' } = {}) => {
      const kind = String(measurementKind || '').trim();
      const activeViewportId = viewportGridService.getActiveViewportId();
      const displaySet = getActiveViewportDisplaySet({
        viewportGridService, displaySetService, viewportId: activeViewportId,
      });
      const study = String(
        displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || ''
      ).trim();
      if (!study) {
        return {
          complete: false, value: null, unit: '',
          message: 'Select an image from the quiz study before reviewing the calculated measurement.',
        };
      }
      const snapshot = getCurrentViewerMeasurementSnapshot(measurementService);
      return getViewerQuizCompositeStatus(
        kind as any,
        snapshot.filter(entry =>
          String(entry?.referenceStudyUID || entry?.StudyInstanceUID || '').trim() === study
        )
      );
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

      const requestedKind = String(question?.answerConfig?.measurementKind || '').trim();
      const isCompositeKind = ['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility'].includes(requestedKind);
      // Composite contours can live in AR's session fallback before OHIF
      // MeasurementService receives the completed/calibrated annotation.
      const quizMeasurements = isCompositeKind
        ? getCurrentViewerMeasurementSnapshot(measurementService)
        : null;
      const directMeasurement = isCompositeKind
        ? null
        : findMeasurementServiceMeasurementById(measurementService, selectedMeasurementId);
      // Spectral ROI data can survive on its Cornerstone source annotation
      // after MeasurementService remaps the same ROI. Prefer the calibrated
      // source snapshot over a generic area/length representation.
      const restoredSpectralMeasurement = ['trVmax', 'trVTI'].includes(requestedKind)
        ? getCurrentViewerMeasurementSnapshot(measurementService).find(
            entry => getMeasurementAnnotationId(entry) === selectedMeasurementId
          )
        : null;
      const measurement = restoredSpectralMeasurement || directMeasurement;

      if (!isCompositeKind && !selectedMeasurementId) {
        return { ok: false, reason: 'no-selected-measurement' };
      }
      if (!isCompositeKind && !measurement) {
        return {
          ok: false,
          reason: 'selected-measurement-not-found',
          selectedMeasurementId,
        };
      }

      if (isCompositeKind) {
        // Resolve from the existing viewer measurement service, not from a
        // user-supplied numeric field. Include source references for review;
        // numeric practice scoring does not independently validate contours.
        const activeViewportId = viewportGridService.getActiveViewportId();
        const activeDisplaySet = getActiveViewportDisplaySet({
          viewportGridService,
          displaySetService,
          viewportId: activeViewportId,
        });
        const activeStudy = String(
          activeDisplaySet?.StudyInstanceUID || activeDisplaySet?.studyInstanceUID || ''
        ).trim();
        const selectedSource = quizMeasurements.find(
          entry => getMeasurementAnnotationId(entry) === selectedMeasurementId
        );
        const selectedStudy = activeStudy || String(
          selectedSource?.referenceStudyUID || selectedSource?.StudyInstanceUID || ''
        ).trim();
        if (!selectedStudy) {
          return { ok: false, reason: 'composite-study-not-resolved' };
        }
        const studyMeasurements = quizMeasurements.filter(entry => {
          const entryStudy = String(entry?.referenceStudyUID || entry?.StudyInstanceUID || '').trim();
          return selectedStudy && entryStudy === selectedStudy;
        });
        // RA area is a single-contour question. When the educator explicitly
        // selects an annotation, do not reject that contour merely because an
        // earlier RA contour remains saved elsewhere in the same study.
        // The composite resolver still validates the chosen contour's clinical
        // kind, RA_ES slot, calibrated area and exact SOP/frame provenance.
        const selectedRAContour = requestedKind === 'raArea' && selectedMeasurementId
          ? studyMeasurements.find(
              entry => getMeasurementAnnotationId(entry) === selectedMeasurementId
            )
          : null;
        const sourceMeasurements = selectedRAContour
          ? [selectedRAContour]
          : studyMeasurements;
        const reviewedEFIsActive =
          requestedKind === 'lvSimpsonEF' &&
          reviewedLVSimpsonEF?.studyInstanceId === selectedStudy &&
          typeof document !== 'undefined' &&
          Boolean(document.getElementById(LV_SIMPSON_PROGRESS_PANEL_ID));
        const authoritativeEF = requestedKind === 'lvSimpsonEF'
          ? getExplicitLVSimpsonResult(selectedStudy)
          : null;
        if (reviewedEFIsActive && !authoritativeEF) {
          // A real edit, deletion, or unavailable contour revision invalidates
          // the review. Never replace an already-reviewed EF behind the user's
          // back by recalculating during capture.
          reviewedLVSimpsonEF = null;
          renderLVSimpsonWorkflowPanel({
            measurements: studyMeasurements,
            resultText: 'EF review expired.',
            warnings: ['Contour geometry changed or is no longer verifiable.'],
            instruction: 'Review the four contours and repeat the EF workflow before capturing.',
            onCancel: hideLVSimpsonWorkflowPanel,
          });
          return { ok: false, reason: 'ef-review-invalidated' };
        }
        const composite = requestedKind === 'lvSimpsonEF'
          ? authoritativeEF?.composite
          : resolveViewerQuizCompositeResult(requestedKind, sourceMeasurements);
        if (!composite) {
          const diagnostic = getViewerQuizCompositeStatus(requestedKind as any, sourceMeasurements);
          return {
            ok: false,
            reason: diagnostic.message || 'Composite measurement is not yet complete or calibrated.',
            reasonCode: 'composite-measurement-incomplete',
            selectedMeasurementId,
          };
        }

        // The persistent EF workflow panel is a clinical review checkpoint.
        // If the active contours have changed since its final displayed value,
        // refresh the panel and require an explicit second capture, so the quiz
        // never silently records an EF the educator did not review.
        if (
          requestedKind === 'lvSimpsonEF' &&
          typeof document !== 'undefined' &&
          document.getElementById(LV_SIMPSON_PROGRESS_PANEL_ID) &&
          reviewedLVSimpsonEF?.studyInstanceId === selectedStudy &&
          !isViewerQuizCompositeReviewCurrent(reviewedLVSimpsonEF.value, composite.value)
        ) {
          const previousValue = roundQuizMeasurementValue(reviewedLVSimpsonEF.value, 2).toFixed(2);
          const currentValue = roundQuizMeasurementValue(composite.value, 2).toFixed(2);
          reviewedLVSimpsonEF = { studyInstanceId: selectedStudy, value: composite.value };
          renderLVSimpsonWorkflowPanel({
            measurements: studyMeasurements,
            resultText: `Calculated LVEF: ${currentValue}%`,
            warnings: [`EF changed since the earlier review (${previousValue}% → ${currentValue}%).`],
            instruction: 'Review this recalculated EF, then capture it again using the button below.',
            onCapture: () => requestLVSimpsonQuizCapture({ studyInstanceId: selectedStudy, value: composite.value, mode: 'manual' }),
            onCancel: hideLVSimpsonWorkflowPanel,
          });
          return {
            ok: false,
            reason: 'EF changed since the progress panel was reviewed. The updated EF is displayed; review it and capture again.',
          };
        }

        // Capture the calculated composite result, not any particular contour.
        // Selection is optional; every source remains anchored to the active study.
        const componentIds = new Set(composite.components.map(component => component.annotationId));
        const sourceAnnotationId = componentIds.has(selectedMeasurementId)
          ? selectedMeasurementId
          : composite.components[0].annotationId;
        const sourceMeasurement = quizMeasurements.find(
          entry => getMeasurementAnnotationId(entry) === sourceAnnotationId
        );
        if (!sourceMeasurement) {
          return {
            ok: false,
            reason: 'composite-source-measurement-not-found',
            selectedMeasurementId,
          };
        }
        const viewerTarget = buildViewerQuizTargetFromMeasurement(sourceMeasurement, displaySetService);
        return {
          ok: true,
          selectedMeasurementId,
          answer: {
            value: roundQuizMeasurementValue(composite.value, 2),
            unit: composite.unit,
            measurementKind: composite.measurementKind,
            measurementType: composite.measurementKind,
            sourceAnnotationId,
            viewerTarget,
            sourceRefs: {
              annotationId: sourceAnnotationId,
              measurementId: sourceAnnotationId,
              studyInstanceUID: selectedStudy,
            },
            compositeResult: composite,
            reviewPayload: {
              label: composite.measurementKind,
              toolName: 'viewer-composite-measurement',
              capturedAt: new Date().toISOString(),
              components: composite.components,
            },
          },
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

      if (question?.answerConfig?.measurementSet?.enabled === true) {
        const activeViewportId = viewportGridService.getActiveViewportId();
        const activeViewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
        const points = getViewerQuizMeasurementPoints(measurement);
        let failure = '';
        const evidence = getBowelQuizCalibratedPointContext({
          viewport: activeViewport, displaySetService, measurement, points,
          onFailure: reason => { failure = reason; },
        });
        if (!evidence || evidence.physicalPoints.length !== 2) {
          return {
            ok: false,
            reason: 'bwt-spatial-calibration-unavailable (' +
              (failure || 'exactly-two-caliper-endpoints-required') +
              '): select a calibrated BWT Length caliper from this DICOM frame',
          };
        }
        answer.quizSpatialEvidence = evidence;
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
    startUltrasoundDirectionalWorkflow: {
      commandFn: actions.startUltrasoundDirectionalWorkflow,
    },
    startSpectralVmaxWorkflow: {
      commandFn: () => actions.startUltrasoundDirectionalWorkflow({ spectralVmax: true }),
    },
    // AR_DECELERATION_TIME:BEGIN definition
    startDecelerationTimeWorkflow: {
      commandFn: actions.startDecelerationTimeWorkflow,
    },
    // AR_DECELERATION_TIME:END definition
    startSpectralDopplerVTIWorkflow: {
      commandFn: actions.startSpectralDopplerVTIWorkflow,
    },
    startRAAreaWorkflow: { commandFn: actions.startRAAreaWorkflow },
    startRVFACWorkflow: { commandFn: actions.startRVFACWorkflow },
    startEchoAreaContourWorkflow: { commandFn: actions.startEchoAreaContourWorkflow },
    startGuidedRVFACContourWorkflow: { commandFn: actions.startGuidedRVFACContourWorkflow },
    startBowelCurvedLengthWorkflow: {
      commandFn: actions.startBowelCurvedLengthWorkflow,
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
    setViewerQuizMeasurementContext: {
      commandFn: actions.setViewerQuizMeasurementContext,
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
    setViewerQuizIVCPhaseLabel: {
      commandFn: actions.setViewerQuizIVCPhaseLabel,
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
    addViewerCineComment: {
      commandFn: actions.addViewerCineComment,
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
    markViewerMeasurementModifiedInSession: {
      commandFn: actions.markViewerMeasurementModifiedInSession,
    },
    getSerializedViewerMeasurements: {
      commandFn: actions.getSerializedViewerMeasurements,
    },
    getViewerMeasurementSnapshotForPanel: {
      commandFn: actions.getViewerMeasurementSnapshotForPanel,
    },
    getViewerQuizCompositeStatusForActiveStudy: {
      commandFn: actions.getViewerQuizCompositeStatusForActiveStudy,
    },
    recoverViewerQuizGoldAreas: {
      commandFn: actions.recoverViewerQuizGoldAreas,
    },
    getViewerQuizLVSimpsonForActiveStudy: {
      commandFn: actions.getViewerQuizLVSimpsonForActiveStudy,
    },
    saveViewerMeasurementsForActiveStudy: {
      commandFn: async ({
        domain: explicitDomain,
        scoringIntent,
        educationAttemptIntent,
        deleteAnnotationIds = [],
        measurementIds = null,
        quizSpatialEvidenceByAnnotationId = null,
        previewOnly = false,
        reportFieldNames = null,
        educationQuizHemodynamics = null,
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
          // In a report-owned learning attempt, FormAPI derives report fields
          // from the persisted annotations on the same learner-copy Series.
          const isReportOwnedMeasurementSave =
            isReportOwnedLearnerMeasurementTarget(saveTarget);
          const isClinicalReportSave =
            isClinicalReportMeasurementsSaveTarget(saveTarget) ||
            isReportOwnedMeasurementSave;

          if (previewOnly && !isClinicalReportSave) {
            return {
              previewOnly: true,
              isClinicalReportSave: false,
              saveTarget,
              fieldNames: [],
              existingReportValues: {},
              incomingReportValues: {},
              reportFieldUpdates: {},
            };
          }

          const writableWorkflow = getWritableReviewMeasurementWorkflow(saveTarget);

          if (isReviewWorkflowSave && !writableWorkflow) {
            throw new Error('Measurements and annotations are read-only for this coaching review.');
          }

          let activeSeriesDoc = null;

          if (isClinicalReportSave) {
            activeSeriesDoc = await fetchSeriesDocById(
              isReportOwnedMeasurementSave
                ? saveTarget.learnerSeriesId
                : saveTarget.seriesId
            );
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

          // Multi-BWT learner evidence is always owned by the learner's
          // independent Series copy. Never allow fallback to the teaching case.
          // This guard is narrowly scoped to the opt-in quiz-caliper save path.
          if (quizSpatialEvidenceByAnnotationId !== null &&
              (!seriesDoc?._id || seriesDoc.isLearnerCopy !== true ||
                (saveTarget.baseSeriesId &&
                  String(seriesDoc._id) === String(saveTarget.baseSeriesId)) ||
                (saveTarget.learnerSeriesId &&
                  String(seriesDoc._id) !== String(saveTarget.learnerSeriesId)))) {
            throw new Error('BWT quiz measurements must be saved to the learner\'s Series copy.');
          }

          const domain = inferDomainFromSeriesDoc(seriesDoc, explicitDomain);
          // A report-scored learner copy owns its own report fields. Reuse the
          // clinical annotation -> report mapping against that learner copy,
          // never against the educator's source Series document.
          const isLearnerReportSave =
            isLearnerCopyOnSaveTarget(saveTarget) &&
            String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'learner' &&
            seriesDoc?.isLearnerCopy === true &&
            String(seriesDoc.educationScoringMode || '').toLowerCase() === 'report' &&
            domain === 'echo';
          const shouldSyncReportFields = isClinicalReportSave || isLearnerReportSave;

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

          const cornerstoneFallbackMeasurements = [
            ...(shouldSyncReportFields
              ? getCornerstoneVolumeMeasurementFallbacks({
                  studyInstanceUID: String(seriesDoc?.StudyInstanceUID || ''),
                  excludedMeasurementIds: viewerMeasurementsDeletedInSession,
                })
              : []),
            ...getCornerstoneUltrasoundDirectionalMeasurementFallbacks({
              studyInstanceUID: String(seriesDoc?.StudyInstanceUID || ''),
              excludedMeasurementIds: viewerMeasurementsDeletedInSession,
            }),
            ...(shouldSyncReportFields
              ? getCornerstoneBowelCurvedLengthMeasurementFallbacks({
                  studyInstanceUID: String(seriesDoc?.StudyInstanceUID || ''),
                  excludedMeasurementIds: viewerMeasurementsDeletedInSession,
                })
              : []),
          ];
          const measurements = getCurrentViewerMeasurementSnapshot(
            measurementService,
            cornerstoneFallbackMeasurements
          );

          if (shouldSyncReportFields) {
            console.info('[MeasurementAnnotations] clinical save snapshot', {
              liveMeasurementCount: measurementService?.getMeasurements?.()?.length || 0,
              createdInSessionCount: viewerMeasurementsCreatedInSession.size,
              modifiedInSessionCount: viewerMeasurementsModifiedInSession.size,
              deletedInSessionCount: viewerMeasurementsDeletedInSession.size,
              lvSimpsonSessionCount: getLVSimpsonSessionMeasurements().length,
              laVolumeSessionCount: getLAVolumeSessionMeasurements().length,
              cornerstoneFallbackCount: cornerstoneFallbackMeasurements.length,
              cornerstoneFallbackSlots: cornerstoneFallbackMeasurements
                .map(getLVSimpsonSlotFromMeasurement)
                .filter(Boolean),
              snapshotCount: measurements.length,
              lvSimpsonSlots: measurements
                .map(getLVSimpsonSlotFromMeasurement)
                .filter(Boolean),
            });
          }

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

          const changedClinicalMeasurementIds = shouldSyncReportFields
            ? new Set<string>([
                ...viewerMeasurementsCreatedInSession,
                ...viewerMeasurementsModifiedInSession,
              ])
            : new Set<string>();

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
            .map(measurement => {
              const measurementId = getMeasurementAnnotationId(measurement);
              const shouldPreferDirectLiveVolumeMeasurement =
                shouldSyncReportFields &&
                changedClinicalMeasurementIds.has(measurementId) &&
                (isLAVolumeMeasurement(measurement) || isLVSimpsonMeasurement(measurement));
              const directLiveMeasurement = shouldPreferDirectLiveVolumeMeasurement
                ? findMeasurementServiceMeasurementById(measurementService, measurementId)
                : null;
              const sourceMeasurement = directLiveMeasurement || measurement;
              const existingAnnotation = existingById.get(measurementId) || null;

              // For genuinely changed clinical LA/LV contours, use the exact live
              // MeasurementService object that drives the panel. This keeps contour
              // points in parity with the panel while saved guided geometry remains
              // authoritative through serializeViewerMeasurement().
              const annotation = serializeViewerMeasurement(sourceMeasurement, domain, existingAnnotation, {
                displaySetService,
                workflow: targetWorkflow,
              });
              if (domain === 'bowel' &&
                  quizSpatialEvidenceByAnnotationId &&
                  Object.prototype.hasOwnProperty.call(quizSpatialEvidenceByAnnotationId, measurementId)) {
                const evidence = quizSpatialEvidenceByAnnotationId[measurementId];
                // Only this opt-in quiz save path persists physical reference
                // evidence; do not add it to unrelated clinical annotations.
                if (evidence?.source !== 'dicom-calibrated-image-index-v1' ||
                    !Array.isArray(evidence.physicalPoints) ||
                    evidence.physicalPoints.length !== 2) {
                  throw new Error('Bowel quiz source calibration evidence is incomplete.');
                }
                annotation.quizSpatialEvidence = evidence;
              }
              return annotation;
            })
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

          if (shouldSyncReportFields) {
            annotations = canonicalizeClinicalViewerMeasurementAnnotations(annotations);
          }

          if (
            annotations.length === 0 &&
            !isReviewWorkflowSave &&
            existingScorableAnnotations.length > 0 &&
            (
              shouldSubmitForScore ||
              (
                previewOnly &&
                isReportOwnedMeasurementSave &&
                changedClinicalMeasurementIds.size === 0 &&
                viewerMeasurementsDeletedInSession.size === 0 &&
                explicitDeleteIds.size === 0
              )
            )
          ) {
            // A reopened report-owned learner attempt may have no live annotations,
            // while the exact learner Series already contains saved scoring evidence.
            // Reuse that persisted evidence only for an unchanged preview; pending
            // edits/deletions must still follow the normal review/save path.
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

          if (shouldSyncReportFields) {
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
          let clinicalReportApprovedFieldNames: string[] | null = null;

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
            // In a clinical report workflow, viewport presence is not edit intent.
            // A saved annotation can become live merely because the user clicked it
            // in the panel. Preserve the exact saved payload unless that annotation
            // was created or genuinely modified in this viewer session.
            const annotationsForMerge = shouldSyncReportFields
              ? annotations.filter(annotation =>
                  changedClinicalMeasurementIds.has(getMeasurementAnnotationId(annotation))
                )
              : annotations;

            const incomingClinicalSemanticKeys = new Set(
              annotationsForMerge.map(getClinicalViewerMeasurementSemanticKey).filter(Boolean)
            );
            const mergedMeasurementAnnotations = upsertViewerMeasurementAnnotations({
              existingRaw: seriesDoc.MeasurementAnnotations,
              source: 'ar-measurements-panel',
              annotations: annotationsForMerge,
              replaceFilter: existing => {
                if (!viewerMeasurementDomainsMatch(existing?.domain || 'generic', domain)) {
                  return false;
                }

                const existingId = existing?.annotationId || existing?.uid;
                const semanticKey = shouldSyncReportFields
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

                return !!existingId && (
                  shouldSyncReportFields
                    ? changedClinicalMeasurementIds.has(String(existingId))
                    : savedAnnotationIds.has(existingId)
                );
              },
            });

            let nextMeasurementAnnotations = mergedMeasurementAnnotations;

            if (shouldSyncReportFields) {
              const mergedViewerAnnotations = getRequestedWorkflowAnnotations(
                mergedMeasurementAnnotations,
                [VIEWER_MEASUREMENTS_WORKFLOW]
              );
              const unreplacedDeletedClinicalSemanticKeys = new Set(
                Array.from(deletedClinicalSemanticKeys).filter(
                  semanticKey => !incomingClinicalSemanticKeys.has(semanticKey)
                )
              );
              const canonicalViewerAnnotations =
                canonicalizeClinicalViewerMeasurementAnnotations(
                  mergedViewerAnnotations,
                  unreplacedDeletedClinicalSemanticKeys
                );

              nextMeasurementAnnotations = upsertViewerMeasurementAnnotations({
                existingRaw: mergedMeasurementAnnotations,
                source: 'ar-measurements-panel',
                annotations: canonicalViewerAnnotations,
                replaceFilter: existing =>
                  !!getClinicalViewerMeasurementSemanticKey(existing),
              });
            }

            if (shouldSyncReportFields) {
              // Enforce single-copy volume geometry at the final serialized
              // MeasurementAnnotations boundary, after every merge/upsert step.
              nextMeasurementAnnotations =
                compactClinicalViewerMeasurementAnnotationsRaw(nextMeasurementAnnotations);

              const reportAnnotations = getRequestedWorkflowAnnotations(nextMeasurementAnnotations, [
                VIEWER_MEASUREMENTS_WORKFLOW,
              ]);

              // FormAPI independently derives chamber measurements from the
              // canonical incoming MeasurementAnnotations; do not copy UI
              // display scalars into a second, potentially stale report path.
              clinicalReportFieldUpdates = buildViewerReportFieldUpdates(reportAnnotations);

              if (Object.keys(clinicalReportFieldUpdates).length) {
                console.info('[MeasurementAnnotations] clinical report field updates', {
                  fieldNames: Object.keys(clinicalReportFieldUpdates),
                  updatedFields: clinicalReportFieldUpdates,
                });
              }

              if (previewOnly) {
                const previewPayload = {
                  accessType: 'update',
                  viewerMeasurementIntent: 'clinical-report',
                  viewerMeasurementReviewOnly: true,
                  ...(isReportOwnedMeasurementSave ? { educationQuizHemodynamics } : {}),
                  viewerReportFieldUpdates: clinicalReportFieldUpdates,
                  MeasurementAnnotations: nextMeasurementAnnotations,
                  scoringIntent: shouldSubmitForScore ? 'score-attempt' : 'draft',
                  educationAttemptIntent: shouldSubmitForScore ? 'score-attempt' : 'draft',
                };

                const previewResponse = await fetch(
                  buildFormApiUrl(`series/${seriesDoc._id}`),
                  buildFormApiFetchOptions({
                    method: 'PUT',
                    body: JSON.stringify(previewPayload),
                  })
                );

                if (!previewResponse.ok) {
                  const message = await getResponseErrorMessage(
                    previewResponse,
                    `Measurement review failed: ${previewResponse.status}`
                  );
                  throw new Error(message);
                }

                const serverPreview = await previewResponse.json().catch(() => null);

                if (!serverPreview?.reviewOnly) {
                  throw new Error('FormAPI did not return a clinical measurement review preview.');
                }

                return {
                  ...serverPreview,
                  previewOnly: true,
                  isClinicalReportSave: true,
                  shouldSyncReportFields: true,
                  seriesDoc,
                  saveTarget,
                  domain,
                  annotations: reportAnnotations,
                  reportFieldUpdates: clinicalReportFieldUpdates,
                  reviewItems: Array.isArray(serverPreview?.items) ? serverPreview.items : [],
                };
              }

              if (Array.isArray(reportFieldNames)) {
                clinicalReportApprovedFieldNames = Array.from(
                  new Set(
                    reportFieldNames
                      .map(fieldName => String(fieldName || '').trim())
                      .filter(fieldName => /^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName))
                  )
                );
              }
            }

            const payload = {
              accessType: 'update',
              ...(shouldSyncReportFields
                ? {
                    viewerMeasurementIntent: 'clinical-report',
                    ...(isReportOwnedMeasurementSave ? { educationQuizHemodynamics } : {}),
                    viewerReportFieldUpdates: clinicalReportFieldUpdates,
                    ...(clinicalReportApprovedFieldNames !== null
                      ? { viewerMeasurementApprovedFields: clinicalReportApprovedFieldNames }
                      : {}),
                  }
                : {}),
              MeasurementAnnotations: nextMeasurementAnnotations,
              scoringIntent: shouldSubmitForScore ? 'score-attempt' : 'draft',
              educationAttemptIntent: shouldSubmitForScore ? 'score-attempt' : 'draft',
            };

            const serializedPayload = JSON.stringify(payload);

            if (shouldSyncReportFields) {
              const diagnosticAnnotations = getRequestedWorkflowAnnotations(
                nextMeasurementAnnotations,
                [VIEWER_MEASUREMENTS_WORKFLOW]
              );
              const nestedVolumeContourCopies = diagnosticAnnotations.reduce(
                (count, annotation) =>
                  count +
                  (Array.isArray(annotation?.lvSimpson?.contourPoints) ? 1 : 0) +
                  (Array.isArray(annotation?.laVolume?.contourPoints) ? 1 : 0) +
                  (Array.isArray(annotation?.measurements?.lvSimpson?.contourPoints) ? 1 : 0) +
                  (Array.isArray(annotation?.measurements?.laVolume?.contourPoints) ? 1 : 0),
                0
              );

              console.info('[MeasurementAnnotations] clinical save payload', {
                annotationCount: diagnosticAnnotations.length,
                volumeAnnotationCount: diagnosticAnnotations.filter(
                  annotation => annotation?.lvSimpson || annotation?.laVolume
                ).length,
                nestedVolumeContourCopies,
                measurementAnnotationsCharacters: String(nextMeasurementAnnotations || '').length,
                requestCharacters: serializedPayload.length,
              });
            }

            const response = await fetch(
              buildFormApiUrl(`series/${seriesDoc._id}`),
              buildFormApiFetchOptions({
                method: 'PUT',
                body: serializedPayload,
              })
            );

            if (!response.ok) {
              const failure = await response.json().catch(() => null);
              throw new Error(`Save failed (${response.status}): ${failure?.errorMsg || failure?.error || response.statusText}`);
            }

            const updatedSeries = await response.json().catch(() => null);
            if (updatedSeries?._id) {
              savedSeriesDoc = updatedSeries;
            }

            if (shouldSyncReportFields) {
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

          if (shouldSyncReportFields && savedSeriesDoc?._id) {
            rememberClinicalViewerSeriesDoc(savedSeriesDoc);

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

          const persistedMeasurementIds = new Set(
            refreshedAnnotations.map(getMeasurementAnnotationId).filter(Boolean)
          );

          for (const cineComment of getCineCommentSessionMeasurements()) {
            const measurementId = getMeasurementAnnotationId(cineComment);

            if (measurementId && persistedMeasurementIds.has(measurementId)) {
              removeCineCommentSessionMeasurement(measurementId);
            }
          }

          viewerMeasurementsCreatedInSession.clear();
          viewerMeasurementsModifiedInSession.clear();
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
    showViewerQuizLearnerBwtMeasurementSet: {
      commandFn: actions.showViewerQuizLearnerBwtMeasurementSet,
    },
    showViewerQuizLearnerMeasurement: {
      commandFn: actions.showViewerQuizLearnerMeasurement,
    },
    showViewerQuizLearnerCompositeMeasurement: {
      commandFn: actions.showViewerQuizLearnerCompositeMeasurement,
    },
    clearViewerQuizMeasurementComparison: {
      commandFn: actions.clearViewerQuizMeasurementComparison,
    },
    showViewerQuizAuthoringGoldCaliper: {
      commandFn: actions.showViewerQuizAuthoringGoldCaliper,
    },
    showViewerQuizMeasurementComparison: {
      commandFn: actions.showViewerQuizMeasurementComparison,
    },
    getCurrentViewerQuizFrameAnswer: {
      commandFn: actions.getCurrentViewerQuizFrameAnswer,
    },
    captureBowelQuizLumenCenter: {
      commandFn: actions.captureBowelQuizLumenCenter,
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
