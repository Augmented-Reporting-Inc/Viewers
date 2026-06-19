/**
 * Commands registered by extension-iuscan.
 *
 * exportIUScanReport   — builds PUT body from assignment state, saves to formapi
 * clearIUScanMeasurements — clears assignment state and MeasurementService
 *
 * Both commands are also wired to keyboard hotkeys in mode-iuscan/src/index.js.
 */

import { upsertViewerMeasurementAnnotations } from './utils/measurementAnnotations';
import { buildFormApiUrl } from './utils/formApi';
import { SITES, MEASUREMENT_GROUPS } from './utils/labelMap';

function parseIUScanLabel(label = '') {
  const parts = String(label || '').split('-');
  const siteCode = parts[0] || '';
  const axisToken = parts[parts.length - 1] || '';

  return {
    groupKey: siteCode && axisToken ? `${siteCode}:${axisToken}` : String(label || ''),
    axis:
      axisToken === 'Long' || axisToken === 'Longitudinal'
        ? 'longitudinal'
        : axisToken === 'Cross' || axisToken === 'Cross-section'
          ? 'cross'
          : '',
  };
}

function getCanonicalRepeatedMetadata(siteConfig, group) {
  const label = `${siteConfig.code}-${group.labelSuffix || group.suffix}`;

  return {
    label,
    repeatedMeasurement: {
      groupKey: `${siteConfig.code}:${group.stateKey}`,
      axis: group.axis || group.measurementAxis || group.stateKey,
      maxSlots: 3,
      aggregation: 'average',
    },
  };
}

function getFrameNumberFromReferencedImageId(referencedImageId = '') {
  const match = String(referencedImageId).match(/\/frames\/(\d+)/);
  const frame = Number(match?.[1]);

  return Number.isFinite(frame) && frame > 0 ? frame : 1;
}

function getMeasurementDisplayText(measurement) {
  if (Array.isArray(measurement?.displayText)) {
    return measurement.displayText;
  }

  if (Array.isArray(measurement?.displayText?.primary)) {
    return measurement.displayText.primary;
  }

  return [];
}

function getFirstMeasurementData(measurement) {
  const data = measurement?.data;

  if (!data || typeof data !== 'object') {
    return null;
  }

  const firstKey = Object.keys(data)[0];

  return firstKey ? data[firstKey] : null;
}

function parseLengthDisplayText(displayText) {
  const text = Array.isArray(displayText) ? displayText.join(' ') : String(displayText || '');
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Zµμ²^0-9/]+)?/);

  if (!match) {
    return {
      value: null,
      unit: '',
    };
  }

  return {
    value: Number(match[1]),
    unit: match[2] || '',
  };
}

function getLengthMeasurementPayload(measurement) {
  const firstMeasurementData = getFirstMeasurementData(measurement);
  const displayText = getMeasurementDisplayText(measurement);
  const parsed = parseLengthDisplayText(displayText);

  const value = Number(
    measurement?.length ?? measurement?.value ?? firstMeasurementData?.length ?? parsed.value
  );

  const unit =
    measurement?.lengthUnit || measurement?.unit || firstMeasurementData?.unit || parsed.unit || '';

  const normalizedValue = Number.isFinite(value) ? value : null;
  const normalizedDisplayText =
    displayText.length || normalizedValue == null
      ? displayText
      : [`${normalizedValue} ${unit}`.trim()];

  return {
    displayText: normalizedDisplayText,
    value: normalizedValue,
    unit,
    length: normalizedValue,
    lengthUnit: unit,
  };
}

function normalizeCanonicalSlotAnnotation(slot, studyInstanceId = '', rowContext = null) {
  const measurementId = slot?.uid || slot?.annotationId;

  if (!measurementId || !slot?.referencedImageId || !Array.isArray(slot?.points)) {
    return null;
  }

  const label = rowContext?.label || slot.label || slot.measurementRole || slot.role || '';
  const parsedLabel = parseIUScanLabel(label);
  const measurements = slot.measurements || {};
  const value = Number(measurements.length ?? measurements.value ?? slot.value ?? slot.length);

  if (!Number.isFinite(value)) {
    return null;
  }

  const unit = measurements.lengthUnit || measurements.unit || slot.unit || slot.lengthUnit || '';

  return {
    annotationId: slot.annotationId || measurementId,
    uid: measurementId,
    workflow: 'viewerMeasurements',

    domain: 'iuscan',
    mode: 'repeated',
    role: label,
    label,
    measurementRole: label,
    toolName: slot.toolName || 'Length',

    repeatedMeasurement: rowContext?.repeatedMeasurement ||
      slot.repeatedMeasurement || {
        groupKey: parsedLabel.groupKey,
        axis: parsedLabel.axis,
        maxSlots: 3,
        aggregation: 'average',
      },

    StudyInstanceUID: slot.StudyInstanceUID || studyInstanceId,
    SeriesInstanceUID: slot.SeriesInstanceUID || slot.referenceSeriesUID || '',
    referenceSeriesUID: slot.referenceSeriesUID || slot.SeriesInstanceUID || '',
    SOPInstanceUID: slot.SOPInstanceUID || '',
    FrameOfReferenceUID: slot.FrameOfReferenceUID || '',
    displaySetInstanceUID: slot.displaySetInstanceUID || '',
    referencedImageId: slot.referencedImageId || '',
    frameNumber:
      slot.frameNumber && slot.frameNumber > 1
        ? slot.frameNumber
        : getFrameNumberFromReferencedImageId(slot.referencedImageId),
    points: slot.points || [],

    measurements: {
      displayText: measurements.displayText || slot.displayText || [],
      value,
      unit,
      length: value,
      lengthUnit: unit,
    },
    displayText: slot.displayText || measurements.displayText || [],
  };
}

function buildIUScanAnnotationSnapshot(assignSvc, measurementService, studyInstanceId = '') {
  try {
    const state = assignSvc.getFullState?.() || {};
    const annotations = [];
    const seen = new Set();

    const addAnnotation = annotation => {
      const measurementId = annotation?.uid || annotation?.annotationId;
      const annotationKey = [
        annotation?.label || '',
        annotation?.repeatedMeasurement?.groupKey || '',
        annotation?.repeatedMeasurement?.axis || '',
        measurementId || '',
      ].join('|');

      if (!measurementId || seen.has(annotationKey)) {
        return;
      }

      if (
        annotation.referencedImageId &&
        Array.isArray(annotation.points) &&
        annotation.points.length === 2 &&
        annotation.measurements?.length != null
      ) {
        seen.add(annotationKey);
        annotations.push(annotation);
      }
    };

    for (const siteConfig of SITES) {
      const siteState = state[siteConfig.key];
      if (!siteState) {
        continue;
      }

      for (const group of MEASUREMENT_GROUPS) {
        const slots = siteState?.[group.stateKey]?.slots || [];
        const rowContext = getCanonicalRepeatedMetadata(siteConfig, group);
        for (const slot of slots) {
          if (!slot) {
            continue;
          }

          if (typeof slot === 'object') {
            addAnnotation(normalizeCanonicalSlotAnnotation(slot, studyInstanceId, rowContext));
            continue;
          }

          const measurement = measurementService.getMeasurement?.(slot);

          if (measurement?.toolName && measurement.toolName !== 'Length') {
            continue;
          }

          const measurementPayload = getLengthMeasurementPayload(measurement);
          if (measurementPayload.value == null) {
            continue;
          }

          const frameNumber =
            measurement.frameNumber && measurement.frameNumber > 1
              ? measurement.frameNumber
              : getFrameNumberFromReferencedImageId(measurement.referencedImageId);

          addAnnotation({
            annotationId: measurement.uid,
            uid: measurement.uid,
            workflow: 'viewerMeasurements',

            domain: 'iuscan',
            mode: 'repeated',
            role: rowContext.label,
            label: rowContext.label,
            measurementRole: rowContext.label,
            toolName: 'Length',

            repeatedMeasurement: rowContext.repeatedMeasurement,

            StudyInstanceUID:
              measurement.referenceStudyUID || measurement.StudyInstanceUID || studyInstanceId,
            SeriesInstanceUID:
              measurement.referenceSeriesUID || measurement.SeriesInstanceUID || '',
            referenceSeriesUID:
              measurement.referenceSeriesUID || measurement.SeriesInstanceUID || '',
            SOPInstanceUID: measurement.SOPInstanceUID || '',
            FrameOfReferenceUID: measurement.FrameOfReferenceUID || '',
            displaySetInstanceUID: measurement.displaySetInstanceUID || '',
            referencedImageId: measurement.referencedImageId || '',
            frameNumber,
            points: measurement.points || [],

            measurements: measurementPayload,
            displayText: measurementPayload.displayText,
          });
        }
      }
    }

    return annotations;
  } catch (error) {
    console.warn('[iUSCAN] Could not serialize annotations:', error?.message || error);
    return [];
  }
}

export default function getCommandsModule({ servicesManager, commandsManager }) {
  const { measurementService, uiNotificationService, viewportGridService, displaySetService } =
    servicesManager.services;

  return {
    defaultContext: 'ACTIVE_VIEWPORT::CORNERSTONE',

    definitions: {
      exportIUScanReport: {
        commandFn: async () => {
          const assignSvc = servicesManager.services.iuscanAssignmentService;

          if (!assignSvc.hasAnyAssignment()) {
            uiNotificationService.show({
              title: 'Augmented Reporting',
              message: 'No measurements to export.',
              type: 'warning',
              duration: 3000,
            });
            return;
          }

          // Resolve StudyInstanceUID from the active viewport's display set
          let studyInstanceId = null;
          try {
            const { activeViewportId, viewports } = viewportGridService.getState();
            const activeViewport = viewports.get?.(activeViewportId) ?? viewports[activeViewportId];
            const displaySetInstanceId = activeViewport?.displaySetInstanceUIDs?.[0];
            if (displaySetInstanceId) {
              const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceId);
              studyInstanceId = displaySet?.StudyInstanceUID;
            }
          } catch (e) {
            console.warn('[iUSCAN] Could not resolve StudyInstanceUID:', e.message);
          }

          if (!studyInstanceId) {
            uiNotificationService.show({
              title: 'iUSCAN',
              message: 'Cannot determine active study. Please ensure a series is displayed.',
              type: 'error',
              duration: 4000,
            });
            return;
          }

          const payload = assignSvc.buildReportPayload(measurementService);

          try {
            // Step 1: look up Mongo _id by StudyInstanceUID
            const seriesRes = await fetch(
              buildFormApiUrl(`series/study/${encodeURIComponent(studyInstanceId)}`),
              { credentials: 'include' }
            );
            if (!seriesRes.ok) {
              throw new Error(`Series lookup failed: ${seriesRes.status}`);
            }
            const seriesDoc = await seriesRes.json();

            // Serialize live iUSCAN Length annotations for viewport restoration.
            const iuscanAnnotations = buildIUScanAnnotationSnapshot(
              assignSvc,
              measurementService,
              studyInstanceId
            );
            if (iuscanAnnotations.length > 0) {
              payload.MeasurementAnnotations = upsertViewerMeasurementAnnotations({
                existingRaw: seriesDoc.MeasurementAnnotations,
                source: 'extension-iuscan',
                annotations: iuscanAnnotations,
                replaceFilter: annotation =>
                  annotation?.workflow === 'viewerMeasurements' &&
                  annotation?.domain === 'iuscan' &&
                  (annotation?.mode === 'repeated' || !!annotation?.repeatedMeasurement),
              });
            }

            // Step 2: PUT measurements to the series document
            const putRes = await fetch(buildFormApiUrl(`series/${seriesDoc._id}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(payload),
            });
            if (!putRes.ok) {
              throw new Error(`Save failed: ${putRes.status}`);
            }

            const updatedSeries = await putRes.json().catch(() => null);

            assignSvc.notifyArMeasurementsUpdated?.({
              seriesDoc,
              payload,
              updatedSeries,
            });

            uiNotificationService.show({
              title: 'Augmented Reporting',
              message: 'Measurements saved to report.',
              type: 'success',
              duration: 3000,
            });
          } catch (err) {
            console.error('[iUSCAN] exportIUScanReport error:', err);
            uiNotificationService.show({
              title: 'Augmented Reporting',
              message: `Export failed: ${err.message || err}`,
              type: 'error',
              duration: 5000,
            });
          }
        },
      },

      clearIUScanMeasurements: {
        commandFn: () => {
          const assignSvc = servicesManager.services.iuscanAssignmentService;
          assignSvc.clearAll();
          measurementService.clearMeasurements();
          uiNotificationService.show({
            title: 'Augmented Reporting',
            message: 'All measurements cleared.',
            type: 'info',
            duration: 2000,
          });
        },
      },
    },
  };
}
