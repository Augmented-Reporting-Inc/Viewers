function cleanString(value: unknown) {
  return String(value || '').trim();
}

function cleanKey(value: unknown) {
  return cleanString(value)
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeMeasurementLabels(value: any) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map(cleanString)
        .filter(Boolean)
    )
  );
}

function normalizeMeasurementLabelToken(value: unknown) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeMeasurementUnit(value: unknown) {
  return cleanString(value)
    .replace(/[\u00b5\u03bc]/g, 'u')
    .toLowerCase();
}

function convertMeasurementValue(
  value: unknown,
  sourceUnit: unknown,
  targetUnit: unknown
) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const source = normalizeMeasurementUnit(sourceUnit);
  const target = normalizeMeasurementUnit(targetUnit);

  if (!target) {
    return numericValue;
  }

  if (!source) {
    return null;
  }

  if (source === target) {
    return numericValue;
  }

  if (source === 'cm' && target === 'mm') {
    return numericValue * 10;
  }

  if (source === 'mm' && target === 'cm') {
    return numericValue / 10;
  }

  return null;
}

function roundToConfiguredStep(value: number, step: unknown) {
  const numericStep = Number(step);

  if (!Number.isFinite(numericStep) || numericStep <= 0) {
    return value;
  }

  return Number(
    (Math.round(value / numericStep) * numericStep).toFixed(8)
  );
}

function normalizeOptions(value: any) {
  return (Array.isArray(value) ? value : [])
    .map(option => {
      if (option && typeof option === 'object' && !Array.isArray(option)) {
        const optionValue = cleanString(option.value ?? option.label);
        return optionValue
          ? {
              value: optionValue,
              label: cleanString(option.label || optionValue),
            }
          : null;
      }

      const optionValue = cleanString(option);
      return optionValue
        ? {
            value: optionValue,
            label: optionValue,
          }
        : null;
    })
    .filter(Boolean);
}

export function normalizeReadSchema(readSchema: any = {}) {
  const schema =
    readSchema && typeof readSchema === 'object' && !Array.isArray(readSchema)
      ? readSchema
      : {};

  return {
    schemaKey: cleanString(schema.schemaKey),
    schemaVersion: cleanString(schema.schemaVersion),
    domain: cleanString(schema.domain).toLowerCase(),
    compatibilitySource: cleanString(schema.compatibilitySource),
    segments: (Array.isArray(schema.segments) ? schema.segments : [])
      .map(segment => {
        const key = cleanKey(typeof segment === 'string' ? segment : segment?.key);
        return key
          ? {
              key,
              label: cleanString(
                typeof segment === 'string' ? segment : segment?.label || key
              ),
            }
          : null;
      })
      .filter(Boolean),
    components: (Array.isArray(schema.components) ? schema.components : [])
      .map(component => {
        const componentKey = cleanKey(
          typeof component === 'string'
            ? component
            : component?.componentKey || component?.key
        );
        if (!componentKey) return null;

        const config =
          component?.config &&
          typeof component.config === 'object' &&
          !Array.isArray(component.config)
            ? component.config
            : {};

        return {
          componentKey,
          label: cleanString(component?.label || componentKey),
          kind: cleanString(component?.kind || 'observation').toLowerCase(),
          required: component?.required !== false,
          segmentKeys: (Array.isArray(component?.segmentKeys)
            ? component.segmentKeys
            : []
          )
            .map(cleanKey)
            .filter(Boolean),
          config: {
            ...config,
            unit: cleanString(config.unit),
            options: normalizeOptions(config.options),
            measurementLabels: normalizeMeasurementLabels(
              config.measurementLabels
            ),
          },
        };
      })
      .filter(Boolean),
  };
}

export function buildReadFields(readSchema: any = {}) {
  const schema = normalizeReadSchema(readSchema);
  const segmentLabels = new Map(
    schema.segments.map(segment => [segment.key, segment.label])
  );
  const fields: any[] = [];

  for (const component of schema.components) {
    const segmentKeys = component.segmentKeys.length ? component.segmentKeys : [''];

    for (const segmentKey of segmentKeys) {
      fields.push({
        key: `${component.componentKey}|${segmentKey}`,
        componentKey: component.componentKey,
        segmentKey,
        label: segmentKey
          ? `${segmentLabels.get(segmentKey) || segmentKey} - ${component.label}`
          : component.label,
        componentLabel: component.label,
        kind: component.kind,
        required: component.required,
        config: component.config,
      });
    }
  }

  return fields;
}

export function buildReadValueState(readResults: any = {}) {
  const values: Record<string, any> = {};
  const sources: Record<string, any> = {};

  for (const entry of Array.isArray(readResults?.entries) ? readResults.entries : []) {
    const componentKey = cleanKey(entry?.componentKey);
    const segmentKey = cleanKey(entry?.segmentKey);
    if (!componentKey) continue;

    const fieldKey = `${componentKey}|${segmentKey}`;

    values[fieldKey] = entry.value;
    sources[fieldKey] = {
      source: cleanString(entry?.source || 'manual').toLowerCase() || 'manual',
      sourceMeasurementKey: cleanString(entry?.sourceMeasurementKey),
    };
  }

  return {
    values,
    sources,
  };
}

export function buildReadValueMap(readResults: any = {}) {
  return buildReadValueState(readResults).values;
}

export function buildReadResultEntries(
  fields: any[] = [],
  values: Record<string, any> = {},
  valueSources: Record<string, any> = {}
) {
  return fields.flatMap(field => {
    const rawValue = values[field.key];

    if (
      rawValue === null ||
      typeof rawValue === 'undefined' ||
      (typeof rawValue === 'string' && !rawValue.trim())
    ) {
      return [];
    }

    const numericKind = ['measurement', 'continuous', 'number', 'numeric'].includes(
      field.kind
    );
    const value =
      numericKind && rawValue !== ''
        ? Number(rawValue)
        : typeof rawValue === 'string'
          ? rawValue.trim()
          : rawValue;

    if (numericKind && !Number.isFinite(value)) {
      return [];
    }

    return [
      {
        componentKey: field.componentKey,
        segmentKey: field.segmentKey,
        value,
        unit: cleanString(field.config?.unit),
        source:
          cleanString(valueSources?.[field.key]?.source).toLowerCase() ||
          'manual',
        sourceMeasurementKey: cleanString(
          valueSources?.[field.key]?.sourceMeasurementKey
        ),
      },
    ];
  });
}

export function buildViewerMeasurementReadUpdates(
  fields: any[] = [],
  candidates: any[] = [],
  valueSources: Record<string, any> = {}
) {
  const updates: any[] = [];

  for (const field of fields) {
    const numericKind = ['measurement', 'continuous', 'number', 'numeric'].includes(
      cleanString(field?.kind).toLowerCase()
    );

    if (!numericKind) {
      continue;
    }

    const configuredTokens = new Set(
      normalizeMeasurementLabels(field?.config?.measurementLabels)
        .map(normalizeMeasurementLabelToken)
        .filter(Boolean)
    );

    if (!configuredTokens.size) {
      continue;
    }

    const currentSource = cleanString(
      valueSources?.[field.key]?.source
    ).toLowerCase();

    if (
      currentSource &&
      !['viewer-measurement', 'viewer-derived'].includes(currentSource)
    ) {
      continue;
    }

    let matchedCandidate = null;

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const candidateTokens = normalizeMeasurementLabels(candidate?.labels)
        .map(normalizeMeasurementLabelToken)
        .filter(Boolean);

      if (candidateTokens.some(token => configuredTokens.has(token))) {
        matchedCandidate = candidate;
      }
    }

    if (!matchedCandidate) {
      continue;
    }

    let value = convertMeasurementValue(
      matchedCandidate.value,
      matchedCandidate.unit,
      field?.config?.unit
    );

    if (value === null) {
      continue;
    }

    value = roundToConfiguredStep(value, field?.config?.step);

    const min = Number(field?.config?.min);
    const max = Number(field?.config?.max);

    if (Number.isFinite(min) && value < min) {
      continue;
    }

    if (Number.isFinite(max) && value > max) {
      continue;
    }

    updates.push({
      fieldKey: field.key,
      value,
      source:
        cleanString(matchedCandidate?.source).toLowerCase() ||
        'viewer-measurement',
      sourceMeasurementKey: cleanString(
        matchedCandidate?.sourceMeasurementKey
      ),
    });
  }

  return updates;
}

export function getMissingRequiredReadFields(
  fields: any[] = [],
  values: Record<string, any> = {}
) {
  return fields.filter(field => {
    if (!field.required) return false;

    const value = values[field.key];
    return (
      value === null ||
      typeof value === 'undefined' ||
      (typeof value === 'string' && !value.trim())
    );
  });
}
