type ViewerSaveTarget = {
  mode: string;
  baseSeriesId: string;
  seriesId: string;
  learnerSeriesId: string;
  mongoId: string;
  launchSource: string;
  measurementWorkflowRole: string;
};

function cleanString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeApiPath(path: string): string {
  return cleanString(path).replace(/^\/+/, '');
}

function getExplicitFormApiBaseFromUrl(): string {
  const qs = getViewerUrlSearchParams();

  return (
    cleanString(qs.get('formApiBase')) ||
    cleanString(qs.get('formapiBase')) ||
    cleanString(qs.get('apiBase')) ||
    ''
  ).replace(/\/+$/, '');
}

function getLikelyProductionFormApiBase(): string {
  try {
    const origin = window.location?.origin || '';
    const host = window.location?.hostname || '';

    if (!origin || !host) {
      return '';
    }

    if (host === 'localhost' || host === '127.0.0.1') {
      return 'https://primebe.futurepacs.com/formapi/api';
    }

    return `${origin.replace(/\/+$/, '')}/formapi/api`;
  } catch {
    return '';
  }
}

export function buildFormApiUrl(path: string): string {
  const normalizedPath = normalizeApiPath(path);
  const explicitBase = getExplicitFormApiBaseFromUrl();

  if (explicitBase) {
    return `${explicitBase.replace(/\/+$/, '')}/${normalizedPath}`;
  }

  const base = getLikelyProductionFormApiBase();

  if (base) {
    return `${base}/${normalizedPath}`;
  }

  return `/formapi/api/${normalizedPath}`;
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

function getArViewerSaveTargetFromUrl(): ViewerSaveTarget {
  const qs = getViewerUrlSearchParams();

  return {
    mode: cleanString(qs.get('arSaveTarget')),
    baseSeriesId: cleanString(qs.get('arBaseSeriesId')),
    seriesId: cleanString(qs.get('arSeriesId')),
    learnerSeriesId: cleanString(qs.get('arLearnerSeriesId')),
    mongoId:
      cleanString(qs.get('mongo_id')) ||
      cleanString(qs.get('mongoId')) ||
      cleanString(qs.get('arMongoId')),
    launchSource: cleanString(qs.get('arLaunchSource')),
    measurementWorkflowRole: cleanString(qs.get('arMeasurementWorkflowRole')),
  };
}

function getStudyInstanceUIDFromUrl(): string {
  const qs = getViewerUrlSearchParams();

  const raw =
    cleanString(qs.get('StudyInstanceUIDs')) ||
    cleanString(qs.get('StudyInstanceUID')) ||
    cleanString(qs.get('studyInstanceUID'));

  return raw.split(',')[0]?.trim() || '';
}

function isTruthyUrlFlag(value: unknown): boolean {
  return ['1', 'true', 'yes', 'y'].includes(cleanString(value).toLowerCase());
}

export function isViewerQuizAuthoringMode(): boolean {
  const qs = getViewerUrlSearchParams();

  return isTruthyUrlFlag(qs.get('arQuizAuthoring'));
}

export function getViewerQuizAuthoringContextFromUrl() {
  const qs = getViewerUrlSearchParams();

  return {
    libraryContentKey:
      cleanString(qs.get('arLibraryContentKey')) ||
      cleanString(qs.get('libraryContentKey')) ||
      cleanString(qs.get('studyKey')),
    preferredDefinitionId:
      cleanString(qs.get('arQuizDefinitionId')) ||
      cleanString(qs.get('quizDefinitionId')) ||
      cleanString(qs.get('definitionId')),
  };
}

export function getViewerQuizSessionKeyFromUrl(): string {
  const saveTarget = getArViewerSaveTargetFromUrl();
  const authoringContext = getViewerQuizAuthoringContextFromUrl();
  const authoringMode = isViewerQuizAuthoringMode();
  const primaryIdentity = authoringMode
    ? authoringContext.preferredDefinitionId || authoringContext.libraryContentKey
    : saveTarget.baseSeriesId ||
      saveTarget.learnerSeriesId ||
      saveTarget.seriesId ||
      saveTarget.mongoId ||
      getStudyInstanceUIDFromUrl();
  const secondaryIdentity = authoringMode
    ? authoringContext.libraryContentKey
    : getStudyInstanceUIDFromUrl();

  return [
    'viewer-quiz',
    authoringMode ? 'authoring' : 'learner',
    primaryIdentity || 'unknown',
    secondaryIdentity || '',
  ].join('|');
}

function isLibraryLaunchSource(launchSource = ''): boolean {
  return cleanString(launchSource).toLowerCase() === 'library';
}

function isAllowedLibraryLearningWorkflowRole(role = ''): boolean {
  return ['learner', 'educator'].includes(cleanString(role).toLowerCase());
}

function isLearnerCopyOnSaveTarget(saveTarget: ViewerSaveTarget): boolean {
  return (
    saveTarget.mode === 'learnerCopyOnSave' &&
    !!saveTarget.baseSeriesId &&
    isLibraryLaunchSource(saveTarget.launchSource) &&
    isAllowedLibraryLearningWorkflowRole(saveTarget.measurementWorkflowRole)
  );
}

function rememberArLearnerSeriesId(seriesId: unknown): void {
  const id = cleanString(seriesId);

  if (!id) {
    return;
  }

  try {
    const parsed = new URL(window.location.href);
    parsed.searchParams.set('arLearnerSeriesId', id);
    window.history.replaceState(window.history.state, '', parsed.toString());
  } catch {}
}

function getLearnerSeriesIdFromQuizContextPayload(
  payload: any,
  saveTarget: ViewerSaveTarget
): string {
  const learnerSeriesId = cleanString(payload?.learnerSeriesId);

  if (learnerSeriesId) {
    return learnerSeriesId;
  }

  const payloadSeriesId = cleanString(payload?.seriesId);

  if (payloadSeriesId && payloadSeriesId !== cleanString(saveTarget.baseSeriesId)) {
    return payloadSeriesId;
  }

  return '';
}

async function fetchJson(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  let body: any = null;

  try {
    body = await response.json();
  } catch {}

  if (!response.ok) {
    const message = body?.message || body?.error || `${response.status}`;
    throw new Error(message);
  }

  return body;
}

async function fetchSeriesDocById(seriesId: string) {
  const id = cleanString(seriesId);

  if (!id) {
    return null;
  }

  return fetchJson(buildFormApiUrl(`series/${encodeURIComponent(id)}`));
}

async function fetchSeriesDocForActiveStudy() {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (saveTarget.learnerSeriesId) {
    return fetchSeriesDocById(saveTarget.learnerSeriesId);
  }

  if (saveTarget.seriesId) {
    return fetchSeriesDocById(saveTarget.seriesId);
  }

  if (saveTarget.mongoId) {
    return fetchSeriesDocById(saveTarget.mongoId);
  }

  if (saveTarget.baseSeriesId) {
    return fetchSeriesDocById(saveTarget.baseSeriesId);
  }

  const studyInstanceUID = getStudyInstanceUIDFromUrl();

  if (!studyInstanceUID) {
    return null;
  }

  return fetchJson(buildFormApiUrl(`series/study/${encodeURIComponent(studyInstanceUID)}`));
}

async function ensureLearnerCopyForViewerSave(saveTarget: ViewerSaveTarget) {
  const learnerCopy = await fetchJson(buildFormApiUrl('series/ensure-learner-copy'), {
    method: 'POST',
    body: JSON.stringify({
      baseSeriesId: saveTarget.baseSeriesId,
    }),
  });

  rememberArLearnerSeriesId(learnerCopy?._id);

  return learnerCopy;
}

async function fetchViewerQuizContextForSaveTarget(saveTarget: ViewerSaveTarget) {
  if (!saveTarget.baseSeriesId) {
    return null;
  }

  const qs = new URLSearchParams({
    baseSeriesId: saveTarget.baseSeriesId,
  });

  if (saveTarget.learnerSeriesId) {
    qs.set('learnerSeriesId', saveTarget.learnerSeriesId);
  }

  const payload = await fetchJson(buildFormApiUrl(`series/viewer-quiz-context?${qs.toString()}`));

  const learnerSeriesId = getLearnerSeriesIdFromQuizContextPayload(payload, saveTarget);

  if (learnerSeriesId) {
    rememberArLearnerSeriesId(learnerSeriesId);
  }

  return payload;
}

async function resolveViewerReadSeriesDoc() {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (saveTarget.learnerSeriesId) {
    return fetchSeriesDocById(saveTarget.learnerSeriesId);
  }

  return fetchSeriesDocForActiveStudy();
}

async function resolveViewerSaveSeriesDoc() {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (isLearnerCopyOnSaveTarget(saveTarget)) {
    if (saveTarget.learnerSeriesId) {
      return fetchSeriesDocById(saveTarget.learnerSeriesId);
    }

    const contextPayload = await fetchViewerQuizContextForSaveTarget(saveTarget);
    const learnerSeriesId = getLearnerSeriesIdFromQuizContextPayload(contextPayload, saveTarget);

    if (learnerSeriesId) {
      rememberArLearnerSeriesId(learnerSeriesId);
      return fetchSeriesDocById(learnerSeriesId);
    }

    return ensureLearnerCopyForViewerSave(saveTarget);
  }

  return resolveViewerReadSeriesDoc();
}

async function resolveViewerQuizScoreSeriesDoc() {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (isLearnerCopyOnSaveTarget(saveTarget)) {
    if (saveTarget.learnerSeriesId) {
      return fetchSeriesDocById(saveTarget.learnerSeriesId);
    }

    const contextPayload = await fetchViewerQuizContextForSaveTarget(saveTarget);
    const learnerSeriesId = cleanString(
      contextPayload?.learnerSeriesId || contextPayload?.seriesId || ''
    );

    if (learnerSeriesId) {
      rememberArLearnerSeriesId(learnerSeriesId);
      return fetchSeriesDocById(learnerSeriesId);
    }

    return null;
  }

  return resolveViewerReadSeriesDoc();
}

function getSeriesId(seriesDoc: any): string {
  return cleanString(seriesDoc?._id || seriesDoc?.id);
}

export async function getViewerQuizzesForActiveStudy() {
  const saveTarget = getArViewerSaveTargetFromUrl();

  if (isLearnerCopyOnSaveTarget(saveTarget)) {
    const contextPayload = await fetchViewerQuizContextForSaveTarget(saveTarget);
    const learnerSeriesId = getLearnerSeriesIdFromQuizContextPayload(contextPayload, saveTarget);

    return {
      ...(contextPayload || {}),
      seriesDoc: null,
      seriesId: cleanString(contextPayload?.seriesId || learnerSeriesId || ''),
      baseSeriesId: cleanString(contextPayload?.baseSeriesId || saveTarget.baseSeriesId),
      learnerSeriesId: cleanString(learnerSeriesId || saveTarget.learnerSeriesId),
      tenantId: cleanString(contextPayload?.tenantId),
      enabled: contextPayload?.enabled === true,
      contentKeys: Array.isArray(contextPayload?.contentKeys) ? contextPayload.contentKeys : [],
      quizzes: Array.isArray(contextPayload?.quizzes) ? contextPayload.quizzes : [],
      responses: Array.isArray(contextPayload?.responses) ? contextPayload.responses : [],
    };
  }

  const seriesDoc = await resolveViewerReadSeriesDoc();
  const seriesId = getSeriesId(seriesDoc);

  if (!seriesId) {
    return {
      seriesDoc: null,
      seriesId: '',
      tenantId: '',
      enabled: false,
      contentKeys: [],
      quizzes: [],
      responses: [],
    };
  }

  const payload = await fetchJson(
    buildFormApiUrl(`series/${encodeURIComponent(seriesId)}/viewer-quizzes`)
  );

  return {
    ...payload,
    seriesDoc,
    seriesId: cleanString(payload?.seriesId || seriesId),
  };
}

export async function saveViewerQuizResponseForActiveStudy({
  quizKey,
  quizVersion,
  status,
  answers,
}: {
  quizKey: string;
  quizVersion: number;
  status: 'draft' | 'submitted';
  answers: Array<{
    questionKey: string;
    value: any;
    viewerTarget?: any;
    normalizedAnswer?: any;
    sourceRefs?: any;
    reviewPayload?: any;
  }>;
}) {
  const seriesDoc = await resolveViewerSaveSeriesDoc();
  const seriesId = getSeriesId(seriesDoc);

  if (!seriesId) {
    throw new Error('Unable to resolve series for case question save.');
  }

  const payload = await fetchJson(
    buildFormApiUrl(`series/${encodeURIComponent(seriesId)}/viewer-quiz-responses`),
    {
      method: 'PUT',
      body: JSON.stringify({
        quizKey,
        quizVersion,
        status,
        answers,
      }),
    }
  );

  const resolvedSeriesId = cleanString(payload?.seriesId || seriesId);
  rememberArLearnerSeriesId(resolvedSeriesId);

  return {
    ...payload,
    seriesDoc,
    seriesId: resolvedSeriesId,
    learnerSeriesId: resolvedSeriesId,
  };
}

export async function submitViewerQuizScoreForActiveStudy() {
  const seriesDoc = await resolveViewerSaveSeriesDoc();
  const seriesId = getSeriesId(seriesDoc);

  if (!seriesId) {
    throw new Error('Unable to resolve series for case question scoring.');
  }

  const payload = await fetchJson(
    buildFormApiUrl(`series/${encodeURIComponent(seriesId)}/viewer-quiz-score`),
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );

  const resolvedSeriesId = cleanString(payload?.seriesId || seriesId);
  rememberArLearnerSeriesId(resolvedSeriesId);

  return {
    ...payload,
    seriesDoc,
    seriesId: resolvedSeriesId,
    learnerSeriesId: resolvedSeriesId,
  };
}

export async function getViewerQuizScoreForActiveStudy() {
  const seriesDoc = await resolveViewerQuizScoreSeriesDoc();
  const seriesId = getSeriesId(seriesDoc);

  if (!seriesId) {
    return null;
  }

  const payload = await fetchJson(
    buildFormApiUrl(`series/${encodeURIComponent(seriesId)}/viewer-quiz-score`)
  );

  const resolvedSeriesId = cleanString(payload?.seriesId || seriesId);
  rememberArLearnerSeriesId(resolvedSeriesId);

  return {
    ...payload,
    seriesDoc,
    seriesId: resolvedSeriesId,
    learnerSeriesId: resolvedSeriesId,
  };
}

export async function submitAndRefreshViewerQuizScoreForActiveStudy() {
  const submittedPayload = await submitViewerQuizScoreForActiveStudy();

  try {
    const refreshedPayload = await getViewerQuizScoreForActiveStudy();

    if (refreshedPayload) {
      return {
        ...submittedPayload,
        ...refreshedPayload,
        submittedPayload,
      };
    }
  } catch {
    // Keep the POST result if the follow-up score read fails.
  }

  return submittedPayload;
}

export async function getViewerQuizAuthoringContent() {
  const context = getViewerQuizAuthoringContextFromUrl();

  if (!context.libraryContentKey) {
    throw new Error('Missing quiz authoring content key.');
  }

  const qs = new URLSearchParams({
    libraryContentKey: context.libraryContentKey,
  });

  return fetchJson(buildFormApiUrl(`library/quiz-management/content?${qs.toString()}`));
}

export async function saveViewerQuizAuthoringDraft({
  definitionId,
  title,
  description,
  changeSummary,
  domain,
  workflow,
  viewerMode,
  questions,
  rubricId,
  rubricItems,
}: {
  definitionId: string;
  title?: string;
  description?: string;
  changeSummary?: string;
  domain?: string;
  workflow?: string;
  viewerMode?: string;
  questions: any[];
  rubricId?: string;
  rubricItems?: any[];
}) {
  const id = cleanString(definitionId);

  if (!id) {
    throw new Error('Missing draft quiz definition id.');
  }

  return fetchJson(buildFormApiUrl(`library/quiz-management/drafts/${encodeURIComponent(id)}`), {
    method: 'PUT',
    body: JSON.stringify({
      title,
      description,
      changeSummary,
      domain,
      workflow,
      viewerMode,
      questions,
      rubricId,
      rubricItems,
    }),
  });
}
