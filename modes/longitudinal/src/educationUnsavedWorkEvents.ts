import { createEducationUnsavedWorkGuard } from './educationUnsavedWorkGuard';

type Guard = ReturnType<typeof createEducationUnsavedWorkGuard>;

const CHANGE_EVENT = 'ar:education-work-changed';
const SAVE_START_EVENT = 'ar:education-work-save-start';
const SAVE_RESULT_EVENT = 'ar:education-work-save-result';

/**
 * The three-event contract is shared by learner quiz, educator authoring and
 * measurement workflows. Unrelated sources cannot clear one another.
 */
export function installEducationUnsavedWorkEvents(targetWindow: Window, guard: Guard) {
  const snapshots = new Map<string, { source: string; revision: number }>();
  const onChange = (event: Event) => {
    const source = (event as CustomEvent)?.detail?.source;
    if (typeof source === 'string' && source) guard.markChanged(source);
  };
  const onSaveStart = (event: Event) => {
    const { source, requestId } = (event as CustomEvent)?.detail || {};
    if (typeof source !== 'string' || !source ||
        typeof requestId !== 'string' || !requestId) return;
    snapshots.set(`${source}:${requestId}`, {
      source,
      revision: guard.beginSave(source),
    });
  };
  const onSaveResult = (event: Event) => {
    const { source, requestId, succeeded } = (event as CustomEvent)?.detail || {};
    if (typeof source !== 'string' || typeof requestId !== 'string') return;
    const key = `${source}:${requestId}`;
    const snapshot = snapshots.get(key);
    snapshots.delete(key);
    if (snapshot) guard.acknowledgeSave(source, snapshot.revision, succeeded === true);
  };

  targetWindow.addEventListener(CHANGE_EVENT, onChange);
  targetWindow.addEventListener(SAVE_START_EVENT, onSaveStart);
  targetWindow.addEventListener(SAVE_RESULT_EVENT, onSaveResult);

  return () => {
    targetWindow.removeEventListener(CHANGE_EVENT, onChange);
    targetWindow.removeEventListener(SAVE_START_EVENT, onSaveStart);
    targetWindow.removeEventListener(SAVE_RESULT_EVENT, onSaveResult);
    snapshots.clear();
  };
}

/**
 * No implicit save acknowledgement: only callers that received an affirmative
 * backend result may emit a succeeded=true result event.
 */
export function emitEducationWorkChange(source: string) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { source } }));
}
export function emitEducationWorkSaveStart(source: string, requestId: string) {
  window.dispatchEvent(new CustomEvent(SAVE_START_EVENT, {
    detail: { source, requestId },
  }));
}
export function emitEducationWorkSaveResult(source: string, requestId: string, succeeded: boolean) {
  window.dispatchEvent(new CustomEvent(SAVE_RESULT_EVENT, {
    detail: { source, requestId, succeeded },
  }));
}
