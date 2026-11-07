import { createEducationUnsavedWorkGuard } from './educationUnsavedWorkGuard';

function mockWindow() {
  const listeners = new Set<EventListener>();
  const win = {
    addEventListener: jest.fn((_name: string, listener: EventListener) => listeners.add(listener)),
    removeEventListener: jest.fn((_name: string, listener: EventListener) => listeners.delete(listener)),
  } as unknown as Window;
  return {
    win,
    fireBeforeUnload() {
      const event = { preventDefault: jest.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
      listeners.forEach(listener => listener(event));
      return event;
    },
    count() {
      return listeners.size;
    },
  };
}

describe('education unsaved work guard', () => {
  it('does not prompt when no edits exist', () => {
    const w = mockWindow();
    const guard = createEducationUnsavedWorkGuard(w.win);
    expect(w.count()).toBe(0);
    guard.dispose();
  });

  it('warns after edits and clears only after acknowledged save', () => {
    const w = mockWindow();
    const guard = createEducationUnsavedWorkGuard(w.win);
    guard.markChanged();
    const event = w.fireBeforeUnload();
    expect(event.preventDefault).toHaveBeenCalled();
    const snapshot = guard.beginSave();
    guard.acknowledgeSave('measurements', snapshot, false);
    expect(guard.hasUnsavedChanges()).toBe(true);
    guard.acknowledgeSave('measurements', snapshot, true);
    expect(guard.hasUnsavedChanges()).toBe(false);
    expect(w.count()).toBe(0);
  });

  it('does not let a measurement save clear unsaved quiz edits', () => {
    const w = mockWindow();
    const guard = createEducationUnsavedWorkGuard(w.win);
    guard.markChanged('measurements');
    guard.markChanged('quiz');
    const measurementSnapshot = guard.beginSave('measurements');
    guard.acknowledgeSave('measurements', measurementSnapshot, true);
    expect(guard.hasUnsavedChanges()).toBe(true);
    guard.acknowledgeSave('quiz', guard.beginSave('quiz'), true);
    expect(guard.hasUnsavedChanges()).toBe(false);
    guard.dispose();
  });

  it('rejects an unacknowledged or invalid snapshot', () => {
    const w = mockWindow();
    const guard = createEducationUnsavedWorkGuard(w.win);
    guard.markChanged();
    guard.acknowledgeSave('measurements', Number.NaN, true);
    expect(guard.hasUnsavedChanges()).toBe(true);
    guard.dispose();
  });

  it('retains changes created during a save', () => {
    const w = mockWindow();
    const guard = createEducationUnsavedWorkGuard(w.win);
    guard.markChanged();
    const snapshot = guard.beginSave();
    guard.markChanged();
    guard.acknowledgeSave('measurements', snapshot, true);
    expect(guard.hasUnsavedChanges()).toBe(true);
    guard.dispose();
    expect(w.count()).toBe(0);
  });
});
