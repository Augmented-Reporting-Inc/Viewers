import { calculateCalibratedEchoAreaCM2, getSavedQuizEchoAreaDisplayInfo, getQuizCompositeContourViewportLines, getQuizCompositeGoldContourSlotMetadata, getVerifiedEFGoldContourViewportLines } from './quizEchoAreaCalibration';

describe('DICOM-calibrated quiz echo area', () => {
  it('calculates physical area in cm² from already calibrated millimetres', () => {
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0, 0], [20, 0, 0], [20, 15, 0], [0, 15, 0],
    ])).toBeCloseTo(3, 8);
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0, 0], [20, 0, 0], [20, 15, 0], [0, 15, 0], [0, 0, 0],
    ])).toBeCloseTo(3, 8);
  });
  it('rejects unmeasurable and non-finite contours', () => {
    expect(calculateCalibratedEchoAreaCM2([])).toBeNull();
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0], [1, 1], [2, 2],
    ])).toBeNull();
    expect(calculateCalibratedEchoAreaCM2([
      [0, 0], [Infinity, 0], [0, 1],
    ])).toBeNull();
  });
});


describe('saved echo quiz area display units', () => {
  it('preserves calibrated cm² values and unit metadata without relabeling them as mm²', () => {
    expect(getSavedQuizEchoAreaDisplayInfo(31.26, 'cm2')).toEqual({
      value: 31.26, areaUnit: 'cm²', linearUnit: 'cm',
    });
    expect(getSavedQuizEchoAreaDisplayInfo(19.31, 'cm²')).toEqual({
      value: 19.31, areaUnit: 'cm²', linearUnit: 'cm',
    });
  });
  it('preserves actual mm² values without converting or relabeling them', () => {
    expect(getSavedQuizEchoAreaDisplayInfo(3126, 'mm²')).toEqual({
      value: 3126, areaUnit: 'mm²', linearUnit: 'mm',
    });
  });
  it('rejects pixel areas, missing units, and invalid areas', () => {
    expect(getSavedQuizEchoAreaDisplayInfo(31.26, 'px²')).toBeNull();
    expect(getSavedQuizEchoAreaDisplayInfo(31.26, '')).toBeNull();
    expect(getSavedQuizEchoAreaDisplayInfo(null, 'cm2')).toBeNull();
    expect(getSavedQuizEchoAreaDisplayInfo(-1, 'cm2')).toBeNull();
  });
});

describe('quiz contour viewport area labels', () => {
  const rv = { echoArea: { slot: 'RV_ED' }, cachedStats: { source: { area: 19.3, areaUnit: 'mm²' } } };
  const la = { laVolume: { slot: 'A4C' }, cachedStats: { source: { area: 31.3, areaUnit: 'mm²' } } };

  it('uses the validated RV and LA phase areas rather than native ROI mm² text', () => {
    expect(getQuizCompositeContourViewportLines(rv, 19.31)).toEqual(['RVEDA: 19.31 cm²']);
    expect(getQuizCompositeContourViewportLines(la, 31.26)).toEqual(['LA A4C: 31.26 cm²']);
    expect(getQuizCompositeContourViewportLines({ echoArea: { slot: 'RV_ES' } }, 15.5))
      .toEqual(['RVESA: 15.50 cm²']);
    expect(getQuizCompositeContourViewportLines({ echoArea: { slot: 'RA_ES' } }, 14.8))
      .toEqual(['RA area: 14.80 cm²']);
    expect(getQuizCompositeContourViewportLines({ laVolume: { slot: 'A2C' } }, 4.48))
      .toEqual(['LA A2C: 4.48 cm²']);
  });

  it('fails closed when a quiz contour lacks a verified physical area', () => {
    expect(getQuizCompositeContourViewportLines(rv, null))
      .toEqual(['RVEDA: calibrated area unavailable']);
    expect(getQuizCompositeContourViewportLines(la, NaN))
      .toEqual(['LA A4C: calibrated area unavailable']);
  });

  it('accepts explicit calibrated legacy text for a restored quiz contour', () => {
    expect(getQuizCompositeContourViewportLines({
      laVolume: { slot: 'A4C' },
      arSavedMeasurementDisplayText: ['31.26 cm²'],
    }, null)).toEqual(['31.26 cm²']);
    expect(getQuizCompositeContourViewportLines({
      echoArea: { slot: 'RV_ED' },
      arSavedMeasurementDisplayText: ['19.31 cm2'],
    }, undefined)).toEqual(['19.31 cm²']);
  });

  it('never intercepts clinical or unrelated contours or trusts pixel-only text', () => {
    expect(getQuizCompositeContourViewportLines({ cachedStats: {} }, 31.26)).toBeNull();
    expect(getQuizCompositeContourViewportLines({ spectralDoppler: { slot: 'A4C' } }, 3)).toBeNull();
    expect(getQuizCompositeContourViewportLines({
      echoArea: { slot: 'RV_ED' }, arSavedMeasurementDisplayText: ['19.3 mm²'],
    }, undefined)).toEqual(['RVEDA: calibrated area unavailable']);
  });
});

describe('composite gold comparison source contours retain quiz identity', () => {
  it('restores RV, RA and LA contour slots without inferring kinds from labels', () => {
    expect(getQuizCompositeGoldContourSlotMetadata('rvFAC', 'RV_ED')).toEqual({
      echoArea: { measurementKind: 'echoAreaSlot', slot: 'RV_ED', phase: 'ED', view: 'A4C' },
    });
    expect(getQuizCompositeGoldContourSlotMetadata('rvFAC', 'RV_ES')).toEqual({
      echoArea: { measurementKind: 'echoAreaSlot', slot: 'RV_ES', phase: 'ES', view: 'A4C' },
    });
    expect(getQuizCompositeGoldContourSlotMetadata('raArea', 'RA_ES')).toEqual({
      echoArea: { measurementKind: 'echoAreaSlot', slot: 'RA_ES', phase: 'ES', view: 'A4C' },
    });
    expect(getQuizCompositeGoldContourSlotMetadata('laVolumeBiplane', 'A4C')).toEqual({
      laVolume: { measurementKind: 'laVolumeSlot', slot: 'A4C', view: 'A4C', phase: 'ES' },
    });
    expect(getQuizCompositeGoldContourSlotMetadata('laVolumeBiplaneDisks', 'A2C')).toEqual({
      laVolume: { measurementKind: 'laVolumeSlot', slot: 'A2C', view: 'A2C', phase: 'ES' },
    });
    expect(getQuizCompositeGoldContourSlotMetadata('ivcCollapsibility', 'IVC_EXP'))
      .toEqual({});
    expect(getQuizCompositeGoldContourSlotMetadata('rvFAC', 'A4C')).toEqual({});
    expect(getQuizCompositeGoldContourSlotMetadata('genericROI', 'RV_ED')).toEqual({});
  });

  it('renders a saved gold composite source from its verified cm² text, not native ROI mm²', () => {
    const rv = {
      ...getQuizCompositeGoldContourSlotMetadata('rvFAC', 'RV_ED'),
      arSavedMeasurementDisplayText: ['19.31 cm²'],
    };
    const la = {
      ...getQuizCompositeGoldContourSlotMetadata('laVolumeBiplane', 'A4C'),
      arSavedMeasurementDisplayText: ['31.26 cm²'],
    };
    expect(getQuizCompositeContourViewportLines(rv, null)).toEqual(['19.31 cm²']);
    expect(getQuizCompositeContourViewportLines(la, null)).toEqual(['31.26 cm²']);
    expect(getQuizCompositeContourViewportLines(rv, 19.31)).toEqual(['RVEDA: 19.31 cm²']);
    expect(getQuizCompositeContourViewportLines(la, 31.26)).toEqual(['LA A4C: 31.26 cm²']);
  });
});


describe('EF educator gold contour viewport text', () => {
  it('uses the exact verified gold area and saved axis rather than native ROI stats', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A4C_ED', areaCM2: 27.516,
      axisMM: 83.247,
    })).toEqual([
      'Gold A4C ED LV contour area: 27.52 cm²',
      'Gold LV long axis: 83.25 mm',
    ]);
  });
  it('calls out independently calibrated source areas that disagree with the saved gold', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A2C_ES',
      areaCM2: 14.2, sourceAreaCM2: 15.1, axisMM: 75,
    })).toEqual([
      'Gold A2C ES LV contour area: 14.20 cm²',
      'Source contour area: 15.10 cm² (differs from saved gold; verify)',
      'Gold LV long axis: 75.00 mm',
    ]);
  });
  it('shows the verified area without inventing a missing axis', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A2C_ES', areaCM2: 14.2,
    })).toEqual(['Gold A2C ES LV contour area: 14.20 cm²']);
  });
  it('does not override ordinary contours or unverified areas', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      slot: 'A4C_ED', areaCM2: 27.5,
    })).toBeNull();
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A4C_ED', areaCM2: null,
    })).toBeNull();
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A4C_ED', areaCM2: 'abc',
    })).toBeNull();
  });
});
