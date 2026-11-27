import { getReadySavedNavigationViewportId, waitForSavedNavigationContext,
  hasValidSavedNavigationUpdates, resetSavedFramePresentation } from './savedAnnotationNavigationReady';

function fixture() {
  let state: any = { activeViewportId: null, viewports: new Map([
    ['default', { isReady: false, displaySetInstanceUIDs: [] }],
  ]) };
  const grid = { getState: () => state };
  const native = new Set<string>();
  const cornerstone = { getCornerstoneViewport: (id: string) => native.has(id) ? { id } : null };
  const ready = (id: string) => {
    state = { activeViewportId: id, viewports: new Map([
      [id, { isReady: true, displaySetInstanceUIDs: ['initial-set'] }],
    ]) };
    native.add(id);
  };
  const resolveDisplaySets = jest.fn(() => ({activeDisplaySet: {displaySetInstanceUID:'initial-set'},
    displaySet: {displaySetInstanceUID:'saved-set'}}));
  return {grid, cornerstone, ready, resolveDisplaySets, native};
}

describe('saved annotation navigation waits for actual grid initialization', () => {
  it('waits through a null viewport ID even when saved display sets are available', async () => {
    const f = fixture();
    const wait = jest.fn(async () => { f.ready('actual-viewport'); });
    const result = await waitForSavedNavigationContext({
      viewportGridService:f.grid, cornerstoneViewportService:f.cornerstone,
      resolveDisplaySets:f.resolveDisplaySets, attempts:3, wait,
    });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(f.resolveDisplaySets).toHaveBeenCalledTimes(1);
    expect(f.resolveDisplaySets).toHaveBeenCalledWith('actual-viewport');
    expect(result?.activeViewportId).toBe('actual-viewport');
    expect(result?.displaySet.displaySetInstanceUID).toBe('saved-set');
  });

  it('requires a registered native viewport and rejects an absent or unready layout', async () => {
    const f = fixture();
    expect(getReadySavedNavigationViewportId(f.grid,f.cornerstone)).toBeNull();
    f.ready('v');
    f.grid.getState().viewports.get('v').isReady = false;
    expect(getReadySavedNavigationViewportId(f.grid,f.cornerstone)).toBeNull();
    f.grid.getState().viewports.get('v').isReady = true;
    f.native.clear();
    expect(getReadySavedNavigationViewportId(f.grid,f.cornerstone)).toBeNull();
    const result = await waitForSavedNavigationContext({
      viewportGridService:f.grid, cornerstoneViewportService:f.cornerstone,
      resolveDisplaySets:f.resolveDisplaySets, attempts:2, wait:async()=>{},
    });
    expect(result).toBeNull();
    expect(f.resolveDisplaySets).not.toHaveBeenCalled();
  });

  it('re-resolves display sets if the active viewport changed during lookup', async () => {
    const f = fixture();
    f.ready('first');
    const resolveDisplaySets = jest.fn((id:string) => {
      if (id === 'first') f.ready('second');
      return {activeDisplaySet:null,displaySet:{displaySetInstanceUID:'saved-set'}};
    });
    const result = await waitForSavedNavigationContext({
      viewportGridService:f.grid, cornerstoneViewportService:f.cornerstone,
      resolveDisplaySets, attempts:3, wait:async()=>{},
    });
    expect(resolveDisplaySets.mock.calls).toEqual([['first'],['second']]);
    expect(result?.activeViewportId).toBe('second');
  });

  it('cancels pending startup navigation without resolving a later viewport', async () => {
    const f = fixture();
    let cancelled = false;
    const result = await waitForSavedNavigationContext({
      viewportGridService:f.grid, cornerstoneViewportService:f.cornerstone,
      resolveDisplaySets:f.resolveDisplaySets, attempts:3, isCancelled:()=>cancelled,
      wait:async()=>{cancelled=true;f.ready('later');},
    });
    expect(result).toBeNull();
    expect(f.resolveDisplaySets).not.toHaveBeenCalled();
  });

  it('rejects null, empty, stale, and mixed hanging-protocol update IDs', () => {
    const f = fixture();
    f.ready('valid');
    expect(hasValidSavedNavigationUpdates(f.grid,[{viewportId:'valid'}])).toBe(true);
    for (const invalid of [null, '', 'stale', undefined]) {
      expect(hasValidSavedNavigationUpdates(f.grid,[{viewportId:invalid}])).toBe(false);
      expect(hasValidSavedNavigationUpdates(f.grid,[{viewportId:'valid'},{viewportId:invalid}])).toBe(false);
    }
    expect(hasValidSavedNavigationUpdates(f.grid,[])).toBe(false);
  });
});

describe('opt-in exact saved EF viewport presentation reset', () => {
  const makeViewport = () => ({
    resetProperties: jest.fn(), resetCamera: jest.fn(), render: jest.fn(),
  });

  it('uses the toolbar reset operations on the exact current source', () => {
    const viewport = makeViewport();
    const exact = jest.fn(() => true);
    expect(resetSavedFramePresentation(viewport, exact, () => false)).toBe(true);
    expect(viewport.resetProperties).toHaveBeenCalledTimes(1);
    expect(viewport.resetCamera).toHaveBeenCalledTimes(1);
    expect(viewport.render).toHaveBeenCalledTimes(1);
    expect(exact).toHaveBeenCalledTimes(2);
  });

  it('does not reset the presentation of a stale frame or cancelled selection', () => {
    const viewport = makeViewport();
    expect(resetSavedFramePresentation(viewport, () => false, () => false)).toBe(false);
    expect(resetSavedFramePresentation(viewport, () => true, () => true)).toBe(false);
    expect(viewport.resetProperties).not.toHaveBeenCalled();
    expect(viewport.resetCamera).not.toHaveBeenCalled();
    expect(viewport.render).not.toHaveBeenCalled();
  });

  it('does not report success if the exact source changes during the reset', () => {
    const viewport = makeViewport();
    let exact = true;
    viewport.resetCamera.mockImplementation(() => { exact = false; });
    expect(resetSavedFramePresentation(viewport, () => exact, () => false)).toBe(false);
  });
});
