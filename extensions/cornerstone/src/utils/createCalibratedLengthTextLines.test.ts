import { metaData, utilities as csUtilities } from '@cornerstonejs/core';
import { createCalibratedLengthTextLines } from './createCalibratedLengthTextLines';
import Length from './measurementServiceMappings/Length';

// jest.mock calls below are hoisted above these imports by babel-jest.
/**
 * Live-versus-completed consistency for the native Length tool.
 *
 * Virtual mocks: @cornerstonejs/core and @cornerstonejs/tools 3.x expose only
 * ESM `import`/`node` export conditions, which Jest's jsdom environment cannot
 * resolve, and @ohif/core pulls in the whole platform. These tests need only
 * metaData.get and roundNumber; the real OHIF roundNumber (identical algorithm
 * to Cornerstone's) is used so text formatting is exercised for real.
 */
jest.mock(
  '@cornerstonejs/core',
  () => {
    const roundNumber = jest.requireActual(
      '../../../../platform/core/src/utils/roundNumber'
    ).default;
    return { metaData: { get: jest.fn() }, utilities: { roundNumber } };
  },
  { virtual: true }
);
jest.mock(
  '@ohif/core',
  () => ({
    utils: {
      roundNumber: jest.requireActual('../../../../platform/core/src/utils/roundNumber').default,
    },
  }),
  { virtual: true }
);
jest.mock('./measurementServiceMappings/utils/getIsLocked', () => ({ getIsLocked: () => false }));
jest.mock('./measurementServiceMappings/utils/getIsVisible', () => ({ getIsVisible: () => true }));
jest.mock('./measurementServiceMappings/utils/getSOPInstanceAttributes', () => ({
  __esModule: true,
  default: () => ({
    SOPInstanceUID: 'sop-1',
    SeriesInstanceUID: 'series-1',
    StudyInstanceUID: 'study-1',
    frameNumber: 1,
  }),
}));

const getMetadata = metaData.get as jest.Mock;

const imageId = 'wadors:https://pacs/studies/1/series/2/instances/3/frames/1';
const targetId = `imageId:${imageId}`;

const usRegion = (overrides = {}) => ({
  regionDataType: 1,
  physicalUnitsXDirection: 3,
  physicalUnitsYDirection: 3,
  regionLocationMinX0: 0,
  regionLocationMinY0: 0,
  regionLocationMaxX1: 799,
  regionLocationMaxY1: 599,
  physicalDeltaX: 0.0327,
  physicalDeltaY: 0.0327,
  ...overrides,
});

function withImage({ regions, imagePlane }) {
  getMetadata.mockImplementation(type => {
    if (type === 'calibrationModule') {
      return regions ? { sequenceOfUltrasoundRegions: regions } : undefined;
    }
    if (type === 'imagePlaneModule') {
      return imagePlane;
    }
    return undefined;
  });
}

/** Native Cornerstone default text formatter, as in LengthTool.js. */
function nativeDefaultGetTextLines(data, id) {
  const { length, unit } = data.cachedStats[id];
  if (length === undefined || length === null || isNaN(length)) {
    return;
  }
  return [`${csUtilities.roundNumber(length)} ${unit}`];
}

/** Single-region echo: OHIF gives PixelSpacing = |delta| x 10 mm. */
const singleRegionPlane = { rowPixelSpacing: 0.327, columnPixelSpacing: 0.327 };

function mohawkLikeAnnotation() {
  // 229.327 px horizontally => 7.499 cm => 74.99 mm
  const p1 = [100 * 0.327, 300 * 0.327, 0];
  const p2 = [(100 + 229.327) * 0.327, 300 * 0.327, 0];
  const worldMm = p2[0] - p1[0];
  return {
    annotationUID: 'ann-1',
    metadata: {
      toolName: 'Length',
      referencedImageId: imageId,
      FrameOfReferenceUID: 'for-1',
    },
    data: {
      label: '',
      handles: { points: [p1, p2], textBox: {} },
      // What Cornerstone's LengthTool stores: worldMm / (1 / deltaX), "cm US Region".
      cachedStats: { [targetId]: { length: worldMm * 0.0327, unit: 'cm US Region' } },
    },
  };
}

const displaySetService = {
  getDisplaySetForSOPInstanceUID: () => displaySet,
  getDisplaySetsForSeries: () => [displaySet],
};
const displaySet = {
  displaySetInstanceUID: 'ds-1',
  SeriesNumber: 4,
  isMultiFrame: false,
  instances: [{ SOPInstanceUID: 'sop-1', InstanceNumber: 1 }],
};

const toMeasurement = annotation =>
  Length.toMeasurement({ annotation }, displaySetService, {}, () => 'value_type::polyline', {});

const deepFreeze = obj => {
  Object.values(obj).forEach(v => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(obj);
};

describe('Shared native Length US calibration — live vs completed', () => {
  beforeEach(() => getMetadata.mockReset());

  it('Mohawk case: live text and completed record are both 74.99 mm, native was ~2.45 cm', () => {
    withImage({ regions: [usRegion()], imagePlane: singleRegionPlane });
    const annotation = mohawkLikeAnnotation();

    // Native preview is the double-calibrated value that users reported.
    expect(nativeDefaultGetTextLines(annotation.data, targetId)).toEqual(['2.45 cm US Region']);

    const live = createCalibratedLengthTextLines(nativeDefaultGetTextLines)(
      annotation.data,
      targetId
    );
    const measurement = toMeasurement(annotation);

    expect(live).toEqual(['75.0 mm']);
    expect(measurement.data[targetId].unit).toBe('mm');
    expect(measurement.data[targetId].length).toBeCloseTo(74.99, 2);
    // Same string the measurement panel shows.
    expect(measurement.displayText.primary).toEqual(live);
    expect(measurement.getReport().values).toEqual(
      expect.arrayContaining([measurement.data[targetId].length, 'mm'])
    );
  });

  it('iUSCAN-like small caliper: live and completed agree to the same rounding', () => {
    // High-frequency linear probe, multiple regions => no PixelSpacing (world = px).
    withImage({
      regions: [
        usRegion({ regionLocationMaxX1: 399, physicalDeltaX: 0.0065, physicalDeltaY: 0.0065 }),
        usRegion({ regionLocationMinX0: 400, physicalDeltaX: 0.012, physicalDeltaY: 0.012 }),
      ],
      imagePlane: { rowPixelSpacing: null, columnPixelSpacing: null },
    });
    const annotation = mohawkLikeAnnotation();
    annotation.data.handles.points = [
      [120, 200, 0],
      [120, 247.3, 0],
    ];
    annotation.data.cachedStats[targetId] = { length: 47.3 * 0.0065, unit: 'cm US Region' };

    const live = createCalibratedLengthTextLines(nativeDefaultGetTextLines)(
      annotation.data,
      targetId
    );
    const measurement = toMeasurement(annotation);

    expect(measurement.data[targetId].length).toBeCloseTo(47.3 * 0.065, 10); // 3.0745 mm
    expect(live).toEqual(['3.07 mm']);
    expect(measurement.displayText.primary).toEqual(live);
  });

  it('never mutates the live annotation (frozen input still maps)', () => {
    withImage({ regions: [usRegion()], imagePlane: singleRegionPlane });
    const annotation = deepFreeze(mohawkLikeAnnotation());
    const before = JSON.stringify(annotation);

    createCalibratedLengthTextLines(nativeDefaultGetTextLines)(annotation.data, targetId);
    const measurement = toMeasurement(annotation);

    expect(JSON.stringify(annotation)).toBe(before);
    expect(measurement.data).not.toBe(annotation.data.cachedStats);
    expect(measurement.data[targetId]).not.toBe(annotation.data.cachedStats[targetId]);
  });

  it('is stable across repeated completion/modification mappings (no double calibration)', () => {
    withImage({ regions: [usRegion()], imagePlane: singleRegionPlane });
    const annotation = mohawkLikeAnnotation();
    const first = toMeasurement(annotation).data[targetId].length;
    const second = toMeasurement(annotation).data[targetId].length;
    const third = toMeasurement(annotation).data[targetId].length;
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('ordinary (non-US) Length: native text and native mm value pass through untouched', () => {
    withImage({
      regions: undefined,
      imagePlane: { rowPixelSpacing: 0.7, columnPixelSpacing: 0.7 },
    });
    const annotation = mohawkLikeAnnotation();
    annotation.data.cachedStats[targetId] = { length: 42.123, unit: 'mm' };

    const nativeLines = ['42.1 mm'];
    const native = jest.fn(() => nativeLines);
    expect(createCalibratedLengthTextLines(native)(annotation.data, targetId)).toBe(nativeLines);

    const measurement = toMeasurement(annotation);
    expect(measurement.data[targetId]).toEqual({ length: 42.123, unit: 'mm' });
    expect(measurement.displayText.primary).toEqual(['42.1 mm']);
  });

  it('record stats are copies: mutating measurement.data (as iUSCAN does) never reaches the live annotation', () => {
    // Covers both the calibrated (US) and pass-through (non-US) branches.
    for (const regions of [[usRegion()], undefined]) {
      withImage({ regions, imagePlane: singleRegionPlane });
      const annotation = mohawkLikeAnnotation();
      const liveStats = annotation.data.cachedStats[targetId];
      const snapshot = { ...liveStats };

      const measurement = toMeasurement(annotation);
      expect(measurement.data[targetId]).not.toBe(liveStats);

      Object.assign(measurement.data[targetId], { length: -1, unit: 'mm', lengthUnit: 'mm' });
      expect(annotation.data.cachedStats[targetId]).toBe(liveStats);
      expect(liveStats).toEqual(snapshot);
    }
  });

  it('unsupported US units keep the native value AND native unit (no mm relabelling)', () => {
    withImage({
      regions: [usRegion({ physicalUnitsXDirection: 4, physicalUnitsYDirection: 7 })],
      imagePlane: singleRegionPlane,
    });
    const annotation = mohawkLikeAnnotation();
    annotation.data.cachedStats[targetId] = { length: 12.5, unit: 'px' };

    const nativeLines = ['12.5 px'];
    expect(createCalibratedLengthTextLines(() => nativeLines)(annotation.data, targetId)).toBe(
      nativeLines
    );
    expect(toMeasurement(annotation).data[targetId]).toEqual({ length: 12.5, unit: 'px' });
  });

  it('never changes text for volume targets', () => {
    withImage({ regions: [usRegion()], imagePlane: singleRegionPlane });
    const data = {
      ...mohawkLikeAnnotation().data,
      cachedStats: { 'volumeId:v': { length: 3, unit: 'mm' } },
    };
    const nativeLines = ['3.00 mm'];
    expect(createCalibratedLengthTextLines(() => nativeLines)(data, 'volumeId:v')).toBe(
      nativeLines
    );
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it('shows nothing extra before Cornerstone has computed stats', () => {
    withImage({ regions: [usRegion()], imagePlane: singleRegionPlane });
    const data = { ...mohawkLikeAnnotation().data, cachedStats: {} };
    const native = jest.fn(() => undefined);
    expect(createCalibratedLengthTextLines(native)(data, targetId)).toBeUndefined();
  });

  it('wrapping is idempotent and preserves the tool `this`', () => {
    const self = { marker: true };
    const native = jest.fn(function () {
      return [this === self ? 'bound' : 'unbound'];
    });
    const once = createCalibratedLengthTextLines(native);
    const twice = createCalibratedLengthTextLines(once);
    expect(twice).toBe(once);

    withImage({ regions: undefined, imagePlane: undefined });
    const data = {
      cachedStats: { [targetId]: { length: 1, unit: 'mm' } },
      handles: { points: [] },
    };
    expect(once.call(self, data, targetId)).toEqual(['bound']);
    expect(native).toHaveBeenCalledTimes(1);
  });
});
