import {
  calculateIVCCollapsibility,
  calculateIVCFromMeasurements,
  calculateRAArea,
  calculateRVFAC,
  calculateRVSP,
  calculateTRPeakGradient,
  estimateRAPFromIVC,
} from './rightHeartMeasurements';

describe('right-heart measurement calculations', () => {
  it('calculates FAC from calibrated ED/ES areas without treating it as Simpson EF', () => {
    expect(calculateRVFAC(30, 18)).toEqual({
      status: 'complete',
      edaCM2: 30,
      esaCM2: 18,
      facPercent: 40,
    });
    expect(calculateRVFAC(20, 21).status).toBe('invalid');
    expect(calculateRVFAC(20, null).status).toBe('incomplete');
  });

  it('converts measured RA area only when the unit is explicit', () => {
    expect(calculateRAArea(1800, 'mm²').areaCM2).toBe(18);
    expect(calculateRAArea(18, 'cm2').areaCM2).toBe(18);
    expect(calculateRAArea(1800, 'px²').status).toBe('invalid');
  });

  it('calculates percent IVC collapse from expiratory/inspiratory diameters', () => {
    const result = calculateIVCCollapsibility(20, 8);
    expect(result.status).toBe('complete');
    expect(result.collapsibilityPercent).toBe(60);
    expect(calculateIVCCollapsibility(8, 20).status).toBe('invalid');
    expect(calculateIVCCollapsibility(20, null).status).toBe('incomplete');
    expect(calculateIVCCollapsibility(20, 0).collapsibilityPercent).toBe(100);
    expect(calculateIVCCollapsibility(0, 0).status).toBe('invalid');
  });

  it('does not estimate RAP without explicit respiratory context', () => {
    const incomplete = estimateRAPFromIVC({
      expirationDiameterMM: 20,
      collapsibilityPercent: 60,
    });
    expect(incomplete.status).toBe('unsupported');
    expect(incomplete.rapMMHG).toBeNull();
    expect(estimateRAPFromIVC({
      expirationDiameterMM: 20,
      collapsibilityPercent: 60,
      spontaneouslyBreathing: true,
      respiratoryManeuver: 'sniff',
    }).rapMMHG).toBe(3);
    expect(estimateRAPFromIVC({
      expirationDiameterMM: 23,
      collapsibilityPercent: 30,
      spontaneouslyBreathing: true,
      respiratoryManeuver: 'quiet',
    }).rapMMHG).toBe(15);
    const intermediate = estimateRAPFromIVC({
      expirationDiameterMM: 20,
      collapsibilityPercent: 30,
      spontaneouslyBreathing: true,
      respiratoryManeuver: 'sniff',
    });
    expect(intermediate.rapMMHG).toBe(8);
    expect(intermediate.requiresClinicalReview).toBe(true);
  });

  it('requires both TR Vmax and RAP for RVSP, without default RAP', () => {
    expect(calculateTRPeakGradient(3).gradientMMHG).toBe(36);
    expect(calculateRVSP(3, 8).rvspMMHG).toBe(44);
    expect(calculateRVSP(3, null).status).toBe('incomplete');
    expect(calculateRVSP(0, 8).status).toBe('invalid');
    expect(calculateRVSP(3, -1).status).toBe('invalid');
  });

  it('pairs only uniquely labelled and calibrated IVC lengths', () => {
    const pair = [
      { toolName: 'Length', label: 'IVCexp', measurements: { length: 2.2, unit: 'cm' } },
      { toolName: 'Length', label: 'IVCinsp', measurements: { length: 8, unit: 'mm' } },
    ];
    const result = calculateIVCFromMeasurements(pair);
    expect(result?.status).toBe('complete');
    expect(result?.values?.expirationDiameterMM).toBe(22);
    expect(result?.values?.collapsibilityPercent).toBeCloseTo(63.6363636);
    expect(result?.rapEstimateStatus).toBe('not-assessed');
    const displayLabelPair = [
      { ...pair[0], label: 'IVC end-expiration diameter' },
      { ...pair[1], label: 'IVC end-inspiration diameter' },
    ];
    expect(calculateIVCFromMeasurements(displayLabelPair)?.status).toBe('complete');
    expect(calculateIVCFromMeasurements([...pair, pair[0]])?.status).toBe('invalid');
    expect(calculateIVCFromMeasurements([
      { toolName: 'Length', label: 'IVCexp', measurements: { length: 20, unit: 'px' } },
      pair[1],
    ])?.status).toBe('incomplete');
    expect(calculateIVCFromMeasurements([{ toolName: 'Length', label: 'IVC', value: 20, unit: 'mm' }])).toBeNull();
  });
});
