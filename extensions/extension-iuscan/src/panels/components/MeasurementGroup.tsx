import React from 'react';
import { MEASUREMENT_SLOT_KEYS } from '../../utils/labelMap';

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

const normalizeResolvedMeasurement = value => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return { value, unit: 'mm' };
  }

  const valueInMm = toMillimeters(
    value.value ?? value.length ?? value.measurements?.length ?? value.measurements?.value,
    value.unit ?? value.lengthUnit ?? value.measurements?.lengthUnit ?? value.measurements?.unit
  );

  return valueInMm == null ? null : { ...value, value: valueInMm, unit: 'mm' };
};

/**
 * One measurement row for a single anatomical site.
 *
 * slots: array of 3 items, each null | measurement-id string | number | hydrated annotation object
 * valueByUID: { [measurementId]: { value, unit } } — derived from useMeasurements() in the parent panel
 *
 * Slot click → jumpToMeasurement (highlights annotation in viewport)
 * "+ Latest" button → assigns most-recent unassigned caliper to next empty slot
 */
export default function MeasurementGroup({
  label,
  site,
  axis,
  slots,
  valueByUID,
  measurements,
  assignSvc,
  measurementService,
  commandsManager,
}) {
  const slotList = slots ?? [null, null, null];

  // Resolve display value for each slot
  const resolved = slotList.map(slot => {
    if (slot === null) {
      return null;
    }
    if (typeof slot === 'object' && slot !== null && 'value' in slot) {
      return normalizeResolvedMeasurement(slot);
    } // hydrated { value, unit }
    return normalizeResolvedMeasurement(valueByUID[slot] ?? null); // live caliper value
  });

  function getSlotMeasurementId(slot) {
    if (!slot) {
      return '';
    }

    if (typeof slot === 'string') {
      return slot;
    }

    if (typeof slot === 'object') {
      return slot.uid || slot.annotationId || '';
    }

    return '';
  }

  function isNavigableSlot(slot) {
    if (typeof slot === 'string') {
      return true;
    }

    return !!(
      slot &&
      typeof slot === 'object' &&
      (slot.uid || slot.annotationId) &&
      slot.referencedImageId
    );
  }

  function jumpToSlot(slot) {
    const measurementId = getSlotMeasurementId(slot);

    if (!measurementId) {
      return;
    }

    if (typeof slot === 'string') {
      measurementService.jumpToMeasurement(null, measurementId);
      return;
    }

    commandsManager?.runCommand?.('jumpToSavedViewerAnnotation', {
      annotation: slot,
    });
  }

  const filled = resolved.filter(v => v !== null);
  const average =
    filled.length > 0
      ? (
          filled.reduce((a, b) => a + (typeof b === 'number' ? b : b.value), 0) / filled.length
        ).toFixed(2)
      : null;

  const unit = 'mm';

  function handleAssignNext() {
    // Collect all UIDs already assigned anywhere across all sites/axes
    const allAssigned = new Set();
    const state = assignSvc.getFullState();
    Object.values(state).forEach(siteState => {
      MEASUREMENT_SLOT_KEYS.forEach(ax => {
        siteState?.[ax]?.slots?.forEach(s => {
          const measurementId = getSlotMeasurementId(s);

          if (measurementId) {
            allAssigned.add(measurementId);
          }
        });
      });
    });

    const nextSlot = slotList.findIndex(s => s === null);
    if (nextSlot === -1) {
      return;
    } // all slots full

    // Pick the most recently added unassigned measurement
    const candidates = measurements
      .filter(m => !allAssigned.has(m.uid))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    if (candidates.length > 0) {
      assignSvc.assign(site, axis, nextSlot, candidates[0].uid);
      measurementService.jumpToMeasurement(null, candidates[0].uid);
    }
  }

  return (
    <div className="gi-measurement-group mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs text-gray-300">
          Avg:{' '}
          <strong className={average !== null ? 'text-primary-light' : 'text-gray-500'}>
            {average !== null ? `${average} ${unit}` : '—'}
          </strong>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 overflow-x-hidden">
        {slotList.map((slot, i) => {
          const val = resolved[i];
          const isNavigable = isNavigableSlot(slot);
          return (
            <div
              key={i}
              className={[
                'gi-slot flex min-w-[52px] max-w-[64px] items-center justify-between rounded border px-2 py-1 text-xs',
              ].join(' ')}
            >
              {val !== null ? (
                <>
                  <span
                    className={isNavigable ? 'hover:text-primary-light cursor-pointer' : ''}
                    title={
                      isNavigable ? 'Click to jump to annotation' : 'Pre-populated from report'
                    }
                    onClick={() => {
                      if (isNavigable) {
                        jumpToSlot(slot);
                      }
                    }}
                  >
                    {(typeof val === 'number' ? val : val.value).toFixed(2)}
                  </span>
                  <button
                    className="ml-1 leading-none text-gray-400 hover:text-red-400"
                    title="Remove"
                    onClick={() => assignSvc.unassign(site, axis, i)}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <span className="w-full text-center">—</span>
              )}
            </div>
          );
        })}

        <button
          className={[
            'gi-assign-btn rounded border px-2 py-1 text-xs transition-colors',
            filled.length >= 3
              ? 'cursor-not-allowed border-gray-700 text-gray-600'
              : 'hover:border-primary-light hover:text-primary-light border-gray-500 text-gray-300',
          ].join(' ')}
          disabled={filled.length >= 3}
          title="Use latest unassigned caliper for this measurement row"
          onClick={handleAssignNext}
        >
          + Latest
        </button>
      </div>
    </div>
  );
}
