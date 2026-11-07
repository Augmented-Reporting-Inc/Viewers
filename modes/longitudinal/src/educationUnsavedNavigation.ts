import { createEducationUnsavedWorkGuard } from './educationUnsavedWorkGuard';

type Guard = ReturnType<typeof createEducationUnsavedWorkGuard>;

/**
 * Education-only navigation protection. Does not replace the global OHIF
 * BrowserRouter or monkey-patch history.pushState / router internals.
 */
export function installEducationUnsavedNavigation(
  targetWindow: Window,
  guard: Guard
) {
  let lastUrl = targetWindow.location.href;
  const onExplicitLeave = (event: Event) => {
    if (!guard.confirmExit()) event.preventDefault();
  };

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!anchor || anchor.hasAttribute('download') || anchor.target === '_blank') return;
    const destination = new URL(anchor.href, targetWindow.location.href);
    const current = new URL(targetWindow.location.href);
    // Hash-only navigation is part of viewer interaction, not leaving work.
    if (destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search) return;
    if (!guard.confirmExit()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const onPopState = (event: PopStateEvent) => {
    const destination = targetWindow.location.href;
    if (destination === lastUrl) return;
    if (!guard.confirmExit()) {
      // popstate is not cancelable; reinstate the previous URL before router
      // listeners consume the event. This listener is installed in capture.
      targetWindow.history.pushState(targetWindow.history.state, '', lastUrl);
      event.stopImmediatePropagation();
      return;
    }
    lastUrl = destination;
  };

  targetWindow.addEventListener('ar:education-request-leave', onExplicitLeave);
  targetWindow.document.addEventListener('click', onClick, true);
  targetWindow.addEventListener('popstate', onPopState, true);

  return () => {
    targetWindow.removeEventListener('ar:education-request-leave', onExplicitLeave);
    targetWindow.document.removeEventListener('click', onClick, true);
    targetWindow.removeEventListener('popstate', onPopState, true);
  };
}

export function requestEducationViewerExit(targetWindow: Window) {
  return targetWindow.dispatchEvent(
    new CustomEvent('ar:education-request-leave', { cancelable: true })
  );
}
