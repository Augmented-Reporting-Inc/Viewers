// Keep this viewer preview in parity with FormAPI's independently implemented
// echoReportMeasurements.service.js. Report-bound Echo Length measurements must
// have a named, physically calibrated mm/cm source; display text and pixel
// fallback values are never clinical calculation inputs.
const LINEAR_LV_LENGTH_LABELS = new Set(['LVIDd', 'IVSd', 'PWd']);

function finitePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function getLinearLVLengthLabel(measurement: any = {}): string {
  const label = String(measurement?.label || measurement?.measurementRole || '').trim();
  return LINEAR_LV_LENGTH_LABELS.has(label) ? label : '';
}

function hasEchoMeasurementDomain(measurement: any = {}): boolean {
  const sourceDomain = String(measurement?.domain || '').trim().toLowerCase();
  // Unsaved MeasurementService calipers do not carry domain. Their domain is
  // assigned by serializeViewerMeasurement() on save; this preview is called
  // exclusively inside the Echo panel. Reject any explicit non-Echo domain.
  return !sourceDomain || sourceDomain === 'echo';
}

/**
 * Completed native Cornerstone Length measurements are held by OHIF
 * MeasurementService under data["imageId:<referencedImageId>"] rather than
 * the serialized measurements.length field used by FormAPI.
 *
 * Accept only the exact current image target. A stale or another-frame cached
 * stat must never contribute to LV mass/RWT, nor may displayText's normalized
 * "mm" be used as evidence of physical calibration.
 */
function getCurrentFrameNativeLengthSource(measurement: any = {}) {
  const imageId = String(
    measurement?.referencedImageId || measurement?.metadata?.referencedImageId || ''
  ).trim();
  if (!imageId) return null;
  const statsByTarget = measurement?.data || measurement?.cachedStats || {};
  if (!statsByTarget || typeof statsByTarget !== 'object' ||
      Array.isArray(statsByTarget)) return null;
  const exact = statsByTarget[`imageId:${imageId}`] || statsByTarget[imageId];
  if (!exact || typeof exact !== 'object' || Array.isArray(exact)) return null;
  return {
    value: exact.length ?? exact.value,
    unit: exact.lengthUnit || exact.unit || '',
  };
}

export function getCalibratedEchoLinearLengthMM(measurement: any = {}): number | null {
  if (
    !hasEchoMeasurementDomain(measurement) ||
    String(measurement?.toolName || '').trim() !== 'Length' ||
    measurement?.mode === 'repeated' ||
    !getLinearLVLengthLabel(measurement)
  ) {
    return null;
  }

  const measurements = measurement?.measurements || {};
  const native = getCurrentFrameNativeLengthSource(measurement);
  // Persisted annotations have a canonical measurements payload.
  // Unsaved OHIF records may have an object-valued top-level value/display
  // adapter: the exact native image data is authoritative in that case.
  // Never use a normalized UI unit to validate raw native pixel statistics.
  const hasSavedScalar = measurements.length != null || measurements.value != null;
  const rawValue = hasSavedScalar
    ? measurements.length ?? measurements.value
    : native ? native.value : measurement?.value;
  const rawUnit = hasSavedScalar
    ? (measurements.lengthUnit || measurements.unit || measurement?.unit)
    : native ? native.unit : measurement?.unit;
  const value = finitePositiveNumber(rawValue);
  const unit = String(rawUnit || '').trim().toLowerCase();

  if (value === null) return null;
  if (unit === 'mm') return value;
  if (unit === 'cm') return value * 10;
  return null;
}

export function calculateEchoLinearLVMeasurements(measurements: any[] = []) {
  const lengthsMM: Record<string, number> = {};

  for (const measurement of Array.isArray(measurements) ? measurements : []) {
    const label = getLinearLVLengthLabel(measurement);
    if (
      !label ||
      !hasEchoMeasurementDomain(measurement) ||
      String(measurement?.toolName || '').trim() !== 'Length' ||
      measurement?.mode === 'repeated'
    ) {
      continue;
    }

    // The panel keeps the original physical calibration before normalizing
    // units for display. null means unusable; never turn display 'px' into mm.
    const sourceMM = Object.prototype.hasOwnProperty.call(
      measurement, 'arCalibratedEchoLengthMM'
    )
      ? measurement.arCalibratedEchoLengthMM
      : getCalibratedEchoLinearLengthMM(measurement);
    const numericMM = finitePositiveNumber(sourceMM);
    if (numericMM !== null) {
      // FormAPI writes named lengths to one decimal before deriving RWT/LV mass.
      // Align the preview's source precision with the saved report.
      lengthsMM[label] = Number(numericMM.toFixed(1));
    }
  }

  const lviddMM = lengthsMM.LVIDd;
  const pwdMM = lengthsMM.PWd;
  const ivsdMM = lengthsMM.IVSd;
  const relativeWallThickness =
    lviddMM > 0 && pwdMM > 0
      ? ((2 * pwdMM) / lviddMM).toFixed(2)
      : null;

  let lvMassG: string | null = null;
  if (lviddMM > 0 && pwdMM > 0 && ivsdMM > 0) {
    const lviddCM = lviddMM / 10;
    const pwdCM = pwdMM / 10;
    const ivsdCM = ivsdMM / 10;
    const outerDiameterCM = ivsdCM + lviddCM + pwdCM;
    const massG =
      0.8 * 1.04 * (outerDiameterCM ** 3 - lviddCM ** 3) + 0.6;

    if (Number.isFinite(massG) && massG > 0) {
      lvMassG = massG.toFixed(0);
    }
  }

  if (relativeWallThickness === null && lvMassG === null) return null;
  return { relativeWallThickness, lvMassG };
}
