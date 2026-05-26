import { PubSubService } from '@ohif/core';
import { SITES, LABEL_MAP, DOPPLER_REVERSE, HAUSTRATION_REVERSE } from '../utils/labelMap';
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
 *   longitudinal: { slots: [null|uid, null|uid, null|uid] },
 *   cross:        { slots: [null|uid, null|uid, null|uid] },
 *   observations: {
 *     doppler:        null|0|1|2|3,
 *     inflammatoryFat: null|0|1|2,
 *     lymphadenopathy: null|0|1,
 *     stratification:  null|0|1|2,
 *   },
 * }
 */
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
        longitudinal: { slots: [null, null, null] },
        cross: { slots: [null, null, null] },
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
   * @param {string} axis  - 'longitudinal' | 'cross'
   * @param {number} slot  - 0 | 1 | 2
   * @param {string|null} value - UID string or null
   */
  assign(site, axis, slot, value) {
    if (!this._state[site]) {
      console.warn(`[IUScanAssignmentService] Unknown site: ${site}`);
      return;
    }
    this._state[site][axis].slots[slot] = value;
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { site, axis, slot });
  }

  unassign(site, axis, slot) {
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
    if (!mapped) return false;

    const { site, axis } = mapped;
    const slots = this._state[site]?.[axis]?.slots;
    if (!slots) return false;

    const nextEmpty = slots.findIndex(s => s === null);
    if (nextEmpty === -1) return false; // all 3 slots full — don't overwrite

    this.assign(site, axis, nextEmpty, measurementUID);
    return true;
  }

  // ── Observation API ───────────────────────────────────────────────────────

  setObservation(site, field, value) {
    if (!this._state[site]) return;
    this._state[site].observations[field] = value;
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { site, field });
  }

  setObservations(site, patch) {
    if (!this._state[site]) return;
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
    if (!siteState) return false;

    const hasSlots = ['longitudinal', 'cross'].some(axis =>
      siteState[axis].slots.some(s => s !== null)
    );
    if (hasSlots) return true;

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
        longitudinal: { slots: [...this._state[key].longitudinal.slots] },
        cross: { slots: [...this._state[key].cross.slots] },
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
   * Hydrates observation fields from an existing Mongo Series document.
   *
   * Important:
   * Do not hydrate BWT/BWTLong/BWTCross values into assignment slots.
   * Slots represent actual caliper annotations only and should be filled
   * exclusively by restoreAnnotations().
   */
  hydrateFromSeriesDoc(doc) {
    if (!doc) return;

    for (const { key, mongoPrefix } of SITES) {
      // Observations
      const dopplerStr = doc[`${mongoPrefix}ColorDopplerSignal`];
      if (dopplerStr != null && DOPPLER_REVERSE[dopplerStr] !== undefined) {
        this._state[key].observations.doppler = DOPPLER_REVERSE[dopplerStr];
      }

      const fatStr = doc[`${mongoPrefix}InflammatoryMesentericFat`];
      if (fatStr === '2' || fatStr === 2 || fatStr === 'Complete')
        this._state[key].observations.inflammatoryFat = 2;
      else if (fatStr === '1' || fatStr === 1 || fatStr === 'Partial')
        this._state[key].observations.inflammatoryFat = 1;
      else if (fatStr === '0' || fatStr === 0 || fatStr === 'None')
        this._state[key].observations.inflammatoryFat = 0;
      // legacy fallback
      else if (fatStr === 'Yes') this._state[key].observations.inflammatoryFat = 2;
      else if (fatStr === 'No') this._state[key].observations.inflammatoryFat = 0;

      const lymphStr = doc[`${mongoPrefix}Lymphadenopathy`];
      if (lymphStr === 'Yes') this._state[key].observations.lymphadenopathy = 1;
      else if (lymphStr === 'No') this._state[key].observations.lymphadenopathy = 0;

      const stratStr = doc[`${mongoPrefix}LossOfStratification`];
      if (
        stratStr === '2' ||
        stratStr === 2 ||
        stratStr === 'Complete' ||
        stratStr === 'Extensive disruption'
      )
        this._state[key].observations.stratification = 2;
      else if (
        stratStr === '1' ||
        stratStr === 1 ||
        stratStr === 'Focal' ||
        stratStr === 'Focal disruption'
      )
        this._state[key].observations.stratification = 1;
      else if (stratStr === '0' || stratStr === 0 || stratStr === 'Normal')
        this._state[key].observations.stratification = 0;
      // legacy fallback
      else if (stratStr === 'Yes') this._state[key].observations.stratification = 2;
      else if (stratStr === 'No') this._state[key].observations.stratification = 0;

      const haustrationsStr = doc[`${mongoPrefix}Haustrations`];
      if (HAUSTRATION_REVERSE[haustrationsStr] !== undefined) {
        this._state[key].observations.haustrations = HAUSTRATION_REVERSE[haustrationsStr];
      }

      const segmentLength = doc[`${mongoPrefix}SegmentLength`];
      if (segmentLength != null && String(segmentLength).trim() !== '') {
        this._state[key].observations.segmentLength = String(segmentLength);
      }

      const complicationsStr = doc[`${mongoPrefix}Complications`];
      if (complicationsStr === 'Yes') this._state[key].observations.complications = 1;
      else if (complicationsStr === 'No') this._state[key].observations.complications = 0;

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

    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { source: 'hydration' });
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
    if (!fieldNames.length) return;

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
