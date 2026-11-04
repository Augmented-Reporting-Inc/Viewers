import {
  getSpectralVmaxTargetOptionsForUnit,
  normalizeUltrasoundDirectionalTargetSelection,
  convertUltrasoundDirectionalValueForTarget,
} from './ultrasoundDirectionalReportMapping';

describe('TR Vmax educational spectral source target', () => {
  it('recognizes TR peak flow velocity with calibrated cm/s or m/s input', () => {
    for (const unit of ['cm/s', 'm/s']) {
      const available = getSpectralVmaxTargetOptionsForUnit(unit);
      expect(available.some(option => option.value === 'echo.trPeakVelocity')).toBe(true);
      const target = normalizeUltrasoundDirectionalTargetSelection('echo.trPeakVelocity', unit);
      expect(target?.key).toBe('echo.trPeakVelocity');
      expect(target?.label).toBe('TR peak velocity');
    }
    expect(getSpectralVmaxTargetOptionsForUnit('ms').some(
      option => option.value === 'echo.trPeakVelocity'
    )).toBe(false);
  });
  it('converts DICOM spectral velocity to the quiz m/s unit', () => {
    const target = normalizeUltrasoundDirectionalTargetSelection(
      'echo.trPeakVelocity', 'cm/s'
    );
    expect(convertUltrasoundDirectionalValueForTarget({
      value: 280, unit: 'cm/s', target,
    })).toEqual({ value: 2.8, unit: 'm/s' });
  });
});
