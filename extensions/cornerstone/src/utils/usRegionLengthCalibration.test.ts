import {
  computeUSRegionLength,
  getImageIdForLengthTarget,
  worldToImageIndex,
} from './usRegionLengthCalibration';

// Pure module: no Cornerstone, no mocks.

const region = (overrides = {}) => ({
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

/** Mirror of Cornerstone's stack geometry: index -> world. */
const indexToWorld = (plane, [col, row]) => {
  const origin = plane.imagePositionPatient || [0, 0, 0];
  const rc = plane.rowCosines || [1, 0, 0];
  const cc = plane.columnCosines || [0, 1, 0];
  const xs = plane.columnPixelSpacing || 1;
  const ys = plane.rowPixelSpacing || 1;
  return [0, 1, 2].map(i => origin[i] + rc[i] * col * xs + cc[i] * row * ys);
};

describe('worldToImageIndex — matches Cornerstone stack geometry', () => {
  it('inverts index->world for identity orientation and pixel world units', () => {
    expect(worldToImageIndex(null, [12.5, 40, 0])).toEqual([12.5, 40]);
  });

  it('honours origin, oblique/flipped cosines and anisotropic spacing', () => {
    const plane = {
      imagePositionPatient: [-50, 20, 7],
      rowCosines: [0, -1, 0],
      columnCosines: [1, 0, 0],
      columnPixelSpacing: 0.4,
      rowPixelSpacing: 0.25,
    };
    const [col, row] = worldToImageIndex(plane, indexToWorld(plane, [123.25, 45.5]));
    expect(col).toBeCloseTo(123.25, 9);
    expect(row).toBeCloseTo(45.5, 9);
  });

  it('treats missing / zero spacing as 1 like Cornerstone', () => {
    expect(worldToImageIndex({ columnPixelSpacing: 0, rowPixelSpacing: null }, [3, 4, 0])).toEqual([
      3, 4,
    ]);
  });

  it('rejects malformed points', () => {
    expect(worldToImageIndex(null, [1, 'x', 0])).toBeNull();
    expect(worldToImageIndex(null, undefined)).toBeNull();
  });
});

describe('computeUSRegionLength', () => {
  // OHIF imagePlaneModule for a single-region US image: spacing = |delta| x 10 mm.
  const singleRegionPlane = { columnPixelSpacing: 0.327, rowPixelSpacing: 0.327 };

  it('reproduces the Mohawk case: calibrated 74.99 mm where native previews ~2.45 cm', () => {
    const p1 = indexToWorld(singleRegionPlane, [100, 300]);
    const p2 = indexToWorld(singleRegionPlane, [100 + 229.327, 300]);

    const result = computeUSRegionLength({
      regions: [region()],
      imagePlane: singleRegionPlane,
      points: [p1, p2],
    });

    expect(result.unit).toBe('mm');
    expect(result.lengthMm).toBeCloseTo(74.99, 2);
    expect(result.lengthCm).toBeCloseTo(7.499, 3);

    // What Cornerstone's LengthTool shows: worldLength(mm) / (1 / deltaX).
    const worldMm = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const nativePreview = worldMm * 0.0327;
    expect(nativePreview).toBeCloseTo(2.45, 2);
  });

  it('is correct when world units are pixels (multi-region images get no PixelSpacing)', () => {
    const result = computeUSRegionLength({
      regions: [region()],
      imagePlane: null,
      points: [
        [10, 10, 0],
        [40, 50, 0],
      ],
    });
    expect(result.lengthCm).toBeCloseTo(50 * 0.0327, 12); // 3-4-5 triangle of 50 px
  });

  it('applies X and Y deltas separately for anisotropic regions', () => {
    const anisotropic = region({ physicalDeltaX: 0.02, physicalDeltaY: 0.05 });
    const result = computeUSRegionLength({
      regions: [anisotropic],
      imagePlane: null,
      points: [
        [100, 100, 0],
        [130, 140, 0],
      ],
    });
    expect(result.lengthCm).toBeCloseTo(Math.hypot(30 * 0.02, 40 * 0.05), 12);
    expect(result.lengthMm).toBeCloseTo(10 * Math.hypot(0.6, 2.0), 12);
  });

  it('is independent of how the image plane maps pixels to world (no double calibration)', () => {
    const anisotropic = region({ physicalDeltaX: 0.02, physicalDeltaY: 0.05 });
    const planes = [
      null,
      // OHIF puts [|dX|*10, |dY|*10] into PixelSpacing -> row/column swapped.
      { rowPixelSpacing: 0.2, columnPixelSpacing: 0.5 },
      { rowPixelSpacing: 0.5, columnPixelSpacing: 0.2 },
      {
        imagePositionPatient: [5, 5, 5],
        rowCosines: [-1, 0, 0],
        columnCosines: [0, -1, 0],
        columnPixelSpacing: 0.7,
        rowPixelSpacing: 0.3,
      },
    ];
    const lengths = planes.map(
      plane =>
        computeUSRegionLength({
          regions: [anisotropic],
          imagePlane: plane,
          points: [indexToWorld(plane || {}, [100, 100]), indexToWorld(plane || {}, [130, 140])],
        }).lengthCm
    );
    lengths.forEach(l => expect(l).toBeCloseTo(Math.hypot(0.6, 2.0), 12));
  });

  it('selects the region that contains both handles among several regions', () => {
    const regions = [
      region({ regionLocationMaxX1: 399, physicalDeltaX: 0.01, physicalDeltaY: 0.01 }),
      region({ regionLocationMinX0: 400, physicalDeltaX: 0.04, physicalDeltaY: 0.04 }),
    ];
    const result = computeUSRegionLength({
      regions,
      imagePlane: null,
      points: [
        [410, 20, 0],
        [412, 20, 0],
      ],
    });
    expect(result.regionIndex).toBe(1);
    expect(result.lengthCm).toBeCloseTo(0.08, 12);
  });

  it('rejects calipers that span two regions instead of picking one arbitrarily', () => {
    const regions = [
      region({ regionLocationMaxX1: 399, physicalDeltaX: 0.01, physicalDeltaY: 0.01 }),
      region({ regionLocationMinX0: 400, physicalDeltaX: 0.04, physicalDeltaY: 0.04 }),
    ];
    expect(
      computeUSRegionLength({
        regions,
        imagePlane: null,
        points: [
          [395, 20, 0],
          [412, 20, 0],
        ],
      })
    ).toBeNull();
  });

  it('skips a non-spatial region and uses the spatial one containing the handles', () => {
    const doppler = region({
      regionDataType: 3,
      physicalUnitsXDirection: 4,
      physicalUnitsYDirection: 7,
    });
    const result = computeUSRegionLength({
      regions: [doppler, region({ physicalDeltaX: 0.02, physicalDeltaY: 0.02 })],
      imagePlane: null,
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
    });
    expect(result.regionIndex).toBe(1);
    expect(result.lengthCm).toBeCloseTo(0.2, 12);
  });

  it('accepts nested spatial regions that agree, rejects ones that disagree', () => {
    const outer = region();
    const nestedSame = region({ regionLocationMinX0: 100, regionLocationMaxX1: 300 });
    const nestedDifferent = region({
      regionLocationMinX0: 100,
      regionLocationMaxX1: 300,
      physicalDeltaX: 0.05,
      physicalDeltaY: 0.05,
    });
    const points = [
      [150, 10, 0],
      [160, 10, 0],
    ];
    expect(
      computeUSRegionLength({ regions: [outer, nestedSame], imagePlane: null, points }).lengthCm
    ).toBeCloseTo(0.327, 12);
    expect(
      computeUSRegionLength({ regions: [outer, nestedDifferent], imagePlane: null, points })
    ).toBeNull();
  });

  describe('physical unit codes are never reinterpreted', () => {
    const points = [
      [0, 0, 0],
      [10, 0, 0],
    ];
    it.each([
      ['none (0) / none (0)', 0, 0],
      ['percent (1)', 1, 1],
      ['seconds x cm/s (4,7) — Doppler', 4, 7],
      ['seconds x cm (4,3) — M-mode', 4, 3],
      ['cm x none (3,0)', 3, 0],
      ['missing', undefined, undefined],
    ])('%s -> null (native fallback)', (_label, ux, uy) => {
      expect(
        computeUSRegionLength({
          regions: [region({ physicalUnitsXDirection: ux, physicalUnitsYDirection: uy })],
          imagePlane: null,
          points,
        })
      ).toBeNull();
    });

    it('accepts cm when metadata delivers the code as a string', () => {
      expect(
        computeUSRegionLength({
          regions: [region({ physicalUnitsXDirection: '3', physicalUnitsYDirection: '3' })],
          imagePlane: null,
          points,
        }).lengthCm
      ).toBeCloseTo(0.327, 12);
    });
  });

  it('uses |delta| for negative physical deltas', () => {
    expect(
      computeUSRegionLength({
        regions: [region({ physicalDeltaX: -0.0327, physicalDeltaY: -0.0327 })],
        imagePlane: null,
        points: [
          [0, 0, 0],
          [10, 0, 0],
        ],
      }).lengthCm
    ).toBeCloseTo(0.327, 12);
  });

  it.each([
    ['zero delta', { physicalDeltaX: 0 }],
    ['NaN delta', { physicalDeltaY: 'abc' }],
    ['unsupported region data type', { regionDataType: 0 }],
    ['missing bounds', { regionLocationMaxY1: undefined }],
  ])('rejects %s', (_label, overrides) => {
    expect(
      computeUSRegionLength({
        regions: [region(overrides)],
        imagePlane: null,
        points: [
          [0, 0, 0],
          [10, 0, 0],
        ],
      })
    ).toBeNull();
  });

  it('rejects missing regions or malformed handles', () => {
    const points = [
      [0, 0, 0],
      [10, 0, 0],
    ];
    expect(computeUSRegionLength({ regions: [], imagePlane: null, points })).toBeNull();
    expect(computeUSRegionLength({ regions: undefined, imagePlane: null, points })).toBeNull();
    expect(
      computeUSRegionLength({ regions: [region()], imagePlane: null, points: [points[0]] })
    ).toBeNull();
    expect(
      computeUSRegionLength({
        regions: [region()],
        imagePlane: null,
        points: [points[0], [NaN, 0, 0]],
      })
    ).toBeNull();
  });

  it('returns null when a handle is outside every region', () => {
    expect(
      computeUSRegionLength({
        regions: [region()],
        imagePlane: null,
        points: [
          [10, 10, 0],
          [900, 10, 0],
        ],
      })
    ).toBeNull();
  });
});

describe('getImageIdForLengthTarget — frame selection', () => {
  it('uses the frame-specific imageId from a stack target', () => {
    const imageId = 'wadors:https://x/studies/1/series/2/instances/3/frames/7';
    expect(getImageIdForLengthTarget(`imageId:${imageId}`, 'wadors:.../frames/1')).toBe(imageId);
  });

  it('never calibrates volume targets', () => {
    expect(
      getImageIdForLengthTarget('volumeId:cornerstoneStreamingImageVolume:abc', 'img')
    ).toBeNull();
  });

  it('falls back to referencedImageId only when no target id is supplied', () => {
    expect(getImageIdForLengthTarget(undefined, 'img')).toBe('img');
  });
});
