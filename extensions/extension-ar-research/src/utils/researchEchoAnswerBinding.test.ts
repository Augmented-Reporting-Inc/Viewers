import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import {
  reconcileResearchEchoCompositeAnswers,
  getVerifiedResearchEFResultCandidate,
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
    expect(state.values[field.key]).toBeCloseTo(62.4);
    expect(state.sources[field.key]).toEqual({
      source: 'viewer-derived', sourceMeasurementKey: candidate.sourceMeasurementKey,
    });
    expect(buildReadResultEntries([field], state.values, state.sources)).toMatchObject([{
      componentKey: kind, value: 62.4, source: 'viewer-derived',
    }]);
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
    expect(state.values[field.key]).toBeCloseTo(61.2);
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
    expect(reopened.values[field.key]).toBe(61.2);
    expect(reopened.sources[field.key]).toEqual({
      source: 'viewer-derived', sourceMeasurementKey: candidate.sourceMeasurementKey,
    });
  });

  it('uses live verified EF result when persisted contour metadata is compacted', () => {
    const { field, candidate, annotations } = fixture('lvEjectionFraction', 57.83);
    // Stored compact source annotations retain IDs/frames but no calibrated
    // points, so they cannot themselves recalculate EF.
    mockCandidates.mockReturnValue([]);
    const state = reconcileResearchEchoCompositeAnswers(
      [field], {}, {}, annotations, [candidate]
    );
    expect(state.values[field.key]).toBe(57.8);
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
    expect(state.values[field.key]).toBe(53.2);
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
