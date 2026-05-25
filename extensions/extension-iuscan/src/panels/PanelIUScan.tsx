import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useMeasurements } from '@ohif/extension-cornerstone';
import SiteAccordion from './components/SiteAccordion';
import { SITES } from '../utils/labelMap';

/**
 * Main iUSCAN right panel.
 *
 * Uses the OHIF built-in useMeasurements() hook for reactive live caliper
 * updates (debounced, deep-compared internally — no manual event subscription).
 *
 * Uses IUScanAssignmentService for slot assignments and scored observations,
 * subscribing to ASSIGNMENT_CHANGED for re-renders.
 *
 * Terminal Ileum opens by default — most commonly abnormal segment in Crohn's.
 */
export default function PanelIUScan({ servicesManager, commandsManager }) {
  const { measurementService } = servicesManager.services;
  const assignSvc = servicesManager.services.iuscanAssignmentService;

  // ── Open/close accordion state ────────────────────────────────────────────
  const [openSite, setOpenSite] = useState(() => {
    // Open the first site that has any assignment, otherwise default to terminalIleum
    const state = assignSvc.getFullState();
    const assignedSite = Object.entries(state).find(([siteKey]) =>
      assignSvc.siteHasReportableData(siteKey)
    );
    return assignedSite?.[0] ?? 'terminalIleum';
  });

  // ── Assignment state — re-renders when service broadcasts ─────────────────
  const [assignState, setAssignState] = useState(() => assignSvc.getFullState());

  useEffect(() => {
    const sub = assignSvc.subscribe(assignSvc.EVENTS.ASSIGNMENT_CHANGED, ({ site }) => {
      setAssignState(assignSvc.getFullState());
      // Auto-expand the accordion for the site that just received an assignment
      if (site) setTimeout(() => setOpenSite(site), 50);
    });
    return () => sub?.unsubscribe?.();
  }, [assignSvc]);

  // ── Live measurements from MeasurementService ─────────────────────────────
  // useMeasurements subscribes to MEASUREMENT_ADDED/UPDATED/REMOVED/CLEARED
  // automatically and debounces + deep-compares to avoid excess re-renders.
  const measurements = useMeasurements({});

  // UID → mm value lookup (recomputed only when measurements change)
  const valueByUID = useMemo(() => {
    const map = {};
    measurements.forEach(m => {
      if (!m.uid || !m.data) return;
      // Length tool stores value in data.cachedStats[targetId].length
      // MeasurementService maps data = cachedStats, so data[targetId].length
      const firstKey = Object.keys(m.data)[0];
      if (!firstKey) return;
      const length = m.data[firstKey]?.length;
      const unit = m.data[firstKey]?.unit;
      if (length != null) map[m.uid] = { value: length, unit: unit ?? 'cm' };
    });
    return map;
  }, [measurements]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleToggle = useCallback(key => {
    setOpenSite(prev => (prev === key ? null : key));
  }, []);

  const hasAssignments = assignSvc.hasAnyAssignment();

  function handleExport() {
    commandsManager.runCommand('exportIUScanReport');
  }

  function handleClear() {
    commandsManager.runCommand('clearIUScanMeasurements');
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="gi-panel flex h-full flex-col overflow-x-hidden bg-gray-900 text-white">
      {/* Header */}
      <div className="gi-panel-header flex shrink-0 items-center justify-between border-b border-gray-700 px-3 py-2">
        <span className="text-sm font-semibold text-gray-100">Bowel Measurements</span>
        <span className="text-xs text-gray-500">
          {measurements.length > 0
            ? `${measurements.length} measurement${measurements.length !== 1 ? 's' : ''}`
            : ''}
        </span>
      </div>

      {/* Instruction hint (shown until first caliper placed) */}
      {measurements.length === 0 && (
        <div className="border-b border-gray-800 px-3 py-2 text-xs text-gray-500">
          Draw calipers with the Length tool. Select a label to auto-assign to the matching segment.
        </div>
      )}

      {/* Accordion list */}
      <div className="gi-panel-body flex-1 overflow-y-auto">
        {SITES.map(site => (
          <SiteAccordion
            key={site.key}
            site={site}
            isOpen={openSite === site.key}
            onToggle={() => handleToggle(site.key)}
            siteState={assignState[site.key]}
            valueByUID={valueByUID}
            measurements={measurements}
            assignSvc={assignSvc}
            measurementService={measurementService}
          />
        ))}
      </div>

      {/* Footer action buttons */}
      <div className="gi-panel-footer flex shrink-0 gap-2 border-t border-gray-700 px-3 py-2">
        <button
          className={[
            'flex-1 rounded border py-1.5 text-xs transition-colors',
            hasAssignments
              ? 'border-gray-500 text-gray-300 hover:border-red-400 hover:text-red-400'
              : 'cursor-not-allowed border-gray-700 text-gray-600',
          ].join(' ')}
          disabled={!hasAssignments}
          onClick={handleClear}
          title="Clear all measurements and assignments"
        >
          Clear All
        </button>
        <button
          className={[
            'flex-1 rounded border py-1.5 text-xs font-semibold transition-colors',
            hasAssignments
              ? 'border-primary-light bg-primary-light hover:bg-primary-dark hover:text-primary-light text-black'
              : 'cursor-not-allowed border-gray-700 text-gray-600',
          ].join(' ')}
          disabled={!hasAssignments}
          onClick={handleExport}
          title="Save measurements to report (Ctrl+Shift+S)"
        >
          Save to Report
        </button>
      </div>
    </div>
  );
}
