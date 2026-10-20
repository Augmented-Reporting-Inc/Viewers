import { isViewerQuizCompositeReviewCurrent, resolveViewerQuizCompositeResult } from './viewerQuizCompositeResults';

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


describe('LV EF progress versus quiz capture precision', () => {
  it('accepts a capture when both values round to the same reviewed hundredth', () => {
    expect(isViewerQuizCompositeReviewCurrent(53.234, 53.232)).toBe(true);
    expect(isViewerQuizCompositeReviewCurrent(53.2, 53.2)).toBe(true);
  });

  it('requires another review when the EF changes by a visible hundredth', () => {
    expect(isViewerQuizCompositeReviewCurrent(53.234, 53.237)).toBe(false);
    expect(isViewerQuizCompositeReviewCurrent(53.2, 54.2)).toBe(false);
  });

  it('does not treat absent or nonfinite values as a reviewed EF', () => {
    expect(isViewerQuizCompositeReviewCurrent(undefined, 53)).toBe(false);
    expect(isViewerQuizCompositeReviewCurrent(NaN, 53)).toBe(false);
    expect(isViewerQuizCompositeReviewCurrent(53, Infinity)).toBe(false);
  });
});
