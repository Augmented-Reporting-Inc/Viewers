export type UltrasoundDirectionalUnitKind =
  | 'flowVelocity'
  | 'tissueVelocity'
  | 'time'
  | 'generic';

export type UltrasoundDirectionalReportTarget = {
  key: string;
  label: string;
  unitKind: UltrasoundDirectionalUnitKind;
  valueField?: string;
  uomField?: string;
  reportUom?: string;
  reportMapped: boolean;
};

export const ULTRASOUND_DIRECTIONAL_GENERIC_TARGET_KEY = 'generic';

export const ULTRASOUND_DIRECTIONAL_REPORT_TARGETS: readonly UltrasoundDirectionalReportTarget[] =
  Object.freeze([
    { key: 'echo.mvEVelocity', label: 'MV E velocity', unitKind: 'flowVelocity', valueField: 'E', uomField: 'EUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.mvAVelocity', label: 'MV A velocity', unitKind: 'flowVelocity', valueField: 'A', uomField: 'AUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.trPeakVelocity', label: 'TR peak velocity', unitKind: 'flowVelocity', valueField: 'TRVel', uomField: 'TRVelUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.lvotPeakVelocity', label: 'LVOT peak velocity', unitKind: 'flowVelocity', valueField: 'LVOTVmax', uomField: 'LVOTVmaxUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.avPeakVelocity', label: 'AV peak velocity', unitKind: 'flowVelocity', valueField: 'AVVmax', uomField: 'AVVmaxUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.arPeakVelocity', label: 'AR peak velocity', unitKind: 'flowVelocity', valueField: 'ARVmax', uomField: 'ARVmaxUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.pvPeakVelocity', label: 'PV peak velocity', unitKind: 'flowVelocity', valueField: 'PVVel', uomField: 'PVVelUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.prPeakVelocity', label: 'PR peak velocity', unitKind: 'flowVelocity', valueField: 'PRVmax', uomField: 'PRVmaxUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.prEndDiastolicVelocity', label: 'PR end-diastolic velocity', unitKind: 'flowVelocity', valueField: 'PRVel', uomField: 'PRVelUOM', reportUom: 'm/s', reportMapped: true },
    { key: 'echo.coarctationPeakVelocity', label: 'Coarctation peak velocity', unitKind: 'flowVelocity', valueField: 'CoarcVmax', uomField: 'CoarcVmaxUOM', reportUom: 'm/s', reportMapped: true },

    { key: 'echo.rvSPrimeVelocity', label: "RV S′ velocity", unitKind: 'tissueVelocity', valueField: 'S', uomField: 'SUOM', reportUom: 'cm/s', reportMapped: true },
    { key: 'echo.mitralSeptalEPrimeVelocity', label: "Mitral septal e′ velocity", unitKind: 'tissueVelocity', valueField: 'esep', uomField: 'esepUOM', reportUom: 'cm/s', reportMapped: true },
    { key: 'echo.mitralLateralEPrimeVelocity', label: "Mitral lateral e′ velocity", unitKind: 'tissueVelocity', valueField: 'elat', uomField: 'elatUOM', reportUom: 'cm/s', reportMapped: true },
    { key: 'echo.pulmonaryVeinSVelocity', label: 'Pulmonary vein S velocity', unitKind: 'tissueVelocity', valueField: 's', uomField: 'sUOM', reportUom: 'cm/s', reportMapped: true },
    { key: 'echo.pulmonaryVeinDVelocity', label: 'Pulmonary vein D velocity', unitKind: 'tissueVelocity', valueField: 'd', uomField: 'dUOM', reportUom: 'cm/s', reportMapped: true },
    { key: 'echo.pulmonaryVeinArVelocity', label: 'Pulmonary vein Ar velocity', unitKind: 'tissueVelocity', valueField: 'a', uomField: 'aUOM', reportUom: 'cm/s', reportMapped: true },

    { key: 'echo.ivrt', label: 'IVRT', unitKind: 'time', valueField: 'IVRT', uomField: 'IVRTUOM', reportUom: 'ms', reportMapped: true },
    { key: 'echo.pulmonaryVeinArDuration', label: 'Pulmonary vein Ar duration', unitKind: 'time', valueField: 'adur', uomField: 'adurUOM', reportUom: 'ms', reportMapped: true },
  ]);

const GENERIC_TARGET: UltrasoundDirectionalReportTarget = Object.freeze({
  key: ULTRASOUND_DIRECTIONAL_GENERIC_TARGET_KEY,
  label: 'Generic Ultrasound Directional (no AR report mapping)',
  unitKind: 'generic',
  reportMapped: false,
});

const TARGET_BY_KEY = new Map(
  ULTRASOUND_DIRECTIONAL_REPORT_TARGETS.map(target => [target.key, target])
);

function normalizeUnitToken(unit = '') {
  return String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/μ/g, 'µ')
    .replace(/\s+/g, '')
    .replace(/persec(?:ond)?/g, '/s')
    .replace(/\/sec(?:ond)?/g, '/s');
}

export function getUltrasoundDirectionalUnitKind(unit = ''): UltrasoundDirectionalUnitKind {
  const token = normalizeUnitToken(unit);

  if (/^(m\/s|m\/s\^?1|m\/s-1|m·s-1|m·s⁻¹)$/.test(token)) {
    return 'flowVelocity';
  }

  if (/^(cm\/s|cm\/s\^?1|cm\/s-1|cm·s-1|cm·s⁻¹)$/.test(token)) {
    return 'tissueVelocity';
  }

  if (/^(mm\/s|mm\/s\^?1|mm\/s-1|mm·s-1|mm·s⁻¹)$/.test(token)) {
    return 'flowVelocity';
  }

  if (/^(ms|msec|millisecond|milliseconds|s|sec|second|seconds)$/.test(token)) {
    return 'time';
  }

  return 'generic';
}

export function getUltrasoundDirectionalTargetOptionsForUnit(
  unit = '',
  { includeGeneric = true }: { includeGeneric?: boolean } = {}
) {
  const unitKind = getUltrasoundDirectionalUnitKind(unit);
  const isVelocityUnit = unitKind === 'flowVelocity' || unitKind === 'tissueVelocity';
  const mappedTargets = ULTRASOUND_DIRECTIONAL_REPORT_TARGETS.filter(target =>
    isVelocityUnit
      ? target.unitKind === 'flowVelocity' || target.unitKind === 'tissueVelocity'
      : target.unitKind === unitKind
  );
  const options = mappedTargets.map(target => ({ value: target.key, label: target.label }));

  if (includeGeneric) {
    options.push({ value: GENERIC_TARGET.key, label: GENERIC_TARGET.label });
  }

  return options;
}

export function getUltrasoundDirectionalReportTarget(targetKey = '') {
  const key = String(targetKey || '').trim();

  if (key === GENERIC_TARGET.key) {
    return GENERIC_TARGET;
  }

  return TARGET_BY_KEY.get(key) || null;
}

export function normalizeUltrasoundDirectionalTargetSelection(value: any, unit = '') {
  const rawValue =
    value && typeof value === 'object'
      ? value.value || value.key || value.label || ''
      : String(value || '').trim();
  const options = getUltrasoundDirectionalTargetOptionsForUnit(unit, { includeGeneric: true });
  const normalizedRaw = String(rawValue || '').trim().toLowerCase();
  const matchedOption = options.find(
    option =>
      option.value.toLowerCase() === normalizedRaw || option.label.toLowerCase() === normalizedRaw
  );

  return matchedOption ? getUltrasoundDirectionalReportTarget(matchedOption.value) : null;
}

export function convertUltrasoundDirectionalValueForTarget({
  value,
  unit = '',
  target,
}: {
  value: any;
  unit?: string;
  target?: UltrasoundDirectionalReportTarget | null;
}) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0 || !target?.reportMapped) {
    return null;
  }

  const token = normalizeUnitToken(unit);
  let reportValue = numericValue;

  if (target.reportUom === 'm/s') {
    if (token.startsWith('cm/')) reportValue = numericValue / 100;
    else if (token.startsWith('mm/')) reportValue = numericValue / 1000;
    else if (!token.startsWith('m/')) return null;
  } else if (target.reportUom === 'cm/s') {
    if (token.startsWith('m/')) reportValue = numericValue * 100;
    else if (token.startsWith('mm/')) reportValue = numericValue / 10;
    else if (!token.startsWith('cm/')) return null;
  } else if (target.reportUom === 'ms') {
    if (/^(s|sec|second|seconds)$/.test(token)) reportValue = numericValue * 1000;
    else if (!/^(ms|msec|millisecond|milliseconds)$/.test(token)) return null;
  } else {
    return null;
  }

  return {
    value: reportValue,
    unit: target.reportUom,
  };
}

export function buildUltrasoundDirectionalReportMapping(
  target: UltrasoundDirectionalReportTarget | null,
  { assignedAt = new Date().toISOString() }: { assignedAt?: string } = {}
) {
  if (!target?.reportMapped || !target.valueField || !target.uomField || !target.reportUom) {
    return null;
  }

  return {
    targetKey: target.key,
    label: target.label,
    valueField: target.valueField,
    uomField: target.uomField,
    uom: target.reportUom,
    assignedAt,
    source: 'ultrasoundDirectional',
  };
}
