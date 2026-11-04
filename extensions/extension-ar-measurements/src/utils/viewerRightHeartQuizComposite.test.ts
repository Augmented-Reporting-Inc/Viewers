import { resolveViewerQuizCompositeResult } from './viewerQuizCompositeResults';

function contour(slot: 'RA_ES' | 'RV_ED' | 'RV_ES', areaMM2: number, frameNumber: number) {
  const label = slot === 'RA_ES' ? 'RAa' : slot === 'RV_ED' ? 'RVEDA' : 'RVESA';
  return {
    uid: 'annotation-' + slot,
    toolName: 'SplineROI',
    label,
    measurementKind: 'echoAreaSlot',
    echoArea: { slot, phase: slot === 'RV_ED' ? 'ED' : 'ES', view: 'A4C' },
    points: [[0, 0, 0], [5, 0, 0], [5, 5, 0], [0, 5, 0]],
    data: { imageId: { area: areaMM2, areaUnit: 'mm²' } },
    referenceStudyUID: 'test-study',
    referenceSeriesUID: 'cine-A4C',
    SOPInstanceUID: 'test-instance',
    frameNumber,
    referencedImageId: 'wado:test-instance?frame=' + frameNumber,
  };
}

describe('right-heart quiz composite capture', () => {
  it('captures a distinct RA area result with exact contour reference and method', () => {
    const result = resolveViewerQuizCompositeResult('raArea', [contour('RA_ES', 1700, 11)]);
    expect(result?.measurementKind).toBe('raArea');
    expect(result?.methodId).toBe('ra-area-planimetry-v1');
    expect(result?.value).toBe(17);
    expect(result?.unit).toBe('cm2');
    expect(result?.components).toHaveLength(1);
    expect(result?.components[0].slot).toBe('RA_ES');
    expect(result?.components[0].target.frameNumber).toBe(11);
  });

  it('captures RV FAC from two distinct frames of the same cine', () => {
    const result = resolveViewerQuizCompositeResult('rvFAC', [
      contour('RV_ED', 3000, 1),
      contour('RV_ES', 1800, 14),
    ]);
    expect(result?.methodId).toBe('rv-fac-planimetry-v1');
    expect(result?.value).toBeCloseTo(40);
    expect(result?.unit).toBe('%');
    expect(result?.components.map(part => part.slot)).toEqual(['RV_ED', 'RV_ES']);
  });

  it('rejects missing calibration, missing source references and duplicate slots', () => {
    const ra = contour('RA_ES', 1700, 11);
    expect(resolveViewerQuizCompositeResult('raArea', [{
      ...ra, data: { imageId: { area: 1700, areaUnit: 'px²' } },
    }])).toBeNull();
    expect(resolveViewerQuizCompositeResult('raArea', [{
      ...ra, SOPInstanceUID: '',
    }])).toBeNull();
    expect(resolveViewerQuizCompositeResult('raArea', [ra, {
      ...ra, uid: 'duplicate',
    }])).toBeNull();
  });

  it('rejects wrong phase, mixed cine, and identical RV frame', () => {
    const ed = contour('RV_ED', 3000, 1);
    const es = contour('RV_ES', 1800, 14);
    expect(resolveViewerQuizCompositeResult('rvFAC', [ed])).toBeNull();
    expect(resolveViewerQuizCompositeResult('rvFAC', [ed, {
      ...es, referenceSeriesUID: 'another-cine',
    }])).toBeNull();
    expect(resolveViewerQuizCompositeResult('rvFAC', [ed, {
      ...es, frameNumber: 1,
    }])).toBeNull();
    expect(resolveViewerQuizCompositeResult('rvFAC', [ed, {
      ...es, data: { imageId: { area: 1800, areaUnit: 'px²' } },
    }])).toBeNull();
  });
});
