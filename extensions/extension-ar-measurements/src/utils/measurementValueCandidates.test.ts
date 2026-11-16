import { buildViewerMeasurementValueCandidates } from './measurementValueCandidates';

const points = [[0, 0, 0], [1, 0, 0]];
const ivc = (label: string, mm: number, frameNumber: number) => ({
  uid: label,
  toolName: 'Length',
  label,
  points,
  measurements: { length: mm, unit: 'mm' },
  referenceStudyUID: 'study',
  referenceSeriesUID: 'ivc-series',
  SOPInstanceUID: 'ivc-sop',
  frameNumber,
});
const rvArea = (slot: 'RV_ED' | 'RV_ES', area: number, frameNumber: number) => ({
  uid: slot,
  measurementKind: 'echoAreaSlot',
  toolName: 'SplineROI',
  label: slot,
  echoArea: { slot },
  points: [[0, 0, 0], [3, 0, 0], [0, 3, 0]],
  measurements: { area, areaUnit: 'cm²' },
  referenceStudyUID: 'study',
  referenceSeriesUID: 'rv-series',
  SOPInstanceUID: 'rv-sop',
  frameNumber,
});
const laContour = (slot: 'A4C' | 'A2C', widthMM: number) => {
  const half = widthMM / 2;
  const axisMM = 80;
  const contour = [
    [-half, 0, 0], [-half, 20, 0], [-half, 40, 0],
    [-half, 60, 0], [-half, 80, 0], [half, 80, 0],
    [half, 60, 0], [half, 40, 0], [half, 20, 0], [half, 0, 0],
  ];
  return {
    uid: 'la-' + slot, measurementKind: 'laVolumeSlot', toolName: 'SplineROI',
    referenceStudyUID: 'study', referenceSeriesUID: 'la-' + slot, points: contour,
    laVolume: {
      measurementKind: 'laVolumeSlot', slot, view: slot, phase: 'ES',
      baseLeftPoint: [-half, 0, 0], baseRightPoint: [half, 0, 0],
      superiorPoint: [0, 80, 0], longAxisLengthMM: axisMM,
    },
  };
};


const directionalTR = (rawValue: number | null, unit = 'cm/s', label = 'TR peak velocity') => ({
  annotationId: 'TR-toolbar-annotation-1',
  uid: 'TR-toolbar-annotation-1',
  toolName: 'UltrasoundDirectionalTool',
  measurementKind: 'ultrasound-directional',
  label,
  referenceStudyUID: 'study',
  referenceSeriesUID: 'tr-series',
  SOPInstanceUID: 'tr-sop',
  frameNumber: 4,
  points,
  measurements: {
    measurementKind: 'ultrasound-directional',
    value: rawValue,
    unit,
    ultrasoundDirectional: {
      measurementKind: 'ultrasound-directional',
      acquisitionMode: 'spectralVmax',
      value: rawValue,
      unit,
      reportValue: rawValue === null ? null : rawValue / 100,
      reportUnit: 'm/s',
    },
    displayText: ['TR peak velocity: 300 m/s - never parse as a source'],
  },
});

describe('Research Read calibrated toolbar TR velocity binding', () => {
  it('recognizes the selected TR peak target and converts cm/s into m/s with annotation provenance', () => {
    const candidates = buildViewerMeasurementValueCandidates([directionalTR(280)]);
    const tr = candidates.find(candidate => candidate.labels.includes('TRVel'));
    expect(tr).toMatchObject({
      unit: 'm/s',
      source: 'viewer-measurement',
      sourceMeasurementKey: 'TR-toolbar-annotation-1',
    });
    expect(tr.value).toBeCloseTo(2.8, 6);
    expect(tr.labels).toContain('TR Vmax');
    expect(tr.labels).toContain('TR peak velocity');
  });

  it('preserves m/s and converts mm/s without parsing displayed text', () => {
    const direct = buildViewerMeasurementValueCandidates([directionalTR(3.1, 'm/s')]);
    expect(direct.find(item => item.labels.includes('TRVel'))?.value).toBeCloseTo(3.1);
    const metric = buildViewerMeasurementValueCandidates([directionalTR(3100, 'mm/s')]);
    expect(metric.find(item => item.labels.includes('TRVel'))?.value).toBeCloseTo(3.1);
  });

  it('never maps another spectral Doppler target to TR velocity', () => {
    const avPeak = directionalTR(320, 'cm/s', 'AV peak velocity');
    const candidates = buildViewerMeasurementValueCandidates([avPeak]);
    expect(candidates.some(item => item.labels.includes('TRVel'))).toBe(false);
  });

  it('rejects invalid or uncalibrated TR sources rather than guessing a value', () => {
    const bad = [
      directionalTR(230, 'px'),
      directionalTR(null),
      directionalTR(0),
      directionalTR(-90),
      directionalTR(900, 'm/s'),
      { ...directionalTR(240), uid: '', annotationId: '' },
    ];
    for (const annotation of bad) {
      const candidates = buildViewerMeasurementValueCandidates([annotation]);
      expect(candidates.some(item => item.labels.includes('TRVel'))).toBe(false);
    }
  });

  it('does not add a TR target to unrelated ultrasound measurements', () => {
    const unselected = { ...directionalTR(280), label: 'Generic Ultrasound Directional (no AR report mapping)' };
    expect(
      buildViewerMeasurementValueCandidates([unselected])
        .some(item => item.labels.includes('TRVel'))
    ).toBe(false);
  });
});

describe('Research Read source-linked Echo derived candidates', () => {
  it('exports only complete calibrated RV FAC and IVC collapse, with both source IDs', () => {
    const annotations = [
      rvArea('RV_ED', 30, 2), rvArea('RV_ES', 18, 15),
      ivc('IVCexp', 20, 3), ivc('IVCinsp', 8, 14),
    ];
    const derived = buildViewerMeasurementValueCandidates(annotations);
    const fac = derived.find(item => item.labels.includes('RVFAC'));
    const collapse = derived.find(item => item.labels.includes('IVCCollapsibility'));
    expect(fac).toMatchObject({ value: 40, unit: '%', source: 'viewer-derived' });
    expect(fac.sourceMeasurementKey).toContain('RV_ED,RV_ES');
    expect(collapse).toMatchObject({ value: 60, unit: '%', source: 'viewer-derived' });
    expect(collapse.sourceMeasurementKey).toContain('IVCexp,IVCinsp');
  });

  it('exports 20-disk LA volume by its distinct method label, not legacy LAV', () => {
    const derived = buildViewerMeasurementValueCandidates([
      laContour('A4C', 20), laContour('A2C', 16),
    ]);
    const disks = derived.find(item => item.labels.includes('LAVolumeDisks'));
    expect(disks.value).toBeCloseTo((Math.PI / 4) * 20 * 16 * 80 / 1000, 3);
    expect(disks.unit).toBe('mL');
    expect(disks.labels).not.toContain('LAV');
    expect(disks.sourceMeasurementKey).toContain('la-A4C,la-A2C');
  });

  it('rejects incomplete, duplicated or uncalibrated composites', () => {
    const incomplete = buildViewerMeasurementValueCandidates([
      rvArea('RV_ED', 30, 2), ivc('IVCexp', 20, 3), laContour('A4C', 20),
    ]);
    expect(incomplete.some(item => item.labels.includes('RVFAC'))).toBe(false);
    expect(incomplete.some(item => item.labels.includes('IVCCollapsibility'))).toBe(false);
    expect(incomplete.some(item => item.labels.includes('LAVolumeDisks'))).toBe(false);

    const duplicated = buildViewerMeasurementValueCandidates([
      rvArea('RV_ED', 30, 2), rvArea('RV_ED', 29, 3), rvArea('RV_ES', 18, 15),
    ]);
    expect(duplicated.some(item => item.labels.includes('RVFAC'))).toBe(false);

    const pixelArea = { ...rvArea('RV_ED', 30, 2), measurements: { area: 30, areaUnit: 'px²' } };
    const uncalibrated = buildViewerMeasurementValueCandidates([
      pixelArea, rvArea('RV_ES', 18, 15),
    ]);
    expect(uncalibrated.some(item => item.labels.includes('RVFAC'))).toBe(false);
  });

  it('does not fabricate provenance when source annotation identifiers are missing', () => {
    const measurements = [
      { ...ivc('IVCexp', 20, 3), uid: '' }, ivc('IVCinsp', 8, 14),
    ];
    const derived = buildViewerMeasurementValueCandidates(measurements);
    expect(derived.some(item => item.labels.includes('IVCCollapsibility'))).toBe(false);
  });
});
