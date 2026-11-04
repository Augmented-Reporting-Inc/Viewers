import { resolveSpectralVmaxClick } from './spectralVmaxClick';

const spectralRegion = {
  minX: 20, maxX: 500, minY: 40, maxY: 400,
  referenceY: 210, referencePhysicalY: 0,
  physicalDeltaY: -2, spatialFormat: 3, unitsY: 7,
};

describe('single-click spectral Vmax calibration', () => {
  it('uses a region-relative zero reference and returns peak blood-flow velocity', () => {
    const result = resolveSpectralVmaxClick(spectralRegion, 150, 100);
    expect(result?.baselineY).toBe(250);
    expect(result?.velocityMps).toBe(3);
  });
  it('supports nonzero reference physical velocity', () => {
    const result = resolveSpectralVmaxClick({ ...spectralRegion, referencePhysicalY: 20 }, 150, 100);
    expect(result?.baselineY).toBe(260);
    expect(result?.velocityMps).toBe(3.2);
  });
  it('rejects missing or incompatible metadata and out-of-region clicks', () => {
    expect(resolveSpectralVmaxClick({ ...spectralRegion, unitsY: 5 }, 150, 100)).toBeNull();
    expect(resolveSpectralVmaxClick({ ...spectralRegion, physicalDeltaY: 0 }, 150, 100)).toBeNull();
    expect(resolveSpectralVmaxClick({ ...spectralRegion, referenceY: NaN }, 150, 100)).toBeNull();
    expect(resolveSpectralVmaxClick(spectralRegion, 900, 100)).toBeNull();
    expect(resolveSpectralVmaxClick({ ...spectralRegion, referenceY: 900 }, 150, 100)).toBeNull();
  });
});
