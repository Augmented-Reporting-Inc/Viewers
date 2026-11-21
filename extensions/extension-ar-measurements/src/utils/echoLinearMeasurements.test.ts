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

describe('Live OHIF Length adapter preview (exact-frame native stats)', () => {
  const image = (frame: number) =>
    `wadors:example/studies/1/series/2/instances/3/frames/${frame}`;
  const live = (label: string, value: number, unit = 'mm', frame = 1, overrides: any = {}) => {
    const referencedImageId = image(frame);
    return {
      toolName: 'Length',
      label,
      referencedImageId,
      displayText: { primary: [`${value} ${unit}`] },
      data: { [`imageId:${referencedImageId}`]: { length: value, unit } },
      ...overrides,
    };
  };

  it('computes LV Mass and RWT from physically calibrated native Length data before Save', () => {
    expect(calculateEchoLinearLVMeasurements([
      live('LVIDd', 50), live('IVSd', 10), live('PWd', 10),
    ])).toEqual({ relativeWallThickness: '0.40', lvMassG: '182' });
    expect(calculateEchoLinearLVMeasurements([
      live('LVIDd', 5, 'cm'), live('IVSd', 1, 'cm'), live('PWd', 10),
    ])?.lvMassG).toBe('182');
  });

  it('uses current-frame physical stats when the display adapter has object-valued data', () => {
    const current = live('IVSd', 10, 'mm', 1, {
      value: { primary: ['10 mm'] },
      unit: 'px', // should not override exact-frame native calibration
    });
    expect(getCalibratedEchoLinearLengthMM(current)).toBe(10);
    expect(calculateEchoLinearLVMeasurements([
      live('LVIDd', 50), current, live('PWd', 10),
    ])?.lvMassG).toBe('182');
  });

  it('updates after a same-frame live native caliper change', () => {
    const before = [live('LVIDd', 50), live('IVSd', 10), live('PWd', 10)];
    expect(calculateEchoLinearLVMeasurements(before)?.lvMassG).toBe('182');
    const after = [before[0], live('IVSd', 11), before[2]];
    expect(calculateEchoLinearLVMeasurements(after)?.lvMassG).toBe('194');
  });

  it('requires the exact referenced frame, not cached stats from another frame', () => {
    const wrong = live('IVSd', 10, 'mm', 1, {
      data: { [`imageId:${image(2)}`]: { length: 10, unit: 'mm' } },
    });
    expect(getCalibratedEchoLinearLengthMM(wrong)).toBeNull();
    expect(calculateEchoLinearLVMeasurements([
      live('LVIDd', 50), wrong, live('PWd', 10),
    ])?.lvMassG).toBeFalsy();
  });

  it('ignores a stale cached target when the current frame target also exists', () => {
    const current = live('IVSd', 11, 'mm', 2, {
      data: {
        [`imageId:${image(1)}`]: { length: 30, unit: 'mm' },
        [`imageId:${image(2)}`]: { length: 11, unit: 'mm' },
      },
    });
    expect(getCalibratedEchoLinearLengthMM(current)).toBe(11);
  });

  it('never uses normalized display text or uncalibrated native units as physical evidence', () => {
    for (const unit of ['px', 'cm US Region', '', 'pixel']) {
      const uncalibrated = live('IVSd', 10, unit, 1, {
        displayText: { primary: ['10 mm'] },
      });
      expect(getCalibratedEchoLinearLengthMM(uncalibrated)).toBeNull();
      expect(calculateEchoLinearLVMeasurements([
        live('LVIDd', 50), uncalibrated, live('PWd', 10),
      ])?.lvMassG).toBeFalsy();
    }
  });
});
