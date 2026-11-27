import { getReadySavedNavigationViewportId, waitForSavedNavigationContext,
  hasValidSavedNavigationUpdates, getReadySavedNavigationViewport, waitForSavedNavigationViewportData } from './savedAnnotationNavigationReady';

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

describe('strict saved review waits for completed stack presentation', () => {
  function setup() {
    const f = fixture();
    f.ready('v');
    let complete = false;
    const viewport = { id: 'v', getCurrentImageId: () => 'frame', getImageData: () => ({}) };
    const cornerstone = {
      getCornerstoneViewport: () => viewport,
      isViewportDataReady: (_id: string, ids: string[]) => complete && ids.join() === 'initial-set',
    };
    return { ...f, cornerstone, viewport, complete: () => { complete = true; } };
  }
  it('does not navigate on ELEMENT_ENABLED or image availability alone', async () => {
    const f = setup();
    expect(getReadySavedNavigationViewportId(f.grid, f.cornerstone)).toBe('v');
    expect(getReadySavedNavigationViewportId(f.grid, f.cornerstone, true)).toBeNull();
    const wait = jest.fn(async () => { f.complete(); });
    const result = await waitForSavedNavigationContext({
      viewportGridService: f.grid, cornerstoneViewportService: f.cornerstone,
      resolveDisplaySets: f.resolveDisplaySets, requireDataReady: true, attempts: 3, wait,
    });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(f.resolveDisplaySets).toHaveBeenCalledTimes(1);
    expect(result?.activeViewportId).toBe('v');
  });

  it('does not accept a new grid assignment while the old stack is still present', async () => {
    const f = setup();
    f.complete();
    expect(getReadySavedNavigationViewport(f.grid, f.cornerstone, 'v', 'initial-set')).toBe(f.viewport);
    f.grid.getState().viewports.get('v').displaySetInstanceUIDs = ['saved-set'];
    expect(getReadySavedNavigationViewport(f.grid, f.cornerstone, 'v', 'saved-set')).toBeNull();
    const ready = await waitForSavedNavigationViewportData({
      viewportGridService: f.grid, cornerstoneViewportService: f.cornerstone,
      viewportId: 'v', expectedDisplaySetId: 'saved-set', attempts: 2, wait: async () => {},
    });
    expect(ready).toBeNull();
  });

  it('cancels an unfinished destination load without returning an old viewport', async () => {
    const f = setup();
    let cancelled = false;
    const ready = await waitForSavedNavigationViewportData({
      viewportGridService: f.grid, cornerstoneViewportService: f.cornerstone,
      viewportId: 'v', expectedDisplaySetId: 'initial-set', attempts: 3,
      isCancelled: () => cancelled,
      wait: async () => { cancelled = true; f.complete(); },
    });
    expect(ready).toBeNull();
  });
});
