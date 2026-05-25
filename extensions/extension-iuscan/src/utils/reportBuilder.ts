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

  for (const siteConfig of SITES) {
    const { key, mongoPrefix } = siteConfig;
    const siteState = state[key];
    if (!siteState) continue;

    // ── Measurements ────────────────────────────────────────────────────────
    const axisMeans = {};

    for (const axis of ['longitudinal', 'cross']) {
      const slots = siteState[axis]?.slots ?? [];
      const resolved = slots
        .map(slot => {
          if (slot === null) return null;
          if (typeof slot === 'number') return { value: slot, unit: 'cm' };
          if (typeof slot === 'object' && slot !== null && 'value' in slot)
            return { value: slot.value, unit: slot.unit };
          // slot is a measurementUID
          const m = measurementService.getMeasurement(slot);
          if (!m?.data) return null;
          const firstKey = Object.keys(m.data)[0];
          if (!firstKey) return null;
          const { length, unit } = m.data[firstKey] ?? {};
          if (length == null) return null;
          return { value: length, unit: unit ?? 'cm' };
        })
        .filter(v => v !== null);
      const numericValues = resolved.map(r => r.value);
      if (numericValues.length === 0) continue;

      const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      const unit = resolved[0]?.unit === 'cm US Region' ? 'cm' : (resolved[0]?.unit ?? 'cm');
      axisMeans[axis] = { avg, unit };

      // New split fields
      const suffix = axis === 'longitudinal' ? 'BWTLong' : 'BWTCross';
      payload[`${mongoPrefix}${suffix}`] = avg.toFixed(2);
      payload[`${mongoPrefix}${suffix}UOM`] = unit;
    }

    // Combined BWT = average across all filled slots from both axes
    const allMeans = Object.values(axisMeans);
    if (allMeans.length > 0) {
      const combined = allMeans.reduce((a, b) => a + b.avg, 0) / allMeans.length;
      const unit = allMeans[0].unit;
      payload[`${mongoPrefix}BWT`] = combined.toFixed(2);
      payload[`${mongoPrefix}BWTUOM`] = unit;
    }

    // ── Observations ─────────────────────────────────────────────────────────
    const obs = siteState.observations;
    if (!obs) continue;

    if (obs.doppler != null) {
      payload[`${mongoPrefix}ColorDopplerSignal`] = DOPPLER_MAP[obs.doppler] ?? '0 Absent';
    }
    if (obs.inflammatoryFat != null) {
      const FAT_LABELS = ['None', 'Partial', 'Complete'];
      payload[`${mongoPrefix}InflammatoryMesentericFat`] =
        FAT_LABELS[obs.inflammatoryFat] ?? 'None';
    }
    if (obs.lymphadenopathy != null) {
      payload[`${mongoPrefix}Lymphadenopathy`] = obs.lymphadenopathy > 0 ? 'Yes' : 'No';
    }
    if (obs.stratification != null) {
      const STRAT_LABELS = ['Normal', 'Focal', 'Complete'];
      payload[`${mongoPrefix}LossOfStratification`] = STRAT_LABELS[obs.stratification] ?? 'Normal';
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
    }
  }

  payload.accessType = 'update';
  return payload;
}
