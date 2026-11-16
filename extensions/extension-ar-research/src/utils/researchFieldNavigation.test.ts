import {
  getResearchFieldMeasurementCandidates,
  getResearchSourceAnnotationIds,
  getResearchFieldSourceAnnotations,
  getResearchProtocolViewerTargets,
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
