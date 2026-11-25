import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import {
  reconcileResearchEchoCompositeAnswers,
  getVerifiedResearchEFResultCandidate,
  dedupeResearchMeasurementCandidates,
  getResearchEFRestoreSources,
  getPersistedResearchEFCandidate,
  resolvePersistedResearchEF,
  mergeResearchMeasurementAnnotations,
  applyResearchSnapshotEvidence,
  withPersistedResearchEF,
} from './researchEchoAnswerBinding';
import { buildReadFields, buildReadResultEntries, buildReadValueState } from './readSchema';

jest.mock('../../../extension-ar-measurements/src/utils/measurementValueCandidates', () => ({
  buildViewerMeasurementValueCandidates: jest.fn(),
}));

const mockCandidates = buildViewerMeasurementValueCandidates as jest.Mock;
const slots: Record<string, string[]> = {
  lvEjectionFraction: ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'],
  laVolumeDisks: ['A4C', 'A2C'],
  rvFac: ['RV_ED', 'RV_ES'],
  ivcCollapsibility: ['IVC_EXP', 'IVC_INSP'],
};
const info: Record<string, { label: string; unit: string; prefix: string }> = {
  lvEjectionFraction: { label: 'LVEF', unit: '%', prefix: 'lv-simpson:' },
  laVolumeDisks: { label: 'LAVolumeDisks', unit: 'mL', prefix: 'la-disks:' },
  rvFac: { label: 'RVFAC', unit: '%', prefix: 'rv-fac:' },
  ivcCollapsibility: { label: 'IVCCollapsibility', unit: '%', prefix: 'ivc-collapse:' },
};
const target = (slot: string) => ({ sopInstanceUID: 'sop-' + slot, frameNumber: 2 });
function fixture(kind: string, numericValue = 62.37) {
  const phaseSlots = slots[kind];
  const annotations = phaseSlots.map(slot => ({
    annotationId: 'source-' + slot,
    SOPInstanceUID: 'sop-' + slot,
    frameNumber: 2,
  }));
  const candidate = {
    labels: [info[kind].label], value: numericValue,
    unit: info[kind].unit, source: 'viewer-derived',
    sourceMeasurementKey: info[kind].prefix + annotations.map(x => x.annotationId).join(','),
  };
  const field = buildReadFields({ domain: 'echo', components: [{
    componentKey: kind, kind: 'measurement',
    config: {
      unit: info[kind].unit, step: 0.1,
      measurementLabels: [info[kind].label],
      compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: Object.fromEntries(phaseSlots.map(slot => [slot, target(slot)])),
    },
  }] })[0];
  return { annotations, candidate, field };
}

describe('Research source-backed composite answer capture', () => {
  beforeEach(() => mockCandidates.mockReset());

  // The IVC path has its own calibrated Length/phase tests; synthetic EF/LA/RV
  // fixtures below cover the newly unified answer-binding contracts.
  it.each(['lvEjectionFraction', 'laVolumeDisks', 'rvFac'])('binds the verified %s composite and preserves answer provenance', kind => {
    const { field, candidate, annotations } = fixture(kind);
    mockCandidates.mockReturnValue([candidate]);
    const state = reconcileResearchEchoCompositeAnswers([field], {}, {}, annotations);
    expect(state.values[field.key]).toBeCloseTo(kind === 'lvEjectionFraction' ? 62.37 : 62.4);
    expect(state.sources[field.key]).toEqual({
      source: 'viewer-derived', sourceMeasurementKey: candidate.sourceMeasurementKey,
    });
    expect(buildReadResultEntries([field], state.values, state.sources)).toMatchObject([{
      componentKey: kind, value: kind === 'lvEjectionFraction' ? 62.37 : 62.4, source: 'viewer-derived',
    }]);
  });

  it('restores the four saved EF answer sources while retaining older conflicting records', () => {
    const { field, candidate, annotations } = fixture('lvEjectionFraction');
    const verified = annotations.map(item => ({
      ...item, measurementKind: 'lvSimpsonSlot',
    }));
    const oldConflict = {
      ...verified[2], annotationId: 'old-A2C-ED', frameNumber: 27,
    };
    const all = [...verified, oldConflict];
    expect(getResearchEFRestoreSources(
      field, all, candidate.sourceMeasurementKey
    )).toEqual(verified);
    expect(getResearchEFRestoreSources(field, all, '')).toEqual(all);
    expect(getResearchEFRestoreSources(
      field, all, 'lv-simpson:source-A4C_ED,source-A4C_ES,old-A2C-ED,source-A2C_ES'
    )).toEqual(all);
  });

  it('does not mistake the live and explicit copy of one EF source as competing answers', () => {
    const live = {
      source: 'viewer-derived', sourceMeasurementKey: 'lv-simpson:id1,id2,id3,id4',
      labels: ['LVEF'], value: 54.1, unit: '%',
    };
    const explicitlyReviewed = { ...live, value: 54.2 };
    const other = { ...live, sourceMeasurementKey: 'lv-simpson:other-id' };
    expect(dedupeResearchMeasurementCandidates([
      live, other, explicitlyReviewed,
    ])).toEqual([explicitlyReviewed, other]);
  });

  it('adapts the Education EF checkpoint to the exact Research frames without recalculating EF', () => {
    const { field, annotations } = fixture('lvEjectionFraction', 61.19);
    const result = {
      studyInstanceId: 'study-a',
      composite: {
        measurementKind: 'lvSimpsonEF',
        value: 61.19,
        components: slots.lvEjectionFraction.map(slot => ({
          slot, annotationId: 'source-' + slot,
        })),
      },
    };
    const verifiedAnnotations = annotations.map(a => ({
      ...a, StudyInstanceUID: 'study-a',
    }));
    const candidate = getVerifiedResearchEFResultCandidate(
      field, result, verifiedAnnotations
    );
    expect(candidate).toMatchObject({
      value: 61.19, unit: '%', source: 'viewer-derived',
      sourceMeasurementKey: 'lv-simpson:' +
        slots.lvEjectionFraction.map(slot => 'source-' + slot).join(','),
    });
    mockCandidates.mockReturnValue([]);
    const state = reconcileResearchEchoCompositeAnswers(
      [field], {}, {}, verifiedAnnotations, [candidate]
    );
    expect(state.values[field.key]).toBeCloseTo(61.19);
    expect(buildReadResultEntries([field], state.values, state.sources))
      .toMatchObject([{ componentKey: 'lvEjectionFraction', source: 'viewer-derived' }]);

    expect(getVerifiedResearchEFResultCandidate(
      field, result,
      verifiedAnnotations.map(a => a.annotationId === 'source-A2C_ED'
        ? { ...a, frameNumber: 27 } : a)
    )).toBeNull();
    expect(getVerifiedResearchEFResultCandidate(
      field, { ...result, composite: {
        ...result.composite,
        components: [...result.composite.components.slice(0, 3),
          result.composite.components[0]],
      } }, verifiedAnnotations
    )).toBeNull();
    expect(getVerifiedResearchEFResultCandidate(
      field, result, verifiedAnnotations.slice(1)
    )).toBeNull();
    expect(getVerifiedResearchEFResultCandidate(
      field, { ...result, studyInstanceId: 'different-study' }, verifiedAnnotations
    )).toBeNull();
  });

  it('keeps exact value and source identity across Research Read result serialization/reopen', () => {
    const { field, candidate, annotations } = fixture('lvEjectionFraction', 61.19);
    mockCandidates.mockReturnValue([candidate]);
    const state = reconcileResearchEchoCompositeAnswers([field], {}, {}, annotations);
    const persisted = buildReadResultEntries([field], state.values, state.sources);
    const reopened = buildReadValueState({ entries: persisted });
    expect(reopened.values[field.key]).toBe(61.19);
    expect(reopened.sources[field.key]).toEqual({
      source: 'viewer-derived', sourceMeasurementKey: candidate.sourceMeasurementKey,
    });
  });

  function savedEFFixture() {
    const { field, candidate, annotations } = fixture('lvEjectionFraction', 61.19);
    const controls = [[-1,0,0],[-2,1,0],[-1,3,0],[0,4,0],[1,3,0],[2,1,0],[1,0,0]];
    const savedAnnotations = annotations.map((a, index) => ({
      ...a, StudyInstanceUID: 'study-a', measurementKind: 'lvSimpsonSlot',
      lvSimpson: {
        measurementKind: 'lvSimpsonSlot', slot: slots.lvEjectionFraction[index],
        originalContourPoints: controls.map(p => [...p]),
        calibratedContourPoints: controls.map(p => [...p]), calibratedLongAxisLengthMM: 4,
      },
      splineControlPoints: controls.map(p => [...p]),
    }));
    const source = { source: 'viewer-derived', sourceMeasurementKey: candidate.sourceMeasurementKey };
    return { field, candidate, savedAnnotations, source };
  }

  it('immediately restores a verified saved EF and serializes an unchanged read without live hydration', () => {
    const { field, candidate, savedAnnotations, source } = savedEFFixture();
    mockCandidates.mockReturnValue([]);
    const savedValues = { [field.key]: 61.19 };
    const savedSources = { [field.key]: source };
    const persisted = resolvePersistedResearchEF(
      [field], savedValues, savedSources, savedAnnotations, savedAnnotations, 'study-a'
    );
    expect(persisted).toEqual({ ...candidate, labels: ['LVEF', 'LV EF', 'EF'] });
    const state = reconcileResearchEchoCompositeAnswers(
      [field], savedValues, savedSources, savedAnnotations,
      withPersistedResearchEF([], persisted), { verifiedEFOnly: true }
    );
    expect(state.values[field.key]).toBe(61.19);
    expect(state.sources[field.key]).toEqual(source);
    expect(buildReadResultEntries([field], state.values, state.sources))
      .toMatchObject([{ componentKey: 'lvEjectionFraction', value: 61.19, ...source }]);
    expect(mockCandidates).toHaveBeenCalledWith(savedAnnotations, { includeLVSimpson: false });
  });

  it('keeps immutable source geometry during partial normalized hydration', () => {
    const { field, savedAnnotations, source } = savedEFFixture();
    const partial = [{ annotationId: savedAnnotations[0].annotationId, points: [[0,0,0]] }];
    const merged = mergeResearchMeasurementAnnotations(savedAnnotations, partial);
    expect(merged).toEqual(savedAnnotations);
    expect(merged[0]).toBe(savedAnnotations[0]);
    expect(getPersistedResearchEFCandidate(
      field, 61.19, source, savedAnnotations, 'study-a', merged
    )?.value).toBe(61.19);
  });

  it('invalidates a genuinely edited same-ID contour and never resurrects deleted evidence', () => {
    const { field, savedAnnotations, source } = savedEFFixture();
    const changed = {
      ...savedAnnotations[0], splineControlPoints: savedAnnotations[0].splineControlPoints
        .map((p, i) => i === 0 ? [p[0] + 1, p[1], p[2]] : p),
    };
    const removed = savedAnnotations[2].annotationId;
    const deletedIds = new Set<string>(), invalidated = new Set<string>();
    applyResearchSnapshotEvidence({ researchEchoEvidence: {
      deletedAnnotationIds: [removed], invalidatedEFSourceIds: [changed.annotationId, removed],
    } }, deletedIds, invalidated);
    // Even a late live update carrying the deleted source cannot bring it back.
    const merged = mergeResearchMeasurementAnnotations(
      savedAnnotations, [changed, savedAnnotations[2]], deletedIds, invalidated
    );
    expect(merged).toContain(changed);
    expect(merged).not.toContain(savedAnnotations[2]);
    expect(getPersistedResearchEFCandidate(
      field, 61.19, source, savedAnnotations, 'study-a', merged, invalidated
    )).toBeNull();
    expect(getPersistedResearchEFCandidate(
      field, 61.19, source, savedAnnotations, 'study-a',
      [changed, ...savedAnnotations.slice(1)]
    )).toBeNull();
    mockCandidates.mockReturnValue([]);
    const state = reconcileResearchEchoCompositeAnswers([field], { [field.key]: 61.19 },
      { [field.key]: source }, merged, [], { verifiedEFOnly: true });
    expect(state.values).not.toHaveProperty(field.key);
    expect(state.sources).not.toHaveProperty(field.key);
  });

  it('prioritizes a verified new calculation over an intact older saved EF', () => {
    const { candidate } = savedEFFixture();
    const fresh = { ...candidate, value: 48.92 };
    expect(withPersistedResearchEF([fresh], candidate)).toEqual([fresh]);
  });

  it('requires the correct study, unique slot identity and exact phase frame; zero EF is valid', () => {
    const { field, savedAnnotations, source } = savedEFFixture();
    const resolve = (value: any, current = savedAnnotations, selectedSource = source, study = 'study-a') =>
      getPersistedResearchEFCandidate(field, value, selectedSource, savedAnnotations, study, current);
    expect(resolve(0)?.value).toBe(0);
    for (const value of ['', ' ', null, false, -1, 101, NaN]) expect(resolve(value)).toBeNull();
    expect(resolve(61.19, savedAnnotations, source, 'other-study')).toBeNull();
    expect(resolve(61.19, savedAnnotations.slice(1))).toBeNull();
    const wrongFrame = savedAnnotations.map((a, i) => i === 1 ? { ...a, frameNumber: 99 } : a);
    expect(resolve(61.19, wrongFrame)).toBeNull();
    const swapped = savedAnnotations.map((a, i) => i < 2
      ? { ...a, SOPInstanceUID: savedAnnotations[1-i].SOPInstanceUID } : a);
    expect(resolve(61.19, swapped)).toBeNull();
    const ids = savedAnnotations.map(a => a.annotationId);
    const duplicate = { ...source, sourceMeasurementKey: 'lv-simpson:' + [...ids.slice(0,3), ids[0]].join(',') };
    expect(resolve(61.19, savedAnnotations, duplicate)).toBeNull();
    const reversed = { ...source, sourceMeasurementKey: 'lv-simpson:' + [...ids].reverse().join(',') };
    expect(resolve(61.19, savedAnnotations, reversed)?.sourceMeasurementKey).toBe(reversed.sourceMeasurementKey);
  });

  it('uses live verified EF result when persisted contour metadata is compacted', () => {
    const { field, candidate, annotations } = fixture('lvEjectionFraction', 57.83);
    // Stored compact source annotations retain IDs/frames but no calibrated
    // points, so they cannot themselves recalculate EF.
    mockCandidates.mockReturnValue([]);
    const state = reconcileResearchEchoCompositeAnswers(
      [field], {}, {}, annotations, [candidate]
    );
    expect(state.values[field.key]).toBe(57.83);
    expect(state.sources[field.key]).toEqual({
      source: 'viewer-derived', sourceMeasurementKey: candidate.sourceMeasurementKey,
    });
    const incomplete = reconcileResearchEchoCompositeAnswers(
      [field], {}, {}, annotations.slice(0, 3), [candidate]
    );
    expect(incomplete.values).not.toHaveProperty(field.key);
  });

  it('replaces an old fixed-frame EF result only after verifying new evidence', () => {
    const { field, candidate, annotations } = fixture('lvEjectionFraction', 53.24);
    mockCandidates.mockReturnValue([candidate]);
    const state = reconcileResearchEchoCompositeAnswers([field],
      { [field.key]: 44 },
      { [field.key]: { source: 'viewer-derived', sourceMeasurementKey: 'lv-simpson:old' } },
      annotations);
    expect(state.values[field.key]).toBe(53.24);
    expect(state.sources[field.key].sourceMeasurementKey).toBe(candidate.sourceMeasurementKey);
  });

  it('rejects a contour from a different frame and clears its stale derived answer', () => {
    const { field, candidate, annotations } = fixture('lvEjectionFraction');
    mockCandidates.mockReturnValue([candidate]);
    const wrongFrame = annotations.map((a, i) =>
      i === 1 ? { ...a, frameNumber: 3 } : a);
    const state = reconcileResearchEchoCompositeAnswers([field],
      { [field.key]: 44 },
      { [field.key]: { source: 'viewer-derived', sourceMeasurementKey: candidate.sourceMeasurementKey } },
      wrongFrame);
    expect(state.values).not.toHaveProperty(field.key);
    expect(state.sources).not.toHaveProperty(field.key);
  });

  it('clears stale derived answers for unpinned research protocols after annotation deletion', () => {
    const { field, candidate, annotations } = fixture('rvFac');
    field.config.compositeFrameTargets = {};
    field.config.compositeFrameGuidanceEnabled = false;
    mockCandidates.mockReturnValue([]);
    const state = reconcileResearchEchoCompositeAnswers([field],
      { [field.key]: 28 },
      { [field.key]: { source: 'viewer-derived',
        sourceMeasurementKey: candidate.sourceMeasurementKey } },
      annotations);
    expect(state.values).not.toHaveProperty(field.key);
    expect(state.sources).not.toHaveProperty(field.key);
  });

  it('does not overwrite a manual value on an unpinned Research protocol', () => {
    const { field, candidate, annotations } = fixture('rvFac');
    field.config.compositeFrameTargets = {};
    field.config.compositeFrameGuidanceEnabled = false;
    mockCandidates.mockReturnValue([candidate]);
    const state = reconcileResearchEchoCompositeAnswers([field],
      { [field.key]: 24 },
      { [field.key]: { source: 'manual', sourceMeasurementKey: '' } },
      annotations);
    expect(state.values[field.key]).toBe(24);
    expect(state.sources[field.key].source).toBe('manual');
  });

  it('refuses two competing derived candidates and does not guess', () => {
    const { field, candidate, annotations } = fixture('lvEjectionFraction');
    mockCandidates.mockReturnValue([candidate, {
      ...candidate,
      sourceMeasurementKey: 'lv-simpson:' + annotations.slice().reverse().map(a => a.annotationId).join(','),
      value: 66,
    }]);
    const state = reconcileResearchEchoCompositeAnswers([field], {}, {}, annotations);
    expect(state.values).not.toHaveProperty(field.key);
  });
});
