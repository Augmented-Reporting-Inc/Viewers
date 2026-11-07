/**
 * Protect editable education measurements from accidental browser/tab closure.
 *
 * Each save owns a snapshot of the mutation revision at its start. A successful
 * response cannot clear a newer edit made while that request was in flight.
 * This deliberately does not intercept clinical viewer navigation.
 */
export function createEducationUnsavedWorkGuard(targetWindow: Window) {
  let revision = 0;
  let savedRevision = 0;
  let disposed = false;

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (revision === savedRevision || disposed) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  };

  const syncListener = () => {
    targetWindow.removeEventListener('beforeunload', handleBeforeUnload);
    if (!disposed && revision !== savedRevision) {
      targetWindow.addEventListener('beforeunload', handleBeforeUnload);
    }
  };

  return {
    markChanged() {
      if (disposed) return;
      revision += 1;
      syncListener();
    },
    beginSave() {
      return revision;
    },
    acknowledgeSave(savedSnapshot: number, succeeded: boolean) {
      if (disposed || !succeeded || !Number.isInteger(savedSnapshot)) return;
      savedRevision = Math.max(savedRevision, Math.min(savedSnapshot, revision));
      syncListener();
    },
    hasUnsavedChanges() {
      return !disposed && revision !== savedRevision;
    },
    dispose() {
      disposed = true;
      syncListener();
    },
  };
}
