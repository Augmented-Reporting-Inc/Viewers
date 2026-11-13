import {
  calculateRAAreaFromMeasurements,
  calculateRVFACFromMeasurements,
  getCalibratedEchoAreaCM2,
  getEchoAreaSlot,
  buildClinicalRVFACReportFieldUpdates,
} from './echoAreaMeasurements';

function area(label: string, value: number, unit = 'mm²', series = 'cine-1', study = 'study-1') {
  return {
    toolName: 'PlanarFreehandROI',
    label,
    measurementKind: 'echoAreaSlot',
    echoArea: { slot: label === 'RVEDA' || label === 'RV end-diastolic area' ? 'RV_ED' : label === 'RVESA' || label === 'RV end-systolic area' ? 'RV_ES' : 'RA_ES' },
    points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
    referenceStudyUID: study,
    referenceSeriesUID: series,
    uid: label,
    data: { imageId: { area: value, areaUnit: unit } },
  };
}

describe('echo chamber areas', () => {
  it('parses coded and displayed RA/RV area labels', () => {
    expect(getEchoAreaSlot(area('RA area (end-systole)', 1800))).toBe('RA_ES');
    expect(getEchoAreaSlot(area('RV end-diastolic area', 2400))).toBe('RV_ED');
    expect(getEchoAreaSlot(area('RVESA', 1200))).toBe('RV_ES');
  });

  it('reads only physical calibrated ROI areas', () => {
    expect(getCalibratedEchoAreaCM2(area('RAa', 1800))).toBe(18);
    expect(getCalibratedEchoAreaCM2(area('RAa', 18, 'cm2'))).toBe(18);
    expect(getCalibratedEchoAreaCM2(area('RAa', 18, 'px²'))).toBeNull();
    expect(getCalibratedEchoAreaCM2({ ...area('RAa', 1800), toolName: 'Length' })).toBeNull();
    expect(getCalibratedEchoAreaCM2({ ...area('RAa', 1800), points: [] })).toBeNull();
    expect(calculateRAAreaFromMeasurements([{
      ...area('RAa', 1800), echoArea: undefined, measurementKind: undefined,
    }])).toBeNull();
  });

  it('accepts the authoritative nested Cornerstone SplineROI area only with physical units', () => {
    const snapshot = {
      ...area('RVEDA', 0),
      toolName: 'SplineROI',
      data: {
        cachedStats: { 'imageId:dicom-frame': { area: 3000, areaUnit: 'mm²' } },
      },
    };
    expect(getCalibratedEchoAreaCM2(snapshot)).toBe(30);
    expect(getCalibratedEchoAreaCM2({
      ...snapshot, data: { cachedStats: {
        'imageId:dicom-frame': { area: 3000, areaUnit: 'px²' },
      } },
    })).toBeNull();
    expect(getCalibratedEchoAreaCM2({
      ...snapshot, data: { cachedStats: {
        first: { area: 3000, areaUnit: 'mm²' },
        second: { area: 2000, areaUnit: 'mm²' },
      } },
    })).toBeNull();
  });

  it('provides RA area and rejects duplicate contours', () => {
    const ra = area('RAa', 1600);
    expect(calculateRAAreaFromMeasurements([ra])?.values?.areaCM2).toBe(16);
    expect(calculateRAAreaFromMeasurements([ra, { ...ra, uid: 'other' }])?.status)
      .toBe('invalid');
    expect(calculateRAAreaFromMeasurements([area('RAa', 16, 'px²')])?.status)
      .toBe('incomplete');
  });

  it('calculates RV FAC from the same cine and refuses cross-series pairing', () => {
    const ed = area('RVEDA', 3000);
    const es = area('RVESA', 1800);
    const good = calculateRVFACFromMeasurements([ed, es]);
    expect(good?.status).toBe('complete');
    expect(good?.values?.edaCM2).toBe(30);
    expect(good?.values?.esaCM2).toBe(18);
    expect(good?.values?.facPercent).toBe(40);
    expect(calculateRVFACFromMeasurements([ed, { ...es, referenceSeriesUID: 'cine-2' }])?.status)
      .toBe('invalid'); // Cross-series requires explicit distinct SOP identifiers.
    expect(calculateRVFACFromMeasurements([
      { ...ed, SOPInstanceUID: 'sop-ed', frameNumber: 14 },
      { ...es, referenceSeriesUID: 'cine-2', SOPInstanceUID: 'sop-es', frameNumber: 14 },
    ])?.status).toBe('complete');
    expect(calculateRVFACFromMeasurements([ed, { ...es, referenceStudyUID: 'study-2' }])?.status)
      .toBe('invalid');
    expect(calculateRVFACFromMeasurements([
      { ...ed, SOPInstanceUID: 'sop', frameNumber: 14 },
      { ...es, SOPInstanceUID: 'sop', frameNumber: 14 },
    ])?.status).toBe('invalid');
    expect(calculateRVFACFromMeasurements([
      { ...ed, SOPInstanceUID: 'sop', frameNumber: 0 },
      { ...es, SOPInstanceUID: 'sop', frameNumber: 0 },
    ])?.status).toBe('invalid');
    expect(calculateRVFACFromMeasurements([ed])?.status).toBe('incomplete');
    expect(calculateRVFACFromMeasurements([ed, area('RVESA', 3400)])?.status)
      .toBe('invalid');
  });

  it('trusts referenced DICOM frames over a stale default frame number', () => {
    const ed = {
      ...area('RVEDA', 3000), SOPInstanceUID: 'cine-sop', frameNumber: 1,
      referencedImageId: 'wadors:/studies/study-1/series/cine-1/instances/cine-sop/frames/14',
    };
    const es = {
      ...area('RVESA', 1800), SOPInstanceUID: 'cine-sop', frameNumber: 1,
      referencedImageId: 'wadors:/studies/study-1/series/cine-1/instances/cine-sop/frames/17',
    };
    const result = calculateRVFACFromMeasurements([ed, es]);
    expect(result?.status).toBe('complete');
    expect(result?.edEvidence?.frameNumber).toBe(14);
    expect(result?.esEvidence?.frameNumber).toBe(17);
    expect(calculateRVFACFromMeasurements([
      ed, { ...es, referencedImageId: ed.referencedImageId, frameNumber: 17 },
    ])?.status).toBe('invalid');
  });

  it('maps only complete RV FAC calculations to structured report fields', () => {
    const rv = calculateRVFACFromMeasurements([area('RVEDA', 3000), area('RVESA', 1800)]);
    expect(buildClinicalRVFACReportFieldUpdates(rv)).toEqual({
      RVEDA: '30.0', RVEDAUOM: 'cm2',
      RVESA: '18.0', RVESAUOM: 'cm2',
      RVFAC: '40.0', RVFACUOM: '%',
    });
    expect(buildClinicalRVFACReportFieldUpdates(calculateRVFACFromMeasurements([area('RVEDA', 3000)])))
      .toEqual({});
  });

});
