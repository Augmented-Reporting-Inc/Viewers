import { resolveViewerQuizCompositeResult } from './viewerQuizCompositeResults';

describe('viewer quiz composite result evidence', () => {
  it('rejects missing required Simpson slots', () => {
    expect(resolveViewerQuizCompositeResult('lvSimpsonEF', [
      { uid: 'one', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
    ])).toBeNull();
  });

  it('rejects duplicate Simpson slots instead of silently choosing the last annotation', () => {
    expect(resolveViewerQuizCompositeResult('lvSimpsonEF', [
      { uid: 'one', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
      { uid: 'two', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' },
      { uid: 'three', measurementKind: 'lvSimpsonSlot', slot: 'A4C_ES' },
      { uid: 'four', measurementKind: 'lvSimpsonSlot', slot: 'A2C_ED' },
      { uid: 'five', measurementKind: 'lvSimpsonSlot', slot: 'A2C_ES' },
    ])).toBeNull();
  });

  it('rejects a biplane LA volume without both source contours', () => {
    expect(resolveViewerQuizCompositeResult('laVolumeBiplane', [
      { uid: 'one', measurementKind: 'laVolumeSlot', slot: 'A4C' },
    ])).toBeNull();
  });

  it('rejects anonymous source contours that cannot be audited', () => {
    expect(resolveViewerQuizCompositeResult('laVolumeBiplane', [
      { measurementKind: 'laVolumeSlot', slot: 'A4C' },
      { uid: 'two', measurementKind: 'laVolumeSlot', slot: 'A2C' },
    ])).toBeNull();
  });

  it('does not interpret an arbitrary measurement as a composite', () => {
    expect(resolveViewerQuizCompositeResult('lvSimpsonEF', [
      { uid: 'one', measurementKind: 'length', value: 60 },
    ])).toBeNull();
  });
});
