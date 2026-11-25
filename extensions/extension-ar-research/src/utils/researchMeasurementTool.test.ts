import { getResearchMeasurementToolForField } from './researchMeasurementTool';

const measurement = (unit: string, config: any = {}) => ({
  kind: 'measurement', componentKey: 'lvidd', config: { unit, ...config },
});

describe('Research Echo question measurement-tool activation', () => {
  it('automatically selects calibrated Length for millimetre measurements such as LVIDd', () => {
    expect(getResearchMeasurementToolForField(measurement('mm'), 'echo')).toBe('Length');
    expect(getResearchMeasurementToolForField(measurement('MM'), 'ECHO')).toBe('Length');
  });
  it('honours explicit protocol tool configuration for other units', () => {
    expect(getResearchMeasurementToolForField(measurement('cm', { viewerMeasurementTool: 'Length' }), 'echo')).toBe('Length');
    expect(getResearchMeasurementToolForField(measurement('mm', { measurementTool: 'SomeOtherTool' }), 'echo')).toBe('');
  });
  it('does not misactivate Length for Doppler VTI, EF, pressure, derived or non-Echo questions', () => {
    expect(getResearchMeasurementToolForField(measurement('cm'), 'echo')).toBe('');
    expect(getResearchMeasurementToolForField(measurement('%'), 'echo')).toBe('');
    expect(getResearchMeasurementToolForField(measurement('mmHg'), 'echo')).toBe('');
    expect(getResearchMeasurementToolForField(measurement('mm', { calculation: { type: 'rvsp' } }), 'echo')).toBe('');
    expect(getResearchMeasurementToolForField(measurement('mm'), 'bowel')).toBe('');
    expect(getResearchMeasurementToolForField({ kind: 'text', config: { unit: 'mm' } }, 'echo')).toBe('');
  });
});
