import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import {
  buildViewerMeasurementReadUpdates,
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

  it('stops deriving RVSP when the referenced TR annotation is no longer live', () => {
    const data = { 'trVmax|': 3, 'rap|': 3 };
    const present = buildCalculatedReadState(fields(), data, inputSources, [
      { source: 'viewer-measurement', sourceMeasurementKey: 'TR-annot-7' },
    ]);
    expect(present.values['rvsp|']).toBe(39);
    const deleted = buildCalculatedReadState(fields(), data, inputSources, []);
    expect(deleted.values).not.toHaveProperty('rvsp|');
    const anotherStudy = buildCalculatedReadState(fields(), data, inputSources, [
      { source: 'viewer-measurement', sourceMeasurementKey: 'TR-annot-other' },
    ]);
    expect(anotherStudy.values).not.toHaveProperty('rvsp|');
  });


  it('links the real serialized toolbar TR peak velocity to the configured RVSP field', () => {
    const candidates = buildViewerMeasurementValueCandidates([{
      annotationId: 'TR-source-real-1',
      uid: 'TR-source-real-1',
      measurementKind: 'ultrasound-directional',
      toolName: 'UltrasoundDirectionalTool',
      label: 'TR peak velocity',
      measurements: {
        value: 280,
        unit: 'cm/s',
        ultrasoundDirectional: {
          measurementKind: 'ultrasound-directional',
          acquisitionMode: 'spectralVmax',
          value: 280,
          unit: 'cm/s',
          reportValue: 2.8,
          reportUnit: 'm/s',
        },
      },
    }]);
    const updates = buildViewerMeasurementReadUpdates(fields(), candidates, {});
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      fieldKey: 'trVmax|',
      source: 'viewer-measurement',
      sourceMeasurementKey: 'TR-source-real-1',
    });
    expect(updates[0].value).toBeCloseTo(2.8, 6);

    const savedSources = {
      'trVmax|': {
        source: updates[0].source,
        sourceMeasurementKey: updates[0].sourceMeasurementKey,
      },
      'rap|': { source: 'manual' },
    };
    const read = buildCalculatedReadState(
      fields(), { 'trVmax|': updates[0].value, 'rap|': 3 },
      savedSources, candidates
    );
    expect(read.values['rvsp|']).toBeCloseTo(34.4);
    expect(read.sources['rvsp|'].sourceMeasurementKey).toContain('TR-source-real-1');
  });

  it('never arbitrarily binds the last of two TR Vmax sources', () => {
    const competing = [
      { labels: ['TRVel'], value: 2.5, unit: 'm/s',
        source: 'viewer-measurement', sourceMeasurementKey: 'tr-first' },
      { labels: ['TRVel'], value: 3.1, unit: 'm/s',
        source: 'viewer-measurement', sourceMeasurementKey: 'tr-second' },
    ];
    expect(buildViewerMeasurementReadUpdates(fields(), competing, {})).toEqual([]);
    const pinned = buildViewerMeasurementReadUpdates(fields(), competing, {
      'trVmax|': { source: 'viewer-measurement', sourceMeasurementKey: 'tr-first' },
    });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].value).toBeCloseTo(2.5);
    expect(pinned[0].sourceMeasurementKey).toBe('tr-first');
  });

  it('binds source-calibrated cm/sec toolbar velocity and keeps correct RVSP inputs', () => {
    const candidates = buildViewerMeasurementValueCandidates([{
      annotationId: 'tr-calibrated-256',
      measurementKind: 'ultrasound-directional',
      label: 'TR peak velocity',
      measurements: {
        ultrasoundDirectional: {
          measurementKind: 'ultrasound-directional',
          value: 256,
          unit: 'cm/sec',
          acquisitionMode: 'spectralVmax',
        },
      },
    }]);
    const updates = buildViewerMeasurementReadUpdates(fields(), candidates, {});
    expect(updates).toHaveLength(1);
    expect(updates[0].value).toBeCloseTo(2.56);
    const state = buildCalculatedReadState(fields(),
      { 'trVmax|': updates[0].value, 'rap|': 3 },
      { 'trVmax|': { source: updates[0].source, sourceMeasurementKey: updates[0].sourceMeasurementKey },
        'rap|': { source: 'manual' } },
      candidates);
    expect(state.values['rvsp|']).toBeCloseTo(29.2, 1);
  });

  it('has no effect on protocols without a calculated field', () => {
    const regular = buildReadFields({
      components: [{ componentKey: 'comment', kind: 'text' }],
    });
    const original = { 'comment|': 'reviewed' };
    expect(buildCalculatedReadState(regular, original).values).toEqual(original);
  });
});
