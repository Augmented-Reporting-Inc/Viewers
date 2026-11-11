import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  getViewerQuizAuthoringContent,
  getViewerQuizzesForActiveStudy,
  getViewerQuizScoreForActiveStudy,
  getViewerQuizAuthoringContextFromUrl,
  getViewerQuizSessionKeyFromUrl,
  isViewerQuizAuthoringMode,
  saveViewerQuizAuthoringDraft,
  saveViewerQuizResponseForActiveStudy,
  ensureViewerQuizSaveSeriesDoc,
  submitAndRefreshViewerQuizScoreForActiveStudy,
} from '../utils/viewerQuizApi';
import {
  buildClinicalReportReviewRows,
  ClinicalReportMeasurementReviewModal,
} from '../../../extension-ar-measurements/src/panels/ARMeasurementsPanel';
import {
  readViewerQuizSessionState,
  writeViewerQuizSessionState,
} from '../utils/viewerQuizSessionState';
import {
  isGuidedQuizCompositeKind,
  isMatchingQuizEFCompletion,
  getInitialGuidedEFQuestionTarget,
} from '../utils/quizCompositeCaptureIntent';
import { composeIVCRapRVSP, attachLearnerRapRvspToIVCAnswer, isIVCReviewCurrent, RAP_CHOICES_MMHG } from '../utils/ivcRapRvsp';
import {
  getLearnerCompositeAutoCaptureSignature,
  getLearnerCompositeSourceComponents,
  getLearnerCompositePersistenceSources,
  isPersistedLearnerCompositeSource,
  isLearnerCompositeCaptureCurrent,
} from '../utils/quizLearnerCompositeCapture';
import {
  isBowelMeasurementSetQuestion,
  getBowelMeasurementSetEntries,
  restoreBowelMeasurementSetDisplayEvidence,
  formatBowelBwtMeasurementLabel,
  appendBowelMeasurementSetAnswer,
  getBowelMeasurementSetMidpointSpacingMm,
  getBowelMeasurementSetEstimatedRadialAngleDegrees,
} from '../utils/bowelQuizMeasurementSet';
import {
  COMPOSITE_FRAME_SLOTS,
  getCompleteCompositeFrameTargets,
  matchesConfiguredCompositeFrame,
} from '../utils/compositeFrameTargets';
import { EF_CONTOUR_FRAME_SLOTS, getEFGoldContourAuthoringRows } from '../utils/efGoldContourAuthoring';
import { getCompositePhaseSlot, getCompositePhaseMeasurementId, matchesCompositePhaseSource, getCompositeGoldCaptureSignature, getSavedCompositePhaseValues, needsSavedCalibratedGoldAreas,
  findEditableCompositePhaseMeasurement, clearSavedCompositeGoldPhase, getCompositeGoldPersistenceError, getIncompleteCompositeGoldReplacementReason } from '../utils/quizCompositePhaseEvidence';

const AR_QUIZ_MEASUREMENT_ADDED_EVENT = 'ar-learning:quiz-measurement-added';
const AR_QUIZ_MEASUREMENT_LABELLED_EVENT = 'ar-learning:quiz-measurement-labelled';
const AR_LV_SIMPSON_CAPTURE_REQUESTED_EVENT = 'ar-measurements:lv-simpson-capture-requested';
const AR_VIEWER_QUIZ_AUTHORING_SAVED_EVENT = 'ar:viewer-quiz-authoring-saved';
function reportEducationChange(source: string) {
  window.dispatchEvent(new CustomEvent('ar:education-work-changed', { detail: { source } }));
}
function reportEducationSaveStart(source: string, requestId: string) {
  window.dispatchEvent(new CustomEvent('ar:education-work-save-start', { detail: { source, requestId } }));
}
function reportEducationSaveResult(source: string, requestId: string, succeeded: boolean) {
  window.dispatchEvent(new CustomEvent('ar:education-work-save-result', {
    detail: { source, requestId, succeeded },
  }));
}

type CaseQuestionsPanelProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
  configuration?: Record<string, any>;
};

type QuizQuestion = {
  questionKey: string;
  title?: string;
  type: string;
  prompt: string;
  helpText?: string;
  explanation?: string;
  required?: boolean;
  points?: number;
  choices?: Array<{ value: string; label: string }>;
  sortOrder?: number;
  viewerTarget?: Record<string, any>;
  answerConfig?: Record<string, any>;
  scoringConfig?: Record<string, any>;
  reviewConfig?: Record<string, any>;
};

type QuizDefinition = {
  _id?: string;
  id?: string;
  quizKey: string;
  quizVersion: number;
  title?: string;
  description?: string;
  status?: string;
  purpose?: string;
  domain?: string;
  workflow?: string;
  viewerMode?: string;
  changeSummary?: string;
  questions?: QuizQuestion[];
};

type QuizRubric = {
  _id?: string;
  id?: string;
  quizKey?: string;
  quizVersion?: number;
  items?: any[];
};

type QuizResponse = {
  quizKey: string;
  quizVersion: number;
  status?: string;
  answers?: Array<{ questionKey: string; value: any }>;
};

type AnswersByQuizKey = Record<string, Record<string, any>>;

function cleanString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeQuizMeasurementDomain(value: unknown): string {
  const domain = cleanString(value)
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (domain === 'iuscan') {
    return 'bowel';
  }

  return ['echo', 'bowel'].includes(domain) ? domain : '';
}

function getQuizAuthoringMeasurementDomainFromUrl(): string {
  try {
    const params = new URLSearchParams(window.location?.search || '');

    return normalizeQuizMeasurementDomain(
      params.get('arMeasurementDomain') ||
        params.get('arViewerDomain') ||
        params.get('viewerDomain') ||
        ''
    );
  } catch {
    return '';
  }
}

function inferLegacyQuizMeasurementDomain(
  definition: QuizDefinition | null | undefined
): string {
  const text = [
    definition?.title,
    definition?.description,
    definition?.quizKey,
    ...(Array.isArray(definition?.questions)
      ? definition.questions.flatMap(question => [
          question?.title,
          question?.prompt,
          question?.answerConfig?.measurementType,
        ])
      : []),
  ]
    .map(cleanString)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(bowel|ileum|ileal|colon|colonic|cecum|cecal|rectum|rectal)\b/.test(text)) {
    return 'bowel';
  }

  if (/\b(echo|echocardi|cardiac|ventric|atri|aortic|mitral|tricuspid|lvid|tapse|lvot)\b/.test(text)) {
    return 'echo';
  }

  return '';
}

function getLearnerQuizMeasurementDomain(quiz: QuizDefinition | undefined, source: any): string {
  return normalizeQuizMeasurementDomain(quiz?.domain) ||
    normalizeQuizMeasurementDomain(source?.seriesDoc?.measurementDomain) ||
    normalizeQuizMeasurementDomain(source?.measurementDomain) ||
    inferLegacyQuizMeasurementDomain(quiz) ||
    getQuizAuthoringMeasurementDomainFromUrl();
}

function getQuizQuestionMeasurementDomain(
  quiz: QuizDefinition | undefined,
  question: QuizQuestion | undefined,
  source: any
): string {
  // A configured multiple-BWT question is unambiguously a Bowel measurement
  // workflow, even when legacy study or URL metadata is absent or stale.
  return isBowelMeasurementSetQuestion(question) ? 'bowel' :
    getLearnerQuizMeasurementDomain(quiz, source);
}

function resolveQuizAuthoringMeasurementDomain(
  definition: QuizDefinition | null | undefined
): string {
  return (
    getQuizAuthoringMeasurementDomainFromUrl() ||
    normalizeQuizMeasurementDomain(definition?.domain) ||
    inferLegacyQuizMeasurementDomain(definition)
  );
}

const AR_QUIZ_MEASUREMENT_DOMAIN_EVENT = 'ar-learning:quiz-measurement-domain';

function dispatchQuizMeasurementDomain(domain: string) {
  try {
    window.dispatchEvent(
      new CustomEvent(AR_QUIZ_MEASUREMENT_DOMAIN_EVENT, {
        detail: { domain },
      })
    );
  } catch {}
}

function syncQuizMeasurementDomainToUrl(
  value: unknown,
  { overwrite = false }: { overwrite?: boolean } = {}
) {
  const domain = normalizeQuizMeasurementDomain(value);

  // Broadcast immediately for the active viewer, and persist the confirmed
  // quiz domain in the URL so a late listener or reopened viewer can recover
  // it before the Length label dialog opens.
  dispatchQuizMeasurementDomain(domain);

  try {
    const url = new URL(window.location.href);

    if (!domain) {
      url.searchParams.delete('arMeasurementDomain');
      window.history.replaceState(window.history.state, '', url.toString());
      return;
    }
    const existingDomain = normalizeQuizMeasurementDomain(
      url.searchParams.get('arMeasurementDomain') ||
        url.searchParams.get('arViewerDomain') ||
        url.searchParams.get('viewerDomain') ||
        ''
    );

    if (existingDomain && !overwrite) {
      return;
    }

    url.searchParams.set('arMeasurementDomain', domain);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {}
}

function looksLikeInternalQuizLabel(value: unknown): boolean {
  const text = cleanString(value);
  if (!text) return false;

  const dicomUidLike = /(?:^|[^0-9])(?:\d+\.){4,}\d+(?:[^0-9]|$)/.test(text);
  const longUnbrokenToken = /\S{72,}/.test(text);

  return dicomUidLike || longUnbrokenToken;
}

function getLearnerQuizDescription(quiz: QuizDefinition | null | undefined): string {
  const description = cleanString(quiz?.description);

  if (!description || looksLikeInternalQuizLabel(description)) {
    return '';
  }

  return description;
}

function numberOrEmpty(value: any) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return value;
}

function isAnswerEmpty(value: any): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'measurements')) {
      return !Array.isArray(value.measurements) || value.measurements.length === 0;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      return value.value === null || value.value === undefined || cleanString(value.value) === '';
    }
    if (Object.prototype.hasOwnProperty.call(value, 'selectedMarkerIds')) {
      return !Array.isArray(value.selectedMarkerIds) || value.selectedMarkerIds.length === 0;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'selectedMarkerId')) {
      return !cleanString(value.selectedMarkerId);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'selectedMarkerKey')) {
      return !cleanString(value.selectedMarkerKey);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'selectedTarget')) {
      return Object.keys(value.selectedTarget || {}).length === 0;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'point')) {
      const point = value.point || {};
      return point.x === null || point.x === undefined || point.y === null || point.y === undefined;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'placedMarker')) {
      const point = value.placedMarker?.point || value.placedMarker || {};
      return point.x === null || point.x === undefined || point.y === null || point.y === undefined;
    }
  }

  return value === undefined || value === null || cleanString(value) === '';
}

function getMarkerOptions(question: QuizQuestion) {
  const options = question?.answerConfig?.markerOptions || question?.answerConfig?.markers;
  return Array.isArray(options) ? options : [];
}

function normalizeMarkerIdList(...values: any[]): string[] {
  const rawValues: any[] = [];

  values.forEach(value => {
    if (Array.isArray(value)) {
      rawValues.push(...value);
      return;
    }

    if (value && typeof value === 'object') {
      if (Array.isArray(value.selectedMarkerIds)) {
        rawValues.push(...value.selectedMarkerIds);
      }
      if (Array.isArray(value.correctMarkerIds)) {
        rawValues.push(...value.correctMarkerIds);
      }
      if (Array.isArray(value.markerIds)) {
        rawValues.push(...value.markerIds);
      }
      if (Array.isArray(value.selectedMarkers)) {
        value.selectedMarkers.forEach(marker => {
          rawValues.push(marker?.markerId, marker?.markerKey, marker?.value);
        });
      }

      rawValues.push(
        value.selectedMarkerId,
        value.selectedMarkerKey,
        value.correctMarkerId,
        value.correctMarkerKey,
        value.markerId,
        value.markerKey,
        value.value
      );
      return;
    }

    rawValues.push(value);
  });

  return Array.from(new Set(rawValues.map(value => cleanString(value)).filter(Boolean)));
}

function getCorrectMarkerIdsFromOptions(markerOptions: any[] = []) {
  return normalizeMarkerOptions(markerOptions)
    .filter(marker => marker?.correct === true || Number(marker?.points ?? marker?.marks ?? 0) > 0)
    .map(marker => cleanString(marker.markerId || marker.markerKey || marker.value))
    .filter(Boolean);
}

function getCorrectMarkerIdsFromAnswerConfig(answerConfig: Record<string, any> = {}) {
  return normalizeMarkerIdList(
    answerConfig.correctMarkerIds,
    answerConfig.correctMarkerId,
    answerConfig.correctMarkerKey,
    getCorrectMarkerIdsFromOptions(answerConfig.markerOptions)
  );
}

function toggleMarkerId(markerIds: string[] = [], markerId = '') {
  const normalized = normalizeMarkerIdList(markerIds);
  const value = cleanString(markerId);

  if (!value) {
    return normalized;
  }

  return normalized.includes(value)
    ? normalized.filter(item => item !== value)
    : [...normalized, value];
}

function normalizeMarkerQuestionType(value: unknown): string {
  const type = cleanString(value);

  if (type === 'markerChoice' || type === 'multipleMarkerChoice') {
    return 'markerMultiSelect';
  }

  return type;
}

function isMarkerChoiceQuestionType(question: QuizQuestion) {
  return normalizeMarkerQuestionType(question?.type) === 'markerMultiSelect';
}

function isPlaceMarkerQuestionType(question: QuizQuestion) {
  return ['placeMarker', 'pointPlacement'].includes(cleanString(question?.type));
}

function isClassicAuthoringQuestion(question: QuizQuestion) {
  return !isViewerNativeQuestion(question);
}

function getClassicAuthoringMessage(question: QuizQuestion) {
  if (question.type === 'single_choice' || question.type === 'multi_select') {
    return 'Edit choices and correct answers in Manage Quiz. This question does not require viewer authoring.';
  }

  if (question.type === 'true_false') {
    return 'Edit the true/false correct answer in Manage Quiz. This question does not require viewer authoring.';
  }

  if (question.type === 'numeric') {
    return 'Edit the accepted numeric range in Manage Quiz. This question does not require viewer authoring.';
  }

  if (question.type === 'short_text') {
    return 'Edit the expected text answer in Manage Quiz. This question does not require viewer authoring.';
  }

  return 'Edit this non-viewer question in Manage Quiz.';
}

function setObjectAnswerPart(currentValue: any, patch: Record<string, any>) {
  return {
    ...(currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
      ? currentValue
      : {}),
    ...patch,
  };
}

function plainObject(value: any) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Minimum pairwise radial separation (degrees), matching FormAPI geometry. */
function getBowelGoldAngularSeparation(entries: any[], lumenCenter: any): number | null {
  if (!Array.isArray(lumenCenter) || lumenCenter.length !== 3 ||
      !lumenCenter.every(Number.isFinite) || entries.length < 2) return null;
  const vectors: Array<number[] | null> = entries.map(entry => {
    const points = plainObject(entry.quizSpatialEvidence).physicalPoints;
    if (!Array.isArray(points) || points.length !== 2 ||
        points.some(point => !Array.isArray(point) || point.length !== 3 ||
          !point.every(Number.isFinite))) return null;
    return lumenCenter.map((center, i) => (points[0][i] + points[1][i]) / 2 - center);
  });
  if (vectors.some(vector => !vector)) return null;
  let separation = Infinity;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const a = vectors[i] as number[], b = vectors[j] as number[];
      const normA = Math.hypot(...a), normB = Math.hypot(...b);
      if (!normA || !normB) return null;
      const dot = a.reduce((total, v, k) => total + v * b[k], 0);
      const angle = Math.acos(Math.min(1, Math.max(-1, dot / (normA * normB)))) * 180 / Math.PI;
      separation = Math.min(separation, angle);
    }
  }
  return Number.isFinite(separation) ? separation : null;
}

/** Validate completed educator gold sets in the Viewer, where the calipers can be corrected. */
function getBowelGoldValidation(question: any) {
  const config = plainObject(question?.answerConfig);
  const set = plainObject(config.measurementSet);
  if (set.enabled !== true) return { status: 'not-applicable', message: '', observed: null as number | null, required: 0 };
  const entries = getBowelMeasurementSetEntries(config.goldMeasurements);
  const count = Number(set.requiredCount) || 2;
  const incomplete = (message: string) => ({ status: 'incomplete', message, observed: null as number | null, required: 0 });
  const invalid = (message: string, observed: number | null = null, required = 0) =>
    ({ status: 'invalid', message, observed, required });
  if (entries.length !== count) return incomplete(`Capture ${count} distinct gold BWT calipers (${entries.length} recorded).`);
  const ids = entries.map((entry: any) => cleanString(entry.sourceAnnotationId));
  if (ids.some((id: string) => !id) || new Set(ids).size !== count) {
    return invalid('Gold calipers must have distinct saved source annotation IDs.');
  }
  const frameKey = (target: any) => {
    const t = plainObject(target);
    const ids = ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID'].map(key => cleanString(t[key]));
    const number = Number(t.frameNumber);
    return ids.every(Boolean) && Number.isInteger(number) && number >= 1 ? [...ids, number].join('|') : '';
  };
  const frame = frameKey(set.referenceTarget);
  if (!frame || entries.some((entry: any) => frameKey(entry.viewerTarget) !== frame)) {
    return invalid('All gold calipers must reference the same identified DICOM frame.');
  }
  const label = cleanString(set.measurementTarget);
  if (!label || entries.some((entry: any) => cleanString(entry.measurementType) !== label)) {
    return invalid('All gold calipers must use the same bowel segment label.');
  }
  const evidence = entries.map((entry: any) => plainObject(entry.quizSpatialEvidence));
  const validPoint = (point: any) => Array.isArray(point) && point.length === 3 &&
    point.every((value: any) => typeof value === 'number' && Number.isFinite(value));
  if (evidence.some((item: any) => !Array.isArray(item.physicalPoints) ||
      item.physicalPoints.length !== 2 || item.physicalPoints.some((point: any) => !validPoint(point)) ||
      !['SequenceOfUltrasoundRegions', 'cornerstonePixelSpacing'].includes(item.calibrationSource) ||
      !Number.isFinite(item.pixelSpacing?.row) || !Number.isFinite(item.pixelSpacing?.column) ||
      item.pixelSpacing.row <= 0 || item.pixelSpacing.column <= 0)) {
    return invalid('Calibrated DICOM geometry is missing. Re-capture the affected BWT caliper.');
  }
  const first = evidence[0];
  if (evidence.some((item: any) => item.calibrationSource !== first.calibrationSource ||
      item.pixelSpacing.row !== first.pixelSpacing.row ||
      item.pixelSpacing.column !== first.pixelSpacing.column)) {
    return invalid('Gold calipers use inconsistent physical calibration.');
  }
  const centers = evidence.map((item: any) =>
    item.physicalPoints[0].map((value: number, index: number) =>
      (value + item.physicalPoints[1][index]) / 2));
  const orientation = cleanString(set.orientation);
  const required = Number(orientation === 'longitudinal'
    ? set.minimumSeparationMm : set.minimumSeparationDegrees);
  if (!Number.isFinite(required) || required <= 0) return invalid('Configure a valid spatial separation threshold.');
  let observed: number | null = null;
  if (orientation === 'longitudinal') {
    const axis = set.longitudinalAxisPhysical;
    if (!validPoint(axis) || Math.hypot(...axis) <= 0) {
      return invalid('Longitudinal bowel axis is missing; re-capture the gold calipers.');
    }
    const axisLength = Math.hypot(...axis);
    observed = Infinity;
    for (let i = 0; i < centers.length; i++) for (let j = i + 1; j < centers.length; j++) {
      const projection = Math.abs(centers[i].reduce((sum: number, value: number, k: number) =>
        sum + (value - centers[j][k]) * axis[k], 0)) / axisLength;
      observed = Math.min(observed, projection);
    }
  } else if (orientation === 'crossSection') {
    if (!validPoint(set.lumenCenterPhysical)) return incomplete('Capture the lumen centre to validate radial separation.');
    if (set.lumenCenterCalibration?.calibrationSource !== first.calibrationSource ||
        set.lumenCenterCalibration?.pixelSpacing?.row !== first.pixelSpacing.row ||
        set.lumenCenterCalibration?.pixelSpacing?.column !== first.pixelSpacing.column) {
      return invalid('Lumen centre and gold calipers use different physical calibration.');
    }
    observed = getBowelGoldAngularSeparation(entries, set.lumenCenterPhysical);
  } else return invalid('Unknown bowel measurement orientation.');
  if (observed === null || !Number.isFinite(observed)) return invalid('Spatial separation could not be calculated.');
  const unit = orientation === 'longitudinal' ? 'mm' : '°';
  const message = `Gold caliper separation ${observed.toFixed(2)}${unit}; minimum ${required.toFixed(2)}${unit}.`;
  return observed + 1e-8 >= required
    ? { status: 'valid', message, observed, required }
    : invalid(`${message} Adjust the calipers in the Viewer.`, observed, required);
}

function getNestedViewerTarget(value: any) {
  const source = plainObject(value);
  const placedMarker = plainObject(source.placedMarker);
  const goldMeasurement = plainObject(source.goldMeasurement);
  const candidates = [
    source.selectedTarget,
    source.viewerTarget,
    source.target,
    placedMarker.selectedTarget,
    placedMarker.viewerTarget,
    goldMeasurement.selectedTarget,
    goldMeasurement.viewerTarget,
    source,
  ];

  return candidates.find(targetHasNavigationIdentity) || null;
}

function targetHasNavigationIdentity(target: any) {
  const normalized = plainObject(target);

  return !!(
    cleanString(normalized.studyInstanceUID || normalized.StudyInstanceUID) ||
    cleanString(normalized.seriesInstanceUID || normalized.SeriesInstanceUID) ||
    cleanString(normalized.sopInstanceUID || normalized.SOPInstanceUID) ||
    cleanString(normalized.displaySetInstanceUID) ||
    cleanString(normalized.referencedImageId) ||
    (normalized.frameIndex !== null && normalized.frameIndex !== undefined) ||
    (normalized.frameNumber !== null && normalized.frameNumber !== undefined) ||
    (normalized.imageIndex !== null && normalized.imageIndex !== undefined)
  );
}

function getCompleteEFContourFrameTargets(answerConfig: any) {
  const config = plainObject(answerConfig);
  if (config.measurementKind !== 'lvSimpsonEF' ||
      config.efContourFrameGuidanceEnabled !== true) {
    return null;
  }

  const targets = plainObject(config.efContourTargets);
  const valid = EF_CONTOUR_FRAME_SLOTS.every(({ slot }) => {
    const target = plainObject(targets[slot]);
    return cleanString(target.referencedImageId) &&
      cleanString(target.sopInstanceUID || target.SOPInstanceUID) &&
      Number.isInteger(Number(target.frameNumber)) && Number(target.frameNumber) > 0;
  });
  return valid ? targets : null;
}

/**
 * Saved gold composite evidence is navigable independently of optional guided
 * frame targets. This is read-only; reopening an authored question must never
 * restart contour acquisition or rewrite its previously accepted result.
 */
function getSavedGoldCompositeNavigationComponents(answerConfig: any) {
  const gold = plainObject(plainObject(answerConfig).goldMeasurement);
  const composite = plainObject(gold.compositeResult);
  const kind = cleanString(plainObject(answerConfig).measurementKind);
  const sourceComposite = kind === 'ivcRapRvsp'
    ? plainObject(plainObject(composite.ivc).compositeResult)
    : composite;
  const slots = kind === 'lvSimpsonEF'
    ? EF_CONTOUR_FRAME_SLOTS
    : ['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(kind)
      ? [{ slot: 'A4C', label: 'Apical four-chamber' }, { slot: 'A2C', label: 'Apical two-chamber' }]
      : kind === 'rvFAC'
        ? [{ slot: 'RV_ED', label: 'RV end-diastole' }, { slot: 'RV_ES', label: 'RV end-systole' }]
        : (kind === 'ivcCollapsibility' || kind === 'ivcRapRvsp')
          ? [{ slot: 'IVC_EXP', label: 'IVC expiration' }, { slot: 'IVC_INSP', label: 'IVC inspiration' }]
          : kind === 'raArea' ? [{ slot: 'RA_ES', label: 'RA end-systole' }] : [];
  const components = Array.isArray(sourceComposite.components) ? sourceComposite.components : [];
  if (!slots.length || !components.length) return [];
  return slots.map(({ slot, label }) => {
    const component = components.find((entry: any) => cleanString(entry?.slot) === slot);
    const target = plainObject(component?.target);
    const complete = !!cleanString(component?.annotationId) &&
      !!cleanString(target.studyInstanceUID) &&
      !!cleanString(target.seriesInstanceUID) &&
      !!cleanString(target.sopInstanceUID) &&
      Number.isInteger(Number(target.frameNumber)) &&
      Number(target.frameNumber) > 0;
    return { slot, label, complete, target };
  });
}

function getQuestionViewerTarget(question: QuizQuestion) {
  const answerConfig = plainObject(question?.answerConfig);
  const efContourTargets = getCompleteEFContourFrameTargets(answerConfig);
  if (efContourTargets) {
    return efContourTargets.A4C_ED;
  }
  const candidates = [
    question?.viewerTarget,
    answerConfig.viewerTarget,
    answerConfig.goldTarget,
    plainObject(answerConfig.goldPoint).viewerTarget,
    plainObject(answerConfig.goldMeasurement).viewerTarget,
  ];

  return candidates.find(targetHasNavigationIdentity) || null;
}

// Legacy/unconfigured and explicit frame-only questions open only the SOP;
// instance_and_frame requires the learner to find the correct SOP unaided.
// Never jump to the educator's correct frame during question activation.
function shouldGuideFrameSelectionToInstance(question: QuizQuestion) {
  const mode = cleanString(plainObject(question?.answerConfig).frameSelectionMode);
  return mode === '' || mode === 'frame_only';
}

function getLearnerBwtCaptureFailureMessage(reason: string): string {
  const explanation = cleanString(reason);
  if (!explanation || explanation === 'measurement-not-ready' ||
      explanation === 'selected-measurement-not-found') {
    return 'This caliper was not recorded because its labelled measurement is not available yet.';
  }
  if (explanation === 'no-selected-measurement') {
    return 'The completed caliper could not be identified. Draw and label a new BWT caliper.';
  }
  if (explanation.includes('bwt-spatial-calibration-unavailable') ||
      explanation.includes('Calibrated image-index') ||
      explanation.includes('physical-pixel-spacing-unavailable') ||
      explanation.includes('dicom-calibration')) {
    return 'This caliper could not be recorded because its DICOM image calibration could not be verified.';
  }
  if (explanation.includes('expected anatomical label') ||
      explanation.includes('calibrated Length measurement')) {
    return explanation;
  }
  if (explanation.includes('same identified image/frame') ||
      explanation.includes('exact DICOM frame') ||
      explanation.includes('active-dicom-frame')) {
    return 'All BWT calipers must be measured on the same identified DICOM frame.';
  }
  return explanation;
}

function getQuestionSelectionViewerTarget(
  question: QuizQuestion,
  viewerTarget: any,
  revealExactFrame = false
) {
  if (question.type !== 'frameSelection' || revealExactFrame || !viewerTarget) {
    return viewerTarget;
  }

  const target = plainObject(viewerTarget);
  const referencedImageMatch = cleanString(target.referencedImageId).match(
    /\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)/i
  );
  const decodeTargetId = (value: string | undefined) => {
    try {
      return value ? decodeURIComponent(value) : '';
    } catch {
      return value || '';
    }
  };

  // A frame-selection question must identify the correct DICOM instance without
  // revealing the gold frame when the learner opens the question. The exact
  // frame remains available to scoring and explicit review actions.
  return {
    studyInstanceUID:
      target.studyInstanceUID || target.StudyInstanceUID || decodeTargetId(referencedImageMatch?.[1]),
    seriesInstanceUID:
      target.seriesInstanceUID ||
      target.SeriesInstanceUID ||
      decodeTargetId(referencedImageMatch?.[2]),
    sopInstanceUID:
      target.sopInstanceUID || target.SOPInstanceUID || decodeTargetId(referencedImageMatch?.[3]),
    displaySetInstanceUID: target.displaySetInstanceUID,
  };
}

async function runViewerCommand(commandsManager: any, commandName: string, options: any) {
  if (!commandsManager) {
    return null;
  }

  if (typeof commandsManager.runCommand === 'function') {
    return commandsManager.runCommand(commandName, options);
  }

  if (typeof commandsManager.run === 'function') {
    return commandsManager.run(commandName, options);
  }

  return null;
}

function normalizeChoiceValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  return cleanString(value);
}

function getQuestionChoices(question: QuizQuestion) {
  if (Array.isArray(question.choices) && question.choices.length > 0) {
    return question.choices;
  }

  if (question.type === 'true_false') {
    return [
      { value: 'TRUE', label: 'True' },
      { value: 'FALSE', label: 'False' },
    ];
  }

  return [];
}

function buildInitialAnswers(
  quizzes: QuizDefinition[] = [],
  responses: QuizResponse[] = []
): AnswersByQuizKey {
  const next: AnswersByQuizKey = {};

  quizzes.forEach(quiz => {
    const matchingResponse = responses.find(
      response =>
        response.quizKey === quiz.quizKey &&
        Number(response.quizVersion || 1) === Number(quiz.quizVersion || 1)
    );

    const quizAnswers: Record<string, any> = {};

    (matchingResponse?.answers || []).forEach(answer => {
      quizAnswers[answer.questionKey] = answer.value;
    });

    next[quiz.quizKey] = quizAnswers;
  });

  return next;
}

function getLearnerQuizIdentity(quizzes: QuizDefinition[] = []) {
  return quizzes
    .map(quiz => `${cleanString(quiz.quizKey)}:${Number(quiz.quizVersion || 1)}`)
    .filter(Boolean)
    .sort()
    .join('|');
}

function mergeQuizAnswers(
  persistedAnswers: AnswersByQuizKey = {},
  sessionAnswers: AnswersByQuizKey = {}
): AnswersByQuizKey {
  const next: AnswersByQuizKey = { ...persistedAnswers };

  Object.entries(sessionAnswers).forEach(([quizKey, quizAnswers]) => {
    next[quizKey] = {
      ...(persistedAnswers[quizKey] || {}),
      ...(quizAnswers || {}),
    };
  });

  return next;
}

function getReviewTargetIdentityScore(value: any) {
  const target = plainObject(value);
  let score = 0;

  if (cleanString(target.referencedImageId)) {
    score += 8;
  }
  if (cleanString(target.sopInstanceUID || target.SOPInstanceUID)) {
    score += 6;
  }
  if (cleanString(target.seriesInstanceUID || target.SeriesInstanceUID)) {
    score += 4;
  }
  if (cleanString(target.displaySetInstanceUID)) {
    score += 3;
  }
  if (cleanString(target.studyInstanceUID || target.StudyInstanceUID)) {
    score += 2;
  }
  if (target.frameNumber !== null && typeof target.frameNumber !== 'undefined') {
    score += 1;
  }
  if (target.frameIndex !== null && typeof target.frameIndex !== 'undefined') {
    score += 1;
  }
  if (target.imageIndex !== null && typeof target.imageIndex !== 'undefined') {
    score += 1;
  }

  return score;
}

function chooseReviewTargetValue(preferredValue: any, fallbackValue: any) {
  const preferredTarget = plainObject(preferredValue);
  const fallbackTarget = plainObject(fallbackValue);
  const preferredScore = getReviewTargetIdentityScore(preferredTarget);
  const fallbackScore = getReviewTargetIdentityScore(fallbackTarget);

  if (preferredScore > 0 && preferredScore >= fallbackScore) {
    return { ...preferredTarget };
  }

  if (fallbackScore > 0) {
    return { ...fallbackTarget };
  }

  return {};
}

function mergeReviewAnswerValue(persistedValue: any, scoredValue: any) {
  if (typeof scoredValue === 'undefined') {
    return persistedValue;
  }

  const persisted = plainObject(persistedValue);
  const scored = plainObject(scoredValue);

  if (!Object.keys(persisted).length || !Object.keys(scored).length) {
    return scoredValue;
  }

  const merged = {
    ...persisted,
    ...scored,
  };

  ['selectedTarget', 'viewerTarget'].forEach(key => {
    const target = chooseReviewTargetValue(scored[key], persisted[key]);

    if (Object.keys(target).length) {
      merged[key] = target;
    }
  });

  ['placedMarker', 'sourceRefs', 'reviewPayload'].forEach(key => {
    const persistedPart = plainObject(persisted[key]);
    const scoredPart = plainObject(scored[key]);

    if (Object.keys(persistedPart).length || Object.keys(scoredPart).length) {
      merged[key] = {
        ...persistedPart,
        ...scoredPart,
      };
    }
  });

  return merged;
}

function mergeReviewReferenceValues(...values: any[]) {
  const merged: Record<string, any> = {};

  values.forEach(value => {
    const source = plainObject(value);

    if (!Object.keys(source).length) {
      return;
    }

    const previous = { ...merged };
    Object.assign(merged, source);

    ['selectedTarget', 'viewerTarget'].forEach(key => {
      const target = chooseReviewTargetValue(source[key], previous[key]);

      if (Object.keys(target).length) {
        merged[key] = target;
      }
    });

    ['placedMarker', 'sourceRefs', 'reviewPayload', 'annotation', 'annotationSnapshot'].forEach(
      key => {
        const currentPart = plainObject(previous[key]);
        const sourcePart = plainObject(source[key]);

        if (Object.keys(currentPart).length || Object.keys(sourcePart).length) {
          merged[key] = {
            ...currentPart,
            ...sourcePart,
          };
        }
      }
    );
  });

  return merged;
}

function getReviewLearnerAnswer(question: QuizQuestion, persistedValue: any, scoreItem: any) {
  const mergedAnswer = mergeReviewAnswerValue(persistedValue, scoreItem?.learnerResponse);

  if (question.type !== 'frameSelection') {
    return mergedAnswer;
  }

  const reviewDetails = plainObject(scoreItem?.reviewDetails);
  const learnerTarget =
    getNestedViewerTarget(reviewDetails.learnerTarget) ||
    getNestedViewerTarget(scoreItem?.learnerResponse) ||
    getNestedViewerTarget(persistedValue);

  if (!learnerTarget) {
    return mergedAnswer;
  }

  return {
    ...plainObject(mergedAnswer),
    selectedTarget: { ...plainObject(learnerTarget) },
    viewerTarget: { ...plainObject(learnerTarget) },
  };
}

function hasMeasurementComparisonReference(value: any) {
  const source = plainObject(value);
  const sourceRefs = plainObject(source.sourceRefs);
  const reviewPayload = plainObject(source.reviewPayload);
  const annotation = plainObject(
    source.annotation ||
      source.annotationSnapshot ||
      reviewPayload.annotation ||
      reviewPayload.annotationSnapshot
  );

  return !!(
    Object.keys(annotation).length > 0 ||
    cleanString(
      source.sourceAnnotationId ||
        source.annotationId ||
        source.annotationUID ||
        sourceRefs.annotationId ||
        sourceRefs.measurementId
    ) ||
    getNestedViewerTarget(source) ||
    cleanString(source.measurementType || reviewPayload.label)
  );
}

function getAnswerViewerTarget(value: any) {
  return getNestedViewerTarget(value);
}

function buildAnswerPayload(quiz: QuizDefinition, quizAnswers = {}) {
  return (quiz.questions || []).map(question => {
    const value = quizAnswers[question.questionKey];
    const structuredValue = plainObject(value);
    const viewerTarget = getAnswerViewerTarget(value);
    const sourceRefs = plainObject(structuredValue.sourceRefs);
    const reviewPayload = plainObject(structuredValue.reviewPayload);

    return {
      questionKey: question.questionKey,
      value,
      ...(viewerTarget ? { viewerTarget } : {}),
      ...(Object.keys(sourceRefs).length ? { sourceRefs } : {}),
      ...(Object.keys(reviewPayload).length ? { reviewPayload } : {}),
    };
  });
}

function hasRequiredMissing(quiz: QuizDefinition, quizAnswers = {}) {
  return (quiz.questions || []).some(question => {
    if (!question.required) {
      return false;
    }

    const value = quizAnswers[question.questionKey];

    return isAnswerEmpty(value);
  });
}

function getViewerQuizScore(scoringPayload: any) {
  return (
    scoringPayload?.officialScore?.components?.viewerQuizzes ||
    scoringPayload?.officialScore?.viewerQuizzes ||
    scoringPayload?.components?.viewerQuizzes ||
    scoringPayload?.viewerQuizzes ||
    null
  );
}

function getResponseForQuiz(responses: QuizResponse[] = [], quiz: QuizDefinition) {
  return (
    responses.find(
      response =>
        response.quizKey === quiz.quizKey &&
        Number(response.quizVersion || 1) === Number(quiz.quizVersion || 1)
    ) || null
  );
}

function getQuizScoreItem(viewerQuizScore: any, quiz: QuizDefinition) {
  const quizzes = Array.isArray(viewerQuizScore?.quizzes) ? viewerQuizScore.quizzes : [];

  return (
    quizzes.find(
      item =>
        item.quizKey === quiz.quizKey &&
        Number(item.quizVersion || 1) === Number(quiz.quizVersion || 1)
    ) || null
  );
}

function getQuizScoreQuestionItem(quizScore: any, questionKey = '') {
  const items = Array.isArray(quizScore?.items) ? quizScore.items : [];
  const key = cleanString(questionKey);

  return items.find(item => cleanString(item?.questionKey || item?.id) === key) || null;
}

function getViewerTargetSopInstanceId(value: any) {
  const target = getNestedViewerTarget(value) || plainObject(value);
  const direct = cleanString(target.sopInstanceUID || target.SOPInstanceUID);

  if (direct) {
    return direct;
  }

  const match = cleanString(target.referencedImageId).match(/\/instances\/([^/]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function getViewerTargetInstanceNumber(value: any) {
  const target = getNestedViewerTarget(value) || plainObject(value);
  const instanceNumber = Number(target.instanceNumber ?? target.InstanceNumber);

  return Number.isFinite(instanceNumber) ? instanceNumber : null;
}

function compareViewerTargetInstances(leftValue: any, rightValue: any) {
  const leftSopInstanceId = getViewerTargetSopInstanceId(leftValue);
  const rightSopInstanceId = getViewerTargetSopInstanceId(rightValue);

  if (leftSopInstanceId && rightSopInstanceId) {
    return leftSopInstanceId === rightSopInstanceId;
  }

  const leftInstanceNumber = getViewerTargetInstanceNumber(leftValue);
  const rightInstanceNumber = getViewerTargetInstanceNumber(rightValue);

  if (leftInstanceNumber !== null && rightInstanceNumber !== null) {
    return leftInstanceNumber === rightInstanceNumber;
  }

  return null;
}

function isQuizReviewItemCorrect(question: QuizQuestion, scoreItem: any) {
  const reviewDetails = {
    ...plainObject(scoreItem?.scoringDetails),
    ...plainObject(scoreItem?.reviewDetails),
  };

  if (question.type === 'measurementNumeric' && typeof reviewDetails.matched === 'boolean') {
    return reviewDetails.matched;
  }

  if (question.type === 'frameSelection' && reviewDetails.mode === 'frameSelection') {
    const frameDelta = Number(reviewDetails.frameDelta);
    const toleranceFrames = Number(reviewDetails.toleranceFrames);
    const targetInstanceMatch = compareViewerTargetInstances(
      reviewDetails.learnerTarget || scoreItem?.learnerResponse,
      reviewDetails.goldTarget || scoreItem?.correctAnswer
    );
    const instanceOk =
      typeof reviewDetails.instanceOk === 'boolean'
        ? reviewDetails.instanceOk
        : targetInstanceMatch === null
          ? true
          : targetInstanceMatch;

    if (Number.isFinite(frameDelta) && Number.isFinite(toleranceFrames)) {
      return (
        reviewDetails.seriesOk !== false &&
        instanceOk &&
        Math.abs(frameDelta) <= Math.abs(toleranceFrames)
      );
    }
  }

  if (typeof scoreItem?.matched === 'boolean') {
    return scoreItem.matched;
  }

  const pointsAwarded = Number(scoreItem?.pointsAwarded);
  const pointsPossible = Number(scoreItem?.pointsPossible);

  if (Number.isFinite(pointsAwarded) && Number.isFinite(pointsPossible) && pointsPossible > 0) {
    return pointsAwarded >= pointsPossible;
  }

  const status = cleanString(scoreItem?.status).toLowerCase();
  return status === 'met' || status === 'correct';
}

function formatReviewNumber(value: any, decimalPlaces = 0): string {
  if (value === null || typeof value === 'undefined' || value === '') {
    return 'Unavailable';
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 'Unavailable';
  }

  return decimalPlaces > 0 ? numericValue.toFixed(decimalPlaces) : String(numericValue);
}

function normalizeReviewDistanceUnit(value: any): string {
  const unit = cleanString(value);
  const normalized = unit.toLowerCase();

  if (normalized === 'world' || normalized === 'millimeter' || normalized === 'millimeters') {
    return 'mm';
  }

  if (normalized === 'imagepixels' || normalized === 'imagepixel') {
    return 'pixels';
  }

  return unit;
}

function getReviewDistanceDisplay(
  reviewDetails: Record<string, any>,
  valueKey: string,
  mmValueKey: string
) {
  const mmValue = Number(reviewDetails?.[mmValueKey]);

  if (Number.isFinite(mmValue)) {
    return {
      value: mmValue,
      unit: 'mm',
    };
  }

  return {
    value: reviewDetails?.[valueKey],
    unit: normalizeReviewDistanceUnit(reviewDetails?.radiusUnit),
  };
}

function getMeasurementReviewPoints(value: any): any[] {
  const source = plainObject(value);
  const reviewPayload = plainObject(source.reviewPayload);
  const annotation = plainObject(
    source.annotation ||
      source.annotationSnapshot ||
      reviewPayload.annotation ||
      reviewPayload.annotationSnapshot
  );
  const handlePoints = annotation?.data?.handles?.points;
  const points = Array.isArray(annotation.points)
    ? annotation.points
    : Array.isArray(handlePoints)
      ? handlePoints
      : Array.isArray(source.points)
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

function getMeasurementReviewMidpoint(value: any) {
  const directPoint = plainObject(value);
  const directX = Number(directPoint.x);
  const directY = Number(directPoint.y);

  if (Number.isFinite(directX) && Number.isFinite(directY)) {
    const directZ = Number(directPoint.z);

    return {
      x: directX,
      y: directY,
      z: Number.isFinite(directZ) ? directZ : 0,
    };
  }

  const points = getMeasurementReviewPoints(value);

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
  };
}

function getMeasurementMidpointDistance(leftValue: any, rightValue: any): number | null {
  const left = getMeasurementReviewMidpoint(leftValue);
  const right = getMeasurementReviewMidpoint(rightValue);

  if (!left || !right) {
    return null;
  }

  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function formatMeasurementReviewMidpoint(value: any): string {
  const midpoint = getMeasurementReviewMidpoint(value);

  if (!midpoint) {
    return 'Unavailable';
  }

  return `(${formatReviewNumber(midpoint.x, 2)}, ${formatReviewNumber(
    midpoint.y,
    2
  )}, ${formatReviewNumber(midpoint.z, 2)}) mm`;
}

function getMeasurementReviewLength(...values: any[]): number | null {
  for (const value of values) {
    const source = plainObject(value);
    const measurements = plainObject(source.measurements);
    const numericValue = Number(
      source.value ?? source.goldValue ?? source.length ?? measurements.value ?? measurements.length
    );

    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function formatMeasurementReviewLength(value: any, unit = ''): string {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 'Unavailable';
  }

  return `${numericValue.toFixed(2)}${unit ? ` ${unit}` : ''}`;
}

function getQuestionChoiceLabel(question: QuizQuestion, value: any) {
  const normalized = normalizeChoiceValue(value);
  const choice = getQuestionChoices(question).find(
    item => normalizeChoiceValue(item.value) === normalized
  );

  return cleanString(choice?.label || choice?.value || value);
}

function formatReviewAnswer(question: QuizQuestion, value: any): string {
  if (value === null || typeof value === 'undefined' || value === '') {
    return 'No answer';
  }

  if (question.type === 'true_false') {
    return normalizeChoiceValue(value) === 'TRUE' ? 'True' : 'False';
  }

  if (question.type === 'single_choice') {
    return getQuestionChoiceLabel(question, value) || cleanString(value);
  }

  if (question.type === 'multi_select') {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map(item => getQuestionChoiceLabel(question, item))
      .filter(Boolean)
      .join(', ');
  }

  if (question.type === 'frameSelection') {
    const target = plainObject(value?.selectedTarget || value?.viewerTarget || value);
    return targetHasNavigationIdentity(target)
      ? getViewerTargetSummary(target)
      : 'No frame selected';
  }

  if (isMarkerChoiceQuestionType(question)) {
    const markerIds = normalizeMarkerIdList(value);
    const labelsById = new Map(
      normalizeMarkerOptions(getMarkerOptions(question)).map(marker => [
        cleanString(marker.markerId || marker.markerKey || marker.value),
        cleanString(marker.label || marker.markerId || marker.markerKey || marker.value),
      ])
    );

    return (
      markerIds.map(markerId => labelsById.get(markerId) || markerId).join(', ') ||
      'No markers selected'
    );
  }

  if (isPlaceMarkerQuestionType(question)) {
    const source = plainObject(value?.point || value?.placedMarker?.point || value);
    return hasPointCoordinates(source)
      ? `${formatQuizCoordinate(source.x)}, ${formatQuizCoordinate(source.y)}`
      : 'No marker placed';
  }

  if (question.type === 'measurementNumeric') {
    const source = plainObject(value);
    const numericValue = source.value ?? value;
    const unit = cleanString(source.unit || question?.answerConfig?.unit);
    const rangeParts = [
      source.acceptedMin !== null && typeof source.acceptedMin !== 'undefined'
        ? `minimum ${source.acceptedMin}`
        : '',
      source.acceptedMax !== null && typeof source.acceptedMax !== 'undefined'
        ? `maximum ${source.acceptedMax}`
        : '',
    ].filter(Boolean);

    if (rangeParts.length) {
      return `${rangeParts.join(', ')}${unit ? ` ${unit}` : ''}`;
    }

    return `${numericValue}${unit ? ` ${unit}` : ''}`;
  }

  if (Array.isArray(value)) {
    return value
      .map(item => cleanString(item))
      .filter(Boolean)
      .join(', ');
  }

  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function formatCorrectReviewAnswer(question: QuizQuestion, value: any): string {
  if (question.type !== 'measurementNumeric') {
    return formatReviewAnswer(question, value);
  }

  const source = plainObject(value);
  const goldMeasurement = plainObject(source.goldMeasurement);
  const numericValue = source.value ?? source.goldValue ?? goldMeasurement.value;
  const unit = cleanString(source.unit || goldMeasurement.unit || question?.answerConfig?.unit);

  if (numericValue !== null && typeof numericValue !== 'undefined' && numericValue !== '') {
    return `${roundQuizNumber(numericValue, 2)}${unit ? ` ${unit}` : ''}`;
  }

  return formatReviewAnswer(question, value);
}

function getReviewAnswerTarget(question: QuizQuestion, value: any) {
  if (question.type === 'frameSelection') {
    return getNestedViewerTarget(value);
  }

  return getAnswerViewerTarget(value);
}

function getCorrectReviewTarget(question: QuizQuestion, scoreItem: any) {
  if (scoreItem?.correctAnswerVisible !== true) {
    return null;
  }

  const correctAnswerTarget = getNestedViewerTarget(scoreItem?.correctAnswer);

  if (question.type === 'frameSelection') {
    const configuredCorrectTarget = getNestedViewerTarget(
      question?.answerConfig?.goldTarget || question?.viewerTarget
    );

    if (correctAnswerTarget || configuredCorrectTarget) {
      return {
        ...plainObject(configuredCorrectTarget),
        ...plainObject(correctAnswerTarget),
      };
    }
  }

  if (isMarkerChoiceQuestionType(question)) {
    return null;
  }

  if (isPlaceMarkerQuestionType(question)) {
    if (correctAnswerTarget) {
      return correctAnswerTarget;
    }

    const goldPoint = plainObject(question?.answerConfig?.goldPoint);
    const pointTarget = getNestedViewerTarget(goldPoint);
    if (pointTarget) {
      return pointTarget;
    }
  }

  if (question.type === 'measurementNumeric') {
    const reviewDetails = plainObject(scoreItem?.reviewDetails);
    const rubricMeasurement = mergeReviewReferenceValues(
      question?.answerConfig?.goldMeasurement,
      scoreItem?.correctAnswer,
      reviewDetails.goldMeasurement,
      reviewDetails.rubricMeasurement
    );
    const rubricMeasurementTarget = getNestedViewerTarget(rubricMeasurement);

    if (rubricMeasurementTarget) {
      return rubricMeasurementTarget;
    }
  }

  return getQuestionViewerTarget(question);
}

function getMarkerReviewOverlayOptions(question: QuizQuestion, learnerAnswer: any, scoreItem: any) {
  const reviewDetails = plainObject(scoreItem?.reviewDetails);
  const selectedMarkerIds = new Set(
    normalizeMarkerIdList(reviewDetails.learnerMarkerIds, learnerAnswer)
  );
  const correctMarkerIds = new Set(
    scoreItem?.correctAnswerVisible === true
      ? normalizeMarkerIdList(
          reviewDetails.correctMarkerIds,
          scoreItem?.correctAnswer,
          getCorrectMarkerIdsFromAnswerConfig(plainObject(question?.answerConfig))
        )
      : []
  );

  return normalizeMarkerOptions(getMarkerOptions(question))
    .filter(isMarkerOptionPlaced)
    .map(marker => {
      const markerId = cleanString(marker.markerId || marker.markerKey || marker.value);
      const selected = selectedMarkerIds.has(markerId);
      const correct = correctMarkerIds.has(markerId);
      let reviewState = 'neutral';

      if (scoreItem?.correctAnswerVisible === true) {
        if (selected && correct) {
          reviewState = 'correct';
        } else if (selected) {
          reviewState = 'incorrect';
        } else if (correct) {
          reviewState = 'missed';
        }
      } else if (selected) {
        reviewState = 'learner';
      }

      return {
        ...marker,
        reviewState,
      };
    });
}

function getLearnerMarkerOverlayOptions(question: QuizQuestion, learnerAnswer: any) {
  const selectedMarkerIds = new Set(normalizeMarkerIdList(learnerAnswer));

  return normalizeMarkerOptions(getMarkerOptions(question))
    .filter(isMarkerOptionPlaced)
    .map(marker => {
      const markerId = cleanString(marker.markerId || marker.markerKey || marker.value);

      return {
        ...marker,
        reviewState: selectedMarkerIds.has(markerId) ? 'learner' : 'neutral',
      };
    });
}

function getDefinitionId(definition: any): string {
  return cleanString(definition?._id || definition?.id);
}

function getRubricId(rubric: any): string {
  return cleanString(rubric?._id || rubric?.id);
}

function getDefinitionStatus(definition: any): string {
  return cleanString(definition?.status).toLowerCase();
}

function isDraftDefinition(definition: any): boolean {
  return getDefinitionStatus(definition) === 'draft';
}

function pickAuthoringDefinition(
  definitions: QuizDefinition[] = [],
  preferredDefinitionIdOverride = ''
) {
  const context = getViewerQuizAuthoringContextFromUrl();
  const preferredDefinitionId =
    cleanString(preferredDefinitionIdOverride) || cleanString(context.preferredDefinitionId);

  if (preferredDefinitionId) {
    const explicit = definitions.find(
      definition => getDefinitionId(definition) === preferredDefinitionId
    );
    if (explicit) {
      return explicit;
    }
  }

  return (
    definitions.find(isDraftDefinition) ||
    definitions.find(definition => cleanString(definition.status).toLowerCase() === 'published') ||
    definitions[0] ||
    null
  );
}

function findRubricForDefinition(rubrics: QuizRubric[] = [], definition: QuizDefinition | null) {
  if (!definition) {
    return null;
  }

  return (
    rubrics.find(
      rubric =>
        cleanString(rubric.quizKey) === cleanString(definition.quizKey) &&
        Number(rubric.quizVersion || 1) === Number(definition.quizVersion || 1)
    ) || null
  );
}

function isViewerNativeQuestion(question: QuizQuestion): boolean {
  return (
    question.type === 'frameSelection' ||
    isMarkerChoiceQuestionType(question) ||
    isPlaceMarkerQuestionType(question) ||
    question.type === 'measurementNumeric'
  );
}

function buildViewerNativeRubricItem(question: QuizQuestion) {
  const answerConfig = plainObject(question.answerConfig);
  const viewerTarget = getQuestionViewerTarget(question);
  let correctValue: any = undefined;

  if (question.type === 'frameSelection') {
    correctValue = answerConfig.goldTarget || {};
  } else if (isMarkerChoiceQuestionType(question)) {
    correctValue = getCorrectMarkerIdsFromAnswerConfig(answerConfig);
  } else if (isPlaceMarkerQuestionType(question)) {
    correctValue = answerConfig.goldPoint || {};
  } else if (question.type === 'measurementNumeric') {
    correctValue = answerConfig.goldValue;
  }

  const item: any = {
    questionKey: question.questionKey,
    points: Number(question.points || 1),
    match: 'viewer_native',
    viewerQuestionType: normalizeMarkerQuestionType(question.type),
    correctValue,
    ...(targetHasNavigationIdentity(viewerTarget) ? { viewerTarget } : {}),
    scoringConfig: plainObject(question.scoringConfig),
    reviewConfig: plainObject(question.reviewConfig),
    feedback: cleanString(question.explanation),
  };

  if (isMarkerChoiceQuestionType(question)) {
    item.acceptedValues = Array.isArray(correctValue) ? correctValue : [];
  }

  return item;
}

function buildClassicRubricItem(question: QuizQuestion) {
  const answerConfig = plainObject(question.answerConfig);

  if (question.type === 'true_false') {
    return {
      questionKey: question.questionKey,
      points: Number(question.points || 1),
      match: 'boolean',
      correctValue:
        answerConfig.correctValue === true ||
        cleanString(answerConfig.correctValue).toLowerCase() === 'true',
      feedback: cleanString(question.explanation),
    };
  }

  if (question.type === 'multi_select') {
    return {
      questionKey: question.questionKey,
      points: Number(question.points || 1),
      match: 'set_equals',
      correctValue: Array.isArray(answerConfig.correctValue) ? answerConfig.correctValue : [],
      feedback: cleanString(question.explanation),
    };
  }

  return {
    questionKey: question.questionKey,
    points: Number(question.points || 1),
    match: 'exact',
    correctValue: answerConfig.correctValue || '',
    feedback: cleanString(question.explanation),
  };
}

function buildAuthoringRubricItems(questions: QuizQuestion[] = []) {
  return questions.map(question =>
    isViewerNativeQuestion(question)
      ? buildViewerNativeRubricItem(question)
      : buildClassicRubricItem(question)
  );
}

function normalizeMarkerOptions(markerOptions: any[] = []) {
  return (Array.isArray(markerOptions) ? markerOptions : []).map((marker, index) => {
    const markerId = cleanString(
      marker?.markerId || marker?.markerKey || marker?.value || `marker-${index + 1}`
    );
    const point = roundQuizPoint({
      ...plainObject(marker?.point),
      x: marker?.point?.x ?? marker?.x,
      y: marker?.point?.y ?? marker?.y,
      coordinateSpace: marker?.point?.coordinateSpace || marker?.coordinateSpace || 'world',
    });

    return {
      ...marker,
      markerId,
      markerKey: markerId,
      value: markerId,
      label: cleanString(marker?.label || markerId),
      point,
      coordinateSpace: cleanString(point.coordinateSpace),
    };
  });
}

function getNextMarkerId(markerOptions: any[] = []) {
  const highestLetter = normalizeMarkerOptions(markerOptions).reduce(
    (highest, marker) => {
      const id = cleanString(marker.markerId || marker.markerKey || marker.value);
      const label = cleanString(marker.label);

      const candidates = [
        id.match(/^marker-([a-z])$/i)?.[1],
        label.match(/^marker\s+([a-z])$/i)?.[1],
      ].filter(Boolean);

      candidates.forEach(letter => {
        highest = Math.max(highest, letter!.toUpperCase().charCodeAt(0));
      });

      return highest;
    },
    64 // before 'A'
  );

  const nextLetter = String.fromCharCode(Math.min(highestLetter + 1, 90));

  return `marker-${nextLetter.toLowerCase()}`;
}

function getDisplayFrameFromTarget(target: any) {
  const frameNumber = Number(target?.frameNumber ?? target?.FrameNumber);
  const frameIndex = Number(target?.frameIndex);
  const imageIndex = Number(target?.imageIndex);

  if (Number.isFinite(frameNumber) && frameNumber > 0) {
    return frameNumber;
  }
  if (Number.isFinite(frameIndex) && frameIndex >= 0) {
    return frameIndex + 1;
  }
  if (Number.isFinite(imageIndex) && imageIndex >= 0) {
    return imageIndex + 1;
  }
  return null;
}

function getDisplayInstanceFromTarget(target: any) {
  const metadata = plainObject(target?.metadata);
  const imageMetadata = plainObject(target?.imageMetadata);
  const instanceNumber = Number(
    target?.instanceNumber ??
      target?.InstanceNumber ??
      metadata.instanceNumber ??
      metadata.InstanceNumber ??
      imageMetadata.instanceNumber ??
      imageMetadata.InstanceNumber
  );
  const instanceIndex = Number(target?.instanceIndex);

  if (Number.isFinite(instanceNumber) && instanceNumber > 0) {
    return `Instance ${instanceNumber}`;
  }
  if (Number.isFinite(instanceIndex) && instanceIndex >= 0) {
    return `Instance ${instanceIndex + 1}`;
  }
  return 'Instance unavailable';
}

function getViewerTargetSummary(target: any) {
  if (!targetHasNavigationIdentity(target)) {
    return 'No target captured';
  }

  const frame = getDisplayFrameFromTarget(target);
  const instance = getDisplayInstanceFromTarget(target);

  return `${instance}${frame ? ` · Frame ${frame}` : ''}`;
}

function getQuizAuthoringReturnUrl() {
  try {
    const params = new URLSearchParams(window.location?.search || '');
    const value = cleanString(params.get('arReturnUrl'));

    if (!value) {
      return '';
    }

    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

function finishQuizAuthoring() {
  if (!window.dispatchEvent(new CustomEvent('ar:education-request-leave', {
    cancelable: true,
  }))) return;
  const returnUrl = getQuizAuthoringReturnUrl();

  if (returnUrl) {
    window.location.assign(returnUrl);
    return;
  }

  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  window.close();
}

function notifyQuizAuthoringSaved(detail = {}) {
  const message = {
    type: AR_VIEWER_QUIZ_AUTHORING_SAVED_EVENT,
    event: AR_VIEWER_QUIZ_AUTHORING_SAVED_EVENT,
    savedAt: new Date().toISOString(),
    ...detail,
  };

  try {
    window.opener?.postMessage(message, '*');
  } catch {}

  try {
    window.parent !== window && window.parent?.postMessage(message, '*');
  } catch {}

  try {
    const channel = new BroadcastChannel(AR_VIEWER_QUIZ_AUTHORING_SAVED_EVENT);
    channel.postMessage(message);
    channel.close();
  } catch {}

  try {
    window.localStorage?.setItem(AR_VIEWER_QUIZ_AUTHORING_SAVED_EVENT, JSON.stringify(message));
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent(AR_VIEWER_QUIZ_AUTHORING_SAVED_EVENT, {
        detail: message,
      })
    );
  } catch {}
}

function hasPointCoordinates(point: any): boolean {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

const QUIZ_COORDINATE_DECIMAL_PLACES = 2;

function roundQuizNumber(value: any, decimalPlaces = QUIZ_COORDINATE_DECIMAL_PLACES) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  const factor = Math.pow(10, decimalPlaces);
  return Math.round(numericValue * factor) / factor;
}

function formatQuizCoordinate(value: any) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '';
  }

  return numericValue.toFixed(QUIZ_COORDINATE_DECIMAL_PLACES);
}

function roundQuizPoint(point: any = {}) {
  const source = plainObject(point);

  return {
    ...source,
    x: roundQuizNumber(source.x),
    y: roundQuizNumber(source.y),
    ...(source.z !== null && typeof source.z !== 'undefined'
      ? { z: roundQuizNumber(source.z) }
      : {}),
  };
}

function isMarkerOptionPlaced(marker: any): boolean {
  return hasPointCoordinates(marker?.point || marker);
}

function getOverlayMarkerOptionsForQuestion(
  question: QuizQuestion,
  options: { includeGoldMarker?: boolean } = {}
) {
  const answerConfig = plainObject(question.answerConfig);
  const viewerTarget = getQuestionViewerTarget(question);
  const includeGoldMarker = options.includeGoldMarker === true;

  if (isMarkerChoiceQuestionType(question)) {
    const correctMarkerIds = new Set(getCorrectMarkerIdsFromAnswerConfig(answerConfig));

    return normalizeMarkerOptions(answerConfig.markerOptions)
      .filter(isMarkerOptionPlaced)
      .map(marker => {
        const markerId = cleanString(marker.markerId || marker.markerKey || marker.value);

        return {
          ...marker,
          reviewState: correctMarkerIds.has(markerId) ? 'correct' : 'neutral',
        };
      });
  }

  if (isPlaceMarkerQuestionType(question)) {
    if (!includeGoldMarker) {
      return [];
    }

    const goldPoint = plainObject(answerConfig.goldPoint);

    if (!hasPointCoordinates(goldPoint)) {
      return [];
    }

    return [
      {
        markerId: 'gold-marker',
        markerKey: 'gold-marker',
        value: 'gold-marker',
        label: 'Gold',
        point: goldPoint,
        coordinateSpace: goldPoint.coordinateSpace || 'world',
        viewerTarget: goldPoint.viewerTarget || viewerTarget,
        reviewState: 'gold',
      },
    ];
  }

  return [];
}

function CaseQuestionsPanel({ commandsManager, servicesManager }: CaseQuestionsPanelProps) {
  const { uiNotificationService, measurementService } = servicesManager.services;
  const authoringMode = isViewerQuizAuthoringMode();
  // The backend authorizes the launch and supplies this scoring mode. Combined
  // report assessments collect answers here but release scores in the report.
  const deferredReportScoring = !authoringMode &&
    new URLSearchParams(window.location.search)
      .get('arEducationScoringMode')?.trim().toLowerCase() === 'reportcombined';
  const [sessionStateKey] = useState(() => getViewerQuizSessionKeyFromUrl());
  const [initialSessionState] = useState(() => readViewerQuizSessionState(sessionStateKey));

  const [loading, setLoading] = useState(true);
  const [savingQuizKey, setSavingQuizKey] = useState('');
  const [quizMeasurementReview, setQuizMeasurementReview] = useState<any>(null);
  const [quizMeasurementSelectedRows, setQuizMeasurementSelectedRows] = useState<string[]>([]);
  const [quizMeasurementApplying, setQuizMeasurementApplying] = useState(false);
  const quizMeasurementResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [scoringQuizKey, setScoringQuizKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [answersByQuizKey, setAnswersByQuizKey] = useState<AnswersByQuizKey>(
    () => initialSessionState?.answersByQuizKey || {}
  );
  const [scoringPayload, setScoringPayload] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeQuestionKey, setActiveQuestionKey] = useState(
    () => initialSessionState?.activeQuestionKey || ''
  );
  // A card click can also focus its nested input, so guard guided-tool startup
  // synchronously rather than relying on a pending React state update.
  const lastActivatedQuestionRef = useRef('');
  const efCaptureInFlightRef = useRef(false);
  // Only newly captured BWT calipers need an annotation save before quiz save.
  const pendingBowelQuizMeasurementIdsRef = useRef(new Set<string>());
  const autoBowelGoldCaptureInFlightRef = useRef(new Set<string>());
  const autoCompositeGoldCaptureInFlightRef = useRef(new Set<string>());
  const lastCompositeGoldCaptureErrorRef = useRef('');
  // Serialize source-ID captures so two calipers cannot race a gold-set update.
  const autoBowelGoldCaptureQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autoBowelLearnerCaptureInFlightRef = useRef(new Set<string>());
  const autoBowelLearnerCaptureQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autoCompositeLearnerCaptureInFlightRef = useRef(new Set<string>());
  const autoCompositeLearnerCapturedSignatureRef = useRef<Record<string, string>>({});
  const pendingQuizIVCPhaseRef = useRef<null | {
    activationKey: string; slot: string; target: any; issuedAt: number;
  }>(null);
  const bowelCaptureFailureReasonRef = useRef<Record<string, string>>({});
  const [bowelCaptureErrors, setBowelCaptureErrors] = useState<Record<string, string>>({});
  // Geometry is intentionally absent from saved quiz responses. This cache
  // contains only evidence reloaded from the exact learner copy's canonical
  // MeasurementAnnotations and is never written back into a quiz answer.
  const [trustedBowelSpatialByQuestion, setTrustedBowelSpatialByQuestion] =
    useState<Record<string, Record<string, any>>>({});
  const [frameNavigationErrors, setFrameNavigationErrors] = useState<Record<string, string>>({});
  // Preserve the newest quiz answers while several labelled calipers complete
  // before React renders the preceding capture.
  const latestLearnerAnswersRef = useRef(answersByQuizKey);
  useEffect(() => { latestLearnerAnswersRef.current = answersByQuizKey; }, [answersByQuizKey]);
  const [capturingMeasurementKey, setCapturingMeasurementKey] = useState('');
  const [liveCompositeMeasurements, setLiveCompositeMeasurements] = useState<any[]>([]);
  const [liveCompositeStatus, setLiveCompositeStatus] = useState<any>({
    questionKey: '', complete: false, value: null, unit: '', message: '',
  });
  // Explicit educator/learner interpretation only. No default RAP is selected.
  const [rapSelectionsByQuestionKey, setRapSelectionsByQuestionKey] =
    useState<Record<string, string>>({});
  const [ivcPreviewByQuestionKey, setIvcPreviewByQuestionKey] =
    useState<Record<string, any>>({});
  const [capturingFrameKey, setCapturingFrameKey] = useState('');
  const [capturingPointKey, setCapturingPointKey] = useState('');
  const [authoringPayload, setAuthoringPayload] = useState<any>(null);
  const [authoringDefinition, setAuthoringDefinition] = useState<QuizDefinition | null>(null);
  const [authoringRubric, setAuthoringRubric] = useState<QuizRubric | null>(null);
  const [authoringQuestions, setAuthoringQuestions] = useState<QuizQuestion[]>(
    () => (initialSessionState?.authoringQuestions as QuizQuestion[]) || []
  );
  const authoringQuestionsRef = useRef<QuizQuestion[]>(
    (initialSessionState?.authoringQuestions as QuizQuestion[]) || []
  );
  const [authoringSaving, setAuthoringSaving] = useState(false);
  const educationSaveRequestCounter = useRef(0);
  const restoredSessionDirtyCheckedRef = useRef(false);
  const nextEducationSaveRequestId = () => String(++educationSaveRequestCounter.current);
  const [capturingAuthoringKey, setCapturingAuthoringKey] = useState('');
  const [restoringCompositeAreaKey, setRestoringCompositeAreaKey] = useState('');
  const [compositeAreaRecoveryError, setCompositeAreaRecoveryError] =
    useState<Record<string, string>>({});
  const attemptedAreaRecoveryRef = useRef<Set<string>>(new Set());
  const previousAreaRecoveryQuestionRef = useRef('');
  const [authoringMeasurementDomain, setAuthoringMeasurementDomain] = useState('');

  // Notify only on validation state transitions, never on every pointer move.
  const bowelGoldValidationStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!authoringDefinition) {
      bowelGoldValidationStatusRef.current = {};
      return;
    }
    const nextStatuses: Record<string, string> = {};
    for (const question of authoringQuestions) {
      if (!isBowelMeasurementSetQuestion(question)) continue;
      const validation = getBowelGoldValidation(question);
      const key = question.questionKey;
      nextStatuses[key] = validation.status;
      const previous = bowelGoldValidationStatusRef.current[key];
      if (validation.status === 'invalid' && previous !== 'invalid') {
        uiNotificationService.show({
          title: 'Invalid gold BWT measurements',
          message: validation.message,
          type: 'warning', duration: 5500,
        });
      } else if (validation.status === 'valid' && previous === 'invalid') {
        uiNotificationService.show({
          title: 'Gold BWT measurements valid',
          message: validation.message,
          type: 'success', duration: 3500,
        });
      }
    }
    bowelGoldValidationStatusRef.current = nextStatuses;
  }, [authoringDefinition, authoringQuestions, uiNotificationService]);

  function finishValidatedQuizAuthoring() {
    const invalidQuestion = authoringQuestionsRef.current.find(question =>
      isBowelMeasurementSetQuestion(question) &&
      getBowelGoldValidation(question).status !== 'valid'
    );
    if (invalidQuestion) {
      const validation = getBowelGoldValidation(invalidQuestion);
      uiNotificationService.show({
        title: 'Complete gold BWT measurements',
        message: validation.message,
        type: 'warning', duration: 5500,
      });
      return;
    }
    finishQuizAuthoring();
  }


  const quizzes: QuizDefinition[] = useMemo(() => {
    return Array.isArray(payload?.quizzes) ? payload.quizzes : [];
  }, [payload]);

  const responses: QuizResponse[] = useMemo(() => {
    return Array.isArray(payload?.responses) ? payload.responses : [];
  }, [payload]);

  const viewerQuizScore = useMemo(
    () => deferredReportScoring ? null : getViewerQuizScore(scoringPayload),
    [scoringPayload, deferredReportScoring]
  );

  // The highlighted question is restored from session storage on reopen.
  // A fresh card click is not required, so restore its clinical domain before
  // the next Length annotation requests a label (the /rviewer/ path is generic).
  useEffect(() => {
    if (authoringMode) {
      const questionKey = activeQuestionKey.startsWith('authoring:')
        ? activeQuestionKey.slice('authoring:'.length) : '';
      const active = authoringQuestions.find(item => item.questionKey === questionKey);
      if (active?.type === 'measurementNumeric' && authoringMeasurementDomain) {
        syncQuizMeasurementDomainToUrl(authoringMeasurementDomain, { overwrite: true });
      }
      return;
    }
    const [quizKey, questionKey] = activeQuestionKey.split(':');
    const quiz = quizzes.find(item => item.quizKey === quizKey);
    const question = quiz?.questions?.find(item => item.questionKey === questionKey);
    let domain = question?.type === 'measurementNumeric'
      ? getQuizQuestionMeasurementDomain(quiz, question, payload) : '';
    if (!domain && quizzes.length) {
      // A reopened viewer may have no saved active question. Only fall back to
      // the quiz domain when every loaded quiz agrees on the specialty.
      const domains = [...new Set(quizzes.map(item =>
        getLearnerQuizMeasurementDomain(item, payload)).filter(Boolean))];
      if (domains.length === 1) domain = domains[0];
    }
    // Clear any stale prior quiz domain when definitions disagree.
    syncQuizMeasurementDomainToUrl(domain, { overwrite: true });
  }, [activeQuestionKey, quizzes, payload, authoringMode, authoringMeasurementDomain, authoringQuestions]);

  async function refreshScoringPayload() {
    try {
      if (deferredReportScoring) {
        setScoringPayload(null);
        return null;
      }
      const nextScoringPayload = await getViewerQuizScoreForActiveStudy();
      setScoringPayload(nextScoringPayload);
      return nextScoringPayload;
    } catch {
      setScoringPayload(null);
      return null;
    }
  }

  async function refreshAuthoring({ silent = false, preferredDefinitionId = '' } = {}) {
    if (!silent) {
      setLoading(true);
    }

    setErrorMessage('');

    try {
      const nextPayload = await getViewerQuizAuthoringContent();
      const definitions = Array.isArray(nextPayload?.definitions) ? nextPayload.definitions : [];
      const rubrics = Array.isArray(nextPayload?.rubrics) ? nextPayload.rubrics : [];
      const selectedDefinition = pickAuthoringDefinition(definitions, preferredDefinitionId);
      const selectedMeasurementDomain = resolveQuizAuthoringMeasurementDomain(selectedDefinition);
      syncQuizMeasurementDomainToUrl(selectedMeasurementDomain);
      const selectedRubric = findRubricForDefinition(rubrics, selectedDefinition);
      const nextQuestions = Array.isArray(selectedDefinition?.questions)
        ? selectedDefinition.questions
        : [];

      if (nextPayload?.capabilities?.canManageQuizContent !== true) {
        throw new Error('Quiz authoring is not allowed for this account.');
      }

      const definitionId = getDefinitionId(selectedDefinition);
      const sessionState = readViewerQuizSessionState(sessionStateKey);
      // Retain unsaved edits only while the draft revision on the server is unchanged.
      // A save from another viewer/tab must not be hidden by stale in-memory questions.
      const serverUpdatedAt = String(selectedDefinition?.updatedAt || '');
      const questionsToUse =
        definitionId &&
        serverUpdatedAt &&
        sessionState?.authoringDefinitionId === definitionId &&
        sessionState?.authoringServerUpdatedAt === serverUpdatedAt &&
        Array.isArray(sessionState.authoringQuestions)
          ? (sessionState.authoringQuestions as QuizQuestion[])
          : nextQuestions;

      // Restored session edits are still unsaved until FormAPI confirms a save.
      if (!restoredSessionDirtyCheckedRef.current) {
        restoredSessionDirtyCheckedRef.current = true;
        if (authoringMode && JSON.stringify(questionsToUse) !== JSON.stringify(nextQuestions)) {
          reportEducationChange('authoring');
        }
      }
      setAuthoringPayload(nextPayload);
      setAuthoringDefinition(selectedDefinition);
      setAuthoringMeasurementDomain(selectedMeasurementDomain);
      setAuthoringRubric(selectedRubric);
      authoringQuestionsRef.current = questionsToUse;
      setAuthoringQuestions(questionsToUse);
      writeViewerQuizSessionState(sessionStateKey, {
        authoringDefinitionId: definitionId,
        authoringServerUpdatedAt: serverUpdatedAt,
        authoringQuestions: questionsToUse,
      });
    } catch (error) {
      setErrorMessage(error?.message || String(error));
      setAuthoringPayload(null);
      setAuthoringDefinition(null);
      setAuthoringMeasurementDomain('');
      setAuthoringRubric(null);
    } finally {
      setLoading(false);
    }
  }

  async function refresh({ silent = false } = {}) {
    if (authoringMode) {
      await refreshAuthoring({ silent });
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    setErrorMessage('');

    try {
      const nextPayload = await getViewerQuizzesForActiveStudy();
      const nextQuizzes = Array.isArray(nextPayload?.quizzes) ? nextPayload.quizzes : [];
      const learnerQuizIdentity = getLearnerQuizIdentity(nextQuizzes);
      const persistedAnswers = buildInitialAnswers(nextQuizzes, nextPayload.responses || []);
      const sessionState = readViewerQuizSessionState(sessionStateKey);
      const answersToUse =
        learnerQuizIdentity && sessionState?.learnerQuizIdentity === learnerQuizIdentity
          ? mergeQuizAnswers(persistedAnswers, sessionState.answersByQuizKey || {})
          : persistedAnswers;

      // The session cache preserves drafts after refresh; it is not proof of
      // server persistence. Re-arm the guard for any locally restored changes.
      if (!restoredSessionDirtyCheckedRef.current) {
        restoredSessionDirtyCheckedRef.current = true;
        nextQuizzes.forEach(quiz => {
          const quizKey = quiz.quizKey;
          if (JSON.stringify(answersToUse[quizKey] || {}) !==
              JSON.stringify(persistedAnswers[quizKey] || {})) {
            reportEducationChange(`quiz:${quizKey}`);
          }
        });
      }
      setTrustedBowelSpatialByQuestion({});
      setPayload(nextPayload);
      setAnswersByQuizKey(answersToUse);
      writeViewerQuizSessionState(sessionStateKey, {
        learnerQuizIdentity,
        answersByQuizKey: answersToUse,
      });

      await refreshScoringPayload();
    } catch (error) {
      const message = error?.message || String(error);
      setErrorMessage(message);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    writeViewerQuizSessionState(sessionStateKey, {
      answersByQuizKey,
    });
  }, [answersByQuizKey, sessionStateKey]);

  useEffect(() => {
    writeViewerQuizSessionState(sessionStateKey, {
      activeQuestionKey,
    });
  }, [activeQuestionKey, sessionStateKey]);

  useEffect(() => {
    const definitionId = getDefinitionId(authoringDefinition);

    if (!authoringMode || !definitionId) {
      return;
    }

    writeViewerQuizSessionState(sessionStateKey, {
      authoringDefinitionId: definitionId,
      authoringQuestions,
    });
  }, [authoringDefinition, authoringMode, authoringQuestions, sessionStateKey]);

  const compositeSnapshotRequestRef = useRef(0);
  async function refreshLiveCompositeMeasurements() {
    const request = ++compositeSnapshotRequestRef.current;
    try {
      const response = await runViewerCommand(commandsManager, 'getViewerMeasurementSnapshotForPanel', {});
      // Ignore an older viewport snapshot that returned after a new contour
      // completed or a user switched to another source image.
      if (request === compositeSnapshotRequestRef.current) {
        setLiveCompositeMeasurements(Array.isArray(response) ? response : []);
      }
      // Read the same clinical composite calculator used by the quiz gold
      // capture command. A drawn contour is not necessarily calibrated.
      const activeKey = activeQuestionKey;
      const selectedQuestion = authoringMode
        ? authoringQuestionsRef.current.find(item =>
            activeKey === 'authoring:' + item.questionKey
          )
        : quizzes.flatMap(quiz => quiz.questions || []).find(item =>
            activeKey.endsWith(':' + item.questionKey)
          );
      const selectedKind = cleanString(
        plainObject(selectedQuestion?.answerConfig).measurementKind
      );
      if (['rvFAC', 'raArea', 'laVolumeBiplane', 'laVolumeBiplaneDisks',
        'ivcCollapsibility'].includes(selectedKind)) {
        const status = await runViewerCommand(
          commandsManager, 'getViewerQuizCompositeStatusForActiveStudy',
          { measurementKind: selectedKind }
        );
        if (request === compositeSnapshotRequestRef.current &&
            activeKey === activeQuestionKey) {
          setLiveCompositeStatus({ ...plainObject(status), questionKey: activeKey });
        }
      } else if (request === compositeSnapshotRequestRef.current) {
        setLiveCompositeStatus({ questionKey: activeKey,
          complete: false, value: null, unit: '', message: '' });
      }
    } catch (error) {
      console.warn('[CaseQuestionsPanel] composite measurement refresh failed', error);
    }
  }

  useEffect(() => {
    let quickRefresh: number | null = null;
    let settledRefresh: number | null = null;
    const refresh = () => {
      // MeasurementService can emit updates during every contour pointer move.
      // Coalesce them to avoid repeatedly querying the viewer and rerendering.
      if (quickRefresh === null) {
        quickRefresh = window.setTimeout(() => {
          quickRefresh = null;
          void refreshLiveCompositeMeasurements();
        }, 80);
      }
      // Annotation-created/labelled events may precede the final service
      // entry. Refresh again after its updates settle.
      if (settledRefresh !== null) window.clearTimeout(settledRefresh);
      settledRefresh = window.setTimeout(() => {
        settledRefresh = null;
        void refreshLiveCompositeMeasurements();
      }, 400);
    };
    const events = measurementService?.EVENTS || {};
    const subscriptions = [
      events.MEASUREMENT_ADDED,
      events.MEASUREMENT_UPDATED,
      events.MEASUREMENT_REMOVED,
      events.MEASUREMENTS_CLEARED,
      events.RAW_MEASUREMENT_ADDED,
    ].filter(Boolean).map(eventName => measurementService.subscribe(eventName, refresh));
    const windowEvents = [
      'ar-measurements:live-measurements-updated',
      'ar-measurements:saved-annotations-updated',
      AR_QUIZ_MEASUREMENT_ADDED_EVENT,
      AR_QUIZ_MEASUREMENT_LABELLED_EVENT,
    ];
    windowEvents.forEach(name => window.addEventListener(name, refresh));
    refresh();
    return () => {
      subscriptions.forEach(subscription => subscription?.unsubscribe?.());
      windowEvents.forEach(name => window.removeEventListener(name, refresh));
      if (quickRefresh !== null) window.clearTimeout(quickRefresh);
      if (settledRefresh !== null) window.clearTimeout(settledRefresh);
      compositeSnapshotRequestRef.current++;
    };
  }, [commandsManager, measurementService, activeQuestionKey, authoringMode, quizzes]);

  useEffect(() => {
    // Switching quiz questions can change the measurement kind without
    // producing a MeasurementService event. Load its calculated status now.
    void refreshLiveCompositeMeasurements();
  }, [activeQuestionKey]);

  function getActiveCompositePhaseMeasurement(
    kind: string, slot: string, source: { annotationId?: string; target?: any } = {}
  ) {
    return findEditableCompositePhaseMeasurement(liveCompositeMeasurements, kind, slot, source);
  }

  function getCompositePhaseDisplayEvidence(
    quiz: QuizDefinition, question: QuizQuestion, slot: string
  ) {
    const config = plainObject(question.answerConfig);
    const kind = cleanString(config.measurementKind);
    const answer = authoringMode
      ? plainObject(config.goldMeasurement)
      : plainObject(answersByQuizKey?.[quiz.quizKey]?.[question.questionKey]);
    const composite = kind === 'ivcRapRvsp'
      ? plainObject(plainObject(answer.compositeResult).ivc?.compositeResult)
      : plainObject(answer.compositeResult);
    const saved = (Array.isArray(composite.components) ? composite.components : [])
      .find(part => cleanString(part?.slot) === slot);
    const configured = plainObject(config.compositeFrameTargets)[slot];
    const sourceTarget = authoringMode
      ? saved?.target || configured
      : saved?.target || (config.compositeFrameGuidanceEnabled === true ? configured : null);
    const phaseSource = { annotationId: cleanString(saved?.annotationId), target: sourceTarget };
    const live = getActiveCompositePhaseMeasurement(kind, slot, phaseSource);
    return { kind, saved, live, phaseSource };
  }

  async function deleteCompositePhaseMeasurement(
    quiz: QuizDefinition, question: QuizQuestion, slot: string,
    phaseSource: { annotationId?: string; target?: any }
  ) {
    const kind = cleanString(plainObject(question.answerConfig).measurementKind);
    if (authoringMode && (!isDraftDefinition(authoringDefinition) || authoringSaving)) return;
    const savedId = cleanString(phaseSource.annotationId);
    const latestQuestion = authoringMode
      ? authoringQuestionsRef.current.find(item => item.questionKey === question.questionKey)
      : null;
    const savedPhase = authoringMode && savedId
      ? clearSavedCompositeGoldPhase(latestQuestion, slot, savedId) : null;

    // The current viewport may contain the replacement contour, while the
    // saved gold still refers to a previous instance/frame. Never delete a
    // different same-slot live contour to make the stale gold disappear.
    const refreshed = await runViewerCommand(commandsManager, 'getViewerMeasurementSnapshotForPanel', {});
    let record = findEditableCompositePhaseMeasurement(
      Array.isArray(refreshed) ? refreshed : [], kind, slot, phaseSource
    );
    if (!record && savedPhase && targetHasNavigationIdentity(phaseSource.target)) {
      const jumped = await runViewerCommand(commandsManager, 'jumpToViewerQuizTarget', {
        viewerTarget: phaseSource.target, questionKey: question.questionKey,
      });
      if (jumped?.ok) {
        if (cleanString(jumped.viewportId)) {
          await runViewerCommand(commandsManager, 'setViewportActive', {
            viewportId: jumped.viewportId,
          });
        }
        const hydrated = await runViewerCommand(commandsManager,
          'getViewerMeasurementSnapshotForPanel', {});
        record = findEditableCompositePhaseMeasurement(
          Array.isArray(hydrated) ? hydrated : [], kind, slot, phaseSource
        );
      }
    }
    const measurementId = getCompositePhaseMeasurementId(record);
    if (!measurementId && !savedPhase) {
      uiNotificationService.show({
        title: 'Delete measurement', type: 'warning', duration: 5500,
        message: 'This phase cannot be uniquely identified. Open its source or resolve duplicate contours first.',
      });
      return;
    }

    const prompt = measurementId
      ? 'Delete ' + slot + '? The calculated quiz answer must be captured again.'
      : 'Clear the saved ' + slot + ' gold reference? Its old annotation is not loaded and will not be deleted from the viewer.';
    if (!window.confirm(prompt)) return;

    if (measurementId) {
      await runViewerCommand(commandsManager, 'removeMeasurement', { uid: measurementId });
      const after = await runViewerCommand(commandsManager, 'getViewerMeasurementSnapshotForPanel', {});
      if (!Array.isArray(after) || after.some(item =>
        getCompositePhaseMeasurementId(item) === measurementId)) {
        uiNotificationService.show({
          title: 'Delete measurement', type: 'warning', duration: 5000,
          message: 'The source measurement could not be removed. No gold answer was changed.',
        });
        return;
      }
    }

    if (authoringMode && savedPhase) {
      // Recheck the exact saved annotation at commit time; a concurrent
      // authoring edit must not be replaced by an older delete action.
      updateAuthoringQuestion(question.questionKey, current =>
        clearSavedCompositeGoldPhase(current, slot, savedId) || current
      );
    } else if (!authoringMode) {
      // A partial learner composite must never remain gradeable.
      setAnswer(quiz.quizKey, question, null);
    }

    await refreshLiveCompositeMeasurements();
    uiNotificationService.show({
      title: savedPhase ? 'Gold phase cleared' : 'Measurement deleted',
      type: 'info', duration: 4500,
      message: savedPhase
        ? slot + ' removed from saved gold. Other phases remain. Capture the replacement source if needed, then recapture the calculated result and Save Draft.'
        : slot + ' removed. Recapture the calculated result.',
    });
  }

  async function restoreAuthoringGoldAreas(question: QuizQuestion) {
    if (!authoringMode || !isDraftDefinition(authoringDefinition) ||
        authoringSaving || restoringCompositeAreaKey) return;
    const gold = plainObject(plainObject(question.answerConfig).goldMeasurement);
    const originalValue = Number(gold.value);
    const originalComponents = JSON.stringify(plainObject(gold.compositeResult).components || []);
    const kind = cleanString(plainObject(question.answerConfig).measurementKind);
    setRestoringCompositeAreaKey(question.questionKey);
    try {
      const recovered = await runViewerCommand(commandsManager,
        'recoverViewerQuizGoldAreas', {
          rubricMeasurement: gold,
          questionKey: question.questionKey,
        });
      if (recovered?.ok !== true || !recovered.derived) {
        setCompositeAreaRecoveryError(previous => ({
          ...previous,
          [question.questionKey]: cleanString(recovered?.reason) ||
            'Exact saved DICOM contour calibration is unavailable.',
        }));
        return;
      }
      const latest = authoringQuestionsRef.current.find(item =>
        item.questionKey === question.questionKey);
      const latestGold = plainObject(plainObject(latest?.answerConfig).goldMeasurement);
      if (Number(latestGold.value) !== originalValue ||
          JSON.stringify(plainObject(latestGold.compositeResult).components || []) !== originalComponents ||
          cleanString(plainObject(latest?.answerConfig).measurementKind) !== kind) {
        uiNotificationService.show({
          title: 'Gold changed while recovering areas', type: 'warning', duration: 6000,
          message: 'The saved source contours changed. Retry with the current gold measurement.',
        });
        return;
      }
      updateAuthoringQuestion(question.questionKey, current => {
        const config = plainObject(current.answerConfig);
        const prior = plainObject(config.goldMeasurement);
        return {
          ...current,
          answerConfig: {
            ...config,
            goldMeasurement: {
              ...prior,
              compositeResult: {
                ...plainObject(prior.compositeResult),
                derived: recovered.derived,
              },
            },
          },
        };
      });
      setCompositeAreaRecoveryError(previous => ({
        ...previous, [question.questionKey]: '',
      }));
      // Persist with the normal educator Save Draft; never silently publish
      // or overwrite the saved gold scalar while simply opening a question.
    } catch (error) {
      console.warn('[CaseQuestionsPanel] gold-area recovery error', error);
      setCompositeAreaRecoveryError(previous => ({
        ...previous,
        [question.questionKey]: 'Saved contour calibration could not be loaded.',
      }));
    } finally {
      setRestoringCompositeAreaKey('');
    }
  }

  // Same open-and-display behavior as other gold measurement questions.
  // A valid, saved RV/LA source is re-calibrated without educator interaction,
  // only when the legacy answer lacks per-phase physical areas.
  useEffect(() => {
    if (!authoringMode || !isDraftDefinition(authoringDefinition) ||
        authoringSaving || restoringCompositeAreaKey) return;
    const questionKey = activeQuestionKey.startsWith('authoring:')
      ? activeQuestionKey.slice('authoring:'.length) : '';
    if (previousAreaRecoveryQuestionRef.current !== questionKey) {
      attemptedAreaRecoveryRef.current.clear();
      previousAreaRecoveryQuestionRef.current = questionKey;
    }
    const question = authoringQuestions.find(item => item.questionKey === questionKey);
    if (!question || !needsSavedCalibratedGoldAreas(question)) return;
    const gold = plainObject(plainObject(question.answerConfig).goldMeasurement);
    const attemptKey = questionKey + ':' + String(gold.value) + ':' +
      JSON.stringify(plainObject(gold.compositeResult).components || []);
    if (attemptedAreaRecoveryRef.current.has(attemptKey)) return;
    const timeout = window.setTimeout(() => {
      // The authoring question and its source contours may have changed while
      // loading. Do not recover an outdated gold or navigate another question.
      const current = authoringQuestionsRef.current.find(item =>
        item.questionKey === questionKey);
      const currentGold = plainObject(plainObject(current?.answerConfig).goldMeasurement);
      const currentAttemptKey = questionKey + ':' + String(currentGold.value) + ':' +
        JSON.stringify(plainObject(currentGold.compositeResult).components || []);
      if (currentAttemptKey !== attemptKey || !needsSavedCalibratedGoldAreas(current)) return;
      attemptedAreaRecoveryRef.current.add(attemptKey);
      void restoreAuthoringGoldAreas(current);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [activeQuestionKey, authoringQuestions, authoringDefinition, authoringMode,
    authoringSaving, restoringCompositeAreaKey]);

  function renderCompositeCalculatedStatus(
    quiz: QuizDefinition, question: QuizQuestion
  ) {
    const config = plainObject(question.answerConfig);
    const kind = cleanString(config.measurementKind);
    if (!['rvFAC', 'raArea', 'laVolumeBiplane', 'laVolumeBiplaneDisks',
      'ivcCollapsibility'].includes(kind)) return null;
    const key = authoringMode ? 'authoring:' + question.questionKey
      : quiz.quizKey + ':' + question.questionKey;
    const status = liveCompositeStatus.questionKey === key
      ? plainObject(liveCompositeStatus) : {};
    const gold = authoringMode ? plainObject(config.goldMeasurement)
      : plainObject(answersByQuizKey?.[quiz.quizKey]?.[question.questionKey]);
    const hasGold = gold.value != null && cleanString(gold.value) !== '' &&
      Number.isFinite(Number(gold.value));
    const hasLive = status.complete === true && status.value != null &&
      Number.isFinite(Number(status.value));
    const sameGold = hasLive && hasGold &&
      Math.abs(Number(status.value) - Number(gold.value)) < 0.005;
    const unit = cleanString(status.unit || gold.unit || config.unit);
    const needsAreaRecovery = authoringMode && needsSavedCalibratedGoldAreas(question);
    return (
      <div className="mt-2 rounded border border-emerald-700/60 bg-emerald-950/10 px-2 py-2 text-xs">
        {hasLive ? (
          <div className="font-semibold text-emerald-200">
            {sameGold ? (authoringMode ? 'Calculated and saved gold: ' : 'Calculated and saved learner answer: ')
              : 'Calculated measurement: '}
            {Number(status.value).toFixed(2)} {unit}
          </div>
        ) : hasGold ? (
          <div className="font-semibold text-emerald-200">
            {authoringMode ? 'Saved gold: ' : 'Saved answer: '}
            {Number(gold.value).toFixed(2)} {unit}
          </div>
        ) : (
          <div className="text-amber-200">
            Calculation not ready: {cleanString(status.message) ||
              'Complete both calibrated measurements and their source references.'}
          </div>
        )}
        {hasGold && hasLive && !sameGold ? (
          <div className="mt-1 text-amber-200">
            {authoringMode ? 'Saved gold' : 'Saved answer'}: {Number(gold.value).toFixed(2)} {unit}. The live value has changed;
            review the contours and recapture before saving changes.
          </div>
        ) : null}
        {!hasGold && hasLive && authoringMode ? (
          <div className="mt-1 text-gray-300">
            Result is ready for capture; Save Draft persists it.
          </div>
        ) : null}
        {needsAreaRecovery ? (
          <div className="mt-2 text-amber-200" aria-live="polite">
            {restoringCompositeAreaKey === question.questionKey
              ? 'Loading calibrated areas from the saved DICOM contours…'
              : compositeAreaRecoveryError[question.questionKey]
                ? 'Individual area values unavailable: ' +
                  compositeAreaRecoveryError[question.questionKey]
                : 'Checking saved DICOM contour calibration…'}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCompositePhaseStatusAndDelete(
    quiz: QuizDefinition, question: QuizQuestion, slot: string, disabled: boolean
  ) {
    const { kind, saved, live, phaseSource } =
      getCompositePhaseDisplayEvidence(quiz, question, slot);
    const hasSaved = !!cleanString(saved?.annotationId);
    const statusKey = authoringMode ? 'authoring:' + question.questionKey
      : quiz.quizKey + ':' + question.questionKey;
    const phaseValues = liveCompositeStatus.questionKey === statusKey
      ? plainObject(liveCompositeStatus.phaseValues) : {};
    const goldAnswer = authoringMode
      ? plainObject(plainObject(question.answerConfig).goldMeasurement)
      : plainObject(answersByQuizKey?.[quiz.quizKey]?.[question.questionKey]);
    const phaseAnswer = kind === 'ivcRapRvsp'
      ? plainObject(plainObject(goldAnswer.compositeResult).ivc) : goldAnswer;
    const savedValue = hasSaved
      ? getSavedCompositePhaseValues(phaseAnswer,
        kind === 'ivcRapRvsp' ? 'ivcCollapsibility' : kind)[slot] : null;
    const liveArea = phaseValues[slot];
    const liveValue = live && liveArea != null && Number.isFinite(Number(liveArea)) &&
      Number(liveArea) > 0 ? Number(liveArea) : null;
    const phaseValue = liveValue ?? savedValue;
    const units = kind === 'ivcCollapsibility' || kind === 'ivcRapRvsp' ? 'mm' : 'cm²';
    const areaLabel = phaseValue != null && Number.isFinite(phaseValue)
      ? ' · ' + phaseValue.toFixed(2) + ' ' + units : '';
    return (
      <>
        <span className={live || hasSaved ? 'text-emerald-200 text-[11px]' : 'text-amber-200 text-[11px]'}>
          {live ? 'Measured' : hasSaved ? (authoringMode ? 'Gold saved' : 'Learner saved') : 'Not measured'}
          {areaLabel}
          {hasSaved ? (authoringMode ? ' · Gold source saved' : ' · Learner source saved') : ''}
        </span>
        {hasSaved && targetHasNavigationIdentity(saved?.target) ? (
          <button
            type="button"
            className="rounded border border-emerald-600 px-2 py-1 text-emerald-100"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              void (async () => {
                const answer = authoringMode
                  ? plainObject(plainObject(question.answerConfig).goldMeasurement)
                  : plainObject(answersByQuizKey?.[quiz.quizKey]?.[question.questionKey]);
                // Learner phase overlays are reconstructed ONLY from learner
                // evidence, never the educator's gold/teaching source.
                const learner = !authoringMode;
                const displayAnswer = kind === 'ivcRapRvsp'
                  ? plainObject(plainObject(answer.compositeResult).ivc)
                  : answer;
                const result = learner
                  ? await runViewerCommand(
                      commandsManager, 'showViewerQuizLearnerCompositeMeasurement', {
                        learnerMeasurement: displayAnswer,
                        viewerTarget: saved.target,
                        questionKey: question.questionKey,
                      })
                  : await runViewerCommand(
                      commandsManager, 'showViewerQuizMeasurementComparison', {
                        rubricMeasurement: displayAnswer,
                        viewerTarget: saved.target,
                        focusedCompositeSlot: slot,
                        questionKey: question.questionKey,
                      });
                if ((learner ? result?.learnerRendered : result?.rubricRendered) !== true) {
                  uiNotificationService.show({
                    title: 'Saved contour', type: 'warning', duration: 5000,
                    message: 'Saved source could not be displayed: ' +
                      cleanString(result?.reason || 'source unavailable'),
                  });
                }
              })().catch(error => console.warn(
                '[CaseQuestionsPanel] composite gold phase navigation failed', error
              ));
            }}
          >View saved</button>
        ) : null}
        <button
          type="button"
          className="rounded border border-red-600 px-2 py-1 text-red-100 disabled:opacity-40"
          disabled={disabled || (!getCompositePhaseMeasurementId(live) && !hasSaved)}
          onClick={event => {
            event.preventDefault(); event.stopPropagation();
            void deleteCompositePhaseMeasurement(quiz, question, slot, phaseSource);
          }}
        >Delete</button>
      </>
    );
  }

  function setAnswer(quizKey: string, question: QuizQuestion, value: any) {
    reportEducationChange(`quiz:${quizKey}`);
    setAnswersByQuizKey(current => ({
      ...current,
      [quizKey]: {
        ...(current[quizKey] || {}),
        [question.questionKey]: value,
      },
    }));
  }

  function toggleMultiSelectAnswer(quizKey: string, question: QuizQuestion, value: string) {
    reportEducationChange(`quiz:${quizKey}`);
    setAnswersByQuizKey(current => {
      const quizAnswers = current[quizKey] || {};
      const existing = Array.isArray(quizAnswers[question.questionKey])
        ? quizAnswers[question.questionKey]
        : [];

      const nextValue = existing.includes(value)
        ? existing.filter(item => item !== value)
        : [...existing, value];

      return {
        ...current,
        [quizKey]: {
          ...quizAnswers,
          [question.questionKey]: nextValue,
        },
      };
    });
  }

  function getPlacedAnswerMarkerOptions(value: any, reviewState = 'learner') {
    const answer = plainObject(value);
    const placedMarker = plainObject(answer.placedMarker || answer);
    const point = roundQuizPoint(plainObject(placedMarker.point || answer.point));

    if (!hasPointCoordinates(point)) {
      return [];
    }

    return [
      {
        markerId: 'learner-answer-marker',
        markerKey: 'learner-answer-marker',
        value: 'learner-answer-marker',
        label: 'Your answer',
        point,
        coordinateSpace: point.coordinateSpace || 'world',
        viewerTarget:
          placedMarker.viewerTarget || answer.viewerTarget || answer.selectedTarget || {},
        reviewState,
      },
    ];
  }

  function getGoldReviewMarkerOptions(question: QuizQuestion, scoreItem: any) {
    if (scoreItem?.correctAnswerVisible !== true || !isPlaceMarkerQuestionType(question)) {
      return [];
    }

    const reviewDetails = plainObject(scoreItem?.reviewDetails);
    const reviewGoldPoint = plainObject(reviewDetails.goldPoint);
    const correctAnswer = plainObject(scoreItem.correctAnswer);
    const correctAnswerPoint = plainObject(correctAnswer.point || correctAnswer.goldPoint);
    const configuredGoldPoint = plainObject(question?.answerConfig?.goldPoint);
    const point = roundQuizPoint(
      hasPointCoordinates(reviewGoldPoint)
        ? reviewGoldPoint
        : hasPointCoordinates(correctAnswer)
          ? correctAnswer
          : hasPointCoordinates(correctAnswerPoint)
            ? correctAnswerPoint
            : configuredGoldPoint
    );

    if (!hasPointCoordinates(point)) {
      return [];
    }

    return [
      {
        markerId: 'gold-answer-marker',
        markerKey: 'gold-answer-marker',
        value: 'gold-answer-marker',
        label: 'Correct answer',
        point,
        coordinateSpace: point.coordinateSpace || 'world',
        viewerTarget:
          getNestedViewerTarget(reviewGoldPoint) ||
          getNestedViewerTarget(correctAnswer) ||
          getNestedViewerTarget(configuredGoldPoint) ||
          getCorrectReviewTarget(question, scoreItem) ||
          {},
        reviewState: 'gold',
        toleranceRadius:
          reviewDetails.radius ?? plainObject(question?.scoringConfig).radius ?? null,
        toleranceRadiusUnit:
          cleanString(reviewDetails.radiusUnit) ||
          cleanString(plainObject(question?.scoringConfig).radiusUnit) ||
          'world',
      },
    ];
  }

  function getQuestionOverlayMarkerOptions(
    quiz: QuizDefinition,
    question: QuizQuestion,
    questionAnswer: any,
    options: { reviewMode?: 'learner' | 'comparison' } = {}
  ) {
    if (authoringMode) {
      return getOverlayMarkerOptionsForQuestion(question, {
        includeGoldMarker: true,
      });
    }

    const quizScore = viewerQuizScore ? getQuizScoreItem(viewerQuizScore, quiz) : null;
    const scoreItem = getQuizScoreQuestionItem(quizScore, question.questionKey);

    if (scoreItem && isMarkerChoiceQuestionType(question)) {
      const reviewLearnerAnswer = getReviewLearnerAnswer(question, questionAnswer, scoreItem);

      return options.reviewMode === 'comparison'
        ? getMarkerReviewOverlayOptions(question, reviewLearnerAnswer, scoreItem)
        : getLearnerMarkerOverlayOptions(question, reviewLearnerAnswer);
    }

    if (isPlaceMarkerQuestionType(question)) {
      const learnerMarkers = getPlacedAnswerMarkerOptions(questionAnswer);

      return options.reviewMode === 'comparison'
        ? [...learnerMarkers, ...getGoldReviewMarkerOptions(question, scoreItem)]
        : learnerMarkers;
    }

    return getOverlayMarkerOptionsForQuestion(question);
  }

  async function showAuthoringGoldMeasurement(question: QuizQuestion) {
    if (!authoringMode || question.type !== 'measurementNumeric') {
      return null;
    }

    const answerConfig = plainObject(question.answerConfig);
    const scoringConfig = plainObject(question.scoringConfig);
    const isBowelGoldSet = isBowelMeasurementSetQuestion(question);
    const goldMeasurement = isBowelGoldSet
      ? getBowelMeasurementSetEntries(answerConfig.goldMeasurements)[0] || null
      : plainObject(answerConfig.goldMeasurement);

    if (isBowelGoldSet ? !goldMeasurement : !hasMeasurementComparisonReference(goldMeasurement)) {
      return null;
    }

    const result = isBowelGoldSet
      ? await runViewerCommand(commandsManager, 'showViewerQuizAuthoringGoldCaliper', {
          goldMeasurements: getBowelMeasurementSetEntries(answerConfig.goldMeasurements),
          referenceRadiusMm: scoringConfig.radius,
          questionKey: question.questionKey,
        })
      : await runViewerCommand(commandsManager, 'showViewerQuizMeasurementComparison', {
          rubricMeasurement: goldMeasurement,
          viewerTarget: getNestedViewerTarget(goldMeasurement) || getQuestionViewerTarget(question),
          questionKey: question.questionKey,
          radius: scoringConfig.radius,
          radiusUnit: cleanString(scoringConfig.radiusUnit) || 'world',
        });

    if (result?.rubricRendered !== true) {
      console.warn('[CaseQuestionsPanel] authoring gold measurement was not displayed', {
        questionKey: question.questionKey,
        result,
      });
    }

    if (
      Number(result?.compositeContoursExpected) > 0 &&
      Number(result?.compositeContoursResolved) < Number(result?.compositeContoursExpected)
    ) {
      console.warn('[CaseQuestionsPanel] saved gold contours are incomplete', {
        questionKey: question.questionKey,
        expected: result.compositeContoursExpected,
        resolved: result.compositeContoursResolved,
      });
    }

    return result;
  }

  async function showLearnerBowelMeasurements(
    quiz: QuizDefinition,
    question: QuizQuestion,
    measurements: any[],
    selectedSourceAnnotationId = '',
    notifyOnFailure = false
  ) {
    const result = await runViewerCommand(commandsManager, 'showViewerQuizLearnerBwtMeasurementSet', {
      learnerMeasurements: measurements,
      selectedSourceAnnotationId,
      questionKey: question.questionKey,
    });
    const evidence = Array.isArray(result?.trustedSpatialEvidence)
      ? result.trustedSpatialEvidence : [];
    if (evidence.length) {
      const validIds = new Set(measurements.map(item => cleanString(item.sourceAnnotationId)));
      const trustedById: Record<string, any> = {};
      evidence.forEach(item => {
        const id = cleanString(item.sourceAnnotationId);
        const spatial = plainObject(item.quizSpatialEvidence);
        if (validIds.has(id) && spatial.source === 'dicom-calibrated-image-index-v1') {
          trustedById[id] = spatial;
        }
      });
      setTrustedBowelSpatialByQuestion(current => ({
        ...current,
        [`${quiz.quizKey}:${question.questionKey}`]: trustedById,
      }));
    }
    if (result?.ok === true) return true;
    console.warn('[CaseQuestionsPanel] learner BWT calipers could not be shown', {
      quizKey: quiz.quizKey, questionKey: question.questionKey,
      reason: cleanString(result?.reason) || 'navigation-failed',
    });
    if (notifyOnFailure) {
      uiNotificationService.show({
        title: 'Bowel measurements',
        message: 'The saved BWT calipers could not be displayed on their recorded image. Reopen the learner study or check that the measurements were saved.',
        type: 'warning',
        duration: 6000,
      });
    }
    return false;
  }

  async function selectQuestion(
    quiz: QuizDefinition,
    question: QuizQuestion,
    options: {
      force?: boolean;
      viewerTarget?: any;
      markerOptions?: any[];
      revealExactFrame?: boolean;
    } = {}
  ) {
    const nextActiveQuestionKey = `${quiz.quizKey}:${question.questionKey}`;
    const isNewQuestion = lastActivatedQuestionRef.current !== nextActiveQuestionKey;
    // Question cards emit both focus and click. Suppress the second call while
    // React has not committed the new active key, or it can race the initial jump.
    if (!options.force && !isNewQuestion && activeQuestionKey !== nextActiveQuestionKey) {
      return;
    }
    lastActivatedQuestionRef.current = nextActiveQuestionKey;
    if (isNewQuestion && pendingQuizIVCPhaseRef.current) {
      pendingQuizIVCPhaseRef.current = null;
      void runViewerCommand(commandsManager, 'resetViewerLengthLabelMode', {});
    }
    if (question.type === 'frameSelection') {
      setFrameNavigationErrors(current => {
        if (!current[nextActiveQuestionKey]) return current;
        const next = { ...current };
        delete next[nextActiveQuestionKey];
        return next;
      });
    }
    // Change the question binding synchronously, but start guided EF/LA
    // only after navigation has reached the question's image/viewport.
    setActiveQuestionKey(nextActiveQuestionKey);
    const measurementKind = question.type === 'measurementNumeric'
      ? cleanString(plainObject(question.answerConfig).measurementKind)
      : '';
    // The toolbar reflects the selected quiz measurement workflow even when
    // saved contours are being reviewed and no drawing should start.
    try {
      await runViewerCommand(commandsManager, 'setViewerQuizMeasurementContext', {
        measurementKind,
      });
    } catch (error) {
      console.warn('[CaseQuestionsPanel] could not highlight quiz measurement toolbar', error);
    }
    // Reopening an educator's completed composite is a review action, not
    // an instruction to start another measurement session over saved contours.
    const savedGoldComponents = authoringMode
      ? getSavedGoldCompositeNavigationComponents(question.answerConfig)
      : [];
    const hasSavedGoldComposite = savedGoldComponents.length > 0 &&
      savedGoldComponents.every(component => component.complete);
    const deferGuidedActivation = isNewQuestion &&
      isGuidedQuizCompositeKind(measurementKind) &&
      !hasSavedGoldComposite;
    const activateGuidedAfterNavigation = async () => {
      if (!deferGuidedActivation || lastActivatedQuestionRef.current !== nextActiveQuestionKey) return;
      const result = await runViewerCommand(commandsManager, 'activateViewerQuizMeasurementTool', {
        toolName: 'Length',
        measurementKind,
        questionKey: question.questionKey,
        efContourTargets: getCompleteEFContourFrameTargets(question.answerConfig),
      });
      if (result?.ok === false) {
        console.warn('[CaseQuestionsPanel] guided measurement activation failed', {
          questionKey: question.questionKey, measurementKind, result,
        });
      }
    };

    try {
      await runViewerCommand(commandsManager, 'clearViewerQuizMeasurementComparison', {});
    } catch {}

    if (question.type === 'measurementNumeric') {
      const quizMeasurementDomain = authoringMode
        ? authoringMeasurementDomain || resolveQuizAuthoringMeasurementDomain(authoringDefinition)
        : getQuizQuestionMeasurementDomain(quiz, question, payload);

      syncQuizMeasurementDomainToUrl(quizMeasurementDomain, { overwrite: true });

      // Length still activates immediately. Guided workflows are deferred
      // until the saved question target has been navigated into view.
      if (!isGuidedQuizCompositeKind(measurementKind)) {
        const activationResult = await runViewerCommand(
          commandsManager,
          'activateViewerQuizMeasurementTool',
          { toolName: 'Length', measurementKind, questionKey: question.questionKey }
        );

        if (activationResult?.ok === false) {
          console.warn('[CaseQuestionsPanel] measurement question tool activation failed', {
            questionKey: question.questionKey,
            measurementKind,
            result: activationResult,
          });
        }
      }
    } else {
      await runViewerCommand(commandsManager, 'releaseViewerQuizDrawingTool', {});
    }

    try {
    if (authoringMode && question.type === 'measurementNumeric') {
      setActiveQuestionKey(nextActiveQuestionKey);

      try {
        const authoringMeasurementResult = await showAuthoringGoldMeasurement(question);

        if (authoringMeasurementResult?.rubricRendered === true) {
          return;
        }
      } catch (error) {
        console.warn('[CaseQuestionsPanel] authoring gold measurement display failed:', error);
      }
    }

    // Session storage may restore an active-looking question on remount.
    // Its first real selection still needs navigation and tool activation.
    if (!options.force && !isNewQuestion && activeQuestionKey === nextActiveQuestionKey) {
      return;
    }

    setActiveQuestionKey(nextActiveQuestionKey);

    const questionAnswer = answersByQuizKey?.[quiz.quizKey]?.[question.questionKey];
    const quizScore = viewerQuizScore ? getQuizScoreItem(viewerQuizScore, quiz) : null;
    const scoreItem = getQuizScoreQuestionItem(quizScore, question.questionKey);
    const reviewQuestionAnswer = scoreItem
      ? getReviewLearnerAnswer(question, questionAnswer, scoreItem)
      : questionAnswer;
    const reviewDetails = plainObject(scoreItem?.reviewDetails);
    // A saved draft has a learner measurement answer before any scoring result.
    // Do not gate viewport annotation restoration on scoreItem: that hides all
    // saved-but-unscored measurement overlays when reopening a learner case.
    const learnerMeasurement =
      question.type === 'measurementNumeric'
        ? mergeReviewReferenceValues(
            questionAnswer,
            scoreItem?.learnerResponse,
            reviewDetails.learnerMeasurement
          )
        : {};
    const hasViewerTargetOverride = Object.prototype.hasOwnProperty.call(options, 'viewerTarget');
    const guidedEFFrameTargets = !authoringMode && measurementKind === 'lvSimpsonEF'
      ? getCompleteEFContourFrameTargets(question.answerConfig)
      : null;
    const openingGuidedEF = !!guidedEFFrameTargets && !hasViewerTargetOverride;
    const learnerFrameTarget =
      question.type === 'frameSelection'
        ? getNestedViewerTarget(reviewQuestionAnswer) ||
          getNestedViewerTarget(questionAnswer) ||
          getNestedViewerTarget(scoreItem?.learnerResponse)
        : null;
    const configuredFrameTarget =
      question.type === 'frameSelection'
        ? getQuestionViewerTarget(question)
        : null;
    if (question.type === 'frameSelection' && !authoringMode) {
      const mode = cleanString(plainObject(question.answerConfig).frameSelectionMode) || 'legacy';
      // Safe diagnostics only: no DICOM identifiers, gold frame or answer
      // geometry are logged. If the active version lacks frame_only, the
      // published quiz must be reactivated with that configuration.
      console.info('[CaseQuestionsPanel] frame-selection configuration', {
        quizKey: quiz.quizKey,
        quizVersion: quiz.quizVersion,
        questionKey: question.questionKey,
        mode,
        safeInstanceHintAvailable: !!configuredFrameTarget,
      });
    }
    let resolvedViewerTarget;

    if (hasViewerTargetOverride) {
      resolvedViewerTarget = options.viewerTarget;
    } else if (question.type === 'frameSelection' && !authoringMode) {
      resolvedViewerTarget = shouldGuideFrameSelectionToInstance(question)
        ? configuredFrameTarget
        : null;
    } else {
      resolvedViewerTarget =
        learnerFrameTarget ||
        (scoreItem
          ? getReviewAnswerTarget(question, reviewQuestionAnswer) ||
            getCorrectReviewTarget(question, scoreItem) ||
            getQuestionViewerTarget(question)
          : getReviewAnswerTarget(question, questionAnswer) || getQuestionViewerTarget(question));
    }
    // Saved/scored EF responses may hold the last recorded contour frame.
    // Always open the first authored frame for a guided EF question.
    resolvedViewerTarget = getInitialGuidedEFQuestionTarget({
      questionType: question.type,
      measurementKind,
      authoredFirstFrame: guidedEFFrameTargets?.A4C_ED,
      existingTarget: resolvedViewerTarget,
      hasTargetOverride: hasViewerTargetOverride,
    });
    const viewerTarget = getQuestionSelectionViewerTarget(
      question,
      resolvedViewerTarget,
      authoringMode || options.revealExactFrame === true
    );
    const overlayMarkers = Array.isArray(options.markerOptions)
      ? options.markerOptions
      : getQuestionOverlayMarkerOptions(quiz, question, reviewQuestionAnswer, {
          reviewMode: 'learner',
        });

    // The learner's composite quiz answer contains multiple independently
    // framed annotations. A single showViewerQuizLearnerMeasurement call
    // restores only one and hides the saved individual phase contours.
    // Rebuild *all* of the learner's saved phase sources before the generic
    // single-measurement path; never fetch/overlay educator gold.
    const learnerCompositeKind = !authoringMode ? measurementKind : '';
    const learnerComposite = learnerCompositeKind === 'ivcRapRvsp'
      ? plainObject(plainObject(questionAnswer).compositeResult).ivc
      : questionAnswer;
    const learnerComponents = getLearnerCompositeSourceComponents(
      learnerComposite,
      learnerCompositeKind === 'ivcRapRvsp' ? 'ivcCollapsibility' : learnerCompositeKind
    );
    if (learnerComponents.length === 2) {
      try {
        const firstSource = learnerComponents[0].target;
        const restored = await runViewerCommand(
          commandsManager, 'showViewerQuizLearnerCompositeMeasurement', {
            learnerMeasurement: learnerComposite,
            viewerTarget: firstSource,
            questionKey: question.questionKey,
          }
        );
        if (restored?.learnerRendered === true &&
            restored?.restoredCount === learnerComponents.length) {
          return;
        }
        console.warn('[CaseQuestionsPanel] saved learner composite restoration incomplete', {
          questionKey: question.questionKey,
          restoredCount: restored?.restoredCount || 0,
          expectedCount: learnerComponents.length,
          reason: restored?.reason || 'unknown',
        });
      } catch (error) {
        console.warn('[CaseQuestionsPanel] learner composite restore failed', {
          questionKey: question.questionKey, error,
        });
      }
    }

    // Multi-BWT answers store an array of learner calipers, not the single
    // top-level annotation reference expected by the generic review path.
    // Restore every learner-owned Length overlay, including unscored drafts.
    const savedBowelMeasurements = !authoringMode && isBowelMeasurementSetQuestion(question)
      ? getBowelMeasurementSetEntries(plainObject(questionAnswer).measurements) : [];
    if (savedBowelMeasurements.length > 0) {
      try {
        if (await showLearnerBowelMeasurements(quiz, question, savedBowelMeasurements)) {
          return;
        }
      } catch (error) {
        console.warn('[CaseQuestionsPanel] learner BWT set restoration failed', {
          questionKey: question.questionKey, error,
        });
      }
    }

    if (
      question.type === 'measurementNumeric' &&
      hasMeasurementComparisonReference(learnerMeasurement) &&
      !openingGuidedEF
    ) {
      try {
        const measurementResult = await runViewerCommand(
          commandsManager,
          'showViewerQuizLearnerMeasurement',
          {
            learnerMeasurement,
            viewerTarget:
              viewerTarget ||
              getReviewAnswerTarget(question, learnerMeasurement) ||
              getQuestionViewerTarget(question),
            questionKey: question.questionKey,
          }
        );

        if (measurementResult?.ok === true) {
          return;
        }

        console.warn('[CaseQuestionsPanel] learner measurement was not displayed', {
          questionKey: question.questionKey,
          result: measurementResult,
        });
      } catch (error) {
        console.warn('[CaseQuestionsPanel] learner measurement display failed:', error);
      }
    }

    if (!viewerTarget) {
      if (question.type === 'frameSelection' && !authoringMode &&
          shouldGuideFrameSelectionToInstance(question)) {
        const message = 'This quiz version has no assigned instance to open. Ask the educator to verify the gold target and activate the updated quiz version.';
        console.warn('[CaseQuestionsPanel] guided frame question missing learner navigation hint', {
          quizKey: quiz.quizKey,
          quizVersion: quiz.quizVersion,
          questionKey: question.questionKey,
          frameSelectionMode: plainObject(question.answerConfig).frameSelectionMode,
        });
        setFrameNavigationErrors(current => ({ ...current, [nextActiveQuestionKey]: message }));
      }
      if (overlayMarkers.length) {
        await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
          viewerTarget: null,
          markerOptions: overlayMarkers,
          questionKey: question.questionKey,
        });
      } else {
        await runViewerCommand(commandsManager, 'clearViewerQuizMarkerOptions', {});
      }
      return;
    }

    try {
      const result = await runViewerCommand(commandsManager, 'jumpToViewerQuizTarget', {
        viewerTarget,
        questionKey: question.questionKey,
      });

      if (question.type === 'frameSelection' && !authoringMode &&
          shouldGuideFrameSelectionToInstance(question) && result?.ok !== true) {
        const message = 'The viewer could not open the assigned instance. Select the question again; if the problem persists, contact the educator.';
        setFrameNavigationErrors(current => ({ ...current, [nextActiveQuestionKey]: message }));
      }
      if (result && result.ok === false && result.reason !== 'empty-target') {
        console.warn('[CaseQuestionsPanel] viewer quiz navigation did not complete', {
          questionKey: question.questionKey,
          reason: result.reason,
          source: result.source,
          frameSelectionMode: plainObject(question.answerConfig).frameSelectionMode,
        });
      }

      if (overlayMarkers.length) {
        await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
          viewerTarget: null,
          viewportId: result?.viewportId || '',
          markerOptions: overlayMarkers,
          questionKey: question.questionKey,
        });
      } else {
        await runViewerCommand(commandsManager, 'clearViewerQuizMarkerOptions', {});
      }
    } catch (error) {
      console.warn('[CaseQuestionsPanel] viewer quiz navigation failed:', error);
      if (question.type === 'frameSelection' && !authoringMode &&
          shouldGuideFrameSelectionToInstance(question)) {
        setFrameNavigationErrors(current => ({
          ...current,
          [nextActiveQuestionKey]: 'The assigned instance could not be opened. Please retry or contact the educator.',
        }));
      }
    }
    } finally {
      await activateGuidedAfterNavigation();
    }
  }

  async function captureCurrentFrameAnswer(quiz: QuizDefinition, question: QuizQuestion) {
    const captureKey = `${quiz.quizKey}:${question.questionKey}`;

    setActiveQuestionKey(captureKey);
    setCapturingFrameKey(captureKey);

    try {
      const result = await runViewerCommand(commandsManager, 'getCurrentViewerQuizFrameAnswer', {
        question,
      });

      if (!result?.ok || !result?.answer?.selectedTarget) {
        uiNotificationService.show({
          title: 'Case Questions',
          message: `Could not capture current frame: ${result?.reason || 'unknown error'}`,
          type: 'warning',
          duration: 4500,
        });
        return;
      }

      const currentAnswer = answersByQuizKey[quiz.quizKey]?.[question.questionKey];

      setAnswer(quiz.quizKey, question, setObjectAnswerPart(currentAnswer, result.answer));

      uiNotificationService.show({
        title: 'Case Questions',
        message: `Frame captured: ${getViewerTargetSummary(result.answer.selectedTarget)}`,
        type: 'success',
        duration: 2500,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Case Questions',
        message: `Frame capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingFrameKey('');
    }
  }

  async function capturePlacedMarkerAnswer(quiz: QuizDefinition, question: QuizQuestion) {
    const captureKey = `${quiz.quizKey}:${question.questionKey}`;

    setActiveQuestionKey(captureKey);
    setCapturingPointKey(captureKey);

    try {
      uiNotificationService.show({
        title: 'Case Questions',
        message: 'Click the image to place your answer marker.',
        type: 'info',
        duration: 3000,
      });

      const result = await runViewerCommand(commandsManager, 'captureViewerQuizPointAnswer', {
        question,
      });

      if (!result?.ok || !result?.answer?.point) {
        uiNotificationService.show({
          title: 'Case Questions',
          message: `Could not place marker: ${result?.reason || 'unknown error'}`,
          type: 'warning',
          duration: 4500,
        });
        return;
      }

      const currentAnswer = answersByQuizKey[quiz.quizKey]?.[question.questionKey];
      const nextAnswer = setObjectAnswerPart(currentAnswer, {
        ...result.answer,
        placedMarker: result.answer,
      });

      setAnswer(quiz.quizKey, question, nextAnswer);

      await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
        viewerTarget:
          result.answer.viewerTarget ||
          result.answer.selectedTarget ||
          getQuestionViewerTarget(question),
        markerOptions: getPlacedAnswerMarkerOptions(nextAnswer),
        questionKey: question.questionKey,
      });

      uiNotificationService.show({
        title: 'Case Questions',
        message: 'Answer marker placed.',
        type: 'success',
        duration: 2500,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Case Questions',
        message: `Marker placement failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingPointKey('');
    }
  }

  /**
   * A linked RVSP result must use the TR Vmax answer already recorded earlier
   * in this exact quiz. Learner capture never reads an educator's gold TR value.
   */
  async function captureQuizMeasurementResult(
    question: QuizQuestion,
    { quiz = null, measurementId = '' }: { quiz?: QuizDefinition | null; measurementId?: string } = {}
  ) {
    const config = plainObject(question.answerConfig);
    const linkedRVSP = cleanString(config.measurementKind) === 'ivcRapRvsp';
    const captureQuestion = linkedRVSP
      ? { ...question, answerConfig: { ...config, measurementKind: 'ivcCollapsibility', unit: '%' } }
      : question;
    const result = await runViewerCommand(commandsManager, 'getSelectedViewerMeasurementQuizAnswer', {
      question: captureQuestion,
      measurementType: cleanString(config.measurementType),
      unit: linkedRVSP ? '%' : cleanString(config.unit),
      measurementId: cleanString(measurementId),
    });
    if (!linkedRVSP || !result?.ok || !result?.answer) return result;

    const quizQuestions = quiz?.questions || authoringQuestionsRef.current;
    const currentIndex = quizQuestions.findIndex(entry => entry.questionKey === question.questionKey);
    const priorQuestion = currentIndex > 0
      ? quizQuestions.slice(0, currentIndex).reverse().find(entry =>
          entry.type === 'measurementNumeric' &&
          cleanString(plainObject(entry.answerConfig).measurementKind) === 'trVmax'
        )
      : null;
    const trAnswer = priorQuestion
      ? quiz
        ? answersByQuizKey?.[quiz.quizKey]?.[priorQuestion.questionKey]
        : plainObject(priorQuestion.answerConfig).goldMeasurement
      : null;
    const selectionKey = quiz
      ? `${quiz.quizKey}:${question.questionKey}`
      : `authoring:${question.questionKey}`;
    const savedComposite = quiz
      ? plainObject(plainObject(answersByQuizKey?.[quiz.quizKey]?.[question.questionKey]).compositeResult)
      : plainObject(plainObject(config.goldMeasurement).compositeResult);
    const reviewedIVC = ivcPreviewByQuestionKey[selectionKey] || savedComposite.ivc;
    if (!isIVCReviewCurrent(reviewedIVC, result.answer)) {
      return {
        ok: false,
        reason: 'ivc-review-invalidated: review the latest expiration/inspiration measurements and collapsibility before accepting RAP/RVSP',
      };
    }

    const priorManuallySelectedRAP = [3, 8, 15].includes(Number(savedComposite.rapMMHG))
      ? String(savedComposite.rapMMHG)
      : '';
    const calculation = composeIVCRapRVSP({
      ivcAnswer: result.answer,
      rapMMHG: rapSelectionsByQuestionKey[selectionKey] || priorManuallySelectedRAP,
      trVmaxAnswer: trAnswer,
      trVmaxQuestionKey: priorQuestion?.questionKey || '',
    });
    if (calculation.status !== 'complete') {
      return { ok: false, reason: calculation.reason };
    }
    return {
      ...result,
      answer: {
        ...result.answer,
        ...calculation,
        viewerTarget: result.answer.viewerTarget,
        sourceRefs: result.answer.sourceRefs,
        reviewPayload: {
          ...plainObject(result.answer.reviewPayload),
          label: 'IVC / RAP / RVSP',
          toolName: 'viewer-composite-measurement',
          components: result.answer.compositeResult?.components,
        },
      },
    };
  }

  async function captureSelectedMeasurementAnswer(
    quiz: QuizDefinition,
    question: QuizQuestion,
    options: { measurementId?: string; silent?: boolean; verifyCompositeStatus?: boolean } = {}
  ) {
    const captureKey = `${quiz.quizKey}:${question.questionKey}`;

    setCapturingMeasurementKey(captureKey);

    try {
      const result = await captureQuizMeasurementResult(question, {
        quiz,
        measurementId: cleanString(options.measurementId),
      });

      if (!result?.ok || !result?.answer) {
        const reason = cleanString(result?.reason || 'No selected measurement found.');
        if (isBowelMeasurementSetQuestion(question)) {
          bowelCaptureFailureReasonRef.current[captureKey] = reason;
        }

        if (!options.silent) {
          uiNotificationService.show({
            title: 'Case Questions',
            message:
              reason === 'no-selected-measurement'
                ? 'Select the measurement annotation in the viewport first, then use it as the answer.'
                : `Could not use selected measurement: ${reason}`,
            type: 'warning',
            duration: 4500,
          });
        }

        return false;
      }

      // Validate after async capture against the current authoritative physical
      // calculation and exact source annotation IDs, not a stale UI status.
      if (options.verifyCompositeStatus) {
        const kind = cleanString(plainObject(question.answerConfig).measurementKind);
        const verified = await runViewerCommand(commandsManager,
          'getViewerQuizCompositeStatusForActiveStudy', { measurementKind: kind });
        if (!isLearnerCompositeCaptureCurrent(result.answer, verified, kind)) {
          return false;
        }
      }

      const currentAnswer = latestLearnerAnswersRef.current[quiz.quizKey]?.[question.questionKey];
      if (isBowelMeasurementSetQuestion(question)) {
        const currentEntries = getBowelMeasurementSetEntries(plainObject(currentAnswer).measurements);
        const appended = appendBowelMeasurementSetAnswer(question, currentEntries, result.answer);
        if (!appended.ok) {
          bowelCaptureFailureReasonRef.current[captureKey] =
            cleanString(appended.reason || 'caliper-validation-failed');
          if (!options.silent) uiNotificationService.show({
            title: 'Bowel measurement set',
            message: appended.reason || 'Cannot add measurement.',
            type: 'warning', duration: 4500,
          });
          return false;
        }
        const nextAnswer = { measurements: appended.entries };
        latestLearnerAnswersRef.current = {
          ...latestLearnerAnswersRef.current,
          [quiz.quizKey]: {
            ...(latestLearnerAnswersRef.current[quiz.quizKey] || {}),
            [question.questionKey]: nextAnswer,
          },
        };
        setAnswer(quiz.quizKey, question, nextAnswer);
        pendingBowelQuizMeasurementIdsRef.current.add(String(result.answer.sourceAnnotationId));
        delete bowelCaptureFailureReasonRef.current[captureKey];
        setBowelCaptureErrors(current => {
          if (!current[captureKey]) return current;
          const next = { ...current };
          delete next[captureKey];
          return next;
        });
        if (!options.silent) uiNotificationService.show({
          title: 'Bowel measurement set',
          message: `Captured ${appended.entries?.length} / ${question.answerConfig?.measurementSet?.requiredCount} measurements.`,
          type: 'success', duration: 3000,
        });
        return true;
      }

      if (cleanString(plainObject(question.answerConfig).measurementKind) === 'ivcCollapsibility') {
        const previouslyLinked = plainObject(plainObject(currentAnswer).compositeResult).rapRvsp;
        if (previouslyLinked?.ivc &&
            !isIVCReviewCurrent(previouslyLinked.ivc, result.answer)) {
          // Edited or replaced calipers invalidate an earlier RAP/RVSP
          // interpretation. Require a fresh explicit RAP choice.
          setRapSelectionsByQuestionKey(current => ({
            ...current, [captureKey]: '',
          }));
        }
      }
      setAnswer(quiz.quizKey, question, setObjectAnswerPart(currentAnswer, result.answer));

      if (!options.silent) {
        uiNotificationService.show({
          title: 'Case Questions',
          message: `Measurement captured: ${result.answer.value} ${result.answer.unit || ''}`,
          type: 'success',
          duration: 3000,
        });
      }
      return true;
    } catch (error) {
      if (isBowelMeasurementSetQuestion(question)) {
        bowelCaptureFailureReasonRef.current[captureKey] =
          cleanString(error?.message || error);
      }
      if (!options.silent) uiNotificationService.show({
        title: 'Case Questions',
        message: `Measurement capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
      return false;
    } finally {
      setCapturingMeasurementKey('');
    }
  }

  useEffect(() => {
    if (authoringMode || !activeQuestionKey ||
        liveCompositeStatus.questionKey !== activeQuestionKey ||
        liveCompositeStatus.complete !== true) return;
    const [quizKey, questionKey] = activeQuestionKey.split(':');
    const quiz = quizzes.find(entry => entry.quizKey === quizKey);
    const question = quiz?.questions?.find(entry => entry.questionKey === questionKey);
    if (!quiz || !question || question.type !== 'measurementNumeric' ||
        getQuizScoreItem(viewerQuizScore, quiz)) return;
    const captureKey = `${quizKey}:${questionKey}`;
    const signature = getLearnerCompositeAutoCaptureSignature({
      question, liveMeasurements: liveCompositeMeasurements,
      status: liveCompositeStatus,
      savedAnswer: latestLearnerAnswersRef.current[quizKey]?.[questionKey],
    });
    if (!signature ||
        autoCompositeLearnerCapturedSignatureRef.current[captureKey] === signature ||
        autoCompositeLearnerCaptureInFlightRef.current.has(captureKey)) return;

    // Cornerstone sends provisional updates while contour drawing finishes.
    // Capture a settled, validated complete composite from the authoritative
    // viewer command; never reuse a typed scalar or educator gold result.
    const timer = window.setTimeout(() => {
      if (lastActivatedQuestionRef.current &&
          lastActivatedQuestionRef.current !== captureKey) return;
      if (autoCompositeLearnerCaptureInFlightRef.current.has(captureKey)) return;
      autoCompositeLearnerCaptureInFlightRef.current.add(captureKey);
      void (async () => {
        try {
          if (await captureSelectedMeasurementAnswer(quiz, question, {
            silent: true, verifyCompositeStatus: true,
          })) {
            autoCompositeLearnerCapturedSignatureRef.current[captureKey] = signature;
          }
        } finally {
          autoCompositeLearnerCaptureInFlightRef.current.delete(captureKey);
        }
      })();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeQuestionKey, authoringMode, liveCompositeStatus,
    liveCompositeMeasurements, quizzes, viewerQuizScore]);

  useEffect(() => {
    function handleQuizMeasurementAdded(event: Event) {
      const detail = (event as CustomEvent)?.detail || {};
      const measurementId = cleanString(detail.measurementId);
      const labelCompleted = event.type === AR_QUIZ_MEASUREMENT_LABELLED_EVENT;

      if (!measurementId || !activeQuestionKey) {
        return;
      }

      if (authoringMode) {
        const authoringPrefix = 'authoring:';

        if (!activeQuestionKey.startsWith(authoringPrefix)) {
          return;
        }

        const questionKey = activeQuestionKey.slice(authoringPrefix.length);
        const question = authoringQuestionsRef.current.find(
          item => item.questionKey === questionKey
        );

        if (!question || question.type !== 'measurementNumeric') {
          return;
        }

        // Composite results require several contours; the explicit result
        // action captures the finished calculation, not intermediate drawings.
        const measurementKind = cleanString(plainObject(question.answerConfig).measurementKind);
        if (isBowelMeasurementSetQuestion(question)) {
          // Auto-bind the completed annotation rather than requiring the educator
          // to click Add. Annotation-created may precede label/measurement state:
          // retry silently, by the exact source ID, without selecting another
          // annotation or overwriting a previously captured gold entry.
          if (authoringSaving || !isDraftDefinition(authoringDefinition)) return;
          const captureId = `${questionKey}:${measurementId}`;
          if (autoBowelGoldCaptureInFlightRef.current.has(captureId)) return;
          autoBowelGoldCaptureInFlightRef.current.add(captureId);
          const captureQueuedCaliper = async () => {
            try {
              for (const delayMs of [250, 750, 1600, 3000]) {
                await new Promise(resolve => window.setTimeout(resolve, delayMs));
                if (lastActivatedQuestionRef.current !== `authoring:${questionKey}`) return;
                const latest = authoringQuestionsRef.current.find(item => item.questionKey === questionKey);
                if (!latest || !isBowelMeasurementSetQuestion(latest)) return;
                const previous = getBowelMeasurementSetEntries(
                  plainObject(latest.answerConfig).goldMeasurements
                );
                if (previous.some(entry => cleanString(entry.sourceAnnotationId) === measurementId)) return;
                if (previous.length >= Number(
                  plainObject(plainObject(latest.answerConfig).measurementSet).requiredCount || 2
                )) return;
                const captured = await captureAuthoringMeasurement(latest, {
                  measurementId, silent: true,
                });
                if (captured === true) return;
              }
            } finally {
              autoBowelGoldCaptureInFlightRef.current.delete(captureId);
            }
          };
          autoBowelGoldCaptureQueueRef.current = autoBowelGoldCaptureQueueRef.current
            .then(captureQueuedCaliper, captureQueuedCaliper);
          return;
        }
        if (labelCompleted) return;
        if (isGuidedQuizCompositeKind(measurementKind)) {
          // Never bind an incomplete contour/trace during annotation-created.
          // The educator explicitly accepts the completed derived result.
          return;
        }

        void captureAuthoringMeasurement(question, {
          measurementId,
          silent: true,
        });
        return;
      }

      const [quizKey, questionKey] = activeQuestionKey.split(':');
      const quiz = payload?.quizzes?.find(item => item.quizKey === quizKey);
      const question = quiz?.questions?.find(item => item.questionKey === questionKey);

      if (!quiz || !question || question.type !== 'measurementNumeric') {
        return;
      }
      // Only the active learner IVC phase button may assign a Length label.
      const pendingPhase = pendingQuizIVCPhaseRef.current;
      if (pendingPhase &&
          pendingPhase.activationKey === `${quizKey}:${questionKey}` &&
          Date.now() - pendingPhase.issuedAt < 60000 &&
          !labelCompleted) {
        void (async () => {
          for (const delayMs of [80, 280, 750]) {
            await new Promise(resolve => window.setTimeout(resolve, delayMs));
            if (pendingQuizIVCPhaseRef.current !== pendingPhase ||
                lastActivatedQuestionRef.current !== pendingPhase.activationKey) return;
            const labeled = await runViewerCommand(
              commandsManager, 'setViewerQuizIVCPhaseLabel', {
                measurementId, slot: pendingPhase.slot,
                expectedTarget: pendingPhase.target,
              }
            );
            if (labeled?.ok) {
              pendingQuizIVCPhaseRef.current = null;
              return;
            }
            if (labeled?.reason === 'already-labelled-differently' ||
                labeled?.reason === 'ivc-source-frame-mismatch') break;
          }
          if (pendingQuizIVCPhaseRef.current === pendingPhase) {
            pendingQuizIVCPhaseRef.current = null;
            await runViewerCommand(commandsManager, 'resetViewerLengthLabelMode', {});
            uiNotificationService.show({
              title: 'IVC phase label', type: 'warning', duration: 5000,
              message: 'The new caliper could not be bound to the selected IVC phase. Verify its image frame.',
            });
          }
        })();
        return;
      }
      if (isBowelMeasurementSetQuestion(question)) {
        // Bind the completed, labelled caliper by exact annotation ID.
        // Serialize captures to preserve both calipers in rapid succession.
        const activationKey = `${quizKey}:${questionKey}`;
        const captureId = `${activationKey}:${measurementId}`;
        if (autoBowelLearnerCaptureInFlightRef.current.has(captureId)) return;
        autoBowelLearnerCaptureInFlightRef.current.add(captureId);
        const captureQueuedCaliper = async () => {
          try {
            for (const delayMs of [100, 350, 850, 1800]) {
              await new Promise(resolve => window.setTimeout(resolve, delayMs));
              // A reopened quiz can restore its highlighted active question
              // without a fresh card click. The ref is then empty, but the
              // persisted activeQuestionKey is still a valid learner binding.
              const lastActivated = lastActivatedQuestionRef.current;
              if (lastActivated
                ? lastActivated !== activationKey
                : activeQuestionKey !== activationKey) return;
              const currentEntries = getBowelMeasurementSetEntries(
                plainObject(latestLearnerAnswersRef.current[quizKey]?.[questionKey]).measurements
              );
              if (currentEntries.some(entry => cleanString(entry.sourceAnnotationId) === measurementId)) return;
              const captured = await captureSelectedMeasurementAnswer(quiz, question, {
                measurementId, silent: true,
              });
              if (captured === true) return;
            }
            const lastActivated = lastActivatedQuestionRef.current;
            if (lastActivated
              ? lastActivated !== activationKey
              : activeQuestionKey !== activationKey) return;
            const reason = bowelCaptureFailureReasonRef.current[activationKey] || 'measurement-not-ready';
            console.warn('[CaseQuestionsPanel] learner BWT caliper not captured', {
              quizKey, questionKey, measurementId, reason,
            });
            const message = getLearnerBwtCaptureFailureMessage(reason);
            setBowelCaptureErrors(current => ({
              ...current,
              [activationKey]: message,
            }));
            uiNotificationService.show({
              title: 'Bowel measurement set',
              message,
              type: 'warning', duration: 5500,
            });
          } finally {
            autoBowelLearnerCaptureInFlightRef.current.delete(captureId);
          }
        };
        autoBowelLearnerCaptureQueueRef.current =
          autoBowelLearnerCaptureQueueRef.current.then(captureQueuedCaliper, captureQueuedCaliper);
        return;
      }
      if (labelCompleted || isGuidedQuizCompositeKind(
        cleanString(plainObject(question.answerConfig).measurementKind)
      )) {
        // Composite calculations are captured only when complete.
        return;
      }

      void captureSelectedMeasurementAnswer(quiz, question, {
        measurementId,
        silent: true,
      });
    }

    window.addEventListener(AR_QUIZ_MEASUREMENT_ADDED_EVENT, handleQuizMeasurementAdded);
    window.addEventListener(AR_QUIZ_MEASUREMENT_LABELLED_EVENT, handleQuizMeasurementAdded);

    return () => {
      window.removeEventListener(AR_QUIZ_MEASUREMENT_ADDED_EVENT, handleQuizMeasurementAdded);
      window.removeEventListener(AR_QUIZ_MEASUREMENT_LABELLED_EVENT, handleQuizMeasurementAdded);
    };
  }, [activeQuestionKey, authoringMode, authoringDefinition, authoringSaving, payload, answersByQuizKey]);

  // Both the EF progress-panel button and fourth-contour completion reuse
  // the normal quiz measurement capture command. Never synthesize an EF from
  // event payloads: verify the current viewport study and calculated value.
  useEffect(() => {
    const handleCalculatedEFCapture = async (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const mode = cleanString(detail.mode);
      if (mode !== 'completed' && mode !== 'manual') return;
      if (mode === 'completed' && authoringMode) return;
      if (efCaptureInFlightRef.current) return;

      const activeKey = activeQuestionKey;
      if (!activeKey || lastActivatedQuestionRef.current !== activeKey) {
        if (mode === 'manual') {
          uiNotificationService.show({
            title: 'LV EF',
            message: 'Select the EF measurement question in Case Questions before capturing.',
            type: 'info',
            duration: 4000,
          });
        }
        return;
      }

      const requestedStudy = cleanString(detail.studyInstanceId);
      const requestedValue = Number(detail.value);
      const isValidValue = Number.isFinite(requestedValue);
      const [quizKey, questionKey] = activeKey.split(':');
      const quiz = authoringMode ? null : payload?.quizzes?.find(item => item.quizKey === quizKey);
      const question = authoringMode
        ? authoringQuestionsRef.current.find(item => item.questionKey === questionKey)
        : quiz?.questions?.find(item => item.questionKey === questionKey);
      if (
        !question ||
        question.type !== 'measurementNumeric' ||
        cleanString(plainObject(question.answerConfig).measurementKind) !== 'lvSimpsonEF' ||
        !requestedStudy ||
        !isValidValue ||
        (authoringMode && (!isDraftDefinition(authoringDefinition) || authoringSaving))
      ) {
        if (mode === 'manual') {
          uiNotificationService.show({
            title: 'LV EF',
            message: 'Select an editable EF measurement question before capturing.',
            type: 'info',
            duration: 4000,
          });
        }
        return;
      }

      efCaptureInFlightRef.current = true;
      try {
        const snapshot = await runViewerCommand(commandsManager, 'getViewerQuizLVSimpsonForActiveStudy');
        const eventMatchesCalculatedEF = isMatchingQuizEFCompletion({
          mode,
          authoringMode,
          questionKind: cleanString(plainObject(question.answerConfig).measurementKind),
          eventStudy: requestedStudy,
          activeStudy: cleanString(snapshot?.studyInstanceId),
          eventValue: requestedValue,
          currentValue: snapshot?.composite?.value,
        });
        // A manual button press after spline edits must reach the existing
        // viewer re-review checkpoint, which redraws the EF panel and requires
        // the second click. Do not silently record the stale event value.
        const needsExplicitReReview = mode === 'manual' &&
          snapshot?.studyInstanceId === requestedStudy &&
          snapshot?.composite?.measurementKind === 'lvSimpsonEF' &&
          Number.isFinite(Number(snapshot?.composite?.value)) &&
          !eventMatchesCalculatedEF;
        if (!eventMatchesCalculatedEF && !needsExplicitReReview) {
          if (mode === 'manual') {
            uiNotificationService.show({
              title: 'LV EF',
              message: 'The active study or calculated EF is unavailable. Review the contours before capturing.',
              type: 'warning',
              duration: 5500,
            });
          }
          return;
        }
        // A user may switch questions while the viewer snapshot is loading.
        if (lastActivatedQuestionRef.current !== activeKey) return;
        if (authoringMode) {
          await captureAuthoringMeasurement(question);
        } else if (quiz) {
          await captureSelectedMeasurementAnswer(quiz, question);
        }
      } catch (error) {
        console.warn('[CaseQuestionsPanel] calculated EF capture failed:', error);
      } finally {
        efCaptureInFlightRef.current = false;
      }
    };

    window.addEventListener(AR_LV_SIMPSON_CAPTURE_REQUESTED_EVENT, handleCalculatedEFCapture);
    return () => window.removeEventListener(
      AR_LV_SIMPSON_CAPTURE_REQUESTED_EVENT, handleCalculatedEFCapture
    );
  }, [activeQuestionKey, authoringMode, payload, authoringDefinition, authoringSaving]);

  // Case Questions owns this review. It must not depend on AR Measurements being mounted.
  const finishQuizMeasurementReview = (ok: boolean) => {
    setQuizMeasurementReview(null);
    setQuizMeasurementSelectedRows([]);
    const resolve = quizMeasurementResolveRef.current;
    quizMeasurementResolveRef.current = null;
    resolve?.(ok);
  };

  const applyQuizMeasurementReview = async () => {
    if (!quizMeasurementReview || quizMeasurementApplying) return;
    const fields = Array.from(new Set(
      quizMeasurementReview.rows
        .filter(row => quizMeasurementSelectedRows.includes(row.key))
        .flatMap(row => row.fieldNames)
    ));
    setQuizMeasurementApplying(true);
    try {
      const result = await Promise.resolve(commandsManager.runCommand(
        'saveViewerMeasurementsForActiveStudy',
        { domain: 'echo', scoringIntent: 'draft', educationAttemptIntent: 'draft', reportFieldNames: fields }
      ));
      if (!result || result?.ok === false) throw new Error('Measurement save did not succeed.');
      finishQuizMeasurementReview(true);
    } catch (error) {
      console.error('[CaseQuestionsPanel] measurement save failed:', error);
      uiNotificationService.show({
        title: 'Case Questions',
        message: `Measurement save failed: ${error?.message || error}`,
        type: 'error',
        duration: 5000,
      });
      finishQuizMeasurementReview(false);
    } finally {
      setQuizMeasurementApplying(false);
    }
  };

  async function confirmReportOwnedMeasurementSave(): Promise<void> {
    await ensureViewerQuizSaveSeriesDoc();
    const preview = await Promise.resolve(commandsManager.runCommand(
      'saveViewerMeasurementsForActiveStudy',
      { domain: 'echo', scoringIntent: 'draft', educationAttemptIntent: 'draft', previewOnly: true }
    ));
    if (!preview?.previewOnly || preview?.isClinicalReportSave !== true) {
      throw new Error('Measurement review is unavailable for this learner report. Answers were not saved.');
    }
    const rows = buildClinicalReportReviewRows(preview);
    if (!rows.length && preview?.measurementAnnotationsChanged === false) return;
    // If annotations changed without mapped report fields, save annotations explicitly.
    if (!rows.length) {
      const result = await Promise.resolve(commandsManager.runCommand(
        'saveViewerMeasurementsForActiveStudy',
        { domain: 'echo', scoringIntent: 'draft', educationAttemptIntent: 'draft', reportFieldNames: [] }
      ));
      if (!result || result?.ok === false) {
        throw new Error('Viewer annotations could not be saved.');
      }
      return;
    }
    setQuizMeasurementSelectedRows(rows.filter(row => row.changed).map(row => row.key));
    setQuizMeasurementReview({ rows, derivedConsequences: preview?.derivedConsequences });
    const approved = await new Promise<boolean>(resolve => {
      quizMeasurementResolveRef.current = resolve;
    });
    if (!approved) throw new Error('Measurement review was cancelled or failed. Answers were not saved.');
  }

  async function saveQuiz(quiz: QuizDefinition, status: 'draft' | 'submitted') {
    const quizAnswers = answersByQuizKey[quiz.quizKey] || {};

    if (status === 'submitted' && hasRequiredMissing(quiz, quizAnswers)) {
      uiNotificationService.show({
        title: 'Case Questions',
        message: 'Please answer all required questions before submitting.',
        type: 'warning',
        duration: 3000,
      });
      return null;
    }

    setSavingQuizKey(quiz.quizKey);
    if (status === 'submitted') {
      setSubmitting(true);
    }

    try {
      // Bowel quiz answers require persisted canonical calipers. Save newly
      // captured measurements on the learner copy before saving quiz JSON.
      const pendingIds = Array.from(new Set((quiz.questions || [])
        .filter(isBowelMeasurementSetQuestion)
        .flatMap(question => getBowelMeasurementSetEntries(
          plainObject(quizAnswers[question.questionKey]).measurements
        ))
        .map(entry => String(entry.sourceAnnotationId || ''))
        .filter(id => id && pendingBowelQuizMeasurementIdsRef.current.has(id))));
      if (pendingIds.length) {
        const persisted = await Promise.resolve(commandsManager.runCommand(
          'saveViewerMeasurementsForActiveStudy', {
            domain: 'bowel', measurementIds: pendingIds,
            quizSpatialEvidenceByAnnotationId: Object.fromEntries(
              (quiz.questions || []).filter(isBowelMeasurementSetQuestion)
                .flatMap(question => getBowelMeasurementSetEntries(
                  plainObject(quizAnswers[question.questionKey]).measurements
                ))
                .filter(entry => pendingIds.includes(String(entry.sourceAnnotationId)))
                .map(entry => [String(entry.sourceAnnotationId), entry.quizSpatialEvidence])
            ),
            scoringIntent: 'draft', educationAttemptIntent: 'draft',
            suppressSuccessNotification: true,
          }
        ));
        const savedIds = new Set((persisted?.annotations || [])
          .map(annotation => String(annotation?.uid || annotation?.annotationId || '')));
        if (!persisted?.seriesDoc?._id || pendingIds.some(id => !savedIds.has(id))) {
          throw new Error('BWT caliper persistence failed; quiz answers were not saved.');
        }
        pendingIds.forEach(id => pendingBowelQuizMeasurementIdsRef.current.delete(id));
      }
      // Combined report assessment: measurement review and persistence precede quiz answer save.
      // Ordinary imaging quizzes retain their existing independent save/score workflow.
      if (deferredReportScoring && quiz.questions.some(q => q.type === 'measurementNumeric')) {
        await confirmReportOwnedMeasurementSave();
      }
      // A quiz JSON answer is not proof its individual phase annotations were
      // saved. Persist only the exact missing source contours on the learner's
      // own Series before saving the answer. In combined report workflows the
      // existing reviewed report-owned save runs first (above).
      const compositeSources = getLearnerCompositePersistenceSources(
        quiz.questions || [], quizAnswers
      );
      if (compositeSources.length) {
        await ensureViewerQuizSaveSeriesDoc();
        const readSaved = async () => await runViewerCommand(
          commandsManager, 'getViewerMeasurementAnnotationsForActiveStudy',
          { domain: 'echo', workflows: ['viewerMeasurements'] }
        );
        let persisted = await readSaved();
        if (!persisted?.seriesDoc?.isLearnerCopy ||
            !persisted?.saveTarget?.learnerSeriesId ||
            String(persisted.seriesDoc._id || '') !==
              String(persisted.saveTarget.learnerSeriesId)) {
          throw new Error(
            'Learner measurement evidence could not be verified on the isolated learner Series. No quiz answers were saved.'
          );
        }
        const getMissing = (records: any[]) => compositeSources.filter(source =>
          !(Array.isArray(records) ? records : []).some(annotation =>
            isPersistedLearnerCompositeSource(annotation, source)
          )
        );
        const missing = getMissing(persisted.annotations);
        if (missing.length) {
          // An exact quiz annotation ID in the learner's active viewer session
          // is required. Never fetch educator/base gold or save an approximate
          // contour from another question/frame.
          const live = await runViewerCommand(
            commandsManager, 'getViewerMeasurementSnapshotForPanel', {}
          );
          if (missing.some(source =>
            !(Array.isArray(live) ? live : []).some(item =>
              isPersistedLearnerCompositeSource(item, source)
            )
          )) {
            throw new Error(
              'Some learner composite contours are not available with their saved DICOM frame. Reopen and verify the affected measurements before saving.'
            );
          }
          const result = await runViewerCommand(
            commandsManager, 'saveViewerMeasurementsForActiveStudy', {
              domain: 'echo',
              measurementIds: missing.map(source => source.annotationId),
              scoringIntent: 'draft', educationAttemptIntent: 'draft',
              suppressSuccessNotification: true,
            }
          );
          if (!result || result.ok === false) {
            throw new Error(
              'The learner phase contours could not be saved to AR. Quiz answers were not saved.'
            );
          }
          persisted = await readSaved();
          if (!persisted?.seriesDoc?.isLearnerCopy ||
              getMissing(persisted.annotations).length) {
            throw new Error(
              'AR did not confirm persistence of every learner phase contour. Quiz answers were not saved.'
            );
          }
        }
      }

      const saveSource = `quiz:${quiz.quizKey}`;
      const saveRequestId = nextEducationSaveRequestId();
      reportEducationSaveStart(saveSource, saveRequestId);
      let result;
      try {
        result = await saveViewerQuizResponseForActiveStudy({
          quizKey: quiz.quizKey,
          quizVersion: Number(quiz.quizVersion) || 1,
          status,
          answers: buildAnswerPayload(quiz, quizAnswers),
        });
        // Scoring is a separate operation from answer persistence.
        reportEducationSaveResult(saveSource, saveRequestId, true);
      } catch (saveError) {
        reportEducationSaveResult(saveSource, saveRequestId, false);
        throw saveError;
      }

      let scoredPayload: any = null;

      if (status === 'submitted' && !deferredReportScoring) {
        scoredPayload = await submitAndRefreshViewerQuizScoreForActiveStudy();
        setScoringPayload(scoredPayload);
      }

      const viewerQuizzes = getViewerQuizScore(scoredPayload);
      const scoredQuiz = viewerQuizzes ? getQuizScoreItem(viewerQuizzes, quiz) : null;

      uiNotificationService.show({
        title: 'Case Questions',
        message:
          status === 'submitted' && deferredReportScoring
            ? 'Viewer answers submitted. Return to the report to submit for scoring.'
            : status === 'submitted'
            ? scoredQuiz
              ? `Quiz submitted and scored: ${Number(scoredQuiz.total || 0)} / ${Number(scoredQuiz.max || 0)}`
              : 'Quiz submitted and scored.'
            : 'Draft answers saved.',
        type: 'success',
        duration: 3500,
      });

      window.dispatchEvent(new CustomEvent('ar:learning-library-progress-updated'));

      await refresh({ silent: true });

      return result;
    } catch (error) {
      const message =
        status === 'submitted'
          ? `Submit failed: ${error?.message || error}`
          : `Save failed: ${error?.message || error}`;

      setErrorMessage(message);

      uiNotificationService.show({
        title: 'Case Questions',
        message,
        type: 'error',
        duration: 10000,
      });

      throw error;
    } finally {
      setSavingQuizKey('');
      if (status === 'submitted') {
        setSubmitting(false);
      }
    }
  }

  async function retryScoreQuiz(quiz: QuizDefinition) {
    setSavingQuizKey(quiz.quizKey);
    setScoringQuizKey(quiz.quizKey);
    setSubmitting(true);
    setErrorMessage('');

    try {
      if (deferredReportScoring) {
        throw new Error('Scoring is available from the reporting assessment only.');
      }
      const scoredPayload = await submitAndRefreshViewerQuizScoreForActiveStudy();
      setScoringPayload(scoredPayload);

      const viewerQuizzes = getViewerQuizScore(scoredPayload);
      const scoredQuiz = viewerQuizzes ? getQuizScoreItem(viewerQuizzes, quiz) : null;

      uiNotificationService.show({
        title: 'Case Questions',
        message: scoredQuiz
          ? `Quiz scored: ${Number(scoredQuiz.total || 0)} / ${Number(scoredQuiz.max || 0)}`
          : 'Quiz scored.',
        type: 'success',
        duration: 3500,
      });

      window.dispatchEvent(new CustomEvent('ar:learning-library-progress-updated'));

      await refresh({ silent: true });
    } catch (error) {
      const message = `Score retry failed: ${error?.message || error}`;

      setErrorMessage(message);

      uiNotificationService.show({
        title: 'Case Questions',
        message,
        type: 'error',
        duration: 10000,
      });

      throw error;
    } finally {
      setSavingQuizKey('');
      setScoringQuizKey('');
      setSubmitting(false);
    }
  }

  function updateAuthoringQuestion(
    questionKey: string,
    updater: (question: QuizQuestion) => QuizQuestion
  ) {
    // Keep the save source synchronous. Capturing gold and pressing Save
    // immediately must not serialize the previous React render's questions.
    const nextQuestions = authoringQuestionsRef.current.map(question =>
      question.questionKey === questionKey ? updater(question) : question
    );
    authoringQuestionsRef.current = nextQuestions;
    setAuthoringQuestions(nextQuestions);
    reportEducationChange('authoring');
  }

  function patchAuthoringQuestion(question: QuizQuestion, patch: Partial<QuizQuestion>) {
    updateAuthoringQuestion(question.questionKey, current => ({
      ...current,
      ...patch,
    }));
  }

  function patchAuthoringAnswerConfig(question: QuizQuestion, patch: Record<string, any>) {
    updateAuthoringQuestion(question.questionKey, current => ({
      ...current,
      answerConfig: {
        ...plainObject(current.answerConfig),
        ...patch,
      },
    }));
  }

  async function captureAuthoringFrame(question: QuizQuestion) {
    const captureKey = `authoring-frame:${question.questionKey}`;
    const activeAuthoringQuestionKey = `authoring:${question.questionKey}`;

    setActiveQuestionKey(activeAuthoringQuestionKey);
    setCapturingAuthoringKey(captureKey);

    try {
      if (question.type === 'measurementNumeric') {
        if (!authoringMeasurementDomain) {
          throw new Error('Measurement domain is missing from the educational asset. Configure Echo or Bowel before opening the viewer.');
        }

        syncQuizMeasurementDomainToUrl(authoringMeasurementDomain, { overwrite: true });

        // Capturing the target frame for a composite must not interrupt its
        // guided EF/LA workflow or activate Length over the pending drag.
        const measurementKind = cleanString(plainObject(question.answerConfig).measurementKind);
        if (!isGuidedQuizCompositeKind(measurementKind)) {
          const activationResult = await runViewerCommand(
            commandsManager,
            'activateViewerQuizMeasurementTool',
            { toolName: 'Length', questionKey: question.questionKey }
          );
          if (activationResult?.ok === false) {
            throw new Error(
              `Unable to activate Length: ${cleanString(activationResult?.reason) || 'unknown error'}`
            );
          }
        }
      }

      const result = await runViewerCommand(commandsManager, 'getCurrentViewerQuizFrameAnswer', {
        question,
      });

      if (!result?.ok || !result?.answer?.selectedTarget) {
        throw new Error(result?.reason || 'current frame not found');
      }

      const target = result.answer.selectedTarget;

      patchAuthoringQuestion(question, {
        viewerTarget: target,
        answerConfig: {
          ...plainObject(question.answerConfig),
          goldTarget:
            question.type === 'frameSelection'
              ? target
              : plainObject(question.answerConfig).goldTarget,
          viewerTarget: target,
        },
      });

      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `Target captured: ${getViewerTargetSummary(target)}`,
        type: 'success',
        duration: 2500,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `Frame capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  async function captureAuthoringCompositeFrame(question: QuizQuestion, slot: string) {
    const config = plainObject(question.answerConfig);
    if (!COMPOSITE_FRAME_SLOTS[cleanString(config.measurementKind)]?.some(item => item.slot === slot)) {
      return;
    }
    setCapturingAuthoringKey(`authoring-composite-frame:${question.questionKey}`);
    try {
      const response = await runViewerCommand(commandsManager, 'getCurrentViewerQuizFrameAnswer', {});
      const target = plainObject(response?.answer?.selectedTarget);
      if (!response?.ok || !cleanString(target.studyInstanceUID) ||
          !cleanString(target.seriesInstanceUID) ||
          !cleanString(target.sopInstanceUID) ||
          !cleanString(target.referencedImageId) ||
          !Number.isInteger(Number(target.frameNumber)) || Number(target.frameNumber) < 1) {
        throw new Error('Select an identified DICOM instance and frame before capture.');
      }
      updateAuthoringQuestion(question.questionKey, current => ({
        ...current,
        answerConfig: {
          ...plainObject(current.answerConfig),
          compositeFrameTargets: {
            ...plainObject(plainObject(current.answerConfig).compositeFrameTargets),
            [slot]: target,
          },
        },
      }));
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `${slot} source captured: ${getViewerTargetSummary(target)}`,
        type: 'success', duration: 2500,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `Composite frame capture failed: ${error?.message || error}`,
        type: 'warning', duration: 5000,
      });
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  async function captureAuthoringEFContourFrame(question: QuizQuestion, slot: string) {
    if (cleanString(plainObject(question.answerConfig).measurementKind) !== 'lvSimpsonEF' ||
        !EF_CONTOUR_FRAME_SLOTS.some(entry => entry.slot === slot)) {
      return;
    }
    setCapturingAuthoringKey(`authoring-ef-frame:${question.questionKey}`);
    try {
      const result = await runViewerCommand(commandsManager, 'getCurrentViewerQuizFrameAnswer', {});
      const target = plainObject(result?.answer?.selectedTarget);
      if (!result?.ok || !cleanString(target.referencedImageId) ||
          !cleanString(target.sopInstanceUID || target.SOPInstanceUID) ||
          !Number.isInteger(Number(target.frameNumber)) || Number(target.frameNumber) < 1) {
        throw new Error('Select a DICOM image with a valid instance and frame before capture.');
      }
      updateAuthoringQuestion(question.questionKey, current => {
        const answerConfig = plainObject(current.answerConfig);
        return {
          ...current,
          answerConfig: {
            ...answerConfig,
            efContourTargets: {
              ...plainObject(answerConfig.efContourTargets),
              [slot]: target,
            },
          },
        };
      });
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `${slot} frame captured: ${getViewerTargetSummary(target)}`,
        type: 'success',
        duration: 2500,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `EF frame capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  async function captureAuthoringGoldPoint(question: QuizQuestion) {
    const captureKey = `authoring-point:${question.questionKey}`;
    setCapturingAuthoringKey(captureKey);

    try {
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: 'Click the image to place the gold marker.',
        type: 'info',
        duration: 3000,
      });

      const result = await runViewerCommand(commandsManager, 'captureViewerQuizPointAnswer', {
        question,
      });

      if (!result?.ok || !result?.answer?.point) {
        throw new Error(result?.reason || 'point capture failed');
      }

      const target =
        result.answer.viewerTarget || result.answer.selectedTarget || question.viewerTarget;

      const nextQuestion = {
        ...question,
        viewerTarget: target,
        answerConfig: {
          ...plainObject(question.answerConfig),
          viewerTarget: target,
          goldPoint: {
            ...roundQuizPoint(result.answer.point),
            viewerTarget: target,
          },
        },
        scoringConfig: {
          radius: 5,
          radiusUnit: 'world',
          ...plainObject(question.scoringConfig),
        },
      };

      updateAuthoringQuestion(question.questionKey, () => nextQuestion);

      await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
        viewerTarget: target,
        markerOptions: getOverlayMarkerOptionsForQuestion(nextQuestion, {
          includeGoldMarker: true,
        }),
        questionKey: question.questionKey,
      });

      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: 'Gold marker placed.',
        type: 'success',
        duration: 2500,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `Gold marker capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  async function addAuthoringMarkerOption(question: QuizQuestion, markerIdToUpdate = '') {
    const captureKey = `authoring-marker:${question.questionKey}`;
    setCapturingAuthoringKey(captureKey);

    try {
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: 'Click the image to place the marker option.',
        type: 'info',
        duration: 3000,
      });

      const result = await runViewerCommand(commandsManager, 'captureViewerQuizPointAnswer', {
        question,
      });

      if (!result?.ok || !result?.answer?.point) {
        throw new Error(result?.reason || 'marker capture failed');
      }

      const latestQuestion =
        authoringQuestionsRef.current.find(
          currentQuestion => currentQuestion.questionKey === question.questionKey
        ) || question;
      const answerConfig = plainObject(latestQuestion.answerConfig);
      const existingMarkers = normalizeMarkerOptions(answerConfig.markerOptions);
      const requestedMarkerId = cleanString(markerIdToUpdate);
      const requestedIndex = requestedMarkerId
        ? existingMarkers.findIndex(
            marker =>
              cleanString(marker.markerId || marker.markerKey || marker.value) === requestedMarkerId
          )
        : -1;
      const firstUnplacedIndex = existingMarkers.findIndex(marker => !isMarkerOptionPlaced(marker));
      const markerIndexToUpdate = requestedIndex >= 0 ? requestedIndex : firstUnplacedIndex;
      const existingMarker = markerIndexToUpdate >= 0 ? existingMarkers[markerIndexToUpdate] : null;
      const nextMarkerId =
        cleanString(
          existingMarker?.markerId || existingMarker?.markerKey || existingMarker?.value
        ) || getNextMarkerId(existingMarkers);
      const markerId = nextMarkerId;

      const label =
        cleanString(existingMarker?.label) ||
        `Marker ${nextMarkerId.replace('marker-', '').toUpperCase()}`;
      const target =
        result.answer.viewerTarget || result.answer.selectedTarget || latestQuestion.viewerTarget;
      const nextMarker = {
        ...(existingMarker || {}),
        markerId,
        markerKey: markerId,
        value: markerId,
        label,
        point: roundQuizPoint(result.answer.point),
        coordinateSpace: result.answer.point?.coordinateSpace || 'world',
        viewerTarget: target,
        sourceRefs: result.answer.sourceRefs || {},
      };
      const nextMarkers =
        markerIndexToUpdate >= 0
          ? existingMarkers.map((marker, index) =>
              index === markerIndexToUpdate ? nextMarker : marker
            )
          : [...existingMarkers, nextMarker];
      const nextQuestion = {
        ...latestQuestion,
        viewerTarget: target,
        answerConfig: {
          ...answerConfig,
          viewerTarget: target,
          markerOptions: nextMarkers,
          correctMarkerIds: getCorrectMarkerIdsFromAnswerConfig(answerConfig),
          correctMarkerId: '',
          correctMarkerKey: '',
        },
      };

      const nextQuestions = authoringQuestionsRef.current.map(currentQuestion =>
        currentQuestion.questionKey === question.questionKey ? nextQuestion : currentQuestion
      );
      authoringQuestionsRef.current = nextQuestions;
      reportEducationChange('authoring');
      setAuthoringQuestions(nextQuestions);

      await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
        viewerTarget: null,
        markerOptions: getOverlayMarkerOptionsForQuestion(nextQuestion, {
          includeGoldMarker: true,
        }),
        questionKey: question.questionKey,
      });

      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `${label} ${existingMarker ? 'updated' : 'added'}.`,
        type: 'success',
        duration: 2500,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `Marker option capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  async function removeAuthoringMarkerOption(question: QuizQuestion, markerIdToRemove = '') {
    const markerId = cleanString(markerIdToRemove);
    if (!markerId) {
      return;
    }

    const latestQuestion =
      authoringQuestionsRef.current.find(
        currentQuestion => currentQuestion.questionKey === question.questionKey
      ) || question;
    const answerConfig = plainObject(latestQuestion.answerConfig);
    const nextMarkers = normalizeMarkerOptions(answerConfig.markerOptions).filter(
      marker => cleanString(marker.markerId || marker.markerKey || marker.value) !== markerId
    );
    const nextCorrectMarkerIds = getCorrectMarkerIdsFromAnswerConfig(answerConfig).filter(
      id => id !== markerId
    );
    const nextQuestion = {
      ...latestQuestion,
      answerConfig: {
        ...answerConfig,
        markerOptions: nextMarkers,
        correctMarkerIds: nextCorrectMarkerIds,
        correctMarkerId: '',
        correctMarkerKey: '',
      },
    };

    const nextQuestions = authoringQuestionsRef.current.map(currentQuestion =>
      currentQuestion.questionKey === question.questionKey ? nextQuestion : currentQuestion
    );

    authoringQuestionsRef.current = nextQuestions;
    reportEducationChange('authoring');
    setAuthoringQuestions(nextQuestions);

    await runViewerCommand(commandsManager, 'clearViewerQuizMarkerOptions', {});

    await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
      viewerTarget: null,
      markerOptions: getOverlayMarkerOptionsForQuestion(nextQuestion, {
        includeGoldMarker: true,
      }),
      questionKey: question.questionKey,
    });
  }

  async function clearAuthoringGoldPoint(question: QuizQuestion) {
    const answerConfig = plainObject(question.answerConfig);
    const nextQuestion = {
      ...question,
      answerConfig: {
        ...answerConfig,
        goldPoint: {
          coordinateSpace: answerConfig.goldPoint?.coordinateSpace || 'world',
        },
      },
    };

    updateAuthoringQuestion(question.questionKey, () => nextQuestion);

    await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
      viewerTarget: getQuestionViewerTarget(nextQuestion),
      markerOptions: getOverlayMarkerOptionsForQuestion(nextQuestion, {
        includeGoldMarker: true,
      }),
      questionKey: question.questionKey,
    });
  }

  async function clearAuthoringGoldMeasurement(question: QuizQuestion) {
    if (!authoringMode || !isDraftDefinition(authoringDefinition) || authoringSaving) {
      return;
    }

    // Clear the source quiz answer, not the locked rubric comparison overlay.
    // Keep the configured measurement type, unit, question target, and tolerances.
    updateAuthoringQuestion(question.questionKey, current => ({
      ...current,
      answerConfig: {
        ...plainObject(current.answerConfig),
        goldMeasurement: null,
        goldValue: null,
        // Anatomical label is learned from the next educator-captured gold answer.
        measurementType: '',
      },
    }));

    try {
      await runViewerCommand(commandsManager, 'clearViewerQuizMeasurementComparison', {});
    } catch (error) {
      console.warn('[CaseQuestionsPanel] could not clear gold measurement overlay:', error);
    }

    uiNotificationService.show({
      title: 'Quiz Authoring',
      message: 'Gold measurement cleared. Save the draft to persist this change.',
      type: 'info',
      duration: 4000,
    });
  }

  async function captureAuthoringMeasurement(
    question: QuizQuestion,
    options: { measurementId?: string; silent?: boolean } = {}
  ) {
    const captureKey = `authoring-measurement:${question.questionKey}`;
    const answerConfig = plainObject(question.answerConfig);

    // Binding is always an explicit question, never inferred from the last drawing.
    setActiveQuestionKey(`authoring:${question.questionKey}`);
    setCapturingAuthoringKey(captureKey);
    lastCompositeGoldCaptureErrorRef.current = '';

    try {
      const result = await captureQuizMeasurementResult(question, {
        measurementId: cleanString(options.measurementId),
      });

      if (!result?.ok || !result?.answer) {
        throw new Error(result?.reason || 'selected measurement not found');
      }

      const answer = result.answer;
      const captureKind = cleanString(answerConfig.measurementKind);
      const guidedSlots = COMPOSITE_FRAME_SLOTS[captureKind] || [];
      if (guidedSlots.length && answerConfig.compositeFrameGuidanceEnabled === true) {
        const configured = getCompleteCompositeFrameTargets(answerConfig);
        const components = plainObject(answer.compositeResult).components;
        if (!configured || !Array.isArray(components) || components.length !== guidedSlots.length ||
            guidedSlots.some(({ slot }) => {
              const component = components.find(item => cleanString(item?.slot) === slot);
              return !component || !matchesConfiguredCompositeFrame(
                plainObject(component.target), configured[slot]
              );
            })) {
          throw new Error('The calculated measurement must contain all required gold contours on their configured DICOM instance/frames.');
        }
      }
      if (isBowelMeasurementSetQuestion(question)) {
        const latest = authoringQuestionsRef.current.find(
          item => item.questionKey === question.questionKey
        ) || question;
        const latestConfig = plainObject(latest.answerConfig);
        const previous = getBowelMeasurementSetEntries(latestConfig.goldMeasurements);
        const appended = appendBowelMeasurementSetAnswer(latest, previous, answer);
        if (!appended.ok) throw new Error(appended.reason || 'Cannot add BWT gold measurement.');
        const set = plainObject(latestConfig.measurementSet);
        const nextSet = {
          ...set,
          referenceTarget: appended.referenceTarget,
          measurementTarget: cleanString(set.measurementTarget || answer.measurementType),
          ...(set.orientation === 'longitudinal' && appended.axis
            ? { longitudinalAxisPhysical: appended.axis }
            : {}),
        };
        updateAuthoringQuestion(question.questionKey, current => ({
          ...current,
          viewerTarget: appended.referenceTarget,
          answerConfig: {
            ...plainObject(current.answerConfig),
            goldMeasurements: appended.entries,
            goldMeasurement: appended.entries[0],
            goldValue: appended.entries[0]?.value,
            measurementType: nextSet.measurementTarget,
            unit: 'mm',
            measurementSet: nextSet,
          },
          scoringConfig: {
            ...plainObject(current.scoringConfig),
            absoluteTolerance: plainObject(current.scoringConfig).absoluteTolerance ?? '',
            toleranceUnit: 'mm',
          },
        }));
        if (!options.silent) uiNotificationService.show({
          title: 'Bowel gold measurements',
          message: `Captured ${appended.entries?.length} / ${set.requiredCount} reference calipers.`,
          type: 'success', duration: 3000,
        });
        return true;
      }
      // Quiz metadata must never stand in for the actual measurement label.
      if (!cleanString(answer.reviewPayload?.label)) {
        throw new Error('Label the measurement in the viewer before capturing a gold answer.');
      }
      // Changing the measurement kind must not retain the prior Length unit (mm).
      // Composite results use fixed clinical units supplied by the viewer.
      const configuredKind = cleanString(answerConfig.measurementKind);
      const compositeUnit =
        ['lvSimpsonEF', 'rvFAC', 'ivcCollapsibility'].includes(configuredKind) ? '%' :
        ['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(configuredKind) ? 'mL' :
        configuredKind === 'raArea' ? 'cm2' :
        configuredKind === 'ivcRapRvsp' ? 'mmHg' : '';
      const expectedUnit = cleanString(compositeUnit || answerConfig.unit).toLowerCase();
      const capturedUnit = cleanString(answer.unit).toLowerCase();
      if (compositeUnit && cleanString(answer.measurementKind) !== configuredKind) {
        throw new Error(`Selected measurement is not a ${configuredKind} result.`);
      }
      if (expectedUnit && capturedUnit && expectedUnit !== capturedUnit) {
        throw new Error(`Measurement unit mismatch: ${answer.unit} cannot be assigned to a question expecting ${compositeUnit || answerConfig.unit}. Check image calibration or change the question unit.`);
      }
      // The educator selects the correct anatomical label when drawing in the viewer.
      // A previously captured label is not a restriction on replacing the gold answer.
      // The tool restriction remains separate in answerConfig.measurementKind.
      const target = answer.viewerTarget || question.viewerTarget;
      const unit = cleanString(answer.unit || answerConfig.unit);
      const nextQuestion = {
        ...question,
        viewerTarget: target,
        answerConfig: {
          ...answerConfig,
          viewerTarget: target,
          goldMeasurement: answer,
          goldValue: answer.value,
          measurementType: answer.measurementType || answerConfig.measurementType || '',
          unit,
        },
        scoringConfig: {
          ...plainObject(question.scoringConfig),
          absoluteTolerance: plainObject(question.scoringConfig).absoluteTolerance ?? '',
          toleranceUnit: unit,
        },
      };

      updateAuthoringQuestion(question.questionKey, () => nextQuestion);

      if (configuredKind === 'lvSimpsonEF') {
        window.dispatchEvent(
          new CustomEvent('ar-measurements:lv-simpson-gold-captured', {
            detail: {
              questionKey: question.questionKey,
              value: answer.value,
              studyInstanceId: answer.sourceRefs?.studyInstanceUID || '',
            },
          })
        );
      }

      // A composite gold capture may finish on phase 2. Its two contours
      // belong to separate frames; do not automatically navigate back to
      // phase 1 or put comparison overlays on top of the editable sources.
      // The phase-specific "View saved" action navigates explicitly.
      if (!['rvFAC', 'raArea', 'laVolumeBiplane', 'laVolumeBiplaneDisks',
        'ivcCollapsibility'].includes(configuredKind)) {
        try {
          const displayResult = await showAuthoringGoldMeasurement(nextQuestion);
          if (displayResult?.rubricRendered !== true) {
            console.warn('[CaseQuestionsPanel] newly captured gold measurement was not displayed', {
              questionKey: question.questionKey, result: displayResult,
            });
          }
        } catch (error) {
          console.warn('[CaseQuestionsPanel] newly captured gold measurement display failed:', error);
        }
      }

      if (!options.silent) {
        uiNotificationService.show({
          title: 'Quiz Authoring',
          message: `Gold measurement captured: ${answer.value} ${unit}`,
          type: 'success',
          duration: 3000,
        });
      }
      return true;
    } catch (error) {
      if (options.silent) {
        // Automatic capture attempts during incomplete measurements must not
        // generate failure toasts or modify existing versioned gold evidence.
        lastCompositeGoldCaptureErrorRef.current =
          cleanString(error?.message || error);
        console.warn('[CaseQuestionsPanel] automatic gold measurement capture unavailable:', error);
        return false;
      }
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `Measurement capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  // Completed composite phases become a gold answer through the existing
  // validated Viewer capture command, never from a client-calculated scalar.
  // The educator must still Save draft to persist the versioned answer.
  useEffect(() => {
    if (!authoringMode || !isDraftDefinition(authoringDefinition) || authoringSaving) return;
    if (!activeQuestionKey.startsWith('authoring:')) return;
    const questionKey = activeQuestionKey.slice('authoring:'.length);
    const question = authoringQuestionsRef.current.find(item => item.questionKey === questionKey);
    if (!question) return;
    const signature = getCompositeGoldCaptureSignature(question, liveCompositeMeasurements);
    // Phase labels/annotation IDs alone do not prove that the clinical
    // calculation is calibrated or ready. Never auto-capture on that basis.
    if (!signature || liveCompositeStatus.questionKey !== activeQuestionKey ||
        liveCompositeStatus.complete !== true) return;
    if (signature.startsWith('backfill:')) {
      const previous = plainObject(plainObject(question.answerConfig).goldMeasurement);
      if (previous.value == null || liveCompositeStatus.value == null ||
          Math.round(Number(previous.value) * 100) !==
          Math.round(Number(liveCompositeStatus.value) * 100)) return;
    }
    const captureKey = questionKey + ':' + signature;
    if (autoCompositeGoldCaptureInFlightRef.current.has(captureKey)) return;
    autoCompositeGoldCaptureInFlightRef.current.add(captureKey);
    const timer = window.setTimeout(async () => {
      try {
        const current = authoringQuestionsRef.current.find(item => item.questionKey === questionKey);
        if (!current || activeQuestionKey !== 'authoring:' + questionKey ||
            getCompositeGoldCaptureSignature(current, liveCompositeMeasurements) !== signature) return;
        await captureAuthoringMeasurement(current, { silent: true });
      } finally {
        autoCompositeGoldCaptureInFlightRef.current.delete(captureKey);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      autoCompositeGoldCaptureInFlightRef.current.delete(captureKey);
    };
  }, [liveCompositeMeasurements, liveCompositeStatus, activeQuestionKey, authoringMode, authoringDefinition, authoringSaving]);

  async function captureBowelQuizLumenCenter(question: QuizQuestion) {
    const current = authoringQuestionsRef.current.find(
      item => item.questionKey === question.questionKey
    ) || question;
    const config = plainObject(current.answerConfig);
    const settings = plainObject(config.measurementSet);
    const referenceTarget = plainObject(settings.referenceTarget);
    if (!isBowelMeasurementSetQuestion(current) || settings.orientation !== 'crossSection' ||
        !cleanString(referenceTarget.sopInstanceUID)) {
      uiNotificationService.show({
        title: 'Bowel measurement set',
        message: 'Capture a gold cross-sectional BWT caliper first.',
        type: 'warning', duration: 4000,
      });
      return;
    }
    setCapturingAuthoringKey(`bowel-center:${question.questionKey}`);
    try {
      const response = await runViewerCommand(commandsManager, 'captureBowelQuizLumenCenter');
      if (!response?.ok) {
        if (response?.reason !== 'cancelled') throw new Error(response?.reason || 'lumen centre not captured');
        return;
      }
      const point = plainObject(response.answer?.point);
      const target = plainObject(response.answer?.viewerTarget);
      const fields = ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID', 'frameNumber'];
      if (point.coordinateSpace !== 'world' ||
          !Array.isArray(response.answer?.physicalPoint) ||
          response.answer.physicalPoint.length !== 3 ||
          !response.answer.physicalPoint.every(Number.isFinite) ||
          fields.some(field => String(target[field] ?? '') !== String(referenceTarget[field] ?? ''))) {
        throw new Error('Select the lumen centre on the same DICOM frame as the captured gold BWT measurements.');
      }
      const sourceCalibration = plainObject(
        getBowelMeasurementSetEntries(config.goldMeasurements)[0]?.quizSpatialEvidence
      );
      const capturedCalibration = plainObject(response.answer.spatialCalibration);
      if (!sourceCalibration.pixelSpacing ||
          sourceCalibration.calibrationSource !== capturedCalibration.calibrationSource ||
          sourceCalibration.pixelSpacing.row !== capturedCalibration.pixelSpacing?.row ||
          sourceCalibration.pixelSpacing.column !== capturedCalibration.pixelSpacing?.column) {
        throw new Error('The lumen centre and BWT calipers have different physical calibration.');
      }
      patchAuthoringAnswerConfig(current, {
        measurementSet: {
          ...settings,
          lumenCenterPhysical: response.answer.physicalPoint,
          lumenCenterCalibration: capturedCalibration,
        },
      });
      uiNotificationService.show({
        title: 'Bowel measurement set',
        message: 'Lumen centre captured for angular separation scoring.',
        type: 'success', duration: 3000,
      });
    } catch (error) {
      uiNotificationService.show({
        title: 'Bowel measurement set',
        message: error?.message || String(error),
        type: 'warning', duration: 5000,
      });
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  async function saveAuthoringDraft() {
    if (!authoringDefinition || !isDraftDefinition(authoringDefinition)) {
      return;
    }

    if (restoringCompositeAreaKey) {
      uiNotificationService.show({
        title: 'Save Draft', type: 'warning', duration: 4000,
        message: 'Complete the calibrated gold-area recovery before saving.',
      });
      return;
    }
    setAuthoringSaving(true);
    setErrorMessage('');

    try {
      const definitionId = getDefinitionId(authoringDefinition);
      // In an educator's active composite question, Save Draft accepts the
      // completed viewer-calculated gold result before serializing question
      // JSON. A frame-incomplete or mismatched measurement is never inferred.
      const activeAuthoringKey = activeQuestionKey.startsWith('authoring:')
        ? activeQuestionKey.slice('authoring:'.length) : '';
      const currentQuestion = authoringQuestionsRef.current.find(
        item => item.questionKey === activeAuthoringKey
      );
      if (currentQuestion && !capturingAuthoringKey) {
        const snapshot = await runViewerCommand(
          commandsManager, 'getViewerMeasurementSnapshotForPanel', {}
        );
        const captureSignature = getCompositeGoldCaptureSignature(currentQuestion, snapshot);
        if (captureSignature) {
          const kind = cleanString(
            plainObject(currentQuestion.answerConfig).measurementKind
          );
          const diagnostic = await runViewerCommand(
            commandsManager, 'getViewerQuizCompositeStatusForActiveStudy',
            { measurementKind: kind }
          );
          if (diagnostic?.complete !== true) {
            throw new Error('Calculated ' + kind + ' gold is not ready: ' +
              (cleanString(diagnostic?.message) ||
                'the phase measurements are not calibrated or their source evidence is incomplete.') +
              ' No invalid gold value has been saved.');
          }
          const saved = plainObject(plainObject(currentQuestion.answerConfig).goldMeasurement);
          // A display-only backfill must never silently alter the gold scalar
          // or previously verified source contours.
          const safeBackfill = !captureSignature.startsWith('backfill:') ||
            (saved.value != null && diagnostic.value != null &&
             Math.round(Number(saved.value) * 100) ===
             Math.round(Number(diagnostic.value) * 100));
          const accepted = safeBackfill
            ? await captureAuthoringMeasurement(currentQuestion, { silent: true })
            : true;
          if (accepted !== true) {
            throw new Error('The ' + kind + ' calculation is complete but cannot be captured as gold: ' +
              (lastCompositeGoldCaptureErrorRef.current ||
                'check that every contour uses the required DICOM source frame.') +
              ' No invalid gold value has been saved.');
          }
        }
      }
      const incompleteReplacement = getIncompleteCompositeGoldReplacementReason(
        authoringQuestionsRef.current
      );
      if (incompleteReplacement) throw new Error(incompleteReplacement);
      const questionsToSave = authoringQuestionsRef.current;
      const hasMeasurementQuestions = questionsToSave.some(
        question => question.type === 'measurementNumeric'
      );

      if (hasMeasurementQuestions && !authoringMeasurementDomain) {
        throw new Error('Measurement domain is missing from the educational asset. Configure Echo or Bowel before opening the viewer.');
      }
      const incompleteEF = questionsToSave.find(question => {
        const config = plainObject(question.answerConfig);
        return question.type === 'measurementNumeric' &&
          config.measurementKind === 'lvSimpsonEF' &&
          config.efContourFrameGuidanceEnabled === true &&
          !getCompleteEFContourFrameTargets(config);
      });
      if (incompleteEF) {
        throw new Error('Capture all four EF contour instance/frame targets before saving guided EF navigation.');
      }

      const saveSource = 'authoring';
      const saveRequestId = nextEducationSaveRequestId();
      reportEducationSaveStart(saveSource, saveRequestId);
      let result;
      try {
        result = await saveViewerQuizAuthoringDraft({
        definitionId,
        title: authoringDefinition.title || '',
        description: authoringDefinition.description || '',
        changeSummary: 'Viewer authoring update',
        domain: authoringMeasurementDomain || normalizeQuizMeasurementDomain(authoringDefinition.domain),
        workflow: authoringDefinition.workflow || 'library',
        viewerMode: authoringDefinition.viewerMode || 'iuscan',
        questions: questionsToSave,
        rubricId: getRubricId(authoringRubric),
        rubricItems: buildAuthoringRubricItems(questionsToSave),
        });
        reportEducationSaveResult(saveSource, saveRequestId, true);
      } catch (saveError) {
        reportEducationSaveResult(saveSource, saveRequestId, false);
        throw saveError;
      }

      // The server response alone does not prove the versioned gold survived
      // sanitization. Read back the draft from FormAPI before notifying the
      // portal or replacing local editor evidence.
      const persistedPayload = await getViewerQuizAuthoringContent();
      const persistedDefinition = (Array.isArray(persistedPayload?.definitions)
        ? persistedPayload.definitions : []).find(definition =>
        getDefinitionId(definition) === definitionId
      );
      if (!persistedDefinition || !Array.isArray(persistedDefinition.questions)) {
        throw new Error('Draft saved but its contents could not be verified in FormAPI. Refresh before publishing.');
      }
      const persistenceError = getCompositeGoldPersistenceError(
        questionsToSave, persistedDefinition.questions
      );
      if (persistenceError) {
        throw new Error('Draft save verification failed: ' + persistenceError +
          ' The existing local answers were preserved for investigation.');
      }
      const savedDefinition = persistedDefinition;
      const savedQuestions = savedDefinition.questions;

      if (savedDefinition) {
        setAuthoringDefinition(savedDefinition);
      }

      authoringQuestionsRef.current = savedQuestions;
      setAuthoringQuestions(savedQuestions);
      writeViewerQuizSessionState(sessionStateKey, {
        authoringDefinitionId: definitionId,
        authoringServerUpdatedAt: String(savedDefinition?.updatedAt || ''),
        authoringQuestions: savedQuestions,
      });

      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: 'Draft quiz saved.',
        type: 'success',
        duration: 3000,
      });

      notifyQuizAuthoringSaved({
        definitionId,
        libraryContentKey: cleanString(
          authoringPayload?.libraryContentKey ||
            getViewerQuizAuthoringContextFromUrl().libraryContentKey
        ),
        quizKey: savedDefinition?.quizKey || authoringDefinition.quizKey,
        quizVersion: Number(savedDefinition?.quizVersion || authoringDefinition.quizVersion || 1),
      });

      await refreshAuthoring({
        silent: true,
        preferredDefinitionId: definitionId,
      });
      return result;
    } catch (error) {
      const message = `Authoring save failed: ${error?.message || error}`;
      setErrorMessage(message);
      uiNotificationService.show({
        title: 'Quiz Authoring',
        message,
        type: 'error',
        duration: 10000,
      });
      throw error;
    } finally {
      setAuthoringSaving(false);
    }
  }

  async function previewQuizIVCMeasurement(quizKey: string, question: QuizQuestion) {
    const config = plainObject(question.answerConfig);
    const result = await runViewerCommand(commandsManager, 'getSelectedViewerMeasurementQuizAnswer', {
      question: {
        ...question,
        answerConfig: { ...config, measurementKind: 'ivcCollapsibility', unit: '%' },
      },
      unit: '%',
      measurementType: '',
    });
    if (!result?.ok || result.answer?.measurementKind !== 'ivcCollapsibility') {
      uiNotificationService.show({
        title: 'IVC / RAP / RVSP',
        message: 'Complete both calibrated IVC calipers before interpreting RAP. ' +
          cleanString(result?.reason || ''),
        type: 'warning',
        duration: 5000,
      });
      return;
    }
    const selectionKey = `${quizKey}:${question.questionKey}`;
    const previouslyReviewed = ivcPreviewByQuestionKey[selectionKey];
    if (previouslyReviewed && !isIVCReviewCurrent(previouslyReviewed, result.answer)) {
      // A new caliper review requires a new, explicit RAP interpretation.
      setRapSelectionsByQuestionKey(current => ({ ...current, [selectionKey]: '' }));
    }
    setIvcPreviewByQuestionKey(current => ({
      ...current,
      [selectionKey]: result.answer,
    }));
  }

  async function ensureConfiguredCompositePhaseFrame(question: QuizQuestion, slot: string) {
    const config = plainObject(question.answerConfig);
    if (config.compositeFrameGuidanceEnabled !== true) return true;
    // A deleted phase temporarily leaves one slot without a saved source.
    // Do not require *all* sources before allowing the educator to redraw an
    // individually configured phase. Full uniqueness/study validation still
    // applies when accepting the completed calculated gold answer.
    const target = plainObject(config.compositeFrameTargets)[slot];
    if (!target || !cleanString(target.sopInstanceUID) ||
        !Number.isInteger(Number(target.frameNumber)) || Number(target.frameNumber) < 1) {
      uiNotificationService.show({
        title: 'Quiz Authoring', type: 'warning', duration: 6000,
        message: 'Choose the replacement ' + slot + ' DICOM frame and Capture current instance/frame before drawing its gold contour.',
      });
      return false;
    }
    try {
      const jumped = await runViewerCommand(commandsManager, 'jumpToViewerQuizTarget', {
        viewerTarget: target, questionKey: question.questionKey,
      });
      if (!jumped?.ok) return false;
      // Cross-series navigation can load the requested DICOM into another
      // available viewport. Make it active before checking or drawing.
      if (cleanString(jumped.viewportId)) {
        await runViewerCommand(commandsManager, 'setViewportActive', {
          viewportId: jumped.viewportId,
        });
      }
      const response = await runViewerCommand(commandsManager, 'getCurrentViewerQuizFrameAnswer', {});
      const actual = plainObject(response?.answer?.selectedTarget);
      const matches = response?.ok === true &&
        matchesConfiguredCompositeFrame(actual, target);
      if (!matches) {
        uiNotificationService.show({
          title: 'Case Questions',
          message: 'The selected measurement image/frame is not active. Open the configured target and retry.',
          type: 'warning', duration: 6000,
        });
      }
      return matches;
    } catch (error) {
      console.warn('[CaseQuestionsPanel] configured phase navigation failed:', error);
      return false;
    }
  }

  async function activateQuestionForPhaseCapture(quiz: QuizDefinition, question: QuizQuestion) {
    if (activeQuestionKey !== `${quiz.quizKey}:${question.questionKey}`) {
      await selectQuestion(quiz, question, { force: true });
    }
  }

  function renderIVCCaliperControls(quiz: QuizDefinition, question: QuizQuestion, disabled: boolean) {
    return (
      <div className="mt-2 rounded border border-cyan-700/70 p-2 text-xs">
        <div className="mb-1 font-semibold text-cyan-100">IVC phase measurements</div>
        <p className="mb-2 text-gray-300">
          Choose expiration or inspiration below, then draw the calibrated
          Length caliper. The selected phase is assigned automatically.
        </p>
        <div className="space-y-2">
          {[
            { slot: 'IVC_EXP', label: 'Measure expiration (IVCexp)' },
            { slot: 'IVC_INSP', label: 'Measure inspiration (IVCinsp)' },
          ].map(phase => (
            <div key={phase.slot} className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              className="rounded border border-cyan-600 px-2 py-1 text-cyan-100 disabled:opacity-40"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                void (async () => {
                  await activateQuestionForPhaseCapture(quiz, question);
                  if (!(await ensureConfiguredCompositePhaseFrame(question, phase.slot))) return;
                  // Clicking a specific IVC phase is explicit learner intent.
                  // Bind the next completed Length source to it without a
                  // second, redundant label selection dialog.
                  pendingQuizIVCPhaseRef.current = {
                    activationKey: `${quiz.quizKey}:${question.questionKey}`,
                    slot: phase.slot,
                    target: plainObject(question.answerConfig).compositeFrameGuidanceEnabled === true
                      ? plainObject(plainObject(question.answerConfig).compositeFrameTargets)[phase.slot]
                      : null,
                    issuedAt: Date.now(),
                  };
                  await runViewerCommand(commandsManager, 'setViewerLengthLabelMode', {
                    labelMode: 'measure-only',
                  });
                  const activation = await runViewerCommand(
                    commandsManager, 'activateViewerMeasurementTool', {
                      toolName: 'Length', stopCine: true,
                    }
                  );
                  if (activation?.ok === false) {
                    uiNotificationService.show({
                      title: 'IVC measurement',
                      message: 'The calibrated Length tool could not be activated.',
                      type: 'warning', duration: 5000,
                    });
                  }
                })();
              }}
            >
              {phase.label}
            </button>
            {renderCompositePhaseStatusAndDelete(quiz, question, phase.slot, disabled)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderLAVolumeContourControls(quiz: QuizDefinition, question: QuizQuestion, disabled: boolean) {
    const views = [
      { slot: 'A4C', label: 'Apical four-chamber' },
      { slot: 'A2C', label: 'Apical two-chamber' },
    ];
    const config = plainObject(question.answerConfig);
    return (
      <div className="mt-2 rounded border border-cyan-700 bg-cyan-950/20 p-2 text-xs">
        <div className="mb-1 font-semibold text-cyan-100">LA volume contour technique</div>
        <p className="mb-2 text-gray-300">
          For each apical view, navigate to its selected end-systolic DICOM frame.
          Freehand: click a mitral hinge, trace the LA cavity without holding the mouse,
          and finish at the opposite hinge. Axis + apex: draw the annular line and superior LA axis.
        </p>
        {views.map(({ slot, label }) => (
          <div key={slot} className="mb-2 flex flex-wrap items-center gap-2">
            <span className="min-w-40 font-medium text-gray-100">{label}</span>
            {[
              { text: 'Freehand', contourTechnique: 'freehand' },
              { text: 'Axis + apex', contourTechnique: 'axisApex' },
            ].map(choice => (
              <button
                key={choice.contourTechnique}
                type="button"
                disabled={disabled || (config.compositeFrameGuidanceEnabled === true &&
                  !plainObject(config.compositeFrameTargets)[slot]?.sopInstanceUID)}
                className="rounded border border-cyan-600 px-2 py-1 text-cyan-100 disabled:opacity-40"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  void (async () => {
                    await activateQuestionForPhaseCapture(quiz, question);
                    if (!(await ensureConfiguredCompositePhaseFrame(question, slot))) return;
                    await runViewerCommand(commandsManager, 'startLAVolumeWorkflow', {
                      slot,
                      contourTechnique: choice.contourTechnique,
                      autoContinue: false,
                    });
                  })();
                }}
              >
                {choice.text}
              </button>
            ))}
            {renderCompositePhaseStatusAndDelete(quiz, question, slot, disabled)}
          </div>
        ))}
      </div>
    );
  }

  function renderRVFACContourControls(quiz: QuizDefinition, question: QuizQuestion, disabled: boolean) {
    const slots = [
      { slot: 'RV_ED', label: 'End-diastolic area (RVEDA)' },
      { slot: 'RV_ES', label: 'End-systolic area (RVESA)' },
    ];
    const config = plainObject(question.answerConfig);
    return (
      <div className="mt-2 rounded border border-cyan-700 bg-cyan-950/20 p-2 text-xs">
        <div className="mb-1 font-semibold text-cyan-100">RV FAC contour technique</div>
        <div className="mb-2 text-gray-300">
          Navigate to the required DICOM instance and frame for each phase, then
          choose either freehand tracing or annulus-axis + apex placement.
          The measurement result, not the drawing technique, is scored.
        </div>
        {slots.map(({ slot, label }) => (
          <div key={slot} className="mb-2 flex flex-wrap items-center gap-2">
            <span className="min-w-44 font-medium text-gray-100">{label}</span>
            {[
              { text: 'Freehand', command: 'startEchoAreaContourWorkflow' },
              { text: 'Axis + apex', command: 'startGuidedRVFACContourWorkflow' },
            ].map(choice => (
              <button
                key={choice.command}
                type="button"
                disabled={disabled || (config.compositeFrameGuidanceEnabled === true &&
                  !plainObject(config.compositeFrameTargets)[slot]?.sopInstanceUID)}
                className="rounded border border-cyan-600 px-2 py-1 text-cyan-100 disabled:opacity-40"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  void (async () => {
                    await activateQuestionForPhaseCapture(quiz, question);
                    if (!(await ensureConfiguredCompositePhaseFrame(question, slot))) return;
                    await runViewerCommand(commandsManager, choice.command, {
                      slot, clickTrace: choice.command === 'startEchoAreaContourWorkflow',
                    });
                  })();
                }}
              >
                {choice.text}
              </button>
            ))}
            {renderCompositePhaseStatusAndDelete(quiz, question, slot, disabled)}
          </div>
        ))}
      </div>
    );
  }

  function renderLearnerIVCRapReview(
    quiz: QuizDefinition, question: QuizQuestion, savedAnswer: any, disabled: boolean
  ) {
    if (authoringMode ||
        cleanString(plainObject(question.answerConfig).measurementKind) !== 'ivcCollapsibility') {
      return null;
    }
    const answer = plainObject(savedAnswer);
    const completeIVC = answer.measurementKind === 'ivcCollapsibility' &&
      answer.unit === '%' &&
      getLearnerCompositeSourceComponents(answer, 'ivcCollapsibility').length === 2;
    const all = quiz.questions || [];
    const index = all.findIndex(item => item.questionKey === question.questionKey);
    const priorTR = index > 0 ? all.slice(0, index).reverse().find(item =>
      item.type === 'measurementNumeric' &&
      cleanString(plainObject(item.answerConfig).measurementKind) === 'trVmax') : null;
    const trAnswer = priorTR
      ? answersByQuizKey?.[quiz.quizKey]?.[priorTR.questionKey] : null;
    const trValue = Number(trAnswer?.value);
    const trIsRecorded = trAnswer?.measurementKind === 'trVmax' &&
      trAnswer?.unit === 'm/s' &&
      !!cleanString(trAnswer?.sourceAnnotationId) &&
      !!cleanString(trAnswer?.viewerTarget?.sopInstanceUID) &&
      Number.isFinite(trValue) && trValue > 0 && trValue <= 8;
    const key = `${quiz.quizKey}:${question.questionKey}`;
    const saved = plainObject(answer.compositeResult);
    const reviewedRAP = saved.rapRvsp?.ivc &&
      isIVCReviewCurrent(saved.rapRvsp.ivc, answer)
      ? saved.rapMMHG : null;
    const selection = rapSelectionsByQuestionKey[key] ??
      (reviewedRAP != null ? String(reviewedRAP) : '');

    return (
      <div className="mt-2 rounded border border-cyan-700 bg-cyan-950/20 p-2 text-xs text-cyan-100">
        <div className="font-semibold">After measuring IVC: select your RAP</div>
        <div className="mt-1 text-gray-300">
          AR calculates RVSP from your RAP and the TR Vmax you previously
          captured in this quiz. RAP is not inferred from collapsibility.
        </div>
        <label className="mt-2 flex items-center gap-2">
          RAP
          <select aria-label="Learner RAP (mmHg)"
            value={selection} disabled={disabled || !completeIVC}
            className="rounded border border-cyan-600 bg-black px-2 py-1"
            onClick={event => event.stopPropagation()}
            onChange={event => {
              const value = event.target.value;
              setRapSelectionsByQuestionKey(current => ({ ...current, [key]: value }));
              if (!value || !completeIVC) return;
              const calculated = attachLearnerRapRvspToIVCAnswer({
                ivcAnswer: answer, rapMMHG: value,
                trVmaxAnswer: trAnswer, trVmaxQuestionKey: priorTR?.questionKey || '',
              });
              if (calculated.status === 'complete') {
                setAnswer(quiz.quizKey, question, calculated.answer);
              } else {
                uiNotificationService.show({
                  title: 'RAP / RVSP',
                  type: 'warning', duration: 5500,
                  message: calculated.reason === 'previous-tr-vmax-required'
                    ? 'Record a calibrated TR Vmax answer earlier in this quiz before RVSP can be calculated and saved.'
                    : 'The IVC source evidence must be current before RVSP can be calculated.',
                });
              }
            }}
          >
            <option value="">Select RAP</option>
            {RAP_CHOICES_MMHG.map(rap => (
              <option key={rap} value={String(rap)}>{rap} mmHg</option>
            ))}
          </select>
        </label>
        {!completeIVC ? (
          <div className="mt-1 text-amber-200">
            Complete both calibrated IVC phase measurements first.
          </div>
        ) : !trIsRecorded ? (
          <div className="mt-1 text-amber-200">
            RVSP unavailable: a source-linked TR Vmax answer must be recorded earlier in this quiz.
          </div>
        ) : (
          <div className="mt-1 text-green-200">
            Recorded TR Vmax: {trValue.toFixed(2)} m/s
          </div>
        )}
        {reviewedRAP != null && Number.isFinite(Number(saved.rvspMMHG)) ? (
          <div className="mt-2 rounded border border-emerald-700 p-2 text-emerald-100">
            Saved learner RAP: {reviewedRAP} mmHg
            <div>Calculated RVSP: {Number(saved.rvspMMHG).toFixed(2)} mmHg</div>
            <div className="text-gray-300">Both values are included in the quiz answer on Save or Submit.</div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderIVCRapRVSPControls(
    quizKey: string,
    question: QuizQuestion,
    savedAnswer: any,
    disabled: boolean
  ) {
    const selectionKey = `${quizKey}:${question.questionKey}`;
    const existing = plainObject(savedAnswer?.compositeResult);
    const currentSelection = rapSelectionsByQuestionKey[selectionKey] ??
      (existing.rapMMHG != null ? String(existing.rapMMHG) : '');
    const reviewedIVC = ivcPreviewByQuestionKey[selectionKey] || existing.ivc;
    const ivcDerived = plainObject(plainObject(reviewedIVC?.compositeResult).derived);
    const canInterpret = reviewedIVC?.measurementKind === 'ivcCollapsibility' &&
      reviewedIVC?.compositeResult?.methodId === 'ivc-collapsibility-v1' &&
      Number.isFinite(Number(reviewedIVC?.value));

    const questionList = quizKey === 'authoring'
      ? authoringQuestions
      : (quizzes.find(item => item.quizKey === quizKey)?.questions || []);
    const index = questionList.findIndex(item => item.questionKey === question.questionKey);
    const previousTR = index > 0
      ? questionList.slice(0, index).reverse().find(item =>
          cleanString(plainObject(item.answerConfig).measurementKind) === 'trVmax'
        )
      : null;
    const priorTRAnswer = previousTR
      ? quizKey === 'authoring'
        ? plainObject(previousTR.answerConfig).goldMeasurement
        : answersByQuizKey?.[quizKey]?.[previousTR.questionKey]
      : null;
    const trValue = Number(priorTRAnswer?.value);
    const validTR = priorTRAnswer?.measurementKind === 'trVmax' &&
      priorTRAnswer?.unit === 'm/s' &&
      Number.isFinite(trValue) && trValue > 0;

    const proposedRAP = Number(currentSelection);
    const proposedGradient = validTR ? Number((4 * trValue * trValue).toFixed(2)) : null;
    const proposedRVSP = canInterpret && proposedGradient !== null &&
      RAP_CHOICES_MMHG.some(value => value === proposedRAP)
        ? Number((proposedGradient + proposedRAP).toFixed(2))
        : null;

    return (
      <div className="mt-2 space-y-2 rounded border border-cyan-700 bg-cyan-950/20 p-2 text-xs">
        <div className="font-semibold text-cyan-100">IVC / RAP / RVSP</div>
        <div className={validTR ? 'text-green-200' : 'text-amber-200'}>
          Previous TR Vmax: {validTR
            ? `${trValue.toFixed(2)} m/s · ${previousTR?.title || previousTR?.questionKey}`
            : 'Capture the earlier TR Vmax question first.'}
        </div>
        <div className="text-gray-300">
          Measure IVC end-expiration and end-inspiration diameters on the specified
          image/frame targets. The viewer calculates collapsibility.
        </div>
        <button
          type="button"
          className="rounded border border-cyan-500 px-2 py-1 font-semibold text-cyan-100 disabled:opacity-50"
          disabled={disabled}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            void previewQuizIVCMeasurement(quizKey, question);
          }}
        >
          Review measured IVC and calculate collapsibility
        </button>
        {canInterpret ? (
          <div className="rounded border border-cyan-600 bg-cyan-950/40 p-2 text-cyan-100">
            <div>IVC expiration: {Number.isFinite(Number(ivcDerived.expirationDiameterMM))
              ? (Number(ivcDerived.expirationDiameterMM) / 10).toFixed(2) + ' cm' : 'saved calibrated caliper'}</div>
            <div>IVC inspiration: {Number.isFinite(Number(ivcDerived.inspirationDiameterMM))
              ? (Number(ivcDerived.inspirationDiameterMM) / 10).toFixed(2) + ' cm' : 'saved calibrated caliper'}</div>
            <div>Calculated collapsibility: {Number(reviewedIVC.value).toFixed(1)}%</div>
          </div>
        ) : (
          <div className="text-amber-200">
            RAP selection becomes available after both IVC calipers are reviewed.
          </div>
        )}
        <label className="flex flex-wrap items-center gap-2 font-semibold text-cyan-100">
          RAP interpretation
          <select
            aria-label="RAP interpretation (mmHg)"
            className="rounded border border-cyan-600 bg-black px-2 py-1 text-white"
            value={currentSelection}
            disabled={disabled || !canInterpret}
            onChange={event => setRapSelectionsByQuestionKey(current => ({
              ...current,
              [selectionKey]: event.target.value,
            }))}
            onClick={event => event.stopPropagation()}
          >
            <option value="">Select RAP</option>
            {RAP_CHOICES_MMHG.map(rap => (
              <option key={rap} value={String(rap)}>{rap} mmHg</option>
            ))}
          </select>
        </label>
        {proposedRVSP !== null ? (
          <div className="rounded border border-blue-600 bg-blue-950/30 p-2 text-blue-100">
            Proposed TR gradient: {proposedGradient} mmHg
            <div>Proposed RVSP: {proposedRVSP} mmHg (from selected RAP and previously recorded TR Vmax)</div>
          </div>
        ) : null}
        {existing.methodId === 'ivc-rap-rvsp-v1' ? (
          <div className="rounded border border-green-700 bg-green-950/30 p-2 text-green-100">
            <div>IVC collapsibility: {existing.ivc?.value ?? '—'}%</div>
            <div>Manual RAP: {existing.rapMMHG} mmHg</div>
            <div>TR gradient: {existing.trGradientMMHG} mmHg</div>
            <div>Calculated RVSP: {existing.rvspMMHG} mmHg</div>
          </div>
        ) : (
          <div className="text-gray-300">
            Review your chosen RAP and select Accept measurement after both IVC
            calipers and the preceding TR Vmax are complete.
          </div>
        )}
      </div>
    );
  }

  function renderQuestion(quiz: QuizDefinition, question: QuizQuestion, disabled = false) {
    const quizAnswers = answersByQuizKey[quiz.quizKey] || {};
    const value = quizAnswers[question.questionKey];
    const choices = getQuestionChoices(question);
    const markerOptions = normalizeMarkerOptions(getMarkerOptions(question));

    if (question.type === 'single_choice' || question.type === 'true_false') {
      return (
        <div className="mt-2 space-y-1">
          {choices.map(choice => {
            const choiceValue = normalizeChoiceValue(choice.value);
            const selected = normalizeChoiceValue(value) === choiceValue;

            return (
              <label
                key={choiceValue}
                className="flex cursor-pointer items-center gap-2 rounded border border-gray-700 px-2 py-1 text-sm hover:border-blue-400 hover:bg-gray-900"
              >
                <input
                  type="radio"
                  name={`${quiz.quizKey}-${question.questionKey}`}
                  checked={selected}
                  onChange={() => setAnswer(quiz.quizKey, question, choice.value)}
                  disabled={disabled}
                />
                <span>{choice.label || choice.value}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (question.type === 'multi_select') {
      const selectedValues = Array.isArray(value) ? value.map(normalizeChoiceValue) : [];

      return (
        <div className="mt-2 space-y-1">
          {choices.map(choice => {
            const choiceValue = normalizeChoiceValue(choice.value);
            const selected = selectedValues.includes(choiceValue);

            return (
              <label
                key={choiceValue}
                className="flex cursor-pointer items-center gap-2 rounded border border-gray-700 px-2 py-1 text-sm hover:border-blue-400 hover:bg-gray-900"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleMultiSelectAnswer(quiz.quizKey, question, choice.value)}
                  disabled={disabled}
                />
                <span>{choice.label || choice.value}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (question.type === 'frameSelection') {
      const captureKey = `${quiz.quizKey}:${question.questionKey}`;
      const captureInProgress = capturingFrameKey === captureKey;
      const frameNavigationError = frameNavigationErrors[captureKey] || '';
      const selectedTarget = plainObject(value?.selectedTarget);

      return (
        <div className="mt-2 space-y-2">
          {frameNavigationError ? (
            <div className="rounded border border-amber-700 bg-amber-950/30 p-2 text-xs text-amber-100" role="alert">
              {frameNavigationError}
            </div>
          ) : null}
          <button
            type="button"
            className="hover:bg-blue-950 rounded border border-blue-500 px-2 py-1 text-xs font-semibold text-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || captureInProgress}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              captureCurrentFrameAnswer(quiz, question);
            }}
          >
            {captureInProgress ? 'Capturing frame…' : 'Use current frame as answer'}
          </button>

          {targetHasNavigationIdentity(selectedTarget) ? (
            <div className="bg-green-950/30 rounded border border-green-700 px-2 py-1 text-xs text-green-100">
              Captured {getViewerTargetSummary(selectedTarget)}
            </div>
          ) : (
            <div className="text-xs text-gray-400">
              {shouldGuideFrameSelectionToInstance(question)
                ? 'Scroll or cine to the desired frame, then capture the current frame.'
                : 'Find the correct instance and frame in the study, then capture the current frame.'}
            </div>
          )}
        </div>
      );
    }

    if (isMarkerChoiceQuestionType(question)) {
      const selectedMarkerIds = normalizeMarkerIdList(value);

      return (
        <div className="mt-2 space-y-1">
          {markerOptions.length ? (
            markerOptions.map(marker => {
              const markerId = cleanString(marker.markerId || marker.markerKey || marker.value);
              const selected = selectedMarkerIds.includes(markerId);

              return (
                <label
                  key={markerId}
                  className="flex cursor-pointer items-center gap-2 rounded border border-gray-700 px-2 py-1 text-sm hover:border-blue-400 hover:bg-gray-900"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={async () => {
                      const nextSelectedMarkerIds = toggleMarkerId(selectedMarkerIds, markerId);
                      const selectedMarkerSet = new Set(nextSelectedMarkerIds);
                      const nextAnswer = {
                        selectedMarkerIds: nextSelectedMarkerIds,
                        selectedMarkers: markerOptions.filter(option =>
                          selectedMarkerSet.has(
                            cleanString(option.markerId || option.markerKey || option.value)
                          )
                        ),
                      };

                      setAnswer(quiz.quizKey, question, nextAnswer);

                      try {
                        await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
                          viewerTarget: getQuestionViewerTarget(question),
                          markerOptions: getLearnerMarkerOverlayOptions(question, nextAnswer),
                          questionKey: question.questionKey,
                        });
                      } catch (error) {
                        console.warn(
                          '[CaseQuestionsPanel] marker selection overlay refresh failed:',
                          error
                        );
                      }
                    }}
                    disabled={disabled}
                  />
                  <span>{marker.label || markerId}</span>
                </label>
              );
            })
          ) : (
            <div className="text-xs text-orange-300">
              No marker options are available for this question.
            </div>
          )}
        </div>
      );
    }

    if (isPlaceMarkerQuestionType(question)) {
      const captureKey = `${quiz.quizKey}:${question.questionKey}`;
      const captureInProgress = capturingPointKey === captureKey;
      const placedMarker = plainObject(value?.placedMarker || value);
      const point = plainObject(placedMarker.point || value?.point);
      const hasPoint =
        point.x !== null && point.x !== undefined && point.y !== null && point.y !== undefined;

      return (
        <div className="mt-2 space-y-2">
          <button
            type="button"
            className="hover:bg-blue-950 rounded border border-blue-500 px-2 py-1 text-xs font-semibold text-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || captureInProgress}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              capturePlacedMarkerAnswer(quiz, question);
            }}
          >
            {captureInProgress
              ? 'Click image to place marker…'
              : hasPoint
                ? 'Replace answer marker'
                : 'Place answer marker'}
          </button>

          {hasPoint ? (
            <div className="bg-green-950/30 rounded border border-green-700 px-2 py-1 text-xs text-green-100">
              Marker placed at {Number(point.x).toFixed(1)}, {Number(point.y).toFixed(1)}
            </div>
          ) : (
            <div className="text-xs text-gray-400">
              Use the dedicated quiz marker tool: click “Place answer marker,” then click the image.
            </div>
          )}
        </div>
      );
    }

    if (question.type === 'measurementNumeric') {
      const captureKey = `${quiz.quizKey}:${question.questionKey}`;
      const captureInProgress = capturingMeasurementKey === captureKey;
      const linkedRVSP = cleanString(plainObject(question.answerConfig).measurementKind) === 'ivcRapRvsp';
      const bowelSet = isBowelMeasurementSetQuestion(question);
      const bowelEntries = getBowelMeasurementSetEntries(plainObject(value).measurements);
      const verifiedSpatial = trustedBowelSpatialByQuestion[`${quiz.quizKey}:${question.questionKey}`] || {};
      // The backend deliberately strips client-provided geometry from saved
      // answers. Use authoritative persisted learner annotation evidence only
      // when the local answer does not already hold fresh capture evidence.
      const bowelGeometryEntries = restoreBowelMeasurementSetDisplayEvidence(
        bowelEntries, verifiedSpatial
      );
      const bowelSettings = plainObject(plainObject(question.answerConfig).measurementSet);
      const bowelCount = Number(bowelSettings.requiredCount) || 2;
      const requiredBowelLabel = formatBowelBwtMeasurementLabel(bowelSettings.measurementTarget);
      const midpointSpacingMm = bowelSettings.orientation === 'longitudinal'
        ? getBowelMeasurementSetMidpointSpacingMm(bowelGeometryEntries)
        : null;
      const estimatedRadialAngle = bowelSettings.orientation === 'crossSection'
        ? getBowelMeasurementSetEstimatedRadialAngleDegrees(bowelGeometryEntries)
        : null;

      return (
        <div className="mt-2 w-full min-w-0 max-w-full space-y-2 overflow-hidden">
          {['ivcCollapsibility', 'ivcRapRvsp'].includes(
            cleanString(plainObject(question.answerConfig).measurementKind)
          ) ? renderIVCCaliperControls(quiz, question, disabled) : null}
          {['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(
            cleanString(plainObject(question.answerConfig).measurementKind)
          ) ? renderLAVolumeContourControls(quiz, question, disabled) : null}
          {cleanString(plainObject(question.answerConfig).measurementKind) === 'rvFAC'
            ? renderRVFACContourControls(quiz, question, disabled)
            : null}
          {renderCompositeCalculatedStatus(quiz, question)}
          {renderLearnerIVCRapReview(quiz, question, value, disabled)}
          {bowelSet ? (
            <div className="rounded border border-blue-700 bg-blue-950/20 p-2 text-xs text-gray-200">
              <div className="font-semibold" aria-live="polite">Bowel measurements: {bowelEntries.length} / {bowelCount}</div>
              <div className="mt-1 text-gray-400">
                Draw and label each BWT caliper on the same DICOM frame.
              </div>
              {requiredBowelLabel ? (
                <div className="mt-1 font-semibold text-blue-100">
                  Required anatomical label: {requiredBowelLabel}
                </div>
              ) : null}
              {bowelCaptureErrors[`${quiz.quizKey}:${question.questionKey}`] ? (
                <div className="mt-1 break-words text-amber-300" role="alert">
                  {bowelCaptureErrors[`${quiz.quizKey}:${question.questionKey}`]}
                </div>
              ) : null}
              {midpointSpacingMm !== null ? (
                <div className="mt-1 text-blue-200">
                  Caliper midpoint spacing: {midpointSpacingMm.toFixed(1)} mm (informational; not scored)
                </div>
              ) : null}
              {estimatedRadialAngle !== null ? (
                <div className="mt-1 text-blue-200" aria-live="polite">
                  Estimated radial angle: {estimatedRadialAngle.toFixed(1)}°
                  {' '}(from your BWT caliper axes; the official scored angle uses the educator-defined lumen centre)
                </div>
              ) : bowelSettings.orientation === 'crossSection' && bowelEntries.length >= 2 ? (
                <div className="mt-1 text-amber-200">
                  A live angle estimate is unavailable for these calipers. Check their DICOM calibration and radial alignment.
                </div>
              ) : null}
              {bowelEntries.map((measurement, index) => (
                <div key={measurement.sourceAnnotationId || index}
                  className="mt-1 flex items-center justify-between gap-2">
                  <span className="min-w-0 whitespace-normal break-words">
                    #{index + 1}: {formatBowelBwtMeasurementLabel(measurement.measurementType) || 'Unlabelled BWT'}
                    {' · '}{measurement.value} {measurement.unit}
                  </span>
                  <button type="button" data-quiz-review-action="learner"
                    className="shrink-0 text-blue-200 underline hover:text-white"
                    onClick={async event => {
                      event.preventDefault();
                      event.stopPropagation();
                      const key = `${quiz.quizKey}:${question.questionKey}`;
                      lastActivatedQuestionRef.current = key;
                      setActiveQuestionKey(key);
                      syncQuizMeasurementDomainToUrl(
                        getQuizQuestionMeasurementDomain(quiz, question, payload), { overwrite: true }
                      );
                      try {
                        await showLearnerBowelMeasurements(
                          quiz, question, bowelEntries, cleanString(measurement.sourceAnnotationId), true
                        );
                      } catch (error) {
                        console.warn('[CaseQuestionsPanel] BWT view failed', error);
                        uiNotificationService.show({
                          title: 'Bowel measurements',
                          message: 'The saved calipers could not be displayed.',
                          type: 'warning', duration: 5000,
                        });
                      }
                    }}
                  >View</button>
                  <button type="button" className="text-red-300 underline disabled:opacity-50"
                    disabled={disabled}
                    onClick={event => {
                      event.stopPropagation();
                      setAnswer(quiz.quizKey, question, {
                        measurements: bowelEntries.filter((_, i) => i !== index),
                      });
                    }}>Remove</button>
                </div>
              ))}
            </div>
          ) : linkedRVSP
            ? renderIVCRapRVSPControls(quiz.quizKey, question, value, disabled)
            : ['rvFAC', 'laVolumeBiplane', 'laVolumeBiplaneDisks',
              'ivcCollapsibility'].includes(
              cleanString(plainObject(question.answerConfig).measurementKind)
            ) ? (
              <div className="rounded border border-emerald-700/60 bg-emerald-950/20 p-2 text-xs text-emerald-100">
                {value?.value != null && Number.isFinite(Number(value.value))
                  ? `Calculated answer: ${Number(value.value).toFixed(2)} ${value.unit || ''}`
                  : 'Complete the required calibrated phases. The calculated answer will be captured automatically.'}
              </div>
            ) : (
                        <div className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden">
                          <input
                            className="min-w-0 flex-1 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            value={numberOrEmpty(value?.value)}
                            onChange={event =>
                              setAnswer(
                                quiz.quizKey,
                                question,
                                setObjectAnswerPart(value, {
                                  value: event.target.value,
                                  measurementType:
                                    value?.measurementType || question?.answerConfig?.measurementType || '',
                                  unit: value?.unit || question?.answerConfig?.unit || '',
                                })
                              )
                            }
                            disabled={disabled}
                            placeholder="Measurement value"
                          />
                          <div className="w-14 shrink-0 truncate rounded border border-gray-700 px-2 py-1 text-center text-sm text-gray-300">
                            {value?.unit || question?.answerConfig?.unit || ''}
                          </div>
                        </div>
            )}

          {!bowelSet ? <button
            type="button"
            className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || captureInProgress}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              captureSelectedMeasurementAnswer(quiz, question);
            }}
          >
            {captureInProgress
              ? 'Capturing…'
              : linkedRVSP
                ? 'Accept IVC / RAP / RVSP measurement'
              : ['rvFAC', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'ivcCollapsibility',
                  'lvSimpsonEF'].includes(cleanString(plainObject(question.answerConfig).measurementKind))
                ? 'Recalculate from measured contours'
                : 'Recapture selected measurement'}
          </button> : null}

          {cleanString(
            plainObject(value?.reviewPayload).label ||
            value?.measurementLabel ||
            value?.label
          ) ? (
            <div className="min-w-0 whitespace-normal break-words text-xs text-gray-300" title={cleanString(
              plainObject(value?.reviewPayload).label ||
              value?.measurementLabel ||
              value?.label
            )}>
              Measurement label: {cleanString(
                plainObject(value?.reviewPayload).label ||
                value?.measurementLabel ||
                value?.label
              )}
            </div>
          ) : null}

          {value?.value === null ||
          typeof value?.value === 'undefined' ||
          cleanString(value?.value) === '' ? (
            <div className="text-xs text-gray-400">
              {cleanString(plainObject(question.answerConfig).measurementKind) === 'lvSimpsonEF'
                ? 'Complete four LV contours, select Calculate EF in the EF panel, then capture the calculated result.'
                : cleanString(plainObject(question.answerConfig).measurementKind) === 'laVolumeBiplane'
                  ? 'Complete both LA contours, then capture the calculated volume.'
                  : 'Draw or select a measurement annotation in the viewport, then use it as the answer.'}
            </div>
          ) : null}
        </div>
      );
    }

    if (question.type === 'numeric') {
      return (
        <input
          className="mt-2 w-full rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
          type="number"
          value={value ?? ''}
          onChange={event => setAnswer(quiz.quizKey, question, event.target.value)}
          disabled={disabled}
        />
      );
    }

    return (
      <textarea
        className="mt-2 min-h-[80px] w-full rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
        value={value ?? ''}
        onChange={event => setAnswer(quiz.quizKey, question, event.target.value)}
        disabled={disabled}
      />
    );
  }

  function renderQuestionReview(quiz: QuizDefinition, question: QuizQuestion, quizScore: any) {
    const scoreItem = getQuizScoreQuestionItem(quizScore, question.questionKey);

    if (!scoreItem) {
      return null;
    }

    const persistedLearnerAnswer = answersByQuizKey?.[quiz.quizKey]?.[question.questionKey];
    const learnerAnswer = getReviewLearnerAnswer(question, persistedLearnerAnswer, scoreItem);
    const correctAnswerVisible = scoreItem.correctAnswerVisible === true;
    const learnerTarget = getReviewAnswerTarget(question, learnerAnswer);
    const correctTarget = getCorrectReviewTarget(question, scoreItem);
    const comparisonMarkers = getQuestionOverlayMarkerOptions(quiz, question, learnerAnswer, {
      reviewMode: 'comparison',
    });
    const correct = isQuizReviewItemCorrect(question, scoreItem);
    const reviewDetails = {
      ...plainObject(scoreItem.scoringDetails),
      ...plainObject(scoreItem.reviewDetails),
    };
    const bowelReference = plainObject(scoreItem.correctAnswer);
    const bowelGoldLengths = correctAnswerVisible && bowelReference.mode === 'bowelMeasurementSet'
      ? (Array.isArray(bowelReference.goldMeasurements) ? bowelReference.goldMeasurements : [])
      : [];
    const learnerBowelLengths = getBowelMeasurementSetEntries(plainObject(learnerAnswer).measurements);
    const markerDistanceDisplay = getReviewDistanceDisplay(reviewDetails, 'distance', 'distanceMm');
    const markerRadiusDisplay = getReviewDistanceDisplay(reviewDetails, 'radius', 'radiusMm');
    const learnerMeasurement = mergeReviewReferenceValues(
      persistedLearnerAnswer,
      scoreItem.learnerResponse,
      reviewDetails.learnerMeasurement
    );
    const rubricMeasurement = mergeReviewReferenceValues(
      question?.answerConfig?.goldMeasurement,
      scoreItem.correctAnswer,
      reviewDetails.goldMeasurement,
      reviewDetails.rubricMeasurement
    );
    const measurementUnit = cleanString(
      reviewDetails.unit ||
        learnerMeasurement.unit ||
        rubricMeasurement.unit ||
        question?.answerConfig?.unit
    );
    const learnerMeasurementLength = getMeasurementReviewLength(
      reviewDetails.learnerValue,
      learnerMeasurement
    );
    const correctMeasurementLength = getMeasurementReviewLength(
      reviewDetails.goldValue,
      rubricMeasurement,
      scoreItem.correctAnswer
    );
    const learnerMeasurementMidpoint =
      getMeasurementReviewMidpoint(reviewDetails.learnerCenter) ||
      getMeasurementReviewMidpoint(learnerMeasurement);
    const correctMeasurementMidpoint =
      getMeasurementReviewMidpoint(reviewDetails.goldCenter) ||
      getMeasurementReviewMidpoint(rubricMeasurement);
    const calculatedLengthDifference =
      learnerMeasurementLength !== null && correctMeasurementLength !== null
        ? Math.abs(learnerMeasurementLength - correctMeasurementLength)
        : null;
    const measurementLengthDifference = Number.isFinite(Number(reviewDetails.lengthDelta))
      ? Number(reviewDetails.lengthDelta)
      : calculatedLengthDifference;
    const calculatedMidpointDistance = getMeasurementMidpointDistance(
      learnerMeasurementMidpoint,
      correctMeasurementMidpoint
    );
    const measurementMidpointDistance = Number.isFinite(Number(reviewDetails.centerDistance))
      ? Number(reviewDetails.centerDistance)
      : calculatedMidpointDistance;

    const canShowMarkerComparison =
      (isMarkerChoiceQuestionType(question) || isPlaceMarkerQuestionType(question)) &&
      comparisonMarkers.length > 0;

    const canShowFrameComparison = question.type === 'frameSelection' && !!correctTarget;
    const canShowMeasurementComparison =
      question.type === 'measurementNumeric' &&
      correctAnswerVisible &&
      hasMeasurementComparisonReference(learnerMeasurement) &&
      hasMeasurementComparisonReference(rubricMeasurement);
    const canShowComparison =
      canShowMarkerComparison || canShowFrameComparison || canShowMeasurementComparison;
    const canShowLearnerAnswerButton =
      !!learnerTarget &&
      question.type !== 'measurementNumeric' &&
      !isPlaceMarkerQuestionType(question);
    const measurementRadius = reviewDetails.radius ?? plainObject(question.scoringConfig).radius;
    const measurementRadiusUnit =
      cleanString(reviewDetails.radiusUnit) ||
      cleanString(plainObject(question.scoringConfig).radiusUnit) ||
      'mm';

    return (
      <div
        className={`mt-3 rounded border p-2 text-xs ${
          correct
            ? 'bg-green-950/30 border-green-700 text-green-100'
            : 'bg-red-950/30 border-red-800 text-red-100'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">{correct ? 'Correct' : 'Needs review'}</div>
          <div>
            {Number(scoreItem.pointsAwarded || 0)} / {Number(scoreItem.pointsPossible || 0)}
          </div>
        </div>

        {question.type === 'measurementNumeric' ? (
          reviewDetails.mode === 'bowelMeasurementSet' ? (
            <div className="mt-2 space-y-1 text-gray-200">
              <div className="font-semibold">Bowel measurement set</div>
              <div>Captured: {reviewDetails.submittedCount ?? 0} / {reviewDetails.requiredCount ?? '—'}</div>
              <div>Within numeric tolerance: {reviewDetails.numericMatches ?? 0} / {reviewDetails.requiredCount ?? '—'}</div>
              {learnerBowelLengths.length > 0 ? (
                <div className="mt-1">
                  Your BWT lengths: {learnerBowelLengths.map((entry, i) =>
                    `#${i + 1} ${Number(entry.value).toFixed(2)} ${cleanString(entry.unit) || 'mm'}`
                  ).join(' · ')}
                </div>
              ) : null}
              {bowelGoldLengths.length > 0 ? (
                <div className="mt-1">
                  <span className="font-semibold">Correct reference lengths ({bowelGoldLengths.length}):</span>{' '}
                  {bowelGoldLengths.map((entry, i) =>
                    `#${i + 1} ${Number(entry.value).toFixed(2)} ${cleanString(entry.unit) || 'mm'}`
                  ).join(' · ')}
                </div>
              ) : null}
              <div>
                Spatial separation: {reviewDetails.spatial?.matched === true ? 'met' : 'not met'}
                {Number.isFinite(reviewDetails.spatial?.observed)
                  ? ` · ${Number(reviewDetails.spatial.observed).toFixed(1)} ${reviewDetails.spatial.unit || ''}`
                  : ''}
                {Number.isFinite(reviewDetails.spatial?.threshold)
                  ? ` (minimum ${reviewDetails.spatial.threshold} ${reviewDetails.spatial.unit || ''})`
                  : ''}
              </div>
              {bowelGoldLengths.length > 0 ? (
                <div className="mt-1 text-gray-300">
                  Scoring rule: match each captured length to a distinct reference within ±
                  {formatReviewNumber(bowelReference.numericTolerance, 2)} mm, then meet the
                  minimum {bowelReference.orientation === 'crossSection'
                    ? 'angular separation around the educator-defined lumen centre'
                    : 'axial separation along the bowel'}. The current rubric does not require
                  each learner caliper to be within a location radius of a gold caliper.
                </div>
              ) : null}
              {reviewDetails.reason ? <div className="text-amber-200">{reviewDetails.reason.replace(/_/g, ' ')}</div> : null}
            </div>
          ) : (
          <>
            <div className="mt-2">
              <div className="font-semibold">Your answer</div>
              <div className="mt-1 text-gray-300">
                Length: {formatMeasurementReviewLength(learnerMeasurementLength, measurementUnit)}
              </div>
              <div className="text-gray-300">
                Midpoint: {formatMeasurementReviewMidpoint(learnerMeasurementMidpoint)}
              </div>
            </div>

            {correctAnswerVisible ? (
              <div className="mt-2">
                <div className="font-semibold">Correct answer</div>
                <div className="mt-1 text-gray-300">
                  Length: {formatMeasurementReviewLength(correctMeasurementLength, measurementUnit)}
                </div>
                <div className="text-gray-300">
                  Midpoint: {formatMeasurementReviewMidpoint(correctMeasurementMidpoint)}
                </div>
              </div>
            ) : null}
          </>
          )
        ) : (
          <>
            <div className="mt-2">
              <span className="font-semibold">Your answer:</span>{' '}
              {formatReviewAnswer(question, learnerAnswer)}
            </div>

            {correctAnswerVisible ? (
              <div className="mt-1">
                <span className="font-semibold">Correct answer:</span>{' '}
                {formatCorrectReviewAnswer(question, scoreItem.correctAnswer)}
              </div>
            ) : null}
          </>
        )}

        {reviewDetails.mode === 'frameSelection' ? (
          <div className="mt-1 text-gray-300">
            {reviewDetails.frameSelectionMode === 'frame_only'
              ? 'Answer on assigned instance'
              : 'Instance match'}:{' '}
            {reviewDetails.frameSelectionMode === 'frame_only' &&
              typeof reviewDetails.guidedInstanceEligible === 'boolean'
              ? (reviewDetails.guidedInstanceEligible ? 'Yes' : 'No')
              : compareViewerTargetInstances(
                  reviewDetails.learnerTarget || scoreItem?.learnerResponse,
                  reviewDetails.goldTarget || scoreItem?.correctAnswer
                ) === false ? 'No' : 'Yes'}
            ; frame difference: {formatReviewNumber(reviewDetails.frameDelta)}; accepted tolerance:{' '}
            {formatReviewNumber(reviewDetails.toleranceFrames)} frame(s).
          </div>
        ) : null}

        {reviewDetails.mode === 'placeMarker' ? (
          <div className="mt-1 text-gray-300">
            Distance from correct marker: {formatReviewNumber(markerDistanceDisplay.value, 2)}{' '}
            {markerDistanceDisplay.unit}; accepted radius:{' '}
            {formatReviewNumber(markerRadiusDisplay.value, 2)} {markerRadiusDisplay.unit}.
          </div>
        ) : null}

        {reviewDetails.mode === 'measurementNumeric' ? (
          <div className="mt-1 space-y-1 text-gray-300">
            <div>
              Length difference: {formatReviewNumber(measurementLengthDifference, 2)}{' '}
              {measurementUnit}; accepted length tolerance: ±
              {formatReviewNumber(reviewDetails.absoluteTolerance, 2)} {measurementUnit}.
            </div>

            <div>
              Measurement length:{' '}
              {reviewDetails.lengthMatched === true ? 'within tolerance' : 'outside tolerance'}.
            </div>

            {measurementRadius !== null && typeof measurementRadius !== 'undefined' ? (
              <>
                <div>
                  Midpoint distance: {formatReviewNumber(measurementMidpointDistance, 2)}{' '}
                  {normalizeReviewDistanceUnit(measurementRadiusUnit)}; accepted location radius:{' '}
                  {formatReviewNumber(measurementRadius, 2)}{' '}
                  {normalizeReviewDistanceUnit(measurementRadiusUnit)}.
                </div>

                <div>
                  Location:{' '}
                  {reviewDetails.positionMatched === true
                    ? 'within tolerance'
                    : 'outside tolerance'}
                  .
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {isMarkerChoiceQuestionType(question) && correctAnswerVisible ? (
          <div className="mt-2 text-gray-300">
            Green = correctly selected; red = incorrectly selected; dashed amber = missed correct
            marker.
          </div>
        ) : null}

        {scoreItem.feedback ? (
          <div className="mt-2 rounded border border-gray-700 bg-black/30 p-2 text-gray-200">
            {scoreItem.feedback}
          </div>
        ) : null}

        {learnerTarget || correctTarget || canShowComparison ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {canShowLearnerAnswerButton ? (
              <button
                type="button"
                data-quiz-review-action="learner"
                className="hover:bg-blue-950 rounded border border-blue-500 px-2 py-1 font-semibold text-blue-100"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectQuestion(quiz, question, {
                    force: true,
                    viewerTarget: learnerTarget,
                    // Reviewing one's own captured frame is an explicit,
                    // authorized action. The initial question-click filter
                    // must not strip the learner's selected frame here.
                    revealExactFrame: question.type === 'frameSelection',
                    markerOptions: isPlaceMarkerQuestionType(question)
                      ? getPlacedAnswerMarkerOptions(learnerAnswer)
                      : [],
                  });
                }}
              >
                Show your answer
              </button>
            ) : null}

            {canShowComparison ? (
              <button
                type="button"
                data-quiz-review-action="correct"
                className="rounded border border-gray-500 px-2 py-1 font-semibold text-gray-100 hover:bg-gray-800"
                onClick={async event => {
                  event.preventDefault();
                  event.stopPropagation();

                  if (canShowMeasurementComparison) {
                    try {
                      const result = await runViewerCommand(
                        commandsManager,
                        'showViewerQuizMeasurementComparison',
                        {
                          learnerMeasurement,
                          rubricMeasurement,
                          viewerTarget:
                            correctTarget || learnerTarget || getQuestionViewerTarget(question),
                          questionKey: question.questionKey,
                          radius: measurementRadius,
                          radiusUnit: measurementRadiusUnit,
                        }
                      );

                      if (result?.learnerRendered !== true || result?.rubricRendered !== true) {
                        uiNotificationService.show({
                          title: 'Case Questions',
                          message:
                            'The learner and rubric measurement annotations could not both be displayed.',
                          type: 'warning',
                          duration: 4500,
                        });
                      }
                    } catch (error) {
                      console.warn('[CaseQuestionsPanel] measurement comparison failed:', error);
                    }
                    return;
                  }

                  selectQuestion(quiz, question, {
                    force: true,
                    revealExactFrame: question.type === 'frameSelection',
                    viewerTarget:
                      question.type === 'frameSelection'
                        ? correctTarget
                        : learnerTarget || correctTarget || getQuestionViewerTarget(question),
                    markerOptions: canShowMarkerComparison ? comparisonMarkers : [],
                  });
                }}
              >
                Show correct answer
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderAuthoringQuestion(question: QuizQuestion, index: number) {
    const answerConfig = plainObject(question.answerConfig);
    const bowelSet = isBowelMeasurementSetQuestion(question);
    const bowelSettings = plainObject(answerConfig.measurementSet);
    const goldBowelMeasurements = getBowelMeasurementSetEntries(answerConfig.goldMeasurements);
    const bowelValidation = bowelSet ? getBowelGoldValidation(question) : null;
    const markerOptions = normalizeMarkerOptions(answerConfig.markerOptions);
    const correctMarkerIds = getCorrectMarkerIdsFromAnswerConfig(answerConfig);
    const viewerTarget = getQuestionViewerTarget(question);
    const hasGuidedEFFrames = question.type === 'measurementNumeric' &&
      cleanString(answerConfig.measurementKind) === 'lvSimpsonEF';
    const compositePhaseSlots = COMPOSITE_FRAME_SLOTS[cleanString(answerConfig.measurementKind)] || [];
    const authoredCompositeFrames = plainObject(answerConfig.compositeFrameTargets);
    const compositeFramesComplete = !!getCompleteCompositeFrameTargets(answerConfig);
    const savedGoldComponents = getSavedGoldCompositeNavigationComponents(answerConfig);
    const efGoldRows = hasGuidedEFFrames
      ? getEFGoldContourAuthoringRows(answerConfig, savedGoldComponents) : [];
    const guidedEFFramesComplete = !!getCompleteEFContourFrameTargets(answerConfig);
    const targetSummary = getViewerTargetSummary(viewerTarget);
    const isCapturing = capturingAuthoringKey.endsWith(`:${question.questionKey}`);
    const isActiveAuthoringQuestion = activeQuestionKey === `authoring:${question.questionKey}`;
    const goldPoint = plainObject(answerConfig.goldPoint);
    const hasGoldPoint =
      goldPoint.x !== null &&
      goldPoint.x !== undefined &&
      goldPoint.y !== null &&
      goldPoint.y !== undefined;

    return (
      <div
        key={question.questionKey}
        className={`bg-gray-950/50 rounded border p-2 ${isActiveAuthoringQuestion ? 'border-blue-400' : 'border-gray-700'}`}
        onClick={() => selectQuestion({ quizKey: 'authoring', quizVersion: 1 }, question)}
      >
        {isActiveAuthoringQuestion ? (
          <div className="mb-1 inline-flex rounded bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">Active Question</div>
        ) : null}
        <div className="text-sm font-semibold">
          {index + 1}. {question.title || question.prompt || question.questionKey}
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">
          {question.type}
        </div>

        {targetHasNavigationIdentity(viewerTarget) && !compositePhaseSlots.length && (!hasGuidedEFFrames || (answerConfig.efContourFrameGuidanceEnabled !== true && savedGoldComponents.length === 0)) ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-blue-500 px-2 py-1 text-xs font-semibold text-blue-100 disabled:opacity-50"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                selectQuestion({ quizKey: 'authoring', quizVersion: 1 }, question, { force: true });
              }}
            >
              Jump to target
            </button>
            <span className="text-xs text-gray-400">
              You can also click this question card to jump to its saved instance/frame.
            </span>
          </div>
        ) : null}
        {question.prompt ? (
          <div className="mt-1 text-xs text-gray-300">{question.prompt}</div>
        ) : null}
        {isClassicAuthoringQuestion(question) ? (
          <div className="mt-2 rounded border border-gray-700 bg-gray-900 px-2 py-2 text-xs text-gray-300">
            <div className="font-semibold text-gray-100">No viewer authoring needed</div>
            <div className="mt-1">{getClassicAuthoringMessage(question)}</div>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {isViewerNativeQuestion(question) && compositePhaseSlots.length === 0 ? (
            <button
              type="button"
              className="rounded border border-blue-500 px-2 py-1 text-xs font-semibold text-blue-100 disabled:opacity-50"
              disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                captureAuthoringFrame(question);
              }}
            >
              Capture current frame
            </button>
          ) : null}

          {isPlaceMarkerQuestionType(question) ? (
            <button
              type="button"
              className="rounded border border-yellow-500 px-2 py-1 text-xs font-semibold text-yellow-100 disabled:opacity-50"
              disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                captureAuthoringGoldPoint(question);
              }}
            >
              {isCapturing
                ? 'Click image…'
                : hasGoldPoint
                  ? 'Replace gold marker'
                  : 'Place gold marker'}
            </button>
          ) : null}

          {isMarkerChoiceQuestionType(question) ? (
            <button
              type="button"
              className="rounded border border-yellow-500 px-2 py-1 text-xs font-semibold text-yellow-100 disabled:opacity-50"
              disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                addAuthoringMarkerOption(question);
              }}
            >
              {isCapturing ? 'Click image…' : 'Place next marker'}
            </button>
          ) : null}
        </div>

        {targetHasNavigationIdentity(viewerTarget) && !compositePhaseSlots.length && (!hasGuidedEFFrames || (answerConfig.efContourFrameGuidanceEnabled !== true && savedGoldComponents.length === 0)) ? (
          <div className="bg-blue-950/30 mt-2 rounded border border-blue-700 px-2 py-1 text-xs text-blue-100">
            Target: {targetSummary}
          </div>
        ) : isViewerNativeQuestion(question) && !compositePhaseSlots.length && (!hasGuidedEFFrames || (answerConfig.efContourFrameGuidanceEnabled !== true && savedGoldComponents.length === 0)) ? (
          <div className="mt-2 text-xs text-orange-200">
            Spatial questions should have a captured target frame before publishing.
          </div>
        ) : null}

        {question.type === 'frameSelection' ? (
          <div className="mt-2 rounded border border-gray-700 p-2">
            <label className="block text-xs font-semibold text-gray-200">Learner task</label>
            <select
              className="mt-1 w-full rounded border border-gray-700 bg-black px-2 py-1 text-xs text-white"
              value={answerConfig.frameSelectionMode === 'frame_only' ? 'frame_only' : 'instance_and_frame'}
              disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
              onChange={event => patchAuthoringAnswerConfig(question, {
                frameSelectionMode: event.target.value,
              })}
            >
              <option value="frame_only">Find the correct frame (instance opens automatically)</option>
              <option value="instance_and_frame">Find the correct instance and frame</option>
            </select>
            <div className="mt-1 text-[11px] text-gray-400">
              The correct frame is never revealed when the learner opens the question.
            </div>
            <label className="mt-3 block text-xs font-semibold text-gray-200">Frame tolerance</label>
            <input
              className="mt-1 w-32 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
              type="number"
              min="0"
              step="1"
              value={numberOrEmpty(plainObject(question.scoringConfig).toleranceFrames)}
              disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
              onChange={event =>
                patchAuthoringQuestion(question, {
                  scoringConfig: {
                    ...plainObject(question.scoringConfig),
                    toleranceFrames: event.target.value,
                  },
                })
              }
            />
            <div className="mt-1 text-[11px] text-gray-400">
              Set how many frames on either side of the captured frame should be accepted.
            </div>
          </div>
        ) : null}

        {hasGuidedEFFrames ? (
          <div className="mt-2 rounded border border-slate-600 bg-slate-900/60 p-2">
            <div className="text-xs font-semibold text-gray-100">EF contour frames and saved gold</div>
            <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-gray-100">
              <input type="checkbox"
                checked={answerConfig.efContourFrameGuidanceEnabled === true}
                disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
                onChange={event => patchAuthoringAnswerConfig(question, {
                  efContourFrameGuidanceEnabled: event.target.checked,
                })}
                onClick={event => event.stopPropagation()}
              />
              Guide each EF contour to an educator-selected instance/frame
            </label>
            {(answerConfig.efContourFrameGuidanceEnabled === true || savedGoldComponents.length > 0) ? (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-emerald-200">
                    Saved gold: {efGoldRows.filter(row => row.goldVerified).length}/4 verified source references
                  </span>
                  {answerConfig.efContourFrameGuidanceEnabled === true ? (
                    <span className={guidedEFFramesComplete ? 'text-green-200' : 'text-amber-200'}>
                      Targets: {efGoldRows.filter(row => row.configuredComplete).length}/4 captured
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] text-gray-300">
                  {answerConfig.efContourFrameGuidanceEnabled === true
                    ? 'Capture each target from the selected viewer frame. Saved gold contours remain separate and must match the targets.'
                    : 'Frame guidance is off. Saved gold contours can still be inspected without recapturing them.'}
                </p>
                {efGoldRows.map(row => {
                  const guidanceEnabled = answerConfig.efContourFrameGuidanceEnabled === true;
                  const targetCaptured = targetHasNavigationIdentity(row.configuredTarget);
                  return (
                    <div key={row.slot} className="border-t border-gray-700 pt-2 text-xs">
                      <div className="font-medium text-gray-100">{row.label}</div>
                      {guidanceEnabled ? (
                        <div className={row.configuredComplete ? 'mt-1 text-gray-300' : 'mt-1 text-amber-200'}>
                          Target: {row.configuredComplete
                            ? getViewerTargetSummary(row.configuredTarget)
                            : targetCaptured ? 'Incomplete frame source' : 'Not configured'}
                        </div>
                      ) : null}
                      <div className={row.goldVerified
                        ? row.sourceMismatch ? 'mt-1 text-amber-200' : 'mt-1 text-emerald-200'
                        : 'mt-1 text-amber-200'}>
                        Gold: {row.goldVerified
                          ? `Saved · ${getViewerTargetSummary(row.savedTarget)}${row.sourceMismatch ? ' · Does not match target' : ' · Source verified'}`
                          : 'No verified saved contour'}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {guidanceEnabled ? (
                          <button type="button"
                            className="rounded border border-blue-500 px-2 py-1 text-blue-100 disabled:opacity-50"
                            disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              void captureAuthoringEFContourFrame(question, row.slot);
                            }}>
                            {targetCaptured ? 'Replace target' : 'Capture target'}
                          </button>
                        ) : null}
                        {row.goldVerified ? (
                          <button type="button"
                            className="rounded border border-emerald-600 px-2 py-1 text-emerald-100 disabled:opacity-40"
                            disabled={authoringSaving}
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              setActiveQuestionKey(`authoring:${question.questionKey}`);
                              void runViewerCommand(commandsManager, 'jumpToViewerQuizTarget', {
                                viewerTarget: row.savedTarget,
                                questionKey: question.questionKey,
                              });
                            }}>
                            View saved gold
                          </button>
                        ) : null}
                        {guidanceEnabled && row.configuredComplete &&
                            (!row.goldVerified || row.sourceMismatch) ? (
                          <button type="button"
                            className="rounded border border-slate-500 px-2 py-1 text-gray-100"
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              void runViewerCommand(commandsManager, 'jumpToViewerQuizTarget', {
                                viewerTarget: row.configuredTarget,
                                questionKey: question.questionKey,
                              });
                            }}>
                            Jump to target
                          </button>
                        ) : null}
                      </div>
                      {row.sourceMismatch ? (
                        <div className="mt-2 text-[11px] text-amber-200" role="alert">
                          This target differs from the saved gold source. Restore the matching target
                          or recapture the gold contour before publishing.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {answerConfig.efContourFrameGuidanceEnabled === true ? (
                  <div className={guidedEFFramesComplete ? 'text-green-200 text-[11px]' : 'text-amber-200 text-[11px]'}>
                    {guidedEFFramesComplete
                      ? 'All four frames configured. Save the draft to retain the guided sequence.'
                      : 'All four frames must be captured before saving guided EF navigation.'}
                  </div>
                ) : null}
                {savedGoldComponents.length > 0 ? (
                  <p className="border-t border-gray-700 pt-2 text-xs text-emerald-100">
                    Saved result: {answerConfig.goldValue ?? plainObject(answerConfig.goldMeasurement).value ?? '—'} {answerConfig.unit || plainObject(answerConfig.goldMeasurement).unit || ''}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-gray-400">
                Off: preserve manual EF frame navigation and the existing Continue behavior.
              </p>
            )}
          </div>
        ) : null}

        {compositePhaseSlots.length > 0 ? (
          <div className="mt-2 rounded border border-slate-600 bg-slate-900/60 p-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-100">
              <input
                type="checkbox"
                checked={answerConfig.compositeFrameGuidanceEnabled === true}
                disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
                onClick={event => event.stopPropagation()}
                onChange={event => patchAuthoringAnswerConfig(question, {
                  compositeFrameGuidanceEnabled: event.target.checked,
                })}
              />
              Require educator-selected DICOM instances/frames for each measurement phase
            </label>
            {answerConfig.compositeFrameGuidanceEnabled === true ? (
              <div className="mt-2 space-y-2">
                {compositePhaseSlots.map(({ slot, label }) => {
                  const target = plainObject(authoredCompositeFrames[slot]);
                  const captured = !!cleanString(target.sopInstanceUID) &&
                    Number(target.frameNumber) >= 1;
                  return (
                    <div key={slot} className="flex flex-wrap items-center gap-2 border-t border-gray-700 pt-2 text-xs">
                      <span className="min-w-40 font-medium text-gray-100">{label}</span>
                      <span className={captured ? 'text-green-200' : 'text-amber-200'}>
                        {captured ? getViewerTargetSummary(target) : 'Not captured'}
                      </span>
                      <button
                        type="button"
                        disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
                        className="rounded border border-blue-500 px-2 py-1 text-blue-100 disabled:opacity-40"
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          void captureAuthoringCompositeFrame(question, slot);
                        }}
                      >
                        {captured ? 'Replace source' : 'Capture current instance/frame'}
                      </button>
                      {captured ? (
                        <button
                          type="button"
                          className="rounded border border-slate-500 px-2 py-1 text-gray-100"
                          onClick={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            void runViewerCommand(commandsManager, 'jumpToViewerQuizTarget', {
                              viewerTarget: target,
                              questionKey: question.questionKey,
                            });
                          }}
                        >
                          Jump to source
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <div className={compositeFramesComplete ? 'text-green-200 text-xs' : 'text-amber-200 text-xs'}>
                  {compositeFramesComplete
                    ? 'All phase sources are configured with unique, same-study frames.'
                    : 'Capture all phase sources in the same study on distinct DICOM frames.'}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {savedGoldComponents.length > 0 && !hasGuidedEFFrames &&
          !['rvFAC', 'raArea', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'ivcCollapsibility', 'ivcRapRvsp']
            .includes(cleanString(answerConfig.measurementKind)) ? (
          <div className="mt-2 rounded border border-emerald-700/70 bg-emerald-950/20 p-2">
            <div className="text-xs font-semibold text-emerald-100">
              Saved gold contours — {savedGoldComponents.filter(component => component.complete).length}/{savedGoldComponents.length} verified source references
            </div>
            <p className="mt-1 text-[11px] text-gray-300">
              These contours are already recorded. Select a component to inspect its saved instance and frame; you do not need to measure it again.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {savedGoldComponents.map(component => (
                <button
                  type="button"
                  key={component.slot}
                  className="rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-100 disabled:opacity-40"
                  disabled={!component.complete || authoringSaving}
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveQuestionKey(`authoring:${question.questionKey}`);
                    void runViewerCommand(commandsManager, 'jumpToViewerQuizTarget', {
                      viewerTarget: component.target,
                      questionKey: question.questionKey,
                    });
                  }}
                >
                  {component.label}{component.complete ? ' · View saved contour' : ' · Source unavailable'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-emerald-100">
              Saved result: {answerConfig.goldValue ?? plainObject(answerConfig.goldMeasurement).value ?? '—'} {answerConfig.unit || plainObject(answerConfig.goldMeasurement).unit || ''}
            </p>
          </div>
        ) : null}

        {question.type === 'measurementNumeric' ? (
          <div className="mt-2 rounded border border-gray-700 p-2">
            {bowelSet ? (
              <div className="mb-3 rounded border border-blue-700 bg-blue-950/30 p-2 text-xs text-blue-100">
                <div className="font-semibold">
                  Bowel gold calipers: {goldBowelMeasurements.length} / {bowelSettings.requiredCount || 2}
                </div>
                <div className="mt-1 text-gray-300">Question: {question.prompt || 'No question prompt set — specify the bowel segment in Quiz Authoring before capturing.'}</div>
                {!isDraftDefinition(authoringDefinition) ? (
                  <div className="mt-1 text-amber-200" role="status">Gold capture is disabled: open an editable draft of this quiz.</div>
                ) : authoringSaving ? (
                  <div className="mt-1 text-amber-200" role="status">Gold capture is disabled while the quiz is saving.</div>
                ) : isCapturing ? (
                  <div className="mt-1 text-amber-200" role="status">Another measurement or lumen-centre capture is currently active.</div>
                ) : null}
                {bowelValidation && bowelValidation.status !== 'valid' ? (
                  <div className={`mt-2 rounded border p-2 ${bowelValidation.status === 'invalid'
                    ? 'border-amber-500 bg-amber-950/40 text-amber-100' : 'border-slate-600 text-slate-200'}`}
                    role="alert">
                    {bowelValidation.message}
                  </div>
                ) : bowelValidation?.status === 'valid' ? (
                  <div className="mt-2 text-emerald-200" role="status">
                    Spatial separation valid: {bowelValidation.message}
                  </div>
                ) : null}
                {goldBowelMeasurements.length > 1 ? (
                  <button
                    type="button"
                    className="mt-2 rounded border border-purple-400 px-2 py-1 text-xs text-purple-100 hover:bg-purple-900/40"
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      void runViewerCommand(commandsManager, 'showViewerQuizAuthoringGoldCaliper', {
                        goldMeasurements: goldBowelMeasurements,
                        referenceRadiusMm: plainObject(question.scoringConfig).radius,
                        questionKey: question.questionKey,
                      }).then(result => {
                        if (result?.rubricRendered !== true) uiNotificationService.show({
                          title: 'Bowel gold calipers',
                          message: `Could not show all gold calipers: ${cleanString(result?.reason) || 'unknown error'}.`,
                          type: 'warning', duration: 4500,
                        });
                      }).catch(error => uiNotificationService.show({
                        title: 'Bowel gold calipers',
                        message: String(error?.message || error),
                        type: 'warning', duration: 4500,
                      }));
                    }}
                  >
                    Show all gold calipers
                  </button>
                ) : null}
                {goldBowelMeasurements.map((entry, index) => (
                  <button
                    key={entry.sourceAnnotationId || index}
                    type="button"
                    className="mt-1 flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded border border-blue-700/70 px-2 py-1 text-left text-blue-100 hover:bg-blue-900/40 focus:outline focus:outline-2 focus:outline-purple-400"
                    title="Click to highlight this gold caliper in the Viewer"
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      void runViewerCommand(commandsManager, 'showViewerQuizAuthoringGoldCaliper', {
                        goldMeasurements: goldBowelMeasurements,
                        highlightedSourceAnnotationId: entry.sourceAnnotationId,
                        referenceRadiusMm: plainObject(question.scoringConfig).radius,
                        questionKey: question.questionKey,
                      }).then(result => {
                        if (result?.rubricRendered !== true) uiNotificationService.show({
                          title: 'Bowel gold caliper',
                          message: `Could not display saved gold caliper: ${cleanString(result?.reason) || 'unknown error'}.`,
                          type: 'warning', duration: 4500,
                        });
                      }).catch(error => uiNotificationService.show({
                        title: 'Bowel gold caliper',
                        message: String(error?.message || error),
                        type: 'warning', duration: 4500,
                      }));
                    }}
                  >
                    <span className="min-w-0 break-words">#{index + 1}: {entry.value} {entry.unit} · {entry.measurementType}</span>
                    <span className="shrink-0 text-xs text-purple-200">Highlight</span>
                  </button>
                ))}
                {bowelSettings.orientation === 'longitudinal' ? (
                  <div className="mt-1">
                    {Array.isArray(bowelSettings.longitudinalAxisPhysical)
                      ? 'Bowel axis: defined' : 'Bowel axis: not captured'}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" className="rounded border border-blue-400 px-2 py-1"
                      disabled={!goldBowelMeasurements.length || isCapturing || authoringSaving ||
                        !isDraftDefinition(authoringDefinition)}
                      onClick={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        void captureBowelQuizLumenCenter(question);
                      }}>
                      {Array.isArray(bowelSettings.lumenCenterPhysical)
                        ? 'Replace lumen centre' : 'Capture lumen centre'}
                    </button>
                    <span>{Array.isArray(bowelSettings.lumenCenterPhysical)
                      ? 'Lumen centre: defined'
                      : !goldBowelMeasurements.length
                        ? 'Record at least one gold BWT caliper first; centre capture is currently disabled.'
                        : 'Click, then select the centre in the image; press Esc to cancel.'}</span>
                    {getBowelGoldAngularSeparation(goldBowelMeasurements, bowelSettings.lumenCenterPhysical) !== null ? (
                      <span className="text-purple-100">
                        Minimum gold radial-angle separation: {getBowelGoldAngularSeparation(
                          goldBowelMeasurements, bowelSettings.lumenCenterPhysical
                        )?.toFixed(1)}° (required: {bowelSettings.minimumSeparationDegrees || 90}°)
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {['ivcCollapsibility', 'ivcRapRvsp'].includes(
              cleanString(answerConfig.measurementKind)
            ) ? renderIVCCaliperControls(
              { quizKey: 'authoring', quizVersion: 1 }, question,
              isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)
            ) : null}
            {['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(
              cleanString(answerConfig.measurementKind)
            ) ? renderLAVolumeContourControls(
              { quizKey: 'authoring', quizVersion: 1 }, question,
              isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)
            ) : null}
            {cleanString(answerConfig.measurementKind) === 'rvFAC'
              ? renderRVFACContourControls(
                  { quizKey: 'authoring', quizVersion: 1 }, question,
                  isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)
                )
              : null}
            {renderCompositeCalculatedStatus(
              { quizKey: 'authoring', quizVersion: 1 }, question
            )}
            {cleanString(answerConfig.measurementKind) === 'ivcRapRvsp'
              ? renderIVCRapRVSPControls(
                  'authoring', question, answerConfig.goldMeasurement,
                  isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)
                )
              : null}
            {!isActiveAuthoringQuestion ? (
              <div className="mb-2 text-xs text-amber-200">Select this question before drawing its measurement. A new measurement is associated with the active question.</div>
            ) : null}
            <button
              type="button"
              title={bowelSet && (isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition))
                ? 'Gold BWT capture is unavailable while a capture/save is in progress or when the quiz is not an editable draft.'
                : undefined}
              className="rounded border border-green-600 px-2 py-1 text-xs font-semibold text-green-100 disabled:opacity-50"
              disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                captureAuthoringMeasurement(question);
              }}
            >
              {isCapturing
                ? 'Capturing measurement…'
                : cleanString(answerConfig.measurementKind) === 'ivcRapRvsp'
                  ? 'Accept IVC / RAP / RVSP gold answer'
                : bowelSet
                  ? 'Add selected gold BWT caliper'
                : answerConfig.goldValue != null && answerConfig.goldValue !== ''
                  ? ['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility'].includes(cleanString(answerConfig.measurementKind)) ? 'Replace gold answer with calculated result' : 'Replace gold answer with selected measurement'
                  : ['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility'].includes(cleanString(answerConfig.measurementKind)) ? 'Use calculated result as gold answer' : bowelSet ? 'Add selected gold BWT caliper' : 'Use selected measurement as gold answer'}
            </button>

            {(answerConfig.goldValue !== null &&
              answerConfig.goldValue !== undefined &&
              answerConfig.goldValue !== '') ||
            hasMeasurementComparisonReference(plainObject(answerConfig.goldMeasurement)) ? (
              <button
                type="button"
                className="ml-2 rounded border border-red-600 px-2 py-1 text-xs font-semibold text-red-100 disabled:opacity-50"
                disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (bowelSet) {
                    updateAuthoringQuestion(question.questionKey, current => {
                      const cfg = plainObject(current.answerConfig);
                      return {
                        ...current,
                        answerConfig: {
                          ...cfg, goldMeasurements: [], goldMeasurement: null,
                          goldValue: null, measurementType: '',
                          measurementSet: {
                            ...plainObject(cfg.measurementSet),
                            measurementTarget: '', referenceTarget: null,
                            longitudinalAxisPhysical: null, lumenCenterPhysical: null,
                            lumenCenterCalibration: null,
                          },
                        },
                      };
                    });
                  } else {
                    void clearAuthoringGoldMeasurement(question);
                  }
                }}
              >
                {bowelSet ? 'Clear BWT measurement set' : 'Clear gold answer'}
              </button>
            ) : null}

            {!bowelSet && !['rvFAC', 'raArea', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'ivcCollapsibility'].includes(
              cleanString(answerConfig.measurementKind)
            ) && (answerConfig.goldValue !== null &&
            typeof answerConfig.goldValue !== 'undefined' &&
            answerConfig.goldValue !== '' ? (
              <div className="bg-green-950/30 mt-2 rounded border border-green-700 px-2 py-1 text-xs text-green-100">
                Gold measurement: {answerConfig.goldValue} {answerConfig.unit || ''}
                {answerConfig.measurementType ? ` · ${answerConfig.measurementType}` : ''}
              </div>
            ) : (
              <div className="mt-2 text-xs text-orange-200">
                {['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility'].includes(cleanString(answerConfig.measurementKind))
                  ? 'Complete all required contours, then capture the calculated result as the gold answer. No annotation selection is required.'
                  : 'Select a measurement annotation in the viewport, then capture it as the gold answer.'}
              </div>
            ))}

            <label className="mt-2 block text-xs font-semibold text-gray-200">
              {['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility'].includes(cleanString(answerConfig.measurementKind))
                ? 'Numeric tolerance (' +
                  (['lvSimpsonEF', 'rvFAC', 'ivcCollapsibility'].includes(cleanString(answerConfig.measurementKind))
                    ? '%' : cleanString(answerConfig.measurementKind) === 'raArea' ? 'cm²' : 'mL') + ')'
                : 'Length tolerance'}
            </label>
            <input
              className="mt-1 w-36 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
              type="number"
              step="0.01"
              min="0"
              value={numberOrEmpty(plainObject(question.scoringConfig).absoluteTolerance)}
              disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
              onChange={event =>
                patchAuthoringQuestion(question, {
                  scoringConfig: {
                    ...plainObject(question.scoringConfig),
                    absoluteTolerance: event.target.value,
                    toleranceUnit:
                      answerConfig.unit || plainObject(question.scoringConfig).toleranceUnit || '',
                  },
                })
              }
            />

            {['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea'].includes(cleanString(answerConfig.measurementKind)) ? (
              <div className="mt-3 border-t border-gray-700 pt-2">
                <label className="flex items-center gap-2 text-xs text-gray-200">
                  <input
                    type="checkbox"
                    checked={plainObject(plainObject(question.scoringConfig).compositeContour).enabled === true}
                    disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
                    onChange={event => patchAuthoringQuestion(question, {
                      scoringConfig: {
                        ...plainObject(question.scoringConfig),
                        compositeContour: {
                          ...plainObject(plainObject(question.scoringConfig).compositeContour),
                          enabled: event.target.checked,
                          minDice: Number(plainObject(plainObject(question.scoringConfig).compositeContour).minDice ?? 0.8),
                        },
                      },
                    })}
                  />
                  Also require correct contour placement and shape
                </label>
                {plainObject(plainObject(question.scoringConfig).compositeContour).enabled === true ? (
                  <label className="mt-2 block text-xs text-gray-200">
                    Minimum Dice overlap (0–1)
                    <input
                      className="mt-1 block w-28 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
                      type="number" min="0" max="1" step="0.05"
                      value={Number(plainObject(plainObject(question.scoringConfig).compositeContour).minDice ?? 0.8)}
                      disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
                      onChange={event => patchAuthoringQuestion(question, {
                        scoringConfig: {
                          ...plainObject(question.scoringConfig),
                          compositeContour: {
                            ...plainObject(plainObject(question.scoringConfig).compositeContour),
                            enabled: true,
                            minDice: Number(event.target.value),
                          },
                        },
                      })}
                    />
                    Each contour must match the same image/frame as its gold contour. Missing geometry fails this check.
                  </label>
                ) : null}
              </div>
            ) : null}

            {cleanString(answerConfig.measurementKind) === 'ivcCollapsibility' ? (
              <label className="mt-3 block text-xs font-semibold text-gray-200">
                Maximum caliper endpoint distance (mm)
                <input type="number" min="0" max="100" step="0.1"
                  className="mt-1 block w-36 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
                  value={numberOrEmpty(plainObject(question.scoringConfig).caliperEndpointToleranceMM ?? 5)}
                  disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
                  onChange={event => patchAuthoringQuestion(question, {
                    scoringConfig: {
                      ...plainObject(question.scoringConfig),
                      caliperEndpointToleranceMM: event.target.value,
                    },
                  })}
                />
              </label>
            ) : null}

            {!['lvSimpsonEF', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility'].includes(cleanString(answerConfig.measurementKind)) ? (
              <>
            <label className="mt-3 block text-xs font-semibold text-gray-200">
              {bowelSet ? 'Reference location radius (mm; visual guide)' : 'Position radius tolerance'}
            </label>
            <input
              className="mt-1 w-36 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
              type="number"
              step="0.01"
              min="0"
              value={numberOrEmpty(plainObject(question.scoringConfig).radius)}
              disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
              onChange={event =>
                patchAuthoringQuestion(question, {
                  scoringConfig: {
                    ...plainObject(question.scoringConfig),
                    radius: event.target.value,
                    radiusUnit: bowelSet ? 'mm' :
                      plainObject(question.scoringConfig).radiusUnit || 'world',
                  },
                })
              }
            />

            <div className="mt-1 text-[11px] text-gray-400">
              {bowelSet
                ? 'Displayed around the selected gold BWT caliper, or around every gold caliper with Show all. This is a teaching guide only: multi-BWT scoring uses numeric accuracy and axial/angular separation, not a midpoint-radius threshold.'
                : 'The learner measurement must be within both the allowed length difference and this radius from the center of the correct measurement.'}
            </div>
              </>
            ) : (
              <div className="mt-1 text-[11px] text-gray-400">
                The learner's calculated result must be within the numeric tolerance of the gold result.
              </div>
            )}
          </div>
        ) : null}

        {isPlaceMarkerQuestionType(question) ? (
          <div className="mt-2 rounded border border-gray-700 p-2">
            <label className="block text-xs font-semibold text-gray-200">
              Gold marker tolerance radius
            </label>
            <input
              className="mt-1 w-32 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
              type="number"
              step="0.01"
              value={numberOrEmpty(plainObject(question.scoringConfig).radius)}
              disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
              onChange={event =>
                patchAuthoringQuestion(question, {
                  scoringConfig: {
                    ...plainObject(question.scoringConfig),
                    radius: event.target.value,
                    radiusUnit: plainObject(question.scoringConfig).radiusUnit || 'world',
                  },
                })
              }
            />
          </div>
        ) : null}

        {hasGoldPoint ? (
          <div className="bg-green-950/30 mt-2 flex items-center justify-between gap-2 rounded border border-green-700 px-2 py-1 text-xs text-green-100">
            <span>
              Gold marker: {formatQuizCoordinate(goldPoint.x)}, {formatQuizCoordinate(goldPoint.y)}
            </span>
            <button
              type="button"
              className="rounded border border-red-600 px-2 py-1 text-[11px] font-semibold text-red-100 disabled:opacity-50"
              disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                clearAuthoringGoldPoint(question);
              }}
            >
              Remove gold marker
            </button>
          </div>
        ) : null}

        {isMarkerChoiceQuestionType(question) ? (
          <div className="mt-2 space-y-2">
            {markerOptions.length ? (
              markerOptions.map(marker => {
                const markerId = cleanString(marker.markerId || marker.markerKey || marker.value);
                const selected = correctMarkerIds.includes(markerId);

                return (
                  <div
                    key={markerId}
                    className="rounded border border-gray-700 bg-black/40 p-2 text-xs text-gray-200"
                  >
                    <label className="flex min-w-0 flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={authoringSaving || !isDraftDefinition(authoringDefinition)}
                        onChange={async () => {
                          const nextCorrectMarkerIds = toggleMarkerId(correctMarkerIds, markerId);

                          const nextQuestion = {
                            ...question,
                            answerConfig: {
                              ...answerConfig,
                              correctMarkerIds: nextCorrectMarkerIds,
                              correctMarkerId: '',
                              correctMarkerKey: '',
                            },
                          };

                          updateAuthoringQuestion(question.questionKey, () => nextQuestion);

                          await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
                            viewerTarget: null,
                            markerOptions: getOverlayMarkerOptionsForQuestion(nextQuestion, {
                              includeGoldMarker: true,
                            }),
                            questionKey: question.questionKey,
                          });
                        }}
                      />
                      <span className="min-w-0 break-words font-semibold">
                        {marker.label || markerId}
                      </span>
                      <span
                        className={
                          selected
                            ? 'rounded bg-green-900/60 px-2 py-0.5 text-green-100'
                            : 'rounded bg-gray-800 px-2 py-0.5 text-gray-400'
                        }
                      >
                        {selected ? 'correct marker' : 'mark as correct marker'}
                      </span>
                      {isMarkerOptionPlaced(marker) ? (
                        <span className="text-gray-500">
                          ({formatQuizCoordinate(marker.point.x)},{' '}
                          {formatQuizCoordinate(marker.point.y)})
                        </span>
                      ) : (
                        <span className="text-orange-300">not placed</span>
                      )}
                    </label>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border border-red-600 px-2 py-1 text-[11px] font-semibold text-red-100 disabled:opacity-50"
                        disabled={
                          isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)
                        }
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          removeAuthoringMarkerOption(question, markerId);
                        }}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="rounded border border-yellow-600 px-2 py-1 text-[11px] font-semibold text-yellow-100 disabled:opacity-50"
                        disabled={
                          isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)
                        }
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          addAuthoringMarkerOption(question, markerId);
                        }}
                      >
                        {isMarkerOptionPlaced(marker) ? 'Replace' : 'Place'}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-orange-200">
                No marker options yet. Click “Add marker option,” then click the image.
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (authoringMode) {
    const canEditDraft = !!authoringDefinition && isDraftDefinition(authoringDefinition);

    return (
      <div className="flex h-full min-h-0 flex-col bg-black text-white">
        <div className="border-b border-gray-700 p-3">
          <div className="text-base font-semibold">Quiz Authoring</div>
          <div className="mt-1 text-xs text-gray-400">
            Use this panel only for viewer-authored answers: frames, markers, gold points, and
            measurements. Question numbers match Manage Quiz; other question types are omitted here.
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-20">
          {loading ? (
            <div className="text-sm text-gray-400">Loading quiz authoring…</div>
          ) : errorMessage ? (
            <div className="bg-red-950/40 rounded border border-red-700 p-2 text-sm text-red-200">
              {errorMessage}
            </div>
          ) : !authoringDefinition ? (
            <div className="text-sm text-gray-400">
              No quiz version found. Create a draft from Manage Quiz first.
            </div>
          ) : !canEditDraft ? (
            <div className="bg-orange-950/30 rounded border border-orange-700 p-2 text-sm text-orange-100">
              This quiz version is {authoringDefinition.status}. Create a new draft version before
              editing viewer targets or markers.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-purple-950/30 rounded border border-purple-700 p-2 text-sm">
                <div className="font-semibold">
                  {authoringDefinition.title || authoringDefinition.quizKey}
                </div>
                {/* Educational asset configuration owns the domain and assessment type.
                    Internal content keys and study-type mutation are not viewer controls. */}
                {!authoringMeasurementDomain && authoringQuestions.some(
                  question => question.type === 'measurementNumeric'
                ) ? (
                  <div className="mt-2 text-xs text-amber-200" role="alert">
                    Measurement domain is unavailable from the educational asset.
                    Return to asset configuration and select Echo or Bowel there.
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                {authoringQuestions.map((question, index) =>
                  isViewerNativeQuestion(question) ? renderAuthoringQuestion(question, index) : null
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-700 bg-black p-3">
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-100 disabled:opacity-50"
              disabled={authoringSaving}
              onClick={finishValidatedQuizAuthoring}
            >
              Finish / close
            </button>

            <button
              type="button"
              className="flex-1 rounded bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={authoringSaving || !!capturingAuthoringKey || !canEditDraft}
              title={capturingAuthoringKey
                ? 'Complete the measurement capture before saving this quiz draft.'
                : undefined}
              onClick={saveAuthoringDraft}
            >
              {authoringSaving ? 'Saving draft…' : 'Save authoring changes'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasLearnerQuizContent = !loading && !errorMessage && payload?.enabled && quizzes.length > 0;

  const learnerFooterQuizzes = hasLearnerQuizContent
    ? quizzes.filter(quiz => {
        const response = getResponseForQuiz(responses, quiz);
        const submitted = cleanString(response?.status).toLowerCase() === 'submitted';
        const quizScore = viewerQuizScore ? getQuizScoreItem(viewerQuizScore, quiz) : null;

        return !submitted || (!quizScore && !deferredReportScoring);
      })
    : [];

  const learnerPanelTitle =
    quizzes.length === 1 ? cleanString(quizzes[0]?.title) || 'Case Questions' : 'Case Questions';

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-x-hidden bg-black text-white">
      <div className="min-w-0 shrink-0 border-b border-gray-700 p-3">
        <div
          className="min-w-0 max-w-full text-base font-semibold"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
        >
          {learnerPanelTitle}
        </div>
      </div>

      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto p-3">
        {loading ? (
          <div className="text-sm text-gray-400">Loading case questions…</div>
        ) : errorMessage ? (
          <div className="bg-red-950/40 rounded border border-red-700 p-2 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : !payload?.enabled || quizzes.length === 0 ? (
          <div className="text-sm text-gray-400">No case questions for this study.</div>
        ) : (
          <div className="space-y-4">
            {viewerQuizScore ? (
              <div className="bg-green-950/30 rounded border border-green-700 p-2 text-sm">
                <div className="font-semibold">Viewer Quiz Score</div>
                <div className="mt-1">
                  {Number(viewerQuizScore.total || 0)} / {Number(viewerQuizScore.max || 0)}
                </div>
              </div>
            ) : null}

            {quizzes.map(quiz => {
              const quizSaving = savingQuizKey === quiz.quizKey;
              const quizScoring = scoringQuizKey === quiz.quizKey;
              const learnerQuizDescription = getLearnerQuizDescription(quiz);
              const questions = [...(quiz.questions || [])].sort(
                (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
              );
              const response = getResponseForQuiz(responses, quiz);
              const submitted = cleanString(response?.status).toLowerCase() === 'submitted';
              const quizScore = viewerQuizScore ? getQuizScoreItem(viewerQuizScore, quiz) : null;
              return (
                <div
                  key={`${quiz.quizKey}-${quiz.quizVersion}`}
                  className="min-w-0 max-w-full overflow-hidden rounded border border-gray-700 p-3"
                >
                  {quizzes.length > 1 ? (
                    <div
                      className="min-w-0 max-w-full text-sm font-semibold"
                      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                    >
                      {quiz.title || 'Case Questions'}
                    </div>
                  ) : null}

                  {learnerQuizDescription ? (
                    <div
                      className={`${quizzes.length > 1 ? 'mt-1' : ''} min-w-0 max-w-full text-xs text-gray-400`}
                      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                    >
                      {learnerQuizDescription}
                    </div>
                  ) : null}

                  <div className="bg-blue-950/30 mt-3 min-w-0 max-w-full rounded border border-blue-700 p-2 text-xs text-blue-100">
                    Click each question before answering. Questions marked “Opens target”
                    navigate to the assigned image or instance without revealing the correct frame.
                  </div>

                  <div className="mt-3 space-y-4">
                    {questions.map((question, index) => {
                      const questionSelectionKey = `${quiz.quizKey}:${question.questionKey}`;
                      const isActiveQuestion = activeQuestionKey === questionSelectionKey;
                      const hasViewerTarget = !!getQuestionViewerTarget(question) &&
                        !(question.type === 'frameSelection' &&
                          !shouldGuideFrameSelectionToInstance(question));

                      return (
                        <div
                          key={question.questionKey}
                          className={`bg-gray-950/50 w-full min-w-0 max-w-full overflow-hidden rounded border p-2 ${
                            isActiveQuestion
                              ? 'border-blue-400'
                              : hasViewerTarget
                                ? 'border-gray-600'
                                : 'border-gray-800'
                          }`}
                          onClick={() => selectQuestion(quiz, question)}
                          onFocusCapture={event => {
                            // Review buttons navigate explicitly to the exact
                            // learner/gold frame. Focus must not start a second
                            // background "open question" navigation that can
                            // race and reset the viewport to the instance.
                            if ((event.target as HTMLElement)?.closest?.('[data-quiz-review-action]')) return;
                            selectQuestion(quiz, question);
                          }}
                        >
                          {isActiveQuestion ? (
                            <div className="mb-1 inline-flex rounded bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                              Active Question
                            </div>
                          ) : null}
                          <div
                            className="min-w-0 max-w-full text-sm font-semibold"
                            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                          >
                            {index + 1}. {question.title || question.prompt}
                            {question.required ? <span className="text-red-300"> *</span> : null}
                          </div>

                          {hasViewerTarget ? (
                            <div className="mt-1 text-[11px] uppercase tracking-wide text-blue-300">
                              {question.type === 'frameSelection' ? 'Opens target instance' : 'Opens target'}
                            </div>
                          ) : null}

                          {question.title ? (
                            <div
                              className="mt-1 min-w-0 max-w-full text-xs text-gray-300"
                              style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                            >
                              {question.prompt}
                            </div>
                          ) : null}

                          {question.helpText ? (
                            <div
                              className="mt-1 min-w-0 max-w-full text-xs text-gray-400"
                              style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                            >
                              {question.helpText}
                            </div>
                          ) : null}

                          {renderQuestion(quiz, question, submitted)}
                          {renderQuestionReview(quiz, question, quizScore)}
                        </div>
                      );
                    })}
                  </div>

                  {submitted ? (
                    <div className="bg-green-950/30 mt-3 rounded border border-green-700 p-2 text-sm text-green-100">
                      <div className="font-semibold">Submitted</div>
                      {quizScore ? (
                        <div className="mt-1">
                          Score: {Number(quizScore.total || 0)} / {Number(quizScore.max || 0)}
                        </div>
                      ) : (
                        <div className="mt-1 text-green-200">
                          Your answers have been submitted, but no score is available yet.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {learnerFooterQuizzes.length ? (
        <div className="shrink-0 border-t border-gray-700 bg-black p-3">
          <div className="space-y-2">
            {learnerFooterQuizzes.map(quiz => {
              const quizSaving = savingQuizKey === quiz.quizKey;
              const quizScoring = scoringQuizKey === quiz.quizKey;
              const response = getResponseForQuiz(responses, quiz);
              const submitted = cleanString(response?.status).toLowerCase() === 'submitted';
              const quizScore = viewerQuizScore ? getQuizScoreItem(viewerQuizScore, quiz) : null;

              return (
                <div key={`footer-${quiz.quizKey}-${quiz.quizVersion}`}>
                  {learnerFooterQuizzes.length > 1 ? (
                    <div className="mb-1 text-xs font-semibold text-gray-300">
                      {quiz.title || 'Case Questions'}
                    </div>
                  ) : null}

                  {submitted && deferredReportScoring ? (
                    <div className="text-xs text-green-200">
                      Answers submitted. Return to the report and select Submit for Scoring.
                    </div>
                  ) : submitted && !quizScore ? (
                    <div className="space-y-2">
                      <div className="text-xs text-green-200">
                        Submitted, but no score is available yet.
                      </div>
                      <button
                        type="button"
                        className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={quizSaving || quizScoring || submitting}
                        onClick={() => retryScoreQuiz(quiz)}
                      >
                        {quizScoring ? 'Scoring…' : 'Retry scoring'}
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={quizSaving || submitting}
                        onClick={() => saveQuiz(quiz, 'draft')}
                      >
                        {quizSaving ? 'Saving…' : 'Save Draft'}
                      </button>

                      <button
                        type="button"
                        className="rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={quizSaving || submitting}
                        onClick={() => saveQuiz(quiz, 'submitted')}
                      >
                        {quizSaving ? 'Submitting…' : deferredReportScoring ? 'Submit answers' : 'Submit Quiz'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <ClinicalReportMeasurementReviewModal
        review={quizMeasurementReview}
        selectedRowKeys={quizMeasurementSelectedRows}
        showReviewBeforeSave={true}
        isSaving={quizMeasurementApplying}
        onToggleRow={key => setQuizMeasurementSelectedRows(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])}
        onToggleAll={selectAll => setQuizMeasurementSelectedRows(selectAll ? quizMeasurementReview?.rows.map(row => row.key) || [] : [])}
        onPreferenceChange={() => {}}
        onCancel={() => finishQuizMeasurementReview(false)}
        onApply={applyQuizMeasurementReview}
      />
    </div>
  );
}

export default CaseQuestionsPanel;
