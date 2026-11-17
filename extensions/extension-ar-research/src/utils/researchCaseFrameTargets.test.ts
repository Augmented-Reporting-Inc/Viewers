import {
  resolveResearchCaseFrameConfig,
  resolveResearchCaseReadSchema,
} from './researchCaseFrameTargets';

describe('case-scoped Research measurement frame guidance', () => {
  const caseA = '1.2.840.113619.10';
  const caseB = '1.2.840.113619.20';
  const schema = {
    domain: 'echo',
    components: [{
      componentKey: 'laVolumeDisks',
      kind: 'measurement',
      config: {
        unit: 'mL',
        compositeFrameGuidanceEnabled: true,
        caseFrameTargets: {
          [caseA]: { compositeFrameTargets: {
            A4C: { studyInstanceUID: caseA, sopInstanceUID: 'a4c-a', frameNumber: 5 },
            A2C: { studyInstanceUID: caseA, sopInstanceUID: 'a2c-a', frameNumber: 8 },
          } },
          [caseB]: { compositeFrameTargets: {
            A4C: { studyInstanceUID: caseB, sopInstanceUID: 'a4c-b', frameNumber: 11 },
            A2C: { studyInstanceUID: caseB, sopInstanceUID: 'a2c-b', frameNumber: 13 },
          } },
        },
      },
    }],
  };

  it('chooses only case A source frames for case A', () => {
    const result = resolveResearchCaseReadSchema(schema, caseA);
    expect(result.components[0].config.compositeFrameTargets.A4C.sopInstanceUID)
      .toBe('a4c-a');
    expect(result.components[0].config.compositeFrameTargets.A2C.frameNumber)
      .toBe(8);
    expect(result.components[0].config.unit).toBe('mL');
  });
  it('chooses only case B frames for case B without affecting case A', () => {
    const result = resolveResearchCaseReadSchema(schema, caseB);
    expect(result.components[0].config.compositeFrameTargets.A4C.sopInstanceUID)
      .toBe('a4c-b');
    expect(schema.components[0].config.caseFrameTargets[caseA].compositeFrameTargets.A4C.frameNumber)
      .toBe(5);
  });
  it('does not reuse another case source when this case is unconfigured', () => {
    const result = resolveResearchCaseReadSchema(schema, '1.2.840.113619.30');
    expect(result.components[0].config.compositeFrameTargets).toBeUndefined();
    expect(result.components[0].config.compositeFrameGuidanceEnabled).toBe(true);
  });
  it('retains a matching legacy single-case target but rejects another study target', () => {
    const matching = resolveResearchCaseFrameConfig({
      viewerTarget: { studyInstanceUID: caseA, sopInstanceUID: 'tr-a', frameNumber: 12 },
    }, caseA);
    expect(matching.viewerTarget.sopInstanceUID).toBe('tr-a');
    const different = resolveResearchCaseFrameConfig({
      viewerTarget: { studyInstanceUID: caseA, sopInstanceUID: 'tr-a', frameNumber: 12 },
    }, caseB);
    expect(different.viewerTarget).toBeUndefined();
    expect(resolveResearchCaseFrameConfig({
      viewerTarget: { sopInstanceUID: 'tr-old', frameNumber: 1 },
    }, '').viewerTarget).toBeUndefined();
  });
});
