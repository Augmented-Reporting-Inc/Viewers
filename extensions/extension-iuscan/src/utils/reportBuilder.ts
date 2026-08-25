import { SITES, DOPPLER_MAP, MEASUREMENT_GROUPS } from './labelMap';
import { buildIuscanSiteMeasurementState } from './repeatedMeasurements';

const hasStrictureSelected = obs =>
  Array.isArray(obs?.complicationTypes) && obs.complicationTypes.includes('stricture');

const sanitizeMeasurementUnit = unit =>
  String(unit || 'mm')
    .replace(/\s*US Region\s*/gi, '')
    .trim() || 'mm';

const toMillimeters = (value, unit) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const cleanUnit = sanitizeMeasurementUnit(unit);
  return /^cm\b/i.test(cleanUnit) ? numeric * 10 : numeric;
};

const formatMm = value => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '';
};

const resolveMeasurementValue = value => {
  if (!value) {
    return null;
  }

  const stats = value?.data && typeof value.data === 'object' ? Object.values(value.data)[0] : null;
  const measurements = value?.measurements || {};
  const numeric = toMillimeters(
    value.value ?? value.length ?? measurements.length ?? measurements.value ?? stats?.length,
    value.unit ?? value.lengthUnit ?? measurements.lengthUnit ?? measurements.unit ?? stats?.unit
  );

  return numeric == null ? null : numeric;
};

const mean = values => values.reduce((a, b) => a + b, 0) / values.length;

export function buildReportPayload({
  liveMeasurements = [],
  savedAnnotations = [],
  removedAnnotationIds = [],
  observationsBySite = {},
} = {}) {
  const payload = {};
  const measurementState = buildIuscanSiteMeasurementState({
    liveMeasurements,
    savedAnnotations,
    removedAnnotationIds,
  });

  for (const siteConfig of SITES) {
    const { key, mongoPrefix } = siteConfig;
    const siteState = measurementState[key] || {};
    const groupMeans = {};

    for (const group of MEASUREMENT_GROUPS) {
      const values = (siteState[group.stateKey]?.slots || [])
        .map(resolveMeasurementValue)
        .filter(value => value !== null);

      if (!values.length) {
        continue;
      }

      const avg = mean(values);
      groupMeans[group.stateKey] = { avg, role: group.role };
      payload[`${mongoPrefix}${group.suffix}`] = formatMm(avg);
      payload[`${mongoPrefix}${group.suffix}UOM`] = 'mm';
    }

    const bwtMeans = Object.values(groupMeans).filter(item => item.role === 'bwt');
    if (bwtMeans.length) {
      payload[`${mongoPrefix}BWT`] = formatMm(mean(bwtMeans.map(item => item.avg)));
      payload[`${mongoPrefix}BWTUOM`] = 'mm';
    }

    const submucosaMeans = Object.values(groupMeans).filter(item => item.role === 'submucosa');
    if (submucosaMeans.length) {
      payload[`${mongoPrefix}Submucosa`] = formatMm(mean(submucosaMeans.map(item => item.avg)));
      payload[`${mongoPrefix}SubmucosaUOM`] = 'mm';
    }

    const obs = observationsBySite[key] || {};

    if (obs.doppler != null) {
      payload[`${mongoPrefix}ColorDopplerSignal`] = DOPPLER_MAP[obs.doppler] ?? '0';
    }
    if (obs.inflammatoryFat != null) {
      const labels = ['None', 'Partial', 'Complete'];
      payload[`${mongoPrefix}InflammatoryMesentericFat`] =
        labels[obs.inflammatoryFat] ?? 'None';
    }
    if (obs.lymphadenopathy != null) {
      payload[`${mongoPrefix}Lymphadenopathy`] = obs.lymphadenopathy > 0 ? 'Yes' : 'No';
    }
    if (obs.stratification != null) {
      const labels = ['Normal', 'Focal', 'Complete'];
      payload[`${mongoPrefix}LossOfStratification`] = labels[obs.stratification] ?? 'Normal';
    }
    if (siteConfig.hasHaustrations && obs.haustrations != null) {
      payload[`${mongoPrefix}Haustrations`] = obs.haustrations > 0 ? 'Present' : 'Absent';
    }

    if (siteConfig.hasSegmentLength) {
      const segmentLength = String(obs.segmentLength ?? '').trim();
      if (segmentLength) {
        payload[`${mongoPrefix}SegmentLength`] = segmentLength;
        payload[`${mongoPrefix}SegmentLengthUOM`] = 'cm';
      }
    }

    if (siteConfig.hasComplications && obs.complications != null) {
      const hasComplications = obs.complications > 0;
      payload[`${mongoPrefix}Complications`] = hasComplications ? 'Yes' : 'No';
      payload[`${mongoPrefix}ComplicationTypes`] = hasComplications
        ? (obs.complicationTypes ?? []).join(', ')
        : '';
      payload[`${mongoPrefix}ComplicationText`] = hasComplications
        ? String(obs.complicationText ?? '').trim()
        : '';

      const shouldWriteStrictureDetails = hasComplications && hasStrictureSelected(obs);
      const writeStrictureField = (suffix, value) => {
        const normalized = String(value ?? '').trim();
        payload[`${mongoPrefix}${suffix}`] = shouldWriteStrictureDetails ? normalized : '';
        payload[`${mongoPrefix}${suffix}UOM`] =
          shouldWriteStrictureDetails && normalized ? 'cm' : '';
      };

      writeStrictureField('StrictureMaxBWT', obs.strictureMaxBWT);
      writeStrictureField('StrictureMinimalLuminalDiameter', obs.strictureMinimalLuminalDiameter);
      writeStrictureField('StrictureLength', obs.strictureLength);
      writeStrictureField('StrictureUpstreamDilation', obs.strictureUpstreamDilation);
    }
  }

  return payload;
}

export function hydrateBowelObservationsFromSeriesDoc(seriesDoc = {}) {
  const result = {};

  for (const site of SITES) {
    const prefix = site.mongoPrefix;
    const doppler = seriesDoc[`${prefix}ColorDopplerSignal`];
    const inflammatoryFat = seriesDoc[`${prefix}InflammatoryMesentericFat`];
    const lymphadenopathy = seriesDoc[`${prefix}Lymphadenopathy`];
    const stratification = seriesDoc[`${prefix}LossOfStratification`];
    const haustrations = seriesDoc[`${prefix}Haustrations`];
    const complicationTypes = seriesDoc[`${prefix}ComplicationTypes`];

    result[site.key] = {
      doppler:
        doppler === 'III' || doppler === '3'
          ? 3
          : doppler === 'II' || doppler === '2'
            ? 2
            : doppler === 'I' || doppler === '1'
              ? 1
              : doppler === '0'
                ? 0
                : null,
      inflammatoryFat:
        inflammatoryFat === 'Complete' || inflammatoryFat === 2 || inflammatoryFat === '2'
          ? 2
          : inflammatoryFat === 'Partial' || inflammatoryFat === 1 || inflammatoryFat === '1'
            ? 1
            : inflammatoryFat === 'None' || inflammatoryFat === 0 || inflammatoryFat === '0'
              ? 0
              : inflammatoryFat === 'Yes'
                ? 2
                : inflammatoryFat === 'No'
                  ? 0
                  : null,
      lymphadenopathy:
        lymphadenopathy === 'Yes' ? 1 : lymphadenopathy === 'No' ? 0 : null,
      stratification:
        ['Complete', 'Extensive disruption', 2, '2', 'Yes'].includes(stratification)
          ? 2
          : ['Focal', 'Focal disruption', 1, '1'].includes(stratification)
            ? 1
            : ['Normal', 0, '0', 'No'].includes(stratification)
              ? 0
              : null,
      haustrations:
        haustrations === 'Present' ? 1 : haustrations === 'Absent' ? 0 : null,
      segmentLength: String(seriesDoc[`${prefix}SegmentLength`] ?? ''),
      complications:
        seriesDoc[`${prefix}Complications`] === 'Yes'
          ? 1
          : seriesDoc[`${prefix}Complications`] === 'No'
            ? 0
            : null,
      complicationTypes: Array.isArray(complicationTypes)
        ? complicationTypes
        : String(complicationTypes || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean),
      complicationText: String(seriesDoc[`${prefix}ComplicationText`] ?? ''),
      strictureMaxBWT: String(seriesDoc[`${prefix}StrictureMaxBWT`] ?? ''),
      strictureMinimalLuminalDiameter: String(
        seriesDoc[`${prefix}StrictureMinimalLuminalDiameter`] ?? ''
      ),
      strictureLength: String(seriesDoc[`${prefix}StrictureLength`] ?? ''),
      strictureUpstreamDilation: String(seriesDoc[`${prefix}StrictureUpstreamDilation`] ?? ''),
    };
  }

  return result;
}

export function getLegacyIuscanMeasurementPlaceholders(seriesDoc = {}, savedAnnotations = []) {
  const occupiedGroups = new Set(
    (savedAnnotations || []).flatMap(annotation => {
      const repeated = annotation?.repeatedMeasurement || {};
      const groupKey = String(repeated.groupKey || '').trim();
      const label = String(annotation?.label || annotation?.measurementRole || annotation?.role || '').trim();
      return [groupKey, label].filter(Boolean);
    })
  );

  const placeholders = [];

  for (const site of SITES) {
    for (const group of MEASUREMENT_GROUPS) {
      const groupKey = `${site.code}:${group.stateKey}`;
      const label = `${site.code}-${group.labelSuffix || group.suffix}`;

      if (occupiedGroups.has(groupKey) || occupiedGroups.has(label)) {
        continue;
      }

      const fieldName = `${site.mongoPrefix}${group.suffix}`;
      const rawValue = seriesDoc[fieldName];
      const value = toMillimeters(rawValue, seriesDoc[`${fieldName}UOM`] || 'mm');

      if (value == null) {
        continue;
      }

      placeholders.push({
        annotationId: `legacy:${fieldName}`,
        uid: `legacy:${fieldName}`,
        workflow: 'viewerMeasurements',
        domain: 'bowel',
        mode: 'repeated',
        role: label,
        label,
        measurementRole: label,
        toolName: 'Length',
        repeatedMeasurement: {
          groupKey,
          siteKey: site.key,
          stateKey: group.stateKey,
          axis: group.axis,
          measurementType: group.role,
          slotIndex: 0,
          pairIndex: 0,
          maxSlots: 3,
          aggregation: 'average',
        },
        value,
        unit: 'mm',
        source: 'legacy-series-field',
        sourceField: fieldName,
        measurements: {
          value,
          length: value,
          unit: 'mm',
          lengthUnit: 'mm',
          displayText: [`${value.toFixed(2)} mm`],
        },
        displayText: [`${value.toFixed(2)} mm`],
      });
    }
  }

  return placeholders;
}
