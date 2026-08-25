import React from 'react';
import { getIuscanRepeatedAnnotationId } from '../../utils/repeatedMeasurements';

const toMillimeters = value => {
  if (!value) return null;
  const stats = value?.data && typeof value.data === 'object' ? Object.values(value.data)[0] : null;
  const raw = Number(
    value.value ?? value.length ?? value.measurements?.length ?? value.measurements?.value ?? stats?.length
  );
  if (!Number.isFinite(raw)) return null;
  const unit = String(
    value.unit ?? value.lengthUnit ?? value.measurements?.lengthUnit ?? value.measurements?.unit ?? stats?.unit ?? 'mm'
  );
  return /^cm\b/i.test(unit) ? raw * 10 : raw;
};

function MeasurementCell({ slot, measurementService, commandsManager, onRemove }) {
  const value = toMillimeters(slot);
  const measurementId = getIuscanRepeatedAnnotationId(slot);
  const live = measurementId ? measurementService.getMeasurement?.(measurementId) : null;
  const navigable = !!measurementId && (!!live || !!slot?.referencedImageId);

  function jump() {
    if (!measurementId) return;
    if (live) {
      measurementService.jumpToMeasurement(null, measurementId);
      return;
    }
    commandsManager?.runCommand?.('jumpToSavedViewerAnnotation', { annotation: slot });
  }

  return (
    <div className="flex min-h-[34px] min-w-0 items-center justify-between rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs">
      {value == null ? (
        <span className="w-full text-center text-gray-500">—</span>
      ) : (
        <>
          <button
            type="button"
            className={
              navigable
                ? 'min-w-0 truncate font-mono text-gray-100 hover:text-primary-light'
                : 'min-w-0 truncate font-mono text-gray-100'
            }
            onClick={navigable ? jump : undefined}
            title={navigable ? 'Click to jump to annotation' : ''}
          >
            {value.toFixed(2)} mm
          </button>
          <button
            type="button"
            className="ml-1 shrink-0 leading-none text-gray-400 hover:text-red-400"
            onClick={() => onRemove?.(slot)}
            title="Remove"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

function PairRow({ label, bwt, submucosa, measurementService, commandsManager, onRemove }) {
  const bwtValue = toMillimeters(bwt);
  const submucosaValue = toMillimeters(submucosa);
  const percent =
    bwtValue && submucosaValue != null ? (submucosaValue / bwtValue) * 100 : null;

  return (
    <div className="rounded border border-gray-800 bg-gray-950/40 p-2">
      <div className="mb-1.5 text-xs font-medium text-gray-300">{label}</div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_48px] gap-1.5">
        <div className="min-w-0">
          <div className="mb-1 text-center text-[10px] uppercase tracking-wide text-gray-500">BWT</div>
          <MeasurementCell
            slot={bwt}
            measurementService={measurementService}
            commandsManager={commandsManager}
            onRemove={onRemove}
          />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-center text-[10px] uppercase tracking-wide text-gray-500">Submucosa</div>
          <MeasurementCell
            slot={submucosa}
            measurementService={measurementService}
            commandsManager={commandsManager}
            onRemove={onRemove}
          />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-center text-[10px] uppercase tracking-wide text-gray-500">%</div>
          <div className="flex min-h-[34px] items-center justify-center rounded border border-gray-800 bg-gray-900 px-1 font-mono text-[11px] text-gray-300">
            {percent == null ? '—' : `${percent.toFixed(1)}%`}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResearchPairedMeasurementGrid({
  siteState,
  measurementService,
  commandsManager,
  onRemove,
}) {
  const longitudinalBwt = siteState?.longitudinal?.slots || [];
  const longitudinalSubmucosa = siteState?.submucosaLongitudinal?.slots || [];
  const crossBwt = siteState?.cross?.slots || [];
  const crossSubmucosa = siteState?.submucosaCross?.slots || [];

  const rows = [
    { label: 'Longitudinal 1', bwt: longitudinalBwt[0], submucosa: longitudinalSubmucosa[0] },
    { label: 'Longitudinal 2', bwt: longitudinalBwt[1], submucosa: longitudinalSubmucosa[1] },
    { label: 'Cross 1', bwt: crossBwt[0], submucosa: crossSubmucosa[0] },
    { label: 'Cross 2', bwt: crossBwt[1], submucosa: crossSubmucosa[1] },
  ];

  return (
    <div className="mb-3 min-w-0 rounded border border-gray-700 bg-gray-900/60 p-2">
      <div className="text-xs font-semibold text-gray-300">Paired BWT / Submucosa</div>
      <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
        Each row is one matched BWT and submucosal measurement pair.
      </div>

      <div className="mt-2 space-y-2">
        {rows.map(row => (
          <PairRow
            key={row.label}
            label={row.label}
            bwt={row.bwt}
            submucosa={row.submucosa}
            measurementService={measurementService}
            commandsManager={commandsManager}
            onRemove={onRemove}
          />
        ))}
      </div>

      <div className="mt-2 text-[11px] leading-4 text-gray-500">
        Draw each caliper with its segment label. Measurements fill the paired slots in order.
      </div>
    </div>
  );
}
