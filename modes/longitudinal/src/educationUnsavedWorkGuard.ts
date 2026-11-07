/**
 * Tracks independently persisted education edits and protects browser unload.
 * The caller must provide a persistence acknowledgement for each source.
 * A save snapshot cannot clear newer edits made while the request was active.
 */
export function createEducationUnsavedWorkGuard(targetWindow: Window) {
  const revisions = new Map<string, number>();
  const savedRevisions = new Map<string, number>();
  let disposed = false;
  let exitApproved = false;
  let approvalResetTimer: number | null = null;

  const hasUnsavedChanges = () =>
    !disposed &&
    Array.from(revisions).some(([source, revision]) =>
      revision > (savedRevisions.get(source) || 0)
    );

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges() || exitApproved) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const syncListener = () => {
    targetWindow.removeEventListener('beforeunload', handleBeforeUnload);
    if (hasUnsavedChanges() && !exitApproved) {
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
    confirmExit() {
      if (exitApproved || !hasUnsavedChanges()) return true;
      if (!targetWindow.confirm(
        'You have unsaved education work. Leave the viewer and discard your changes?'
      )) return false;
      exitApproved = true;
      syncListener();
      // If navigation is cancelled by another part of the app, restore the
      // warning instead of leaving this viewer permanently unprotected.
      if (approvalResetTimer !== null) targetWindow.clearTimeout(approvalResetTimer);
      approvalResetTimer = targetWindow.setTimeout(() => {
        approvalResetTimer = null;
        exitApproved = false;
        syncListener();
      }, 1500);
      return true;
    },
    dispose() {
      if (approvalResetTimer !== null) {
        targetWindow.clearTimeout(approvalResetTimer);
        approvalResetTimer = null;
      }
      disposed = true;
      exitApproved = false;
      syncListener();
      revisions.clear();
      savedRevisions.clear();
    },
  };
}
