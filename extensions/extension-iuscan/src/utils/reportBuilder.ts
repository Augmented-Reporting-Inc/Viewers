import { SITES, DOPPLER_MAP } from './labelMap';

/**
 * Builds the PUT body for /formapi/api/series/:id from the full
 * IUScanAssignmentService state.
 *
 * Slot values are either:
 *   - null          → skip
 *   - number        → raw mm from SR hydration (use directly)
 *   - string (UID)  → resolve via measurementService.getMeasurement(uid).value
 *
 * Average of filled slots is written to new split fields (BWTLong / BWTCross).
 * The existing combined BWT field is also written (average of all filled slots
 * across both axes) for backward compat with existing PDF templates.
 */
export function buildReportPayload(state, measurementService) {
  const payload = {};

  for (const { key, mongoPrefix } of SITES) {
    const siteState = state[key];
    if (!siteState) continue;

    // ── Measurements ────────────────────────────────────────────────────────
    const axisMeans = {};

    for (const axis of ['longitudinal', 'cross']) {
      const slots = siteState[axis]?.slots ?? [];
      const mmValues = slots
        .map(slot => {
          if (slot === null) return null;
          if (typeof slot === 'number') return slot;
          // slot is a measurementUID
          const m = measurementService.getMeasurement(slot);
          if (!m?.data) return null;
          const firstKey = Object.keys(m.data)[0];
          if (!firstKey) return null;
          const { length, unit } = m.data[firstKey] ?? {};
          if (length == null) return null;
          return length;
        })
        .filter(v => v !== null);

      if (mmValues.length === 0) continue;

      const avg = mmValues.reduce((a, b) => a + b, 0) / mmValues.length;
      axisMeans[axis] = avg;

      // New split fields
      const suffix = axis === 'longitudinal' ? 'BWTLong' : 'BWTCross';
      payload[`${mongoPrefix}${suffix}`] = avg.toFixed(2);
      payload[`${mongoPrefix}${suffix}UOM`] = 'cm';
    }

    // Combined BWT = average across all filled slots from both axes
    const allMeans = Object.values(axisMeans);
    if (allMeans.length > 0) {
      const combined = allMeans.reduce((a, b) => a + b, 0) / allMeans.length;
      payload[`${mongoPrefix}BWT`] = combined.toFixed(2);
      payload[`${mongoPrefix}BWTUOM`] = 'cm';
    }

    // ── Observations ─────────────────────────────────────────────────────────
    const obs = siteState.observations;
    if (!obs) continue;

    if (obs.doppler != null) {
      payload[`${mongoPrefix}ColorDopplerSignal`] = DOPPLER_MAP[obs.doppler] ?? '0';
    }
    if (obs.inflammatoryFat != null) {
      payload[`${mongoPrefix}InflammatoryMesentericFat`] = obs.inflammatoryFat > 0 ? 'Yes' : 'No';
    }
    if (obs.lymphadenopathy != null) {
      payload[`${mongoPrefix}Lymphadenopathy`] = obs.lymphadenopathy > 0 ? 'Yes' : 'No';
    }
    if (obs.stratification != null) {
      payload[`${mongoPrefix}LossOfStratification`] = obs.stratification > 0 ? 'Yes' : 'No';
    }
  }

  payload.accessType = 'update';
  return payload;
}
