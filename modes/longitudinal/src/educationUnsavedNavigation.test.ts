import { createEducationUnsavedWorkGuard } from './educationUnsavedWorkGuard';
import { installEducationUnsavedNavigation, requestEducationViewerExit } from './educationUnsavedNavigation';

describe('education viewer navigation protection', () => {
  let previousConfirm: typeof window.confirm;

  beforeEach(() => {
    previousConfirm = window.confirm;
    window.confirm = jest.fn(() => false);
  });

  afterEach(() => {
    window.confirm = previousConfirm;
    document.body.innerHTML = '';
  });

  it('does not interrupt clean sessions', () => {
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedNavigation(window, guard);
    expect(requestEducationViewerExit(window)).toBe(true);
    cleanup();
    guard.dispose();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('cancels in-viewer exit when there are unsaved edits', () => {
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedNavigation(window, guard);
    guard.markChanged('authoring');
    expect(requestEducationViewerExit(window)).toBe(false);
    expect(guard.hasUnsavedChanges()).toBe(true);
    cleanup();
    guard.dispose();
  });

  it('prevents a same-tab link from leaving dirty education work', () => {
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedNavigation(window, guard);
    guard.markChanged('quiz:example');
    const link = document.createElement('a');
    link.href = '/different-study';
    link.textContent = 'Another study';
    document.body.appendChild(link);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    cleanup();
    guard.dispose();
  });

  it('rejects browser Back without exposing an unwanted route change', () => {
    const original = window.location.href;
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedNavigation(window, guard);
    guard.markChanged('quiz:example');
    try {
      // A legacy entry without React Router's idx uses the URL restore path.
      window.history.replaceState(null, '', '/another-study');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(window.location.href).toBe(original);
      expect(window.confirm).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      guard.dispose();
      window.history.replaceState(null, '', original);
    }
  });

  it('allows navigation after the user approves discarding edits', () => {
    const guard = createEducationUnsavedWorkGuard(window);
    const cleanup = installEducationUnsavedNavigation(window, guard);
    guard.markChanged('quiz:example');
    (window.confirm as jest.Mock).mockReturnValue(true);
    expect(requestEducationViewerExit(window)).toBe(true);
    cleanup();
    guard.dispose();
  });
});
