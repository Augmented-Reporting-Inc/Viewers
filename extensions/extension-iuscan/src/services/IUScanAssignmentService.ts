import { PubSubService } from '@ohif/core';
import { SITES, LABEL_MAP, DOPPLER_REVERSE } from '../utils/labelMap';
import { buildReportPayload } from '../utils/reportBuilder';

const EVENTS = {
  ASSIGNMENT_CHANGED: 'event::iuscan:assignment_changed',
};

/**
 * IUScanAssignmentService
 *
 * Stores which measurementUID (or raw mm number from SR hydration) occupies
 * each (site, axis, slot) position. All live mm values remain in OHIF's
 * built-in MeasurementService — this service only tracks assignments.
 *
 * State shape (per site):
 * {
 *   longitudinal: { slots: [null|uid|number, null|uid|number, null|uid|number] },
 *   cross:        { slots: [null|uid|number, null|uid|number, null|uid|number] },
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
        },
      };
    }
    return state;
  }

  // ── Measurement slot API ──────────────────────────────────────────────────

  /**
   * Assign a measurementUID or raw mm number to a specific slot.
   * @param {string} site  - e.g. 'sigmoidColon'
   * @param {string} axis  - 'longitudinal' | 'cross'
   * @param {number} slot  - 0 | 1 | 2
   * @param {string|number|null} value - UID string, mm number, or null
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

  getObservation(site, field) {
    return this._state[site]?.observations?.[field] ?? null;
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  hasAnyAssignment() {
    return SITES.some(({ key }) =>
      ['longitudinal', 'cross'].some(axis => this._state[key][axis].slots.some(s => s !== null))
    );
  }

  getFullState() {
    // Return a shallow copy so callers can't mutate internal state directly
    const copy = {};
    for (const { key } of SITES) {
      copy[key] = {
        longitudinal: { slots: [...this._state[key].longitudinal.slots] },
        cross: { slots: [...this._state[key].cross.slots] },
        observations: { ...this._state[key].observations },
      };
    }
    return copy;
  }

  // ── Hydration from existing Mongo series document ─────────────────────────

  /**
   * Pre-populates slots with raw mm numbers from SR-extracted Bowel* fields
   * already stored in the Mongo Series document.
   * These are stored as slot values of type `number` (not UID strings).
   */
  hydrateFromSeriesDoc(doc) {
    for (const { key, mongoPrefix } of SITES) {
      // Longitudinal — prefer new split field, fall back to combined BWT
      const longRaw = doc[`${mongoPrefix}BWTLong`] || doc[`${mongoPrefix}BWT`] || '';
      const longVal = parseFloat(longRaw);
      const longUnit = doc[`${mongoPrefix}BWTLongUOM`] || doc[`${mongoPrefix}BWTUOM`] || 'cm';
      if (!isNaN(longVal) && longVal > 0) {
        this._state[key].longitudinal.slots[0] = { value: longVal, unit: longUnit };
      }

      // Cross — prefer new split field only (no fall-back to combined BWT)
      const crossRaw = doc[`${mongoPrefix}BWTCross`] || '';
      const crossVal = parseFloat(crossRaw);
      const crossUnit = doc[`${mongoPrefix}BWTCrossUOM`] || doc[`${mongoPrefix}BWTUOM`] || 'cm';
      if (!isNaN(crossVal) && crossVal > 0) {
        this._state[key].cross.slots[0] = { value: crossVal, unit: crossUnit };
      }

      // Observations
      const dopplerStr = doc[`${mongoPrefix}ColorDopplerSignal`];
      if (dopplerStr != null && DOPPLER_REVERSE[dopplerStr] !== undefined) {
        this._state[key].observations.doppler = DOPPLER_REVERSE[dopplerStr];
      }

      const fatStr = doc[`${mongoPrefix}InflammatoryMesentericFat`];
      if (fatStr === 'Complete') this._state[key].observations.inflammatoryFat = 2;
      else if (fatStr === 'Partial') this._state[key].observations.inflammatoryFat = 1;
      else if (fatStr === 'None') this._state[key].observations.inflammatoryFat = 0;
      // legacy fallback
      else if (fatStr === 'Yes') this._state[key].observations.inflammatoryFat = 2;
      else if (fatStr === 'No') this._state[key].observations.inflammatoryFat = 0;

      const lymphStr = doc[`${mongoPrefix}Lymphadenopathy`];
      if (lymphStr === 'Yes') this._state[key].observations.lymphadenopathy = 1;
      else if (lymphStr === 'No') this._state[key].observations.lymphadenopathy = 0;

      const stratStr = doc[`${mongoPrefix}LossOfStratification`];
      if (stratStr === 'Complete') this._state[key].observations.stratification = 2;
      else if (stratStr === 'Focal') this._state[key].observations.stratification = 1;
      else if (stratStr === 'Normal') this._state[key].observations.stratification = 0;
      // legacy fallback
      else if (stratStr === 'Yes') this._state[key].observations.stratification = 2;
      else if (stratStr === 'No') this._state[key].observations.stratification = 0;
    }

    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { source: 'hydration' });
  }

  // ── Report ────────────────────────────────────────────────────────────────

  buildReportPayload(measurementService) {
    return buildReportPayload(this._state, measurementService);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  clearAll() {
    this._state = this._buildEmptyState();
    this._broadcastEvent(EVENTS.ASSIGNMENT_CHANGED, { source: 'clearAll' });
  }
}

export default IUScanAssignmentService;
