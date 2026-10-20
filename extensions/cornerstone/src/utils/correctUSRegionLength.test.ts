import { metaData } from '@cornerstonejs/core';
import {
  getUSRegionLengthCalibration,
  getUSRegionLengthCalibrationForTarget,
} from './correctUSRegionLength';

// jest.mock calls below are hoisted above these imports by babel-jest.
/**
 * @cornerstonejs/core 3.x publishes only `import` / `node` / `types` export
 * conditions (no `main`, `require`, `default` or `browser`). Under Jest's
 * jsdom environment none of those conditions match, so the real package
 * cannot be resolved ("Cannot find module '@cornerstonejs/core'"). These are
 * isolated unit tests that only need metaData.get, so a virtual mock is used
 * rather than changing the monorepo's Jest resolution or package versions.
 */
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: jest.fn() } }), { virtual: true });

const getMetadata = metaData.get as jest.Mock;

const region = (overrides = {}) => ({
  regionDataType: 1,
  physicalUnitsXDirection: 3,
  physicalUnitsYDirection: 3,
  regionLocationMinX0: 0,
  regionLocationMinY0: 0,
  regionLocationMaxX1: 799,
  regionLocationMaxY1: 599,
  physicalDeltaX: 0.01,
  physicalDeltaY: 0.01,
  ...overrides,
});

const frameImageId = frame => `wadors:https://pacs/studies/1/series/2/instances/3/frames/${frame}`;

describe('getUSRegionLengthCalibration (Cornerstone metadata adapter)', () => {
  beforeEach(() => getMetadata.mockReset());

  it('reads regions and image plane for the exact imageId and returns mm', () => {
    getMetadata.mockImplementation((type, imageId) => {
      if (type === 'calibrationModule' && imageId === frameImageId(2)) {
        return {
          sequenceOfUltrasoundRegions: [region({ physicalDeltaX: 0.02, physicalDeltaY: 0.02 })],
        };
      }
      if (type === 'calibrationModule') {
        return { sequenceOfUltrasoundRegions: [region()] };
      }
      if (type === 'imagePlaneModule') {
        return { rowPixelSpacing: 1, columnPixelSpacing: 1 };
      }
    });

    const points = [
      [0, 0, 0],
      [100, 0, 0],
    ];
    expect(getUSRegionLengthCalibration(frameImageId(2), points)).toMatchObject({
      lengthMm: 20,
      unit: 'mm',
    });
    expect(getUSRegionLengthCalibration(frameImageId(1), points)).toMatchObject({ lengthMm: 10 });
  });

  it('uses the target imageId (frame) rather than the referenced imageId', () => {
    getMetadata.mockImplementation((type, imageId) =>
      type === 'calibrationModule' && imageId === frameImageId(5)
        ? { sequenceOfUltrasoundRegions: [region()] }
        : undefined
    );
    const data = {
      handles: {
        points: [
          [0, 0, 0],
          [10, 0, 0],
        ],
      },
    };
    expect(
      getUSRegionLengthCalibrationForTarget(`imageId:${frameImageId(5)}`, data, frameImageId(1))
        ?.lengthMm
    ).toBeCloseTo(1, 12);
    expect(getUSRegionLengthCalibrationForTarget('volumeId:v', data, frameImageId(5))).toBeNull();
  });

  it('returns null without US regions, imageId or handles', () => {
    getMetadata.mockReturnValue(undefined);
    expect(
      getUSRegionLengthCalibration('img', [
        [0, 0, 0],
        [1, 0, 0],
      ])
    ).toBeNull();
    expect(
      getUSRegionLengthCalibration(undefined, [
        [0, 0, 0],
        [1, 0, 0],
      ])
    ).toBeNull();

    getMetadata.mockReturnValue({ sequenceOfUltrasoundRegions: [region()] });
    expect(getUSRegionLengthCalibration('img', [])).toBeNull();
  });

  it('degrades to native behaviour if metadata lookup throws', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getMetadata.mockImplementation(() => {
      throw new Error('provider failure');
    });
    expect(
      getUSRegionLengthCalibration('img', [
        [0, 0, 0],
        [1, 0, 0],
      ])
    ).toBeNull();
    warn.mockRestore();
  });
});
