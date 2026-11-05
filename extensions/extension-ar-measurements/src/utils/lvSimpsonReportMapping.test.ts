import { buildClinicalLVSimpsonReportFieldUpdates } from './lvSimpson';

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
