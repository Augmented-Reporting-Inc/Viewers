import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import { getResearchCompatibleMeasurementCandidates, getResearchBindingSources } from './researchFieldNavigation';
import {
  buildViewerMeasurementReadUpdates,
  buildReadFields,
  buildCalculatedReadState,
  buildReadResultEntries,
  buildReadValueState,
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

describe('Research saved categorical answer round-trip', () => {
  it('retains exact saved Image Quality through calculation and result restoration', () => {
    const quality = buildReadFields({ domain: 'echo', components: [{
      componentKey: 'imageQuality', kind: 'ordinal',
      config: { options: ['Poor', 'Fair', 'Good', 'Excellent'] },
    }]});
    const calculated = buildCalculatedReadState(quality, { 'imageQuality|': 'Good' },
      { 'imageQuality|': { source: 'manual' } });
    const restored = buildReadValueState({ entries: buildReadResultEntries(
      quality, calculated.values, calculated.sources) });
    expect(restored.values['imageQuality|']).toBe('Good');
    expect(restored.sources['imageQuality|'].source).toBe('manual');
  });
  it('does not drop a configured zero-valued choice', () => {
    const quality = buildReadFields({ components: [{ componentKey: 'quality', kind: 'ordinal',
      config: { options: [{ value: 0, label: 'Poor' }, { value: 1, label: 'Good' }] } }] });
    expect(quality[0].config.options).toEqual([{ value: '0', label: 'Poor' }, { value: '1', label: 'Good' }]);
  });
});

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

describe('Research IVC frame-bound calculation and persistence', () => {
  const study = '1.2.study';
  const series = '1.2.series';
  const instance = '1.2.instance';
  const ivcField = buildReadFields({ domain: 'echo', components: [{
    componentKey: 'ivcCollapsibility', kind: 'measurement',
    config: {
      unit: '%', step: 0.1, measurementLabels: ['IVCCollapsibility'],
      compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: {
        IVC_EXP: { studyInstanceUID: study, seriesInstanceUID: series,
          sopInstanceUID: instance, frameNumber: 2 },
        IVC_INSP: { studyInstanceUID: study, seriesInstanceUID: series,
          sopInstanceUID: instance, frameNumber: 22 },
      },
    },
  }] })[0];

  function length(label: string, lengthMM: number, frame: number) {
    return {
      annotationId: label + frame, label, toolName: 'Length',
      points: [[0, 0, 0], [1, 0, 0]],
      measurements: { length: lengthMM, lengthUnit: 'mm', unit: 'mm' },
      StudyInstanceUID: study, SeriesInstanceUID: series,
      SOPInstanceUID: instance,
      frameNumber: 1,
      referencedImageId:
        `wadors:/studies/${study}/series/${series}/instances/${instance}/frames/${frame}`,
    };
  }

  it('binds IVC 60% from exact source frames, then serializes a viewer-derived result', () => {
    const annotations = [length('IVCexp', 20, 2), length('IVCinsp', 8, 22)];
    const compatible = getResearchCompatibleMeasurementCandidates(
      ivcField, buildViewerMeasurementValueCandidates(annotations), annotations
    );
    expect(compatible).toHaveLength(1);
    const updates = buildViewerMeasurementReadUpdates([ivcField], compatible, {});
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      fieldKey: 'ivcCollapsibility|',
      value: 60, source: 'viewer-derived',
    });
    const entries = buildReadResultEntries([ivcField], {
      [updates[0].fieldKey]: updates[0].value,
    }, {
      [updates[0].fieldKey]: {
        source: updates[0].source,
        sourceMeasurementKey: updates[0].sourceMeasurementKey,
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      componentKey: 'ivcCollapsibility', value: 60, unit: '%',
      source: 'viewer-derived',
    });
    expect(entries[0].sourceMeasurementKey).toContain('IVCexp2,IVCinsp22');
  });

  it('does not bind or serialize IVC collapse from a wrong source frame', () => {
    const annotations = [length('IVCexp', 20, 2), length('IVCinsp', 8, 21)];
    const compatible = getResearchCompatibleMeasurementCandidates(
      ivcField, buildViewerMeasurementValueCandidates(annotations), annotations
    );
    expect(buildViewerMeasurementReadUpdates([ivcField], compatible, {})).toEqual([]);
  });
});

test('fixed IVC evidence takes precedence over a stale manual placeholder, not over other fields', () => {
  const config = {
    componentKey: 'ivcCollapsibility', key: 'ivcCollapsibility|',
    config: { compositeFrameTargets: { IVC_EXP: {}, IVC_INSP: {} } },
  };
  const existing = {
    'ivcCollapsibility|': { source: 'manual', sourceMeasurementKey: '' },
    'trVmax|': { source: 'manual', sourceMeasurementKey: '' },
  };
  const next = getResearchBindingSources(config, existing);
  expect(next['ivcCollapsibility|']).toEqual({
    source: 'viewer-derived', sourceMeasurementKey: '',
  });
  expect(next['trVmax|']).toEqual(existing['trVmax|']);
  expect(existing['ivcCollapsibility|'].source).toBe('manual');
  expect(getResearchBindingSources({
    ...config, config: {},
  }, existing)).toBe(existing);
});

test('corrected IVC replaces stale bound source key only when exactly one verified candidate exists', () => {
  const ivc = {
    componentKey: 'ivcCollapsibility', kind: 'measurement', key: 'ivcCollapsibility|',
    config: {
      unit: '%', measurementLabels: ['IVCCollapsibility'],
      compositeFrameTargets: { IVC_EXP: {}, IVC_INSP: {} },
    },
  };
  const existing = {
    'ivcCollapsibility|': {
      source: 'viewer-derived',
      sourceMeasurementKey: 'ivc-collapse:old-exp,old-insp',
    },
  };
  const latest = [{
    labels: ['IVCCollapsibility'], value: 80, unit: '%',
    source: 'viewer-derived',
    sourceMeasurementKey: 'ivc-collapse:new-exp,old-insp',
  }];
  const rebinding = getResearchBindingSources(ivc, existing, latest);
  expect(existing['ivcCollapsibility|'].sourceMeasurementKey)
    .toBe('ivc-collapse:old-exp,old-insp');
  expect(rebinding[ivc.key]).toEqual({
    source: 'viewer-derived', sourceMeasurementKey: '',
  });
  expect(buildViewerMeasurementReadUpdates([ivc], latest, rebinding))
    .toMatchObject([{ fieldKey: ivc.key, value: 80,
      sourceMeasurementKey: 'ivc-collapse:new-exp,old-insp' }]);
  expect(getResearchBindingSources(ivc, existing, [])).toBe(existing);
  expect(getResearchBindingSources(ivc, existing, [latest[0], {
    ...latest[0], sourceMeasurementKey: 'ivc-collapse:ambiguous-exp,old-insp',
  }])).toBe(existing);
  expect(getResearchBindingSources(
    { ...ivc, componentKey: 'trVmax' }, existing, latest
  )).toBe(existing);
});
