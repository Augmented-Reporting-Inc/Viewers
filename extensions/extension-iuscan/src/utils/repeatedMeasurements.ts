import { LABEL_MAP, MEASUREMENT_GROUPS, SITES } from './labelMap';

const normalizeText = value => String(value || '').trim();

const getMeasurementId = value =>
  normalizeText(value?.uid || value?.annotationId || value?.annotationUID || value?.id);

const getMeasurementLabel = value =>
  normalizeText(value?.label || value?.measurementRole || value?.role);

const getRepeatedMetadata = value =>
  value?.repeatedMeasurement ||
  value?.metadata?.repeatedMeasurement ||
  value?.data?.repeatedMeasurement ||
  null;

const normalizeSlotIndex = value => {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const SITE_BY_KEY = new Map(SITES.map(site => [site.key, site]));
const GROUP_BY_STATE_KEY = new Map(MEASUREMENT_GROUPS.map(group => [group.stateKey, group]));

function getMappingFromValue(value) {
  const label = getMeasurementLabel(value);
  const labelMapping = LABEL_MAP[label];
  const repeated = getRepeatedMetadata(value);

  if (labelMapping) {
    return {
      siteKey: labelMapping.site,
      stateKey: labelMapping.stateKey || labelMapping.axis,
      role: labelMapping.role,
      axis: labelMapping.measurementAxis || labelMapping.axis,
      label,
    };
  }

  const siteKey = normalizeText(repeated?.siteKey);
  const stateKey = normalizeText(repeated?.stateKey);

  if (SITE_BY_KEY.has(siteKey) && GROUP_BY_STATE_KEY.has(stateKey)) {
    const group = GROUP_BY_STATE_KEY.get(stateKey);
    const site = SITE_BY_KEY.get(siteKey);

    return {
      siteKey,
      stateKey,
      role: normalizeText(repeated?.measurementType || group?.role),
      axis: normalizeText(repeated?.axis || group?.axis),
      label: label || `${site?.code}-${group?.labelSuffix || group?.suffix}`,
    };
  }

  const groupKey = normalizeText(repeated?.groupKey);
  if (groupKey.includes(':')) {
    const [siteCode, candidateStateKey] = groupKey.split(':');
    const site = SITES.find(item => item.code === siteCode);
    const group = GROUP_BY_STATE_KEY.get(candidateStateKey);

    if (site && group) {
      return {
        siteKey: site.key,
        stateKey: group.stateKey,
        role: group.role,
        axis: group.axis,
        label: label || `${site.code}-${group.labelSuffix || group.suffix}`,
      };
    }
  }

  return null;
}

function buildCanonicalRepeatedMetadata(site, group, slotIndex, maxSlots = 3) {
  return {
    groupKey: `${site.code}:${group.stateKey}`,
    siteKey: site.key,
    stateKey: group.stateKey,
    axis: group.axis,
    measurementType: group.role,
    slotIndex,
    pairIndex: slotIndex,
    maxSlots,
    aggregation: 'average',
  };
}

function getCanonicalLabel(site, group) {
  return `${site.code}-${group.labelSuffix || group.suffix}`;
}

function collectUsedSlotIndexes(values, siteKey, stateKey, excludeId = '') {
  const used = new Set();
  const unindexed = [];

  for (const value of values || []) {
    const id = getMeasurementId(value);
    if (!id || id === excludeId) {
      continue;
    }

    const mapping = getMappingFromValue(value);
    if (!mapping || mapping.siteKey !== siteKey || mapping.stateKey !== stateKey) {
      continue;
    }

    const repeated = getRepeatedMetadata(value);
    const slotIndex = normalizeSlotIndex(repeated?.slotIndex ?? repeated?.slot);

    if (slotIndex !== null) {
      used.add(slotIndex);
    } else {
      unindexed.push(value);
    }
  }

  for (const _value of unindexed) {
    let index = 0;
    while (used.has(index)) {
      index += 1;
    }
    used.add(index);
  }

  return used;
}

export function decorateIuscanRepeatedMeasurement({
  measurementService,
  measurement,
  savedAnnotations = [],
  siteKey = '',
  stateKey = '',
  slotIndex = null,
  maxSlots = 3,
} = {}) {
  if (!measurementService || !measurement) {
    return null;
  }

  const measurementId = getMeasurementId(measurement);
  const explicitSite = SITE_BY_KEY.get(siteKey);
  const explicitGroup = GROUP_BY_STATE_KEY.get(stateKey);
  const mapping =
    explicitSite && explicitGroup
      ? {
          siteKey: explicitSite.key,
          stateKey: explicitGroup.stateKey,
          role: explicitGroup.role,
          axis: explicitGroup.axis,
          label: getCanonicalLabel(explicitSite, explicitGroup),
        }
      : getMappingFromValue(measurement);

  if (!measurementId || !mapping) {
    return null;
  }

  const site = SITE_BY_KEY.get(mapping.siteKey);
  const group = GROUP_BY_STATE_KEY.get(mapping.stateKey);
  if (!site || !group) {
    return null;
  }

  const existingRepeated = getRepeatedMetadata(measurement);
  let resolvedSlotIndex = normalizeSlotIndex(
    slotIndex ?? existingRepeated?.slotIndex ?? existingRepeated?.slot
  );

  if (resolvedSlotIndex === null) {
    const liveMeasurements = measurementService.getMeasurements?.() || [];
    const used = collectUsedSlotIndexes(
      [...savedAnnotations, ...liveMeasurements],
      site.key,
      group.stateKey,
      measurementId
    );

    for (let candidate = 0; candidate < maxSlots; candidate += 1) {
      if (!used.has(candidate)) {
        resolvedSlotIndex = candidate;
        break;
      }
    }
  }

  if (resolvedSlotIndex === null || resolvedSlotIndex >= maxSlots) {
    return null;
  }

  const label = getCanonicalLabel(site, group);
  const repeatedMeasurement = buildCanonicalRepeatedMetadata(
    site,
    group,
    resolvedSlotIndex,
    maxSlots
  );

  const alreadyCanonical =
    measurement?.mode === 'repeated' &&
    getMeasurementLabel(measurement) === label &&
    normalizeText(existingRepeated?.groupKey) === repeatedMeasurement.groupKey &&
    normalizeText(existingRepeated?.siteKey) === repeatedMeasurement.siteKey &&
    normalizeText(existingRepeated?.stateKey) === repeatedMeasurement.stateKey &&
    normalizeSlotIndex(existingRepeated?.slotIndex ?? existingRepeated?.slot) === resolvedSlotIndex &&
    Number(existingRepeated?.maxSlots || maxSlots) === maxSlots;

  if (alreadyCanonical) {
    return measurement;
  }

  const nextMeasurement = {
    ...measurement,
    label,
    measurementRole: label,
    role: label,
    mode: 'repeated',
    repeatedMeasurement,
  };

  measurementService.update(measurementId, nextMeasurement, true);
  return nextMeasurement;
}

export function normalizeSavedIuscanRepeatedAnnotations(annotations = []) {
  const usedByGroup = new Map();

  return (annotations || [])
    .filter(annotation => getRepeatedMetadata(annotation) || getMappingFromValue(annotation))
    .map(annotation => {
      const mapping = getMappingFromValue(annotation);
      if (!mapping) {
        return annotation;
      }

      const site = SITE_BY_KEY.get(mapping.siteKey);
      const group = GROUP_BY_STATE_KEY.get(mapping.stateKey);
      if (!site || !group) {
        return annotation;
      }

      const key = `${site.key}:${group.stateKey}`;
      const used = usedByGroup.get(key) || new Set();
      const repeated = getRepeatedMetadata(annotation) || {};
      let slotIndex = normalizeSlotIndex(repeated.slotIndex ?? repeated.slot);

      if (slotIndex === null || used.has(slotIndex)) {
        slotIndex = 0;
        while (used.has(slotIndex)) {
          slotIndex += 1;
        }
      }

      used.add(slotIndex);
      usedByGroup.set(key, used);

      const label = getCanonicalLabel(site, group);
      return {
        ...annotation,
        label,
        measurementRole: label,
        role: label,
        mode: 'repeated',
        repeatedMeasurement: {
          ...repeated,
          ...buildCanonicalRepeatedMetadata(
            site,
            group,
            slotIndex,
            Number(repeated.maxSlots) || 3
          ),
        },
      };
    });
}

export function buildIuscanSiteMeasurementState({
  liveMeasurements = [],
  savedAnnotations = [],
  removedAnnotationIds = [],
} = {}) {
  const removed = new Set((removedAnnotationIds || []).map(normalizeText).filter(Boolean));
  const normalizedSaved = normalizeSavedIuscanRepeatedAnnotations(savedAnnotations).filter(
    annotation => !removed.has(getMeasurementId(annotation))
  );

  const byId = new Map();
  for (const annotation of normalizedSaved) {
    const id = getMeasurementId(annotation);
    if (id) {
      byId.set(id, annotation);
    }
  }

  for (const measurement of liveMeasurements || []) {
    const id = getMeasurementId(measurement);
    if (!id || removed.has(id)) {
      continue;
    }

    if (getRepeatedMetadata(measurement) || getMappingFromValue(measurement)) {
      byId.set(id, measurement);
    }
  }

  const state = {};
  for (const site of SITES) {
    state[site.key] = MEASUREMENT_GROUPS.reduce((acc, group) => {
      acc[group.stateKey] = { slots: Array(3).fill(null) };
      return acc;
    }, {});
  }

  const fallbackIndexes = new Map();

  for (const value of byId.values()) {
    const mapping = getMappingFromValue(value);
    if (!mapping || !state[mapping.siteKey]?.[mapping.stateKey]) {
      continue;
    }

    const repeated = getRepeatedMetadata(value) || {};
    const slots = state[mapping.siteKey][mapping.stateKey].slots;
    let slotIndex = normalizeSlotIndex(repeated.slotIndex ?? repeated.slot);
    const groupKey = `${mapping.siteKey}:${mapping.stateKey}`;

    if (slotIndex === null || slotIndex >= slots.length || slots[slotIndex] !== null) {
      const start = fallbackIndexes.get(groupKey) || 0;
      slotIndex = start;
      while (slotIndex < slots.length && slots[slotIndex] !== null) {
        slotIndex += 1;
      }
      fallbackIndexes.set(groupKey, slotIndex + 1);
    }

    if (slotIndex >= 0 && slotIndex < slots.length && slots[slotIndex] === null) {
      slots[slotIndex] = value;
    }
  }

  return state;
}

export function getIuscanRepeatedAnnotationId(value) {
  return getMeasurementId(value);
}

export function isIuscanRepeatedMeasurement(value) {
  return !!getMappingFromValue(value);
}
