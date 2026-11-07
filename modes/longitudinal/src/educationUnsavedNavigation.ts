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
  let lastHistoryIndex = Number.isInteger(targetWindow.history.state?.idx)
    ? targetWindow.history.state.idx : null;
  let rollingBackPop = false;
  const onExplicitLeave = (event: Event) => {
    if (!guard.confirmExit()) event.preventDefault();
  };

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
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
    const nextIndex = Number.isInteger(targetWindow.history.state?.idx)
      ? targetWindow.history.state.idx : null;
    if (rollingBackPop) {
      rollingBackPop = false;
      lastUrl = destination;
      lastHistoryIndex = nextIndex;
      // Cancelled navigation should not cause a transient viewer route change.
      event.stopImmediatePropagation();
      return;
    }
    if (destination === lastUrl) return;
    if (!guard.confirmExit()) {
      // The browser has already changed history position. Roll back before
      // React Router's bubble-phase popstate listener receives this event.
      if (lastHistoryIndex !== null && nextIndex !== null &&
          lastHistoryIndex !== nextIndex) {
        rollingBackPop = true;
        targetWindow.history.go(lastHistoryIndex - nextIndex);
      } else {
        // Legacy history entries without a React Router index: preserve URL.
        targetWindow.history.pushState(targetWindow.history.state, '', lastUrl);
      }
      event.stopImmediatePropagation();
      return;
    }
    lastUrl = destination;
    lastHistoryIndex = nextIndex;
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
