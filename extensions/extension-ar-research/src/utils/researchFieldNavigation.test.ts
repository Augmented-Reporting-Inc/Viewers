import {
  getResearchFieldMeasurementCandidates,
  getResearchSourceAnnotationIds,
  getResearchFieldSourceAnnotations,
  getResearchProtocolViewerTargets,
  isResearchCandidateOnProtocolFrames,
  getResearchProtocolCompatibleCandidates,
  getResearchIVCMeasurementState,
  getResearchIVCAnnotationSlot,
  isValidResearchIVCPhaseSource,
  getResearchCompatibleMeasurementCandidates,
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
    config: { compositeFrameTargets: {
      IVC_EXP: target(2), IVC_INSP: target(22),
    } },
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
