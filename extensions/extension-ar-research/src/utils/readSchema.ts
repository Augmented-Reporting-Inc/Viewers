function cleanString(value: unknown) {
  return String(value || '').trim();
}

function cleanKey(value: unknown) {
  return cleanString(value)
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
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

export function buildReadValueMap(readResults: any = {}) {
  const values: Record<string, any> = {};

  for (const entry of Array.isArray(readResults?.entries) ? readResults.entries : []) {
    const componentKey = cleanKey(entry?.componentKey);
    const segmentKey = cleanKey(entry?.segmentKey);
    if (!componentKey) continue;

    values[`${componentKey}|${segmentKey}`] = entry.value;
  }

  return values;
}

export function buildReadResultEntries(fields: any[] = [], values: Record<string, any> = {}) {
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
        source: 'manual',
      },
    ];
  });
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
