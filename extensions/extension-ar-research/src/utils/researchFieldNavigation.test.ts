import {
  getResearchFieldMeasurementCandidates,
  getResearchSourceAnnotationIds,
  getResearchFieldSourceAnnotations,
  getResearchProtocolViewerTargets,
  isResearchCandidateOnProtocolFrames,
  getResearchProtocolCompatibleCandidates,
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
