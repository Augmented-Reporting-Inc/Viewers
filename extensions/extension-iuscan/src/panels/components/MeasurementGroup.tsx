import React from 'react';

/**
 * One measurement axis (longitudinal or cross) for a single anatomical site.
 *
 * slots: array of 3 items, each null | uid-string | number (raw mm from hydration)
 * valueByUID: { [uid]: mm } — derived from useMeasurements() in the parent panel
 *
 * Slot click → jumpToMeasurement (highlights annotation in viewport)
 * "Assign" button → assigns most-recent unassigned caliper to next empty slot
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
  // Resolve display value for each slot
  const resolved = slots.map(slot => {
    if (slot === null) {
      return null;
    }
    if (typeof slot === 'object' && slot !== null && 'value' in slot) {
      return slot;
    } // hydrated { value, unit }
    return valueByUID[slot] ?? null; // live caliper value
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

  const unit =
    filled.length > 0
      ? typeof filled[0] === 'number'
        ? 'cm'
        : filled[0].unit === 'cm US Region'
          ? 'cm'
          : filled[0].unit
      : 'cm';

  function handleAssignNext() {
    // Collect all UIDs already assigned anywhere across all sites/axes
    const allAssigned = new Set();
    const state = assignSvc.getFullState();
    Object.values(state).forEach(siteState => {
      ['longitudinal', 'cross'].forEach(ax => {
        siteState?.[ax]?.slots?.forEach(s => {
          const measurementId = getSlotMeasurementId(s);

          if (measurementId) {
            allAssigned.add(measurementId);
          }
        });
      });
    });

    const nextSlot = slots.findIndex(s => s === null);
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
        <span className="text-xs text-gray-400">{label.replace('(cm)', `(${unit})`)}</span>
        <span className="text-xs text-gray-300">
          Avg:{' '}
          <strong className={average !== null ? 'text-primary-light' : 'text-gray-500'}>
            {average !== null ? `${average} ${unit}` : '—'}
          </strong>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 overflow-x-hidden">
        {slots.map((slot, i) => {
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
          title="Assign most recent caliper to this slot"
          onClick={handleAssignNext}
        >
          + Assign
        </button>
      </div>
    </div>
  );
}
