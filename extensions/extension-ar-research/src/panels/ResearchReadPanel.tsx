import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { buildViewerMeasurementValueCandidates } from 'extension-ar-measurements';
import ResearchEchoGuidedControls from './ResearchEchoGuidedControls';
import {
  getResearchRapChoices,
  getResearchCompanionField,
  isResearchCompanionHidden,
} from '../utils/researchEchoWorkflow';
import {
  buildReadFields,
  buildCalculatedReadState,
  buildReadResultEntries,
  buildReadValueState,
  buildViewerMeasurementReadUpdates,
  getMissingRequiredReadFields,
} from '../utils/readSchema';
import {
  getResearchFieldMeasurementCandidates,
  getResearchFieldSourceAnnotations,
  getResearchProtocolViewerTargets,
  getResearchProtocolCompatibleCandidates,
  isResearchCandidateOnProtocolFrames,
} from '../utils/researchFieldNavigation';
import {
  completeResearchReadReview,
  loadResearchReadContext,
  saveResearchReadReview,
} from '../utils/researchContext';

const VIEWER_MEASUREMENTS_WORKFLOW = 'viewerMeasurements';

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function getAnnotationKey(annotation: any = {}) {
  return cleanString(
    annotation?.annotationId ||
      annotation?.annotationUID ||
      annotation?.uid ||
      annotation?.id
  );
}

function mergeMeasurementAnnotations(saved: any[] = [], live: any[] = []) {
  const merged = new Map<string, any>();

  for (const annotation of [...(saved || []), ...(live || [])]) {
    const key = getAnnotationKey(annotation);
    if (key) {
      merged.set(key, annotation);
    }
  }

  return Array.from(merged.values());
}

function getAnnotationLabel(annotation: any = {}) {
  return (
    cleanString(
      annotation?.label ||
        annotation?.measurementRole ||
        annotation?.description ||
        annotation?.toolName
    ) || 'Viewer annotation'
  );
}

function getAnnotationValue(annotation: any = {}) {
  const display =
    annotation?.displayText?.primary ||
    annotation?.displayText ||
    annotation?.measurements?.displayText ||
    [];

  if (Array.isArray(display)) {
    const text = display.map(cleanString).filter(Boolean).join(' ');
    if (text) return text;
  }

  const value =
    annotation?.measurements?.value ??
    annotation?.measurements?.length ??
    annotation?.value;

  return value === null || typeof value === 'undefined'
    ? ''
    : cleanString(value);
}

function notify(servicesManager: any, message: string, type = 'success') {
  const uiNotificationService = servicesManager?.services?.uiNotificationService;

  if (uiNotificationService?.show) {
    uiNotificationService.show({
      title: 'Research Read',
      message,
      type,
      duration: 3500,
    });
  }
}

function ReadField({
  field,
  value,
  source,
  disabled,
  onChange,
}: {
  field: any;
  value: any;
  source?: any;
  disabled: boolean;
  onChange: (value: any) => void;
}) {
  const kind = cleanString(field.kind).toLowerCase();
  const numeric = ['measurement', 'continuous', 'number', 'numeric'].includes(kind);
  const text = ['text', 'comment', 'textarea'].includes(kind);
  const configuredOptions = Array.isArray(field?.config?.options) ? field.config.options : [];
  const options = configuredOptions.length ? configuredOptions :
    getResearchRapChoices(field).map(value => ({ value, label: value + ' mmHg' }));
  const unit = cleanString(field?.config?.unit);
  const calculated = cleanString(field?.config?.calculation?.type).toLowerCase() === 'rvsp';

  return (
    <div className="rounded border border-gray-700 bg-gray-950 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{field.label}</div>
          <div className="mt-0.5 text-xs text-gray-400">
            {field.required ? 'Required' : 'Optional'}
            {unit ? ` - ${unit}` : ''}
            {calculated ? ' · Calculated from measured TR Vmax and entered RAP' : ''}
          </div>
        </div>
        {field.required ? (
          <span className="rounded bg-blue-950 px-2 py-0.5 text-[11px] text-blue-200">
            Required
          </span>
        ) : null}
      </div>

      {['viewer-measurement', 'viewer-derived'].includes(cleanString(source?.source)) ? (
        <div className="mb-2 text-xs text-blue-300">
          {source.source === 'viewer-derived' ? 'Calculated from viewer evidence' : 'Linked to viewer measurement'}
        </div>
      ) : null}

      {options.length > 0 ? (
        <select
          className="w-full rounded border border-gray-600 bg-black px-3 py-2 text-sm text-white"
          value={value ?? ''}
          disabled={disabled || calculated}
          onChange={event => onChange(event.target.value)}
        >
          <option value="">Select...</option>
          {options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : text ? (
        <textarea
          className="min-h-24 w-full rounded border border-gray-600 bg-black px-3 py-2 text-sm text-white"
          value={value ?? ''}
          disabled={disabled || calculated}
          onChange={event => onChange(event.target.value)}
          placeholder="Enter reader comment"
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-gray-600 bg-black px-3 py-2 text-sm text-white"
            type={numeric ? 'number' : 'text'}
            value={value ?? ''}
            disabled={disabled || calculated}
            min={numeric ? field?.config?.min : undefined}
            max={numeric ? field?.config?.max : undefined}
            step={numeric ? field?.config?.step || 'any' : undefined}
            onChange={event => onChange(event.target.value)}
          />
          {unit ? <span className="text-sm text-gray-300">{unit}</span> : null}
        </div>
      )}
    </div>
  );
}

export default function ResearchReadPanel({ servicesManager, commandsManager }) {
  const [context, setContext] = useState<any>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [valueSources, setValueSources] = useState<Record<string, any>>({});
  const [viewerCandidates, setViewerCandidates] = useState<any[] | null>(null);
  const valueSourcesRef = useRef<Record<string, any>>({});
  const [savedAnnotations, setSavedAnnotations] = useState<any[]>([]);
  const [liveAnnotations, setLiveAnnotations] = useState<any[]>([]);
  const [selectedFieldKey, setSelectedFieldKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const next = await loadResearchReadContext();
      const readState = buildReadValueState(
        next?.review?.readResults || {}
      );

      setContext(next);
      setValues(readState.values);
      valueSourcesRef.current = readState.sources;
      setValueSources(readState.sources);
      const persistedAnnotations = Array.isArray(next?.review?.measurementAnnotations)
        ? next.review.measurementAnnotations : [];
      setLiveAnnotations([]);
      setViewerCandidates(buildViewerMeasurementValueCandidates(persistedAnnotations));
      setSavedAnnotations(persistedAnnotations);
    } catch (loadError) {
      console.error('[AR Research] unable to load Research Read context', loadError);
      setError(loadError?.message || 'Unable to load the Research Read.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fields = useMemo(
    () => buildReadFields(context?.readSchema || {}),
    [context?.readSchema]
  );
  const visibleFields = useMemo(
    () => fields.filter(field => !isResearchCompanionHidden(field, fields)),
    [fields]
  );
  useEffect(() => {
    if (!visibleFields.length) return;
    setSelectedFieldKey(current =>
      visibleFields.some(field => field.key === current) ? current :
      (visibleFields.find(field => field.required)?.key || visibleFields[0].key)
    );
  }, [visibleFields]);

  const allAnnotations = useMemo(
    () => mergeMeasurementAnnotations(savedAnnotations, liveAnnotations),
    [savedAnnotations, liveAnnotations]
  );

  const calculatedReadState = useMemo(
    () => (context?.readOnly || context?.preview
      ? { values, sources: valueSources }
      : buildCalculatedReadState(fields, values, valueSources, viewerCandidates)),
    [context?.readOnly, context?.preview, fields, values, valueSources, viewerCandidates]
  );
  const missingRequired = useMemo(
    () => getMissingRequiredReadFields(fields, calculatedReadState.values),
    [fields, calculatedReadState.values]
  );

  const updateValue = useCallback((fieldKey, nextValue) => {
    setValues(current => ({
      ...current,
      [fieldKey]: nextValue,
    }));

    setValueSources(current => {
      const next = {
        ...current,
        [fieldKey]: {
          source: 'manual',
          sourceMeasurementKey: '',
        },
      };

      valueSourcesRef.current = next;
      return next;
    });
  }, []);

  const refreshViewerMeasurementBindings = useCallback(async () => {
    if (
      !commandsManager ||
      !fields.length ||
      !context ||
      context.readOnly ||
      context.preview
    ) {
      return;
    }

    try {
      const serialized = await commandsManager.runCommand(
        'getSerializedViewerMeasurements',
        {
          domain: cleanString(context?.readSchema?.domain) || 'generic',
          workflow: VIEWER_MEASUREMENTS_WORKFLOW,
        }
      );

      const snapshot = Array.isArray(serialized?.annotations)
        ? serialized.annotations : [];
      setLiveAnnotations(snapshot);
      // A Research Review owns its persisted annotations. Unlike clinical
      // reports, this shared Research study need not have an AR Series doc.
      // Rebind from this review's saved evidence as well as current live work.
      const candidates = buildViewerMeasurementValueCandidates(
        mergeMeasurementAnnotations(savedAnnotations, snapshot)
      );

      setViewerCandidates(candidates);
      const available = mergeMeasurementAnnotations(savedAnnotations, snapshot);
      const updates = fields.flatMap(field =>
        buildViewerMeasurementReadUpdates(
          [field],
          getResearchProtocolCompatibleCandidates(field, candidates, available),
          valueSourcesRef.current
        )
      );

      if (!updates.length) {
        return;
      }

      setValues(current => {
        let changed = false;
        const next = { ...current };

        for (const update of updates) {
          if (next[update.fieldKey] !== update.value) {
            next[update.fieldKey] = update.value;
            changed = true;
          }
        }

        return changed ? next : current;
      });

      setValueSources(current => {
        let changed = false;
        const next = { ...current };

        for (const update of updates) {
          const previous = current?.[update.fieldKey] || {};

          if (
            previous.source !== update.source ||
            previous.sourceMeasurementKey !== update.sourceMeasurementKey
          ) {
            next[update.fieldKey] = {
              source: update.source,
              sourceMeasurementKey: update.sourceMeasurementKey,
            };
            changed = true;
          }
        }

        if (changed) {
          valueSourcesRef.current = next;
          return next;
        }

        return current;
      });
    } catch (bindingError) {
      setViewerCandidates([]);
      console.warn(
        '[AR Research] viewer measurement binding refresh failed',
        bindingError
      );
    }
  }, [
    commandsManager,
    context?.preview,
    context?.readOnly,
    context?.readSchema?.domain,
    fields,
    savedAnnotations,
  ]);

  useEffect(() => {
    const measurementService =
      servicesManager?.services?.measurementService;

    if (
      !measurementService ||
      context?.readOnly ||
      context?.preview ||
      !fields.length
    ) {
      return;
    }

    let cancelled = false;

    const refresh = () => {
      if (!cancelled) {
        void refreshViewerMeasurementBindings();
      }
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
      .map(eventName =>
        measurementService.subscribe(eventName, refresh)
      );

    const windowEvents = [
      'ar-measurements:live-measurements-updated',
      'ar-measurements:lv-simpson-session-updated',
    ];

    windowEvents.forEach(eventName =>
      window.addEventListener(eventName, refresh)
    );

    const timers = [0, 250, 1000].map(delay =>
      window.setTimeout(refresh, delay)
    );

    return () => {
      cancelled = true;

      subscriptions.forEach(subscription =>
        subscription?.unsubscribe?.()
      );

      timers.forEach(timer => window.clearTimeout(timer));

      windowEvents.forEach(eventName =>
        window.removeEventListener(eventName, refresh)
      );
    };
  }, [
    servicesManager,
    context?.readOnly,
    context?.preview,
    fields.length,
    refreshViewerMeasurementBindings,
  ]);

  const captureViewerAnnotations = useCallback(async () => {
    if (!commandsManager) return savedAnnotations;

    try {
      const serialized = await commandsManager.runCommand(
        'getSerializedViewerMeasurements',
        {
          domain: cleanString(context?.readSchema?.domain) || 'generic',
          workflow: VIEWER_MEASUREMENTS_WORKFLOW,
        }
      );

      return mergeMeasurementAnnotations(
        savedAnnotations,
        Array.isArray(serialized?.annotations) ? serialized.annotations : []
      );
    } catch (captureError) {
      console.warn(
        '[AR Research] viewer measurement capture failed; preserving saved annotations',
        captureError
      );
      return savedAnnotations;
    }
  }, [commandsManager, context?.readSchema?.domain, savedAnnotations]);

  const save = useCallback(async () => {
    if (!context?.reviewKey || context?.readOnly || context?.preview) {
      return context?.review || null;
    }

    setSaving(true);
    setError('');

    try {
      const measurementAnnotations = await captureViewerAnnotations();
      // Recompute against the exact annotations being persisted. Otherwise a
      // fresh toolbar measurement can race the React event/state update and
      // save as an unlinked viewer annotation with an empty numeric field.
      const latestCandidates = buildViewerMeasurementValueCandidates(measurementAnnotations);
      const freshUpdates = fields.flatMap(field =>
        buildViewerMeasurementReadUpdates(
          [field],
          getResearchProtocolCompatibleCandidates(field, latestCandidates, measurementAnnotations),
          valueSourcesRef.current
        )
      );
      const latestValues = { ...values };
      const latestSources = { ...valueSourcesRef.current };
      for (const update of freshUpdates) {
        latestValues[update.fieldKey] = update.value;
        latestSources[update.fieldKey] = {
          source: update.source,
          sourceMeasurementKey: update.sourceMeasurementKey,
        };
      }
      // Fixed-frame protocols must not accept a manually entered value or
      // an annotation captured from a different DICOM frame as verified.
      // The UI and the persisted source evidence must agree.
      for (const field of fields) {
        const targets = getResearchProtocolViewerTargets(field);
        const mustUseFrames = field?.config?.compositeFrameGuidanceEnabled === true;
        if (!targets.length && !mustUseFrames) continue;
        const value = latestValues[field.key];
        if (value === '' || value === null || value === undefined) continue;
        const source = latestSources[field.key] || {};
        const match = getResearchFieldMeasurementCandidates(field, latestCandidates)
          .find(candidate => candidate.sourceMeasurementKey === source.sourceMeasurementKey);
        if (!match || !isResearchCandidateOnProtocolFrames(field, match, measurementAnnotations)) {
          throw new Error(field.label + ': the value does not have verified evidence on the protocol-configured DICOM source frame.');
        }
      }
      const latestReadState = buildCalculatedReadState(
        fields, latestValues, latestSources, latestCandidates
      );
      const readResults = {
        schemaKey: cleanString(context?.readSchema?.schemaKey),
        schemaVersion: cleanString(context?.readSchema?.schemaVersion),
        entries: buildReadResultEntries(
          fields,
          latestReadState.values,
          latestReadState.sources
        ),
      };
      const saved = await saveResearchReadReview({
        reviewKey: context.reviewKey,
        readResults,
        measurementAnnotations,
      });

      setContext(current => ({
        ...current,
        review: saved,
        readOnly: cleanString(saved?.status).toLowerCase() === 'completed',
      }));
      const savedReadState = buildReadValueState(
        saved?.readResults || readResults
      );

      setValues(savedReadState.values);
      valueSourcesRef.current = savedReadState.sources;
      setValueSources(savedReadState.sources);
      setSavedAnnotations(
        Array.isArray(saved?.measurementAnnotations)
          ? saved.measurementAnnotations
          : measurementAnnotations
      );
      notify(
        servicesManager,
        `Research Read saved (${readResults.entries.length} structured result${
          readResults.entries.length === 1 ? '' : 's'
        }).`
      );
      return saved;
    } catch (saveError) {
      console.error('[AR Research] save failed', saveError);
      const message = saveError?.message || 'Unable to save the Research Read.';
      setError(message);
      notify(servicesManager, message, 'error');
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, [
    captureViewerAnnotations,
    context,
    fields,
    servicesManager,
    calculatedReadState,
    values,
  ]);

  const complete = useCallback(async () => {
    if (
      !context?.reviewKey ||
      context?.readOnly ||
      context?.preview ||
      saving ||
      completing
    ) {
      return;
    }

    if (missingRequired.length) {
      setError(
        `Complete the ${missingRequired.length} required field${
          missingRequired.length === 1 ? '' : 's'
        } before completing the read.`
      );
      return;
    }

    if (
      !window.confirm(
        'Complete this Research Review? Once completed, it will become read-only.'
      )
    ) {
      return;
    }

    setCompleting(true);
    setError('');

    try {
      await save();
      const completed = await completeResearchReadReview(context.reviewKey);
      setContext(current => ({
        ...current,
        review: completed,
        readOnly: true,
      }));
      notify(servicesManager, 'Research Review completed and locked.');
    } catch (completeError) {
      console.error('[AR Research] completion failed', completeError);
      const message =
        completeError?.message || 'Unable to complete the Research Review.';
      setError(message);
      notify(servicesManager, message, 'error');
    } finally {
      setCompleting(false);
    }
  }, [
    completing,
    context,
    missingRequired.length,
    save,
    saving,
    servicesManager,
  ]);

  const jumpToAnnotation = useCallback(
    async annotation => {
      try {
        const result = await commandsManager.runCommand('jumpToSavedViewerAnnotation', {
          annotation,
          selectAnnotation: true,
        });
        if (result?.ok !== true) {
          throw new Error(result?.reason || 'saved source navigation was unsuccessful');
        }
      } catch (jumpError) {
        console.warn('[AR Research] saved annotation navigation failed', jumpError);
        notify(
          servicesManager,
          'Unable to navigate to the saved viewer annotation.',
          'warning'
        );
      }
    },
    [commandsManager, servicesManager]
  );

  const jumpToProtocolTarget = async (target: any, fieldKey: string) => {
    if (!commandsManager) return;
    try {
      const result = await commandsManager.runCommand('jumpToViewerQuizTarget', {
        viewerTarget: target,
        questionKey: fieldKey,
      });
      if (result?.ok !== true) {
        throw new Error(result?.reason || 'protocol target navigation failed');
      }
    } catch (navigationError) {
      console.warn('[AR Research] protocol frame navigation failed', navigationError);
      notify(servicesManager, 'Unable to open the configured protocol instance/frame.', 'warning');
    }
  };

  const navigateToField = async (field: any) => {
    const targets = getResearchProtocolViewerTargets(field);
    // When a composite has multiple configured phases, let the reader pick the
    // exact A4C/A2C, ED/ES or other source: never choose the wrong phase.
    if (targets.length === 1) {
      await jumpToProtocolTarget(targets[0].viewerTarget, field.key);
      return;
    }
    if (targets.length > 1) return;
    const sourceAnnotations = getResearchFieldSourceAnnotations(
      calculatedReadState.sources[field.key], allAnnotations,
      getResearchFieldMeasurementCandidates(field, viewerCandidates || [])
    );
    if (sourceAnnotations.length === 1) {
      await jumpToAnnotation(sourceAnnotations[0]);
    }
  };

  const selectField = (key: string) => {
    const field = fields.find(item => item.key === key);
    if (!field) return;
    setSelectedFieldKey(key);
    void navigateToField(field);
  };

  const selectSourceCandidate = (field: any, candidate: any) => {
    const updates = buildViewerMeasurementReadUpdates([field], [candidate], {});
    if (!updates.length) {
      notify(servicesManager, 'Measurement unit or value is not compatible with this field.', 'warning');
      return;
    }
    const update = updates[0];
    setValues(current => ({ ...current, [field.key]: update.value }));
    setValueSources(current => {
      const next = { ...current, [field.key]: {
        source: update.source,
        sourceMeasurementKey: update.sourceMeasurementKey,
      } };
      valueSourcesRef.current = next;
      return next;
    });
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-300">Loading Research Read...</div>;
  }

  if (error && !context) {
    return (
      <div className="p-4">
        <div className="rounded border border-red-800 bg-red-950 p-3 text-sm text-red-100">
          {error}
        </div>
      </div>
    );
  }

  if (!context?.readSchema?.components?.length) {
    return (
      <div className="p-4">
        <div className="rounded border border-yellow-800 bg-yellow-950 p-3 text-sm text-yellow-100">
          This imaging profile does not have a configured Research ReadSchema.
        </div>
      </div>
    );
  }

  const title =
    cleanString(context?.study?.title) ||
    cleanString(context?.review?.studyTitle) ||
    'Research Study';
  const reviewStatus = cleanString(context?.review?.status || 'preview');
  const isBusy = saving || completing;
  const selectedField = fields.find(field => field.key === selectedFieldKey) || fields[0];
  const selectedCandidates = selectedField
    ? getResearchFieldMeasurementCandidates(selectedField, viewerCandidates || []) : [];
  const selectedSources = selectedField
    ? getResearchFieldSourceAnnotations(
        calculatedReadState.sources[selectedField.key], allAnnotations, selectedCandidates
      ) : [];
  const protocolTargets = selectedField ? getResearchProtocolViewerTargets(selectedField) : [];
  const isSelectedMeasurement = selectedField && (
    ['measurement', 'continuous'].includes(cleanString(selectedField.kind).toLowerCase()) ||
    !!selectedField?.config?.calculation
  );
  const completedFields = fields.filter(field => {
    const value = calculatedReadState.values[field.key];
    return value !== null && value !== undefined && String(value).trim() !== '';
  }).length;
  const linkedAnnotationKeys = new Set(fields.flatMap(field =>
    getResearchFieldSourceAnnotations(
      calculatedReadState.sources[field.key], allAnnotations,
      getResearchFieldMeasurementCandidates(field, viewerCandidates || [])
    ).map(getAnnotationKey)
  ));
  const unlinkedAnnotations = allAnnotations.filter(annotation =>
    !linkedAnnotationKeys.has(getAnnotationKey(annotation))
  );

  return (
    <div className="h-full overflow-auto p-3 text-white">
      <div className="mb-3 rounded border border-gray-700 bg-gray-950 p-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs text-gray-400">
          {cleanString(context?.imagingProfile?.label) ||
            cleanString(context?.imagingProfileKey) ||
            'Research imaging profile'}
          {' - '}
          {cleanString(context?.readSchema?.schemaKey)}
          {context?.readSchema?.schemaVersion
            ? ` v${context.readSchema.schemaVersion}`
            : ''}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-gray-800 px-2 py-1">
            {context.preview ? 'Protocol preview' : reviewStatus}
          </span>
          {context.readOnly ? (
            <span className="rounded bg-yellow-950 px-2 py-1 text-yellow-200">
              Read-only
            </span>
          ) : (
            <span className="rounded bg-green-950 px-2 py-1 text-green-200">
              Editable
            </span>
          )}
        </div>
      </div>

      {context.preview ? (
        <div className="mb-3 rounded border border-blue-900 bg-blue-950 p-3 text-xs text-blue-100">
          Protocol preview. Fields are shown exactly as readers will receive them;
          no Research Review will be saved.
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded border border-red-800 bg-red-950 p-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="mb-3 rounded border border-gray-700 bg-gray-950 p-3">
        <label htmlFor="research-read-field-select" className="text-xs font-semibold text-gray-200">
          Question / measurement
        </label>
        <select
          id="research-read-field-select"
          className="mt-1 w-full min-w-0 rounded border border-gray-600 bg-gray-900 px-2 py-2 text-sm text-white"
          value={selectedField?.key || ''}
          onChange={event => selectField(event.target.value)}
          disabled={isBusy}
        >
          {fields.map((field, index) => {
            const value = calculatedReadState.values[field.key];
            const answered = value !== undefined && value !== null && String(value).trim() !== '';
            return <option key={field.key} value={field.key}>
              {index + 1}. {answered ? '✓ ' : ''}{field.label}{field.required ? ' (required)' : ''}
            </option>;
          })}
        </select>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400">{completedFields}/{fields.length} fields entered</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 disabled:opacity-40"
              disabled={isBusy || fields.indexOf(selectedField) <= 0}
              onClick={() => selectField(fields[fields.indexOf(selectedField) - 1].key)}
            >Previous</button>
            <button
              type="button"
              className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 disabled:opacity-40"
              disabled={isBusy || fields.indexOf(selectedField) >= fields.length - 1}
              onClick={() => selectField(fields[fields.indexOf(selectedField) + 1].key)}
            >Next</button>
          </div>
        </div>
      </div>

      {selectedField ? (
        <div className="space-y-2">
          <ReadField
            key={selectedField.key}
            field={selectedField}
            value={calculatedReadState.values[selectedField.key] ?? ''}
            source={calculatedReadState.sources[selectedField.key]}
            disabled={context.readOnly || context.preview || isBusy}
            onChange={nextValue => updateValue(selectedField.key, nextValue)}
          />
          {(isSelectedMeasurement || protocolTargets.length > 0) ? (
            <div className="rounded border border-gray-700 bg-gray-950 p-3 text-xs">
              <div className="font-semibold text-gray-100">Viewer measurement and source frames</div>
              {protocolTargets.length ? (
                <div className="mt-2 space-y-1">
                  <div className="text-gray-400">Protocol-selected instance/frame</div>
                  {protocolTargets.map(({ label, viewerTarget }) => (
                    <button
                      key={label}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded border border-blue-800 px-2 py-2 text-left text-blue-200 hover:bg-blue-950/40 disabled:opacity-50"
                      disabled={!commandsManager}
                      onClick={() => void jumpToProtocolTarget(viewerTarget, selectedField.key)}
                    >
                      <span>{label}</span>
                      <span>Open frame {viewerTarget.frameNumber}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedSources.length ? (
                <div className="mt-2 space-y-1">
                  <div className="text-gray-400">Captured measurement sources — select to inspect</div>
                  {selectedSources.map(annotation => (
                    <button
                      key={getAnnotationKey(annotation)}
                      type="button"
                      className="flex w-full min-w-0 items-center justify-between gap-2 rounded border border-gray-700 bg-black p-2 text-left hover:border-blue-500 disabled:opacity-50"
                      disabled={!commandsManager}
                      onClick={() => void jumpToAnnotation(annotation)}
                    >
                      <span className="min-w-0 break-words text-gray-200">
                        {getAnnotationLabel(annotation)}
                        {getAnnotationValue(annotation) ? ' · ' + getAnnotationValue(annotation) : ''}
                      </span>
                      <span className="shrink-0 text-blue-300">View source</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {isSelectedMeasurement && selectedCandidates.length > 1 && !context.preview && !context.readOnly ? (
                <div className="mt-2 space-y-1">
                  <div className="text-amber-200">
                    Multiple matching measurements. Choose the intended source rather than automatically accepting another frame.
                  </div>
                  {selectedCandidates.map((candidate, index) => (
                    <button
                      key={candidate.sourceMeasurementKey || index}
                      type="button"
                      className="block w-full rounded border border-blue-800 px-2 py-2 text-left text-blue-100 hover:bg-blue-950/40"
                      onClick={() => selectSourceCandidate(selectedField, candidate)}
                    >
                      Use {Number(candidate.value).toFixed(2)} {candidate.unit}
                      {' · '}{candidate.sourceMeasurementKey}
                    </button>
                  ))}
                </div>
              ) : null}
              {isSelectedMeasurement && !selectedSources.length && !protocolTargets.length ? (
                <div className="mt-2 text-gray-400">
                  {selectedCandidates.length
                    ? 'A compatible value is available. Its source frame will appear when the annotation is ready.'
                    : 'Choose the appropriate image and frame in the viewer, then use the measurement toolbar. The calibrated value will populate here automatically.'}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!context.preview && unlinkedAnnotations.length ? (
        <details className="mt-3 rounded border border-gray-700 bg-gray-950 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-gray-300">
            Other viewer annotations ({unlinkedAnnotations.length})
          </summary>
          <div className="mt-2 space-y-1">
            {unlinkedAnnotations.slice(0, 12).map((annotation, index) => (
              <button
                key={getAnnotationKey(annotation) || index}
                type="button"
                className="block w-full rounded border border-gray-700 bg-black px-2 py-2 text-left text-xs hover:border-blue-700"
                onClick={() => void jumpToAnnotation(annotation)}
                disabled={!commandsManager}
              >
                {getAnnotationLabel(annotation)}
                {getAnnotationValue(annotation) ? ' · ' + getAnnotationValue(annotation) : ''}
              </button>
            ))}
          </div>
        </details>
      ) : null}

      {!context.preview && !context.readOnly ? (
        <div className="sticky bottom-0 mt-4 border-t border-gray-700 bg-black/95 pt-3">
          {missingRequired.length ? (
            <div className="mb-2 text-xs text-yellow-300">
              {missingRequired.length} required field
              {missingRequired.length === 1 ? '' : 's'} remaining.
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded border border-blue-600 px-3 py-2 text-sm font-semibold text-blue-100 disabled:opacity-50"
              disabled={isBusy}
              onClick={() => void save()}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isBusy || missingRequired.length > 0}
              onClick={() => void complete()}
            >
              {completing ? 'Completing...' : 'Complete Read'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
