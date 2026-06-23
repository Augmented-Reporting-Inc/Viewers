import React, { useEffect, useMemo, useState } from 'react';

function getMeasurementLabel(measurement) {
  return (
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.description ||
    measurement?.toolName ||
    'Unlabelled measurement'
  );
}

function getMeasurementValue(measurement) {
  const unitType = getMeasurementUnitType(measurement);

  if (measurement?.displayText?.primary?.length) {
    return normalizeDisplayTextUnits(measurement.displayText.primary, unitType).join(' ');
  }

  if (Array.isArray(measurement?.displayText) && measurement.displayText.length) {
    return normalizeDisplayTextUnits(measurement.displayText, unitType).join(' ');
  }

  if (measurement?.measurements?.displayText?.length) {
    return normalizeDisplayTextUnits(measurement.measurements.displayText, unitType).join(' ');
  }

  if (measurement?.measurements?.length != null) {
    const unit = normalizeDisplayLengthUnit(
      measurement.measurements.lengthUnit || measurement.measurements.unit || ''
    );
    return `${measurement.measurements.length} ${unit}`.trim();
  }

  if (measurement?.measurements?.area != null) {
    const unit = normalizeDisplayAreaUnit(measurement.measurements.areaUnit || '');
    return `${measurement.measurements.area} ${unit}`.trim();
  }

  if (measurement?.value != null && measurement?.unit) {
    return `${measurement.value} ${normalizeDisplayLengthUnit(measurement.unit)}`;
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

  return (Array.isArray(displayText) ? displayText : [String(displayText || '')])
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

export default function ARMeasurementsPanel({ servicesManager, commandsManager }) {
  const { measurementService, uiNotificationService } = servicesManager.services;

  const [measurements, setMeasurements] = useState(
    () => measurementService.getMeasurements?.() || []
  );
  const [isSaving, setIsSaving] = useState(false);
  const [domain, setDomain] = useState('generic');
  const [savedAnnotations, setSavedAnnotations] = useState([]);

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

    commandsManager
      .runCommand('getViewerMeasurementAnnotationsForActiveStudy')
      ?.then?.(result => {
        if (!cancelled && result) {
          if (result.domain) {
            setDomain(result.domain);
          }

          setSavedAnnotations(
            (result.annotations || [])
              .map(normalizeSavedAnnotation)
              .filter(annotation => annotation?.toolName && hasSemanticLabel(annotation))
          );
        }
      })
      ?.catch?.(error => {
        console.warn('[ARMeasurementsPanel] could not resolve saved annotations:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [commandsManager]);

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

  const handleSave = async () => {
    setIsSaving(true);

    try {
      await commandsManager.runCommand('saveViewerMeasurementsForActiveStudy', {
        domain: domain === 'generic' ? undefined : domain,
      });

      const result = await commandsManager.runCommand(
        'getViewerMeasurementAnnotationsForActiveStudy',
        {
          domain: domain === 'generic' ? undefined : domain,
        }
      );

      setSavedAnnotations(
        (result?.annotations || [])
          .map(normalizeSavedAnnotation)
          .filter(annotation => annotation?.toolName && hasSemanticLabel(annotation))
      );
    } catch (error) {
      console.error('[ARMeasurementsPanel] save failed:', error);
      uiNotificationService.show({
        title: 'AR Measurements',
        message: `Save failed: ${error?.message || error}`,
        type: 'error',
        duration: 5000,
      });
    } finally {
      setIsSaving(false);
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
        <button
          type="button"
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={isSaving || visibleMeasurements.length === 0}
          onClick={handleSave}
        >
          {isSaving ? 'Saving…' : 'Save Measurements'}
        </button>
      </div>
    </div>
  );
}
