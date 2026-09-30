import { calculateLVSimpson } from './lvSimpson';

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function finiteNumberOrNull(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function uniqueStrings(values: unknown[] = []) {
  return Array.from(
    new Set(values.map(cleanString).filter(Boolean))
  );
}

function getMeasurementKey(annotation: any = {}) {
  return cleanString(
    annotation?.annotationId ||
      annotation?.annotationUID ||
      annotation?.uid ||
      annotation?.id
  );
}

function getMeasurementDisplayText(annotation: any = {}) {
  const display =
    annotation?.displayText?.primary ||
    annotation?.displayText ||
    annotation?.measurements?.displayText ||
    [];

  return Array.isArray(display)
    ? display.map(cleanString).filter(Boolean)
    : cleanString(display)
      ? [cleanString(display)]
      : [];
}

function parseNumericDisplayValue(lines: string[] = []) {
  for (const line of lines) {
    const match = cleanString(line).match(
      /(-?\d+(?:\.\d+)?)\s*([A-Za-z%0-9/^]+)?/
    );

    if (!match) continue;

    const value = finiteNumberOrNull(match[1]);

    if (value !== null) {
      return {
        value,
        unit: cleanString(match[2]),
      };
    }
  }

  return {
    value: null,
    unit: '',
  };
}

function getDirectMeasurementValue(annotation: any = {}) {
  const measurements =
    annotation?.measurements &&
    typeof annotation.measurements === 'object' &&
    !Array.isArray(annotation.measurements)
      ? annotation.measurements
      : {};

  const value =
    finiteNumberOrNull(measurements.value) ??
    finiteNumberOrNull(measurements.length) ??
    finiteNumberOrNull(annotation?.value) ??
    finiteNumberOrNull(annotation?.length);

  const unit = cleanString(
    measurements.unit ||
      measurements.lengthUnit ||
      annotation?.unit ||
      annotation?.lengthUnit
  );

  if (value !== null) {
    return {
      value,
      unit,
    };
  }

  return parseNumericDisplayValue(getMeasurementDisplayText(annotation));
}

function isLVSimpsonAnnotation(annotation: any = {}) {
  return (
    cleanString(
      annotation?.measurementKind ||
        annotation?.measurements?.measurementKind
    ) === 'lvSimpsonSlot' ||
    !!annotation?.lvSimpson ||
    !!annotation?.measurements?.lvSimpson
  );
}

export function buildViewerMeasurementValueCandidates(
  annotations: any[] = []
) {
  const measurements = Array.isArray(annotations) ? annotations : [];
  const candidates: any[] = [];

  for (const annotation of measurements) {
    const labels = uniqueStrings([
      annotation?.label,
      annotation?.measurementRole,
      annotation?.role,
    ]);

    if (!labels.length) {
      continue;
    }

    const resolved = getDirectMeasurementValue(annotation);

    if (resolved.value === null) {
      continue;
    }

    candidates.push({
      labels,
      value: resolved.value,
      unit: resolved.unit,
      source: 'viewer-measurement',
      sourceMeasurementKey: getMeasurementKey(annotation),
    });
  }

  const lvSimpson = calculateLVSimpson(measurements);

  if (
    lvSimpson?.status === 'complete' &&
    Number.isFinite(Number(lvSimpson?.values?.ejectionFraction))
  ) {
    const sourceKeys = measurements
      .filter(isLVSimpsonAnnotation)
      .map(getMeasurementKey)
      .filter(Boolean);

    candidates.push({
      labels: ['LVEF', 'LV EF', 'EF'],
      value: Number(lvSimpson.values.ejectionFraction),
      unit: '%',
      source: 'viewer-derived',
      sourceMeasurementKey: `lv-simpson:${sourceKeys.join(',')}`.slice(0, 200),
    });
  }

  return candidates;
}
