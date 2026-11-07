/**
 * Tracks independently persisted education edits and protects browser unload.
 * The caller must provide a persistence acknowledgement for each source.
 * A save snapshot cannot clear newer edits made while the request was active.
 */
export function createEducationUnsavedWorkGuard(targetWindow: Window) {
  const revisions = new Map<string, number>();
  const savedRevisions = new Map<string, number>();
  let disposed = false;

  const hasUnsavedChanges = () =>
    !disposed &&
    Array.from(revisions).some(([source, revision]) =>
      revision > (savedRevisions.get(source) || 0)
    );

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const syncListener = () => {
    targetWindow.removeEventListener('beforeunload', handleBeforeUnload);
    if (hasUnsavedChanges()) {
      targetWindow.addEventListener('beforeunload', handleBeforeUnload);
    }
  };

  return {
    markChanged(source = 'measurements') {
      if (disposed || !source) return;
      revisions.set(source, (revisions.get(source) || 0) + 1);
      syncListener();
    },
    beginSave(source = 'measurements') {
      return revisions.get(source) || 0;
    },
    acknowledgeSave(
      source: string,
      snapshot: number,
      succeeded: boolean
    ) {
      if (disposed || !succeeded || !source || !Number.isInteger(snapshot)) return;
      const currentRevision = revisions.get(source) || 0;
      const previousSaved = savedRevisions.get(source) || 0;
      savedRevisions.set(source, Math.max(previousSaved, Math.min(snapshot, currentRevision)));
      syncListener();
    },
    hasUnsavedChanges,
    dispose() {
      disposed = true;
      syncListener();
      revisions.clear();
      savedRevisions.clear();
    },
  };
}
