import { calculateRVFACFromMeasurements } from '../../../extension-ar-measurements/src/utils/echoAreaMeasurements';
import {
  getResearchFieldMeasurementCandidates,
  getResearchSourceAnnotationIds,
  getResearchFieldSourceAnnotations,
  getResearchProtocolViewerTargets,
  getResearchQuestionEntryTarget,
  isResearchCandidateOnProtocolFrames,
  getResearchProtocolCompatibleCandidates,
  getResearchIVCMeasurementState,
  getResearchIVCAnnotationSlot,
  isValidResearchIVCPhaseSource,
  getResearchCompatibleMeasurementCandidates,
  isResearchLengthQuestion,
  getResearchLengthSourceState,
  getResearchLAPhaseSources,
  getResearchRVFACPhaseSources,
} from './researchFieldNavigation';

describe('Research quiz-style field sources and navigation', () => {
  const field = { config: { measurementLabels: ['TRVel', 'TR Vmax'] } };
  const tr = {
    annotationId: 'tr-1', label: 'TR peak velocity',
    SOPInstanceUID: 'source-tr', frameNumber: 13,
  };
  it('keeps research field matching label-specific', () => {
    const matches = getResearchFieldMeasurementCandidates(field, [
      { labels: ['TRVel'], sourceMeasurementKey: 'tr-1', value: 2.56 },
      { labels: ['AVVmax'], sourceMeasurementKey: 'av-2', value: 4.5 },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe(2.56);
  });
  it('resolves exact, composite and derived source identifiers without guesswork', () => {
    expect(getResearchSourceAnnotationIds('tr-1')).toEqual(['tr-1']);
    expect(getResearchSourceAnnotationIds('la-disks:la-a4c,la-a2c'))
      .toEqual(['la-a4c', 'la-a2c']);
    expect(getResearchSourceAnnotationIds('rvsp:tr-1+rap:rap|')).toEqual(['tr-1']);
    expect(getResearchFieldSourceAnnotations(
      { sourceMeasurementKey: 'tr-1' }, [tr, {annotationId:'av-2'}]
    )).toEqual([tr]);
  });
  it('shows configured per-phase protocol targets only with identifiable DICOM frames', () => {
    const targets = getResearchProtocolViewerTargets({ config: {
      viewerTarget: { sopInstanceUID: 'tr-sop', frameNumber: 9 },
      compositeFrameTargets: {
        A4C: { sopInstanceUID: 'a4c-sop', frameNumber: 3 },
        A2C: { sopInstanceUID: 'a2c-sop' },
      },
    } });
    expect(targets.map(x => x.label)).toEqual(['Protocol target', 'A4C']);
  });
  it('does not invent a target for a protocol without configured DICOM sources', () => {
    expect(getResearchProtocolViewerTargets(field)).toEqual([]);
  });
});

describe('Research protocol frame enforcement', () => {
  const trField = { componentKey: 'trVmax',
    config: { viewerTarget: { sopInstanceUID: 'tr-sop', frameNumber: 7 } },
  };
  const candidate = { sourceMeasurementKey: 'tr-id', labels: ['TRVel'], value: 2.56 };
  const annotation = {
    annotationId: 'tr-id', SOPInstanceUID: 'tr-sop', frameNumber: 7,
  };
  it('accepts the exact same SOP and frame, rejects other frames', () => {
    expect(isResearchCandidateOnProtocolFrames(trField, candidate, [annotation])).toBe(true);
    expect(isResearchCandidateOnProtocolFrames(trField, candidate, [
      { ...annotation, frameNumber: 8 },
    ])).toBe(false);
    expect(isResearchCandidateOnProtocolFrames(trField, candidate, [
      { ...annotation, SOPInstanceUID: 'other-sop' },
    ])).toBe(false);
  });
  it('rejects unsupported evidence without a source frame, never guessing', () => {
    expect(getResearchProtocolCompatibleCandidates(trField, [candidate], [
      { annotationId: 'tr-id', SOPInstanceUID: 'tr-sop' },
    ])).toEqual([]);
  });
  it('requires every configured composite phase to map to distinct source annotations', () => {
    const field = { componentKey: 'rvFac', config: {
      compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: {
        RV_ED: { sopInstanceUID: 'rv-sop', frameNumber: 2 },
        RV_ES: { sopInstanceUID: 'rv-sop', frameNumber: 6 },
      },
    } };
    const composite = { sourceMeasurementKey: 'rv-fac:ed,es' };
    const sources = [
      { annotationId: 'ed', SOPInstanceUID: 'rv-sop', frameNumber: 2 },
      { annotationId: 'es', SOPInstanceUID: 'rv-sop', frameNumber: 6 },
    ];
    expect(isResearchCandidateOnProtocolFrames(field, composite, sources)).toBe(true);
    expect(isResearchCandidateOnProtocolFrames(field, composite, [
      sources[0], { ...sources[1], frameNumber: 5 },
    ])).toBe(false);
    expect(isResearchCandidateOnProtocolFrames({
      ...field, config: { ...field.config,
        compositeFrameTargets: { RV_ED: field.config.compositeFrameTargets.RV_ED },
      },
    }, composite, sources)).toBe(false);
  });
  it('rejects composite candidates with missing, surplus or duplicate sources', () => {
    const field = { componentKey: 'lvEjectionFraction', config: {
      compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: {
        A4C_ED: { sopInstanceUID: 'sop1', frameNumber: 2 },
        A4C_ES: { sopInstanceUID: 'sop2', frameNumber: 3 },
        A2C_ED: { sopInstanceUID: 'sop3', frameNumber: 4 },
        A2C_ES: { sopInstanceUID: 'sop4', frameNumber: 5 },
      },
    } };
    const annotations = [1,2,3,4,5].map((n) => ({
      annotationId: 'source' + n, SOPInstanceUID: 'sop' + n,
      frameNumber: n + 1,
    }));
    const candidate = (ids: string) => ({ sourceMeasurementKey: 'lv-simpson:' + ids });
    expect(isResearchCandidateOnProtocolFrames(field,
      candidate('source1,source2,source3,source4'), annotations)).toBe(true);
    expect(isResearchCandidateOnProtocolFrames(field,
      candidate('source1,source2,source3'), annotations)).toBe(false);
    expect(isResearchCandidateOnProtocolFrames(field,
      candidate('source1,source2,source3,source4,source5'), annotations)).toBe(false);
    expect(isResearchCandidateOnProtocolFrames(field,
      candidate('source1,source2,source3,source3'), annotations)).toBe(false);
  });
  it('preserves legacy partial phase pinning when the other phases remain reader-selectable', () => {
    const field = { componentKey: 'lvEjectionFraction', config: {
      compositeFrameGuidanceEnabled: false,
      compositeFrameTargets: {
        A4C_ED: { sopInstanceUID: 'sop1', frameNumber: 2 },
      },
    } };
    const all = [1, 2, 3, 4].map(n => ({
      annotationId: 'phase' + n,
      SOPInstanceUID: 'sop' + n,
      frameNumber: n + 1,
    }));
    expect(isResearchCandidateOnProtocolFrames(field,
      { sourceMeasurementKey: 'lv-simpson:phase1,phase2,phase3,phase4' },
      all)).toBe(true);
  });

  it('leaves protocols with no configured target untouched', () => {
    expect(isResearchCandidateOnProtocolFrames({
      componentKey: 'trVmax', config: {},
    }, candidate, [])).toBe(true);
  });
});

describe('Research IVC phase measurements and visible calculated values', () => {
  const study = '1.2.study';
  const series = '1.2.series';
  const sop = '1.2.sop';
  const image = (frame: number, instance = sop) =>
    `wadors:/orthanc/dicom-web/studies/${study}/series/${series}/instances/${instance}/frames/${frame}`;
  const field = { componentKey: 'ivcCollapsibility', config: {
    unit: '%', measurementLabels: ['IVCCollapsibility'],
    compositeFrameGuidanceEnabled: true,
    compositeFrameTargets: {
      IVC_EXP: { studyInstanceUID: study, seriesInstanceUID: series,
        sopInstanceUID: sop, frameNumber: 2 },
      IVC_INSP: { studyInstanceUID: study, seriesInstanceUID: series,
        sopInstanceUID: sop, frameNumber: 22 },
    },
  } };
  const length = (label: string, mm: number, frame: number, instance = sop) => ({
    annotationId: label + '-' + frame,
    label, toolName: 'Length',
    points: [[0, 0, 0], [1, 0, 0]],
    measurements: { length: mm, unit: 'mm', lengthUnit: 'mm' },
    referenceStudyUID: study,
    referenceSeriesUID: series,
    SOPInstanceUID: instance,
    // Legacy adapter may retain frameNumber 1 even after cine navigation.
    frameNumber: 1,
    referencedImageId: image(frame, instance),
  });

  it('shows exact calibrated IVCexp/IVCinsp and 60% collapse on frames 2/22', () => {
    const annotations = [length('IVCexp', 20, 2), length('IVCinsp', 8, 22)];
    const state = getResearchIVCMeasurementState(field, annotations);
    expect(state.status).toBe('complete');
    expect(state.values).toMatchObject({
      expirationDiameterMM: 20,
      inspirationDiameterMM: 8,
      collapsibilityPercent: 60,
    });
    expect(state.candidate).toMatchObject({
      value: 60, unit: '%', source: 'viewer-derived',
    });
    expect(state.candidate.sourceMeasurementKey).toContain('IVCexp-2,IVCinsp-22');
    expect(getResearchCompatibleMeasurementCandidates(field, [], annotations))
      .toEqual([state.candidate]);
  });

  it('uses image identity instead of stale frameNumber and excludes extra wrong frames', () => {
    const annotations = [
      length('IVCexp', 20, 2), length('IVCinsp', 8, 22),
      length('IVCexp', 30, 11),
    ];
    const state = getResearchIVCMeasurementState(field, annotations);
    expect(state.candidate?.value).toBe(60);
    expect(state.unmatchedSources).toBe(1);
    expect(state.excludedAnnotations).toHaveLength(1);
    expect(state.excludedAnnotations[0]).toMatchObject({
      annotationId: 'IVCexp-11', label: 'IVCexp',
    });
    expect(state.annotations).toHaveLength(2);
  });

  it('rejects same-frame, wrong-SOP, and mismatched stored SOP evidence', () => {
    const wrongFrame = getResearchIVCMeasurementState(field, [
      length('IVCexp', 20, 2), length('IVCinsp', 8, 21),
    ]);
    expect(wrongFrame.candidate).toBeNull();
    expect(wrongFrame.values?.expirationDiameterMM).toBe(20);
    expect(wrongFrame.values?.inspirationDiameterMM).toBeNull();

    const wrongSop = getResearchIVCMeasurementState(field, [
      length('IVCexp', 20, 2), length('IVCinsp', 8, 22, 'different-sop'),
    ]);
    expect(wrongSop.candidate).toBeNull();

    const contradictory = length('IVCexp', 20, 2);
    contradictory.referencedImageId = image(2, 'different-sop');
    expect(getResearchIVCMeasurementState(field, [
      contradictory, length('IVCinsp', 8, 22),
    ]).candidate).toBeNull();
  });

  it('does not invent a collapsibility value from missing or uncalibrated Length', () => {
    const uncalibrated = length('IVCinsp', 8, 22);
    uncalibrated.measurements = { length: 8, unit: 'px', lengthUnit: 'px' };
    const state = getResearchIVCMeasurementState(field, [
      length('IVCexp', 20, 2), uncalibrated,
    ]);
    expect(state.candidate).toBeNull();
    expect(state.values?.expirationDiameterMM).toBe(20);
    expect(state.values?.inspirationDiameterMM).toBeNull();
  });

  it('does not change other measurement types or unconstrained IVC workflows', () => {
    const annotations = [length('IVCexp', 20, 2), length('IVCinsp', 8, 22)];
    const flexible = { ...field, config: {
      unit: '%', measurementLabels: ['IVCCollapsibility'],
    } };
    expect(getResearchIVCMeasurementState(flexible, annotations).candidate?.value)
      .toBe(60);
    expect(getResearchCompatibleMeasurementCandidates(
      { componentKey: 'trVmax', config: { measurementLabels: ['TRVel'] } },
      [{ labels: ['TRVel'], sourceMeasurementKey: 'TR-1', value: 2.56 }],
      []
    )).toHaveLength(1);
  });
});

describe('Research IVC redraw source safety', () => {
  const study = 'study-case';
  const series = 'series-case';
  const sop = 'sop-ivc';
  const target = (frameNumber: number) => ({
    studyInstanceUID: study, seriesInstanceUID: series,
    sopInstanceUID: sop, frameNumber,
  });
  const field = {
    componentKey: 'ivcCollapsibility',
    config: {
      measurementLabels: ['IVCCollapsibility'], unit: '%',
      compositeFrameTargets: {
        IVC_EXP: target(2), IVC_INSP: target(22),
      },
    },
  };
  const length = (label: string, frame: number, value = 16, unit = 'mm') => ({
    annotationId: label + frame,
    label, toolName: 'Length',
    points: [[0, 0, 0], [1, 0, 0]],
    measurements: { length: value, unit, lengthUnit: unit },
    referenceStudyUID: study, referenceSeriesUID: series,
    SOPInstanceUID: sop, frameNumber: 1,
    referencedImageId:
      `wadors:/studies/${study}/series/${series}/instances/${sop}/frames/${frame}`,
  });
  it('recognizes only explicitly labelled and calibrated replacement Length', () => {
    const good = length('IVCexp', 2, 20);
    expect(getResearchIVCAnnotationSlot(good)).toBe('IVC_EXP');
    expect(isValidResearchIVCPhaseSource(field, 'IVC_EXP', good)).toBe(true);
    expect(isValidResearchIVCPhaseSource(field, 'IVC_INSP', good)).toBe(false);
    expect(isValidResearchIVCPhaseSource(field, 'IVC_EXP', length('IVCexp', 3)))
      .toBe(false);
    expect(isValidResearchIVCPhaseSource(field, 'IVC_EXP', length('IVCexp', 2, 10, 'px')))
      .toBe(false);
    expect(isValidResearchIVCPhaseSource(field, 'IVC_EXP',
      { ...length('IVCexp', 2), label: 'Length' })).toBe(false);
  });
  it('exposes one phase-owned source; duplicate same-phase sources remain explicit', () => {
    const sources = [
      length('IVCexp', 2, 20), length('IVCinsp', 22, 8),
      { ...length('IVCexp', 2, 21), annotationId: 'exp-redrawn' },
    ];
    const state = getResearchIVCMeasurementState(field, sources);
    expect(state.phaseSources.IVC_EXP).toHaveLength(2);
    expect(state.phaseSources.IVC_INSP).toHaveLength(1);
    expect(state.candidate).toBeNull();
    const validAfterReplacement = getResearchIVCMeasurementState(field, [
      sources[2], sources[1],
    ]);
    expect(validAfterReplacement.phaseSources.IVC_EXP).toHaveLength(1);
    expect(validAfterReplacement.candidate).not.toBeNull();
    expect(validAfterReplacement.values.collapsibilityPercent)
      .toBeCloseTo((21 - 8) / 21 * 100, 5);
  });
  it('does not replace with a new source from the wrong phase or cine frame', () => {
    expect(isValidResearchIVCPhaseSource(field, 'IVC_INSP',
      length('IVCinsp', 21, 8))).toBe(false);
    expect(isValidResearchIVCPhaseSource(field, 'IVC_INSP',
      length('IVCinsp', 22, 8))).toBe(true);
    expect(isValidResearchIVCPhaseSource(field, 'IVC_INSP',
      { ...length('IVCinsp', 22, 8), SOPInstanceUID: 'different' })).toBe(false);
  });
});

describe('Research question-entry source frame navigation', () => {
  const source = (frameNumber: number) => ({
    studyInstanceUID: 'study', seriesInstanceUID: 'series',
    sopInstanceUID: 'sop', frameNumber,
  });

  it('opens fixed IVC expiration first, never guessed inspiration or ordering', () => {
    const field = {
      componentKey: 'ivcCollapsibility', config: {
        compositeFrameTargets: { IVC_INSP: source(22), IVC_EXP: source(2) },
      },
    };
    expect(getResearchQuestionEntryTarget(field)).toEqual(source(2));
    expect(getResearchQuestionEntryTarget({
      ...field,
      config: { compositeFrameTargets: { IVC_INSP: source(22) } },
    })).toBeNull();
    expect(getResearchQuestionEntryTarget({
      ...field,
      config: { compositeFrameTargets: { IVC_EXP: { sopInstanceUID: 'sop' } } },
    })).toBeNull();
  });

  it('preserves other composite question phase choice and single TR navigation', () => {
    expect(getResearchQuestionEntryTarget({
      componentKey: 'rvFac', config: {
        compositeFrameTargets: { RV_ED: source(2), RV_ES: source(22) },
      },
    })).toBeNull();
    expect(getResearchQuestionEntryTarget({
      componentKey: 'trVmax', config: { viewerTarget: source(9) },
    })).toEqual(source(9));
    expect(getResearchQuestionEntryTarget({ componentKey: 'ivcCollapsibility', config: {} }))
      .toBeNull();
  });
});

describe('Research independent Length source restoration', () => {
  const study = 'study-length';
  const sop = 'sop-length';
  const field = { key: 'lvidd|', componentKey: 'lvidd', kind: 'measurement', config: {
    unit: 'mm', measurementLabels: ['LVIDd'], step: 0.01,
    viewerTarget: { studyInstanceUID: study, sopInstanceUID: sop, frameNumber: 2 },
  }};
  const length = (id: string, frame = 2, studyId = study) => ({
    annotationId: id, toolName: 'Length', label: 'LVIDd',
    StudyInstanceUID: studyId, SeriesInstanceUID: 'series', SOPInstanceUID: sop,
    frameNumber: 1, referencedImageId:
      `wadors:/studies/${studyId}/series/series/instances/${sop}/frames/${frame}`,
    points: [[0,0,0],[54.5,0,0]], measurements: { length: 54.5, unit: 'mm' },
  });
  const candidate = (id: string, unit = 'mm') => ({
    source: 'viewer-measurement', sourceMeasurementKey: id, labels: ['LVIDd'], value: 54.5, unit,
  });
  const state = (source: any, annotations: any[], candidates: any[]) =>
    getResearchLengthSourceState(field, source, annotations, candidates, study);
  it('only uses compact layout for independent configured Echo Length', () => {
    expect(isResearchLengthQuestion(field, 'echo')).toBe(true);
    expect(isResearchLengthQuestion(field, 'bowel')).toBe(false);
    expect(isResearchLengthQuestion({ ...field, componentKey: 'ivcCollapsibility' }, 'echo')).toBe(false);
    expect(isResearchLengthQuestion({ ...field, config: { ...field.config, unit: 'cm' } }, 'echo')).toBe(false);
  });
  it('restores the linked caliper instead of guessing among candidates', () => {
    const saved = length('a');
    const result = state({ source: 'viewer-measurement', sourceMeasurementKey: 'a' },
      [saved, length('b')], [candidate('a'), candidate('b')]);
    expect(result.status).toBe('linked');
    expect(result.selected?.annotation).toBe(saved);
    expect(result.selected?.displayAnnotation.frameNumber).toBe(2);
    expect(saved.frameNumber).toBe(1);
    expect(result.eligible).toHaveLength(2);
  });
  it('rejects wrong study/frame/tool, invalid geometry, pixel units or missing linked source', () => {
    const source = { source: 'viewer-measurement', sourceMeasurementKey: 'a' };
    for (const annotation of [length('a', 20), length('a', 2, 'other-study'),
      { ...length('a'), toolName: 'PlanarFreehandROI' },
      { ...length('a'), referencedImageId: length('a', 2, 'other-study').referencedImageId },
      { ...length('a'), points: [[0,0,0]] }]) {
      expect(state(source, [annotation, length('b')], [candidate('a'), candidate('b')]).status).toBe('invalid');
    }
    expect(state(source, [length('a')], [candidate('a', 'px')]).status).toBe('invalid');
    expect(state(source, [length('b')], [candidate('b')]).selected).toBeNull();
  });
  it('preserves manual answers and exposes ambiguity without selecting a caliper', () => {
    const both = [length('a'), length('b')];
    const candidates = [candidate('a'), candidate('b')];
    expect(state({}, both, candidates).status).toBe('ambiguous');
    expect(state({}, both, candidates).selected).toBeNull();
    expect(state({ source: 'manual' }, both, candidates).status).toBe('manual');
    expect(state({}, [both[0]], [candidates[0]]).status).toBe('unbound');
    expect(state({}, [], []).status).toBe('none');
  });
});

describe('Research LA phase display uses calibrated Education areas and Review sources', () => {
  const study = 'study-la';
  const points = [[-10,0,0],[-10,20,0],[-10,40,0],[0,40,0],
    [10,40,0],[10,20,0],[10,0,0]];
  const source = (slot: string, frame = 2, studyId = study) => ({
    annotationId: 'la-' + slot + '-' + frame,
    toolName: 'SplineROI', measurementKind: 'laVolumeSlot',
    StudyInstanceUID: studyId, SeriesInstanceUID: 'series-' + slot,
    SOPInstanceUID: 'sop-' + slot, frameNumber: 1,
    referencedImageId: `wadors:/studies/${studyId}/series/series-${slot}/instances/sop-${slot}/frames/${frame}`,
    points,
    laVolume: { measurementKind: 'laVolumeSlot', slot, baseLeftPoint: points[0],
      baseRightPoint: points[6], superiorPoint: points[3], longAxisLengthMM: 40 },
    measurements: { area: 999, areaUnit: 'mm²' }, // must not use cached display area
  });
  const field = { componentKey: 'laVolumeDisks', config: { unit: 'mL' } };
  const pinned = { ...field, config: { ...field.config, compositeFrameGuidanceEnabled: true,
    compositeFrameTargets: {
      A4C: { sopInstanceUID: 'sop-A4C', frameNumber: 2 },
      A2C: { sopInstanceUID: 'sop-A2C', frameNumber: 2 },
    },
  }};
  it('returns separate calibrated areas from partial and complete saved/live evidence', () => {
    const a4c = source('A4C');
    const a2c = source('A2C');
    const partial = getResearchLAPhaseSources(field, [a4c], study);
    expect(partial.phaseSources.A4C[0].areaCM2).toBeCloseTo(8);
    expect(partial.phaseSources.A2C).toEqual([]);
    expect(partial.phaseSources.A4C[0].displayAnnotation.frameNumber).toBe(2);
    expect(a4c.frameNumber).toBe(1);
    const complete = getResearchLAPhaseSources(pinned, [a4c, a2c], study);
    expect(complete.phaseSources.A2C[0].areaCM2).toBeCloseTo(8);
    expect(complete.phaseSources.A2C[0].matchesTarget).toBe(true);
    expect(complete.unresolvedCount).toBe(0);
  });
  it('retains duplicate and off-frame owned sources for explicit inspection, rejects foreign study', () => {
    const result = getResearchLAPhaseSources(pinned,
      [source('A4C'), source('A4C', 20), source('A2C', 2, 'foreign')], study);
    expect(result.phaseSources.A4C.map(item => item.matchesTarget)).toEqual([true, false]);
    expect(result.phaseSources.A2C).toEqual([]);
    expect(result.unresolvedCount).toBe(1);
  });
  it('never substitutes cached ROI area for missing physical LA geometry', () => {
    const original = source('A4C');
    const invalid = { ...original, laVolume: { ...original.laVolume, longAxisLengthMM: 0 } };
    const result = getResearchLAPhaseSources(field, [invalid], study);
    expect(result.phaseSources.A4C[0].areaCM2).toBeNull();
    expect(result.phaseSources.A4C[0].annotation).toBe(invalid);
    expect(getResearchLAPhaseSources({componentKey:'rvFac'}, [original], study)
      .phaseSources.A4C).toEqual([]);
  });
});

describe('Research RV FAC phase display uses the existing calibrated RV area engine', () => {
  const study = 'study-rv';
  const source = (slot: string, frame: number, area: number, unit = 'cm²', studyId = study) => ({
    annotationId: 'rv-' + slot + '-' + frame,
    toolName: 'SplineROI', measurementKind: 'echoAreaSlot',
    label: slot === 'RV_ED' ? 'RVEDA' : 'RVESA',
    StudyInstanceUID: studyId, SeriesInstanceUID: 'series-rv',
    SOPInstanceUID: 'sop-rv', frameNumber: 1,
    referencedImageId: `wadors:/studies/${studyId}/series/series-rv/instances/sop-rv/frames/${frame}`,
    points: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
    echoArea: { slot }, measurements: { area, areaUnit: unit },
  });
  const field = { componentKey:'rvFac', config:{ unit:'%' } };
  const pinned = { ...field, config: { ...field.config, compositeFrameGuidanceEnabled: true,
    compositeFrameTargets: {
      RV_ED: { sopInstanceUID:'sop-rv', frameNumber:2 },
      RV_ES: { sopInstanceUID:'sop-rv', frameNumber:8 },
    },
  }};
  it('shows partial and complete areas, normalizes only the display frame, and preserves the existing FAC calculation', () => {
    const ed = source('RV_ED', 2, 2000, 'mm²');
    const es = source('RV_ES', 8, 12);
    const partial = getResearchRVFACPhaseSources(field, [ed], study);
    expect(partial.phaseSources.RV_ED[0].areaCM2).toBe(20);
    expect(partial.phaseSources.RV_ES).toEqual([]);
    const both = getResearchRVFACPhaseSources(pinned, [ed, es], study);
    expect(both.phaseSources.RV_ES[0].areaCM2).toBe(12);
    expect(both.phaseSources.RV_ED[0].matchesTarget).toBe(true);
    expect(both.phaseSources.RV_ES[0].matchesTarget).toBe(true);
    expect(both.phaseSources.RV_ES[0].displayAnnotation.frameNumber).toBe(8);
    expect(es.frameNumber).toBe(1);
    expect(calculateRVFACFromMeasurements([ed,es]).values?.facPercent).toBeCloseTo(40);
  });
  it('keeps duplicate/off-frame sources inspectable and rejects foreign or generic ROIs', () => {
    const generic = { ...source('RV_ES',8,12), measurementKind:'', echoArea:undefined };
    const ra = source('RA_ES',8,12);
    const both = getResearchRVFACPhaseSources(pinned,
      [source('RV_ED',2,20), source('RV_ED',20,20),
       source('RV_ES',8,12,'cm²','foreign'), generic, ra], study);
    expect(both.phaseSources.RV_ED.map(row => row.matchesTarget)).toEqual([true,false]);
    expect(both.phaseSources.RV_ES).toEqual([]);
    expect(both.unresolvedCount).toBe(1);
  });
  it('does not promote pixels, missing contours or unconfigured required frames', () => {
    const invalid = source('RV_ED',2,2000,'px²');
    expect(getResearchRVFACPhaseSources(field,[invalid],study).phaseSources.RV_ED[0].areaCM2).toBeNull();
    const incomplete = { ...invalid, measurements:{ area:20, areaUnit:'cm²' }, points:[] };
    expect(getResearchRVFACPhaseSources(field,[incomplete],study).phaseSources.RV_ED[0].areaCM2).toBeNull();
    const missing = { ...field, config:{...field.config, compositeFrameGuidanceEnabled:true} };
    expect(getResearchRVFACPhaseSources(missing,[source('RV_ED',2,20)],study)
      .phaseSources.RV_ED[0].matchesTarget).toBe(false);
    expect(getResearchRVFACPhaseSources({componentKey:'laVolumeDisks'},[source('RV_ED',2,20)],study)
      .phaseSources.RV_ED).toEqual([]);
    expect(calculateRVFACFromMeasurements([source('RV_ED',2,20),source('RV_ES',2,12)]).status).toBe('invalid');
    expect(calculateRVFACFromMeasurements([source('RV_ED',2,20),source('RV_ED',3,20),source('RV_ES',8,12)]).status).toBe('invalid');
  });
});
