import { getSpectralVmaxTargetOptionsForUnit } from './ultrasoundDirectionalReportMapping';

describe('spectral Vmax targets', () => {
  it('uses existing peak flow velocity mappings without tissue or MV inflow targets', () => {
    const keys = getSpectralVmaxTargetOptionsForUnit('m/s', { includeGeneric: false })
      .map(item => item.value);
    expect(keys).toContain('echo.trPeakVelocity');
    expect(keys).toContain('echo.avPeakVelocity');
    expect(keys).toContain('echo.pvPeakVelocity');
    expect(keys).not.toContain('echo.mvEVelocity');
    expect(keys).not.toContain('echo.rvSPrimeVelocity');
    expect(keys).not.toContain('echo.prEndDiastolicVelocity');
  });
  it('refuses an uncalibrated or tissue velocity unit', () => {
    expect(getSpectralVmaxTargetOptionsForUnit('px', { includeGeneric: false })).toEqual([]);
    expect(getSpectralVmaxTargetOptionsForUnit('cm/s', { includeGeneric: false })).toEqual([]);
  });
});
