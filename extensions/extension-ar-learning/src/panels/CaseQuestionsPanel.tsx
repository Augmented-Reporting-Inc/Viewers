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
  submitAndRefreshViewerQuizScoreForActiveStudy,
} from '../utils/viewerQuizApi';
import {
  readViewerQuizSessionState,
  writeViewerQuizSessionState,
} from '../utils/viewerQuizSessionState';

const AR_QUIZ_MEASUREMENT_ADDED_EVENT = 'ar-learning:quiz-measurement-added';
const AR_VIEWER_QUIZ_AUTHORING_SAVED_EVENT = 'ar:viewer-quiz-authoring-saved';

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

function syncQuizAuthoringMeasurementDomainToUrl(
  value: unknown,
  { overwrite = false }: { overwrite?: boolean } = {}
) {
  const domain = normalizeQuizMeasurementDomain(value);

  // The Learning mode consumes this synchronous event as the source of truth
  // for authoring labels. URL synchronization is retained for inspectability and
  // reloads, but label behavior no longer depends on history/router propagation.
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

function getQuestionViewerTarget(question: QuizQuestion) {
  const answerConfig = plainObject(question?.answerConfig);
  const candidates = [
    question?.viewerTarget,
    answerConfig.viewerTarget,
    answerConfig.goldTarget,
    plainObject(answerConfig.goldPoint).viewerTarget,
    plainObject(answerConfig.goldMeasurement).viewerTarget,
  ];

  return candidates.find(targetHasNavigationIdentity) || null;
}

function getQuestionSelectionViewerTarget(
  question: QuizQuestion,
  viewerTarget: any,
  revealExactFrame = false
) {
  if (question.type !== 'frameSelection' || revealExactFrame) {
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
  const { uiNotificationService } = servicesManager.services;
  const authoringMode = isViewerQuizAuthoringMode();
  const [sessionStateKey] = useState(() => getViewerQuizSessionKeyFromUrl());
  const [initialSessionState] = useState(() => readViewerQuizSessionState(sessionStateKey));

  const [loading, setLoading] = useState(true);
  const [savingQuizKey, setSavingQuizKey] = useState('');
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
  const [capturingMeasurementKey, setCapturingMeasurementKey] = useState('');
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
  const [capturingAuthoringKey, setCapturingAuthoringKey] = useState('');
  const [authoringMeasurementDomain, setAuthoringMeasurementDomain] = useState('');

  const quizzes: QuizDefinition[] = useMemo(() => {
    return Array.isArray(payload?.quizzes) ? payload.quizzes : [];
  }, [payload]);

  const responses: QuizResponse[] = useMemo(() => {
    return Array.isArray(payload?.responses) ? payload.responses : [];
  }, [payload]);

  const viewerQuizScore = useMemo(() => getViewerQuizScore(scoringPayload), [scoringPayload]);

  async function refreshScoringPayload() {
    try {
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
      syncQuizAuthoringMeasurementDomainToUrl(selectedMeasurementDomain);
      const selectedRubric = findRubricForDefinition(rubrics, selectedDefinition);
      const nextQuestions = Array.isArray(selectedDefinition?.questions)
        ? selectedDefinition.questions
        : [];

      if (nextPayload?.capabilities?.canManageQuizContent !== true) {
        throw new Error('Quiz authoring is not allowed for this account.');
      }

      const definitionId = getDefinitionId(selectedDefinition);
      const sessionState = readViewerQuizSessionState(sessionStateKey);
      const questionsToUse =
        definitionId &&
        sessionState?.authoringDefinitionId === definitionId &&
        Array.isArray(sessionState.authoringQuestions)
          ? (sessionState.authoringQuestions as QuizQuestion[])
          : nextQuestions;

      setAuthoringPayload(nextPayload);
      setAuthoringDefinition(selectedDefinition);
      setAuthoringMeasurementDomain(selectedMeasurementDomain);
      setAuthoringRubric(selectedRubric);
      authoringQuestionsRef.current = questionsToUse;
      setAuthoringQuestions(questionsToUse);
      writeViewerQuizSessionState(sessionStateKey, {
        authoringDefinitionId: definitionId,
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

  function setAnswer(quizKey: string, question: QuizQuestion, value: any) {
    setAnswersByQuizKey(current => ({
      ...current,
      [quizKey]: {
        ...(current[quizKey] || {}),
        [question.questionKey]: value,
      },
    }));
  }

  function toggleMultiSelectAnswer(quizKey: string, question: QuizQuestion, value: string) {
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
    const goldMeasurement = plainObject(answerConfig.goldMeasurement);

    if (!hasMeasurementComparisonReference(goldMeasurement)) {
      return null;
    }

    const result = await runViewerCommand(commandsManager, 'showViewerQuizMeasurementComparison', {
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

    return result;
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

    try {
      await runViewerCommand(commandsManager, 'clearViewerQuizMeasurementComparison', {});
    } catch {}

    if (question.type === 'measurementNumeric') {
      const quizMeasurementDomain = authoringMode
        ? authoringMeasurementDomain || resolveQuizAuthoringMeasurementDomain(authoringDefinition)
        : normalizeQuizMeasurementDomain(quiz?.domain) ||
          inferLegacyQuizMeasurementDomain(quiz) ||
          getQuizAuthoringMeasurementDomainFromUrl();

      dispatchQuizMeasurementDomain(quizMeasurementDomain);

      const activationResult = await runViewerCommand(
        commandsManager,
        'activateViewerQuizMeasurementTool',
        {
          toolName: 'Length',
          questionKey: question.questionKey,
        }
      );

      if (activationResult?.ok === false) {
        console.warn('[CaseQuestionsPanel] could not activate Length for measurement question', {
          questionKey: question.questionKey,
          result: activationResult,
        });
      }
    } else {
      await runViewerCommand(commandsManager, 'releaseViewerQuizDrawingTool', {});
    }

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

    if (!options.force && activeQuestionKey === nextActiveQuestionKey) {
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
    const learnerMeasurement =
      scoreItem && question.type === 'measurementNumeric'
        ? mergeReviewReferenceValues(
            questionAnswer,
            scoreItem.learnerResponse,
            reviewDetails.learnerMeasurement
          )
        : {};
    const hasViewerTargetOverride = Object.prototype.hasOwnProperty.call(options, 'viewerTarget');
    const learnerFrameTarget =
      question.type === 'frameSelection'
        ? getNestedViewerTarget(reviewQuestionAnswer) ||
          getNestedViewerTarget(questionAnswer) ||
          getNestedViewerTarget(scoreItem?.learnerResponse)
        : null;
    const configuredFrameTarget =
      question.type === 'frameSelection'
        ? getNestedViewerTarget(question?.answerConfig?.goldTarget) ||
          getQuestionViewerTarget(question)
        : null;
    let resolvedViewerTarget;

    if (hasViewerTargetOverride) {
      resolvedViewerTarget = options.viewerTarget;
    } else if (question.type === 'frameSelection' && !authoringMode) {
      resolvedViewerTarget = configuredFrameTarget;
    } else {
      resolvedViewerTarget =
        learnerFrameTarget ||
        (scoreItem
          ? getReviewAnswerTarget(question, reviewQuestionAnswer) ||
            getCorrectReviewTarget(question, scoreItem) ||
            getQuestionViewerTarget(question)
          : getReviewAnswerTarget(question, questionAnswer) || getQuestionViewerTarget(question));
    }
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

    if (
      question.type === 'measurementNumeric' &&
      hasMeasurementComparisonReference(learnerMeasurement)
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

      if (result && result.ok === false && result.reason !== 'empty-target') {
        console.warn('[CaseQuestionsPanel] viewer quiz navigation did not complete', {
          questionKey: question.questionKey,
          result,
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

  async function captureSelectedMeasurementAnswer(
    quiz: QuizDefinition,
    question: QuizQuestion,
    options: { measurementId?: string; silent?: boolean } = {}
  ) {
    const captureKey = `${quiz.quizKey}:${question.questionKey}`;
    const answerConfig = plainObject(question?.answerConfig);

    setCapturingMeasurementKey(captureKey);

    try {
      const result = await runViewerCommand(
        commandsManager,
        'getSelectedViewerMeasurementQuizAnswer',
        {
          question,
          measurementType: cleanString(answerConfig.measurementType),
          unit: cleanString(answerConfig.unit),
          measurementId: cleanString(options.measurementId),
        }
      );

      if (!result?.ok || !result?.answer) {
        const reason = cleanString(result?.reason || 'No selected measurement found.');

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

        return;
      }

      const currentAnswer = answersByQuizKey[quiz.quizKey]?.[question.questionKey];

      setAnswer(quiz.quizKey, question, setObjectAnswerPart(currentAnswer, result.answer));

      if (!options.silent) {
        uiNotificationService.show({
          title: 'Case Questions',
          message: `Measurement captured: ${result.answer.value} ${result.answer.unit || ''}`,
          type: 'success',
          duration: 3000,
        });
      }
    } catch (error) {
      uiNotificationService.show({
        title: 'Case Questions',
        message: `Measurement capture failed: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
    } finally {
      setCapturingMeasurementKey('');
    }
  }

  useEffect(() => {
    function handleQuizMeasurementAdded(event: Event) {
      const detail = (event as CustomEvent)?.detail || {};
      const measurementId = cleanString(detail.measurementId);

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

      void captureSelectedMeasurementAnswer(quiz, question, {
        measurementId,
        silent: true,
      });
    }

    window.addEventListener(AR_QUIZ_MEASUREMENT_ADDED_EVENT, handleQuizMeasurementAdded);

    return () => {
      window.removeEventListener(AR_QUIZ_MEASUREMENT_ADDED_EVENT, handleQuizMeasurementAdded);
    };
  }, [activeQuestionKey, authoringMode, payload, answersByQuizKey]);

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
      const result = await saveViewerQuizResponseForActiveStudy({
        quizKey: quiz.quizKey,
        quizVersion: Number(quiz.quizVersion) || 1,
        status,
        answers: buildAnswerPayload(quiz, quizAnswers),
      });

      let scoredPayload: any = null;

      if (status === 'submitted') {
        scoredPayload = await submitAndRefreshViewerQuizScoreForActiveStudy();
        setScoringPayload(scoredPayload);
      }

      const viewerQuizzes = getViewerQuizScore(scoredPayload);
      const scoredQuiz = viewerQuizzes ? getQuizScoreItem(viewerQuizzes, quiz) : null;

      uiNotificationService.show({
        title: 'Case Questions',
        message:
          status === 'submitted'
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
    setAuthoringQuestions(current => {
      const nextQuestions = current.map(question =>
        question.questionKey === questionKey ? updater(question) : question
      );

      authoringQuestionsRef.current = nextQuestions;
      return nextQuestions;
    });
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
          throw new Error('Choose Echo or Bowel as the study type before capturing a measurement.');
        }

        syncQuizAuthoringMeasurementDomainToUrl(authoringMeasurementDomain, { overwrite: true });

        const activationResult = await runViewerCommand(
          commandsManager,
          'activateViewerQuizMeasurementTool',
          {
            toolName: 'Length',
            questionKey: question.questionKey,
          }
        );

        if (activationResult?.ok === false) {
          throw new Error(
            `Unable to activate Length: ${cleanString(activationResult?.reason) || 'unknown error'}`
          );
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

  async function captureAuthoringMeasurement(
    question: QuizQuestion,
    options: { measurementId?: string; silent?: boolean } = {}
  ) {
    const captureKey = `authoring-measurement:${question.questionKey}`;
    const answerConfig = plainObject(question.answerConfig);

    setActiveQuestionKey(`authoring:${question.questionKey}`);
    setCapturingAuthoringKey(captureKey);

    try {
      const result = await runViewerCommand(
        commandsManager,
        'getSelectedViewerMeasurementQuizAnswer',
        {
          question,
          measurementType: cleanString(answerConfig.measurementType),
          unit: cleanString(answerConfig.unit),
          measurementId: cleanString(options.measurementId),
        }
      );

      if (!result?.ok || !result?.answer) {
        throw new Error(result?.reason || 'selected measurement not found');
      }

      const answer = result.answer;
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

      try {
        const displayResult = await showAuthoringGoldMeasurement(nextQuestion);

        if (displayResult?.rubricRendered !== true) {
          console.warn('[CaseQuestionsPanel] newly captured gold measurement was not displayed', {
            questionKey: question.questionKey,
            result: displayResult,
          });
        }
      } catch (error) {
        console.warn('[CaseQuestionsPanel] newly captured gold measurement display failed:', error);
      }

      if (!options.silent) {
        uiNotificationService.show({
          title: 'Quiz Authoring',
          message: `Gold measurement captured: ${answer.value} ${unit}`,
          type: 'success',
          duration: 3000,
        });
      }
    } catch (error) {
      if (options.silent) {
        console.warn('[CaseQuestionsPanel] automatic gold measurement capture failed:', error);
      } else {
        uiNotificationService.show({
          title: 'Quiz Authoring',
          message: `Measurement capture failed: ${error?.message || error}`,
          type: 'error',
          duration: 6000,
        });
      }
    } finally {
      setCapturingAuthoringKey('');
    }
  }

  async function saveAuthoringDraft() {
    if (!authoringDefinition || !isDraftDefinition(authoringDefinition)) {
      return;
    }

    setAuthoringSaving(true);
    setErrorMessage('');

    try {
      const definitionId = getDefinitionId(authoringDefinition);
      const questionsToSave = authoringQuestionsRef.current;
      const hasMeasurementQuestions = questionsToSave.some(
        question => question.type === 'measurementNumeric'
      );

      if (hasMeasurementQuestions && !authoringMeasurementDomain) {
        throw new Error('Choose Echo or Bowel as the study type before saving measurement questions.');
      }

      const result = await saveViewerQuizAuthoringDraft({
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

      const savedDefinition = result?.definition || result?.quizDefinition || null;
      const savedQuestions = Array.isArray(savedDefinition?.questions)
        ? savedDefinition.questions
        : questionsToSave;

      if (savedDefinition) {
        setAuthoringDefinition(savedDefinition);
      }

      authoringQuestionsRef.current = savedQuestions;
      setAuthoringQuestions(savedQuestions);
      writeViewerQuizSessionState(sessionStateKey, {
        authoringDefinitionId: definitionId,
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
      const selectedTarget = plainObject(value?.selectedTarget);

      return (
        <div className="mt-2 space-y-2">
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
              Scroll or cine to the desired frame, then capture the current frame.
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

      return (
        <div className="mt-2 w-full min-w-0 max-w-full space-y-2 overflow-hidden">
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

          <button
            type="button"
            className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || captureInProgress}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              captureSelectedMeasurementAnswer(quiz, question);
            }}
          >
            {captureInProgress ? 'Capturing…' : 'Recapture selected measurement'}
          </button>

          {value?.value === null ||
          typeof value?.value === 'undefined' ||
          cleanString(value?.value) === '' ? (
            <div className="text-xs text-gray-400">
              Draw or select a measurement annotation in the viewport, then use it as the answer.
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
            Instance match:{' '}
            {compareViewerTargetInstances(
              reviewDetails.learnerTarget || scoreItem?.learnerResponse,
              reviewDetails.goldTarget || scoreItem?.correctAnswer
            ) === false
              ? 'No'
              : 'Yes'}
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
                className="hover:bg-blue-950 rounded border border-blue-500 px-2 py-1 font-semibold text-blue-100"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectQuestion(quiz, question, {
                    force: true,
                    viewerTarget: learnerTarget,
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
    const markerOptions = normalizeMarkerOptions(answerConfig.markerOptions);
    const correctMarkerIds = getCorrectMarkerIdsFromAnswerConfig(answerConfig);
    const viewerTarget = getQuestionViewerTarget(question);
    const targetSummary = getViewerTargetSummary(viewerTarget);
    const isCapturing = capturingAuthoringKey.endsWith(`:${question.questionKey}`);
    const goldPoint = plainObject(answerConfig.goldPoint);
    const hasGoldPoint =
      goldPoint.x !== null &&
      goldPoint.x !== undefined &&
      goldPoint.y !== null &&
      goldPoint.y !== undefined;

    return (
      <div
        key={question.questionKey}
        className="bg-gray-950/50 rounded border border-gray-700 p-2"
        onClick={() => selectQuestion({ quizKey: 'authoring', quizVersion: 1 }, question)}
      >
        <div className="text-sm font-semibold">
          {index + 1}. {question.title || question.prompt || question.questionKey}
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">
          {question.type}
        </div>

        {targetHasNavigationIdentity(viewerTarget) ? (
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
          {isViewerNativeQuestion(question) ? (
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

        {targetHasNavigationIdentity(viewerTarget) ? (
          <div className="bg-blue-950/30 mt-2 rounded border border-blue-700 px-2 py-1 text-xs text-blue-100">
            Target: {targetSummary}
          </div>
        ) : isViewerNativeQuestion(question) ? (
          <div className="mt-2 text-xs text-orange-200">
            Spatial questions should have a captured target frame before publishing.
          </div>
        ) : null}

        {question.type === 'frameSelection' ? (
          <div className="mt-2 rounded border border-gray-700 p-2">
            <label className="block text-xs font-semibold text-gray-200">Frame tolerance</label>
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

        {question.type === 'measurementNumeric' ? (
          <div className="mt-2 rounded border border-gray-700 p-2">
            <button
              type="button"
              className="rounded border border-green-600 px-2 py-1 text-xs font-semibold text-green-100 disabled:opacity-50"
              disabled={isCapturing || authoringSaving || !isDraftDefinition(authoringDefinition)}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                captureAuthoringMeasurement(question);
              }}
            >
              {isCapturing ? 'Capturing measurement…' : 'Use selected measurement as gold answer'}
            </button>

            {answerConfig.goldValue !== null &&
            typeof answerConfig.goldValue !== 'undefined' &&
            answerConfig.goldValue !== '' ? (
              <div className="bg-green-950/30 mt-2 rounded border border-green-700 px-2 py-1 text-xs text-green-100">
                Gold measurement: {answerConfig.goldValue} {answerConfig.unit || ''}
                {answerConfig.measurementType ? ` · ${answerConfig.measurementType}` : ''}
              </div>
            ) : (
              <div className="mt-2 text-xs text-orange-200">
                Select a measurement annotation in the viewport, then capture it as the gold answer.
              </div>
            )}

            <label className="mt-2 block text-xs font-semibold text-gray-200">
              Length tolerance
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

            <label className="mt-3 block text-xs font-semibold text-gray-200">
              Position radius tolerance
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
                    radiusUnit: plainObject(question.scoringConfig).radiusUnit || 'world',
                  },
                })
              }
            />

            <div className="mt-1 text-[11px] text-gray-400">
              The learner measurement must be within both the allowed length difference and this
              radius from the center of the correct measurement.
            </div>
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
            measurements.
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
                <div className="mt-1 text-xs text-purple-100">
                  Content key: {authoringPayload?.libraryContentKey || 'unknown'} · v
                  {Number(authoringDefinition.quizVersion || 1)}
                </div>
                <label className="mt-2 block text-xs font-semibold text-purple-100">
                  Study type
                </label>
                <select
                  className="mt-1 w-full rounded border border-purple-700 bg-black px-2 py-1 text-sm text-white"
                  value={authoringMeasurementDomain}
                  disabled={authoringSaving || !canEditDraft}
                  onChange={event => {
                    const nextDomain = normalizeQuizMeasurementDomain(event.target.value);
                    setAuthoringMeasurementDomain(nextDomain);
                    setAuthoringDefinition(current =>
                      current ? { ...current, domain: nextDomain } : current
                    );
                    syncQuizAuthoringMeasurementDomainToUrl(nextDomain, { overwrite: true });
                  }}
                >
                  <option value="">Choose Echo or Bowel</option>
                  <option value="bowel">Bowel</option>
                  <option value="echo">Echo</option>
                </select>
                <div className="mt-1 text-[11px] text-purple-200">
                  Controls the measurement labels used while authoring this quiz.
                </div>
              </div>

              <div className="space-y-3">
                {authoringQuestions.map((question, index) =>
                  renderAuthoringQuestion(question, index)
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
              onClick={finishQuizAuthoring}
            >
              Finish / close
            </button>

            <button
              type="button"
              className="flex-1 rounded bg-purple-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={authoringSaving || !canEditDraft}
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

        return !submitted || !quizScore;
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
                    Click each question before answering. Questions marked “Opens question image”
                    will move the viewer to the image/frame for that question.
                  </div>

                  <div className="mt-3 space-y-4">
                    {questions.map((question, index) => {
                      const questionSelectionKey = `${quiz.quizKey}:${question.questionKey}`;
                      const isActiveQuestion = activeQuestionKey === questionSelectionKey;
                      const hasViewerTarget = !!getQuestionViewerTarget(question);

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
                          onFocusCapture={() => selectQuestion(quiz, question)}
                        >
                          <div
                            className="min-w-0 max-w-full text-sm font-semibold"
                            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                          >
                            {index + 1}. {question.title || question.prompt}
                            {question.required ? <span className="text-red-300"> *</span> : null}
                          </div>

                          {hasViewerTarget ? (
                            <div className="mt-1 text-[11px] uppercase tracking-wide text-blue-300">
                              Opens question image
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

                  {submitted && !quizScore ? (
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
                        {quizSaving ? 'Submitting…' : 'Submit Quiz'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CaseQuestionsPanel;
