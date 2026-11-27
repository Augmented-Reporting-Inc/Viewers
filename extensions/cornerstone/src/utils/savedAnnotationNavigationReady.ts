/** Shared saved-annotation navigation may run before OHIF creates its grid.
 * Display-set availability alone does not establish a usable viewport.
 * Keep this guard side-effect free; never manufacture a viewport ID. */
export function getReadySavedNavigationViewportId(
  viewportGridService: any, cornerstoneViewportService: any
): string | null {
  const state = viewportGridService.getState?.();
  const id = state?.activeViewportId;
  if (typeof id !== 'string' || !id.trim()) return null;
  const row = state.viewports?.get?.(id);
  if (!row || row.isReady !== true || !row.displaySetInstanceUIDs?.length ||
      !cornerstoneViewportService.getCornerstoneViewport(id)) return null;
  return id;
}

/** Reject the entire hanging-protocol update when a viewport is absent.
 * A partially applied protocol layout is not a safe substitute. */
export function hasValidSavedNavigationUpdates(viewportGridService: any, updates: any[]): boolean {
  const viewports = viewportGridService.getState?.()?.viewports;
  return Array.isArray(updates) && updates.length > 0 && updates.every(update =>
    typeof update?.viewportId === 'string' && !!update.viewportId.trim() &&
    !!viewports?.has?.(update.viewportId));
}

export async function waitForSavedNavigationContext({
  viewportGridService, cornerstoneViewportService, resolveDisplaySets,
  isCancelled = () => false, attempts = 150, wait,
}: {
  viewportGridService: any;
  cornerstoneViewportService: any;
  resolveDisplaySets: (viewportId: string) => { activeDisplaySet: any; displaySet: any };
  isCancelled?: () => boolean;
  attempts?: number;
  wait: () => Promise<unknown>;
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isCancelled()) return null;
    const activeViewportId = getReadySavedNavigationViewportId(
      viewportGridService, cornerstoneViewportService);
    if (activeViewportId) {
      const resolved = resolveDisplaySets(activeViewportId);
      if (resolved.displaySet && !isCancelled() &&
          getReadySavedNavigationViewportId(viewportGridService, cornerstoneViewportService) === activeViewportId) {
        return { activeViewportId, ...resolved };
      }
    }
    if (attempt + 1 < attempts) await wait();
  }
  return null;
}

/** Reuse the toolbar Reset Viewport operation; never change stored geometry. */
export function resetViewportPresentation(viewport: any) {
  viewport.resetProperties?.();
  viewport.resetCamera();
  viewport.render();
}

/** Opt-in saved EF review only. Verify exact current source before and after
 * resetting presentation; never reset an unrelated or cancelled viewport. */
export function resetSavedFramePresentation(
  viewport: any, isExactCurrent: () => boolean, isCancelled: () => boolean
): boolean {
  if (isCancelled() || !isExactCurrent()) return false;
  resetViewportPresentation(viewport);
  return !isCancelled() && isExactCurrent();
}
