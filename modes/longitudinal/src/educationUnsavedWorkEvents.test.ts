import { createEducationUnsavedWorkGuard } from './educationUnsavedWorkGuard';
import { installEducationUnsavedWorkEvents } from './educationUnsavedWorkEvents';

function dispatch(name: string, detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

describe('education work persistence events', () => {
  it('does not clear quiz edits when a measurement save completes', () => {
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedWorkEvents(window, guard);
    dispatch('ar:education-work-changed', { source: 'quiz:q1' });
    dispatch('ar:education-measurement-deleted', {});
    dispatch('ar:education-measurements-save-start', { requestId: 'measurement-save' });
    dispatch('ar:education-measurements-save-result', {
      requestId: 'measurement-save', succeeded: true,
    });
    expect(guard.hasUnsavedChanges()).toBe(true);
    dispatch('ar:education-work-save-start', { source: 'quiz:q1', requestId: 'quiz-save' });
    dispatch('ar:education-work-save-result', {
      source: 'quiz:q1', requestId: 'quiz-save', succeeded: true,
    });
    expect(guard.hasUnsavedChanges()).toBe(false);
    cleanup();
    guard.dispose();
  });

  it('does not clear edits from an unrelated or failed save response', () => {
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedWorkEvents(window, guard);
    dispatch('ar:education-work-changed', { source: 'authoring' });
    dispatch('ar:education-work-save-result', {
      source: 'authoring', requestId: 'unknown', succeeded: true,
    });
    expect(guard.hasUnsavedChanges()).toBe(true);
    dispatch('ar:education-work-save-start', { source: 'authoring', requestId: 'one' });
    dispatch('ar:education-work-save-result', {
      source: 'authoring', requestId: 'one', succeeded: false,
    });
    expect(guard.hasUnsavedChanges()).toBe(true);
    cleanup();
    guard.dispose();
  });

  it('retains edits made after a save starts', () => {
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedWorkEvents(window, guard);
    dispatch('ar:education-work-changed', { source: 'quiz:q1' });
    dispatch('ar:education-work-save-start', { source: 'quiz:q1', requestId: 'one' });
    dispatch('ar:education-work-changed', { source: 'quiz:q1' });
    dispatch('ar:education-work-save-result', {
      source: 'quiz:q1', requestId: 'one', succeeded: true,
    });
    expect(guard.hasUnsavedChanges()).toBe(true);
    cleanup();
    guard.dispose();
  });
});
