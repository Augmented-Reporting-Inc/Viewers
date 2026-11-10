import { boundEFQuizEvidencePoints, isViewerQuizCompositeReviewCurrent, resolveViewerQuizCompositeResult, resolveViewerQuizLVSimpsonForStudy, getViewerQuizCompositeStatus } from './viewerQuizCompositeResults';

describe('viewer quiz composite result evidence', () => {
  it('rejects missing required Simpson slots', () => {
    expect(resolveViewerQuizCompositeResult('lvSimpsonEF', [
      { uid: 'one', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
    ])).toBeNull();
  });

  it('rejects duplicate Simpson slots instead of silently choosing the last annotation', () => {
    expect(resolveViewerQuizCompositeResult('lvSimpsonEF', [
      { uid: 'one', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
      { uid: 'two', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
      { uid: 'three', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ES' },
      { uid: 'four', measurementKind: 'lvSimpsonSlot', slot: 'A2C_ED' },
      { uid: 'five', measurementKind: 'lvSimpsonSlot', slot: 'A2C_ES' },
    ])).toBeNull();
  });

  it('rejects a biplane LA volume without both source contours', () => {
    expect(resolveViewerQuizCompositeResult('laVolumeBiplane', [
      { uid: 'one', measurementKind: 'laVolumeSlot', slot: 'A4C' },
    ])).toBeNull();
  });

  it('rejects anonymous source contours that cannot be audited', () => {
    expect(resolveViewerQuizCompositeResult('laVolumeBiplane', [
      { measurementKind: 'laVolumeSlot', slot: 'A4C' },
      { uid: 'two', measurementKind: 'laVolumeSlot', slot: 'A2C' },
    ])).toBeNull();
  });

  it('does not interpret an arbitrary measurement as a composite', () => {
    expect(resolveViewerQuizCompositeResult('lvSimpsonEF', [
      { uid: 'one', measurementKind: 'length', value: 60 },
    ])).toBeNull();
  });
});


describe('live composite preview uses the gold-capture validation contract', () => {
  const rv = (slot: string, areaMM2: number, frameNumber: number) => ({
    uid: slot, measurementKind: 'echoAreaSlot',
    toolName: 'SplineROI', echoArea: { slot },
    points: [[0, 0, 0], [30, 0, 0], [30, 30, 0], [0, 30, 0]],
    measurements: { area: areaMM2, areaUnit: 'mm²' },
    referenceStudyUID: 'study', referenceSeriesUID: 'series',
    SOPInstanceUID: 'sop', referencedImageId: 'wadors:studies/study/series/series/instances/sop/frames/' + frameNumber,
    frameNumber,
  });
  it('shows a calibrated RV FAC live result before it is captured as gold', () => {
    const status = getViewerQuizCompositeStatus('rvFAC', [
      rv('RV_ED', 3000, 14), rv('RV_ES', 1800, 17),
    ]);
    expect(status.complete).toBe(true);
    expect(status.value).toBeCloseTo(40);
    expect(status.unit).toBe('%');
  });
  it('explains missing calibration rather than showing an unverified number', () => {
    const es = rv('RV_ES', 1800, 17);
    es.measurements.area = 0;
    const status = getViewerQuizCompositeStatus('rvFAC', [rv('RV_ED', 3000, 14), es]);
    expect(status.complete).toBe(false);
    expect(status.value).toBeNull();
    expect(status.message).toMatch(/calibrated/i);
  });
  it('does not invent LA volume from incomplete apical sources', () => {
    const status = getViewerQuizCompositeStatus('laVolumeBiplane', [
      { uid: 'a4c', measurementKind: 'laVolumeSlot', slot: 'A4C' },
    ]);
    expect(status.complete).toBe(false);
    expect(status.value).toBeNull();
  });
});

describe('LV EF progress versus quiz capture precision', () => {
  it('accepts a capture when both values round to the same reviewed hundredth', () => {
    expect(isViewerQuizCompositeReviewCurrent(53.234, 53.232)).toBe(true);
    expect(isViewerQuizCompositeReviewCurrent(53.2, 53.2)).toBe(true);
  });

  it('requires another review when the EF changes by a visible hundredth', () => {
    expect(isViewerQuizCompositeReviewCurrent(53.234, 53.237)).toBe(false);
    expect(isViewerQuizCompositeReviewCurrent(53.2, 54.2)).toBe(false);
  });

  it('does not treat absent or nonfinite values as a reviewed EF', () => {
    expect(isViewerQuizCompositeReviewCurrent(undefined, 53)).toBe(false);
    expect(isViewerQuizCompositeReviewCurrent(NaN, 53)).toBe(false);
    expect(isViewerQuizCompositeReviewCurrent(53, Infinity)).toBe(false);
  });
});

function makeEFSlot(studyId: string, slot: string, halfWidth: number, height: number) {
  const points = [
    [-halfWidth, 0, 0],
    [-halfWidth * 1.1, height * 0.2, 0],
    [-halfWidth, height * 0.4, 0],
    [-halfWidth * 0.8, height * 0.65, 0],
    [-halfWidth * 0.45, height * 0.85, 0],
    [0, height, 0],
    [halfWidth * 0.45, height * 0.85, 0],
    [halfWidth * 0.8, height * 0.65, 0],
    [halfWidth, height * 0.4, 0],
    [halfWidth * 1.1, height * 0.2, 0],
    [halfWidth, 0, 0],
  ];
  return {
    uid: `${studyId}-${slot}`,
    toolName: 'SplineROI',
    referenceStudyUID: studyId,
    referencedImageId: `wadors:study/${studyId}/${slot}`,
    measurementKind: 'lvSimpsonSlot',
    // Synthetic coordinates are already in mm: provide the same explicit
    // calibrated geometry contract required of real DICOM-derived EF slots.
    // No patient data or fabricated clinical calibration is involved.
    lvSimpson: {
      measurementKind: 'lvSimpsonSlot',
      slot,
      contourSource: 'freehandDerived',
      axisPointIndex: 5,
      contourPoints: points.map(point => [...point]),
      originalContourPoints: points.map(point => [...point]),
      calibratedContourPoints: points.map(point => [...point]),
      calibratedLongAxisLengthMM: height,
      longAxisLengthMM: height,
    },
    lvSimpsonControlPoints: points.map(point => [...point]),
    points,
  };
}

function makeCompleteStudyEF(studyId: string, widthScale = 1) {
  return [
    makeEFSlot(studyId, 'A4C_ED', 17 * widthScale, 60),
    makeEFSlot(studyId, 'A4C_ES', 11 * widthScale, 54),
    makeEFSlot(studyId, 'A2C_ED', 15 * widthScale, 60),
    makeEFSlot(studyId, 'A2C_ES', 9 * widthScale, 54),
  ];
}

describe('study-scoped educator/learner EF parity', () => {
  it('rejects four complete slots when one lacks verified physical calibration', () => {
    const measurements = makeCompleteStudyEF('study-a');
    measurements[0].lvSimpson = {
      ...measurements[0].lvSimpson,
      calibratedContourPoints: null,
      calibratedLongAxisLengthMM: null,
    };
    expect(resolveViewerQuizLVSimpsonForStudy('study-a', measurements)).toBeNull();
  });

  it('returns matching computed and quiz values from the same source contours', () => {
    const snapshot = resolveViewerQuizLVSimpsonForStudy('study-a', makeCompleteStudyEF('study-a'));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.result.status).toBe('complete');
    expect(snapshot!.composite.unit).toBe('%');
    expect(snapshot!.composite.components).toHaveLength(4);
    expect(isViewerQuizCompositeReviewCurrent(
      snapshot!.result.values!.ejectionFraction,
      snapshot!.composite.value
    )).toBe(true);
  });

  it('isolates the requested study even if another complete study is in the viewer snapshot', () => {
    const combined = [
      ...makeCompleteStudyEF('study-a'),
      ...makeCompleteStudyEF('study-b', 1.3),
    ];
    const a = resolveViewerQuizLVSimpsonForStudy('study-a', combined);
    const b = resolveViewerQuizLVSimpsonForStudy('study-b', combined);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.composite.components.every(c => c.target.studyInstanceUID === 'study-a')).toBe(true);
    expect(b!.composite.components.every(c => c.target.studyInstanceUID === 'study-b')).toBe(true);
    expect(resolveViewerQuizLVSimpsonForStudy('unknown-study', combined)).toBeNull();
  });

  it('captures multiframe EF target frames from referenced images even when annotation frame defaults to 1', () => {
    const measurements = makeCompleteStudyEF('study-a');
    const frames = [4, 8, 14, 19];
    for (let index = 0; index < measurements.length; index++) {
      const frame = frames[index];
      measurements[index].frameNumber = 1; // stale legacy default
      measurements[index].metadata = { frameNumber: 1 };
      measurements[index].referencedImageId =
        `wadors:/orthanc/dicom-web/studies/study-a/series/series-a/instances/sop-${index}/frames/${frame}`;
    }
    const captured = resolveViewerQuizLVSimpsonForStudy('study-a', measurements);
    expect(captured).not.toBeNull();
    expect(captured!.composite.components.map(c => c.target.frameNumber)).toEqual(frames);
    expect(captured!.composite.components.map(c => c.slot)).toEqual([
      'A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES',
    ]);
  });

  it('preserves legitimate EF frame 1 and falls back when no frame is encoded in the image reference', () => {
    const measurements = makeCompleteStudyEF('study-a');
    measurements.forEach((measurement, index) => {
      measurement.frameNumber = index + 1;
      measurement.metadata = { frameNumber: index + 1 };
      if (index === 0) {
        measurement.referencedImageId =
          'wadors:/orthanc/dicom-web/studies/study-a/series/series-a/instances/sop-0/frames/1';
      }
    });
    const captured = resolveViewerQuizLVSimpsonForStudy('study-a', measurements);
    expect(captured).not.toBeNull();
    expect(captured!.composite.components.map(c => c.target.frameNumber)).toEqual([1, 2, 3, 4]);
  });

  it('bounds a 5,587-vertex EF contour for FormAPI without editing its clinical source or EF calculation', () => {
    const measurements = makeCompleteStudyEF('study-a');
    const original = Array.from({ length: 5587 }, (_, index) => {
      // A closed physical-coordinate ellipse with its final point matching the first.
      const angle = 2 * Math.PI * index / 5586;
      return [80 + 20 * Math.cos(angle), 100 + 30 * Math.sin(angle), 0];
    });
    original[original.length - 1] = [...original[0]];
    measurements[0].points = original;
    const before = resolveViewerQuizLVSimpsonForStudy('study-a', measurements);
    expect(before).not.toBeNull();
    const captured = before!.composite.components;
    expect(captured.map(component => component.slot)).toEqual([
      'A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES',
    ]);
    expect(captured[0].points).toHaveLength(4096);
    expect(captured[0].points.length).toBeLessThanOrEqual(5000);
    expect(captured[0].points[0]).toEqual(original[0]);
    expect(captured[0].points[captured[0].points.length - 1]).toEqual(original[original.length - 1]);
    expect(measurements[0].points).toBe(original);
    expect(measurements[0].points).toHaveLength(5587);
    expect(before!.composite.value).toBeCloseTo(before!.result.values!.ejectionFraction, 10);
    // A polygon's area/centroid controls contour-overlap and position grading.
    const area = (points: number[][]) => Math.abs(points.reduce((total, point, index) => {
      const next = points[(index + 1) % points.length];
      return total + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2);
    expect(Math.abs(area(captured[0].points) - area(original)) / area(original))
      .toBeLessThan(0.001);
    expect(boundEFQuizEvidencePoints(original)).toEqual(captured[0].points);
    expect(boundEFQuizEvidencePoints(original.slice(0, 4096))).toHaveLength(4096);
  });

  it('normalizes identical educator and learner EF evidence deterministically', () => {
    const first = Array.from({ length: 6001 }, (_, index) => [
      10 + 4 * Math.cos(2 * Math.PI * index / 6000),
      20 + 7 * Math.sin(2 * Math.PI * index / 6000),
      0,
    ]);
    first[first.length - 1] = [...first[0]];
    const gold = boundEFQuizEvidencePoints(first);
    const learner = boundEFQuizEvidencePoints(first.map(point => [...point]));
    expect(gold).toHaveLength(4096);
    expect(gold).toEqual(learner);
    expect(gold.every(point => point.length === 3 && point.every(Number.isFinite))).toBe(true);
    expect(gold[0]).toEqual(gold[gold.length - 1]);
  });

  it('rejects an incomplete or ambiguous EF for both gold authoring and learner answers', () => {
    const measurements = makeCompleteStudyEF('study-a');
    expect(resolveViewerQuizLVSimpsonForStudy('study-a', measurements.slice(0, 3))).toBeNull();
    expect(resolveViewerQuizLVSimpsonForStudy('study-a', [
      ...measurements,
      { ...measurements[0], uid: 'duplicate-slot' },
    ])).toBeNull();
  });
});
