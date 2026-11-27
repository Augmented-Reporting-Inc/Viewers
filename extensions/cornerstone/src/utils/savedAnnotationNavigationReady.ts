/** Shared saved-annotation navigation may run before OHIF creates its grid.
 * Display-set availability alone does not establish a usable viewport.
 * Keep this guard side-effect free; never manufacture a viewport ID. */
export function getReadySavedNavigationViewportId(
  viewportGridService: any, cornerstoneViewportService: any, requireDataReady = false
): string | null {
  const state = viewportGridService.getState?.();
  const id = state?.activeViewportId;
  if (typeof id !== 'string' || !id.trim()) return null;
  const row = state.viewports?.get?.(id);
  if (!row || row.isReady !== true || !row.displaySetInstanceUIDs?.length ||
      !cornerstoneViewportService.getCornerstoneViewport(id)) return null;
  if (requireDataReady && !getReadySavedNavigationViewport(
    viewportGridService, cornerstoneViewportService, id)) return null;
  return id;
}

/** Use the same completed load that publishes VIEWPORT_DATA_CHANGED.
 * An enabled element or a populated imageIds array alone is not sufficient. */
export function getReadySavedNavigationViewport(
  viewportGridService: any, cornerstoneViewportService: any,
  viewportId: string, expectedDisplaySetId?: string
) {
  const row = viewportGridService.getState?.()?.viewports?.get?.(viewportId);
  const ids = row?.displaySetInstanceUIDs;
  if (row?.isReady !== true || !ids?.length ||
      (expectedDisplaySetId && !ids.includes(expectedDisplaySetId)) ||
      cornerstoneViewportService.isViewportDataReady?.(viewportId, ids) !== true) return null;
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  return viewport?.getCurrentImageId?.() && viewport?.getImageData?.() ? viewport : null;
}

export async function waitForSavedNavigationViewportData({
  viewportGridService, cornerstoneViewportService, viewportId, expectedDisplaySetId,
  isCancelled = () => false, attempts = 150, wait,
}: {
  viewportGridService: any;
  cornerstoneViewportService: any;
  viewportId: string;
  expectedDisplaySetId: string;
  isCancelled?: () => boolean;
  attempts?: number;
  wait: () => Promise<unknown>;
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isCancelled()) return null;
    const viewport = getReadySavedNavigationViewport(
      viewportGridService, cornerstoneViewportService, viewportId, expectedDisplaySetId);
    if (viewport) return viewport;
    if (attempt + 1 < attempts) await wait();
  }
  return null;
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
  isCancelled = () => false, attempts = 150, wait, requireDataReady = false,
}: {
  viewportGridService: any;
  cornerstoneViewportService: any;
  requireDataReady?: boolean;
  resolveDisplaySets: (viewportId: string) => { activeDisplaySet: any; displaySet: any };
  isCancelled?: () => boolean;
  attempts?: number;
  wait: () => Promise<unknown>;
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isCancelled()) return null;
    const activeViewportId = getReadySavedNavigationViewportId(
      viewportGridService, cornerstoneViewportService, requireDataReady);
    if (activeViewportId) {
      const resolved = resolveDisplaySets(activeViewportId);
      if (resolved.displaySet && !isCancelled() &&
          getReadySavedNavigationViewportId(viewportGridService, cornerstoneViewportService, requireDataReady) === activeViewportId) {
        return { activeViewportId, ...resolved };
      }
    }
    if (attempt + 1 < attempts) await wait();
  }
  return null;
}
