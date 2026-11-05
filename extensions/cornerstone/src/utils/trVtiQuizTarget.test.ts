import {
  TR_VTI_QUIZ_TARGET,
  getSpectralDopplerVtiTargetOptions,
  normalizeSpectralDopplerVtiTargetSelection,
  buildViewerReportMapping,
} from './viewerReportMapping';

describe('TR VTI learning acquisition target', () => {
  it('offers the calibrated target only where non-report targets are allowed', () => {
    expect(getSpectralDopplerVtiTargetOptions({ includeGeneric: false })
      .some(option => option.value === TR_VTI_QUIZ_TARGET.key)).toBe(false);
    expect(getSpectralDopplerVtiTargetOptions({ includeGeneric: true })
      .some(option => option.value === TR_VTI_QUIZ_TARGET.key)).toBe(true);
  });

  it('resolves TR VTI without making an unreviewed clinical report field', () => {
    const target = normalizeSpectralDopplerVtiTargetSelection('TR VTI', {
      allowGeneric: true,
    });
    expect(target?.key).toBe('spectral.trVti');
    expect(target?.reportMapped).toBe(false);
    expect(buildViewerReportMapping(target)).toBeNull();
    expect(normalizeSpectralDopplerVtiTargetSelection('TR VTI', {
      allowGeneric: false,
    })).toBeNull();
  });
});
