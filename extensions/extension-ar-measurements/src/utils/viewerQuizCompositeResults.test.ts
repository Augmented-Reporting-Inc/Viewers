import { isViewerQuizCompositeReviewCurrent, resolveViewerQuizCompositeResult, resolveViewerQuizLVSimpsonForStudy } from './viewerQuizCompositeResults';

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

  it('rejects an incomplete or ambiguous EF for both gold authoring and learner answers', () => {
    const measurements = makeCompleteStudyEF('study-a');
    expect(resolveViewerQuizLVSimpsonForStudy('study-a', measurements.slice(0, 3))).toBeNull();
    expect(resolveViewerQuizLVSimpsonForStudy('study-a', [
      ...measurements,
      { ...measurements[0], uid: 'duplicate-slot' },
    ])).toBeNull();
  });
});
