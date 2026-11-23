import { calculateCalibratedEchoAreaCM2, getSavedQuizEchoAreaDisplayInfo, getQuizCompositeContourViewportLines, getVerifiedReleasedLAGoldViewportLines, getQuizCompositeGoldContourSlotMetadata, getVerifiedEFGoldContourViewportLines, getVerifiedEFLearnerContourViewportLines, getQuizEchoAreaSourceMetadata, registerQuizEchoAreaMeasurementSchema } from './quizEchoAreaCalibration';

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

describe('released pinned LA gold review labels', () => {
  const evidence = (slot: string, areaCM2: any, kind = 'laVolumeBiplaneDisks') => ({
    origin: 'released-pinned-quiz-gold', measurementKind: kind, slot, areaCM2,
  });
  it('shows each independently verified phase as gold cm², not native ROI area', () => {
    expect(getVerifiedReleasedLAGoldViewportLines(evidence('A4C', 19.31)))
      .toEqual(['Gold LA A4C: 19.31 cm²']);
    expect(getVerifiedReleasedLAGoldViewportLines(evidence('A2C', 12.78)))
      .toEqual(['Gold LA A2C: 12.78 cm²']);
    expect(getVerifiedReleasedLAGoldViewportLines(evidence('A4C', 22.5, 'laVolumeBiplane')))
      .toEqual(['Gold LA A4C: 22.50 cm²']);
  });
  it('fails closed when derived area is absent, bogus or comes from another workflow', () => {
    for (const area of [null, '', undefined, 0, NaN, Infinity, -7]) {
      expect(getVerifiedReleasedLAGoldViewportLines(evidence('A4C', area))).toBeNull();
    }
    expect(getVerifiedReleasedLAGoldViewportLines({
      ...evidence('A4C', 10000), origin: 'quiz-learner',
    })).toBeNull();
    expect(getVerifiedReleasedLAGoldViewportLines(evidence('RV_ED', 18.5))).toBeNull();
    expect(getVerifiedReleasedLAGoldViewportLines(evidence('A2C', 18.5, 'lvSimpsonEF')))
      .toBeNull();
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
  it('shows verified single-view volume, not area or long axis', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A4C_ED', areaCM2: 27.516,
      axisMM: 83.247, volumeML: 119.375,
    })).toEqual(['Gold A4C ED single-view LV volume: 119.38 mL']);
  });

  it('fails closed if the gold volume is absent or not physically validated', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A2C_ES', areaCM2: 14.2,
    })).toEqual(['Gold A2C ES single-view LV volume: unavailable']);
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A2C_ES', areaCM2: 14.2, volumeML: null,
    })).toEqual(['Gold A2C ES single-view LV volume: unavailable']);
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A2C_ES', areaCM2: 14.2, volumeML: 0,
    })).toEqual(['Gold A2C ES single-view LV volume: unavailable']);
  });

  it('does not present a saved gold volume when the calibrated source area disagrees', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'A2C_ES', areaCM2: 14.2,
      sourceAreaCM2: 15.1, volumeML: 37.45,
    })).toEqual([
      'Gold A2C ES single-view LV volume: unavailable (source calibration differs from saved gold; verify)',
    ]);
  });

  it('does not override ordinary or unrelated contours', () => {
    expect(getVerifiedEFGoldContourViewportLines({
      slot: 'A4C_ED', areaCM2: 27.5, volumeML: 100,
    })).toBeNull();
    expect(getVerifiedEFGoldContourViewportLines({
      origin: 'quiz-gold', slot: 'RV_ED', areaCM2: 27.5, volumeML: 100,
    })).toBeNull();
  });
});

describe('EF submitted learner comparison text', () => {
  it('shows the verified saved mL value and never native ROI area', () => {
    expect(getVerifiedEFLearnerContourViewportLines({
      origin: 'quiz-learner', slot: 'A4C_ED', volumeML: 86.44,
      cachedStats: { area: 21.13, areaUnit: 'cm²' },
    })).toEqual(['Your A4C ED single-view LV volume: 86.44 mL']);
    expect(getVerifiedEFLearnerContourViewportLines({
      origin: 'quiz-learner', slot: 'A2C_ES', volumeML: 60.38,
    })).toEqual(['Your A2C ES single-view LV volume: 60.38 mL']);
  });
  it('does not invent volume or override other annotations', () => {
    expect(getVerifiedEFLearnerContourViewportLines({
      origin: 'quiz-learner', slot: 'A4C_ES', volumeML: null,
    })).toEqual(['Your A4C ES single-view LV volume: unavailable']);
    expect(getVerifiedEFLearnerContourViewportLines({
      origin: 'quiz-gold', slot: 'A4C_ES', volumeML: 53.88,
    })).toBeNull();
    expect(getVerifiedEFLearnerContourViewportLines({
      origin: 'quiz-learner', slot: 'RV_ES', volumeML: 53.88,
    })).toBeNull();
  });
});

describe('native guided Echo area MeasurementService schema contract', () => {
  it('registers the exact top-level fields emitted by RV/RA SplineROI mapping', () => {
    const schemaKeys: string[] = [];
    registerQuizEchoAreaMeasurementSchema({
      addMeasurementSchemaKeys: keys => schemaKeys.push(...keys),
    });
    for (const slot of ['RV_ED', 'RV_ES', 'RA_ES']) {
      const mapped = getQuizEchoAreaSourceMetadata({
        echoArea: { slot, phase: slot === 'RV_ED' ? 'ED' : 'ES' },
      });
      expect(mapped.measurementKind).toBe('echoAreaSlot');
      expect(Object.keys(mapped).sort()).toEqual([...schemaKeys].sort());
      expect(mapped.echoArea.slot).toBe(slot);
    }
  });

  it('does not invent schema-dependent source identity for unrelated splines', () => {
    for (const data of [{}, { echoArea: { slot: 'A4C_ED' } }, { echoArea: { slot: '' } }]) {
      expect(getQuizEchoAreaSourceMetadata(data)).toEqual({});
    }
  });
});
