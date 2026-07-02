import React, { useCallback, useEffect, useMemo, useState } from 'react';

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

function normalizeDisplayTextUnits(displayText = [], unitType = 'length') {
  const nextUnit = unitType === 'area' ? 'mm²' : 'mm';

  return flattenDisplayText(displayText, unitType)
    .filter(Boolean)
    .map(text =>
      String(text)
        .replace(/\bpx²\b/gi, nextUnit)
        .replace(/\bpx\^2\b/gi, nextUnit)
        .replace(/\bpx2\b/gi, nextUnit)
        .replace(/\bpx\b/gi, nextUnit)
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

  if (measurement?.isSavedAnnotation) {
    parts.push('saved');
  }

  const shortId = getShortId(measurement);
  if (shortId) {
    parts.push(shortId);
  }

  return parts.filter(Boolean).join(' • ');
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
      learnerSeriesId: String(qs.get('arLearnerSeriesId') || '').trim(),
      launchSource: String(qs.get('arLaunchSource') || '').trim(),
      measurementWorkflowRole: String(qs.get('arMeasurementWorkflowRole') || '').trim(),
    };
  } catch {
    return {
      mode: '',
      baseSeriesId: '',
      learnerSeriesId: '',
      launchSource: '',
      measurementWorkflowRole: '',
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

function getArLearnerSeriesIdFromUrl() {
  return getArViewerSaveTargetFromUrl().learnerSeriesId;
}

export default function ARMeasurementsPanel({ servicesManager, commandsManager }) {
  const { measurementService, uiNotificationService } = servicesManager.services;

  const [measurements, setMeasurements] = useState(
    () => measurementService.getMeasurements?.() || []
  );
  const [savingAction, setSavingAction] = useState('');
  const isSaving = !!savingAction;
  const [domain, setDomain] = useState('generic');
  const [savedAnnotations, setSavedAnnotations] = useState([]);
  const [isLearnerMeasurementWorkflow, setIsLearnerMeasurementWorkflow] = useState(
    isLearnerViewerMeasurementWorkflowFromUrl
  );

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

        if (savedAnnotation?.isSavedAnnotation) {
          byKey.set(key, mergeLiveMeasurementIntoSavedAnnotation(savedAnnotation, measurement));
        } else {
          byKey.set(key, normalizeMeasurementForDisplay(measurement));
        }
      }
    }

    return Array.from(byKey.values());
  }, [measurements, savedAnnotations]);

  const handleSave = async (scoreNow = false) => {
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

  const jumpToMeasurement = measurement => {
    const uid = measurement?.uid || measurement?.annotationId;

    if (!uid) {
      return;
    }

    try {
      const liveMeasurement = measurementService.getMeasurement?.(uid);

      if (liveMeasurement) {
        commandsManager.runCommand('toggleVisibilityMeasurement', {
          uid,
          visibility: true,
        });

        commandsManager.runCommand('jumpToMeasurement', { uid });

        setTimeout(() => {
          commandsManager.runCommand('toggleVisibilityMeasurement', {
            uid,
            visibility: true,
          });
          commandsManager.runCommand('jumpToMeasurement', { uid });
        }, 150);

        return;
      }

      console.info('[ARMeasurementsPanel] jumping to saved annotation fallback', {
        uid,
        referencedImageId: measurement.referencedImageId,
        displaySetInstanceUID: measurement.displaySetInstanceUID,
      });

      commandsManager.runCommand('jumpToSavedViewerAnnotation', {
        annotation: measurement,
      });
    } catch (error) {
      console.warn('[ARMeasurementsPanel] jump failed:', error);
    }
  };

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <div className="border-b border-gray-700 p-3">
        <div className="text-base font-semibold">AR Measurements</div>
        <div className="mt-1 text-xs text-gray-400">Domain: {domain}</div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {visibleMeasurements.length === 0 ? (
          <div className="text-sm text-gray-400">No viewer measurements yet.</div>
        ) : (
          <div className="space-y-2">
            {visibleMeasurements.map(measurement => {
              const label = getMeasurementLabel(measurement);
              const value = getMeasurementValue(measurement);
              const subtitle = getMeasurementSubtitle(measurement);

              return (
                <button
                  key={measurement.uid || measurement.id || `${measurement.toolName}-${label}`}
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

      <div className="border-t border-gray-700 p-3">
        {isLearnerMeasurementWorkflow ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isSaving || visibleMeasurements.length === 0}
              onClick={() => handleSave(false)}
            >
              {savingAction === 'draft' ? 'Saving…' : 'Save Draft'}
            </button>

            <button
              type="button"
              className="rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isSaving || visibleMeasurements.length === 0}
              onClick={() => handleSave(true)}
            >
              {savingAction === 'score' ? 'Saving…' : 'Save & Score'}
            </button>
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
