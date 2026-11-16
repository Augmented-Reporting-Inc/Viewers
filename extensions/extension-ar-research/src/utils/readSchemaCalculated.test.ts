import {
  buildReadFields,
  buildCalculatedReadState,
  buildReadResultEntries,
} from './readSchema';

function fields(trUnit = 'm/s') {
  return buildReadFields({
    schemaKey: 'echo-core-lab',
    domain: 'echo',
    components: [
      { componentKey: 'trVmax', kind: 'measurement',
        config: { unit: trUnit, measurementLabels: ['TRVel', 'TR Vmax'] } },
      { componentKey: 'rap', kind: 'number', config: { unit: 'mmHg' } },
      { componentKey: 'rvsp', kind: 'number',
        config: {
          unit: 'mmHg', step: 0.1,
          calculation: {
            type: 'rvsp', trVmaxComponentKey: 'trVmax', rapComponentKey: 'rap',
          },
        },
      },
      { componentKey: 'quality', kind: 'text' },
    ],
  });
}

const trSource = {
  source: 'viewer-measurement',
  sourceMeasurementKey: 'TR-annot-7',
};
const inputSources = { 'trVmax|': trSource, 'rap|': { source: 'manual' } };

describe('optional source-linked Research Read RVSP calculation', () => {
  it('uses measured TR Vmax and explicitly entered RAP, never a guessed RAP', () => {
    const read = buildCalculatedReadState(
      fields(),
      { 'trVmax|': 3, 'rap|': 3, 'quality|': 'adequate' },
      inputSources
    );
    expect(read.values['rvsp|']).toBe(39);
    expect(read.sources['rvsp|']).toEqual({
      source: 'viewer-derived',
      sourceMeasurementKey: 'rvsp:TR-annot-7+rap:rap|',
    });
    expect(read.values['quality|']).toBe('adequate');
    const entries = buildReadResultEntries(fields(), read.values, read.sources);
    expect(entries.find(entry => entry.componentKey === 'rvsp')).toMatchObject({
      value: 39, unit: 'mmHg', source: 'viewer-derived',
    });
  });

  it('clears stale RVSP if RAP is missing or if the viewer source disappears', () => {
    const stale = { 'trVmax|': 3, 'rvsp|': 44 };
    const withoutRap = buildCalculatedReadState(fields(), stale, inputSources);
    expect(withoutRap.values).not.toHaveProperty('rvsp|');
    const manualVelocity = buildCalculatedReadState(
      fields(),
      { ...stale, 'rap|': 8 },
      { 'trVmax|': { source: 'manual' }, 'rap|': { source: 'manual' } }
    );
    expect(manualVelocity.values).not.toHaveProperty('rvsp|');
    expect(manualVelocity.sources).not.toHaveProperty('rvsp|');
  });

  it('requires units and valid physiology-independent numeric inputs', () => {
    const badUnits = buildCalculatedReadState(fields('cm/s'),
      { 'trVmax|': 3, 'rap|': 3 }, inputSources);
    expect(badUnits.values).not.toHaveProperty('rvsp|');
    const negativeRap = buildCalculatedReadState(fields(),
      { 'trVmax|': 3, 'rap|': -1 }, inputSources);
    expect(negativeRap.values).not.toHaveProperty('rvsp|');
    const zeroTR = buildCalculatedReadState(fields(),
      { 'trVmax|': 0, 'rap|': 3 }, inputSources);
    expect(zeroTR.values).not.toHaveProperty('rvsp|');
  });

  it('has no effect on protocols without a calculated field', () => {
    const regular = buildReadFields({
      components: [{ componentKey: 'comment', kind: 'text' }],
    });
    const original = { 'comment|': 'reviewed' };
    expect(buildCalculatedReadState(regular, original).values).toEqual(original);
  });
});
