import {
  calculateEchoLinearLVMeasurements,
  getCalibratedEchoLinearLengthMM,
} from './echoLinearMeasurements';

function length(label: string, value: number, unit = 'mm', overrides: any = {}) {
  return {
    domain: 'echo',
    toolName: 'Length',
    label,
    measurements: { length: value, lengthUnit: unit },
    ...overrides,
  };
}

describe('Echo linear LV measurements', () => {
  it('calculates ASE-corrected LV mass and RWT from three named calibrated lengths', () => {
    expect(calculateEchoLinearLVMeasurements([
      length('LVIDd', 50), length('IVSd', 10), length('PWd', 10),
    ])).toEqual({ relativeWallThickness: '0.40', lvMassG: '182' });
  });

  it('previews unsaved MeasurementService calipers before domain is assigned on save', () => {
    const live = [
      { toolName: 'Length', label: 'LVIDd', value: 50, unit: 'mm' },
      { toolName: 'Length', label: 'IVSd', value: 10, unit: 'mm' },
      { toolName: 'Length', label: 'PWd', value: 10, unit: 'mm' },
    ];
    expect(calculateEchoLinearLVMeasurements(live)).toEqual({
      relativeWallThickness: '0.40', lvMassG: '182',
    });
  });

  it('normalizes cm and mm consistently before calculation', () => {
    expect(calculateEchoLinearLVMeasurements([
      length('LVIDd', 5, 'cm'), length('IVSd', 1, 'cm'), length('PWd', 10),
    ])).toEqual({ relativeWallThickness: '0.40', lvMassG: '182' });
    expect(calculateEchoLinearLVMeasurements([
      length('LVIDd', 48.46), length('IVSd', 9.54), length('PWd', 9.04),
    ])).toEqual({ relativeWallThickness: '0.37', lvMassG: '156' });
  });

  it('only previews RWT until all three diastolic lengths exist', () => {
    expect(calculateEchoLinearLVMeasurements([
      length('LVIDd', 50), length('PWd', 10),
    ])).toEqual({ relativeWallThickness: '0.40', lvMassG: null });
    expect(calculateEchoLinearLVMeasurements([length('IVSd', 10)])).toBeNull();
  });

  it('rejects uncalibrated, unsupported, repeated and cross-domain measurements', () => {
    const invalid = [
      length('IVSd', 10, 'px'),
      length('IVSd', 10, 'cm US Region'),
      length('IVSd', -10),
      length('IVSd', 10, '', { domain: 'bowel' }),
      length('IVSd', 10, 'mm', { mode: 'repeated' }),
      length('IVSd', 10, 'mm', { toolName: 'ArrowAnnotate' }),
      length('Unknown', 10),
    ];
    invalid.forEach(measurement => {
      expect(getCalibratedEchoLinearLengthMM(measurement)).toBeNull();
      expect(calculateEchoLinearLVMeasurements([
        length('LVIDd', 50), measurement, length('PWd', 10),
      ])?.lvMassG).not.toBeTruthy();
    });
  });

  it('does not mistake display-normalized pixel lengths for physically calibrated inputs', () => {
    const invalidPixel = length('PWd', 8, 'mm', {
      arCalibratedEchoLengthMM: null, // original source was px before display normalization
    });
    expect(calculateEchoLinearLVMeasurements([
      length('LVIDd', 50), length('IVSd', 10), invalidPixel,
    ])).toBeNull();
  });

  it('uses the latest valid source for each named report measurement', () => {
    const measurements = [
      length('LVIDd', 50),
      length('IVSd', 10),
      length('PWd', 10),
      length('IVSd', 11),
    ];
    expect(calculateEchoLinearLVMeasurements(measurements)?.lvMassG).toBe('194');
    expect(calculateEchoLinearLVMeasurements(measurements)?.relativeWallThickness).toBe('0.40');
  });

  it('updates LV mass when a contributing source measurement changes', () => {
    const base = [length('LVIDd', 50), length('IVSd', 10), length('PWd', 10)];
    const updated = [base[0], length('IVSd', 11), base[2]];
    expect(calculateEchoLinearLVMeasurements(base)?.lvMassG).toBe('182');
    expect(calculateEchoLinearLVMeasurements(updated)?.lvMassG).toBe('194');
  });
});
