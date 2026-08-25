import React from 'react';
import MeasurementGroup from './MeasurementGroup';
import ResearchPairedMeasurementGrid from './ResearchPairedMeasurementGrid';
import ScoreSelector from './ScoreSelector';
import { COMPLICATION_TYPES, MEASUREMENT_GROUPS } from '../../utils/labelMap';
import {
  getResearchVisibleMeasurementGroups,
  researchComponentEnabled,
} from '../../utils/researchProtocol';

const HAUSTRATION_OPTIONS = [
  { value: 1, label: 'Present' },
  { value: 0, label: 'Absent' },
];
const COMPLICATION_OPTIONS = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
];
const DOPPLER_OPTIONS = [0, 1, 2, 3].map(value => ({ value, label: String(value) }));
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
const CINE_QUALITY_OPTIONS = [1, 2, 3, 4, 5].map(value => ({
  value,
  label: value === 1 ? '1 Terrible' : value === 5 ? '5 Optimal' : String(value),
}));

const STRICTURE_FIELDS = [
  { key: 'strictureMaxBWT', label: 'Maximum bowel wall thickness (cm)', placeholder: 'e.g. 0.45' },
  { key: 'strictureMinimalLuminalDiameter', label: 'Minimal luminal diameter (cm)', placeholder: 'e.g. 0.8' },
  { key: 'strictureLength', label: 'Stricture length (cm)', placeholder: 'e.g. 3.5' },
  { key: 'strictureUpstreamDilation', label: 'Upstream dilation (cm)', placeholder: 'e.g. 2.1' },
];

const hasStrictureSelected = obs =>
  Array.isArray(obs?.complicationTypes) && obs.complicationTypes.includes('stricture');

export default function SiteAccordion({
  site,
  isOpen,
  onToggle,
  siteState,
  observations,
  measurements,
  savedAnnotations,
  measurementService,
  commandsManager,
  onObservationChange,
  onObservationsChange,
  onRemoveMeasurement,
  researchContext = null,
}) {
  const obs = observations ?? {};
  const isResearch = !!researchContext;
  const pairedMeasurements = isResearch && researchComponentEnabled(
    researchContext,
    'pairedBwtSubmucosa',
    site.key
  );
  const visibleGroups = isResearch
    ? getResearchVisibleMeasurementGroups(researchContext, site.key)
    : MEASUREMENT_GROUPS;

  const slotsByGroup = MEASUREMENT_GROUPS.reduce((acc, group) => {
    acc[group.stateKey] = siteState?.[group.stateKey]?.slots ?? [null, null, null];
    return acc;
  }, {});

  const resolveValueInMm = slot => {
    if (!slot) return null;
    const stats = slot?.data && typeof slot.data === 'object' ? Object.values(slot.data)[0] : null;
    const raw = Number(
      slot.value ?? slot.length ?? slot.measurements?.length ?? slot.measurements?.value ?? stats?.length
    );
    if (!Number.isFinite(raw)) return null;
    const unit = String(
      slot.unit ?? slot.lengthUnit ?? slot.measurements?.lengthUnit ?? slot.measurements?.unit ?? stats?.unit ?? 'mm'
    );
    return /^cm\b/i.test(unit) ? raw * 10 : raw;
  };

  const bwtSlots = visibleGroups
    .filter(group => group.role === 'bwt')
    .flatMap(group => slotsByGroup[group.stateKey]);
  const allResolvedBwt = bwtSlots.map(resolveValueInMm).filter(value => value !== null);
  const maxBWT = allResolvedBwt.length ? Math.max(...allResolvedBwt) : null;
  const isAbnormal = maxBWT !== null && maxBWT > 3.0;

  const showSegmentLength = isResearch
    ? researchComponentEnabled(researchContext, 'segmentLength', site.key)
    : site.hasSegmentLength;
  const showDoppler = !isResearch || researchComponentEnabled(researchContext, 'dopplerFlow', site.key);
  const showFat = !isResearch || researchComponentEnabled(researchContext, 'inflammatoryFat', site.key);
  const showStratification = !isResearch || researchComponentEnabled(researchContext, 'stratification', site.key);
  const showLymph = !isResearch || researchComponentEnabled(researchContext, 'lymphadenopathy', site.key);
  const showHaustration = isResearch
    ? researchComponentEnabled(researchContext, 'haustration', site.key)
    : site.hasHaustrations;
  const showCineQuality = isResearch && researchComponentEnabled(researchContext, 'cineQuality', site.key);
  const showComplications = isResearch
    ? researchComponentEnabled(researchContext, 'complications', site.key)
    : site.hasComplications;
  const showObservations = showDoppler || showFat || showStratification || showLymph || showHaustration || showCineQuality;

  const hasObservationData =
    obs.doppler != null ||
    obs.inflammatoryFat != null ||
    obs.lymphadenopathy != null ||
    obs.stratification != null ||
    obs.haustrations != null ||
    obs.cineQuality != null ||
    String(obs.cineQualityComment || '').trim() !== '' ||
    String(obs.segmentLength || '').trim() !== '' ||
    obs.complications != null ||
    (obs.complicationTypes ?? []).length > 0 ||
    String(obs.complicationText || '').trim() !== '' ||
    String(obs.strictureMaxBWT || '').trim() !== '' ||
    String(obs.strictureMinimalLuminalDiameter || '').trim() !== '' ||
    String(obs.strictureLength || '').trim() !== '' ||
    String(obs.strictureUpstreamDilation || '').trim() !== '';

  return (
    <div className={`gi-accordion border-b border-gray-700 ${isOpen ? 'gi-accordion--open' : ''}`}>
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
              title="Max BWT"
            >
              {maxBWT.toFixed(2)} mm{isAbnormal ? ' ⚠' : ''}
            </span>
          )}
          {hasObservationData && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" title="Observations recorded" />
          )}
          <span className="ml-1 text-xs text-gray-500">{isOpen ? '▼' : '▶'}</span>
        </div>
      </button>

      {isOpen && (
        <div className="space-y-3 overflow-x-hidden bg-gray-900 px-3 pb-3 pt-1">
          {pairedMeasurements ? (
            <ResearchPairedMeasurementGrid
              siteState={siteState}
              measurementService={measurementService}
              commandsManager={commandsManager}
              onRemove={onRemoveMeasurement}
            />
          ) : (
            visibleGroups.map(group => (
              <MeasurementGroup
                key={group.stateKey}
                label={`${group.label} (mm)`}
                site={site}
                group={group}
                slots={slotsByGroup[group.stateKey]}
                measurements={measurements}
                savedAnnotations={savedAnnotations}
                measurementService={measurementService}
                commandsManager={commandsManager}
                onRemove={onRemoveMeasurement}
              />
            ))
          )}

          {showSegmentLength && (
            <div className="border-t border-gray-700 pt-2">
              <label className="mb-1 block text-xs text-gray-400">Segment length involved (cm)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                value={obs.segmentLength ?? ''}
                onChange={event => onObservationChange?.(site.key, 'segmentLength', event.target.value)}
                placeholder="e.g. 5.0"
              />
            </div>
          )}

          {showObservations && (
            <div className="gi-observations space-y-1 border-t border-gray-700 pt-2">
              <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">Observations</p>
              {showDoppler && (
                <ScoreSelector label="Doppler Vascularity" options={DOPPLER_OPTIONS} value={obs.doppler ?? null} onChange={value => onObservationChange?.(site.key, 'doppler', value)} />
              )}
              {showFat && (
                <ScoreSelector label="Inflammatory Fat" options={FAT_OPTIONS} value={obs.inflammatoryFat ?? null} onChange={value => onObservationChange?.(site.key, 'inflammatoryFat', value)} />
              )}
              {showStratification && (
                <ScoreSelector label="Wall Stratification" options={STRAT_OPTIONS} value={obs.stratification ?? null} onChange={value => onObservationChange?.(site.key, 'stratification', value)} />
              )}
              {showLymph && (
                <ScoreSelector label="Lymphadenopathy" options={LYMPH_OPTIONS} value={obs.lymphadenopathy ?? null} onChange={value => onObservationChange?.(site.key, 'lymphadenopathy', value)} />
              )}
              {showHaustration && (
                <ScoreSelector label="Haustration" options={HAUSTRATION_OPTIONS} value={obs.haustrations ?? null} onChange={value => onObservationChange?.(site.key, 'haustrations', value)} />
              )}
              {showCineQuality && (
                <div className="mt-2 border-t border-gray-800 pt-2">
                  <ScoreSelector label="Segment Cine Quality" options={CINE_QUALITY_OPTIONS} value={obs.cineQuality ?? null} onChange={value => onObservationChange?.(site.key, 'cineQuality', value)} />
                  <textarea
                    className="mt-2 min-h-[52px] w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100"
                    value={obs.cineQualityComment ?? ''}
                    onChange={event => onObservationChange?.(site.key, 'cineQualityComment', event.target.value)}
                    placeholder="Cine quality comments..."
                  />
                </div>
              )}
            </div>
          )}

          {showComplications && (
            <div className="mt-2 border-t border-gray-700 pt-2">
              <ScoreSelector
                label="Complications"
                options={COMPLICATION_OPTIONS}
                value={obs.complications ?? null}
                onChange={value => {
                  if (value === 0 || value == null) {
                    onObservationsChange?.(site.key, {
                      complications: value,
                      complicationTypes: [],
                      complicationText: '',
                      strictureMaxBWT: '',
                      strictureMinimalLuminalDiameter: '',
                      strictureLength: '',
                      strictureUpstreamDilation: '',
                    });
                  } else {
                    onObservationChange?.(site.key, 'complications', value);
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
                              ? current.filter(value => value !== item.value)
                              : [...current, item.value];
                            if (selected && item.value === 'stricture') {
                              onObservationsChange?.(site.key, {
                                complicationTypes: next,
                                strictureMaxBWT: '',
                                strictureMinimalLuminalDiameter: '',
                                strictureLength: '',
                                strictureUpstreamDilation: '',
                              });
                            } else {
                              onObservationChange?.(site.key, 'complicationTypes', next);
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
                      <div className="mb-2 text-xs font-semibold text-gray-300">Stricture measurements</div>
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
                              onChange={event => onObservationChange?.(site.key, field.key, event.target.value)}
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
                    onChange={event => onObservationChange?.(site.key, 'complicationText', event.target.value)}
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
