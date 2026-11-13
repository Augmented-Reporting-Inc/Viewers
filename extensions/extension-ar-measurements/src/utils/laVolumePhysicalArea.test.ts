import { getVerifiedLAVolumeContourAreaCM2 } from './laVolume';

describe('restored learner LA contour physical area display', () => {
  const points = [
    [-10, 0, 0], [-10, 15, 0], [-7, 40, 0], [0, 60, 0],
    [7, 40, 0], [10, 15, 0], [10, 0, 0],
  ];
  const restored = (slot: 'A4C' | 'A2C') => ({
    measurementKind: 'laVolumeSlot',
    points,
    laVolume: {
      measurementKind: 'laVolumeSlot', slot,
      contourPoints: points,
      baseLeftPoint: [-10, 0, 0],
      baseRightPoint: [10, 0, 0],
      superiorPoint: [0, 60, 0],
      longAxisLengthMM: 60,
    },
  });
  it.each(['A4C', 'A2C'] as const)(
    'recovers the saved calibrated %s area without a generic ROI area cache',
    slot => {
      const value = getVerifiedLAVolumeContourAreaCM2(restored(slot));
      expect(value).not.toBeNull();
      expect(value).toBeGreaterThan(0);
    }
  );
  it('does not treat an unknown area unit or uncalibrated contour as physical area', () => {
    expect(getVerifiedLAVolumeContourAreaCM2({
      ...restored('A4C'), laVolume: { slot: 'A4C', contourPoints: points },
    })).toBeNull();
    expect(getVerifiedLAVolumeContourAreaCM2({
      ...restored('A4C'), measurementKind: 'genericROI',
    })).toBeNull();
  });
});
