import { DECELERATION_TIME_MEASUREMENT_KIND } from './decelerationTime'; // AR_DECELERATION_TIME
import { SPECTRAL_DOPPLER_MEASUREMENT_KIND } from './spectralDoppler';
import {
  BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND,
  BOWEL_VIEWER_REPORT_TARGETS,
  findBowelMeasurementTarget,
} from '../../../extension-ar-measurements/src/utils/bowelMeasurementTargets';

export type ViewerReportMapping = {
  targetKey: string;
  targetLabel: string;
  assignedAt?: string;
};

type ViewerReportTargetDefinition = {
  key: string;
  label: string;
  measurementKinds: readonly string[];
  valueField: string;
  uomField?: string;
  uom: string;
  valuePath: readonly string[];
  formatValue: (value: number) => string;
};

const GENERIC_SPECTRAL_DOPPLER_VTI_TARGET = Object.freeze({
  key: 'spectral.genericVti',
  label: 'Generic VTI (no AR report mapping)',
  measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
});

export const SPECTRAL_DOPPLER_GENERIC_TARGET_KEY = GENERIC_SPECTRAL_DOPPLER_VTI_TARGET.key;

function formatVtiCentimeters(value: number) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

// AR_DECELERATION_TIME:BEGIN format
function formatMilliseconds(value: number) {
  return Number.isFinite(value) && value > 0 ? `${Math.round(value)}` : '';
}
// AR_DECELERATION_TIME:END format

function formatBowelLengthFromMillimeters(value: number, uom: 'mm' | 'cm', decimals: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }

  const converted = uom === 'cm' ? value / 10 : value;
  return converted.toFixed(decimals);
}

const ECHO_VIEWER_REPORT_TARGET_DEFINITIONS: readonly ViewerReportTargetDefinition[] = Object.freeze([
  {
    key: 'echo.lvotVti',
    label: 'LVOT VTI',
    measurementKinds: [SPECTRAL_DOPPLER_MEASUREMENT_KIND],
    valueField: 'LVOTVTI',
    uomField: 'LVOTVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.avVti',
    label: 'AV VTI',
    measurementKinds: [SPECTRAL_DOPPLER_MEASUREMENT_KIND],
    valueField: 'AVVTI',
    uomField: 'AVVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.pvVti',
    label: 'PV VTI',
    measurementKinds: [SPECTRAL_DOPPLER_MEASUREMENT_KIND],
    valueField: 'PVVTI',
    uomField: 'PVVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.arVti',
    label: 'AR VTI',
    measurementKinds: [SPECTRAL_DOPPLER_MEASUREMENT_KIND],
    valueField: 'ARVTI',
    uomField: 'ARVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.mvTvi',
    label: 'MV TVI',
    measurementKinds: [SPECTRAL_DOPPLER_MEASUREMENT_KIND],
    valueField: 'MVTVI',
    uomField: 'MVTVIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },

  // AR_DECELERATION_TIME:BEGIN target
  {
    key: 'echo.mvDecT',
    label: 'MV Deceleration Time',
    measurementKinds: [DECELERATION_TIME_MEASUREMENT_KIND],
    valueField: 'DecT',
    uomField: 'DecTUOM',
    uom: 'ms',
    valuePath: ['decelerationTime', 'valueMS'],
    formatValue: formatMilliseconds,
  },
  // AR_DECELERATION_TIME:END target
]);

const BOWEL_VIEWER_REPORT_TARGET_DEFINITIONS: readonly ViewerReportTargetDefinition[] = Object.freeze(
  BOWEL_VIEWER_REPORT_TARGETS.map(target => ({
    key: target.key,
    label: target.label,
    measurementKinds: target.measurementKinds,
    valueField: target.valueField,
    uomField: target.uomField,
    uom: target.uom,
    valuePath: ['measurements', 'length'],
    formatValue: (value: number) =>
      formatBowelLengthFromMillimeters(value, target.uom, target.decimals),
  }))
);

const VIEWER_REPORT_TARGET_DEFINITIONS: readonly ViewerReportTargetDefinition[] = Object.freeze([
  ...ECHO_VIEWER_REPORT_TARGET_DEFINITIONS,
  ...BOWEL_VIEWER_REPORT_TARGET_DEFINITIONS,
]);

const VIEWER_REPORT_TARGET_BY_KEY = new Map(
  VIEWER_REPORT_TARGET_DEFINITIONS.map(definition => [definition.key, definition])
);

const SPECTRAL_DOPPLER_VTI_TARGET_KEYS = new Set(
  ECHO_VIEWER_REPORT_TARGET_DEFINITIONS.filter(definition =>
    definition.measurementKinds.includes(SPECTRAL_DOPPLER_MEASUREMENT_KIND)
  ).map(definition => definition.key)
);

function normalizeTargetSelectionText(value: unknown) {
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    value = objectValue.value || objectValue.key || objectValue.label || '';
  }

  return String(value || '').trim();
}

function normalizeTargetLabelText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—_-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function getValueAtPath(source: any, path: readonly string[]) {
  return path.reduce((value, key) => value?.[key], source);
}

function getAnnotationMeasurementKind(annotation: any = {}) {
  const explicitKind = String(
    annotation?.measurementKind ||
      annotation?.measurements?.measurementKind ||
      annotation?.decelerationTime?.measurementKind ||
      annotation?.measurements?.decelerationTime?.measurementKind ||
      annotation?.spectralDoppler?.measurementKind ||
      annotation?.measurements?.spectralDoppler?.measurementKind ||
      ''
  ).trim();

  if (explicitKind) {
    return explicitKind;
  }

  if (
    String(annotation?.toolName || '') === 'Length' ||
    annotation?.measurements?.length != null ||
    annotation?.length != null
  ) {
    return BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND;
  }

  return '';
}

function getAnnotationReportMapping(annotation: any = {}): ViewerReportMapping | null {
  const mapping =
    annotation?.reportMapping ||
    annotation?.decelerationTime?.reportMapping ||
    annotation?.measurements?.decelerationTime?.reportMapping ||
    annotation?.spectralDoppler?.reportMapping ||
    annotation?.measurements?.spectralDoppler?.reportMapping ||
    null;

  const targetKey = String(mapping?.targetKey || '').trim();

  if (!targetKey) {
    return null;
  }

  return {
    targetKey,
    targetLabel: String(mapping?.targetLabel || '').trim(),
    assignedAt: String(mapping?.assignedAt || '').trim() || undefined,
  };
}

function getAnnotationMappingValueSource(annotation: any = {}) {
  return {
    ...annotation,
    decelerationTime:
      annotation?.decelerationTime || annotation?.measurements?.decelerationTime || null,
    spectralDoppler:
      annotation?.spectralDoppler || annotation?.measurements?.spectralDoppler || null,
  };
}

function getMappingAssignedAtMs(mapping: ViewerReportMapping | null) {
  if (!mapping?.assignedAt) {
    return 0;
  }

  const parsed = Date.parse(mapping.assignedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function definitionAcceptsMeasurementKind(
  definition: ViewerReportTargetDefinition,
  measurementKind = ''
) {
  return definition.measurementKinds.includes(String(measurementKind || '').trim());
}

export function getSpectralDopplerVtiTargetOptions({ includeGeneric = false } = {}) {
  const options = ECHO_VIEWER_REPORT_TARGET_DEFINITIONS.filter(definition =>
    SPECTRAL_DOPPLER_VTI_TARGET_KEYS.has(definition.key)
  ).map(definition => ({
    value: definition.key,
    label: definition.label,
  }));

  if (includeGeneric) {
    options.push({
      value: GENERIC_SPECTRAL_DOPPLER_VTI_TARGET.key,
      label: GENERIC_SPECTRAL_DOPPLER_VTI_TARGET.label,
    });
  }

  return options;
}

export function normalizeSpectralDopplerVtiTargetSelection(
  value: unknown,
  { allowGeneric = false } = {}
) {
  const raw = normalizeTargetSelectionText(value);

  if (!raw) {
    return null;
  }

  if (allowGeneric && raw === GENERIC_SPECTRAL_DOPPLER_VTI_TARGET.key) {
    return { ...GENERIC_SPECTRAL_DOPPLER_VTI_TARGET, reportMapped: false };
  }

  const direct = VIEWER_REPORT_TARGET_BY_KEY.get(raw);
  if (direct && SPECTRAL_DOPPLER_VTI_TARGET_KEYS.has(direct.key)) {
    return { ...direct, reportMapped: true };
  }

  const normalizedLabel = normalizeTargetLabelText(raw);

  if (
    allowGeneric &&
    normalizedLabel === normalizeTargetLabelText(GENERIC_SPECTRAL_DOPPLER_VTI_TARGET.label)
  ) {
    return { ...GENERIC_SPECTRAL_DOPPLER_VTI_TARGET, reportMapped: false };
  }

  const labelMatch = ECHO_VIEWER_REPORT_TARGET_DEFINITIONS.find(
    definition =>
      SPECTRAL_DOPPLER_VTI_TARGET_KEYS.has(definition.key) &&
      normalizeTargetLabelText(definition.label) === normalizedLabel
  );

  return labelMatch ? { ...labelMatch, reportMapped: true } : null;
}

export function buildViewerReportMapping(target: any): ViewerReportMapping | null {
  const targetKey = String(target?.key || target?.value || '').trim();
  const targetLabel = String(target?.label || '').trim();

  if (!targetKey || targetKey === SPECTRAL_DOPPLER_GENERIC_TARGET_KEY) {
    return null;
  }

  const definition = VIEWER_REPORT_TARGET_BY_KEY.get(targetKey);
  if (!definition) {
    return null;
  }

  return {
    targetKey: definition.key,
    targetLabel: targetLabel || definition.label,
    assignedAt: new Date().toISOString(),
  };
}

export function buildViewerReportMappingForMeasurement({
  domain = '',
  label = '',
  measurementKind = '',
} = {}): ViewerReportMapping | null {
  if (String(domain || '').trim().toLowerCase() !== 'bowel') {
    return null;
  }

  const target = findBowelMeasurementTarget({
    label,
    measurementKind,
  });

  return target ? buildViewerReportMapping(target) : null;
}

export function getViewerReportTargetKeyForMeasurement(measurement: any = {}) {
  const explicitMapping = getAnnotationReportMapping(measurement);
  const measurementKind = getAnnotationMeasurementKind(measurement);

  if (explicitMapping) {
    const definition = VIEWER_REPORT_TARGET_BY_KEY.get(explicitMapping.targetKey);

    if (definition && definitionAcceptsMeasurementKind(definition, measurementKind)) {
      return definition.key;
    }
  }

  const domain = String(measurement?.domain || '').trim().toLowerCase();

  if (domain !== 'bowel') {
    return '';
  }

  const target = findBowelMeasurementTarget({
    label:
      measurement?.label || measurement?.measurementRole || measurement?.role || '',
    measurementKind,
  });

  return target?.key || '';
}

export function buildViewerReportFieldUpdates(annotations: any[] = []) {
  const latestByTarget = new Map<
    string,
    {
      definition: ViewerReportTargetDefinition;
      value: number;
      assignedAtMs: number;
      index: number;
    }
  >();

  (Array.isArray(annotations) ? annotations : []).forEach((annotation, index) => {
    const measurementKind = getAnnotationMeasurementKind(annotation);
    let mapping = getAnnotationReportMapping(annotation);

    if (!mapping && String(annotation?.domain || '').trim().toLowerCase() === 'bowel') {
      mapping = buildViewerReportMappingForMeasurement({
        domain: 'bowel',
        label: annotation?.label || annotation?.measurementRole || annotation?.role || '',
        measurementKind,
      });
    }

    if (!mapping) {
      return;
    }

    const definition = VIEWER_REPORT_TARGET_BY_KEY.get(mapping.targetKey);
    if (!definition || !definitionAcceptsMeasurementKind(definition, measurementKind)) {
      return;
    }

    // AR_DECELERATION_TIME:BEGIN completion guard
    const decelerationTime =
      annotation?.decelerationTime || annotation?.measurements?.decelerationTime || null;

    if (
      definition.measurementKinds.includes(DECELERATION_TIME_MEASUREMENT_KIND) &&
      String(decelerationTime?.status || '').trim() !== 'complete'
    ) {
      return;
    }

    // AR_DECELERATION_TIME:END completion guard

    const spectralDoppler =
      annotation?.spectralDoppler || annotation?.measurements?.spectralDoppler || null;

    if (
      definition.measurementKinds.includes(SPECTRAL_DOPPLER_MEASUREMENT_KIND) &&
      String(spectralDoppler?.status || '').trim() !== 'complete'
    ) {
      return;
    }

    const rawValue = getValueAtPath(
      getAnnotationMappingValueSource(annotation),
      definition.valuePath
    );
    const value = Number(rawValue);

    if (!Number.isFinite(value) || value <= 0) {
      return;
    }

    const assignedAtMs = getMappingAssignedAtMs(mapping);
    const previous = latestByTarget.get(definition.key);

    if (
      previous &&
      (previous.assignedAtMs > assignedAtMs ||
        (previous.assignedAtMs === assignedAtMs && previous.index > index))
    ) {
      return;
    }

    latestByTarget.set(definition.key, {
      definition,
      value,
      assignedAtMs,
      index,
    });
  });

  const updates: Record<string, string> = {};

  for (const { definition, value } of latestByTarget.values()) {
    const formattedValue = definition.formatValue(value);

    if (!formattedValue) {
      continue;
    }

    updates[definition.valueField] = formattedValue;
    if (definition.uomField) {
      updates[definition.uomField] = definition.uom;
    }
  }

  return updates;
}
