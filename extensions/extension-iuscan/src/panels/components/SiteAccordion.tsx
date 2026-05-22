import React from 'react';
import MeasurementGroup from './MeasurementGroup';
import ScoreSelector from './ScoreSelector';

const DOPPLER_OPTIONS = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
];
const FAT_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Partial' },
  { value: 2, label: 'Complete' },
];
const LYMPH_OPTIONS = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
];

const STRAT_OPTIONS = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Focal' },
  { value: 2, label: 'Complete' },
];

/**
 * Accordion section for a single anatomical site.
 * Renders two MeasurementGroups (Long + Cross) and four ScoreSelectors.
 *
 * Collapsed header shows a BWT badge (⚠ if > 3 mm) and Doppler score
 * for at-a-glance review without opening every section.
 */
export default function SiteAccordion({
  site, // { key, label }
  isOpen,
  onToggle,
  siteState, // from IUScanAssignmentService.getFullState()[site.key]
  valueByUID,
  measurements,
  assignSvc,
  measurementService,
}) {
  const longSlots = siteState?.longitudinal?.slots ?? [null, null, null];
  const crossSlots = siteState?.cross?.slots ?? [null, null, null];
  const obs = siteState?.observations ?? {};

  // Resolve all filled mm values for the header summary
  function resolveSlot(slot) {
    if (slot === null) return null;
    if (typeof slot === 'object' && slot !== null && 'value' in slot) return slot.value;
    const entry = valueByUID[slot];
    return entry != null ? entry.value : null;
  }
  const allResolved = [...longSlots, ...crossSlots].map(resolveSlot).filter(v => v !== null);
  const maxBWT = allResolved.length ? Math.max(...allResolved) : null;
  // Get unit from first filled slot
  const firstFilledSlot = [...longSlots, ...crossSlots].find(s => s !== null);
  const unit =
    firstFilledSlot != null
      ? typeof firstFilledSlot === 'object' && 'unit' in firstFilledSlot
        ? firstFilledSlot.unit
        : (valueByUID[firstFilledSlot]?.unit ?? 'cm')
      : 'cm';
  const isAbnormal = maxBWT !== null && (unit === 'mm' ? maxBWT > 3.0 : maxBWT > 0.3);

  return (
    <div className={`gi-accordion border-b border-gray-700 ${isOpen ? 'gi-accordion--open' : ''}`}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-gray-800"
        onClick={onToggle}
      >
        <span className="text-sm font-medium text-gray-200">{site.label}</span>

        <div className="flex items-center gap-2">
          {maxBWT !== null && (
            <span
              className={[
                'rounded px-1.5 py-0.5 font-mono text-xs',
                isAbnormal ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300',
              ].join(' ')}
              title="Max BWT across Long + Cross"
            >
              {maxBWT.toFixed(2)} {unit}
              {isAbnormal ? ' ⚠' : ''}
            </span>
          )}
          {(obs.doppler != null ||
            obs.inflammatoryFat != null ||
            obs.lymphadenopathy != null ||
            obs.stratification != null) && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-blue-500"
              title="Observations recorded"
            />
          )}
          <span className="ml-1 text-xs text-gray-500">{isOpen ? '▼' : '▶'}</span>
        </div>
      </button>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {isOpen && (
        <div className="space-y-3 overflow-x-hidden bg-gray-900 px-3 pb-3 pt-1">
          <MeasurementGroup
            label="Longitudinal (cm)"
            site={site.key}
            axis="longitudinal"
            slots={longSlots}
            valueByUID={valueByUID}
            measurements={measurements}
            assignSvc={assignSvc}
            measurementService={measurementService}
          />

          <MeasurementGroup
            label="Cross-sectional (cm)"
            site={site.key}
            axis="cross"
            slots={crossSlots}
            valueByUID={valueByUID}
            measurements={measurements}
            assignSvc={assignSvc}
            measurementService={measurementService}
          />

          <div className="gi-observations space-y-1 border-t border-gray-700 pt-2">
            <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">Observations</p>
            <ScoreSelector
              label="Doppler Vascularity"
              options={DOPPLER_OPTIONS}
              value={obs.doppler ?? null}
              onChange={v => assignSvc.setObservation(site.key, 'doppler', v)}
            />
            <ScoreSelector
              label="Inflammatory Fat"
              options={FAT_OPTIONS}
              value={obs.inflammatoryFat ?? null}
              onChange={v => assignSvc.setObservation(site.key, 'inflammatoryFat', v)}
            />
            <ScoreSelector
              label="Lymphadenopathy"
              options={LYMPH_OPTIONS}
              value={obs.lymphadenopathy ?? null}
              onChange={v => assignSvc.setObservation(site.key, 'lymphadenopathy', v)}
            />
            <ScoreSelector
              label="Wall Stratification"
              options={STRAT_OPTIONS}
              value={obs.stratification ?? null}
              onChange={v => assignSvc.setObservation(site.key, 'stratification', v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
