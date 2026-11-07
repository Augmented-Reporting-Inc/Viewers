import { createEducationUnsavedWorkGuard } from './educationUnsavedWorkGuard';

function mockWindow() {
  const listeners = new Set<EventListener>();
  const win = {
    addEventListener: jest.fn((_name, listener) => listeners.add(listener)),
    removeEventListener: jest.fn((_name, listener) => listeners.delete(listener)),
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
    guard.acknowledgeSave(snapshot, false);
    expect(guard.hasUnsavedChanges()).toBe(true);
    guard.acknowledgeSave(snapshot, true);
    expect(guard.hasUnsavedChanges()).toBe(false);
    expect(w.count()).toBe(0);
  });

  it('retains changes created during a save', () => {
    const w = mockWindow();
    const guard = createEducationUnsavedWorkGuard(w.win);
    guard.markChanged();
    const snapshot = guard.beginSave();
    guard.markChanged();
    guard.acknowledgeSave(snapshot, true);
    expect(guard.hasUnsavedChanges()).toBe(true);
    guard.dispose();
    expect(w.count()).toBe(0);
  });
});
