import { calculateLVSimpson } from './lvSimpson';
import { calculateLABiplaneDisks } from './laVolume';
import { calculateRVFACFromMeasurements, getEchoAreaSlot } from './echoAreaMeasurements';
import { calculateIVCFromMeasurements, isIVCDiameterMeasurement } from './rightHeartMeasurements';

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

/**
 * The Echo Vmax toolbar persists a calibrated UltrasoundDirectionalTool
 * annotation labelled "TR peak velocity". Research Read's TR field uses
 * "TRVel" / "TR Vmax"; those aliases must be exported from the *same*
 * explicitly identified TR source, not inferred from any velocity geometry.
 *
 * DICOM spectral velocity is commonly measured in cm/s even though research
 * and RVSP calculations require m/s. Never parse display text or guess units.
 */
function getResearchTRVelocityCandidate(annotation: any = {}) {
  const labelToken = cleanString(
    annotation?.label || annotation?.measurementRole || annotation?.role
  ).toLowerCase().replace(/[^a-z0-9]/g, '');
  const mappedTarget = cleanString(
    annotation?.reportMapping?.targetKey ||
    annotation?.ultrasoundDirectional?.reportMapping?.targetKey ||
    annotation?.measurements?.ultrasoundDirectional?.reportMapping?.targetKey
  );
  const isTRPeak =
    ['trpeakvelocity', 'trvmax', 'trvel'].includes(labelToken) ||
    mappedTarget === 'echo.trPeakVelocity';
  const directional =
    annotation?.ultrasoundDirectional ||
    annotation?.measurements?.ultrasoundDirectional;
  const kind = cleanString(
    annotation?.measurementKind ||
    annotation?.measurements?.measurementKind ||
    directional?.measurementKind
  ).toLowerCase();
  if (!isTRPeak || kind !== 'ultrasound-directional' || !directional) {
    return null;
  }

  const measurementKey = getMeasurementKey(annotation);
  const rawValue = directional.value;
  // Ultrasound-region calibration commonly serializes cm/sec or cm/second.
  // Normalize unit notation before converting; never parse the viewport text.
  const rawUnit = cleanString(directional.unit).toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\/seconds?$/, '/s')
    .replace(/\/secs?$/, '/s');
  const unitFactor = rawUnit === 'm/s' ? 1 :
    rawUnit === 'cm/s' ? 0.01 :
    rawUnit === 'mm/s' ? 0.001 : null;
  const rawNumeric = rawValue === null || rawValue === undefined || rawValue === ''
    ? null
    : Number(rawValue);
  const velocityMPS = unitFactor === null || rawNumeric === null
    ? null
    : rawNumeric * unitFactor;

  // Return a recognized-but-unusable result so invalid TR data cannot
  // fall through to the generic display-text/value candidate path.
  if (!measurementKey || velocityMPS === null ||
      !Number.isFinite(velocityMPS) || velocityMPS <= 0 || velocityMPS > 8) {
    return { recognized: true, candidate: null };
  }

  return {
    recognized: true,
    candidate: {
      labels: uniqueStrings([
        annotation?.label, annotation?.measurementRole, annotation?.role,
        'TRVel', 'TR Vmax',
      ]),
      value: velocityMPS,
      unit: 'm/s',
      source: 'viewer-measurement',
      sourceMeasurementKey: measurementKey,
    },
  };
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

/**
 * Keep research-derived values linked to actual validated viewer annotations.
 * A derived field is never inferred from a label or from free-text geometry.
 * Labels are intentionally method-specific (20-disk LA != area-length LA).
 */
function addDerivedCandidate({
  candidates, measurements, sourceFilter, labels, value, unit, prefix,
}: {
  candidates: any[];
  measurements: any[];
  sourceFilter: (annotation: any) => boolean;
  labels: string[];
  value: unknown;
  unit: string;
  prefix: string;
}) {
  const numeric = Number(value);
  if (value == null || !Number.isFinite(numeric)) return;
  const sources = measurements.filter(sourceFilter);
  const sourceKeys = sources.map(getMeasurementKey);
  if (!sourceKeys.length || sourceKeys.some(key => !key)) return;
  candidates.push({
    labels,
    value: numeric,
    unit,
    source: 'viewer-derived',
    sourceMeasurementKey: `${prefix}:${sourceKeys.join(',')}`.slice(0, 200),
  });
}

export function buildViewerMeasurementValueCandidates(
  annotations: any[] = []
) {
  const measurements = Array.isArray(annotations) ? annotations : [];
  const candidates: any[] = [];

  for (const annotation of measurements) {
    const trVelocity = getResearchTRVelocityCandidate(annotation);
    if (trVelocity?.recognized) {
      if (trVelocity.candidate) candidates.push(trVelocity.candidate);
      continue;
    }

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

  const laDisks = calculateLABiplaneDisks(measurements);
  if (laDisks?.status === 'complete') {
    addDerivedCandidate({
      candidates, measurements,
      sourceFilter: annotation =>
        String(
          annotation?.measurementKind ||
          annotation?.measurements?.measurementKind ||
          annotation?.laVolume?.measurementKind ||
          annotation?.measurements?.laVolume?.measurementKind ||
          ''
        ) === 'laVolumeSlot',
      labels: ['LAVolumeDisks', 'LA Biplane Disks', 'LA 20-disk volume'],
      value: laDisks.values?.volumeML,
      unit: 'mL',
      prefix: 'la-disks',
    });
  }

  const rvFac = calculateRVFACFromMeasurements(measurements);
  if (rvFac?.status === 'complete') {
    addDerivedCandidate({
      candidates, measurements,
      sourceFilter: annotation => ['RV_ED', 'RV_ES'].includes(getEchoAreaSlot(annotation) || ''),
      labels: ['RVFAC', 'RV FAC', 'RV fractional area change'],
      value: rvFac.values?.facPercent,
      unit: '%',
      prefix: 'rv-fac',
    });
  }

  const ivc = calculateIVCFromMeasurements(measurements);
  if (ivc?.status === 'complete') {
    addDerivedCandidate({
      candidates, measurements,
      sourceFilter: isIVCDiameterMeasurement,
      labels: ['IVCCollapsibility', 'IVC collapsibility'],
      value: ivc.values?.collapsibilityPercent,
      unit: '%',
      prefix: 'ivc-collapse',
    });
  }

  return candidates;
}
