import {
  convertPhysicalValue,
  getPhysicalUnitDimension,
  normalizePhysicalUnit,
  presentVerifiedPhysicalMeasurement,
  resolveMeasurementDisplayPolicy,
} from './physicalMeasurementPresentation';

describe('platform physical unit conversion (not image calibration)', () => {
  it('accepts explicit physical unit spellings and preserves dimensionality', () => {
    expect(normalizePhysicalUnit('mm²')).toBe('mm2');
    expect(normalizePhysicalUnit('cm2')).toBe('cm2');
    expect(normalizePhysicalUnit('mL')).toBe('ml');
    expect(normalizePhysicalUnit('mmHg')).toBe('mmhg');
    expect(getPhysicalUnitDimension('cm/s')).toBe('velocity');
    expect(getPhysicalUnitDimension('cm²')).toBe('area');
    expect(getPhysicalUnitDimension('ms')).toBe('time');
  });

  it('converts true physical areas, lengths, volumes, velocity and time', () => {
    expect(convertPhysicalValue(1931, 'mm²', 'cm²', 'area')).toBeCloseTo(19.31);
    expect(convertPhysicalValue(19.31, 'cm²', 'mm²', 'area')).toBeCloseTo(1931);
    expect(convertPhysicalValue(2.2, 'cm', 'mm', 'length')).toBe(22);
    expect(convertPhysicalValue(12, 'mm', 'cm', 'length')).toBeCloseTo(1.2);
    expect(convertPhysicalValue(0.08, 'L', 'mL', 'volume')).toBe(80);
    expect(convertPhysicalValue(250, 'cm/s', 'm/s', 'velocity')).toBeCloseTo(2.5);
    expect(convertPhysicalValue(0.16, 's', 'ms', 'time')).toBe(160);
    expect(convertPhysicalValue(0, '%', '%', 'percentage')).toBe(0);
    expect(convertPhysicalValue(8, 'mmHg', 'mmHg', 'pressure')).toBe(8);
  });

  it('never guesses physical units from pixels, blank source values, or other dimensions', () => {
    expect(convertPhysicalValue(19.3, 'px²', 'cm²', 'area')).toBeNull();
    expect(convertPhysicalValue(19.3, '', 'cm²', 'area')).toBeNull();
    expect(convertPhysicalValue(19.3, undefined, 'cm²')).toBeNull();
    expect(convertPhysicalValue(null, 'mm²', 'cm²')).toBeNull();
    expect(convertPhysicalValue('  ', 'mm²', 'cm²')).toBeNull();
    expect(convertPhysicalValue(Infinity, 'mm²', 'cm²')).toBeNull();
    expect(convertPhysicalValue(NaN, 'mm²', 'cm²')).toBeNull();
    expect(convertPhysicalValue(20, 'mm', 'cm²')).toBeNull();
    expect(convertPhysicalValue(20, 'cm²', 'cm²', 'length')).toBeNull();
    expect(convertPhysicalValue(20, 's', 'm/s')).toBeNull();
  });
});

describe('measurement-specific presentation policy, independent of measurement tool', () => {
  it('maps clinical echo, bowel, Doppler and time to appropriate defaults', () => {
    expect(resolveMeasurementDisplayPolicy('rvEDA')).toEqual({
      dimension: 'area', unit: 'cm²', decimals: 2,
    });
    expect(resolveMeasurementDisplayPolicy('bowelWallThickness')).toEqual({
      dimension: 'length', unit: 'mm', decimals: 1,
    });
    expect(resolveMeasurementDisplayPolicy('trVmax')).toEqual({
      dimension: 'velocity', unit: 'm/s', decimals: 2,
    });
    expect(resolveMeasurementDisplayPolicy('laVolume')).toEqual({
      dimension: 'volume', unit: 'mL', decimals: 1,
    });
    expect(resolveMeasurementDisplayPolicy('decelerationTime')).toEqual({
      dimension: 'time', unit: 'ms', decimals: 0,
    });
  });

  it('allows a safe configured presentation override, not a unit reinterpretation', () => {
    expect(resolveMeasurementDisplayPolicy('rvEDA', { unit: 'mm²', decimals: 1 }))
      .toEqual({ dimension: 'area', unit: 'mm²', decimals: 1 });
    expect(resolveMeasurementDisplayPolicy('rvEDA', { unit: 'mm' })).toBeNull();
    expect(resolveMeasurementDisplayPolicy('rvEDA', { dimension: 'length' })).toBeNull();
    expect(resolveMeasurementDisplayPolicy('rvEDA', { decimals: 20 })).toBeNull();
    expect(resolveMeasurementDisplayPolicy('unknownKind')).toBeNull();
  });

  it('requires upstream verification and consistently returns value, unit and text', () => {
    const echo = {
      verified: true as const, measurementKind: 'rvEDA',
      value: 1931, unit: 'mm²', calibrationSource: 'SequenceOfUltrasoundRegions',
      sourceReference: { frameNumber: 14, annotationId: 'test-contour' },
    };
    expect(presentVerifiedPhysicalMeasurement(echo)).toEqual({
      dimension: 'area', value: 19.31, unit: 'cm²', text: '19.31 cm²',
      sourceValue: 1931, sourceUnit: 'mm²',
      calibrationSource: 'SequenceOfUltrasoundRegions',
      sourceReference: { frameNumber: 14, annotationId: 'test-contour' },
    });
    expect(presentVerifiedPhysicalMeasurement(echo, { unit: 'mm²', decimals: 0 })?.text)
      .toBe('1931 mm²');
    expect(presentVerifiedPhysicalMeasurement({ ...echo, verified: false }))
      .toBeNull();
    expect(presentVerifiedPhysicalMeasurement({ ...echo, unit: 'px²' }))
      .toBeNull();
    expect(presentVerifiedPhysicalMeasurement({ ...echo, value: Infinity }))
      .toBeNull();
    expect(presentVerifiedPhysicalMeasurement({
      verified: true, measurementKind: 'bowelWallThickness',
      value: 0.28, unit: 'cm',
    })?.text).toBe('2.8 mm');
    expect(presentVerifiedPhysicalMeasurement({
      verified: true, measurementKind: 'trVmax',
      value: 300, unit: 'cm/s',
    })?.text).toBe('3.00 m/s');
    expect(presentVerifiedPhysicalMeasurement({
      verified: true, measurementKind: 'laVolume',
      value: 0.078, unit: 'L',
    })?.text).toBe('78.0 mL');
  });
});
