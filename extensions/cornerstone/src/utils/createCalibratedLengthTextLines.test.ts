import { createCalibratedLengthTextLines } from './createCalibratedLengthTextLines';
import { correctUSRegionLength } from './correctUSRegionLength';

jest.mock('@cornerstonejs/core', () => ({
  utilities: {
    roundNumber: (n, decimals = 2) => Number(n.toFixed(decimals)),
  },
}));

jest.mock('./correctUSRegionLength', () => ({
  correctUSRegionLength: jest.fn(),
}));

const correctLength = correctUSRegionLength as jest.Mock;
const imageId = 'wadors:/orthanc/dicom-web/studies/1/series/2/instances/3/frames/1';
const targetId = `imageId:${imageId}`;

function lengthData(length = 2.45, unit = 'cm US Region') {
  return {
    cachedStats: { [targetId]: { length, unit } },
    handles: { points: [[0, 0, 0], [30, 40, 0]] },
  };
}

describe('Length quiz in-viewport preview calibration', () => {
  beforeEach(() => {
    correctLength.mockReset();
  });

  it('displays the same mm value as completed AR mapping for a cm region', () => {
    correctLength.mockReturnValue(7.499);
    const data = lengthData();
    const nativeGetTextLines = jest.fn(() => ['2.45 cm US Region']);
    const formatted = createCalibratedLengthTextLines(nativeGetTextLines);

    expect(formatted(data, targetId)).toEqual(['74.99 mm']);
    expect(correctLength).toHaveBeenCalledWith(2.45, imageId, { data });
    expect(nativeGetTextLines).toHaveBeenCalledWith(data, targetId);
    expect(data.cachedStats[targetId].length).toBe(2.45);
    expect(data.handles.points).toEqual([[0, 0, 0], [30, 40, 0]]);
  });

  it('displays corrected mm directly when the native measurement is mm', () => {
    correctLength.mockReturnValue(74.99);
    expect(createCalibratedLengthTextLines(() => ['24.5 mm'])(
      lengthData(24.5, 'mm'), targetId
    )).toEqual(['74.99 mm']);
  });

  it('preserves native display when no ultrasound region matches', () => {
    correctLength.mockReturnValue(2.45);
    const original = ['2.45 cm'];
    expect(createCalibratedLengthTextLines(() => original)(
      lengthData(2.45, 'cm'), targetId
    )).toBe(original);
  });

  it('does not relabel unsupported nonspatial units as millimeters', () => {
    correctLength.mockReturnValue(74.99);
    const original = ['24.5 px'];
    expect(createCalibratedLengthTextLines(() => original)(
      lengthData(24.5, 'px'), targetId
    )).toBe(original);
  });

  it('never modifies native text on volume or unknown targets', () => {
    const original = ['3.7 mm'];
    expect(createCalibratedLengthTextLines(() => original)(
      lengthData(), 'volumeId:some-volume'
    )).toBe(original);
    expect(correctLength).not.toHaveBeenCalled();
  });

  it('leaves a missing native cached value unchanged', () => {
    const original = ['Pending'];
    expect(createCalibratedLengthTextLines(() => original)(
      { cachedStats: {}, handles: {} }, targetId
    )).toBe(original);
    expect(correctLength).not.toHaveBeenCalled();
  });
});
