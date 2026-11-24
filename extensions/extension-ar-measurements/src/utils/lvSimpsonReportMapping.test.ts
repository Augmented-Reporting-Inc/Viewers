import { buildClinicalLVSimpsonReportFieldUpdates, calculateLVSimpsonSingleViewVolumeML,
  calculateLVSimpson, calculateLVSimpsonContourVolumeForMeasurement } from './lvSimpson';
import { getLVSimpsonSourceVolumes } from './echoEFSourceVolumes';

describe('clinical LV Simpson report fields', () => {
  it('maps validated EF, EDV and ESV using the existing report field contract', () => {
    expect(buildClinicalLVSimpsonReportFieldUpdates({
      status: 'complete',
      values: { edvML: 128.2, esvML: 51.3, ejectionFraction: 60.0 },
    })).toEqual({
      LVEDV: '128.2',
      LVEDVUOM: 'ml',
      LVESV: '51.3',
      LVESVUOM: 'ml',
      EFSimpsons: '60',
      EFSimpsonsUOM: '%',
    });
  });

  it('does not apply incomplete or invalid measurements', () => {
    expect(buildClinicalLVSimpsonReportFieldUpdates({
      status: 'incomplete',
      values: { edvML: 128, esvML: 51, ejectionFraction: 60 },
    })).toEqual({});
    expect(buildClinicalLVSimpsonReportFieldUpdates({
      status: 'complete',
      values: { edvML: 51, esvML: 128, ejectionFraction: -151 },
    })).toEqual({});
    expect(buildClinicalLVSimpsonReportFieldUpdates(null)).toEqual({});
  });
});

describe('verified persisted EF contour volumes', () => {
  const points = [[-20,0,0],[-40,20,0],[-20,60,0],[0,80,0],[20,60,0],[40,20,0],[20,0,0]];
  const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  const saved = slots.map(slot => ({
    annotationId: 'saved-' + slot, measurementKind: 'lvSimpsonSlot',
    lvSimpson: {
      measurementKind: 'lvSimpsonSlot', slot, axisPointIndex: 3,
      originalContourPoints: points, calibratedContourPoints: points,
      calibratedLongAxisLengthMM: 80,
    },
    // Display geometry is compacted independently of the calibrated controls.
    points: [], splineControlPoints: points,
  }));

  it('calculates all four source volumes before viewport hydration', () => {
    const volumes = getLVSimpsonSourceVolumes(saved);
    const expected = calculateLVSimpsonContourVolumeForMeasurement({
      ...saved[0], lvSimpsonControlPoints: points,
    });
    expect(expected).toBeGreaterThan(0);
    expect(volumes).toEqual(Object.fromEntries(slots.map(slot => [slot, expected])));
  });

  it('can recover legacy verified saved controls but rejects actually changed live controls', () => {
    const legacy = saved.map(({ splineControlPoints, ...source }) => source);
    expect(getLVSimpsonSourceVolumes(legacy).A4C_ED).toBeNull();
    expect(getLVSimpsonSourceVolumes(legacy, { verifiedSavedSources: true }).A4C_ED)
      .toBeGreaterThan(0);
    const edited = { ...saved[0], splineControlPoints: points.map((p, i) =>
      i === 1 ? [p[0] + 10, p[1], p[2]] : p) };
    expect(getLVSimpsonSourceVolumes([edited], { verifiedSavedSources: true }).A4C_ED).toBeNull();
  });

  it('does not run expensive slot diagnostics on normal calculation', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const input = [{ ...saved[0], lvSimpsonControlPoints: points }];
      const normal = calculateLVSimpson(input);
      expect(info).not.toHaveBeenCalled();
      expect(calculateLVSimpson(input, { diagnostic: true })).toEqual(normal);
      expect(info).toHaveBeenCalledWith('[LV EF slot validation]', expect.any(Object));
    } finally {
      info.mockRestore();
    }
  });
});

describe('independent single-view EF contour volume', () => {
  it('uses 20 calibrated circular disks and converts mm³ to mL', () => {
    const contour = {
      complete: true,
      longAxisLengthMM: 80,
      widths: Array(20).fill(20),
    };
    // A 20 mm diameter, 80 mm long cylinder: pi * 10² * 80 mm³.
    expect(calculateLVSimpsonSingleViewVolumeML(contour))
      .toBeCloseTo(Math.PI * 8, 8);
    expect(calculateLVSimpsonSingleViewVolumeML({
      ...contour, widths: Array(20).fill(10),
    })).toBeCloseTo(Math.PI * 2, 8);
  });

  it('does not present unverified, missing, or corrupt physical geometry', () => {
    const slot = { complete: true, longAxisLengthMM: 80,
      widths: Array(20).fill(20) };
    expect(calculateLVSimpsonSingleViewVolumeML({ ...slot, complete: false })).toBeNull();
    expect(calculateLVSimpsonSingleViewVolumeML({ ...slot, longAxisLengthMM: null })).toBeNull();
    expect(calculateLVSimpsonSingleViewVolumeML({ ...slot, widths: [20, 20] })).toBeNull();
    expect(calculateLVSimpsonSingleViewVolumeML({ ...slot,
      widths: [NaN, ...Array(19).fill(20)] })).toBeNull();
    expect(calculateLVSimpsonSingleViewVolumeML({ ...slot,
      widths: [-1, ...Array(19).fill(20)] })).toBeNull();
  });
});
