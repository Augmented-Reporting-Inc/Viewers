import {
  calculateLAVolume,
  calculateLABiplaneDisks,
  buildCseLAVolumeReportFieldUpdatesFromResult,
  LA_VOLUME_AREA_LENGTH_METHOD,
  LA_VOLUME_DISKS_METHOD,
} from './laVolume';
import { resolveViewerQuizCompositeResult } from './viewerQuizCompositeResults';

function laContour(slot: 'A4C' | 'A2C', widthMM: number, axisMM = 80) {
  const half = widthMM / 2;
  const contour = [
    [-half, 0, 0],
    [-half, axisMM * 0.25, 0],
    [-half, axisMM * 0.5, 0],
    [-half, axisMM * 0.75, 0],
    [-half, axisMM, 0],
    [half, axisMM, 0],
    [half, axisMM * 0.75, 0],
    [half, axisMM * 0.5, 0],
    [half, axisMM * 0.25, 0],
    [half, 0, 0],
  ];
  return {
    uid: 'la-' + slot,
    measurementKind: 'laVolumeSlot',
    toolName: 'SplineROI',
    referenceStudyUID: 'study-A',
    referenceSeriesUID: 'cine-' + slot,
    points: contour,
    laVolume: {
      measurementKind: 'laVolumeSlot',
      slot,
      phase: 'ES',
      view: slot,
      baseLeftPoint: [-half, 0, 0],
      baseRightPoint: [half, 0, 0],
      superiorPoint: [0, axisMM, 0],
      longAxisLengthMM: axisMM,
    },
  };
}

describe('versioned LA biplane methods', () => {
  const contours = [laContour('A4C', 20), laContour('A2C', 16)];

  it('computes 20-disk Simpson result without overwriting the area-length calculation', () => {
    const legacy = calculateLAVolume(contours, 1.75)!;
    const disks = calculateLABiplaneDisks(contours, 1.75)!;

    expect(legacy.status).toBe('complete');
    expect(disks.status).toBe('complete');
    expect(legacy.methodId).toBe(LA_VOLUME_AREA_LENGTH_METHOD);
    expect(disks.methodId).toBe(LA_VOLUME_DISKS_METHOD);

    expect(legacy.values.volumeML).toBeCloseTo(21.76, 2);
    expect(disks.values.volumeML).toBeCloseTo((Math.PI / 4) * 20 * 16 * 80 / 1000, 3);
    expect(disks.values.lavi).toBeCloseTo(disks.values.volumeML / 1.75, 5);
    expect(disks.values.diskCount).toBe(20);
    expect(disks.values.laLengthSource).toMatch(/longer/);
    expect(disks.values.volumeML).not.toBeCloseTo(legacy.values.volumeML, 2);
  });

  it('uses the longer axis for Simpson disks with two slightly different lengths', () => {
    const result = calculateLABiplaneDisks([
      laContour('A4C', 20, 80),
      laContour('A2C', 16, 82),
    ])!;
    expect(result.status).toBe('complete');
    expect(result.values.laLengthMM).toBe(82);
    expect(result.values.diskHeightMM).toBeCloseTo(82 / 20);
  });

  it('keeps the existing area-length clinical adapter method-specific', () => {
    const legacy = calculateLAVolume(contours)!;
    const disk = calculateLABiplaneDisks(contours)!;
    expect(buildCseLAVolumeReportFieldUpdatesFromResult(legacy).LAV).toBeDefined();
    expect(buildCseLAVolumeReportFieldUpdatesFromResult(disk)).toEqual({});
  });

  it('rejects duplicate, missing, and foreshortened contour pairs in disks mode', () => {
    expect(calculateLABiplaneDisks([contours[0]])?.status).toBe('incomplete');
    expect(calculateLABiplaneDisks([...contours, { ...contours[0], uid: 'dupe' }])?.status)
      .toBe('invalid');
    expect(calculateLABiplaneDisks([
      laContour('A4C', 20, 80),
      laContour('A2C', 16, 73),
    ])?.status).toBe('invalid');
  });

  it('captures separate education composite kinds with explicit method provenance', () => {
    const legacy = resolveViewerQuizCompositeResult('laVolumeBiplane', contours);
    const disks = resolveViewerQuizCompositeResult('laVolumeBiplaneDisks', contours);
    expect(legacy?.measurementKind).toBe('laVolumeBiplane');
    expect(legacy?.methodId).toBe(LA_VOLUME_AREA_LENGTH_METHOD);
    expect(disks?.measurementKind).toBe('laVolumeBiplaneDisks');
    expect(disks?.methodId).toBe(LA_VOLUME_DISKS_METHOD);
    expect(disks?.components).toHaveLength(2);
    expect(disks?.value).toBeCloseTo((Math.PI / 4) * 20 * 16 * 80 / 1000, 3);

    // Passing a precomputed value from the other LA method cannot cross-score.
    expect(resolveViewerQuizCompositeResult(
      'laVolumeBiplaneDisks', contours, calculateLAVolume(contours)
    )).toBeNull();
    expect(resolveViewerQuizCompositeResult(
      'laVolumeBiplane', contours, calculateLABiplaneDisks(contours)
    )).toBeNull();
  });

  it('cannot use uncalibrated, degenerate, or unrelated contours', () => {
    expect(calculateLABiplaneDisks([
      { ...contours[0], laVolume: { ...contours[0].laVolume, longAxisLengthMM: 0 } },
      contours[1],
    ])?.status).not.toBe('complete');
    expect(calculateLABiplaneDisks([
      { ...contours[0], points: [[0, 0, 0]] },
      contours[1],
    ])?.status).not.toBe('complete');
    expect(calculateLABiplaneDisks([{
      ...contours[0], measurementKind: 'lvSimpsonSlot',
    }, contours[1]])?.status).not.toBe('complete');
  });
});
