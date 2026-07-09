import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  getViewerQuizAuthoringContent,
  getViewerQuizzesForActiveStudy,
  getViewerQuizScoreForActiveStudy,
  getViewerQuizAuthoringContextFromUrl,
  isViewerQuizAuthoringMode,
  saveViewerQuizAuthoringDraft,
  saveViewerQuizResponseForActiveStudy,
  submitAndRefreshViewerQuizScoreForActiveStudy,
} from '../utils/viewerQuizApi';

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

function cleanString(value: unknown): string {
  return String(value || '').trim();
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

function buildInitialAnswers(quizzes: QuizDefinition[] = [], responses: QuizResponse[] = []) {
  const next = {};

  quizzes.forEach(quiz => {
    const matchingResponse = responses.find(
      response =>
        response.quizKey === quiz.quizKey &&
        Number(response.quizVersion || 1) === Number(quiz.quizVersion || 1)
    );

    const quizAnswers = {};

    (matchingResponse?.answers || []).forEach(answer => {
      quizAnswers[answer.questionKey] = answer.value;
    });

    next[quiz.quizKey] = quizAnswers;
  });

  return next;
}

function getAnswerViewerTarget(value: any) {
  const answer = plainObject(value);
  const candidates = [
    answer.selectedTarget,
    answer.viewerTarget,
    answer.placedMarker?.viewerTarget,
    answer.goldMeasurement?.viewerTarget,
  ];

  return candidates.find(targetHasNavigationIdentity) || null;
}

function buildAnswerPayload(quiz: QuizDefinition, quizAnswers = {}) {
  return (quiz.questions || []).map(question => {
    const value = quizAnswers[question.questionKey];
    const viewerTarget = getAnswerViewerTarget(value);

    return {
      questionKey: question.questionKey,
      value,
      ...(viewerTarget ? { viewerTarget } : {}),
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
  const index = markerOptions.length;
  return `marker-${String.fromCharCode(97 + index)}`;
}

function getDisplayFrameFromTarget(target: any) {
  const frameNumber = Number(target?.frameNumber);
  const imageIndex = Number(target?.imageIndex);

  if (Number.isFinite(frameNumber) && frameNumber > 0) {
    return frameNumber;
  }
  if (Number.isFinite(imageIndex) && imageIndex >= 0) {
    return imageIndex + 1;
  }
  return null;
}

function getDisplayInstanceFromTarget(target: any) {
  const instanceNumber = Number(target?.instanceNumber);

  if (Number.isFinite(instanceNumber)) {
    return `Instance ${instanceNumber}`;
  }

  return 'Instance unknown';
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
    return normalizeMarkerOptions(answerConfig.markerOptions).filter(isMarkerOptionPlaced);
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
      },
    ];
  }

  return [];
}

function CaseQuestionsPanel({ commandsManager, servicesManager }: CaseQuestionsPanelProps) {
  const { uiNotificationService } = servicesManager.services;

  const [loading, setLoading] = useState(true);
  const [savingQuizKey, setSavingQuizKey] = useState('');
  const [scoringQuizKey, setScoringQuizKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [answersByQuizKey, setAnswersByQuizKey] = useState({});
  const [scoringPayload, setScoringPayload] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeQuestionKey, setActiveQuestionKey] = useState('');
  const [capturingMeasurementKey, setCapturingMeasurementKey] = useState('');
  const [capturingFrameKey, setCapturingFrameKey] = useState('');
  const [capturingPointKey, setCapturingPointKey] = useState('');
  const authoringMode = isViewerQuizAuthoringMode();
  const [authoringPayload, setAuthoringPayload] = useState<any>(null);
  const [authoringDefinition, setAuthoringDefinition] = useState<QuizDefinition | null>(null);
  const [authoringRubric, setAuthoringRubric] = useState<QuizRubric | null>(null);
  const [authoringQuestions, setAuthoringQuestions] = useState<QuizQuestion[]>([]);
  const authoringQuestionsRef = useRef<QuizQuestion[]>([]);
  const [authoringSaving, setAuthoringSaving] = useState(false);
  const [capturingAuthoringKey, setCapturingAuthoringKey] = useState('');

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
      const selectedRubric = findRubricForDefinition(rubrics, selectedDefinition);
      const nextQuestions = Array.isArray(selectedDefinition?.questions)
        ? selectedDefinition.questions
        : [];

      if (nextPayload?.capabilities?.canManageQuizContent !== true) {
        throw new Error('Quiz authoring is not allowed for this account.');
      }

      setAuthoringPayload(nextPayload);
      setAuthoringDefinition(selectedDefinition);
      setAuthoringRubric(selectedRubric);
      authoringQuestionsRef.current = nextQuestions;
      setAuthoringQuestions(nextQuestions);
    } catch (error) {
      setErrorMessage(error?.message || String(error));
      setAuthoringPayload(null);
      setAuthoringDefinition(null);
      setAuthoringRubric(null);
      authoringQuestionsRef.current = [];
      setAuthoringQuestions([]);
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
      setPayload(nextPayload);
      setAnswersByQuizKey(
        buildInitialAnswers(nextPayload.quizzes || [], nextPayload.responses || [])
      );

      await refreshScoringPayload();
    } catch (error) {
      const message = error?.message || String(error);
      setErrorMessage(message);
      setPayload(null);
      setAnswersByQuizKey({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

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

  function getPlacedAnswerMarkerOptions(value: any) {
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
      },
    ];
  }

  async function selectQuestion(
    quiz: QuizDefinition,
    question: QuizQuestion,
    options: { force?: boolean } = {}
  ) {
    const nextActiveQuestionKey = `${quiz.quizKey}:${question.questionKey}`;

    if (!options.force && activeQuestionKey === nextActiveQuestionKey) {
      return;
    }

    setActiveQuestionKey(nextActiveQuestionKey);

    const viewerTarget = getQuestionViewerTarget(question);

    if (!viewerTarget) {
      const questionAnswer = answersByQuizKey?.[quiz.quizKey]?.[question.questionKey];
      const overlayMarkers = [
        ...getOverlayMarkerOptionsForQuestion(question, {
          includeGoldMarker: authoringMode,
        }),
        ...(!authoringMode && isPlaceMarkerQuestionType(question)
          ? getPlacedAnswerMarkerOptions(questionAnswer)
          : []),
      ];

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

      const questionAnswer = answersByQuizKey?.[quiz.quizKey]?.[question.questionKey];
      const overlayMarkers = [
        ...getOverlayMarkerOptionsForQuestion(question, {
          includeGoldMarker: authoringMode,
        }),
        ...(!authoringMode && isPlaceMarkerQuestionType(question)
          ? getPlacedAnswerMarkerOptions(questionAnswer)
          : []),
      ];

      if (overlayMarkers.length) {
        await runViewerCommand(commandsManager, 'showViewerQuizMarkerOptions', {
          viewerTarget,
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

      const [quizKey, questionKey] = activeQuestionKey.split(':');
      const quiz = payload?.quizzes?.find(item => item.quizKey === quizKey);
      const question = quiz?.questions?.find(item => item.questionKey === questionKey);

      if (!quiz || !question || question.type !== 'measurementNumeric') {
        return;
      }

      captureSelectedMeasurementAnswer(quiz, question, {
        measurementId,
        silent: true,
      });
    }

    window.addEventListener(AR_QUIZ_MEASUREMENT_ADDED_EVENT, handleQuizMeasurementAdded);

    return () => {
      window.removeEventListener(AR_QUIZ_MEASUREMENT_ADDED_EVENT, handleQuizMeasurementAdded);
    };
  }, [activeQuestionKey, payload, answersByQuizKey]);

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
    setCapturingAuthoringKey(captureKey);

    try {
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

      const answerConfig = plainObject(question.answerConfig);
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
      const markerId =
        cleanString(
          existingMarker?.markerId || existingMarker?.markerKey || existingMarker?.value
        ) || getNextMarkerId(existingMarkers);
      const label =
        cleanString(existingMarker?.label) ||
        `Marker ${String.fromCharCode(65 + existingMarkers.length)}`;
      const target =
        result.answer.viewerTarget || result.answer.selectedTarget || question.viewerTarget;
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
        ...question,
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

    const answerConfig = plainObject(question.answerConfig);
    const nextMarkers = normalizeMarkerOptions(answerConfig.markerOptions).filter(
      marker => cleanString(marker.markerId || marker.markerKey || marker.value) !== markerId
    );
    const nextCorrectMarkerIds = getCorrectMarkerIdsFromAnswerConfig(answerConfig).filter(
      id => id !== markerId
    );
    const nextQuestion = {
      ...question,
      answerConfig: {
        ...answerConfig,
        markerOptions: nextMarkers,
        correctMarkerIds: nextCorrectMarkerIds,
        correctMarkerId: '',
        correctMarkerKey: '',
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

  async function captureAuthoringMeasurement(question: QuizQuestion) {
    const captureKey = `authoring-measurement:${question.questionKey}`;
    const answerConfig = plainObject(question.answerConfig);

    setCapturingAuthoringKey(captureKey);

    try {
      const result = await runViewerCommand(
        commandsManager,
        'getSelectedViewerMeasurementQuizAnswer',
        {
          question,
          measurementType: cleanString(answerConfig.measurementType),
          unit: cleanString(answerConfig.unit),
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

      uiNotificationService.show({
        title: 'Quiz Authoring',
        message: `Gold measurement captured: ${answer.value} ${unit}`,
        type: 'success',
        duration: 3000,
      });
    } catch (error) {
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

  async function saveAuthoringDraft() {
    if (!authoringDefinition || !isDraftDefinition(authoringDefinition)) {
      return;
    }

    setAuthoringSaving(true);
    setErrorMessage('');

    try {
      const definitionId = getDefinitionId(authoringDefinition);
      const questionsToSave = authoringQuestionsRef.current;

      const result = await saveViewerQuizAuthoringDraft({
        definitionId,
        title: authoringDefinition.title || '',
        description: authoringDefinition.description || '',
        changeSummary: 'Viewer authoring update',
        domain: authoringDefinition.domain || 'iuscan',
        workflow: authoringDefinition.workflow || 'library',
        viewerMode: authoringDefinition.viewerMode || 'iuscan',
        questions: questionsToSave,
        rubricId: getRubricId(authoringRubric),
        rubricItems: buildAuthoringRubricItems(questionsToSave),
      });

      const savedDefinition = result?.definition || result?.quizDefinition || null;
      if (Array.isArray(savedDefinition?.questions)) {
        setAuthoringDefinition(savedDefinition);
        authoringQuestionsRef.current = savedDefinition.questions;
        setAuthoringQuestions(savedDefinition.questions);
      }

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
                    onChange={() => {
                      const nextSelectedMarkerIds = toggleMarkerId(selectedMarkerIds, markerId);
                      const selectedMarkerSet = new Set(nextSelectedMarkerIds);

                      setAnswer(quiz.quizKey, question, {
                        selectedMarkerIds: nextSelectedMarkerIds,
                        selectedMarkers: markerOptions.filter(option =>
                          selectedMarkerSet.has(
                            cleanString(option.markerId || option.markerKey || option.value)
                          )
                        ),
                      });
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
              Absolute tolerance
            </label>
            <input
              className="mt-1 w-36 rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
              type="number"
              step="0.01"
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
                        onChange={() =>
                          patchAuthoringAnswerConfig(question, {
                            correctMarkerIds: toggleMarkerId(correctMarkerIds, markerId),
                            correctMarkerId: '',
                            correctMarkerKey: '',
                          })
                        }
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-black text-white">
      <div className="shrink-0 border-b border-gray-700 p-3">
        <div className="text-base font-semibold">Case Questions</div>
        <div className="mt-1 text-xs text-gray-400">Viewer-based questions for this case.</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
              const questions = [...(quiz.questions || [])].sort(
                (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
              );
              const response = getResponseForQuiz(responses, quiz);
              const submitted = cleanString(response?.status).toLowerCase() === 'submitted';
              const quizScore = viewerQuizScore ? getQuizScoreItem(viewerQuizScore, quiz) : null;
              return (
                <div
                  key={`${quiz.quizKey}-${quiz.quizVersion}`}
                  className="rounded border border-gray-700 p-3"
                >
                  <div className="text-sm font-semibold">{quiz.title || 'Case Questions'}</div>

                  {quiz.description ? (
                    <div className="mt-1 text-xs text-gray-400">{quiz.description}</div>
                  ) : null}

                  <div className="bg-blue-950/30 mt-3 rounded border border-blue-700 p-2 text-xs text-blue-100">
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
                          <div className="text-sm font-semibold">
                            {index + 1}. {question.title || question.prompt}
                            {question.required ? <span className="text-red-300"> *</span> : null}
                          </div>

                          {hasViewerTarget ? (
                            <div className="mt-1 text-[11px] uppercase tracking-wide text-blue-300">
                              Opens question image
                            </div>
                          ) : null}

                          {question.title ? (
                            <div className="mt-1 text-xs text-gray-300">{question.prompt}</div>
                          ) : null}

                          {question.helpText ? (
                            <div className="mt-1 text-xs text-gray-400">{question.helpText}</div>
                          ) : null}

                          {renderQuestion(quiz, question, submitted)}
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
