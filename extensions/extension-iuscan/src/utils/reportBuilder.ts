import { SITES, DOPPLER_MAP, MEASUREMENT_GROUPS } from './labelMap';

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

const resolveSlotMeasurement = (slot, measurementService) => {
  if (slot === null) {
    return null;
  }

  // Numeric hydrated values are already canonical millimetres.
  if (typeof slot === 'number') {
    return { value: slot, unit: 'mm' };
  }

  if (typeof slot === 'object' && slot !== null) {
    const value = toMillimeters(slot.value ?? slot.length, slot.unit ?? slot.lengthUnit);

    if (value == null) {
      return null;
    }

    return { value, unit: 'mm' };
  }

  // slot is a measurement id string
  const measurement = measurementService.getMeasurement(slot);
  if (!measurement?.data) {
    return null;
  }

  const firstKey = Object.keys(measurement.data)[0];
  if (!firstKey) {
    return null;
  }

  const { length, unit } = measurement.data[firstKey] ?? {};
  const value = toMillimeters(length, unit);

  return value == null ? null : { value, unit: 'mm' };
};

const mean = values => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Builds the PUT body for /formapi/api/series/:id from the full
 * IUScanAssignmentService state.
 *
 * Slot values are either:
 *   - null          → skip
 *   - number        → raw mm from SR hydration (use directly)
 *   - string (UID)  → resolve via measurementService.getMeasurement(uid).value
 *
 * Average of filled slots is written to split fields, e.g. BWTLong/BWTCross
 * and SubmucosaLong/SubmucosaCross. Existing combined BWT/Submucosa fields are
 * also written for backward compatibility with existing report templates.
 */
export function buildReportPayload(state, measurementService) {
  const payload = {};

  for (const siteConfig of SITES) {
    const { key, mongoPrefix } = siteConfig;
    const siteState = state[key];
    if (!siteState) {
      continue;
    }

    // ── Measurements ────────────────────────────────────────────────────────
    const groupMeans = {};

    for (const group of MEASUREMENT_GROUPS) {
      const slots = siteState[group.stateKey]?.slots ?? [];
      const resolved = slots
        .map(slot => resolveSlotMeasurement(slot, measurementService))
        .filter(Boolean);
      const numericValues = resolved.map(item => item.value);
      if (numericValues.length === 0) {
        continue;
      }

      const avg = mean(numericValues);
      groupMeans[group.stateKey] = { avg, role: group.role };

      payload[`${mongoPrefix}${group.suffix}`] = formatMm(avg);
      payload[`${mongoPrefix}${group.suffix}UOM`] = 'mm';
    }

    // Combined BWT = average across BWT longitudinal + cross-section groups.
    const bwtMeans = Object.values(groupMeans).filter(item => item.role === 'bwt');
    if (bwtMeans.length > 0) {
      payload[`${mongoPrefix}BWT`] = formatMm(mean(bwtMeans.map(item => item.avg)));
      payload[`${mongoPrefix}BWTUOM`] = 'mm';
    }

    // Combined Submucosa = average across submucosa longitudinal + cross-section groups.
    const submucosaMeans = Object.values(groupMeans).filter(item => item.role === 'submucosa');
    if (submucosaMeans.length > 0) {
      payload[`${mongoPrefix}Submucosa`] = formatMm(mean(submucosaMeans.map(item => item.avg)));
      payload[`${mongoPrefix}SubmucosaUOM`] = 'mm';
    }

    // ── Observations ─────────────────────────────────────────────────────────
    const obs = siteState.observations;
    if (!obs) {
      continue;
    }

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

  payload.accessType = 'update';
  return payload;
}
