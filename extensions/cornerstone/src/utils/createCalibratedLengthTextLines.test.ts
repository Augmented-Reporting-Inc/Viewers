import { createCalibratedLengthTextLines } from './createCalibratedLengthTextLines';
import { getUSRegionLengthCalibration } from './correctUSRegionLength';

jest.mock('@cornerstonejs/core', () => ({
  utilities: {
    roundNumber: (n, decimals = 2) => Number(n.toFixed(decimals)),
  },
}));

jest.mock('./correctUSRegionLength', () => ({
  getUSRegionLengthCalibration: jest.fn(),
}));

const getCalibration = getUSRegionLengthCalibration as jest.Mock;
const imageId = 'wadors:/orthanc/dicom-web/studies/1/series/2/instances/3/frames/1';
const targetId = `imageId:${imageId}`;

function lengthData(length = 2.45, unit = 'cm US Region') {
  return {
    cachedStats: { [targetId]: { length, unit } },
    handles: { points: [[0, 0, 0], [30, 40, 0]] },
  };
}

describe('Shared native Length US preview calibration', () => {
  beforeEach(() => getCalibration.mockReset());

  it('displays DICOM-calibrated spatial cm values as mm in the live annotation', () => {
    getCalibration.mockReturnValue({ lengthCm: 7.499, unit: 'cm' });
    const data = lengthData();
    const nativeGetTextLines = jest.fn(() => ['2.45 cm US Region']);
    const format = createCalibratedLengthTextLines(nativeGetTextLines);

    expect(format(data, targetId)).toEqual(['74.99 mm']);
    expect(getCalibration).toHaveBeenCalledWith(imageId, { data });
    expect(nativeGetTextLines).toHaveBeenCalledWith(data, targetId);
    expect(data.cachedStats[targetId].length).toBe(2.45);
    expect(data.handles.points).toEqual([[0, 0, 0], [30, 40, 0]]);
  });

  it('keeps the calibrated result stable even when underlying raw stats happen to equal it', () => {
    getCalibration.mockReturnValue({ lengthCm: 0.15, unit: 'cm' });
    expect(createCalibratedLengthTextLines(() => ['1.5 mm'])(
      lengthData(0.15, 'mm'), targetId
    )).toEqual(['1.5 mm']);
  });

  it('preserves native display when there is no spatial DICOM region', () => {
    getCalibration.mockReturnValue(null);
    const original = ['2.45 cm'];
    expect(createCalibratedLengthTextLines(() => original)(
      lengthData(2.45, 'cm'), targetId
    )).toBe(original);
  });

  it('never changes native text on volume or unknown targets', () => {
    const original = ['3.7 mm'];
    expect(createCalibratedLengthTextLines(() => original)(
      lengthData(), 'volumeId:some-volume'
    )).toBe(original);
    expect(getCalibration).not.toHaveBeenCalled();
  });

  it('leaves a missing cached value unchanged', () => {
    const original = ['Pending'];
    expect(createCalibratedLengthTextLines(() => original)(
      { cachedStats: {}, handles: {} }, targetId
    )).toBe(original);
    expect(getCalibration).not.toHaveBeenCalled();
  });
});
