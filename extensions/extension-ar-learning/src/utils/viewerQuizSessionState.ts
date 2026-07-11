export type ViewerQuizSessionState = {
  learnerQuizIdentity?: string;
  answersByQuizKey?: Record<string, Record<string, any>>;
  activeQuestionKey?: string;
  authoringDefinitionId?: string;
  authoringQuestions?: any[];
};

const viewerQuizSessionStates = new Map<string, ViewerQuizSessionState>();

function cleanSessionKey(value: unknown): string {
  return String(value || '').trim();
}

export function readViewerQuizSessionState(sessionKey: string): ViewerQuizSessionState | null {
  const key = cleanSessionKey(sessionKey);

  if (!key) {
    return null;
  }

  return viewerQuizSessionStates.get(key) || null;
}

export function writeViewerQuizSessionState(
  sessionKey: string,
  patch: Partial<ViewerQuizSessionState>
): ViewerQuizSessionState | null {
  const key = cleanSessionKey(sessionKey);

  if (!key) {
    return null;
  }

  const nextState = {
    ...(viewerQuizSessionStates.get(key) || {}),
    ...patch,
  };

  viewerQuizSessionStates.set(key, nextState);
  return nextState;
}
