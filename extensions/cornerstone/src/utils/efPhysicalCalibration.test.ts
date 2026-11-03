import { calibrateUSContourPoints } from './usRegionLengthCalibration';
import { buildLVSimpsonContourFromHingeApex } from './lvSimpsonContour';
import { calculateLVSimpson } from '../../../extension-ar-measurements/src/utils/lvSimpson';
import { getSavedVolumeContourMetadata, getSavedLVSimpsonControlPoints, isSavedLVSimpsonImageMatch, resolveSavedLVSimpsonHydrationImage } from './savedVolumeContourMetadata';

const imagePlane = {
  imagePositionPatient: [0, 0, 0],
  rowCosines: [1, 0, 0],
  columnCosines: [0, 1, 0],
  columnPixelSpacing: 1,
  rowPixelSpacing: 1,
};
const regions = [{
  minX: 0, minY: 0, maxX: 300, maxY: 300,
  column: 0.3, row: 0.3,
}];

function makeMeasurement(slot, halfWidth, height, calibrated = true) {
  const contour = buildLVSimpsonContourFromHingeApex({
    baseLeftPoint: [150 - halfWidth, 100, 0],
    baseRightPoint: [150 + halfWidth, 100, 0],
    apexPoint: [150, 100 + height, 0],
  });
  const physicalPoints = calibrated
    ? calibrateUSContourPoints({ points: contour.points, imagePlane, regions })
    : null;
  const base = physicalPoints?.[0];
  const right = physicalPoints?.[physicalPoints.length - 1];
  const apex = physicalPoints?.[contour.axisPointIndex];
  const midpoint = base?.map((v, i) => (v + right[i]) / 2);
  const calibratedLongAxisLengthMM = midpoint && apex
    ? Math.hypot(...apex.map((v, i) => v - midpoint[i])) : null;
  return {
    measurementKind: 'lvSimpsonSlot',
    slot,
    points: contour.points,
    lvSimpson: {
      measurementKind: 'lvSimpsonSlot',
      slot,
      contourSource: 'hingeApexGenerated',
      axisPointIndex: contour.axisPointIndex,
      contourPoints: contour.points,
      originalContourPoints: physicalPoints ? contour.points.map(p => [...p]) : null,
      calibratedContourPoints: physicalPoints,
      calibratedLongAxisLengthMM,
      longAxisLengthMM: calibratedLongAxisLengthMM ?? contour.longAxisLengthMM,
    },
  };
}

describe('saved LV Simpson DICOM image/frame identity', () => {
  const image = (sop: string, frame: number) =>
    `wadors:/orthanc/dicom-web/studies/study/series/series/instances/${sop}/frames/${frame}`;
  const saved = {
    SOPInstanceUID: 'sop-a',
    frameNumber: 4,
    referencedImageId: image('sop-a', 4),
    lvSimpson: { measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
  };

  test('accepts loader/proxy differences but never a different cine frame or SOP', () => {
    expect(isSavedLVSimpsonImageMatch(saved, image('sop-a', 4))).toBe(true);
    expect(isSavedLVSimpsonImageMatch(saved, image('sop-a', 8))).toBe(false);
    expect(isSavedLVSimpsonImageMatch(saved, image('sop-b', 4))).toBe(false);
    expect(isSavedLVSimpsonImageMatch(saved, image('sop-b', 14))).toBe(false);
    expect(isSavedLVSimpsonImageMatch(saved,
      'dicomweb:https://other-host/dicom-web/studies/study/series/series/instances/sop-a/frames/4'
    )).toBe(true);
  });

  test('validates all four slots across two instances and four frames', () => {
    const slots = [
      ['A4C_ED', 'sop-a', 4],
      ['A4C_ES', 'sop-a', 8],
      ['A2C_ED', 'sop-b', 14],
      ['A2C_ES', 'sop-b', 19],
    ] as const;
    const contours = slots.map(([slot, sop, frameNumber]) => ({
      SOPInstanceUID: sop,
      frameNumber,
      referencedImageId: image(sop, frameNumber),
      lvSimpson: { measurementKind: 'lvSimpsonSlot', slot },
    }));
    contours.forEach((contour, i) =>
      contours.forEach((other, j) =>
        expect(isSavedLVSimpsonImageMatch(contour, other.referencedImageId)).toBe(i === j)
      )
    );
  });

  test('rejects missing, ambiguous, or contradictory saved references', () => {
    expect(isSavedLVSimpsonImageMatch(saved, '')).toBe(false);
    expect(isSavedLVSimpsonImageMatch(saved, 'imageId:unresolved')).toBe(false);
    expect(isSavedLVSimpsonImageMatch({ ...saved, frameNumber: 8 }, image('sop-a', 4))).toBe(false);
    expect(isSavedLVSimpsonImageMatch({ ...saved, SOPInstanceUID: 'sop-b' }, image('sop-a', 4))).toBe(false);
    expect(isSavedLVSimpsonImageMatch({ ...saved, referencedImageId: '' }, image('sop-a', 4))).toBe(false);
    expect(isSavedLVSimpsonImageMatch({
      referencedImageId: image('sop-a', 4), toolName: 'Length',
    }, image('sop-b', 14))).toBe(true); // non-EF workflows are unchanged
  });
});

describe('LV Simpson hydration target regression', () => {
  const frameImage = (sop: string, frame: number) =>
    `wadors:/orthanc/dicom-web/studies/study/series/series/instances/${sop}/frames/${frame}`;
  const cases = [
    { slot: 'A4C_ED', sop: 'sop-a', frame: 4 },
    { slot: 'A4C_ES', sop: 'sop-a', frame: 8 },
    { slot: 'A2C_ED', sop: 'sop-b', frame: 14 },
    { slot: 'A2C_ES', sop: 'sop-b', frame: 19 },
  ];

  test('a complete four-contour session resolves only each original frame', () => {
    const saved = cases.map(({ slot, sop, frame }) => ({
      annotationId: slot,
      SOPInstanceUID: sop,
      frameNumber: frame,
      referencedImageId: frameImage(sop, frame),
      lvSimpson: {
        measurementKind: 'lvSimpsonSlot',
        slot,
        originalContourPoints: Array.from({ length: 8 }, (_, index) => [index, index * 2, 0]),
        calibratedContourPoints: Array.from({ length: 8 }, (_, index) => [index * 0.1, index * 0.2, 0]),
        calibratedLongAxisLengthMM: 82.5,
      },
    }));
    for (const contour of saved) {
      const original = JSON.parse(JSON.stringify(contour));
      const valid = resolveSavedLVSimpsonHydrationImage({
        annotation: contour,
        currentImageId: contour.referencedImageId,
      });
      expect(valid).toEqual({ ok: true, referencedImageId: contour.referencedImageId });
      const restored = getSavedVolumeContourMetadata(contour).lvSimpson;
      expect(restored.originalContourPoints).toEqual(contour.lvSimpson.originalContourPoints);
      expect(restored.calibratedContourPoints).toEqual(contour.lvSimpson.calibratedContourPoints);
      expect(restored.calibratedLongAxisLengthMM).toBe(82.5);
      expect(contour).toEqual(original);
      for (const other of saved) {
        if (other.annotationId === contour.annotationId) continue;
        expect(resolveSavedLVSimpsonHydrationImage({
          annotation: contour,
          referencedImageIdOverride: other.referencedImageId,
          currentImageId: other.referencedImageId,
        })).toEqual({
          ok: false,
          referencedImageId: '',
          reason: 'saved-reference-mismatch',
        });
        expect(resolveSavedLVSimpsonHydrationImage({
          annotation: contour,
          currentImageId: other.referencedImageId,
        })).toEqual({
          ok: false,
          referencedImageId: '',
          reason: 'viewport-frame-mismatch',
        });
      }
    }
  });

  test('rejects ambiguous EF target and retains non-EF hydration behavior', () => {
    const saved = {
      referencedImageId: frameImage('sop-a', 4),
      SOPInstanceUID: 'sop-a',
      frameNumber: 4,
      lvSimpson: { measurementKind: 'lvSimpsonSlot' },
    };
    expect(resolveSavedLVSimpsonHydrationImage({
      annotation: saved,
      currentImageId: 'unknown:image',
    }).ok).toBe(false);
    expect(resolveSavedLVSimpsonHydrationImage({
      annotation: { ...saved, referencedImageId: '' },
      currentImageId: frameImage('sop-a', 4),
    }).ok).toBe(false);
    expect(resolveSavedLVSimpsonHydrationImage({
      annotation: { toolName: 'Length', referencedImageId: frameImage('sop-a', 4) },
      referencedImageIdOverride: frameImage('sop-b', 19),
      currentImageId: frameImage('sop-a', 4),
    })).toEqual({ ok: true, referencedImageId: frameImage('sop-b', 19) });
  });
});

describe('LV EF saved annotation metadata', () => {
  test('rehydrates captured sparse EF handles, not 21x sampled display spline', () => {
    const originalContourPoints = Array.from({ length: 70 }, (_, index) =>
      [index / 10, 3 + index / 20, 0]
    );
    const displayedPolyline = Array.from({ length: 1471 }, (_, index) =>
      [index / 210, 3 + index / 420, 0]
    );
    const saved = {
      toolName: 'SplineROI',
      points: displayedPolyline,
      lvSimpson: { measurementKind: 'lvSimpsonSlot', slot: 'A2C_ES', originalContourPoints },
    };
    const handles = getSavedLVSimpsonControlPoints(saved);
    expect(handles).toHaveLength(70);
    expect(handles).toEqual(originalContourPoints);
    expect(handles).not.toBe(originalContourPoints);
    handles[0][0] += 1;
    expect(saved.lvSimpson.originalContourPoints[0][0]).toBe(0);
    expect(saved.points).toHaveLength(1471);
  });

  test('does not invent calibrated editable handles for old or invalid saved EF', () => {
    const incomplete = {
      lvSimpson: { measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
      points: Array.from({ length: 1260 }, (_, index) => [index, 0, 0]),
    };
    expect(getSavedLVSimpsonControlPoints(incomplete)).toBeNull();
    expect(getSavedLVSimpsonControlPoints({
      ...incomplete,
      lvSimpson: { ...incomplete.lvSimpson, originalContourPoints: [[0, 1, NaN]] },
    })).toBeNull();
    expect(getSavedLVSimpsonControlPoints({
      toolName: 'SplineROI',
      originalContourPoints: Array.from({ length: 10 }, () => [1, 2, 0]),
    })).toBeNull();
  });

  test('restores the exact calibrated Simpson slot metadata without generating new calibration', () => {
    const geometry = {
      measurementKind: 'lvSimpsonSlot',
      slot: 'A4C_ED',
      axisPointIndex: 3,
      calibratedLongAxisLengthMM: 84.5,
      originalContourPoints: [[0, 0, 0], [1, 2, 0]],
    };
    const restored = getSavedVolumeContourMetadata({
      measurementKind: 'lvSimpsonSlot',
      lvSimpson: geometry,
    });
    expect(restored.measurementKind).toBe('lvSimpsonSlot');
    expect(restored.lvSimpson).toEqual(geometry);
    expect(restored.lvSimpson).not.toBe(geometry);
  });

  test('does not mistake a generic spline or uncalibrated inferred slot for Simpson', () => {
    expect(getSavedVolumeContourMetadata({ toolName: 'SplineROI', slot: 'A4C_ED' })).toEqual({});
    expect(getSavedVolumeContourMetadata({ lvSimpson: { slot: 'A4C_ED' } })).toEqual({});
  });

  test('does not change other volume slot metadata', () => {
    const laVolume = { measurementKind: 'laVolumeSlot', slot: 'A4C', longAxisLengthMM: 60 };
    expect(getSavedVolumeContourMetadata({ laVolume })).toEqual({
      measurementKind: 'laVolumeSlot',
      laVolume,
    });
  });
});

describe('LV EF calibrated geometry', () => {
  // Independent analytic reference: a half-ellipsoid of length L and
  // transverse radii r4 and r2 has volume 2*pi*r4*r2*L/3.
  // Generated from geometry, not from the implementation's disk widths.
  test('biplane 20-disk volumes agree with analytic half-ellipsoid reference', () => {
    const makeHalfEllipsoid = (slot, radius, longAxisLengthMM) => {
      const samples = 100;
      const left = [];
      const right = [];
      for (let index = 0; index <= samples; index += 1) {
        const axisPosition = longAxisLengthMM * index / samples;
        const width = radius * Math.sqrt(Math.max(0, 1 -
          (axisPosition / longAxisLengthMM) ** 2));
        left.push([-width, axisPosition, 0]);
      }
      for (let index = samples - 1; index >= 0; index -= 1) {
        const axisPosition = longAxisLengthMM * index / samples;
        const width = radius * Math.sqrt(Math.max(0, 1 -
          (axisPosition / longAxisLengthMM) ** 2));
        right.push([width, axisPosition, 0]);
      }
      const points = [...left, ...right];
      return {
        measurementKind: 'lvSimpsonSlot',
        slot,
        points,
        lvSimpsonControlPoints: points.map(p => [...p]),
        lvSimpson: {
          measurementKind: 'lvSimpsonSlot',
          slot,
          contourSource: 'freehandDerived',
          axisPointIndex: samples,
          originalContourPoints: points.map(p => [...p]),
          contourPoints: points.map(p => [...p]),
          calibratedContourPoints: points.map(p => [...p]),
          calibratedLongAxisLengthMM: longAxisLengthMM,
          longAxisLengthMM,
        },
      };
    };
    const edAxis = 90, esAxis = 70;
    const records = [
      makeHalfEllipsoid('A4C_ED', 30, edAxis),
      makeHalfEllipsoid('A2C_ED', 25, edAxis),
      makeHalfEllipsoid('A4C_ES', 20, esAxis),
      makeHalfEllipsoid('A2C_ES', 18, esAxis),
    ];
    const expectedEDV = (2 * Math.PI * 30 * 25 * edAxis / 3) / 1000;
    const expectedESV = (2 * Math.PI * 20 * 18 * esAxis / 3) / 1000;
    const result = calculateLVSimpson(records);
    expect(result?.status).toBe('complete');
    expect(result?.values?.edvML).toBeCloseTo(expectedEDV, 0);
    expect(result?.values?.esvML).toBeCloseTo(expectedESV, 0);
    expect(result?.values?.ejectionFraction).toBeCloseTo(
      (expectedEDV - expectedESV) / expectedEDV * 100, 0
    );
  });

  test('live handle edits invalidate calibrated snapshots even if rendered points are stale', () => {
    const measurements = [
      makeMeasurement('A4C_ED', 70, 190),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    for (const measurement of measurements) {
      measurement.lvSimpsonControlPoints = measurement.points.map(p => [...p]);
    }
    expect(calculateLVSimpson(measurements)?.status).toBe('complete');
    measurements[0].lvSimpsonControlPoints[3][0] += 3;
    expect(calculateLVSimpson(measurements)?.status).not.toBe('complete');
    measurements[0].lvSimpsonControlPoints = [];
    expect(calculateLVSimpson(measurements)?.status).not.toBe('complete');
  });

  test('transforms pixel-world coordinates to mm including anisotropic spacing', () => {
    const points = [[100, 100, 0], [105, 100, 0], [110, 100, 0],
      [110, 105, 0], [110, 110, 0], [100, 110, 0]];
    const converted = calibrateUSContourPoints({
      points, imagePlane,
      regions: [{ ...regions[0], column: 0.4, row: 0.2 }],
    });
    expect(converted[1]).toEqual([2, 0, 0]);
    expect(converted[4]).toEqual([4, 2, 0]);
  });

  test('rejects missing, out-of-region, and conflicting calibration', () => {
    const points = Array.from({ length: 6 }, (_, i) => [100 + i, 100, 0]);
    expect(calibrateUSContourPoints({ points, imagePlane, regions: [] })).toBeNull();
    expect(calibrateUSContourPoints({ points, imagePlane, regions: [
      { ...regions[0], maxX: 102 },
    ] })).toBeNull();
    expect(calibrateUSContourPoints({ points, imagePlane, regions: [
      regions[0], { ...regions[0], row: 0.6 },
    ] })).toBeNull();
  });

  test('calculates sane volumes only from calibrated four-slot contours', () => {
    const contours = [
      makeMeasurement('A4C_ED', 70, 190),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    const result = calculateLVSimpson(contours);
    expect(result?.status).toBe('complete');
    expect(result?.values?.edvML).toBeGreaterThan(5);
    expect(result?.values?.edvML).toBeLessThan(1000);
    expect(result?.values?.ejectionFraction).toBeGreaterThan(0);
    expect(result?.values?.ejectionFraction).toBeLessThan(100);
  });

  test('rejects uncalibrated and subsequently edited contours', () => {
    const contours = [
      makeMeasurement('A4C_ED', 70, 190, false),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    expect(calculateLVSimpson(contours)?.status).not.toBe('complete');
    contours[0] = makeMeasurement('A4C_ED', 70, 190);
    // The rendered polyline can legitimately differ from the original
    // calibration within its interpolation tolerance. Production EF checks
    // the live editable SplineROI handles, not the display approximation.
    contours[0].lvSimpsonControlPoints = contours[0].points.map(point => [...point]);
    contours[0].lvSimpsonControlPoints[3][0] += 2;
    expect(calculateLVSimpson(contours)?.status).not.toBe('complete');
  });
  test('accepts a densely resampled unchanged contour', () => {
    const records = [
      makeMeasurement('A4C_ED', 70, 190),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    for (const record of records) {
      const original = record.points;
      const dense = [];
      for (let i = 0; i < original.length - 1; i++) {
        for (let j = 0; j < 21; j++) {
          const t = j / 21;
          dense.push(original[i].map((value, axis) =>
            value + (original[i + 1][axis] - value) * t
          ));
        }
      }
      dense.push(original[original.length - 1]);
      record.points = dense;
    }
    const result = calculateLVSimpson(records);
    expect(result?.status).toBe('complete');
  });

  test('accepts closed interpolated SplineROI loops with rotated starting points', () => {
    const records = [
      makeMeasurement('A4C_ED', 70, 190),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    for (const record of records) {
      const original = record.points;
      const dense = [];
      for (let i = 0; i < original.length; i++) {
        const next = original[(i + 1) % original.length];
        for (let j = 0; j < 21; j++) {
          const t = j / 21;
          dense.push(original[i].map((value, axis) =>
            value + (next[axis] - value) * t
          ));
        }
      }
      const rotated = [...dense.slice(13), ...dense.slice(0, 13)];
      record.points = [...rotated, [...rotated[0]]];
    }
    expect(calculateLVSimpson(records)?.status).toBe('complete');
  });

  test('accepts unmodified control points despite rendering-only spline overshoot', () => {
    const records = [
      makeMeasurement('A4C_ED', 70, 190),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    for (const record of records) {
      const original = record.points.map(point => [...point]);
      record.lvSimpsonControlPoints = original.map(point => [...point]);
      const dense = [];
      for (let i = 0; i < original.length; i++) {
        const next = original[(i + 1) % original.length];
        for (let j = 0; j < 21; j++) {
          const fraction = j / 21;
          dense.push(original[i].map((value, axis) =>
            value + (next[axis] - value) * fraction
          ));
        }
      }
      // Simulate SplineROI's rendering-only extrapolation near start:
      // the editable handles have not moved.
      dense[2][0] += 5;
      record.points = [...dense, [...dense[0]]];
    }
    expect(calculateLVSimpson(records)?.status).toBe('complete');

    // A true edit of an editable spline handle must invalidate the
    // original DICOM calibration even if its rendered polyline is stale.
    records[0].lvSimpsonControlPoints[2][0] += 2;
    expect(calculateLVSimpson(records)?.status).not.toBe('complete');
  });

  test('rejects a materially moved spline boundary after calibration', () => {
    const records = [
      makeMeasurement('A4C_ED', 70, 190),
      makeMeasurement('A2C_ED', 65, 190),
      makeMeasurement('A4C_ES', 55, 170),
      makeMeasurement('A2C_ES', 50, 170),
    ];
    const moved = records[0].points.map(p => [...p]);
    moved[3][0] += 50;
    records[0].points = moved;
    expect(calculateLVSimpson(records)?.status).not.toBe('complete');
  });

});
