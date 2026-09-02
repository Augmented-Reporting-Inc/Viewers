import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calculateLVSimpson, LV_SIMPSON_SLOT_ORDER } from '../utils/lvSimpson';
import {
  calculateLAVolume,
  LA_VOLUME_SLOT_ORDER,
  buildCseLAVolumeReportFieldUpdatesFromResult,
} from '../utils/laVolume';
import { getViewerMeasurementDomainFromPath } from '../utils/measurementLabelConfig';
import { BOWEL_CURVED_LENGTH_MEASUREMENT_KIND } from '../utils/bowelMeasurementTargets';

const ULTRASOUND_DIRECTIONAL_TOOL_NAME = 'UltrasoundDirectionalTool';
const CLINICAL_REPORT_MEASUREMENTS_SAVE_TARGET = 'clinicalReportMeasurements';

function isUltrasoundDirectionalMeasurement(measurement) {
  return String(measurement?.toolName || '') === ULTRASOUND_DIRECTIONAL_TOOL_NAME;
}

function getUltrasoundDirectionalGeometry(measurement) {
  return measurement?.ultrasoundDirectional || measurement?.measurements?.ultrasoundDirectional || null;
}

function getMeasurementLabel(measurement) {
  return (
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.description ||
    getArrowAnnotateText(measurement) ||
    (isUltrasoundDirectionalMeasurement(measurement) ? 'Ultrasound Directional' : '') ||
    measurement?.toolName ||
    'Unlabelled measurement'
  );
}

const AR_SAVED_ANNOTATIONS_REFRESH_EVENT = 'ar-measurements:saved-annotations-updated';
const AR_LIVE_MEASUREMENTS_REFRESH_EVENT = 'ar-measurements:live-measurements-updated';
const AR_LV_SIMPSON_SESSION_EVENT = 'ar-measurements:lv-simpson-session-updated';
const AR_LA_VOLUME_SESSION_EVENT = 'ar-measurements:la-volume-session-updated';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out. Check FormAPI connectivity and try again.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  });
}

function isArrowAnnotateMeasurement(measurement) {
  return String(measurement?.toolName || '') === 'ArrowAnnotate';
}

function getArrowAnnotateText(measurement) {
  if (!isArrowAnnotateMeasurement(measurement)) {
    return '';
  }

  const directText = [measurement?.text, measurement?.measurements?.text]
    .map(value => String(value || '').trim())
    .find(Boolean);

  if (directText) {
    return directText;
  }

  const primaryDisplayText = Array.isArray(measurement?.displayText?.primary)
    ? measurement.displayText.primary
    : Array.isArray(measurement?.displayText)
      ? measurement.displayText
      : Array.isArray(measurement?.measurements?.displayText)
        ? measurement.measurements.displayText
        : [];

  return primaryDisplayText.map(value => String(value || '').trim()).find(Boolean) || '';
}

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
  if (isUltrasoundDirectionalMeasurement(measurement)) {
    const directional = getUltrasoundDirectionalGeometry(measurement) || {};
    const value = finiteNumberOrNull(directional.value ?? measurement?.measurements?.value ?? measurement?.value);
    const unit = String(
      directional.unit || measurement?.measurements?.unit || measurement?.unit || ''
    ).trim();

    if (value != null) {
      return formatMeasurementValue(value, unit || 'mm');
    }
  }

  if (isArrowAnnotateMeasurement(measurement)) {
    return '';
  }
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
    const normalized = normalizeLengthValueAndUnit(
      measurement.measurements.length,
      measurement.measurements.lengthUnit || measurement.measurements.unit || ''
    );
    return formatMeasurementValue(normalized.value, normalized.unit);
  }

  if (measurement?.measurements?.area != null) {
    const unit = normalizeDisplayAreaUnit(measurement.measurements.areaUnit || '');
    return formatMeasurementValue(measurement.measurements.area, unit);
  }

  const stats = getFirstMeasurementStats(measurement);

  if (stats?.length != null) {
    const normalized = normalizeLengthValueAndUnit(
      stats.length,
      stats.lengthUnit || stats.unit || ''
    );
    return formatMeasurementValue(normalized.value, normalized.unit);
  }

  if (stats?.area != null) {
    return formatMeasurementValue(
      stats.area,
      normalizeDisplayAreaUnit(stats.areaUnit || stats.areaUnits || stats.unit || '')
    );
  }

  if (finiteNumberOrNull(measurement?.value) != null) {
    const normalized = normalizeLengthValueAndUnit(measurement.value, measurement.unit || '');
    return formatMeasurementValue(normalized.value, normalized.unit);
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

function isBowelCurvedLengthMeasurement(measurement) {
  const measurementKind = String(
    measurement?.measurementKind || measurement?.measurements?.measurementKind || ''
  ).trim();

  return measurementKind === BOWEL_CURVED_LENGTH_MEASUREMENT_KIND;
}

function isAreaMeasurement(measurement) {
  if (isBowelCurvedLengthMeasurement(measurement)) {
    return false;
  }

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
  const normalizedUnit = stripMeasurementSourceSuffix(unit);

  if (/^cm$/i.test(normalizedUnit) || /px/i.test(normalizedUnit)) {
    return 'mm';
  }

  return normalizedUnit || 'mm';
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

function normalizeLengthValueAndUnit(value, unit = '') {
  const numberValue = finiteNumberOrNull(value);
  const sourceUnit = stripMeasurementSourceSuffix(unit);

  if (numberValue == null) {
    return {
      value: null,
      unit: normalizeDisplayLengthUnit(sourceUnit),
    };
  }

  if (/^cm$/i.test(sourceUnit)) {
    return {
      value: numberValue * 10,
      unit: 'mm',
    };
  }

  return {
    value: numberValue,
    unit: normalizeDisplayLengthUnit(sourceUnit),
  };
}

function normalizeLengthDisplayTextLine(text = '') {
  return stripMeasurementSourceSuffix(text)
    .replace(/(-?\d+(?:\.\d+)?)\s*cm\b/gi, (_match, value) => {
      const millimeters = Number(value) * 10;

      return Number.isFinite(millimeters)
        ? `${formatMeasurementNumber(millimeters)} mm`
        : _match;
    })
    .replace(/\bpx\b/gi, 'mm');
}

function normalizeDisplayTextUnits(displayText = [], unitType = 'length') {
  const nextUnit = unitType === 'area' ? 'mm²' : 'mm';

  return flattenDisplayText(displayText, unitType)
    .filter(Boolean)
    .map(text => {
      if (unitType === 'length') {
        return normalizeLengthDisplayTextLine(text);
      }

      return stripMeasurementSourceSuffix(
        String(text)
          .replace(/\bpx²\b/gi, nextUnit)
          .replace(/\bpx\^2\b/gi, nextUnit)
          .replace(/\bpx2\b/gi, nextUnit)
          .replace(/\bpx\b/gi, nextUnit)
      );
    });
}

function normalizeMeasurementForDisplay(measurement) {
  const measurements = measurement?.measurements || {};

  if (isUltrasoundDirectionalMeasurement(measurement)) {
    const directional = getUltrasoundDirectionalGeometry(measurement) || {};
    const value = finiteNumberOrNull(directional.value ?? measurements.value ?? measurement?.value);
    const unit = String(directional.unit || measurements.unit || measurement?.unit || '').trim();
    const displayText =
      value != null
        ? [formatMeasurementValue(value, unit || 'mm')]
        : flattenDisplayText(measurement?.displayText || measurements.displayText || [], 'length');

    return {
      ...measurement,
      label: measurement?.label || 'Ultrasound Directional',
      displayText,
      measurements: {
        ...measurements,
        displayText,
        ...(value != null
          ? {
              value,
              length: value,
              unit: unit || 'mm',
              lengthUnit: unit || 'mm',
            }
          : {}),
      },
      ...(value != null ? { value, unit: unit || 'mm' } : {}),
    };
  }

  if (isArrowAnnotateMeasurement(measurement)) {
    const text = getArrowAnnotateText(measurement);
    const displayText = text ? [text] : [];

    return {
      ...measurement,
      text,
      displayText,
      measurements: {
        ...measurements,
        text,
        displayText,
      },
    };
  }

  const unitType = getMeasurementUnitType(measurement);
  const normalizedNestedLength =
    measurements.length != null
      ? normalizeLengthValueAndUnit(
          measurements.length,
          measurements.lengthUnit || measurements.unit || ''
        )
      : null;
  const normalizedTopLevelLength =
    unitType === 'length' && finiteNumberOrNull(measurement?.value) != null
      ? normalizeLengthValueAndUnit(measurement.value, measurement.unit || '')
      : null;

  return {
    ...measurement,
    displayText: normalizeDisplayTextUnits(measurement?.displayText || [], unitType),
    measurements: {
      ...measurements,
      displayText: normalizeDisplayTextUnits(measurements.displayText || [], unitType),
      ...(normalizedNestedLength
        ? {
            length: normalizedNestedLength.value,
            unit: normalizedNestedLength.unit,
            lengthUnit: normalizedNestedLength.unit,
          }
        : {}),
      ...(measurements.area != null
        ? {
            areaUnit: normalizeDisplayAreaUnit(measurements.areaUnit),
          }
        : {}),
    },
    ...(normalizedTopLevelLength
      ? {
          value: normalizedTopLevelLength.value,
          unit: normalizedTopLevelLength.unit,
        }
      : measurement?.unit
        ? { unit: normalizeDisplayLengthUnit(measurement.unit) }
        : {}),
    ...(measurement?.areaUnit ? { areaUnit: normalizeDisplayAreaUnit(measurement.areaUnit) } : {}),
  };
}

function mergeLiveMeasurementIntoSavedAnnotation(savedAnnotation, liveMeasurement) {
  // Keep saved AR/Mongo metadata and calibrated display values as the user-facing
  // source of truth, but never let the saved contour replace an actively edited
  // live contour. LA/LV calculations need the current MeasurementService points.
  const normalizedSaved = normalizeMeasurementForDisplay(savedAnnotation);
  const normalizedLive = normalizeMeasurementForDisplay(liveMeasurement);
  const livePoints = Array.isArray(liveMeasurement?.points) ? liveMeasurement.points : [];

  return {
    ...normalizedLive,
    ...normalizedSaved,
    ...(livePoints.length >= 3 ? { points: livePoints } : {}),
    uid: normalizedSaved.uid || normalizedSaved.annotationId || liveMeasurement.uid,
    isSavedAnnotation: true,
  };
}

function hasSemanticLabel(measurement) {
  return !!(
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.role ||
    measurement?.slot ||
    getArrowAnnotateText(measurement)
  );
}

function isDisplayableViewerMeasurement(measurement) {
  return !!(
    measurement?.toolName === 'Length' ||
    isUltrasoundDirectionalMeasurement(measurement) ||
    hasSemanticLabel(measurement)
  );
}

function getMeasurementKey(measurement) {
  return measurement?.uid || measurement?.annotationId || measurement?.id;
}

function getEchoMeasurementAnatomyGroup(measurement) {
  if (measurement?.laVolume || measurement?.measurements?.laVolume) {
    return 'la';
  }

  if (measurement?.lvSimpson || measurement?.measurements?.lvSimpson) {
    return 'lv';
  }

  const reportMapping =
    measurement?.reportMapping && typeof measurement.reportMapping === 'object'
      ? measurement.reportMapping
      : {};

  const semanticValues = [
    getMeasurementLabel(measurement),
    measurement?.measurementRole,
    measurement?.role,
    measurement?.slot,
    measurement?.measurementKind,
    ...Object.values(reportMapping),
  ]
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .map(value =>
      String(value || '')
        .trim()
        .replace(/[_:-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .toUpperCase()
    )
    .filter(Boolean);

  if (
    semanticValues.some(
      value =>
        /^(?:LA|LAV|LAVI|LAVOL|LAVOLUME)\b/.test(value) ||
        /^LEFT ATRI(?:UM|AL)?\b/.test(value)
    )
  ) {
    return 'la';
  }

  if (
    semanticValues.some(
      value => /^(?:LV)\b/.test(value) || /^LEFT VENTRIC(?:LE|ULAR)?\b/.test(value)
    )
  ) {
    return 'lv';
  }

  return 'other';
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

function formatSimpsonPercent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(0)}%` : '';
}

function getLVSimpsonStatusClass(status = '') {
  if (status === 'complete') {
    return 'bg-green-900 text-green-100';
  }

  if (status === 'invalid') {
    return 'bg-red-900 text-red-100';
  }

  return 'bg-yellow-900 text-yellow-100';
}

function getLVSimpsonSlotStatusText(slotResult) {
  if (!slotResult) {
    return 'missing';
  }

  const axisText = Number.isFinite(Number(slotResult.longAxisLengthMM))
    ? `axis ${formatSimpsonValue(slotResult.longAxisLengthMM)} mm`
    : '';

  const coverageText = Number.isFinite(Number(slotResult.coverageRatio))
    ? `coverage ${formatSimpsonPercent(slotResult.coverageRatio)}`
    : '';

  if (slotResult.complete) {
    return ['complete', axisText, coverageText].filter(Boolean).join(' • ');
  }

  return ['incomplete', axisText, coverageText].filter(Boolean).join(' • ') || 'missing';
}

function LAVolumeSummary({ result }) {
  if (!result) {
    return null;
  }

  const values = result.values;
  const nextIncompleteSlot = LA_VOLUME_SLOT_ORDER.find(slot => !result.slots?.[slot]?.complete);

  return (
    <div className="bg-gray-950 mb-3 rounded border border-gray-700 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">LA Volume (Biplane)</div>
          <div className="mt-1 text-xs text-gray-400">{result.method}</div>
        </div>
        <div
          className={`rounded px-2 py-1 text-xs font-semibold ${getLVSimpsonStatusClass(result.status)}`}
        >
          {result.status}
        </div>
      </div>

      {values ? (
        <div className="mt-3 rounded bg-black p-2">
          <div className="text-xs text-gray-400">Biplane LA volume</div>
          <div className="text-lg font-semibold">{formatSimpsonValue(values.volumeML)} mL</div>
        </div>
      ) : null}

      {nextIncompleteSlot ? (
        <div className="bg-blue-950 mt-3 rounded border border-blue-900 p-2 text-xs text-blue-100">
          Next: navigate to {nextIncompleteSlot} at maximum LA volume (end-systole). LA Volume
          remains active; draw the mitral annular closure line when ready. After both views are
          created, adjust the splines to the LA blood-tissue border and exclude pulmonary veins and
          the LA appendage.
        </div>
      ) : null}

      <div className="mt-3 space-y-1">
        {LA_VOLUME_SLOT_ORDER.map(slot => {
          const slotResult = result.slots?.[slot];

          return (
            <div key={slot} className="flex justify-between gap-2 text-xs">
              <span className="text-gray-300">{slot}</span>
              <span className={slotResult?.complete ? 'text-green-300' : 'text-yellow-300'}>
                {getLVSimpsonSlotStatusText(slotResult)}
              </span>
            </div>
          );
        })}
      </div>

      {result.guidance?.length ? (
        <div
          className={`mt-3 rounded border p-2 text-xs ${
            result.status === 'invalid'
              ? 'bg-red-950 border-red-900 text-red-100'
              : 'bg-yellow-950 border-yellow-900 text-yellow-100'
          }`}
        >
          <div className="mb-1 font-semibold">LA volume guidance</div>
          <div className="space-y-1">
            {result.guidance.slice(0, 6).map((message, index) => (
              <div key={`${index}-${message}`}>• {message}</div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LVSimpsonSummary({ result }) {
  if (!result) {
    return null;
  }

  const values = result.values;
  const isComplete = result.status === 'complete';
  const nextIncompleteSlot = LV_SIMPSON_SLOT_ORDER.find(slot => !result.slots?.[slot]?.complete);
  return (
    <div className="bg-gray-950 mb-3 rounded border border-gray-700 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">LV Simpson Biplane</div>
          <div className="mt-1 text-xs text-gray-400">{result.method}</div>
        </div>
        <div
          className={`rounded px-2 py-1 text-xs font-semibold ${getLVSimpsonStatusClass(result.status)}`}
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
      {nextIncompleteSlot ? (
        <div className="bg-blue-950 mt-3 rounded border border-blue-900 p-2 text-xs text-blue-100">
          Next: navigate to {nextIncompleteSlot.replace('_', ' ')}. LV EF stays active during the
          guided session; draw the hinge line when ready. Press Esc to cancel.
        </div>
      ) : null}
      <div className="mt-3 space-y-1">
        {LV_SIMPSON_SLOT_ORDER.map(slot => {
          const slotResult = result.slots?.[slot];

          return (
            <div key={slot} className="flex justify-between gap-2 text-xs">
              <span className="text-gray-300">{slot.replace('_', ' ')}</span>
              <span className={slotResult?.complete ? 'text-green-300' : 'text-yellow-300'}>
                {getLVSimpsonSlotStatusText(slotResult)}
              </span>
            </div>
          );
        })}
      </div>

      {result.guidance?.length ? (
        <div
          className={`mt-3 rounded border p-2 text-xs ${
            result.status === 'invalid'
              ? 'bg-red-950 border-red-900 text-red-100'
              : 'bg-yellow-950 border-yellow-900 text-yellow-100'
          }`}
        >
          <div className="mb-1 font-semibold">LV EF guidance</div>
          <div className="space-y-1">
            {result.guidance.slice(0, 6).map((message, index) => (
              <div key={`${index}-${message}`}>• {message}</div>
            ))}
          </div>
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
      integration: String(qs.get('arIntegration') || '').trim(),
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
      integration: '',
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

function isClinicalReportMeasurementsTarget(saveTarget: any = {}) {
  return (
    saveTarget.mode === CLINICAL_REPORT_MEASUREMENTS_SAVE_TARGET &&
    !!saveTarget.seriesId &&
    String(saveTarget.launchSource || '').trim().toLowerCase() === 'report'
  );
}

const CLINICAL_REPORT_REVIEW_PREFERENCE_KEY =
  'ar.viewerMeasurements.reviewClinicalReportBeforeSave';

function getClinicalReportReviewPreference() {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(CLINICAL_REPORT_REVIEW_PREFERENCE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function setClinicalReportReviewPreference(value) {
  try {
    window.localStorage.setItem(CLINICAL_REPORT_REVIEW_PREFERENCE_KEY, value ? 'true' : 'false');
  } catch {}
}

function areClinicalReportValuesEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function formatClinicalReportFieldLabel(fieldName = '') {
  const value = String(fieldName || '').trim();

  if (!value) {
    return 'Measurement';
  }

  return value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatClinicalReportValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.length ? value.map(formatClinicalReportValue).join(', ') : '—';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function buildClinicalReportReviewRows(preview: any = {}) {
  const hasAuthoritativeServerItems = Array.isArray(preview?.items);
  const serverItems = hasAuthoritativeServerItems
    ? preview.items
    : Array.isArray(preview?.reviewItems)
      ? preview.reviewItems
      : [];

  // Current FormAPI always returns an explicit `items` array for clinical
  // measurement review, including [] when nothing differs. Treat that empty
  // array as authoritative. Falling through to the compatibility mapper in
  // that case rebuilds rows from viewerReportFieldUpdates without an existing
  // value map and falsely presents every current measurement as a new change.
  if (hasAuthoritativeServerItems || serverItems.length > 0) {
    return serverItems
      .map((item, index) => {
        const fieldNames = Array.from(
          new Set(
            (Array.isArray(item?.fields) ? item.fields : [])
              .map(fieldName => String(fieldName || '').trim())
              .filter(fieldName => /^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName))
          )
        );
        const key = String(item?.key || fieldNames.join('|') || `review-${index}`).trim();

        if (!key || fieldNames.length === 0) {
          return null;
        }

        return {
          key,
          fieldNames,
          label:
            String(item?.label || '').trim() ||
            formatClinicalReportFieldLabel(fieldNames[0] || key),
          existingValue: item?.existingValue,
          incomingValue: item?.incomingValue,
          changed: true,
          isNew: item?.isNew === true,
        };
      })
      .filter(Boolean);
  }

  // Compatibility fallback for an older FormAPI: pair a value with its UOM so
  // a unit is never shown as a separate report choice.
  const incomingValues =
    preview?.incomingReportValues && typeof preview.incomingReportValues === 'object'
      ? preview.incomingReportValues
      : preview?.reportFieldUpdates && typeof preview.reportFieldUpdates === 'object'
        ? preview.reportFieldUpdates
        : {};
  const existingValues =
    preview?.existingReportValues && typeof preview.existingReportValues === 'object'
      ? preview.existingReportValues
      : {};
  const consumed = new Set<string>();
  const rows: any[] = [];

  for (const fieldName of Object.keys(incomingValues)) {
    if (consumed.has(fieldName) || /UOM$/i.test(fieldName)) {
      continue;
    }

    const uomFieldName = `${fieldName}UOM`;
    const hasUom = Object.prototype.hasOwnProperty.call(incomingValues, uomFieldName);
    const fieldNames = hasUom ? [fieldName, uomFieldName] : [fieldName];
    const existingValue = hasUom
      ? [existingValues[fieldName], existingValues[uomFieldName]].filter(Boolean).join(' ')
      : existingValues[fieldName];
    const incomingValue = hasUom
      ? [incomingValues[fieldName], incomingValues[uomFieldName]].filter(Boolean).join(' ')
      : incomingValues[fieldName];

    fieldNames.forEach(candidate => consumed.add(candidate));
    rows.push({
      key: fieldName,
      fieldNames,
      label: formatClinicalReportFieldLabel(fieldName),
      existingValue,
      incomingValue,
      changed: !areClinicalReportValuesEqual(existingValue, incomingValue),
    });
  }

  return rows;
}

function hasClinicalReportDerivedConsequences(review: any = {}) {
  const consequences = review?.derivedConsequences;

  if (Array.isArray(consequences)) {
    return consequences.length > 0;
  }

  return !!(
    consequences &&
    typeof consequences === 'object' &&
    Object.keys(consequences).length > 0
  );
}

function ClinicalReportMeasurementReviewModal({
  review,
  selectedRowKeys = [],
  showReviewBeforeSave,
  isSaving,
  onToggleRow,
  onToggleAll,
  onPreferenceChange,
  onCancel,
  onApply,
}) {
  if (!review || typeof document === 'undefined') {
    return null;
  }

  const rows = Array.isArray(review.rows) ? review.rows : [];
  const selected = new Set(selectedRowKeys);
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.key));
  const hasDerivedConsequences = hasClinicalReportDerivedConsequences(review);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.82)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ar-viewer-measurement-review-title"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-600 text-white shadow-2xl"
        style={{ backgroundColor: '#111827' }}
      >
        <div className="border-b border-gray-700 p-4">
          <div id="ar-viewer-measurement-review-title" className="text-lg font-semibold">
            Review Viewer Measurements
          </div>
          <div className="mt-1 text-sm text-gray-300">
            Select the viewer measurements that should replace values in the AR report. Units are
            shown with their measurements. Viewer annotations are saved even when a report value is
            not selected.
          </div>
          {hasDerivedConsequences ? (
            <div className="mt-2 text-xs text-gray-400">
              AR will also recalculate dependent indexed values from any selected source
              measurements.
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div className="text-sm text-gray-300">
            {selected.size} of {rows.length} report value{rows.length === 1 ? '' : 's'} selected
          </div>
          <button
            type="button"
            className="rounded border border-gray-600 px-3 py-1.5 text-sm hover:border-blue-400 hover:bg-gray-900"
            onClick={() => onToggleAll?.(!allSelected)}
            disabled={isSaving || rows.length === 0}
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead
              className="sticky top-0 text-left text-xs uppercase tracking-wide text-gray-400"
              style={{ backgroundColor: '#1f2937' }}
            >
              <tr>
                <th className="w-12 px-4 py-3">Apply</th>
                <th className="w-[28%] px-3 py-3">Measurement</th>
                <th className="px-3 py-3">Existing AR Report</th>
                <th className="px-3 py-3">Incoming Viewer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="border-t border-gray-800 align-top">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(row.key)}
                      onChange={() => onToggleRow?.(row.key)}
                      disabled={isSaving}
                      aria-label={`Apply ${row.label}`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-white">{row.label}</div>
                    {row.isNew ? <div className="mt-1 text-xs text-gray-400">New value</div> : null}
                  </td>
                  <td className="break-words px-3 py-3 text-gray-300">
                    {formatClinicalReportValue(row.existingValue)}
                  </td>
                  <td className="break-words px-3 py-3 font-medium text-white">
                    {formatClinicalReportValue(row.incomingValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-gray-700 p-4">
          <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={showReviewBeforeSave}
              onChange={event => onPreferenceChange?.(event.target.checked)}
              disabled={isSaving}
            />
            Review AR report values before saving viewer measurements
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-gray-600 px-4 py-2 text-sm font-semibold hover:bg-gray-900 disabled:opacity-50"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={onApply}
              disabled={isSaving}
            >
              {isSaving
                ? 'Saving…'
                : selected.size > 0
                  ? `Apply Selected (${selected.size}) & Save`
                  : 'Save Measurements Only'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

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

function isExternalIuscanViewer(saveTarget: any = {}) {
  return (
    normalizeMeasurementScoringToken(saveTarget.integration) === 'iuscan' &&
    isVirtualCoachingReviewWorkflow(saveTarget)
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
  const isExternalIuscanSession = isExternalIuscanViewer(saveTarget);

  const isReviewWorkflowReadOnly = isReviewWorkflow && !getWritableMeasurementWorkflow(saveTarget);
  const isClinicalReportSaveTarget = isClinicalReportMeasurementsTarget(saveTarget);
  const [measurements, setMeasurements] = useState([]);
  const [pendingDeletedMeasurementIds, setPendingDeletedMeasurementIds] = useState<string[]>([]);
  const [savingAction, setSavingAction] = useState('');
  const [isPreparingClinicalReportReview, setIsPreparingClinicalReportReview] = useState(false);
  const [showClinicalReportReviewBeforeSave, setShowClinicalReportReviewBeforeSave] = useState(
    getClinicalReportReviewPreference
  );
  const [clinicalReportReview, setClinicalReportReview] = useState(null);
  const [selectedClinicalReportRowKeys, setSelectedClinicalReportRowKeys] = useState([]);
  const isSaving = !!savingAction || isPreparingClinicalReportReview;
  const [domain, setDomain] = useState(() => getViewerMeasurementDomainFromPath());
  const [savedAnnotations, setSavedAnnotations] = useState([]);
  const [sessionLVSimpsonMeasurements, setSessionLVSimpsonMeasurements] = useState([]);
  const [sessionLAVolumeMeasurements, setSessionLAVolumeMeasurements] = useState([]);
  const saveInFlightRef = useRef(false);
  const autoDisplayPeerMeasurementStateRef = useRef({
    key: '',
    status: 'idle',
  });
  const [isLearnerMeasurementWorkflow, setIsLearnerMeasurementWorkflow] = useState(
    isLearnerViewerMeasurementWorkflowFromUrl
  );
  const isMeasurementScoringDisabled = isViewerMeasurementScoringDisabledFromUrl();
  const refreshLiveMeasurements = useCallback(async () => {
    try {
      const snapshot = await Promise.resolve(
        commandsManager.runCommand('getViewerMeasurementSnapshotForPanel')
      );

      if (Array.isArray(snapshot)) {
        setMeasurements([...snapshot]);
        return;
      }
    } catch (error) {
      console.warn('[ARMeasurementsPanel] AR measurement snapshot refresh failed:', error);
    }

    setMeasurements(
      [...(measurementService.getMeasurements?.() || [])].filter(
        measurement => !isUltrasoundDirectionalMeasurement(measurement)
      )
    );
  }, [commandsManager, measurementService]);

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
      .filter(annotation => annotation?.toolName && isDisplayableViewerMeasurement(annotation));

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
    const events = measurementService.EVENTS || {};
    const subscriptions = [
      events.MEASUREMENT_ADDED,
      events.MEASUREMENT_UPDATED,
      events.MEASUREMENT_REMOVED,
      events.MEASUREMENTS_CLEARED,
      events.RAW_MEASUREMENT_ADDED,
    ]
      .filter(Boolean)
      .map(eventName => measurementService.subscribe(eventName, refreshLiveMeasurements));

    window.addEventListener(AR_LIVE_MEASUREMENTS_REFRESH_EVENT, refreshLiveMeasurements);

    void refreshLiveMeasurements();

    return () => {
      subscriptions.forEach(subscription => subscription?.unsubscribe?.());
      window.removeEventListener(AR_LIVE_MEASUREMENTS_REFRESH_EVENT, refreshLiveMeasurements);
    };
  }, [measurementService, refreshLiveMeasurements]);

  useEffect(() => {
    const handleLVSimpsonSessionUpdated = event => {
      const nextMeasurements = Array.isArray(event?.detail?.measurements)
        ? event.detail.measurements
        : [];

      setSessionLVSimpsonMeasurements(nextMeasurements);
      void refreshLiveMeasurements();
    };

    window.addEventListener(AR_LV_SIMPSON_SESSION_EVENT, handleLVSimpsonSessionUpdated);

    return () => {
      window.removeEventListener(AR_LV_SIMPSON_SESSION_EVENT, handleLVSimpsonSessionUpdated);
    };
  }, [refreshLiveMeasurements]);

  useEffect(() => {
    const handleLAVolumeSessionUpdated = event => {
      const nextMeasurements = Array.isArray(event?.detail?.measurements)
        ? event.detail.measurements
        : [];

      setSessionLAVolumeMeasurements(nextMeasurements);
      void refreshLiveMeasurements();
    };

    window.addEventListener(AR_LA_VOLUME_SESSION_EVENT, handleLAVolumeSessionUpdated);

    return () => {
      window.removeEventListener(AR_LA_VOLUME_SESSION_EVENT, handleLAVolumeSessionUpdated);
    };
  }, [refreshLiveMeasurements]);

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

  useEffect(() => {
    if (domain !== 'bowel' || savedAnnotations.length === 0) {
      return;
    }

    const curvedLengthAnnotations = savedAnnotations.filter(
      annotation => annotation?.isSavedAnnotation === true && isBowelCurvedLengthMeasurement(annotation)
    );

    if (curvedLengthAnnotations.length === 0) {
      return;
    }

    let cancelled = false;
    const hydratedAnnotationIds = new Set();
    const retryDelays = [0, 250, 750, 1500];

    const hydrateVisibleCurvedLengths = async () => {
      for (const annotation of curvedLengthAnnotations) {
        if (cancelled) {
          return;
        }

        const annotationId = getMeasurementKey(annotation);

        if (!annotationId || hydratedAnnotationIds.has(annotationId)) {
          continue;
        }

        try {
          const result = await commandsManager.runCommand(
            'hydrateSavedViewerAnnotationIfVisibleInActiveViewport',
            {
              annotation,
              selectAnnotation: false,
            }
          );

          if (result?.ok) {
            hydratedAnnotationIds.add(annotationId);
            continue;
          }

          if (
            result?.reason !== 'saved-image-not-active' &&
            result?.reason !== 'viewport-not-found'
          ) {
            console.warn('[ARMeasurementsPanel] curved-length hydration skipped:', result);
          }
        } catch (error) {
          if (!cancelled) {
            console.warn('[ARMeasurementsPanel] curved-length hydration failed:', error);
          }
        }
      }
    };

    const timers = retryDelays.map(delay =>
      window.setTimeout(() => {
        void hydrateVisibleCurvedLengths();
      }, delay)
    );

    return () => {
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [commandsManager, domain, savedAnnotations]);

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
      if (!measurement?.toolName || !isDisplayableViewerMeasurement(measurement)) {
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
    for (const measurement of sessionLVSimpsonMeasurements) {
      if (!measurement?.toolName || !hasSemanticLabel(measurement)) {
        continue;
      }

      const key = getMeasurementKey(measurement);

      if (key && !byKey.has(key)) {
        // The guided-session object is only a creation-time fallback. Once the
        // live MeasurementService contour is present, keep the live contour
        // already resolved into byKey instead of overwriting it with stale
        // session state.
        byKey.set(key, normalizeMeasurementForDisplay(measurement));
      }
    }
    for (const measurement of sessionLAVolumeMeasurements) {
      if (!measurement?.toolName || !hasSemanticLabel(measurement)) {
        continue;
      }

      const key = getMeasurementKey(measurement);

      if (key && !byKey.has(key)) {
        // The guided-session object preserves LA anatomical landmarks, but its
        // contour points are only a creation-time fallback. Once MeasurementService
        // has the same annotation, keep the live edited contour already in byKey.
        byKey.set(key, normalizeMeasurementForDisplay(measurement));
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
  }, [
    measurements,
    savedAnnotations,
    sessionLVSimpsonMeasurements,
    sessionLAVolumeMeasurements,
    isReviewWorkflow,
    saveTarget,
  ]);

  const editableMeasurements = useMemo(
    () => visibleMeasurements.filter(measurement => isMeasurementEditable(measurement, saveTarget)),
    [visibleMeasurements, saveTarget]
  );

  const lvSimpsonResult = useMemo(() => {
    if (domain !== 'echo') {
      return null;
    }

    return calculateLVSimpson(visibleMeasurements);
  }, [domain, visibleMeasurements]);

  const laVolumeResult = useMemo(() => {
    if (domain !== 'echo') {
      return null;
    }

    return calculateLAVolume(visibleMeasurements);
  }, [domain, visibleMeasurements]);

  const cseLAVolumeReportFieldUpdates = useMemo(
    () => buildCseLAVolumeReportFieldUpdatesFromResult(laVolumeResult),
    [laVolumeResult]
  );

  const measurementGroups = useMemo(() => {
    if (domain === 'echo' && !isReviewWorkflow) {
      const laMeasurements = visibleMeasurements.filter(
        measurement => getEchoMeasurementAnatomyGroup(measurement) === 'la'
      );
      const lvMeasurements = visibleMeasurements.filter(
        measurement => getEchoMeasurementAnatomyGroup(measurement) === 'lv'
      );
      const otherMeasurements = visibleMeasurements.filter(
        measurement => getEchoMeasurementAnatomyGroup(measurement) === 'other'
      );

      return [
        {
          key: 'la',
          title: 'LA',
          measurements: laMeasurements,
          summary: 'la',
        },
        {
          key: 'lv',
          title: 'LV',
          measurements: lvMeasurements,
          summary: 'lv',
        },
        ...(otherMeasurements.length > 0
          ? [
              {
                key: 'other',
                title: 'Other measurements & annotations',
                measurements: otherMeasurements,
                summary: '',
              },
            ]
          : []),
      ];
    }

    if (!isReviewWorkflow) {
      return [
        {
          key: 'all',
          title: '',
          measurements: visibleMeasurements,
          summary: '',
        },
      ];
    }

    return [
      {
        key: 'learner',
        title:
          String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'learner'
            ? 'My measurements & annotations'
            : 'Learner measurements & annotations',
        measurements: visibleMeasurements.filter(
          measurement => measurement?.workflow !== REVIEWER_MEASUREMENTS_WORKFLOW
        ),
        summary: '',
      },
      {
        key: 'coach',
        title:
          String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'educator'
            ? 'My measurements & annotations'
            : 'Coach measurements & annotations',
        measurements: visibleMeasurements.filter(
          measurement => measurement?.workflow === REVIEWER_MEASUREMENTS_WORKFLOW
        ),
        summary: '',
      },
    ];
  }, [domain, isReviewWorkflow, saveTarget, visibleMeasurements]);

  const runMeasurementSave = async (scoreNow = false, options: any = {}) => {
    const viewerDerivedReportFieldUpdates =
      isClinicalReportSaveTarget && Object.keys(cseLAVolumeReportFieldUpdates).length > 0
        ? {
            ...cseLAVolumeReportFieldUpdates,
            ...(options.viewerDerivedReportFieldUpdates || {}),
          }
        : options.viewerDerivedReportFieldUpdates;

    return withTimeout(
      commandsManager.runCommand('saveViewerMeasurementsForActiveStudy', {
        domain: domain === 'generic' ? undefined : domain,
        scoringIntent: scoreNow ? 'score-attempt' : 'draft',
        educationAttemptIntent: scoreNow ? 'score-attempt' : 'draft',
        deleteAnnotationIds: pendingDeletedMeasurementIds,
        ...options,
        ...(viewerDerivedReportFieldUpdates
          ? { viewerDerivedReportFieldUpdates }
          : {}),
      }),
      30000,
      options?.previewOnly ? 'Review measurements' : 'Save measurements'
    );
  };

  const saveCurrentMeasurements = async (scoreNow = false, options: any = {}) => {
    const result = await runMeasurementSave(scoreNow, options);

    if (!result?.previewOnly && result?.annotations) {
      applySavedAnnotationsResult({
        annotations: result.annotations,
        processedAnnotations: result.annotations,
        seriesDoc: result.seriesDoc,
        saveTarget,
        domain,
      });
      setPendingDeletedMeasurementIds([]);
    }

    return result;
  };

  const executeMeasurementSave = async (scoreNow = false, options: any = {}) => {
    if (saveInFlightRef.current) {
      return null;
    }

    saveInFlightRef.current = true;
    setSavingAction(scoreNow ? 'score' : 'draft');

    try {
      return await saveCurrentMeasurements(scoreNow, options);
    } catch (error) {
      console.error('[ARMeasurementsPanel] save failed:', error);
      uiNotificationService.show({
        title: 'AR Measurements & Annotations',
        message: `Save failed: ${error?.message || error}`,
        type: 'error',
        duration: 5000,
      });
      return null;
    } finally {
      saveInFlightRef.current = false;
      setSavingAction('');
    }
  };

  const handleClinicalReportReviewPreferenceChange = value => {
    const nextValue = !!value;
    setShowClinicalReportReviewBeforeSave(nextValue);
    setClinicalReportReviewPreference(nextValue);
  };

  const handleClinicalReportReviewRowToggle = rowKey => {
    setSelectedClinicalReportRowKeys(current =>
      current.includes(rowKey)
        ? current.filter(candidate => candidate !== rowKey)
        : [...current, rowKey]
    );
  };

  const handleClinicalReportReviewToggleAll = selectAll => {
    const rows = Array.isArray(clinicalReportReview?.rows) ? clinicalReportReview.rows : [];
    setSelectedClinicalReportRowKeys(selectAll ? rows.map(row => row.key) : []);
  };

  const handleClinicalReportReviewApply = async () => {
    if (!clinicalReportReview || saveInFlightRef.current) {
      return;
    }

    const scoreNow = clinicalReportReview.scoreNow === true;
    const selectedRowKeySet = new Set(selectedClinicalReportRowKeys);
    const rows = Array.isArray(clinicalReportReview?.rows) ? clinicalReportReview.rows : [];
    const reportFieldNames = Array.from(
      new Set(
        rows
          .filter(row => selectedRowKeySet.has(row.key))
          .flatMap(row => (Array.isArray(row.fieldNames) ? row.fieldNames : []))
      )
    );

    setClinicalReportReview(null);
    setSelectedClinicalReportRowKeys([]);

    await executeMeasurementSave(scoreNow, { reportFieldNames });
  };

  const handleSave = async (scoreNow = false) => {
    if (saveInFlightRef.current || isPreparingClinicalReportReview) {
      return;
    }

    if (scoreNow && isMeasurementScoringDisabled) {
      uiNotificationService.show({
        title: 'AR Measurements & Annotations',
        message: 'Measurement scoring is disabled for this viewer quiz workflow.',
        type: 'warning',
        duration: 5000,
      });
      return;
    }

    if (isClinicalReportSaveTarget && showClinicalReportReviewBeforeSave) {
      setIsPreparingClinicalReportReview(true);

      try {
        const preview = await runMeasurementSave(scoreNow, { previewOnly: true });

        if (!preview) {
          return;
        }

        const rows = buildClinicalReportReviewRows(preview);

        if (rows.length === 0 && preview?.measurementAnnotationsChanged === false) {
          uiNotificationService.show({
            title: 'AR Measurements & Annotations',
            message: 'No new measurements or annotations to save.',
            type: 'info',
            duration: 3000,
          });
          return;
        }

        if (rows.length > 0) {
          setSelectedClinicalReportRowKeys(rows.filter(row => row.changed).map(row => row.key));
          setClinicalReportReview({
            scoreNow,
            rows,
            derivedConsequences: preview?.derivedConsequences,
          });
          return;
        }
      } catch (error) {
        console.error('[ARMeasurementsPanel] measurement review failed:', error);
        uiNotificationService.show({
          title: 'AR Measurements & Annotations',
          message: `Unable to review report values: ${error?.message || error}`,
          type: 'error',
          duration: 5000,
        });
        return;
      } finally {
        setIsPreparingClinicalReportReview(false);
      }
    }

    await executeMeasurementSave(scoreNow);
  };

  const handleIuscanDone = async () => {
    if (!isExternalIuscanSession || isSaving) {
      return;
    }

    setSavingAction('complete');

    try {
      if (
        !isReviewWorkflowReadOnly &&
        (editableMeasurements.length > 0 || pendingDeletedMeasurementIds.length > 0)
      ) {
        await saveCurrentMeasurements(false);
      }

      await commandsManager.runCommand('completeIuscanIntegrationSession');
    } catch (error) {
      console.error('[ARMeasurementsPanel] iUSCAN completion failed:', error);
      uiNotificationService.show({
        title: 'AR Measurements & Annotations',
        message: `Unable to return to iUSCAN: ${error?.message || error}`,
        type: 'error',
        duration: 6000,
      });
      setSavingAction('');
    }
  };

  const deleteMeasurement = useCallback(
    async measurement => {
      const measurementId = String(getMeasurementKey(measurement) || '').trim();

      if (!measurementId || measurement?.isLocked === true || !isMeasurementEditable(measurement, saveTarget)) {
        return;
      }

      const label = getMeasurementLabel(measurement);
      const confirmed = window.confirm(
        `Delete ${label || 'this measurement or annotation'}? The deletion will be permanent after you save.`
      );

      if (!confirmed) {
        return;
      }

      try {
        await Promise.resolve(
          commandsManager.runCommand('removeMeasurement', {
            uid: measurementId,
          })
        );

        setPendingDeletedMeasurementIds(current =>
          current.includes(measurementId) ? current : [...current, measurementId]
        );
        setSavedAnnotations(current =>
          current.filter(candidate => getMeasurementKey(candidate) !== measurementId)
        );
        setMeasurements(current =>
          current.filter(candidate => getMeasurementKey(candidate) !== measurementId)
        );
        setSessionLVSimpsonMeasurements(current =>
          current.filter(candidate => getMeasurementKey(candidate) !== measurementId)
        );
        setSessionLAVolumeMeasurements(current =>
          current.filter(candidate => getMeasurementKey(candidate) !== measurementId)
        );

        void refreshLiveMeasurements();

        uiNotificationService.show({
          title: 'AR Measurements & Annotations',
          message: 'Measurement or annotation deleted. Save to make the deletion permanent.',
          type: 'info',
          duration: 3500,
        });
      } catch (error) {
        console.error('[ARMeasurementsPanel] delete failed:', error);
        uiNotificationService.show({
          title: 'AR Measurements & Annotations',
          message: `Delete failed: ${error?.message || error}`,
          type: 'error',
          duration: 5000,
        });
      }
    },
    [commandsManager, refreshLiveMeasurements, saveTarget, uiNotificationService]
  );

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
        if (isUltrasoundDirectionalMeasurement(measurement)) {
          const result = await commandsManager.runCommand('jumpToSavedViewerAnnotation', {
            annotation: measurement,
            selectAnnotation: true,
            runDelayedDisplayRefresh: false,
          });

          return (
            result || {
              ok: true,
              source: 'cornerstone-directional-annotation',
              annotationId: uid,
            }
          );
        }

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

    const autoDisplayAnnotations = getAutoDisplayAnnotationsForReferenceImage(
      visibleMeasurements,
      saveTarget,
      targetMeasurements
    );

    const referenceMeasurement = targetMeasurements[0] || autoDisplayAnnotations[0];

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
        <div className="text-base font-semibold">AR Measurements &amp; Annotations</div>
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
        {visibleMeasurements.length === 0 ? (
          <div className="text-sm text-gray-400">No viewer measurements or annotations yet.</div>
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

                  {group.summary === 'la' ? <LAVolumeSummary result={laVolumeResult} /> : null}
                  {group.summary === 'lv' ? <LVSimpsonSummary result={lvSimpsonResult} /> : null}

                  {group.measurements.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No measurements or annotations in this section.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {group.measurements.map(measurement => {
                        const label = getMeasurementLabel(measurement);
                        const value = getMeasurementValue(measurement);
                        const subtitle = getMeasurementSubtitle(measurement);

                        const canDelete =
                          measurement?.isLocked !== true &&
                          isMeasurementEditable(measurement, saveTarget) &&
                          !!getMeasurementKey(measurement);

                        return (
                          <div
                            key={
                              measurement.uid ||
                              measurement.id ||
                              `${measurement.toolName}-${label}`
                            }
                            className="flex w-full overflow-hidden rounded border border-gray-700 hover:border-blue-400 hover:bg-gray-900"
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 p-2 text-left"
                              onClick={() => jumpToMeasurement(measurement)}
                              title="Jump to measurement or annotation"
                            >
                              <div className="text-sm font-semibold">{label}</div>

                              <div className="text-xs text-gray-400">{subtitle}</div>

                              {value ? <div className="mt-1 text-sm">{value}</div> : null}
                            </button>

                            {canDelete ? (
                              <button
                                type="button"
                                className="shrink-0 border-l border-gray-700 px-3 text-xs font-semibold text-red-300 hover:bg-red-950 hover:text-red-100"
                                onClick={() => deleteMeasurement(measurement)}
                                title="Delete measurement or annotation"
                                aria-label={`Delete ${label}`}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
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
        {isClinicalReportSaveTarget ? (
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={showClinicalReportReviewBeforeSave}
              onChange={event =>
                handleClinicalReportReviewPreferenceChange(event.target.checked)
              }
              disabled={isSaving}
            />
            Review AR report values before saving
          </label>
        ) : null}

        {isReviewWorkflow ? (
          isExternalIuscanSession ? (
            <div className="space-y-2">
              {isReviewWorkflowReadOnly ? (
                <div className="text-center text-xs text-gray-400">
                  Measurements and annotations are read-only for this coaching review.
                </div>
              ) : null}

              <button
                type="button"
                className="w-full rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isSaving}
                onClick={handleIuscanDone}
              >
                {savingAction === 'complete'
                  ? 'Saving and returning…'
                  : 'Done and Return to iUSCAN'}
              </button>
            </div>
          ) : isReviewWorkflowReadOnly ? (
            <div className="text-center text-xs text-gray-400">
              Measurements and annotations are read-only for this coaching review.
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isSaving || (editableMeasurements.length === 0 && pendingDeletedMeasurementIds.length === 0)}
              onClick={() => handleSave(false)}
            >
              {savingAction === 'draft'
                ? 'Saving…'
                : String(saveTarget.measurementWorkflowRole || '').toLowerCase() === 'educator'
                  ? 'Save Coach Measurements & Annotations'
                  : 'Save Learner Measurements & Annotations'}
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
              disabled={isSaving || (visibleMeasurements.length === 0 && pendingDeletedMeasurementIds.length === 0)}
              onClick={() => handleSave(false)}
            >
              {savingAction === 'draft' ? 'Saving…' : 'Save Draft'}
            </button>

            {!isMeasurementScoringDisabled ? (
              <button
                type="button"
                className="rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isSaving || (visibleMeasurements.length === 0 && pendingDeletedMeasurementIds.length === 0)}
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
            disabled={isSaving || (visibleMeasurements.length === 0 && pendingDeletedMeasurementIds.length === 0)}
            onClick={() => handleSave(false)}
          >
            {isPreparingClinicalReportReview
              ? 'Reviewing…'
              : savingAction === 'draft'
                ? 'Saving…'
                : 'Save Measurements & Annotations'}
          </button>
        )}
      </div>

      <ClinicalReportMeasurementReviewModal
        review={clinicalReportReview}
        selectedRowKeys={selectedClinicalReportRowKeys}
        showReviewBeforeSave={showClinicalReportReviewBeforeSave}
        isSaving={!!savingAction}
        onToggleRow={handleClinicalReportReviewRowToggle}
        onToggleAll={handleClinicalReportReviewToggleAll}
        onPreferenceChange={handleClinicalReportReviewPreferenceChange}
        onCancel={() => {
          setClinicalReportReview(null);
          setSelectedClinicalReportRowKeys([]);
        }}
        onApply={handleClinicalReportReviewApply}
      />
    </div>
  );
}
