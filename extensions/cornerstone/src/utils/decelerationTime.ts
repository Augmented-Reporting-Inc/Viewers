export const DECELERATION_TIME_MEASUREMENT_KIND = 'spectralDopplerDecelerationTime';

export type DecelerationTimeTargetKey = 'mitral' | 'tricuspid';

export type DecelerationTimeTarget = {
  key: DecelerationTimeTargetKey;
  valve: 'mitral' | 'tricuspid';
  label: string;
  shortLabel: string;
  reportTargetKey?: string;
};

export type DirectionalDopplerStats = {
  xValues?: unknown[];
  yValues?: unknown[];
  units?: unknown[];
  isHorizontal?: boolean;
  isUnitless?: boolean;
};

export type DecelerationTimeCalculation = {
  measurementKind: typeof DECELERATION_TIME_MEASUREMENT_KIND;
  status: 'complete' | 'unavailable';
  message: string;
  target: DecelerationTimeTarget | null;
  xValues: number[];
  xUnit: string;
  valueMS: number | null;
  unit: 'ms';
};

const DECELERATION_TIME_TARGETS: readonly DecelerationTimeTarget[] = Object.freeze([
  Object.freeze({
    key: 'mitral',
    valve: 'mitral',
    label: 'MV Deceleration Time',
    shortLabel: 'MV DecT',
    reportTargetKey: 'echo.mvDecT',
  }),
  Object.freeze({
    key: 'tricuspid',
    valve: 'tricuspid',
    label: 'TV Deceleration Time',
    shortLabel: 'TV DecT',
  }),
]);

const DECELERATION_TIME_TARGET_BY_KEY = new Map(
  DECELERATION_TIME_TARGETS.map(target => [target.key, target])
);

function normalizeSelectionText(value: unknown) {
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    value =
      objectValue.value ||
      objectValue.key ||
      objectValue.label ||
      objectValue.shortLabel ||
      '';
  }

  return String(value || '').trim();
}

function normalizeComparableText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function cloneTarget(target: DecelerationTimeTarget | null) {
  return target ? { ...target } : null;
}

export function getDecelerationTimeTargetOptions() {
  return DECELERATION_TIME_TARGETS.map(target => ({
    value: target.key,
    label: target.label,
  }));
}

export function normalizeDecelerationTimeTargetSelection(
  value: unknown
): DecelerationTimeTarget | null {
  const raw = normalizeSelectionText(value);

  if (!raw) {
    return null;
  }

  const direct = DECELERATION_TIME_TARGET_BY_KEY.get(
    raw.toLowerCase() as DecelerationTimeTargetKey
  );

  if (direct) {
    return cloneTarget(direct);
  }

  const normalized = normalizeComparableText(raw);
  const match = DECELERATION_TIME_TARGETS.find(target => {
    const candidates = [
      target.label,
      target.shortLabel,
      target.valve,
      `${target.valve} deceleration time`,
      `${target.valve} decel time`,
    ];

    return candidates.some(candidate => normalizeComparableText(candidate) === normalized);
  });

  return cloneTarget(match || null);
}

function getTimeUnitToMillisecondsFactor(unit: unknown) {
  const normalized = String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ');

  if (
    ['s', 'sec', 'secs', 'second', 'seconds'].includes(normalized)
  ) {
    return 1000;
  }

  if (
    [
      'ms',
      'msec',
      'msecs',
      'millisecond',
      'milliseconds',
      'millisec',
      'millisecs',
    ].includes(normalized)
  ) {
    return 1;
  }

  return null;
}

function unavailableCalculation({
  target,
  message,
  xValues = [],
  xUnit = '',
}: {
  target: DecelerationTimeTarget | null;
  message: string;
  xValues?: number[];
  xUnit?: string;
}): DecelerationTimeCalculation {
  return {
    measurementKind: DECELERATION_TIME_MEASUREMENT_KIND,
    status: 'unavailable',
    message,
    target: cloneTarget(target),
    xValues,
    xUnit,
    valueMS: null,
    unit: 'ms',
  };
}

export function calculateDecelerationTimeFromDirectionalStats({
  stats,
  target,
}: {
  stats?: DirectionalDopplerStats | null;
  target?: unknown;
} = {}): DecelerationTimeCalculation {
  const resolvedTarget = normalizeDecelerationTimeTargetSelection(target);

  if (!resolvedTarget) {
    return unavailableCalculation({
      target: null,
      message: 'Choose the mitral or tricuspid deceleration-time target.',
    });
  }

  const xValues = Array.isArray(stats?.xValues)
    ? stats.xValues.slice(0, 2).map(value => Number(value))
    : [];
  const units = Array.isArray(stats?.units)
    ? stats.units.map(value => String(value || '').trim())
    : [];
  const xUnit = units[0] || '';

  if (
    xValues.length < 2 ||
    !Number.isFinite(xValues[0]) ||
    !Number.isFinite(xValues[1])
  ) {
    return unavailableCalculation({
      target: resolvedTarget,
      message: 'The Doppler time axis is not calibrated for this measurement.',
      xValues: xValues.filter(Number.isFinite),
      xUnit,
    });
  }

  const millisecondsFactor = getTimeUnitToMillisecondsFactor(xUnit);

  if (millisecondsFactor == null) {
    return unavailableCalculation({
      target: resolvedTarget,
      message: xUnit
        ? `Unsupported Doppler time unit: ${xUnit}.`
        : 'The Doppler time-axis unit is unavailable.',
      xValues,
      xUnit,
    });
  }

  // Deceleration time is the horizontal time interval. The measurement line
  // itself follows the E-wave deceleration slope, so do not use the tool's
  // directional-distance choice (horizontal vs vertical). Always use X.
  const valueMS = Math.abs(xValues[1] - xValues[0]) * millisecondsFactor;

  if (!Number.isFinite(valueMS) || valueMS <= 0) {
    return unavailableCalculation({
      target: resolvedTarget,
      message: 'The two deceleration-time points must have different time coordinates.',
      xValues,
      xUnit,
    });
  }

  return {
    measurementKind: DECELERATION_TIME_MEASUREMENT_KIND,
    status: 'complete',
    message: '',
    target: resolvedTarget,
    xValues,
    xUnit,
    valueMS,
    unit: 'ms',
  };
}

export function buildDecelerationTimeDisplayText(
  calculation?: Partial<DecelerationTimeCalculation> | null
) {
  const target = normalizeDecelerationTimeTargetSelection(calculation?.target);
  const label = target?.shortLabel || 'DecT';
  const valueMS = Number(calculation?.valueMS);

  if (calculation?.status === 'complete' && Number.isFinite(valueMS) && valueMS > 0) {
    return [`${label} ${Math.round(valueMS)} ms`];
  }

  return [`${label}: deceleration time unavailable`];
}

export function getDecelerationTimeSummaryText(
  calculation?: Partial<DecelerationTimeCalculation> | null
) {
  return buildDecelerationTimeDisplayText(calculation)[0] || '';
}
