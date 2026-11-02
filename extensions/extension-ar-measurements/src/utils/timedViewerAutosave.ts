/**
 * Debounced draft-only autosave coordinator. It neither chooses a Series nor
 * changes scoring/timeout policy; FormAPI is authoritative for both.
 * All mutable state belongs to this viewer instance and is cancelled on unmount.
 */
export function isTimedViewerAutosaveCandidate(
  saveTarget: any = {},
  {
    isClinicalReportSaveTarget = false,
    isReviewWorkflow = false,
  }: { isClinicalReportSaveTarget?: boolean; isReviewWorkflow?: boolean } = {}
) {
  const learnerSeriesId = String(saveTarget.learnerSeriesId || '').trim();
  const baseSeriesId = String(saveTarget.baseSeriesId || '').trim();
  return saveTarget.timedAssessment === '1' &&
    saveTarget.mode === 'learnerCopyOnSave' &&
    String(saveTarget.launchSource || '').toLowerCase() === 'library' &&
    String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'learner' &&
    !!learnerSeriesId && !!baseSeriesId && learnerSeriesId !== baseSeriesId &&
    !isClinicalReportSaveTarget && !isReviewWorkflow;
}

export type TimedViewerAutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export function createTimedViewerAutosave({
  saveDraft,
  isBusy = () => false,
  onStatus = () => {},
  delayMs = 1800,
}: {
  saveDraft: () => Promise<boolean>;
  isBusy?: () => boolean;
  onStatus?: (status: TimedViewerAutosaveStatus) => void;
  delayMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let persistedRevision = 0;
  let inFlight = false;
  let stopped = false;

  function clearPendingTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearPendingTimer();
    if (stopped || persistedRevision >= revision) return;
    timer = setTimeout(async () => {
      timer = null;
      if (stopped || persistedRevision >= revision) return;
      if (inFlight || isBusy()) {
        schedule();
        return;
      }
      const startedRevision = revision;
      inFlight = true;
      onStatus('saving');
      let saved = false;
      try {
        saved = (await saveDraft()) === true;
      } catch {
        saved = false;
      } finally {
        inFlight = false;
      }
      if (stopped) return;
      if (!saved) {
        // No unbounded retry loop during an outage or after the deadline.
        // A subsequent edit or explicit reconnect may attempt another write,
        // which FormAPI must still authorize atomically.
        clearPendingTimer();
        onStatus('error');
        return;
      }
      persistedRevision = Math.max(persistedRevision, startedRevision);
      if (revision > persistedRevision) {
        onStatus('pending');
        schedule();
      } else {
        onStatus('saved');
      }
    }, delayMs);
  }

  function markDirty() {
    if (stopped) return;
    revision += 1;
    onStatus('pending');
    schedule();
  }

  function retryPending() {
    if (stopped || persistedRevision >= revision) return;
    onStatus('pending');
    schedule();
  }

  function stop() {
    stopped = true;
    clearPendingTimer();
  }

  return { markDirty, retryPending, stop };
}
