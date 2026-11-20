import { buildClinicalLVSimpsonReportFieldUpdates, calculateLVSimpsonSingleViewVolumeML } from './lvSimpson';

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
