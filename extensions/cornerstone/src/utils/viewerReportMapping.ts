import { SPECTRAL_DOPPLER_MEASUREMENT_KIND } from './spectralDoppler';

export type ViewerReportMapping = {
  targetKey: string;
  targetLabel: string;
  assignedAt?: string;
};

type ViewerReportTargetDefinition = {
  key: string;
  label: string;
  measurementKind: string;
  valueField: string;
  uomField: string;
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

const VIEWER_REPORT_TARGET_DEFINITIONS: readonly ViewerReportTargetDefinition[] = Object.freeze([
  {
    key: 'echo.lvotVti',
    label: 'LVOT VTI',
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    valueField: 'LVOTVTI',
    uomField: 'LVOTVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.avVti',
    label: 'AV VTI',
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    valueField: 'AVVTI',
    uomField: 'AVVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.pvVti',
    label: 'PV VTI',
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    valueField: 'PVVTI',
    uomField: 'PVVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.arVti',
    label: 'AR VTI',
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    valueField: 'ARVTI',
    uomField: 'ARVTIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
  {
    key: 'echo.mvTvi',
    label: 'MV TVI',
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    valueField: 'MVTVI',
    uomField: 'MVTVIUOM',
    uom: 'cm',
    valuePath: ['spectralDoppler', 'values', 'vtiCM'],
    formatValue: formatVtiCentimeters,
  },
]);

const VIEWER_REPORT_TARGET_BY_KEY = new Map(
  VIEWER_REPORT_TARGET_DEFINITIONS.map(definition => [definition.key, definition])
);

const SPECTRAL_DOPPLER_VTI_TARGET_KEYS = new Set(
  VIEWER_REPORT_TARGET_DEFINITIONS.filter(
    definition => definition.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND
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
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ');
}

function getValueAtPath(source: any, path: readonly string[]) {
  return path.reduce((value, key) => value?.[key], source);
}

function getAnnotationMeasurementKind(annotation: any = {}) {
  return String(
    annotation?.measurementKind ||
      annotation?.measurements?.measurementKind ||
      annotation?.spectralDoppler?.measurementKind ||
      annotation?.measurements?.spectralDoppler?.measurementKind ||
      ''
  ).trim();
}

function getAnnotationReportMapping(annotation: any = {}): ViewerReportMapping | null {
  const mapping =
    annotation?.reportMapping ||
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

export function getSpectralDopplerVtiTargetOptions({ includeGeneric = false } = {}) {
  const options = VIEWER_REPORT_TARGET_DEFINITIONS.filter(definition =>
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

  const labelMatch = VIEWER_REPORT_TARGET_DEFINITIONS.find(
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
    const mapping = getAnnotationReportMapping(annotation);
    if (!mapping) {
      return;
    }

    const definition = VIEWER_REPORT_TARGET_BY_KEY.get(mapping.targetKey);
    if (!definition) {
      return;
    }

    if (getAnnotationMeasurementKind(annotation) !== definition.measurementKind) {
      return;
    }

    const spectralDoppler =
      annotation?.spectralDoppler || annotation?.measurements?.spectralDoppler || null;

    if (
      definition.measurementKind === SPECTRAL_DOPPLER_MEASUREMENT_KIND &&
      String(spectralDoppler?.status || '').trim() !== 'complete'
    ) {
      return;
    }

    const rawValue = getValueAtPath(getAnnotationMappingValueSource(annotation), definition.valuePath);
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
    updates[definition.uomField] = definition.uom;
  }

  return updates;
}
