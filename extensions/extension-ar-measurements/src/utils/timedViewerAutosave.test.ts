import { createTimedViewerAutosave, isTimedViewerAutosaveCandidate } from './timedViewerAutosave';

describe('timed viewer autosave draft coordinator', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('enables autosave only for explicit timed learner viewer-first assessment copies', () => {
    const target = {
      timedAssessment: '1', mode: 'learnerCopyOnSave',
      launchSource: 'library', measurementWorkflowRole: 'learner',
      learnerSeriesId: '507f1f77bcf86cd799439011',
      baseSeriesId: '507f1f77bcf86cd799439012',
    };
    expect(isTimedViewerAutosaveCandidate(target)).toBe(true);
    expect(isTimedViewerAutosaveCandidate({ ...target, timedAssessment: '' })).toBe(false);
    expect(isTimedViewerAutosaveCandidate({ ...target, mode: 'clinicalReportMeasurements' })).toBe(false);
    expect(isTimedViewerAutosaveCandidate({ ...target, launchSource: 'report' })).toBe(false);
    expect(isTimedViewerAutosaveCandidate({ ...target, measurementWorkflowRole: 'educator' })).toBe(false);
    expect(isTimedViewerAutosaveCandidate({ ...target, baseSeriesId: target.learnerSeriesId })).toBe(false);
    expect(isTimedViewerAutosaveCandidate({ ...target, learnerSeriesId: '' })).toBe(false);
    expect(isTimedViewerAutosaveCandidate(target, { isClinicalReportSaveTarget: true })).toBe(false);
    expect(isTimedViewerAutosaveCandidate(target, { isReviewWorkflow: true })).toBe(false);
  });

  it('debounces repeated measurement changes into one draft save', async () => {
    const saveDraft = jest.fn().mockResolvedValue(true);
    const statuses: string[] = [];
    const autosave = createTimedViewerAutosave({
      delayMs: 100,
      saveDraft,
      onStatus: status => statuses.push(status),
    });
    autosave.markDirty();
    jest.advanceTimersByTime(70);
    autosave.markDirty();
    jest.advanceTimersByTime(99);
    expect(saveDraft).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]).toBe('saved');
    autosave.stop();
  });

  it('waits for a manual or quiz save instead of overlapping it', async () => {
    let busy = true;
    const saveDraft = jest.fn().mockResolvedValue(true);
    const autosave = createTimedViewerAutosave({
      delayMs: 100, saveDraft, isBusy: () => busy,
    });
    autosave.markDirty();
    jest.advanceTimersByTime(100);
    expect(saveDraft).not.toHaveBeenCalled();
    busy = false;
    jest.advanceTimersByTime(100);
    await flush();
    expect(saveDraft).toHaveBeenCalledTimes(1);
    autosave.stop();
  });

  it('saves a newer edit again without dropping the first in-flight result', async () => {
    let resolveFirst: (ok: boolean) => void = () => {};
    const saveDraft = jest.fn()
      .mockImplementationOnce(() => new Promise<boolean>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue(true);
    const autosave = createTimedViewerAutosave({ delayMs: 100, saveDraft });
    autosave.markDirty();
    jest.advanceTimersByTime(100);
    autosave.markDirty();
    resolveFirst(true);
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    expect(saveDraft).toHaveBeenCalledTimes(2);
    autosave.stop();
  });

  it('does not automatically retry failed offline or expired writes', async () => {
    const saveDraft = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const statuses: string[] = [];
    const autosave = createTimedViewerAutosave({
      delayMs: 100, saveDraft, onStatus: status => statuses.push(status),
    });
    autosave.markDirty();
    jest.advanceTimersByTime(100);
    await flush();
    expect(statuses[statuses.length - 1]).toBe('error');
    jest.advanceTimersByTime(10000);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    autosave.retryPending(); // FormAPI must still reject an expired attempt.
    jest.advanceTimersByTime(100);
    await flush();
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(statuses[statuses.length - 1]).toBe('saved');
    autosave.stop();
  });

  it('does not report a rejected deadline write as saved', async () => {
    const statuses: string[] = [];
    const saveDraft = jest.fn().mockRejectedValue(new Error('assessment_time_expired'));
    const autosave = createTimedViewerAutosave({
      delayMs: 100, saveDraft, onStatus: status => statuses.push(status),
    });
    autosave.markDirty();
    jest.advanceTimersByTime(100);
    await flush();
    expect(statuses[statuses.length - 1]).toBe('error');
    jest.advanceTimersByTime(1000);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(statuses).not.toContain('saved');
    autosave.stop();
  });

  it('cancels a pending save on viewer unmount', () => {
    const saveDraft = jest.fn().mockResolvedValue(true);
    const autosave = createTimedViewerAutosave({ delayMs: 100, saveDraft });
    autosave.markDirty();
    autosave.stop();
    jest.advanceTimersByTime(500);
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
