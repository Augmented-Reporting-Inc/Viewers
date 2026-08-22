import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateLVSimpson, LV_SIMPSON_SLOT_ORDER } from '../utils/lvSimpson';
import { getViewerMeasurementDomainFromPath } from '../utils/measurementLabelConfig';

function getMeasurementLabel(measurement) {
  return (
    measurement?.label ||
    measurement?.measurementRole ||
    measurement?.description ||
    getArrowAnnotateText(measurement) ||
    measurement?.toolName ||
    'Unlabelled measurement'
  );
}

const AR_SAVED_ANNOTATIONS_REFRESH_EVENT = 'ar-measurements:saved-annotations-updated';
const AR_LIVE_MEASUREMENTS_REFRESH_EVENT = 'ar-measurements:live-measurements-updated';
const AR_LV_SIMPSON_SESSION_EVENT = 'ar-measurements:lv-simpson-session-updated';

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
    measurement?.slot ||
    getArrowAnnotateText(measurement)
  );
}

function isDisplayableViewerMeasurement(measurement) {
  return !!(measurement?.toolName === 'Length' || hasSemanticLabel(measurement));
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
  const [measurements, setMeasurements] = useState(
    () => measurementService.getMeasurements?.() || []
  );
  const [savingAction, setSavingAction] = useState('');
  const isSaving = !!savingAction;
  const [domain, setDomain] = useState(() => getViewerMeasurementDomainFromPath());
  const [savedAnnotations, setSavedAnnotations] = useState([]);
  const [sessionLVSimpsonMeasurements, setSessionLVSimpsonMeasurements] = useState([]);
  const saveInFlightRef = useRef(false);
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

    window.addEventListener(AR_LIVE_MEASUREMENTS_REFRESH_EVENT, refresh);

    refresh();

    return () => {
      subscriptions.forEach(subscription => subscription?.unsubscribe?.());
      window.removeEventListener(AR_LIVE_MEASUREMENTS_REFRESH_EVENT, refresh);
    };
  }, [measurementService]);

  useEffect(() => {
    const handleLVSimpsonSessionUpdated = event => {
      const nextMeasurements = Array.isArray(event?.detail?.measurements)
        ? event.detail.measurements
        : [];

      setSessionLVSimpsonMeasurements(nextMeasurements);
      setMeasurements([...(measurementService.getMeasurements?.() || [])]);
    };

    window.addEventListener(AR_LV_SIMPSON_SESSION_EVENT, handleLVSimpsonSessionUpdated);

    return () => {
      window.removeEventListener(AR_LV_SIMPSON_SESSION_EVENT, handleLVSimpsonSessionUpdated);
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

      if (key) {
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
  }, [measurements, savedAnnotations, sessionLVSimpsonMeasurements, isReviewWorkflow, saveTarget]);

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
            ? 'My measurements & annotations'
            : 'Learner measurements & annotations',
        measurements: visibleMeasurements.filter(
          measurement => measurement?.workflow !== REVIEWER_MEASUREMENTS_WORKFLOW
        ),
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
      },
    ];
  }, [isReviewWorkflow, saveTarget, visibleMeasurements]);

  const lvSimpsonResult = useMemo(() => {
    if (domain !== 'echo') {
      return null;
    }

    return calculateLVSimpson(visibleMeasurements);
  }, [domain, visibleMeasurements]);

  const saveCurrentMeasurements = async (scoreNow = false) => {
    const result = await withTimeout(
      commandsManager.runCommand('saveViewerMeasurementsForActiveStudy', {
        domain: domain === 'generic' ? undefined : domain,
        scoringIntent: scoreNow ? 'score-attempt' : 'draft',
        educationAttemptIntent: scoreNow ? 'score-attempt' : 'draft',
      }),
      30000,
      'Save measurements'
    );

    if (result?.annotations) {
      applySavedAnnotationsResult({
        annotations: result.annotations,
        processedAnnotations: result.annotations,
        seriesDoc: result.seriesDoc,
        saveTarget,
        domain,
      });
    }

    return result;
  };

  const handleSave = async (scoreNow = false) => {
    if (saveInFlightRef.current) {
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

    saveInFlightRef.current = true;
    setSavingAction(scoreNow ? 'score' : 'draft');

    try {
      await saveCurrentMeasurements(scoreNow);
    } catch (error) {
      console.error('[ARMeasurementsPanel] save failed:', error);
      uiNotificationService.show({
        title: 'AR Measurements & Annotations',
        message: `Save failed: ${error?.message || error}`,
        type: 'error',
        duration: 5000,
      });
    } finally {
      saveInFlightRef.current = false;
      setSavingAction('');
    }
  };

  const handleIuscanDone = async () => {
    if (!isExternalIuscanSession || isSaving) {
      return;
    }

    setSavingAction('complete');

    try {
      if (!isReviewWorkflowReadOnly && editableMeasurements.length > 0) {
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
        {domain === 'echo' ? <LVSimpsonSummary result={lvSimpsonResult} /> : null}

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
                            title="Jump to measurement or annotation"
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
              disabled={isSaving || editableMeasurements.length === 0}
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
            {savingAction === 'draft' ? 'Saving…' : 'Save Measurements & Annotations'}
          </button>
        )}
      </div>
    </div>
  );
}
