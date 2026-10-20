import { metaData } from '@cornerstonejs/core';
import { getUSRegionLengthCalibration, correctUSRegionLength } from './correctUSRegionLength';

jest.mock('@cornerstonejs/core', () => ({
  metaData: { get: jest.fn() },
}));

const getMetadata = metaData.get as jest.Mock;
const region = (minX, maxX, physicalDeltaX, unitsX = 3, unitsY = 3) => ({
  regionDataType: 1,
  physicalUnitsXDirection: unitsX,
  physicalUnitsYDirection: unitsY,
  regionLocationMinX0: minX,
  regionLocationMaxX1: maxX,
  regionLocationMinY0: 0,
  regionLocationMaxY1: 100,
  physicalDeltaX,
  physicalDeltaY: physicalDeltaX,
});
const annotationWithHandles = (a, b) => ({
  data: { handles: { points: [a, b] } },
});

describe('Shared Length DICOM US-region calibration', () => {
  beforeEach(() => getMetadata.mockReset());

  function useRegions(regions) {
    getMetadata.mockImplementation(type => {
      if (type === 'calibrationModule') return { sequenceOfUltrasoundRegions: regions };
      if (type === 'imagePlaneModule') return { columnPixelSpacing: 1, rowPixelSpacing: 1 };
      return undefined;
    });
  }

  it('uses the region containing both endpoints, including when multiple regions are present', () => {
    useRegions([region(0, 100, 0.01), region(101, 200, 0.04)]);
    const annotation = annotationWithHandles([110, 20, 0], [112, 20, 0]);

    expect(getUSRegionLengthCalibration('image', annotation)).toEqual({
      lengthCm: 0.08,
      unit: 'cm',
    });
    expect(correctUSRegionLength(1.23, 'image', annotation)).toBe(0.08);
  });

  it('rejects calipers crossing multiple regions rather than using an arbitrary region', () => {
    useRegions([region(0, 100, 0.01), region(101, 200, 0.04)]);
    const annotation = annotationWithHandles([95, 20, 0], [112, 20, 0]);
    expect(getUSRegionLengthCalibration('image', annotation)).toBeNull();
    expect(correctUSRegionLength(1.23, 'image', annotation)).toBe(1.23);
  });

  it('does not interpret time or velocity ultrasound regions as spatial length', () => {
    useRegions([region(0, 100, 0.01, 4, 7)]);
    expect(getUSRegionLengthCalibration('image',
      annotationWithHandles([10, 20, 0], [12, 20, 0])
    )).toBeNull();
  });

  it('preserves raw measurement for missing ultrasound metadata or points', () => {
    getMetadata.mockReturnValue(undefined);
    expect(correctUSRegionLength(1.23, 'image', annotationWithHandles([0, 0, 0], [1, 0, 0])))
      .toBe(1.23);
    expect(getUSRegionLengthCalibration('image', { data: { handles: { points: [] } } }))
      .toBeNull();
  });

  it('rejects invalid spacing and zero physical deltas', () => {
    useRegions([region(0, 100, 0)]);
    expect(getUSRegionLengthCalibration('image',
      annotationWithHandles([10, 20, 0], [12, 20, 0])
    )).toBeNull();
    getMetadata.mockImplementation(type =>
      type === 'calibrationModule'
        ? { sequenceOfUltrasoundRegions: [region(0, 100, 0.01)] }
        : { columnPixelSpacing: 0, rowPixelSpacing: 1 }
    );
    expect(getUSRegionLengthCalibration('image',
      annotationWithHandles([10, 20, 0], [12, 20, 0])
    )).toBeNull();
  });
});
