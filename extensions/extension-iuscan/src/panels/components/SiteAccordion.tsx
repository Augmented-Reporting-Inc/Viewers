import React from 'react';
import MeasurementGroup from './MeasurementGroup';
import ScoreSelector from './ScoreSelector';
import { COMPLICATION_TYPES } from '../../utils/labelMap';

const HAUSTRATION_OPTIONS = [
  { value: 1, label: 'Present' },
  { value: 0, label: 'Absent' },
];

const COMPLICATION_OPTIONS = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
];

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

const STRICTURE_FIELDS = [
  {
    key: 'strictureMaxBWT',
    label: 'Maximum bowel wall thickness (cm)',
    placeholder: 'e.g. 0.45',
  },
  {
    key: 'strictureMinimalLuminalDiameter',
    label: 'Minimal luminal diameter (cm)',
    placeholder: 'e.g. 0.8',
  },
  {
    key: 'strictureLength',
    label: 'Stricture length (cm)',
    placeholder: 'e.g. 3.5',
  },
  {
    key: 'strictureUpstreamDilation',
    label: 'Upstream dilation (cm)',
    placeholder: 'e.g. 2.1',
  },
];

const hasStrictureSelected = obs =>
  Array.isArray(obs?.complicationTypes) && obs.complicationTypes.includes('stricture');

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
    if (typeof slot === 'number') return slot;
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
            obs.stratification != null ||
            obs.haustrations != null ||
            String(obs.segmentLength || '').trim() !== '' ||
            obs.complications != null ||
            (obs.complicationTypes ?? []).length > 0 ||
            String(obs.complicationText || '').trim() !== '' ||
            String(obs.strictureMaxBWT || '').trim() !== '' ||
            String(obs.strictureMinimalLuminalDiameter || '').trim() !== '' ||
            String(obs.strictureLength || '').trim() !== '' ||
            String(obs.strictureUpstreamDilation || '').trim() !== '') && (
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
          {site.hasSegmentLength && (
            <div className="border-t border-gray-700 pt-2">
              <label className="mb-1 block text-xs text-gray-400">
                Segment length involved (cm)
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                value={obs.segmentLength ?? ''}
                onChange={e => assignSvc.setObservation(site.key, 'segmentLength', e.target.value)}
                placeholder="e.g. 5.0"
              />
            </div>
          )}
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
              label="Wall Stratification"
              options={STRAT_OPTIONS}
              value={obs.stratification ?? null}
              onChange={v => assignSvc.setObservation(site.key, 'stratification', v)}
            />
            <ScoreSelector
              label="Lymphadenopathy"
              options={LYMPH_OPTIONS}
              value={obs.lymphadenopathy ?? null}
              onChange={v => assignSvc.setObservation(site.key, 'lymphadenopathy', v)}
            />
            {site.hasHaustrations && (
              <ScoreSelector
                label="Haustrations"
                options={HAUSTRATION_OPTIONS}
                value={obs.haustrations ?? null}
                onChange={v => assignSvc.setObservation(site.key, 'haustrations', v)}
              />
            )}
          </div>
          {site.hasComplications && (
            <div className="mt-2 border-t border-gray-700 pt-2">
              <ScoreSelector
                label="Complications"
                options={COMPLICATION_OPTIONS}
                value={obs.complications ?? null}
                onChange={v => {
                  if (v === 0 || v == null) {
                    assignSvc.setObservations(site.key, {
                      complications: v,
                      complicationTypes: [],
                      complicationText: '',
                      strictureMaxBWT: '',
                      strictureMinimalLuminalDiameter: '',
                      strictureLength: '',
                      strictureUpstreamDilation: '',
                    });
                  } else {
                    assignSvc.setObservation(site.key, 'complications', v);
                  }
                }}
              />

              {obs.complications === 1 && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {COMPLICATION_TYPES.map(item => {
                      const selected = (obs.complicationTypes ?? []).includes(item.value);
                      return (
                        <button
                          key={item.value}
                          type="button"
                          className={[
                            'rounded border px-2 py-1 text-xs transition-colors',
                            selected
                              ? 'bg-primary-light border-primary-light font-semibold text-black'
                              : 'hover:border-primary-light hover:text-primary-light border-gray-600 bg-transparent text-gray-300',
                          ].join(' ')}
                          onClick={() => {
                            const current = obs.complicationTypes ?? [];
                            const next = selected
                              ? current.filter(v => v !== item.value)
                              : [...current, item.value];
                            if (selected && item.value === 'stricture') {
                              assignSvc.setObservations(site.key, {
                                complicationTypes: next,
                                strictureMaxBWT: '',
                                strictureMinimalLuminalDiameter: '',
                                strictureLength: '',
                                strictureUpstreamDilation: '',
                              });
                            } else {
                              assignSvc.setObservation(site.key, 'complicationTypes', next);
                            }
                          }}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  {hasStrictureSelected(obs) && (
                    <div className="bg-gray-950/40 rounded border border-gray-700 p-2">
                      <div className="mb-2 text-xs font-semibold text-gray-300">
                        Stricture measurements
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {STRICTURE_FIELDS.map(field => (
                          <label key={field.key} className="block">
                            <span className="mb-1 block text-xs text-gray-400">{field.label}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.1"
                              className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                              value={obs[field.key] ?? ''}
                              onChange={e =>
                                assignSvc.setObservation(site.key, field.key, e.target.value)
                              }
                              placeholder={field.placeholder}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <textarea
                    className="min-h-[56px] w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                    value={obs.complicationText ?? ''}
                    onChange={e =>
                      assignSvc.setObservation(site.key, 'complicationText', e.target.value)
                    }
                    placeholder="Describe complication findings..."
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
