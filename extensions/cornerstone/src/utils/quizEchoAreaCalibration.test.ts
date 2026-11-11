import { calculateCalibratedEchoAreaCM2, getSavedQuizEchoAreaDisplayInfo, getQuizCompositeContourViewportLines } from './quizEchoAreaCalibration';

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
