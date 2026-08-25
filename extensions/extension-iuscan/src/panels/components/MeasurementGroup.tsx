import React from 'react';
import { decorateIuscanRepeatedMeasurement, getIuscanRepeatedAnnotationId } from '../../utils/repeatedMeasurements';

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

  const firstStats = value?.data && typeof value.data === 'object' ? Object.values(value.data)[0] : null;
  const numeric = toMillimeters(
    value.value ?? value.length ?? value.measurements?.length ?? value.measurements?.value ?? firstStats?.length,
    value.unit ?? value.lengthUnit ?? value.measurements?.lengthUnit ?? value.measurements?.unit ?? firstStats?.unit
  );

  return numeric == null ? null : { ...value, value: numeric, unit: 'mm' };
};

export default function MeasurementGroup({
  label,
  site,
  group,
  slots,
  measurements,
  savedAnnotations,
  measurementService,
  commandsManager,
  onRemove,
}) {
  const slotList = Array.isArray(slots) ? slots : [null, null, null];
  const resolved = slotList.map(normalizeResolvedMeasurement);
  const filled = resolved.filter(Boolean);
  const average =
    filled.length > 0
      ? (filled.reduce((sum, item) => sum + item.value, 0) / filled.length).toFixed(2)
      : null;

  function jumpToSlot(slot) {
    const measurementId = getIuscanRepeatedAnnotationId(slot);
    if (!measurementId) {
      return;
    }

    const liveMeasurement = measurementService.getMeasurement?.(measurementId);
    if (liveMeasurement) {
      measurementService.jumpToMeasurement(null, measurementId);
      return;
    }

    commandsManager?.runCommand?.('jumpToSavedViewerAnnotation', { annotation: slot });
  }

  function handleAssignNext() {
    const nextSlot = slotList.findIndex(slot => slot == null);
    if (nextSlot < 0) {
      return;
    }

    const assignedIds = new Set(
      slotList.map(getIuscanRepeatedAnnotationId).filter(Boolean)
    );

    const candidates = (measurements || [])
      .filter(measurement => measurement?.uid && !assignedIds.has(measurement.uid))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    const candidate = candidates[0];
    if (!candidate) {
      return;
    }

    const decorated = decorateIuscanRepeatedMeasurement({
      measurementService,
      measurement: candidate,
      savedAnnotations,
      siteKey: site.key,
      stateKey: group.stateKey,
      slotIndex: nextSlot,
      maxSlots: 3,
    });

    if (decorated?.uid) {
      measurementService.jumpToMeasurement(null, decorated.uid);
    }
  }

  return (
    <div className="gi-measurement-group mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs text-gray-300">
          Avg:{' '}
          <strong className={average !== null ? 'text-primary-light' : 'text-gray-500'}>
            {average !== null ? `${average} mm` : '—'}
          </strong>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 overflow-x-hidden">
        {slotList.map((slot, index) => {
          const value = resolved[index];
          const measurementId = getIuscanRepeatedAnnotationId(slot);
          const isNavigable = !!measurementId && !!(slot?.referencedImageId || measurementService.getMeasurement?.(measurementId));

          return (
            <div
              key={index}
              className="gi-slot flex min-w-[52px] max-w-[64px] items-center justify-between rounded border px-2 py-1 text-xs"
            >
              {value ? (
                <>
                  <span
                    className={isNavigable ? 'hover:text-primary-light cursor-pointer' : ''}
                    title={isNavigable ? 'Click to jump to annotation' : ''}
                    onClick={() => isNavigable && jumpToSlot(slot)}
                  >
                    {value.value.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    className="ml-1 leading-none text-gray-400 hover:text-red-400"
                    title="Remove"
                    onClick={() => onRemove?.(slot)}
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
          type="button"
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
