import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useMeasurements } from '@ohif/extension-cornerstone';
import SiteAccordion from './components/SiteAccordion';
import { SITES } from '../utils/labelMap';
import {
  buildIuscanSiteMeasurementState,
  getIuscanRepeatedAnnotationId,
  normalizeSavedIuscanRepeatedAnnotations,
} from '../utils/repeatedMeasurements';
import {
  getLegacyIuscanMeasurementPlaceholders,
  hydrateBowelObservationsFromSeriesDoc,
} from '../utils/reportBuilder';
import {
  getActiveResearchContext,
  getActiveResearchReview,
  getResearchReviewKeyFromViewerUrl,
  getResearchStudyKeyFromViewerUrl,
  getResearchVisibleSites,
  loadActiveResearchReviewFromViewer,
  loadResearchContextFromViewer,
  subscribeResearchContext,
} from '../utils/researchProtocol';

const emptyObservations = () =>
  Object.fromEntries(
    SITES.map(site => [
      site.key,
      {
        doppler: null,
        inflammatoryFat: null,
        lymphadenopathy: null,
        stratification: null,
        haustrations: null,
        cineQuality: null,
        cineQualityComment: '',
        segmentLength: '',
        complications: null,
        complicationTypes: [],
        complicationText: '',
        strictureMaxBWT: '',
        strictureMinimalLuminalDiameter: '',
        strictureLength: '',
        strictureUpstreamDilation: '',
      },
    ])
  );

export default function PanelIUScan({ servicesManager, commandsManager }) {
  const { measurementService } = servicesManager.services;
  const measurements = useMeasurements({});

  const [researchContext, setResearchContext] = useState(() => getActiveResearchContext());
  const [savedAnnotations, setSavedAnnotations] = useState([]);
  const [removedAnnotationIds, setRemovedAnnotationIds] = useState(() => new Set());
  const [observationsBySite, setObservationsBySite] = useState(emptyObservations);
  const [openSite, setOpenSite] = useState('terminalIleum');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeResearchContext(context => setResearchContext(context));
    loadResearchContextFromViewer().catch(error => {
      console.warn('[iUSCAN] research context unavailable:', error?.message || error);
    });
    return unsubscribe;
  }, []);

  const visibleSites = useMemo(
    () => getResearchVisibleSites(researchContext),
    [researchContext]
  );

  const loadSavedState = useCallback(async () => {
    // Research context is loaded asynchronously. On the first render it may still
    // be null even though the URL already identifies a Research launch. Do not
    // fall through to the clinical Series hydration path during that window: a
    // slower clinical read can otherwise overwrite the ResearchReview state after
    // it has been restored.
    const researchLaunchPending =
      !researchContext &&
      !!(getResearchReviewKeyFromViewerUrl() || getResearchStudyKeyFromViewerUrl());

    if (researchLaunchPending) {
      return;
    }

    setIsLoading(true);
    try {
      if (researchContext?.preview) {
        setSavedAnnotations([]);
        setObservationsBySite(emptyObservations());
        setRemovedAnnotationIds(new Set());
        const firstResearchSite = getResearchVisibleSites(researchContext)[0];
        setOpenSite(firstResearchSite?.key || 'terminalIleum');
        return;
      }

      if (researchContext?.reviewKey) {
        const review =
          getActiveResearchReview() || (await loadActiveResearchReviewFromViewer({ forceRefresh: true }));
        const repeated = normalizeSavedIuscanRepeatedAnnotations(
          (review?.measurementAnnotations || []).filter(
            annotation => annotation?.mode === 'repeated' || annotation?.repeatedMeasurement
          )
        );

        setSavedAnnotations(repeated);
        setObservationsBySite({
          ...emptyObservations(),
          ...(review?.observationsBySite || {}),
        });
        setRemovedAnnotationIds(new Set());

        const measurementState = buildIuscanSiteMeasurementState({
          liveMeasurements: measurements,
          savedAnnotations: repeated,
        });
        const firstPopulatedSite = getResearchVisibleSites(researchContext).find(site =>
          Object.values(measurementState[site.key] || {}).some(group =>
            group?.slots?.some(slot => slot != null)
          )
        );
        setOpenSite(firstPopulatedSite?.key || getResearchVisibleSites(researchContext)[0]?.key || 'terminalIleum');
        return;
      }

      const result = await commandsManager.runCommand('getViewerMeasurementAnnotationsForActiveStudy', {
        domain: 'iuscan',
        workflows: ['viewerMeasurements'],
        includeRepeated: true,
      });

      const repeated = normalizeSavedIuscanRepeatedAnnotations(
        (result?.annotations || []).filter(
          annotation => annotation?.mode === 'repeated' || annotation?.repeatedMeasurement
        )
      );
      const legacyPlaceholders = getLegacyIuscanMeasurementPlaceholders(
        result?.seriesDoc || {},
        repeated
      );
      const panelAnnotations = [...repeated, ...legacyPlaceholders];

      setSavedAnnotations(panelAnnotations);
      setObservationsBySite({
        ...emptyObservations(),
        ...hydrateBowelObservationsFromSeriesDoc(result?.seriesDoc || {}),
      });
      setRemovedAnnotationIds(new Set());

      const measurementState = buildIuscanSiteMeasurementState({
        liveMeasurements: measurements,
        savedAnnotations: panelAnnotations,
      });
      const firstPopulatedSite = SITES.find(site =>
        Object.values(measurementState[site.key] || {}).some(group =>
          group?.slots?.some(slot => slot != null)
        )
      );
      if (firstPopulatedSite) {
        setOpenSite(firstPopulatedSite.key);
      }
    } catch (error) {
      console.warn('[iUSCAN] unable to load saved bowel panel state:', error?.message || error);
    } finally {
      setIsLoading(false);
    }
  }, [commandsManager, researchContext]);

  useEffect(() => {
    loadSavedState();
  }, [loadSavedState]);

  const measurementState = useMemo(
    () =>
      buildIuscanSiteMeasurementState({
        liveMeasurements: measurements,
        savedAnnotations,
        removedAnnotationIds: Array.from(removedAnnotationIds),
      }),
    [measurements, savedAnnotations, removedAnnotationIds]
  );

  const hasMeasurementData = useMemo(
    () =>
      visibleSites.some(site =>
        Object.values(measurementState[site.key] || {}).some(group =>
          group?.slots?.some(slot => slot != null)
        )
      ),
    [measurementState, visibleSites]
  );

  const hasObservationData = useMemo(
    () =>
      visibleSites.some(site => {
        const obs = observationsBySite[site.key];
        return !!(
          obs &&
          (obs.doppler != null ||
            obs.inflammatoryFat != null ||
            obs.lymphadenopathy != null ||
            obs.stratification != null ||
            obs.haustrations != null ||
            obs.cineQuality != null ||
            String(obs.cineQualityComment || '').trim() !== '' ||
            String(obs.segmentLength || '').trim() !== '' ||
            obs.complications != null ||
            (obs.complicationTypes || []).length > 0 ||
            String(obs.complicationText || '').trim() !== '')
        );
      }),
    [observationsBySite, visibleSites]
  );

  const handleToggle = useCallback(key => {
    setOpenSite(prev => (prev === key ? null : key));
  }, []);

  const handleObservationChange = useCallback((siteKey, field, value) => {
    setObservationsBySite(prev => ({
      ...prev,
      [siteKey]: {
        ...(prev[siteKey] || {}),
        [field]: value,
      },
    }));
  }, []);

  const handleObservationsChange = useCallback((siteKey, patch) => {
    setObservationsBySite(prev => ({
      ...prev,
      [siteKey]: {
        ...(prev[siteKey] || {}),
        ...patch,
      },
    }));
  }, []);

  const handleRemoveMeasurement = useCallback(
    slot => {
      const id = getIuscanRepeatedAnnotationId(slot);
      if (!id) return;

      setRemovedAnnotationIds(prev => new Set([...prev, id]));
      if (measurementService.getMeasurement?.(id)) {
        commandsManager.runCommand('removeMeasurement', { uid: id });
      }
    },
    [commandsManager, measurementService]
  );

  async function handleSave() {
    if (researchContext?.preview) {
      return;
    }

    setIsSaving(true);
    try {
      if (researchContext?.reviewKey) {
        const savedReview = await commandsManager.runCommand('exportIUScanResearchReview', {
          observationsBySite,
          savedAnnotations,
          removedAnnotationIds: Array.from(removedAnnotationIds),
        });

        const repeated = normalizeSavedIuscanRepeatedAnnotations(
          (savedReview?.measurementAnnotations || []).filter(
            annotation => annotation?.mode === 'repeated' || annotation?.repeatedMeasurement
          )
        );

        setSavedAnnotations(repeated);
        setObservationsBySite({
          ...emptyObservations(),
          ...(savedReview?.observationsBySite || observationsBySite),
        });
        setRemovedAnnotationIds(new Set());
      } else {
        await commandsManager.runCommand('exportIUScanReport', {
          observationsBySite,
          removedAnnotationIds: Array.from(removedAnnotationIds),
        });
        await loadSavedState();
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleClear() {
    const currentIds = new Set(removedAnnotationIds);
    for (const site of visibleSites) {
      for (const groupState of Object.values(measurementState[site.key] || {})) {
        for (const slot of groupState?.slots || []) {
          const id = getIuscanRepeatedAnnotationId(slot);
          if (id) currentIds.add(id);
        }
      }
    }

    setRemovedAnnotationIds(currentIds);
    setObservationsBySite(emptyObservations());
    commandsManager.runCommand('clearIUScanMeasurements');
  }

  const hasAnyData = hasMeasurementData || hasObservationData || removedAnnotationIds.size > 0;
  const panelTitle = researchContext ? researchContext.title : 'Bowel Measurements';

  return (
    <div className="gi-panel flex h-full flex-col overflow-x-hidden bg-gray-900 text-white">
      <div className="gi-panel-header shrink-0 border-b border-gray-700 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-100">{panelTitle}</span>
          <span className="text-xs text-gray-500">
            {researchContext ? 'Research' : measurements.length > 0
              ? `${measurements.length} measurement${measurements.length !== 1 ? 's' : ''}`
              : isLoading ? 'Loading…' : ''}
          </span>
        </div>
        {researchContext && (
          <div className="mt-1 text-[11px] text-gray-500">
            Protocol-driven assessment{researchContext.preview ? ' · preview only' : ''}
          </div>
        )}
      </div>

      {researchContext?.error && (
        <div className="border-b border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          Unable to load the Research Study protocol: {researchContext.error}
        </div>
      )}

      {!researchContext && measurements.length === 0 && savedAnnotations.length === 0 && !isLoading && (
        <div className="border-b border-gray-800 px-3 py-2 text-xs text-gray-500">
          Draw calipers with the Length tool. Select a BWT or submucosa label to auto-fill the matching row.
        </div>
      )}

      {researchContext && (
        <div className="border-b border-gray-800 px-3 py-2 text-xs text-gray-400">
          Only segments and assessment components selected in this Research Study are shown.
        </div>
      )}

      <div className="gi-panel-body flex-1 overflow-y-auto">
        {visibleSites.map(site => (
          <SiteAccordion
            key={site.key}
            site={site}
            isOpen={openSite === site.key}
            onToggle={() => handleToggle(site.key)}
            siteState={measurementState[site.key]}
            observations={observationsBySite[site.key]}
            measurements={measurements}
            savedAnnotations={savedAnnotations}
            measurementService={measurementService}
            commandsManager={commandsManager}
            onObservationChange={handleObservationChange}
            onObservationsChange={handleObservationsChange}
            onRemoveMeasurement={handleRemoveMeasurement}
            researchContext={researchContext}
          />
        ))}
        {researchContext && !visibleSites.length && !isLoading && (
          <div className="px-3 py-4 text-xs text-gray-500">No bowel segments are selected in this protocol.</div>
        )}
      </div>

      <div className="gi-panel-footer flex shrink-0 gap-2 border-t border-gray-700 px-3 py-2">
        <button
          type="button"
          className={[
            'flex-1 rounded border py-1.5 text-xs transition-colors',
            hasAnyData
              ? 'border-gray-500 text-gray-300 hover:border-red-400 hover:text-red-400'
              : 'cursor-not-allowed border-gray-700 text-gray-600',
          ].join(' ')}
          disabled={!hasAnyData || isSaving}
          onClick={handleClear}
          title="Clear current measurements and observations"
        >
          Clear All
        </button>
        {researchContext?.preview ? (
          <div className="flex-1 rounded border border-gray-700 px-2 py-1.5 text-center text-xs text-gray-500">
            Preview only
          </div>
        ) : (
          <button
            type="button"
            className={[
              'flex-1 rounded border py-1.5 text-xs font-semibold transition-colors',
              hasAnyData
                ? 'border-primary-light bg-primary-light hover:bg-primary-dark hover:text-primary-light text-black'
                : 'cursor-not-allowed border-gray-700 text-gray-600',
            ].join(' ')}
            disabled={!hasAnyData || isSaving}
            onClick={handleSave}
            title={researchContext?.reviewKey ? 'Save measurements and observations to the Research Review' : 'Save measurements and observations to AR (Ctrl+Shift+S)'}
          >
            {isSaving ? 'Saving…' : researchContext?.reviewKey ? 'Save Research Review' : 'Save to Report'}
          </button>
        )}
      </div>
    </div>
  );
}
