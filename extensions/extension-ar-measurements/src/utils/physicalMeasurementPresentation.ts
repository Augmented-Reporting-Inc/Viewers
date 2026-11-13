/**
 * Frontend-only physical measurement/presentation contract.
 *
 * DICOM (or another authoritative acquisition) calibrates geometry upstream.
 * This module never infers physical calibration from pixels, Cornerstone world
 * coordinates, generic ROI labels, or an absent unit. It converts an already
 * physically verified quantity and applies a configurable display policy.
 *
 * No FormAPI/backend files import this module. Server validation/scoring must
 * independently enforce the corresponding explicit API value/unit contract.
 */
export type PhysicalDimension =
  | 'length' | 'area' | 'volume' | 'velocity'
  | 'time' | 'percentage' | 'pressure' | 'ratio';

type UnitDefinition = Readonly<{
  dimension: PhysicalDimension;
  toBase: number;
  symbol: string;
}>;

const PHYSICAL_UNITS: Readonly<Record<string, UnitDefinition>> = Object.freeze({
  mm: { dimension: 'length', toBase: 1, symbol: 'mm' },
  cm: { dimension: 'length', toBase: 10, symbol: 'cm' },
  m: { dimension: 'length', toBase: 1000, symbol: 'm' },
  mm2: { dimension: 'area', toBase: 1, symbol: 'mm²' },
  cm2: { dimension: 'area', toBase: 100, symbol: 'cm²' },
  m2: { dimension: 'area', toBase: 1000000, symbol: 'm²' },
  ml: { dimension: 'volume', toBase: 1, symbol: 'mL' },
  l: { dimension: 'volume', toBase: 1000, symbol: 'L' },
  'm/s': { dimension: 'velocity', toBase: 1, symbol: 'm/s' },
  'cm/s': { dimension: 'velocity', toBase: 0.01, symbol: 'cm/s' },
  ms: { dimension: 'time', toBase: 1, symbol: 'ms' },
  s: { dimension: 'time', toBase: 1000, symbol: 's' },
  '%': { dimension: 'percentage', toBase: 1, symbol: '%' },
  mmhg: { dimension: 'pressure', toBase: 1, symbol: 'mmHg' },
  '1': { dimension: 'ratio', toBase: 1, symbol: '' },
});

/** Only explicit *physical* unit strings are valid. Never accept px/px². */
export function normalizePhysicalUnit(unit: unknown): string | null {
  if (unit == null) return null;
  const token = String(unit).trim().toLowerCase()
    .replace(/\s+/g, '').replace(/²/g, '2').replace(/³/g, '3');
  const aliases: Record<string, string> = {
    'millimeter': 'mm', 'millimeters': 'mm',
    'centimeter': 'cm', 'centimeters': 'cm',
    'milliliter': 'ml', 'milliliters': 'ml',
    'millilitre': 'ml', 'millilitres': 'ml',
    'liter': 'l', 'liters': 'l', 'litre': 'l', 'litres': 'l',
    'percent': '%', 'percentage': '%',
    'cm/sec': 'cm/s', 'm/sec': 'm/s',
  };
  const canonical = aliases[token] || token;
  return Object.prototype.hasOwnProperty.call(PHYSICAL_UNITS, canonical)
    ? canonical : null;
}

export function getPhysicalUnitDimension(unit: unknown): PhysicalDimension | null {
  const canonical = normalizePhysicalUnit(unit);
  return canonical ? PHYSICAL_UNITS[canonical].dimension : null;
}

/**
 * Unit conversion, not calibration or evidence validation.
 * Caller must first establish that the source quantity is physically valid.
 * Rejects dimension mismatches, pixels, absent units, NaN and Infinity.
 */
export function convertPhysicalValue(
  value: unknown, sourceUnit: unknown, targetUnit: unknown,
  requiredDimension?: PhysicalDimension
): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const numeric = Number(value);
  const source = normalizePhysicalUnit(sourceUnit);
  const target = normalizePhysicalUnit(targetUnit);
  if (!Number.isFinite(numeric) || !source || !target) return null;
  const from = PHYSICAL_UNITS[source];
  const to = PHYSICAL_UNITS[target];
  if (from.dimension !== to.dimension ||
      (requiredDimension && from.dimension !== requiredDimension)) return null;
  const result = numeric * from.toBase / to.toBase;
  return Number.isFinite(result) ? result : null;
}

export type MeasurementDisplayDefinition = Readonly<{
  dimension: PhysicalDimension;
  unit: string;
  decimals: number;
}>;

/**
 * Product defaults, not tenant checks. Callers may supply a dimension-safe
 * presentation override through existing tenant/role configuration.
 * These are presentation units; clinical report UOM contracts are separate.
 */
export const MEASUREMENT_DISPLAY_DEFINITIONS:
  Readonly<Record<string, MeasurementDisplayDefinition>> = Object.freeze({
  rvEDA: { dimension: 'area', unit: 'cm²', decimals: 2 },
  rvESA: { dimension: 'area', unit: 'cm²', decimals: 2 },
  raArea: { dimension: 'area', unit: 'cm²', decimals: 2 },
  laArea: { dimension: 'area', unit: 'cm²', decimals: 2 },
  laA4C: { dimension: 'area', unit: 'cm²', decimals: 2 },
  laA2C: { dimension: 'area', unit: 'cm²', decimals: 2 },
  laVolume: { dimension: 'volume', unit: 'mL', decimals: 1 },
  lvVolume: { dimension: 'volume', unit: 'mL', decimals: 1 },
  bowelWallThickness: { dimension: 'length', unit: 'mm', decimals: 1 },
  ivcDiameter: { dimension: 'length', unit: 'mm', decimals: 1 },
  rvFAC: { dimension: 'percentage', unit: '%', decimals: 1 },
  lvEF: { dimension: 'percentage', unit: '%', decimals: 1 },
  ivcCollapsibility: { dimension: 'percentage', unit: '%', decimals: 1 },
  trVmax: { dimension: 'velocity', unit: 'm/s', decimals: 2 },
  trVTI: { dimension: 'length', unit: 'cm', decimals: 1 },
  decelerationTime: { dimension: 'time', unit: 'ms', decimals: 0 },
  rvSP: { dimension: 'pressure', unit: 'mmHg', decimals: 0 },
});

/**
 * Reject invalid overrides; never reinterpret a dimension or merely relabel
 * its magnitude. Unknown measurement kinds must declare their own policy.
 */
export function resolveMeasurementDisplayPolicy(
  measurementKind: string,
  override: Partial<MeasurementDisplayDefinition> = {}
): MeasurementDisplayDefinition | null {
  const definition = MEASUREMENT_DISPLAY_DEFINITIONS[measurementKind];
  if (!definition) return null;
  if (override.dimension && override.dimension !== definition.dimension) return null;
  const unit = override.unit || definition.unit;
  if (getPhysicalUnitDimension(unit) !== definition.dimension) return null;
  const decimals = override.decimals ?? definition.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) return null;
  const canonicalUnit = normalizePhysicalUnit(unit);
  return canonicalUnit
    ? { dimension: definition.dimension, unit: PHYSICAL_UNITS[canonicalUnit].symbol, decimals }
    : null;
}

export type VerifiedPhysicalMeasurement = Readonly<{
  value: number;
  unit: string;
  measurementKind: string;
  verified: boolean; // Only true is accepted, after source/evidence validation.
  calibrationSource?: string;
  sourceReference?: unknown;
}>;

/**
 * UI contract shared by the viewport and panels: use the same result for
 * text and numerical display. No default to 'mm' when a unit is missing.
 * This is deliberately not a calculator; the source remains authoritative.
 */
export function presentVerifiedPhysicalMeasurement(
  measurement: Partial<VerifiedPhysicalMeasurement> | null | undefined,
  override: Partial<MeasurementDisplayDefinition> = {}
) {
  if (!measurement || measurement.verified !== true) return null;
  const policy = resolveMeasurementDisplayPolicy(
    String(measurement.measurementKind || ''), override
  );
  if (!policy) return null;
  const value = convertPhysicalValue(
    measurement.value, measurement.unit, policy.unit, policy.dimension
  );
  if (value == null) return null;
  const sourceUnit = normalizePhysicalUnit(measurement.unit);
  return {
    dimension: policy.dimension,
    value,
    unit: policy.unit,
    text: `${value.toFixed(policy.decimals)}${policy.unit ? ' ' + policy.unit : ''}`,
    sourceValue: measurement.value,
    sourceUnit: sourceUnit ? PHYSICAL_UNITS[sourceUnit].symbol : '',
    calibrationSource: measurement.calibrationSource || '',
    sourceReference: measurement.sourceReference ?? null,
  };
}
