import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateLVSimpson, LV_SIMPSON_SLOT_ORDER } from '../utils/lvSimpson';

function getMeasurementLabel(measurement) {
  return (
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.description ||
    measurement?.toolName ||
    'Unlabelled measurement'
  );
}

const AR_SAVED_ANNOTATIONS_REFRESH_EVENT = 'ar-measurements:saved-annotations-updated';

function finiteNumberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatMeasurementNumber(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return '';
  }

  if (Math.abs(numberValue) >= 100) {
    return numberValue.toFixed(0);
  }

  if (Math.abs(numberValue) >= 10) {
    return numberValue.toFixed(1);
  }

  return numberValue.toFixed(2);
}

function formatMeasurementValue(value, unit = 'mm') {
  const numberValue = finiteNumberOrNull(value);

  if (numberValue == null) {
    return '';
  }

  return `${formatMeasurementNumber(numberValue)} ${unit}`.trim();
}

function displayEntryToString(entry, unitType = 'length') {
  if (entry === undefined || entry === null) {
    return '';
  }

  if (typeof entry === 'string' || typeof entry === 'number') {
    return String(entry);
  }

  if (Array.isArray(entry)) {
    return flattenDisplayText(entry, unitType).join(' ');
  }

  if (typeof entry === 'object') {
    if (Array.isArray(entry.primary)) {
      return flattenDisplayText(entry.primary, unitType).join(' ');
    }

    for (const key of ['text', 'label', 'displayValue', 'formatted']) {
      if (entry[key]) {
        return String(entry[key]);
      }
    }

    const value = entry.length ?? entry.area ?? entry.value ?? entry.mean ?? entry.max ?? entry.min;

    const unit =
      entry.lengthUnit ||
      entry.areaUnit ||
      entry.areaUnits ||
      entry.unit ||
      entry.units ||
      (unitType === 'area' ? 'mm²' : 'mm');

    const formatted = formatMeasurementValue(value, unit);
    if (formatted) {
      return formatted;
    }
  }

  return '';
}

function flattenDisplayText(displayText, unitType = 'length') {
  const entries = Array.isArray(displayText) ? displayText : [displayText];

  return entries
    .flatMap(entry => {
      const value = displayEntryToString(entry, unitType);
      return value ? [value] : [];
    })
    .filter(Boolean);
}

function getFirstMeasurementStats(measurement) {
  const statsByTarget = measurement?.data || measurement?.cachedStats || {};
  const values = Object.values(statsByTarget || {}).filter(
    value => value && typeof value === 'object'
  );

  return values[0] || {};
}

function getMeasurementValue(measurement) {
  const unitType = getMeasurementUnitType(measurement);

  const displayText = flattenDisplayText(measurement?.displayText, unitType);
  if (displayText.length) {
    return normalizeDisplayTextUnits(displayText, unitType).join(' ');
  }

  const measurementDisplayText = flattenDisplayText(
    measurement?.measurements?.displayText,
    unitType
  );
  if (measurementDisplayText.length) {
    return normalizeDisplayTextUnits(measurementDisplayText, unitType).join(' ');
  }

  if (measurement?.measurements?.length != null) {
    const unit = normalizeDisplayLengthUnit(
      measurement.measurements.lengthUnit || measurement.measurements.unit || ''
    );
    return formatMeasurementValue(measurement.measurements.length, unit);
  }

  if (measurement?.measurements?.area != null) {
    const unit = normalizeDisplayAreaUnit(measurement.measurements.areaUnit || '');
    return formatMeasurementValue(measurement.measurements.area, unit);
  }

  const stats = getFirstMeasurementStats(measurement);

  if (stats?.length != null) {
    return formatMeasurementValue(
      stats.length,
      normalizeDisplayLengthUnit(stats.lengthUnit || stats.unit || '')
    );
  }

  if (stats?.area != null) {
    return formatMeasurementValue(
      stats.area,
      normalizeDisplayAreaUnit(stats.areaUnit || stats.areaUnits || stats.unit || '')
    );
  }

  if (finiteNumberOrNull(measurement?.value) != null) {
    return formatMeasurementValue(
      measurement.value,
      normalizeDisplayLengthUnit(measurement.unit || '')
    );
  }

  if (measurement?.value && typeof measurement.value === 'object') {
    const valueText = flattenDisplayText(measurement.value, unitType);
    if (valueText.length) {
      return normalizeDisplayTextUnits(valueText, unitType).join(' ');
    }
  }

  if (finiteNumberOrNull(measurement?.area) != null) {
    return formatMeasurementValue(
      measurement.area,
      normalizeDisplayAreaUnit(measurement.areaUnit || '')
    );
  }

  return '';
}

function isAreaMeasurement(measurement) {
  const toolName = String(measurement?.toolName || '');
  return (
    /ROI|Contour|Spline|Freehand/i.test(toolName) ||
    measurement?.measurements?.area != null ||
    measurement?.area != null
  );
}

function getMeasurementUnitType(measurement) {
  return isAreaMeasurement(measurement) ? 'area' : 'length';
}

function normalizeDisplayLengthUnit(unit = '') {
  return /px/i.test(String(unit || '')) ? 'mm' : unit || 'mm';
}

function normalizeDisplayAreaUnit(unit = '') {
  return /px/i.test(String(unit || '')) ? 'mm²' : unit || 'mm²';
}

function stripMeasurementSourceSuffix(text = '') {
  return String(text || '')
    .replace(/\s+\bUS Region\b/gi, '')
    .replace(/\s+\bAR_US_REGION_CALIBRATION\b/gi, '')
    .trim();
}

function normalizeDisplayTextUnits(displayText = [], unitType = 'length') {
  const nextUnit = unitType === 'area' ? 'mm²' : 'mm';

  return flattenDisplayText(displayText, unitType)
    .filter(Boolean)
    .map(text =>
      stripMeasurementSourceSuffix(
        String(text)
          .replace(/\bpx²\b/gi, nextUnit)
          .replace(/\bpx\^2\b/gi, nextUnit)
          .replace(/\bpx2\b/gi, nextUnit)
          .replace(/\bpx\b/gi, nextUnit)
      )
    );
}

function normalizeMeasurementForDisplay(measurement) {
  const unitType = getMeasurementUnitType(measurement);
  const measurements = measurement?.measurements || {};

  return {
    ...measurement,
    displayText: normalizeDisplayTextUnits(measurement?.displayText || [], unitType),
    measurements: {
      ...measurements,
      displayText: normalizeDisplayTextUnits(measurements.displayText || [], unitType),
      ...(measurements.length != null
        ? {
            unit: normalizeDisplayLengthUnit(measurements.unit),
            lengthUnit: normalizeDisplayLengthUnit(measurements.lengthUnit || measurements.unit),
          }
        : {}),
      ...(measurements.area != null
        ? {
            areaUnit: normalizeDisplayAreaUnit(measurements.areaUnit),
          }
        : {}),
    },
    ...(measurement?.unit ? { unit: normalizeDisplayLengthUnit(measurement.unit) } : {}),
    ...(measurement?.areaUnit ? { areaUnit: normalizeDisplayAreaUnit(measurement.areaUnit) } : {}),
  };
}

function mergeLiveMeasurementIntoSavedAnnotation(savedAnnotation, liveMeasurement) {
  // Keep saved AR/Mongo display values as the user-facing source of truth.
  // Live MeasurementService objects are still useful for visibility/jump state,
  // but their px/px² display text should not replace saved AR units.
  const normalizedSaved = normalizeMeasurementForDisplay(savedAnnotation);

  return {
    ...liveMeasurement,
    ...normalizedSaved,
    uid: normalizedSaved.uid || normalizedSaved.annotationId || liveMeasurement.uid,
    isSavedAnnotation: true,
  };
}

function hasSemanticLabel(measurement) {
  return !!(
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.role ||
    measurement?.slot
  );
}

function getMeasurementKey(measurement) {
  return measurement?.uid || measurement?.annotationId || measurement?.id;
}

function normalizeSavedAnnotation(annotation) {
  return normalizeMeasurementForDisplay({
    ...annotation,
    uid: annotation.uid || annotation.annotationId,
    isSavedAnnotation: true,
  });
}

function getFrameNumber(measurement) {
  if (measurement?.frameNumber && measurement.frameNumber > 1) {
    return measurement.frameNumber;
  }

  const match = String(measurement?.referencedImageId || '').match(/\/frames\/(\d+)/);
  const frame = Number(match?.[1]);

  return Number.isFinite(frame) && frame > 0 ? frame : '';
}

function getShortId(measurement) {
  const id = String(measurement?.uid || measurement?.annotationId || '');
  return id ? id.slice(0, 8) : '';
}

function getMeasurementSubtitle(measurement) {
  const parts = [measurement?.toolName];

  const frameNumber = getFrameNumber(measurement);

  if (frameNumber) {
    parts.push(`Frame ${frameNumber}`);
  }

  if (measurement?.measurementOwner === 'coach') {
    parts.unshift('Coach');
  } else if (measurement?.measurementOwner === 'learner') {
    parts.unshift('Learner');
  }

  if (Number(measurement?.reviewRound) > 0) {
    parts.push(`Round ${Number(measurement.reviewRound)}`);
  }

  if (measurement?.isSavedAnnotation) {
    parts.push('saved');
  }

  if (measurement?.isLocked === true) {
    parts.push('read-only');
  }

  const shortId = getShortId(measurement);

  if (shortId) {
    parts.push(shortId);
  }

  return parts.filter(Boolean).join(' • ');
}

function formatSimpsonValue(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '';
}

function LVSimpsonSummary({ result }) {
  if (!result) {
    return null;
  }

  const values = result.values;
  const isComplete = result.status === 'complete';

  return (
    <div className="bg-gray-950 mb-3 rounded border border-gray-700 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">LV Simpson Biplane</div>
          <div className="mt-1 text-xs text-gray-400">{result.method}</div>
        </div>
        <div
          className={`rounded px-2 py-1 text-xs font-semibold ${
            isComplete ? 'bg-green-900 text-green-100' : 'bg-yellow-900 text-yellow-100'
          }`}
        >
          {result.status}
        </div>
      </div>

      {values ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded bg-black p-2">
            <div className="text-xs text-gray-400">EDV</div>
            <div className="font-semibold">{formatSimpsonValue(values.edvML)} mL</div>
          </div>
          <div className="rounded bg-black p-2">
            <div className="text-xs text-gray-400">ESV</div>
            <div className="font-semibold">{formatSimpsonValue(values.esvML)} mL</div>
          </div>
          <div className="rounded bg-black p-2">
            <div className="text-xs text-gray-400">SV</div>
            <div className="font-semibold">{formatSimpsonValue(values.strokeVolumeML)} mL</div>
          </div>
          <div className="rounded bg-black p-2">
            <div className="text-xs text-gray-400">EF</div>
            <div className="font-semibold">{formatSimpsonValue(values.ejectionFraction, 0)}%</div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-1">
        {LV_SIMPSON_SLOT_ORDER.map(slot => {
          const slotResult = result.slots?.[slot];

          return (
            <div key={slot} className="flex justify-between gap-2 text-xs">
              <span className="text-gray-300">{slot.replace('_', ' ')}</span>
              <span className={slotResult?.complete ? 'text-green-300' : 'text-yellow-300'}>
                {slotResult?.complete
                  ? `complete • axis ${formatSimpsonValue(slotResult.longAxisLengthMM)} mm`
                  : 'missing/incomplete'}
              </span>
            </div>
          );
        })}
      </div>

      {result.messages?.length ? (
        <div className="mt-3 space-y-1 text-xs text-yellow-200">
          {result.messages.slice(0, 6).map(message => (
            <div key={message}>• {message}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getViewerUrlSearchParams() {
  const params = new URLSearchParams();

  try {
    const searchParams = new URLSearchParams(window.location?.search || '');
    searchParams.forEach((value, key) => {
      params.set(key, value);
    });
  } catch {}

  try {
    const hash = String(window.location?.hash || '');
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1).split('#')[0] : '';

    const hashParams = new URLSearchParams(hashQuery);
    hashParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
  } catch {}

  return params;
}

function getArViewerSaveTargetFromUrl() {
  try {
    const qs = getViewerUrlSearchParams();

    return {
      mode: String(qs.get('arSaveTarget') || '').trim(),
      baseSeriesId: String(qs.get('arBaseSeriesId') || '').trim(),
      seriesId: String(qs.get('arSeriesId') || '').trim(),
      learnerSeriesId: String(qs.get('arLearnerSeriesId') || '').trim(),
      launchSource: String(qs.get('arLaunchSource') || '').trim(),
      measurementWorkflowRole: String(qs.get('arMeasurementWorkflowRole') || '').trim(),
      reviewWorkflowType: String(qs.get('arReviewWorkflowType') || '').trim(),
      measurementAccess: String(qs.get('arMeasurementAccess') || '').trim(),
    };
  } catch {
    return {
      mode: '',
      baseSeriesId: '',
      seriesId: '',
      learnerSeriesId: '',
      launchSource: '',
      measurementWorkflowRole: '',
      reviewWorkflowType: '',
      measurementAccess: '',
    };
  }
}

function isLibraryLaunchSource(launchSource = '') {
  return (
    String(launchSource || '')
      .trim()
      .toLowerCase() === 'library'
  );
}

function isAllowedLibraryMeasurementWorkflowRole(role = '') {
  return ['learner', 'educator'].includes(
    String(role || '')
      .trim()
      .toLowerCase()
  );
}

function isLibraryLearnerCopyOnSaveTarget(saveTarget = getArViewerSaveTargetFromUrl()) {
  return (
    saveTarget.mode === 'learnerCopyOnSave' &&
    !!saveTarget.baseSeriesId &&
    isLibraryLaunchSource(saveTarget.launchSource) &&
    isAllowedLibraryMeasurementWorkflowRole(saveTarget.measurementWorkflowRole)
  );
}

function isLearnerViewerMeasurementWorkflowFromUrl() {
  return isLibraryLearnerCopyOnSaveTarget();
}

function normalizeMeasurementScoringToken(value = '') {
  return String(value || '')
    .trim()
    .replace(/[_\s-]+/g, '')
    .toLowerCase();
}

function isViewerQuizEducationScoringMode(value = '') {
  return normalizeMeasurementScoringToken(value) === 'viewerquiz';
}

function isDisabledMeasurementScoringValue(value = '') {
  const normalized = normalizeMeasurementScoringToken(value);
  return ['disabled', 'disable', 'false', 'off', 'no', '0'].includes(normalized);
}

function isViewerMeasurementScoringDisabledFromUrl() {
  try {
    const qs = getViewerUrlSearchParams();

    return (
      isViewerQuizEducationScoringMode(qs.get('arEducationScoringMode')) ||
      isDisabledMeasurementScoringValue(qs.get('arMeasurementScoring'))
    );
  } catch {
    return false;
  }
}

function getArLearnerSeriesIdFromUrl() {
  return getArViewerSaveTargetFromUrl().learnerSeriesId;
}

const REVIEW_WORKFLOW_MEASUREMENTS_SAVE_TARGET = 'reviewWorkflowMeasurements';

const VIEWER_MEASUREMENTS_WORKFLOW = 'viewerMeasurements';

const REVIEWER_MEASUREMENTS_WORKFLOW = 'reviewerMeasurements';

function isReviewWorkflowMeasurementsTarget(saveTarget: any = {}) {
  return (
    saveTarget.mode === REVIEW_WORKFLOW_MEASUREMENTS_SAVE_TARGET &&
    !!saveTarget.seriesId &&
    isLibraryLaunchSource(saveTarget.launchSource)
  );
}

function getWritableMeasurementWorkflow(saveTarget: any = {}) {
  if (
    !isReviewWorkflowMeasurementsTarget(saveTarget) ||
    String(saveTarget.measurementAccess || '')
      .trim()
      .toLowerCase() !== 'edit'
  ) {
    return '';
  }

  return String(saveTarget.measurementWorkflowRole || '')
    .trim()
    .toLowerCase() === 'educator'
    ? REVIEWER_MEASUREMENTS_WORKFLOW
    : VIEWER_MEASUREMENTS_WORKFLOW;
}

function isMeasurementEditable(measurement: any, saveTarget: any) {
  if (!isReviewWorkflowMeasurementsTarget(saveTarget)) {
    return true;
  }

  const writableWorkflow = getWritableMeasurementWorkflow(saveTarget);

  if (!writableWorkflow) {
    return false;
  }

  const workflow = String(measurement?.workflow || '').trim();

  if (!workflow) {
    return true;
  }

  return workflow === writableWorkflow && measurement?.isLocked !== true;
}

function isVirtualCoachingReviewWorkflow(saveTarget: any = {}) {
  return (
    isReviewWorkflowMeasurementsTarget(saveTarget) &&
    normalizeMeasurementScoringToken(saveTarget.reviewWorkflowType) === 'virtualcoaching'
  );
}

function isSavedReviewWorkflowMeasurement(measurement: any = {}) {
  const sourceRole = normalizeMeasurementScoringToken(measurement?.sourceRole);
  const workflow = String(measurement?.workflow || '').trim();

  return (
    (sourceRole === 'learner' && workflow === VIEWER_MEASUREMENTS_WORKFLOW) ||
    (sourceRole === 'educator' && workflow === REVIEWER_MEASUREMENTS_WORKFLOW)
  );
}

function getAutoDisplayPeerMeasurements(measurements: any[] = [], saveTarget: any = {}) {
  const viewerRole = normalizeMeasurementScoringToken(saveTarget.measurementWorkflowRole);

  const expectedSourceRole =
    viewerRole === 'educator' ? 'learner' : viewerRole === 'learner' ? 'educator' : '';

  if (!expectedSourceRole) {
    return [];
  }

  const candidates = (Array.isArray(measurements) ? measurements : []).filter(
    measurement =>
      measurement?.isSavedAnnotation === true &&
      isSavedReviewWorkflowMeasurement(measurement) &&
      normalizeMeasurementScoringToken(measurement?.sourceRole) === expectedSourceRole
  );

  const latestReviewRound = candidates.reduce(
    (latestRound, measurement) => Math.max(latestRound, Number(measurement?.reviewRound || 0)),
    0
  );

  return candidates.filter(
    measurement => Number(measurement?.reviewRound || 0) === latestReviewRound
  );
}

function getAutoDisplayAnnotationsForReferenceImage(
  measurements: any[] = [],
  saveTarget: any = {},
  peerMeasurements: any[] = []
) {
  const viewerRole = normalizeMeasurementScoringToken(saveTarget.measurementWorkflowRole);

  if (viewerRole !== 'learner') {
    return peerMeasurements;
  }

  const peerMeasurementKeys = new Set(
    (Array.isArray(peerMeasurements) ? peerMeasurements : []).map(getMeasurementKey).filter(Boolean)
  );

  const seen = new Set();

  return (Array.isArray(measurements) ? measurements : []).filter(measurement => {
    const measurementKey = getMeasurementKey(measurement);
    const sourceRole = normalizeMeasurementScoringToken(measurement?.sourceRole);

    const shouldInclude =
      measurement?.isSavedAnnotation === true &&
      isSavedReviewWorkflowMeasurement(measurement) &&
      (sourceRole === 'learner' || peerMeasurementKeys.has(measurementKey));

    if (!shouldInclude || !measurementKey || seen.has(measurementKey)) {
      return false;
    }

    seen.add(measurementKey);
    return true;
  });
}

export default function ARMeasurementsPanel({ servicesManager, commandsManager }) {
  const { measurementService, uiNotificationService } = servicesManager.services;
  const saveTarget = useMemo(getArViewerSaveTargetFromUrl, []);

  const isReviewWorkflow = isReviewWorkflowMeasurementsTarget(saveTarget);

  const isReviewWorkflowReadOnly = isReviewWorkflow && !getWritableMeasurementWorkflow(saveTarget);
  const [measurements, setMeasurements] = useState(
    () => measurementService.getMeasurements?.() || []
  );
  const [savingAction, setSavingAction] = useState('');
  const isSaving = !!savingAction;
  const [domain, setDomain] = useState('generic');
  const [savedAnnotations, setSavedAnnotations] = useState([]);
  const autoDisplayPeerMeasurementStateRef = useRef({
    key: '',
    status: 'idle',
  });
  const [isLearnerMeasurementWorkflow, setIsLearnerMeasurementWorkflow] = useState(
    isLearnerViewerMeasurementWorkflowFromUrl
  );
  const isMeasurementScoringDisabled = isViewerMeasurementScoringDisabledFromUrl();
  const applySavedAnnotationsResult = useCallback(result => {
    if (!result) {
      return;
    }

    if (result.domain) {
      setDomain(result.domain);
    }

    const resultSaveTarget = result?.saveTarget || getArViewerSaveTargetFromUrl();
    const isLibraryLearnerWorkflow =
      isLearnerViewerMeasurementWorkflowFromUrl() ||
      isLibraryLearnerCopyOnSaveTarget(resultSaveTarget);

    setIsLearnerMeasurementWorkflow(isLibraryLearnerWorkflow);

    const annotations = result.annotations || result.processedAnnotations || [];

    const nextSavedAnnotations = annotations
      .map(normalizeSavedAnnotation)
      .filter(annotation => annotation?.toolName && hasSemanticLabel(annotation));

    setSavedAnnotations(currentSavedAnnotations => {
      if (
        nextSavedAnnotations.length === 0 &&
        currentSavedAnnotations.length > 0 &&
        isLearnerViewerMeasurementWorkflowFromUrl() &&
        getArLearnerSeriesIdFromUrl()
      ) {
        return currentSavedAnnotations;
      }

      return nextSavedAnnotations;
    });
  }, []);

  useEffect(() => {
    if (isReviewWorkflowReadOnly) {
      return;
    }

    let cancelled = false;
    let activated = false;
    const retryDelays = [0, 150, 500];

    const timers = retryDelays.map((delay, index) =>
      window.setTimeout(async () => {
        if (cancelled || activated) {
          return;
        }

        try {
          const result = await commandsManager.runCommand('activateViewerMeasurementTool', {
            toolName: 'Length',
            stopCine: true,
          });

          if (result?.ok) {
            activated = true;
            return;
          }

          if (index === retryDelays.length - 1) {
            console.warn('[ARMeasurementsPanel] could not activate Length:', result);
          }
        } catch (error) {
          if (!cancelled && index === retryDelays.length - 1) {
            console.warn('[ARMeasurementsPanel] Length activation failed:', error);
          }
        }
      }, delay)
    );

    return () => {
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [commandsManager, isReviewWorkflowReadOnly]);

  useEffect(() => {
    const refresh = () => {
      setMeasurements([...(measurementService.getMeasurements?.() || [])]);
    };

    const events = measurementService.EVENTS || {};
    const subscriptions = [
      events.MEASUREMENT_ADDED,
      events.MEASUREMENT_UPDATED,
      events.MEASUREMENT_REMOVED,
      events.MEASUREMENTS_CLEARED,
      events.RAW_MEASUREMENT_ADDED,
    ]
      .filter(Boolean)
      .map(eventName => measurementService.subscribe(eventName, refresh));

    refresh();

    return () => {
      subscriptions.forEach(subscription => subscription?.unsubscribe?.());
    };
  }, [measurementService]);

  useEffect(() => {
    let cancelled = false;

    const refreshSavedAnnotations = async () => {
      try {
        const result = await commandsManager.runCommand(
          'getViewerMeasurementAnnotationsForActiveStudy'
        );

        if (!cancelled && result) {
          applySavedAnnotationsResult(result);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[ARMeasurementsPanel] could not resolve saved annotations:', error);
        }
      }
    };

    const handleSavedAnnotationsUpdated = event => {
      if (cancelled) {
        return;
      }

      const detail = event?.detail || {};

      if (detail.annotations || detail.processedAnnotations) {
        applySavedAnnotationsResult({
          annotations: detail.annotations || detail.processedAnnotations || [],
          processedAnnotations: detail.processedAnnotations || detail.annotations || [],
          seriesDoc: detail.seriesDoc,
          saveTarget: detail.saveTarget,
          domain: detail.domain,
        });
        return;
      }

      refreshSavedAnnotations();
    };

    const timers = [0, 300, 1000, 2500].map(delay =>
      window.setTimeout(refreshSavedAnnotations, delay)
    );

    window.addEventListener(AR_SAVED_ANNOTATIONS_REFRESH_EVENT, handleSavedAnnotationsUpdated);
    window.addEventListener('popstate', refreshSavedAnnotations);

    return () => {
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
      window.removeEventListener(AR_SAVED_ANNOTATIONS_REFRESH_EVENT, handleSavedAnnotationsUpdated);
      window.removeEventListener('popstate', refreshSavedAnnotations);
    };
  }, [commandsManager, applySavedAnnotationsResult]);

  const visibleMeasurements = useMemo(() => {
    const byKey = new Map();

    for (const annotation of savedAnnotations) {
      if (isReviewWorkflow && !isSavedReviewWorkflowMeasurement(annotation)) {
        continue;
      }

      const key = getMeasurementKey(annotation);

      if (key) {
        byKey.set(key, annotation);
      }
    }

    for (const measurement of measurements) {
      if (!measurement?.toolName || !hasSemanticLabel(measurement)) {
        continue;
      }

      const key = getMeasurementKey(measurement);

      if (key) {
        const savedAnnotation = byKey.get(key);

        // Do not present imported/machine-created measurements as
        // learner or coach measurements merely because they are live
        // in MeasurementService.
        if (
          isReviewWorkflow &&
          !savedAnnotation &&
          !measurement?.workflow &&
          measurement?.arCreatedInViewerSession !== true
        ) {
          continue;
        }

        if (savedAnnotation?.isSavedAnnotation) {
          byKey.set(key, mergeLiveMeasurementIntoSavedAnnotation(savedAnnotation, measurement));
        } else {
          byKey.set(key, normalizeMeasurementForDisplay(measurement));
        }
      }
    }

    const writableWorkflow = getWritableMeasurementWorkflow(saveTarget);

    return Array.from(byKey.values()).map(measurement => {
      if (!isReviewWorkflow || measurement?.workflow || !writableWorkflow) {
        return measurement;
      }

      return {
        ...measurement,
        workflow: writableWorkflow,
        measurementOwner: writableWorkflow === REVIEWER_MEASUREMENTS_WORKFLOW ? 'coach' : 'learner',
        isLocked: false,
      };
    });
  }, [measurements, savedAnnotations, isReviewWorkflow, saveTarget]);

  const editableMeasurements = useMemo(
    () => visibleMeasurements.filter(measurement => isMeasurementEditable(measurement, saveTarget)),
    [visibleMeasurements, saveTarget]
  );

  const measurementGroups = useMemo(() => {
    if (!isReviewWorkflow) {
      return [
        {
          key: 'all',
          title: '',
          measurements: visibleMeasurements,
        },
      ];
    }

    return [
      {
        key: 'learner',
        title:
          String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'learner'
            ? 'My measurements'
            : 'Learner measurements',
        measurements: visibleMeasurements.filter(
          measurement => measurement?.workflow !== REVIEWER_MEASUREMENTS_WORKFLOW
        ),
      },
      {
        key: 'coach',
        title:
          String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'educator'
            ? 'My measurements'
            : 'Coach measurements',
        measurements: visibleMeasurements.filter(
          measurement => measurement?.workflow === REVIEWER_MEASUREMENTS_WORKFLOW
        ),
      },
    ];
  }, [isReviewWorkflow, saveTarget, visibleMeasurements]);

  const lvSimpsonResult = useMemo(() => {
    if (domain !== 'echo') {
      return null;
    }

    return calculateLVSimpson(visibleMeasurements);
  }, [domain, visibleMeasurements]);

  const handleSave = async (scoreNow = false) => {
    if (scoreNow && isMeasurementScoringDisabled) {
      uiNotificationService.show({
        title: 'AR Measurements',
        message: 'Measurement scoring is disabled for this viewer quiz workflow.',
        type: 'warning',
        duration: 5000,
      });
      return;
    }

    setSavingAction(scoreNow ? 'score' : 'draft');

    try {
      await commandsManager.runCommand('saveViewerMeasurementsForActiveStudy', {
        domain: domain === 'generic' ? undefined : domain,
        scoringIntent: scoreNow ? 'score-attempt' : 'draft',
        educationAttemptIntent: scoreNow ? 'score-attempt' : 'draft',
      });

      const result = await commandsManager.runCommand(
        'getViewerMeasurementAnnotationsForActiveStudy',
        {
          domain: domain === 'generic' ? undefined : domain,
        }
      );

      applySavedAnnotationsResult(result);
    } catch (error) {
      console.error('[ARMeasurementsPanel] save failed:', error);
      uiNotificationService.show({
        title: 'AR Measurements',
        message: `Save failed: ${error?.message || error}`,
        type: 'error',
        duration: 5000,
      });
    } finally {
      setSavingAction('');
    }
  };

  const jumpToMeasurement = useCallback(
    async measurement => {
      const uid = measurement?.uid || measurement?.annotationId;

      if (!uid) {
        return {
          ok: false,
          reason: 'missing-measurement-id',
        };
      }

      try {
        if (measurement?.isSavedAnnotation === true) {
          console.info('[ARMeasurementsPanel] displaying saved annotations for image', {
            uid,
            referencedImageId: measurement.referencedImageId,
            displaySetInstanceUID: measurement.displaySetInstanceUID,
          });

          const result = await commandsManager.runCommand(
            'showSavedViewerAnnotationsForSameImage',
            {
              annotations: savedAnnotations,
              referenceAnnotation: measurement,
              selectReferenceAnnotation: true,
            }
          );

          return (
            result || {
              ok: true,
              source: 'saved-annotation-image-group',
              annotationId: uid,
            }
          );
        }

        const liveMeasurement = measurementService.getMeasurement?.(uid);

        if (liveMeasurement) {
          commandsManager.runCommand('toggleVisibilityMeasurement', {
            uid,
            visibility: true,
          });

          commandsManager.runCommand('jumpToMeasurement', {
            uid,
          });

          window.setTimeout(() => {
            commandsManager.runCommand('toggleVisibilityMeasurement', {
              uid,
              visibility: true,
            });

            commandsManager.runCommand('jumpToMeasurement', {
              uid,
            });
          }, 150);

          return {
            ok: true,
            source: 'live-measurement',
            annotationId: uid,
          };
        }

        return {
          ok: false,
          reason: 'measurement-not-hydrated',
          annotationId: uid,
        };
      } catch (error) {
        console.warn('[ARMeasurementsPanel] jump failed:', error);

        return {
          ok: false,
          reason: 'jump-failed',
          error,
        };
      }
    },
    [commandsManager, measurementService, savedAnnotations]
  );

  useEffect(() => {
    if (!isVirtualCoachingReviewWorkflow(saveTarget)) {
      return;
    }

    const targetMeasurements = getAutoDisplayPeerMeasurements(visibleMeasurements, saveTarget);

    const referenceMeasurement = targetMeasurements[0];

    const autoDisplayAnnotations = getAutoDisplayAnnotationsForReferenceImage(
      visibleMeasurements,
      saveTarget,
      targetMeasurements
    );

    const targetKeys = autoDisplayAnnotations.map(getMeasurementKey).filter(Boolean).sort();

    const referenceKey = getMeasurementKey(referenceMeasurement);

    const targetKey = [referenceKey, ...targetKeys].filter(Boolean).join('|');

    if (!referenceMeasurement || !autoDisplayAnnotations.length || !targetKey) {
      return;
    }

    const currentState = autoDisplayPeerMeasurementStateRef.current;

    if (
      currentState.key === targetKey &&
      (currentState.status === 'pending' || currentState.status === 'complete')
    ) {
      return;
    }

    const timer = window.setTimeout(async () => {
      const latestState = autoDisplayPeerMeasurementStateRef.current;

      if (
        latestState.key === targetKey &&
        (latestState.status === 'pending' || latestState.status === 'complete')
      ) {
        return;
      }

      autoDisplayPeerMeasurementStateRef.current = {
        key: targetKey,
        status: 'pending',
      };

      const result = await commandsManager.runCommand('showSavedViewerAnnotationsForSameImage', {
        annotations: autoDisplayAnnotations,
        referenceAnnotation: referenceMeasurement,
      });

      if (result?.ok === false) {
        autoDisplayPeerMeasurementStateRef.current = {
          key: '',
          status: 'idle',
        };

        console.warn('[ARMeasurementsPanel] automatic peer measurement display failed:', {
          targetKey,
          reason: result.reason,
        });

        return;
      }

      autoDisplayPeerMeasurementStateRef.current = {
        key: targetKey,
        status: 'complete',
      };
    }, 350);

    return () => window.clearTimeout(timer);
  }, [commandsManager, saveTarget, visibleMeasurements]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-black text-white">
      <div className="shrink-0 border-b border-gray-700 p-3">
        <div className="text-base font-semibold">AR Measurements</div>
        <div className="mt-1 text-xs text-gray-400">
          {isReviewWorkflow
            ? `Virtual coaching • ${
                String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'educator'
                  ? 'Coach'
                  : 'Learner'
              }${isReviewWorkflowReadOnly ? ' • read-only' : ''}`
            : `Domain: ${domain}`}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {domain === 'echo' ? <LVSimpsonSummary result={lvSimpsonResult} /> : null}

        {visibleMeasurements.length === 0 ? (
          <div className="text-sm text-gray-400">No viewer measurements yet.</div>
        ) : (
          <div className="space-y-2">
            <div className="space-y-4">
              {measurementGroups.map(group => (
                <div key={group.key}>
                  {group.title ? (
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {group.title}
                    </div>
                  ) : null}

                  {group.measurements.length === 0 ? (
                    <div className="text-sm text-gray-500">No measurements in this section.</div>
                  ) : (
                    <div className="space-y-2">
                      {group.measurements.map(measurement => {
                        const label = getMeasurementLabel(measurement);
                        const value = getMeasurementValue(measurement);
                        const subtitle = getMeasurementSubtitle(measurement);

                        return (
                          <button
                            key={
                              measurement.uid ||
                              measurement.id ||
                              `${measurement.toolName}-${label}`
                            }
                            type="button"
                            className="w-full rounded border border-gray-700 p-2 text-left hover:border-blue-400 hover:bg-gray-900"
                            onClick={() => jumpToMeasurement(measurement)}
                            title="Jump to measurement"
                          >
                            <div className="text-sm font-semibold">{label}</div>

                            <div className="text-xs text-gray-400">{subtitle}</div>

                            {value ? <div className="mt-1 text-sm">{value}</div> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-gray-700 bg-black p-3">
        {isReviewWorkflow ? (
          isReviewWorkflowReadOnly ? (
            <div className="text-center text-xs text-gray-400">
              Measurements are read-only for this coaching review.
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isSaving || editableMeasurements.length === 0}
              onClick={() => handleSave(false)}
            >
              {savingAction === 'draft'
                ? 'Saving…'
                : String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'educator'
                  ? 'Save Coach Measurements'
                  : 'Save Learner Measurements'}
            </button>
          )
        ) : isLearnerMeasurementWorkflow ? (
          <div
            className={
              isMeasurementScoringDisabled
                ? 'grid grid-cols-1 gap-2'
                : 'grid grid-cols-1 gap-2 sm:grid-cols-2'
            }
          >
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isSaving || visibleMeasurements.length === 0}
              onClick={() => handleSave(false)}
            >
              {savingAction === 'draft' ? 'Saving…' : 'Save Draft'}
            </button>

            {!isMeasurementScoringDisabled ? (
              <button
                type="button"
                className="rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isSaving || visibleMeasurements.length === 0}
                onClick={() => handleSave(true)}
              >
                {savingAction === 'score' ? 'Saving…' : 'Save & Score'}
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isSaving || visibleMeasurements.length === 0}
            onClick={() => handleSave(false)}
          >
            {savingAction === 'draft' ? 'Saving…' : 'Save Measurements'}
          </button>
        )}
      </div>
    </div>
  );
}
