import { resolveSpectralVmaxClick, resolveSpectralVmaxWorldClick } from './spectralVmaxClick';

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

describe('spectral click uses verified viewport VTK geometry', () => {
  const vtk = {
    worldToIndex: ([x,y,z]: number[]) => [(x-10)/2,(y-20)/3,z],
    indexToWorld: ([x,y,z]: number[]) => [x*2+10,y*3+20,z],
  };
  const point = [310,320,0]; // pixel index 150,100,0
  it('accepts a StackViewport descriptor or direct vtk geometry, preserving anisotropic spacing', () => {
    for (const imageData of [vtk,{imageData:vtk,dimensions:[512,512,1]}]) {
      expect(resolveSpectralVmaxWorldClick(imageData,point,[spectralRegion]))
        .toEqual({baselineWorld:[310,770,0],velocityMps:3});
    }
  });
  it('leaves native two-point capture available if geometry is absent, throws or is inconsistent', () => {
    for (const imageData of [
      {}, {imageData:{}}, {imageData:{...vtk,worldToIndex:()=>{throw Error('no transform');}}},
      {imageData:{...vtk,indexToWorld:()=>[NaN,0,0]}},
      {imageData:{...vtk,indexToWorld:()=>[0,0,0]}},
    ]) expect(resolveSpectralVmaxWorldClick(imageData,point,[spectralRegion])).toBeNull();
  });
  it('does not guess among conflicting spectral regions or missing metadata', () => {
    expect(resolveSpectralVmaxWorldClick(vtk,point,[spectralRegion,{...spectralRegion,physicalDeltaY:-3}])).toBeNull();
    expect(resolveSpectralVmaxWorldClick(vtk,point,[{...spectralRegion,referenceY:NaN}])).toBeNull();
    expect(resolveSpectralVmaxWorldClick(vtk,point,[spectralRegion,spectralRegion])?.velocityMps).toBe(3);
  });
});
