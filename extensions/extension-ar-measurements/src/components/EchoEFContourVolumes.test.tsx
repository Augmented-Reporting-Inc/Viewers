import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EchoEFContourVolumes, getLVSimpsonSourceVolumes } from './EchoEFContourVolumes';

jest.mock('../utils/lvSimpson', () => ({
  LV_SIMPSON_SLOT_ORDER: ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'],
  calculateLVSimpsonContourVolumeForMeasurement: (source: any) =>
    source?.verifiedVolumeML ?? null,
}));

const contour = (slot: string, verifiedVolumeML: number | null) => ({
  measurementKind: 'lvSimpsonSlot',
  lvSimpson: { slot },
  verifiedVolumeML,
});

describe('shared Research/Education EF contour presentation', () => {
  it('shows verified contour volumes using the same four slot labels in both workflows', () => {
    const sourceVolumes = getLVSimpsonSourceVolumes([
      contour('A4C_ED', 78.21),
      contour('A4C_ES', 65.93),
      contour('A2C_ED', 72.77),
      contour('A2C_ES', 75.91),
    ]);
    const markup = renderToStaticMarkup(
      <EchoEFContourVolumes volumes={sourceVolumes} status="Saved" />
    );
    expect(markup).toContain('Saved single-view LV contour volumes (mL)');
    expect(markup).toContain('A4C end-diastole');
    expect(markup).toContain('A2C end-systole');
    expect(markup).toContain('78.21 mL');
    expect(markup).toContain('75.91 mL');
  });

  it('fails closed for duplicate slots, invalid volumes and non-EF annotations', () => {
    const values = getLVSimpsonSourceVolumes([
      contour('A4C_ED', 70),
      contour('A4C_ED', 72),
      contour('A4C_ES', null),
      contour('A2C_ED', -1),
      { measurementKind: 'laVolumeSlot', lvSimpson: { slot: 'A2C_ES' }, verifiedVolumeML: 100 },
    ]);
    expect(values).toEqual({ A4C_ED: null, A4C_ES: null, A2C_ED: null });
    const markup = renderToStaticMarkup(<EchoEFContourVolumes volumes={values} />);
    expect(markup).not.toContain('70.00 mL');
    expect(markup).toContain('Not available');
  });

  it('does not turn a zero or absent slot into a measurement', () => {
    const markup = renderToStaticMarkup(
      <EchoEFContourVolumes volumes={{ A4C_ED: 0, A4C_ES: undefined }} />
    );
    expect(markup).toContain('Not available');
    expect(markup).not.toContain('0.00 mL');
  });
});
