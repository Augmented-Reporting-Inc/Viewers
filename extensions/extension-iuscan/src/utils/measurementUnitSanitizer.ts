/**
 * iUSCAN length-unit normalisation (cm / "cm US Region" -> mm).
 *
 * Moved verbatim from ../index.ts so the live-annotation rules can be tested.
 * Behaviour is unchanged except for sanitizeLiveCornerstoneAnnotation, which
 * no longer touches annotations owned by the native Cornerstone Length tool.
 */

const sanitizeMeasurementUnit = unit =>
  String(unit || 'mm')
    .replace(/\s*US Region\s*/gi, '')
    .trim() || 'mm';

export const toMillimeters = (value, unit = 'mm') => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return /^cm\b/i.test(sanitizeMeasurementUnit(unit)) ? numeric * 10 : numeric;
};

export const formatMmDisplay = value => `${Number(value).toFixed(2)} mm`;

export function setMeasurementDisplayText(measurement, text) {
  if (!measurement || !text) {
    return;
  }

  const existing = measurement.displayText;

  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    measurement.displayText = {
      ...existing,
      primary: [text],
      secondary: Array.isArray(existing.secondary) ? existing.secondary : [],
    };
    return;
  }

  measurement.displayText = {
    primary: [text],
    secondary: [],
  };
}

function setAnnotationDisplayText(annotation, text) {
  if (!annotation?.data || !text) {
    return;
  }

  const existing = annotation.data.displayText;

  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    annotation.data.displayText = {
      ...existing,
      primary: [text],
      secondary: Array.isArray(existing.secondary) ? existing.secondary : [],
    };
    return;
  }

  annotation.data.displayText = {
    primary: [text],
    secondary: [],
  };
}

export function scrubUsRegionDisplayText(value) {
  if (Array.isArray(value)) {
    return value.map(scrubUsRegionDisplayText);
  }

  if (typeof value === 'string') {
    return value.replace(/\s*US Region\b/gi, '').trim();
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubUsRegionDisplayText(item)])
    );
  }

  return value;
}

export function sanitizeLengthStatsObject(stats) {
  if (!stats || typeof stats !== 'object') {
    return false;
  }

  const rawValue = stats.length ?? stats.value;
  const rawUnit = stats.lengthUnit ?? stats.unit ?? 'mm';
  const valueInMm = toMillimeters(rawValue, rawUnit);

  if (valueInMm == null) {
    stats.displayText = scrubUsRegionDisplayText(stats.displayText);
    return false;
  }

  stats.length = valueInMm;
  stats.value = valueInMm;
  stats.unit = 'mm';
  stats.lengthUnit = 'mm';
  stats.displayText = [formatMmDisplay(valueInMm)];

  return true;
}

export function sanitizeStatsContainer(container) {
  if (!container || typeof container !== 'object') {
    return false;
  }

  let changed = false;

  for (const value of Object.values(container)) {
    if (value && typeof value === 'object') {
      changed = sanitizeLengthStatsObject(value) || changed;
    }
  }

  return changed;
}

/**
 * Normalise a MeasurementService record (NOT the live Cornerstone
 * annotation). The record is a separate object from the annotation's
 * cachedStats; see extensions/cornerstone measurementServiceMappings/Length.ts.
 */
export function sanitizeMeasurementForIuscan(measurement) {
  if (!measurement) {
    return measurement;
  }

  let changed = false;

  if (measurement.measurements && typeof measurement.measurements === 'object') {
    changed = sanitizeLengthStatsObject(measurement.measurements) || changed;
  }

  if (measurement.data && typeof measurement.data === 'object') {
    changed = sanitizeStatsContainer(measurement.data) || changed;
  }

  if (measurement.cachedStats && typeof measurement.cachedStats === 'object') {
    changed = sanitizeStatsContainer(measurement.cachedStats) || changed;
  }

  const topLevelValue = measurement.length ?? measurement.value;
  const topLevelUnit = measurement.lengthUnit ?? measurement.unit;
  const topLevelValueInMm = toMillimeters(topLevelValue, topLevelUnit);

  if (topLevelValueInMm != null) {
    measurement.length = topLevelValueInMm;
    measurement.value = topLevelValueInMm;
    measurement.unit = 'mm';
    measurement.lengthUnit = 'mm';
    setMeasurementDisplayText(measurement, formatMmDisplay(topLevelValueInMm));
    changed = true;
  }

  if (!changed) {
    measurement.displayText = scrubUsRegionDisplayText(measurement.displayText);
  } else if (measurement.data && typeof measurement.data === 'object') {
    const firstDisplayText = Object.values(measurement.data)
      .flatMap(datum => (datum as { displayText?: string[] })?.displayText || [])
      .filter(Boolean)[0];

    if (firstDisplayText) {
      setMeasurementDisplayText(measurement, firstDisplayText);
    }
  }

  return measurement;
}

/**
 * Tools whose live annotation state is owned by native Cornerstone and must
 * not be rewritten here.
 *
 * Length: the native LengthTool owns data.cachedStats, and its on-image text
 * comes from the shared calibrated formatter installed by the cornerstone
 * ToolGroupService (same value as the MeasurementService record, in mm).
 * Rewriting cachedStats and setting `invalidated` made Cornerstone recompute
 * the native stats, fire ANNOTATION_MODIFIED -> MEASUREMENT_UPDATED, and come
 * straight back here — a repeated update/re-render cycle on every Length.
 */
export const NATIVE_TOOLS_OWNING_LIVE_STATS = new Set(['Length']);

/**
 * Normalise units on a live Cornerstone annotation in place.
 * Returns true when it changed the annotation (caller re-renders).
 */
export function sanitizeLiveCornerstoneAnnotation(csAnnotation) {
  if (!csAnnotation?.data) {
    return false;
  }

  if (NATIVE_TOOLS_OWNING_LIVE_STATS.has(csAnnotation.metadata?.toolName)) {
    return false;
  }

  let changed = false;

  if (csAnnotation.data.cachedStats) {
    changed = sanitizeStatsContainer(csAnnotation.data.cachedStats) || changed;
  }

  if (csAnnotation.data.measurements) {
    changed = sanitizeLengthStatsObject(csAnnotation.data.measurements) || changed;
  }

  if (changed) {
    const firstDisplayText =
      csAnnotation.data.measurements?.displayText?.[0] ||
      Object.values(csAnnotation.data.cachedStats || {})
        .flatMap(stats => (stats as { displayText?: string[] })?.displayText || [])
        .filter(Boolean)[0];

    if (firstDisplayText) {
      setAnnotationDisplayText(csAnnotation, firstDisplayText);
    }

    csAnnotation.invalidated = true;
  }

  return changed;
}
