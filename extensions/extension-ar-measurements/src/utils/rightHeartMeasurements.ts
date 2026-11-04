/**
 * Reusable right-heart scalar calculations.
 *
 * No report writes, education score decisions, or tenant-specific behavior here.
 * Clinical interpretation (including ventilator status, respiratory maneuver and
 * RV outflow obstruction) belongs to the calling workflow. Calculated numbers
 * must not be treated as a substitute for validated source annotations.
 */

export type MeasurementCalculationStatus = 'complete' | 'incomplete' | 'invalid' | 'unsupported';

type NumericInput = number | string | null | undefined;
type ViewerMeasurement = Record<string, any>;
type IVCSlot = 'expiration' | 'inspiration';

function finiteNumber(value: NumericInput): number | null {
  if (value == null || String(value).trim() === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function calculateRVFAC(edaCM2: NumericInput, esaCM2: NumericInput) {
  const eda = finiteNumber(edaCM2);
  const esa = finiteNumber(esaCM2);
  if (eda == null || esa == null) {
    return { status: 'incomplete' as MeasurementCalculationStatus, facPercent: null };
  }
  if (eda <= 0 || esa < 0 || esa >= eda) {
    return { status: 'invalid' as MeasurementCalculationStatus, facPercent: null };
  }
  return {
    status: 'complete' as MeasurementCalculationStatus,
    edaCM2: eda,
    esaCM2: esa,
    facPercent: ((eda - esa) / eda) * 100,
  };
}

export function calculateRAArea(area: NumericInput, unit: string) {
  const value = finiteNumber(area);
  const normalized = String(unit || '').trim().toLowerCase().replace(/\s/g, '');
  if (value == null) {
    return { status: 'incomplete' as MeasurementCalculationStatus, areaCM2: null };
  }
  if (value <= 0 || !['cm²', 'cm2', 'mm²', 'mm2'].includes(normalized)) {
    return { status: 'invalid' as MeasurementCalculationStatus, areaCM2: null };
  }
  return {
    status: 'complete' as MeasurementCalculationStatus,
    areaCM2: normalized.startsWith('mm') ? value / 100 : value,
  };
}

export function calculateIVCCollapsibility(
  expirationDiameterMM: NumericInput,
  inspirationDiameterMM: NumericInput
) {
  const expiration = finiteNumber(expirationDiameterMM);
  const inspiration = finiteNumber(inspirationDiameterMM);

  if (expiration == null || inspiration == null) {
    return {
      status: 'incomplete' as MeasurementCalculationStatus,
      expirationDiameterMM: expiration,
      inspirationDiameterMM: inspiration,
      collapsibilityPercent: null,
    };
  }

  if (expiration <= 0 || inspiration < 0 || inspiration > expiration) {
    return {
      status: 'invalid' as MeasurementCalculationStatus,
      expirationDiameterMM: expiration,
      inspirationDiameterMM: inspiration,
      collapsibilityPercent: null,
    };
  }

  return {
    status: 'complete' as MeasurementCalculationStatus,
    expirationDiameterMM: expiration,
    inspirationDiameterMM: inspiration,
    collapsibilityPercent: ((expiration - inspiration) / expiration) * 100,
  };
}

/**
 * Advisory estimate only. The standard adult IVC categories require documented
 * spontaneous breathing and a sniff or quiet-respiration assessment. Additional
 * echocardiographic signs may change intermediate RAP assignments.
 * No estimate is returned if those prerequisites are not explicitly supplied.
 */
export function estimateRAPFromIVC({
  expirationDiameterMM,
  collapsibilityPercent,
  spontaneouslyBreathing = false,
  respiratoryManeuver = '',
}: {
  expirationDiameterMM: NumericInput;
  collapsibilityPercent: NumericInput;
  spontaneouslyBreathing?: boolean;
  respiratoryManeuver?: string;
}) {
  const diameter = finiteNumber(expirationDiameterMM);
  const collapse = finiteNumber(collapsibilityPercent);

  if (diameter == null || collapse == null) {
    return { status: 'incomplete' as MeasurementCalculationStatus, rapMMHG: null };
  }
  if (diameter <= 0 || collapse < 0 || collapse > 100) {
    return { status: 'invalid' as MeasurementCalculationStatus, rapMMHG: null };
  }
  if (
    spontaneouslyBreathing !== true ||
    !['sniff', 'quiet'].includes(String(respiratoryManeuver || '').toLowerCase())
  ) {
    return { status: 'unsupported' as MeasurementCalculationStatus, rapMMHG: null };
  }

  const normalSize = diameter <= 21;
  const collapses = collapse >= 50;
  const intermediate = normalSize !== collapses;
  return {
    status: 'complete' as MeasurementCalculationStatus,
    rapMMHG: intermediate ? 8 : normalSize ? 3 : 15,
    requiresClinicalReview: intermediate,
    method: 'ASE IVC-based RAP estimate (adult, spontaneous respiration)',
  };
}

export function calculateTRPeakGradient(trVelocityMPS: NumericInput) {
  const velocity = finiteNumber(trVelocityMPS);
  if (velocity == null) {
    return { status: 'incomplete' as MeasurementCalculationStatus, gradientMMHG: null };
  }
  if (velocity <= 0) {
    return { status: 'invalid' as MeasurementCalculationStatus, gradientMMHG: null };
  }
  return {
    status: 'complete' as MeasurementCalculationStatus,
    gradientMMHG: 4 * velocity * velocity,
  };
}

export function calculateRVSP(trVelocityMPS: NumericInput, rapMMHG: NumericInput) {
  const gradient = calculateTRPeakGradient(trVelocityMPS);
  const rap = finiteNumber(rapMMHG);
  if (gradient.status === 'invalid' || (rap != null && rap < 0)) {
    return { status: 'invalid' as MeasurementCalculationStatus, rvspMMHG: null };
  }
  if (gradient.status !== 'complete' || rap == null) {
    return { status: 'incomplete' as MeasurementCalculationStatus, rvspMMHG: null };
  }
  return {
    status: 'complete' as MeasurementCalculationStatus,
    gradientMMHG: gradient.gradientMMHG,
    rapMMHG: rap,
    rvspMMHG: Number(gradient.gradientMMHG) + rap,
  };
}

function ivcSlot(measurement: ViewerMeasurement): IVCSlot | null {
  const label = String(
    measurement?.label || measurement?.measurementRole || measurement?.role || ''
  ).trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['ivcexp', 'ivcexpiration', 'ivcendexpiration', 'ivcendexpirationdiameter'].includes(label)) return 'expiration';
  if (['ivcinsp', 'ivcinspiration', 'ivcendinspiration', 'ivcendinspirationdiameter'].includes(label)) return 'inspiration';
  return null;
}

function calibratedLengthMM(measurement: ViewerMeasurement): number | null {
  if (String(measurement?.toolName || '') !== 'Length') return null;
  const points = measurement?.points || measurement?.measurements?.points || [];
  if (!Array.isArray(points) || points.length < 2) return null;
  const stats = measurement?.cachedStats || measurement?.data || {};
  const firstStats = Object.values(stats).find(value => value && typeof value === 'object') as
    | Record<string, any>
    | undefined;
  const source = measurement?.measurements || {};
  const raw = source.length ?? measurement?.length ?? firstStats?.length ??
    (measurement?.toolName === 'Length' ? measurement?.value : null);
  const unit = String(
    source.lengthUnit || source.unit || measurement?.lengthUnit ||
    measurement?.unit || firstStats?.lengthUnit || firstStats?.unit || ''
  ).trim().replace(/\s+(?:US Region|AR_US_REGION_CALIBRATION).*$/i, '').toLowerCase();
  const length = finiteNumber(raw);

  // A pixel distance or an unlabelled raw number is not clinical evidence.
  if (length == null || length <= 0) return null;
  if (unit === 'mm') return length;
  if (unit === 'cm') return length * 10;
  return null;
}

function compatibleIVCCinePair(a: ViewerMeasurement, b: ViewerMeasurement): boolean {
  const studyA = String(a?.referenceStudyUID || a?.StudyInstanceUID || '').trim();
  const studyB = String(b?.referenceStudyUID || b?.StudyInstanceUID || '').trim();
  const seriesA = String(a?.referenceSeriesUID || a?.SeriesInstanceUID || '').trim();
  const seriesB = String(b?.referenceSeriesUID || b?.SeriesInstanceUID || '').trim();
  if (!studyA || !studyB || studyA !== studyB ||
      !seriesA || !seriesB || seriesA !== seriesB) return false;

  const sopA = String(a?.SOPInstanceUID || a?.metadata?.SOPInstanceUID || '').trim();
  const sopB = String(b?.SOPInstanceUID || b?.metadata?.SOPInstanceUID || '').trim();
  const frameA = finiteNumber(a?.frameNumber ?? a?.metadata?.frameNumber);
  const frameB = finiteNumber(b?.frameNumber ?? b?.metadata?.frameNumber);
  if (sopA && sopB && sopA === sopB && frameA != null && frameB != null &&
      frameA === frameB) return false;
  return true;
}

export function isIVCDiameterMeasurement(measurement: ViewerMeasurement): boolean {
  return ivcSlot(measurement) != null;
}

/**
 * Compose two *explicitly labelled* calibrated Length measurements. Unlabelled
 * legacy "IVC" entries are deliberately ignored. Duplicate slots cannot be
 * silently paired across acquisitions.
 */
export function calculateIVCFromMeasurements(measurements: ViewerMeasurement[] = []) {
  const relevant = (Array.isArray(measurements) ? measurements : []).filter(
    isIVCDiameterMeasurement
  );
  if (!relevant.length) return null;

  const expiration = relevant.filter(item => ivcSlot(item) === 'expiration');
  const inspiration = relevant.filter(item => ivcSlot(item) === 'inspiration');

  if (expiration.length > 1 || inspiration.length > 1) {
    return {
      status: 'invalid' as MeasurementCalculationStatus,
      values: null,
      message: 'More than one IVC measurement has the same phase label. Select an unambiguous expiration/inspiration pair.',
    };
  }

  if (expiration.length && inspiration.length &&
      !compatibleIVCCinePair(expiration[0], inspiration[0])) {
    return {
      status: 'invalid' as MeasurementCalculationStatus,
      values: null,
      message: 'IVC expiration and inspiration must use separate frames of the same study and cine series.',
    };
  }

  const exp = expiration.length ? calibratedLengthMM(expiration[0]) : null;
  const insp = inspiration.length ? calibratedLengthMM(inspiration[0]) : null;
  const result = calculateIVCCollapsibility(exp, insp);

  return {
    status: result.status,
    values: {
      expirationDiameterMM: exp,
      inspirationDiameterMM: insp,
      collapsibilityPercent: result.collapsibilityPercent,
    },
    message:
      result.status === 'complete'
        ? ''
        : result.status === 'invalid'
          ? 'Inspiratory diameter exceeds expiratory diameter; check the phases and calipers.'
          : 'Capture both calibrated IVC expiration and inspiration diameters to calculate collapsibility.',
    // Explicit respiratory context must be recorded before estimating RAP.
    rapEstimateStatus: 'not-assessed',
  };
}


/** Does not overwrite the legacy IVC field or infer RAP without respiratory context. */
export function buildClinicalIVCReportFieldUpdates(result: any = null) {
  const v = result?.status === 'complete' ? result.values : null;
  if (!v) return {};
  const expiration = Number(v.expirationDiameterMM);
  const inspiration = Number(v.inspirationDiameterMM);
  const collapse = Number(v.collapsibilityPercent);
  if (!Number.isFinite(expiration) || !Number.isFinite(inspiration) ||
      !Number.isFinite(collapse) || expiration <= 0 || inspiration < 0 ||
      inspiration > expiration || collapse < 0 || collapse > 100) return {};
  return {
    IVCExp: (expiration / 10).toFixed(2),
    IVCExpUOM: 'cm',
    IVCInsp: (inspiration / 10).toFixed(2),
    IVCInspUOM: 'cm',
    IVCCollapsibility: collapse.toFixed(1),
    IVCCollapsibilityUOM: '%',
  };
}
