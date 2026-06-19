import { PubSubService } from '@ohif/core';
import {
  SITES,
  LABEL_MAP,
  DOPPLER_REVERSE,
  HAUSTRATION_REVERSE,
  MEASUREMENT_GROUPS,
  MEASUREMENT_SLOT_KEYS,
} from '../utils/labelMap';
import { buildReportPayload } from '../utils/reportBuilder';

const EVENTS = {
  ASSIGNMENT_CHANGED: 'event::iuscan:assignment_changed',
};

/**
 * IUScanAssignmentService
 *
 * Stores which measurementUID occupies
 * each (site, axis, slot) position. All live mm values remain in OHIF's
 * built-in MeasurementService — this service only tracks assignments.
 *
 * State shape (per site):
 * {
 *   longitudinal:          { slots: [null|measurementId, null|measurementId, null|measurementId] },
 *   cross:                 { slots: [null|measurementId, null|measurementId, null|measurementId] },
 *   submucosaLongitudinal: { slots: [null|measurementId, null|measurementId, null|measurementId] },
 *   submucosaCross:        { slots: [null|measurementId, null|measurementId, null|measurementId] },
 *   observations: {
 *     doppler:        null|0|1|2|3,
 *     inflammatoryFat: null|0|1|2,
 *     lymphadenopathy: null|0|1,
 *     stratification:  null|0|1|2,
 *   },
 * }
 */

const sanitizeMeasurementUnit = unit =>
  String(unit || 'mm')
    .replace(/\s*US Region\s*/gi, '')
    .trim() || 'mm';

const toMillimeters = (value, unit = 'mm') => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalizedUnit = sanitizeMeasurementUnit(unit).toLowerCase();
  return /^cm\b/.test(normalizedUnit) ? numeric * 10 : numeric;
};

const buildHydratedMeasurementSlot = ({ value, unit, sourceField }) => {
  const valueInMm = toMillimeters(value, unit);

  if (valueInMm == null) {
    return null;
  }

  return {
    value: valueInMm,
    unit: 'mm',
    source: 'seriesDoc',
    sourceField,
  };
};

const formatMmDisplay = value => `${Number(value).toFixed(2)} mm`;

const firstEmptySlotIndex = slots => slots.findIndex(slot => slot === null);

const parseMaybeJson = value => {
  if (!value) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeRepeatedLabel = annotation => {
  const explicitLabel = annotation?.label || annotation?.measurementRole || annotation?.role || '';
  if (explicitLabel) {
    return explicitLabel;
  }

  const groupKey = annotation?.repeatedMeasurement?.groupKey;
  if (typeof groupKey === 'string' && groupKey.includes(':')) {
    const [siteCode, axisLabel] = groupKey.split(':');
    return `${siteCode}-${axisLabel}`;
  }

  return '';
};

const SITE_BY_CODE = SITES.reduce((acc, site) => {
  if (site?.code) {
    acc[String(site.code).trim().toUpperCase()] = site;
  }
  return acc;
}, {});

const MEASUREMENT_GROUP_BY_STATE_KEY = MEASUREMENT_GROUPS.reduce((acc, group) => {
  if (group?.stateKey) {
    acc[group.stateKey] = group;
  }
  return acc;
}, {});

const getRepeatedGroupKeyParts = annotation => {
  const groupKey = annotation?.repeatedMeasurement?.groupKey;
  if (typeof groupKey !== 'string' || !groupKey.includes(':')) {
    return null;
  }

  const [rawSiteCode, rawStateKey] = groupKey.split(':');
  const siteCode = String(rawSiteCode || '')
    .trim()
    .toUpperCase();
  const stateKey = String(rawStateKey || '').trim();

  if (!siteCode || !stateKey) {
    return null;
  }

  return { siteCode, stateKey };
};

const resolveRepeatedAnnotationMapping = annotation => {
  const label = normalizeRepeatedLabel(annotation);
  const labelMapped = LABEL_MAP[label];
  if (labelMapped) {
    return {
      ...labelMapped,
      resolvedBy: 'label',
      resolvedLabel: label,
    };
  }

  const groupKeyParts = getRepeatedGroupKeyParts(annotation);
  if (!groupKeyParts) {
    return null;
  }

  const site = SITE_BY_CODE[groupKeyParts.siteCode];
  const group = MEASUREMENT_GROUP_BY_STATE_KEY[groupKeyParts.stateKey];

  if (!site || !group) {
    return null;
  }

  return {
    site: site.key,
    axis: group.stateKey,
    stateKey: group.stateKey,
    role: group.role,
    measurementAxis: group.axis,
    suffix: group.suffix,
    resolvedBy: 'groupKey',
    resolvedLabel: label,
  };
};

const isIuscanRepeatedAnnotation = value => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const workflow = value.workflow;
  const domain = value.domain;
  const mode = value.mode;

  return (
    workflow === 'viewerMeasurements' &&
    domain === 'iuscan' &&
    (mode === 'repeated' || !!value.repeatedMeasurement) &&
    !!(value.label || value.measurementRole || value.role)
  );
};

const getRepeatedAnnotationKey = annotation =>
  String(
    annotation.annotationId ||
      annotation.uid ||
      [
        annotation.label || annotation.measurementRole || annotation.role || '',
        annotation.SOPInstanceUID || '',
        annotation.frameNumber || '',
        annotation.value ||
          annotation?.measurements?.value ||
          annotation?.measurements?.length ||
          '',
      ].join('|')
  );

const collectIuscanRepeatedAnnotationsFromValue = value => {
  const root = parseMaybeJson(value);
  const out = [];
  const seen = new Set();

  const visit = node => {
    if (!node) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (typeof node !== 'object') {
      return;
    }

    if (isIuscanRepeatedAnnotation(node)) {
      const key = getRepeatedAnnotationKey(node);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(node);
      }
      return;
    }

    Object.values(node).forEach(visit);
  };

  visit(root);
  return out;
};

const collectIuscanRepeatedAnnotationsFromSeriesDoc = doc => {
  if (!doc) {
    return [];
  }

  const out = [];
  const seen = new Set();

  for (const fieldName of ['MeasurementAnnotations', 'IUScanAnnotations']) {
    for (const annotation of collectIuscanRepeatedAnnotationsFromValue(doc[fieldName])) {
      const key = getRepeatedAnnotationKey(annotation);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(annotation);
      }
    }
  }

  return out;
};

class IUScanAssignmentService extends PubSubService {
  static REGISTRATION = {
    name: 'iuscanAssignmentService',
    altName: 'IUScanAssignmentService',
    create: () => new IUScanAssignmentService(),
  };

  EVENTS = EVENTS;

  constructor() {
    super(EVENTS);
    this._state = this._buildEmptyState();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _buildEmptyState() {
    const state = {};
    for (const { key } of SITES) {
      state[key] = {
        ...MEASUREMENT_GROUPS.reduce((acc, group) => {
          acc[group.stateKey] = { slots: [null, null, null] };
          return acc;
        }, {}),
        observations: {
          doppler: null,
          inflammatoryFat: null,
          lymphadenopathy: null,
          stratification: null,
          haustrations: null,
          segmentLength: '',
          complications: null,
          complicationTypes: [],
          complicationText: '',
          strictureMaxBWT: '',
          strictureMinimalLuminalDiameter: '',
          strictureLength: '',
          strictureUpstreamDilation: '',
        },
      };
    }
    return state;
  }

  // ── Measurement slot API ──────────────────────────────────────────────────

  /**
   * Assign a measurementUID to a specific slot.
   * @param {string} site  - e.g. 'sigmoidColon'
   * @param {string} axis  - one of MEASUREMENT_SLOT_KEYS
   * @param {number} slot  - 0 | 1 | 2
   * @param {string|null} value - UID string or null
   */
  assign(site, axis, slot, value) {
    if (!this._state[site]?.[axis]) {
      console.warn(`[IUScanAssignmentService] Unknown site/measurement group: ${site}/${axis}`);
      return;
    }
    this._state[site][axis].slots[slot] = value;
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { site, axis, slot });
  }

  unassign(site, axis, slot) {
    if (!this._state[site]?.[axis]) {
      return;
    }

    this._state[site][axis].slots[slot] = null;
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { site, axis, slot });
  }

  getSlot(site, axis, slot) {
    return this._state[site]?.[axis]?.slots[slot] ?? null;
  }

  getSlots(site, axis) {
    return [...(this._state[site]?.[axis]?.slots ?? [null, null, null])];
  }

  /**
   * Called from the MEASUREMENT_ADDED subscriber.
   * If the measurement has a label matching LABEL_MAP, auto-assigns it to
   * the next empty slot for that (site, axis).
   * @returns {boolean} true if auto-assigned
   */
  autoAssignByLabel(measurementUID, label) {
    const mapped = LABEL_MAP[label];
    if (!mapped) {
      return false;
    }

    const { site } = mapped;
    const axis = mapped.stateKey || mapped.axis;
    const slots = this._state[site]?.[axis]?.slots;
    if (!slots) {
      return false;
    }

    const nextEmpty = slots.findIndex(s => s === null);
    if (nextEmpty === -1) {
      return false;
    } // all 3 slots full — don't overwrite

    this.assign(site, axis, nextEmpty, measurementUID);
    return true;
  }

  getCanonicalRepeatedMeasurementValue(annotation, rowContext = {}) {
    const { site, group, canonicalLabel, repeatedMeasurement } = rowContext;
    const measurements = annotation?.measurements || {};
    const rawValue = Number(measurements.length ?? measurements.value ?? annotation?.value);
    const rawUnit = measurements.lengthUnit || measurements.unit || annotation.unit || 'mm';
    const value = toMillimeters(rawValue, rawUnit);

    if (!Number.isFinite(value)) {
      return null;
    }

    const measurementId = annotation.uid || annotation.annotationId;
    const label =
      canonicalLabel ||
      (site && group ? `${site.code}-${group.labelSuffix || group.suffix}` : '') ||
      annotation.label ||
      annotation.measurementRole ||
      annotation.role ||
      '';

    return {
      annotationId: annotation.annotationId || measurementId,
      uid: measurementId,
      workflow: 'viewerMeasurements',
      domain: 'iuscan',
      mode: 'repeated',
      role: label,
      label,
      measurementRole: label,
      toolName: annotation.toolName || 'Length',
      repeatedMeasurement:
        repeatedMeasurement ||
        (site && group
          ? {
              groupKey: `${site.code}:${group.stateKey}`,
              axis: group.axis || group.measurementAxis || group.stateKey,
              maxSlots: 3,
              aggregation: 'average',
            }
          : annotation.repeatedMeasurement || null),
      StudyInstanceUID: annotation.StudyInstanceUID || '',
      SeriesInstanceUID: annotation.SeriesInstanceUID || annotation.referenceSeriesUID || '',
      referenceSeriesUID: annotation.referenceSeriesUID || annotation.SeriesInstanceUID || '',
      SOPInstanceUID: annotation.SOPInstanceUID || '',
      FrameOfReferenceUID: annotation.FrameOfReferenceUID || '',
      displaySetInstanceUID: annotation.displaySetInstanceUID || '',
      referencedImageId: annotation.referencedImageId || '',
      frameNumber: annotation.frameNumber || 1,
      points: annotation.points || [],

      value,
      unit: 'mm',
      measurements: {
        displayText: [formatMmDisplay(value)],
        value,
        unit: 'mm',
        length: value,
        lengthUnit: 'mm',
      },
      displayText: [formatMmDisplay(value)],
    };
  }

  assignCanonicalRepeatedAnnotation(annotation) {
    if (
      annotation?.workflow !== 'viewerMeasurements' ||
      annotation?.domain !== 'iuscan' ||
      annotation?.mode !== 'repeated' ||
      !annotation?.repeatedMeasurement
    ) {
      return false;
    }

    const label = normalizeRepeatedLabel(annotation);
    const mapped = resolveRepeatedAnnotationMapping(annotation);

    if (!mapped) {
      console.warn('[iUSCAN] skipped repeated annotation with unmapped label', {
        label,
        groupKey: annotation?.repeatedMeasurement?.groupKey,
        annotationId: annotation?.annotationId || annotation?.uid,
        knownLabelCount: Object.keys(LABEL_MAP || {}).length,
      });
      return false;
    }

    const slotValue = this.getCanonicalRepeatedMeasurementValue(annotation);

    if (!slotValue) {
      return false;
    }

    const { site } = mapped;
    const axis = mapped.stateKey || mapped.axis;
    const slots = this._state[site]?.[axis]?.slots;

    if (!slots) {
      return false;
    }

    const alreadyAssigned = slots.some(slot => {
      if (!slot) {
        return false;
      }

      if (slot === slotValue.uid || slot === slotValue.annotationId) {
        return true;
      }

      return (
        typeof slot === 'object' &&
        (slot.uid === slotValue.uid || slot.annotationId === slotValue.annotationId)
      );
    });

    if (alreadyAssigned) {
      return 'duplicate';
    }

    const nextEmpty = slots.findIndex(slot => slot === null);

    if (nextEmpty === -1) {
      return false;
    }

    this.assign(site, axis, nextEmpty, slotValue);
    return true;
  }

  hydrateCanonicalRepeatedAnnotations(annotations = []) {
    let assignedCount = 0;
    let duplicateCount = 0;
    const skipped = [];

    for (const annotation of annotations) {
      const result = this.assignCanonicalRepeatedAnnotation(annotation);

      if (result === true) {
        assignedCount++;
      } else if (result === 'duplicate') {
        duplicateCount++;
      } else {
        skipped.push({
          label: normalizeRepeatedLabel(annotation),
          groupKey: annotation?.repeatedMeasurement?.groupKey,
          annotationId: annotation?.annotationId || annotation?.uid,
        });
      }
    }

    console.info('[iUSCAN] canonical repeated assignment result', {
      inputCount: annotations.length,
      assignedCount,
      duplicateCount,
      skippedCount: skipped.length,
      skipped,
    });

    if (assignedCount > 0) {
      this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, {
        source: 'canonical-repeated-annotations',
        assignedCount,
      });
    }

    return assignedCount;
  }

  // ── Observation API ───────────────────────────────────────────────────────

  setObservation(site, field, value) {
    if (!this._state[site]) {
      return;
    }
    this._state[site].observations[field] = value;
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { site, field });
  }

  setObservations(site, patch) {
    if (!this._state[site]) {
      return;
    }
    this._state[site].observations = {
      ...this._state[site].observations,
      ...patch,
    };
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { site, fields: Object.keys(patch) });
  }

  getObservation(site, field) {
    return this._state[site]?.observations?.[field] ?? null;
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  hasAnyAssignment() {
    return SITES.some(({ key }) => this.siteHasReportableData(key));
  }

  siteHasReportableData(siteKey) {
    const siteState = this._state[siteKey];
    if (!siteState) {
      return false;
    }

    const hasSlots = MEASUREMENT_SLOT_KEYS.some(axis =>
      siteState[axis]?.slots?.some(s => s !== null)
    );
    if (hasSlots) {
      return true;
    }

    const obs = siteState.observations ?? {};
    return (
      obs.doppler != null ||
      obs.inflammatoryFat != null ||
      obs.lymphadenopathy != null ||
      obs.stratification != null ||
      obs.haustrations != null ||
      String(obs.segmentLength || '').trim() !== '' ||
      obs.complications != null ||
      (Array.isArray(obs.complicationTypes) && obs.complicationTypes.length > 0) ||
      String(obs.complicationText || '').trim() !== '' ||
      String(obs.strictureMaxBWT || '').trim() !== '' ||
      String(obs.strictureMinimalLuminalDiameter || '').trim() !== '' ||
      String(obs.strictureLength || '').trim() !== '' ||
      String(obs.strictureUpstreamDilation || '').trim() !== ''
    );
  }

  getFullState() {
    // Return a shallow copy so callers can't mutate internal state directly
    const copy = {};
    for (const { key } of SITES) {
      copy[key] = {
        ...MEASUREMENT_GROUPS.reduce((acc, group) => {
          acc[group.stateKey] = {
            slots: [...(this._state[key][group.stateKey]?.slots ?? [null, null, null])],
          };
          return acc;
        }, {}),
        observations: {
          ...this._state[key].observations,
          complicationTypes: [...(this._state[key].observations.complicationTypes ?? [])],
        },
      };
    }
    return copy;
  }

  // ── Hydration from existing Mongo series document ─────────────────────────
  /**
   * Hydrates panel state from an existing Mongo Series document.
   *
   * Preferred measurement restore path:
   *   1. Restore canonical repeated viewer annotations into individual slots.
   *   2. Fall back to saved scalar report fields, e.g. BWTLong/SubmucosaLong,
   *      only when there are no restored/live caliper assignments for that row.
   *
   * The scalar fallback can only show one value because the Mongo report field
   * stores the row average, not each repeated caliper.
   */
  _hydrateMeasurementSlotsFromSeriesDocForSite(doc, site) {
    const { key, mongoPrefix } = site;
    const siteState = this._state[key];

    if (!siteState || !mongoPrefix) {
      return 0;
    }

    let hydratedCount = 0;

    for (const group of MEASUREMENT_GROUPS) {
      const axis = group.stateKey;
      const slots = siteState?.[axis]?.slots;

      if (!slots) {
        continue;
      }

      const fieldName = `${mongoPrefix}${group.suffix}`;
      const value = doc[fieldName];

      if (value == null || String(value).trim() === '') {
        continue;
      }

      // Do not overwrite restored/live caliper assignments.
      if (slots.some(slot => slot !== null)) {
        continue;
      }

      const slotValue = buildHydratedMeasurementSlot({
        value,
        unit: doc[`${fieldName}UOM`] || 'mm',
        sourceField: fieldName,
      });

      if (!slotValue) {
        continue;
      }

      const slotIndex = firstEmptySlotIndex(slots);
      if (slotIndex === -1) {
        continue;
      }

      slots[slotIndex] = slotValue;
      hydratedCount++;
    }

    return hydratedCount;
  }

  hydrateFromSeriesDoc(doc) {
    if (!doc) {
      return;
    }

    const repeatedAnnotations = collectIuscanRepeatedAnnotationsFromSeriesDoc(doc);
    const restoredRepeatedMeasurementCount =
      repeatedAnnotations.length > 0
        ? this.hydrateCanonicalRepeatedAnnotations(repeatedAnnotations)
        : 0;

    let hydratedMeasurementCount = 0;

    for (const site of SITES) {
      const { key, mongoPrefix } = site;
      hydratedMeasurementCount += this._hydrateMeasurementSlotsFromSeriesDocForSite(doc, site);

      // Observations
      const dopplerStr = doc[`${mongoPrefix}ColorDopplerSignal`];
      if (dopplerStr != null && DOPPLER_REVERSE[dopplerStr] !== undefined) {
        this._state[key].observations.doppler = DOPPLER_REVERSE[dopplerStr];
      }

      const fatStr = doc[`${mongoPrefix}InflammatoryMesentericFat`];
      if (fatStr === '2' || fatStr === 2 || fatStr === 'Complete') {
        this._state[key].observations.inflammatoryFat = 2;
      } else if (fatStr === '1' || fatStr === 1 || fatStr === 'Partial') {
        this._state[key].observations.inflammatoryFat = 1;
      } else if (fatStr === '0' || fatStr === 0 || fatStr === 'None') {
        this._state[key].observations.inflammatoryFat = 0;
      }
      // legacy fallback
      else if (fatStr === 'Yes') {
        this._state[key].observations.inflammatoryFat = 2;
      } else if (fatStr === 'No') {
        this._state[key].observations.inflammatoryFat = 0;
      }

      const lymphStr = doc[`${mongoPrefix}Lymphadenopathy`];
      if (lymphStr === 'Yes') {
        this._state[key].observations.lymphadenopathy = 1;
      } else if (lymphStr === 'No') {
        this._state[key].observations.lymphadenopathy = 0;
      }

      const stratStr = doc[`${mongoPrefix}LossOfStratification`];
      if (
        stratStr === '2' ||
        stratStr === 2 ||
        stratStr === 'Complete' ||
        stratStr === 'Extensive disruption'
      ) {
        this._state[key].observations.stratification = 2;
      } else if (
        stratStr === '1' ||
        stratStr === 1 ||
        stratStr === 'Focal' ||
        stratStr === 'Focal disruption'
      ) {
        this._state[key].observations.stratification = 1;
      } else if (stratStr === '0' || stratStr === 0 || stratStr === 'Normal') {
        this._state[key].observations.stratification = 0;
      }
      // legacy fallback
      else if (stratStr === 'Yes') {
        this._state[key].observations.stratification = 2;
      } else if (stratStr === 'No') {
        this._state[key].observations.stratification = 0;
      }

      const haustrationsStr = doc[`${mongoPrefix}Haustrations`];
      if (HAUSTRATION_REVERSE[haustrationsStr] !== undefined) {
        this._state[key].observations.haustrations = HAUSTRATION_REVERSE[haustrationsStr];
      }

      const segmentLength = doc[`${mongoPrefix}SegmentLength`];
      if (segmentLength != null && String(segmentLength).trim() !== '') {
        this._state[key].observations.segmentLength = String(segmentLength);
      }

      const complicationsStr = doc[`${mongoPrefix}Complications`];
      if (complicationsStr === 'Yes') {
        this._state[key].observations.complications = 1;
      } else if (complicationsStr === 'No') {
        this._state[key].observations.complications = 0;
      }

      const complicationTypes = doc[`${mongoPrefix}ComplicationTypes`];
      if (Array.isArray(complicationTypes)) {
        this._state[key].observations.complicationTypes = complicationTypes;
      } else if (typeof complicationTypes === 'string' && complicationTypes.trim()) {
        this._state[key].observations.complicationTypes = complicationTypes
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      }

      const complicationText = doc[`${mongoPrefix}ComplicationText`];
      if (complicationText != null) {
        this._state[key].observations.complicationText = String(complicationText);
      }

      const strictureMaxBWT = doc[`${mongoPrefix}StrictureMaxBWT`];
      if (strictureMaxBWT != null && String(strictureMaxBWT).trim() !== '') {
        this._state[key].observations.strictureMaxBWT = String(strictureMaxBWT);
      }

      const strictureMinimalLuminalDiameter = doc[`${mongoPrefix}StrictureMinimalLuminalDiameter`];
      if (
        strictureMinimalLuminalDiameter != null &&
        String(strictureMinimalLuminalDiameter).trim() !== ''
      ) {
        this._state[key].observations.strictureMinimalLuminalDiameter = String(
          strictureMinimalLuminalDiameter
        );
      }

      const strictureLength = doc[`${mongoPrefix}StrictureLength`];
      if (strictureLength != null && String(strictureLength).trim() !== '') {
        this._state[key].observations.strictureLength = String(strictureLength);
      }

      const strictureUpstreamDilation = doc[`${mongoPrefix}StrictureUpstreamDilation`];
      if (strictureUpstreamDilation != null && String(strictureUpstreamDilation).trim() !== '') {
        this._state[key].observations.strictureUpstreamDilation = String(strictureUpstreamDilation);
      }
    }

    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, {
      source: 'hydration',
      hydratedMeasurementCount,
      restoredRepeatedMeasurementCount,
      repeatedAnnotationCount: repeatedAnnotations.length,
    });
  }

  // ── Report ────────────────────────────────────────────────────────────────

  buildReportPayload(measurementService) {
    return buildReportPayload(this._state, measurementService);
  }

  getUpdatedMeasurementFieldNames(payload = {}) {
    return Object.keys(payload || {}).filter(fieldName => fieldName !== 'accessType');
  }

  buildUpdatedMeasurementFields({ payload = {}, updatedSeries = null, fieldNames = [] }) {
    return fieldNames.reduce((acc, fieldName) => {
      if (updatedSeries && Object.prototype.hasOwnProperty.call(updatedSeries, fieldName)) {
        acc[fieldName] = updatedSeries[fieldName];
        return acc;
      }

      if (Object.prototype.hasOwnProperty.call(payload, fieldName)) {
        acc[fieldName] = payload[fieldName];
      }

      return acc;
    }, {});
  }

  postReportMessage(message, warningLabel) {
    try {
      window.opener?.postMessage(message, '*');
      window.parent?.postMessage(message, '*');
    } catch (messageError) {
      console.warn(warningLabel, messageError);
    }
  }

  notifyArMeasurementsUpdated({ seriesDoc, payload, updatedSeries = null }) {
    const fieldNames = this.getUpdatedMeasurementFieldNames(payload);
    if (!fieldNames.length) {
      return;
    }

    const sourceSeries = updatedSeries || seriesDoc || {};
    const updatedFields = this.buildUpdatedMeasurementFields({
      payload,
      updatedSeries,
      fieldNames,
    });

    console.log('[AR] posting measurement update to report page', {
      seriesKey: String(sourceSeries?._id || seriesDoc?._id || ''),
      fieldNames,
      updatedFields,
      updatedAt: sourceSeries?.updatedAt || '',
      hasOpener: !!window.opener,
      parentIsSelf: window.parent === window,
    });

    this.postReportMessage(
      {
        type: 'AR_REPORT_MEASUREMENTS_UPDATED',
        seriesKey: String(sourceSeries?._id || seriesDoc?._id || ''),
        StudyInstanceUID: String(
          sourceSeries?.StudyInstanceUID || seriesDoc?.StudyInstanceUID || ''
        ),
        SeriesInstanceUID: String(
          sourceSeries?.SeriesInstanceUID || seriesDoc?.SeriesInstanceUID || ''
        ),
        fieldNames,
        updatedFields,
        updatedAt: sourceSeries?.updatedAt || '',
      },
      '[AR] unable to notify report page of measurement update:'
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  clearAll() {
    this._state = this._buildEmptyState();
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { source: 'clearAll' });
  }
}

export default IUScanAssignmentService;
