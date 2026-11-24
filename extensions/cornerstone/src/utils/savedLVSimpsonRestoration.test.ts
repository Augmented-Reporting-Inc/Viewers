import { restoreSavedLVSimpsonSlots, mergeSavedLVSimpsonPanelSources } from './savedLVSimpsonRestoration';

const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
const image = (slot: string, frame = 2) =>
  'wadors:https://example.invalid/instances/' + slot + '/frames/' + frame;
const source = (slot: string) => ({
  annotationId: 'source-' + slot,
  SOPInstanceUID: slot, frameNumber: 2, referencedImageId: image(slot),
  lvSimpson: { measurementKind: 'lvSimpsonSlot', slot },
});
function setup() {
  const sources = slots.map(source);
  const native = new Map<string, any>();
  const candidatesBySlot = new Map(sources.map(s => [s.lvSimpson.slot, [s]]));
  const add = (s: any, frame = 2) => native.set(s.annotationId, {
    metadata: { referencedImageId: image(s.lvSimpson.slot, frame) },
    measurement: { ...s, referencedImageId: image(s.lvSimpson.slot, frame) },
  });
  const deps = {
    slots, candidatesBySlot,
    getId: (s: any) => s.annotationId,
    getNativeAnnotation: (id: string) => native.get(id),
    removeMisplacedAnnotation: jest.fn((id: string) => { native.delete(id); }),
    hydrate: jest.fn(async (s: any): Promise<any> => { add(s); return { ok: true }; }),
    getRestoredMeasurement: (id: string) => native.get(id)?.measurement,
    getSlot: (m: any) => m?.lvSimpson?.slot || '',
    onRestored: jest.fn(),
    isCancelled: jest.fn(() => false),
  };
  return { sources, deps, native, add };
}

describe('panel-only saved source display', () => {
  const saved = slots.map(slot => ({ ...source(slot), StudyInstanceUID: 'study-a' }));
  const merge = (live: any[] = [], deleted = new Set<string>(), changed = new Set<string>()) =>
    mergeSavedLVSimpsonPanelSources({
      saved, live, studyInstanceId: 'study-a',
      getId: item => item.annotationId, getSlot: item => item.lvSimpson?.slot || '',
      isDeleted: id => deleted.has(id), isChanged: item => changed.has(item.annotationId),
    });

  it('shows all four saved source rows without hydrating or modifying the baseline', () => {
    const displayed = merge();
    expect(displayed).toHaveLength(4);
    expect(displayed.every(item => item.arSavedEFPanelSource)).toBe(true);
    expect(saved.every(item => !('arSavedEFPanelSource' in item))).toBe(true);
    expect(displayed.map(item => item.annotationId)).toEqual(saved.map(item => item.annotationId));
  });

  it('prefers an existing live source and never resurrects deleted or changed evidence', () => {
    const live = { ...saved[0], points: [[1,2,3]] };
    const deleted = new Set([saved[1].annotationId]);
    const changed = new Set([saved[2].annotationId]);
    const result = merge([live, saved[1], { ...saved[3], annotationId: 'other-study', StudyInstanceUID: 'study-b' }],
      deleted, changed);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(live);
    expect(result[1].annotationId).toBe(saved[3].annotationId);
    expect(result[1].arSavedEFPanelSource).toBe(true);
  });
});

describe('shared saved LV Simpson restoration', () => {
  it('recovers all four slots in the first opening, retrying only the transient failure', async () => {
    const { sources, deps, add } = setup();
    let failed = false;
    deps.hydrate.mockImplementation(async s => {
      if (s === sources[2] && !failed) {
        failed = true;
        return { ok: false, retryable: true, reason: 'viewport-target-image-not-ready' };
      }
      add(s);
      return { ok: true };
    });
    const result = await restoreSavedLVSimpsonSlots(deps);
    expect(result).toEqual({
      cancelled: false, pending: false, restoredCount: 4,
      slots: Object.fromEntries(slots.map(slot => [slot, 'restored'])),
    });
    expect(deps.hydrate.mock.calls.map(([s]) => s.annotationId))
      .toEqual([...sources.map(s => s.annotationId), sources[2].annotationId]);
    expect(deps.onRestored).toHaveBeenCalledTimes(4);
  });

  it('restores only a selected slot, then resolves remaining sources on calculate without rehydrating that slot', async () => {
    const { sources, deps, native } = setup();
    const initial = mergeSavedLVSimpsonPanelSources({
      saved: sources.map(item => ({ ...item, StudyInstanceUID: 'study-a' })),
      live: [], studyInstanceId: 'study-a', getId: deps.getId, getSlot: deps.getSlot,
      isDeleted: () => false, isChanged: () => false,
    });
    expect(initial).toHaveLength(4);
    expect(deps.hydrate).not.toHaveBeenCalled();
    expect(native.size).toBe(0);
    const selected = await restoreSavedLVSimpsonSlots({ ...deps, slots: [slots[2]] });
    expect(selected.restoredCount).toBe(1);
    expect(deps.hydrate.mock.calls.map(([item]) => item.annotationId)).toEqual([sources[2].annotationId]);
    const complete = await restoreSavedLVSimpsonSlots(deps);
    expect(complete.pending).toBe(false);
    expect(complete.restoredCount).toBe(4);
    expect(deps.hydrate.mock.calls.map(([item]) => item.annotationId))
      .toEqual([sources[2], sources[0], sources[1], sources[3]].map(item => item.annotationId));
  });

  it('hydrates a present but incomplete native record, and corrects misplaced saved state', async () => {
    const { sources, deps, native, add } = setup();
    add(sources[0]);
    native.set(sources[1].annotationId, {
      metadata: { referencedImageId: sources[1].referencedImageId },
    });
    add(sources[2], 9);
    const result = await restoreSavedLVSimpsonSlots(deps);
    expect(result.restoredCount).toBe(4);
    expect(deps.hydrate.mock.calls.map(([s]) => s.annotationId))
      .toEqual(sources.slice(1).map(s => s.annotationId));
    expect(deps.removeMisplacedAnnotation).toHaveBeenCalledTimes(1);
    expect(deps.removeMisplacedAnnotation).toHaveBeenCalledWith(sources[2].annotationId);
  });

  it('retains unresolved saved slots after a bounded retry; does not guess duplicates', async () => {
    const { sources, deps } = setup();
    deps.candidatesBySlot.set(slots[0], [sources[0], { ...sources[0], annotationId: 'duplicate' }]);
    deps.hydrate.mockResolvedValue({ ok: false, retryable: true, reason: 'saved-image-not-ready' });
    const result = await restoreSavedLVSimpsonSlots(deps);
    expect(result.pending).toBe(true);
    expect(result.restoredCount).toBe(0);
    expect(result.slots[slots[0]]).toBe('duplicate');
    expect(result.slots[slots[1]]).toBe('saved-image-not-ready');
    expect(deps.hydrate).toHaveBeenCalledTimes(6);
    expect(deps.onRestored).not.toHaveBeenCalled();
  });

  it('stops after a cancelled async hydration and never publishes its result', async () => {
    const { deps, add } = setup();
    let cancelled = false;
    deps.isCancelled.mockImplementation(() => cancelled);
    deps.hydrate.mockImplementation(async s => {
      add(s); cancelled = true; return { ok: true };
    });
    expect((await restoreSavedLVSimpsonSlots(deps)).cancelled).toBe(true);
    expect(deps.hydrate).toHaveBeenCalledTimes(1);
    expect(deps.onRestored).not.toHaveBeenCalled();
  });
});
