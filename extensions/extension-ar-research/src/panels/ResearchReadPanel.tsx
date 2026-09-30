import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { buildViewerMeasurementValueCandidates } from 'extension-ar-measurements';
import {
  buildReadFields,
  buildReadResultEntries,
  buildReadValueState,
  buildViewerMeasurementReadUpdates,
  getMissingRequiredReadFields,
} from '../utils/readSchema';
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
  disabled,
  onChange,
}: {
  field: any;
  value: any;
  disabled: boolean;
  onChange: (value: any) => void;
}) {
  const kind = cleanString(field.kind).toLowerCase();
  const numeric = ['measurement', 'continuous', 'number', 'numeric'].includes(kind);
  const text = ['text', 'comment', 'textarea'].includes(kind);
  const options = Array.isArray(field?.config?.options) ? field.config.options : [];
  const unit = cleanString(field?.config?.unit);

  return (
    <div className="rounded border border-gray-700 bg-gray-950 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{field.label}</div>
          <div className="mt-0.5 text-xs text-gray-400">
            {field.required ? 'Required' : 'Optional'}
            {unit ? ` - ${unit}` : ''}
          </div>
        </div>
        {field.required ? (
          <span className="rounded bg-blue-950 px-2 py-0.5 text-[11px] text-blue-200">
            Required
          </span>
        ) : null}
      </div>

      {options.length > 0 ? (
        <select
          className="w-full rounded border border-gray-600 bg-black px-3 py-2 text-sm text-white"
          value={value ?? ''}
          disabled={disabled}
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
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          placeholder="Enter reader comment"
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-gray-600 bg-black px-3 py-2 text-sm text-white"
            type={numeric ? 'number' : 'text'}
            value={value ?? ''}
            disabled={disabled}
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
  const valueSourcesRef = useRef<Record<string, any>>({});
  const [savedAnnotations, setSavedAnnotations] = useState<any[]>([]);
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
      setSavedAnnotations(
        Array.isArray(next?.review?.measurementAnnotations)
          ? next.review.measurementAnnotations
          : []
      );
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
  const missingRequired = useMemo(
    () => getMissingRequiredReadFields(fields, values),
    [fields, values]
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

      const candidates = buildViewerMeasurementValueCandidates(
        Array.isArray(serialized?.annotations)
          ? serialized.annotations
          : []
      );

      const updates = buildViewerMeasurementReadUpdates(
        fields,
        candidates,
        valueSourcesRef.current
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
      const readResults = {
        schemaKey: cleanString(context?.readSchema?.schemaKey),
        schemaVersion: cleanString(context?.readSchema?.schemaVersion),
        entries: buildReadResultEntries(
          fields,
          values,
          valueSources
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
    values,
    valueSources,
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
        await commandsManager.runCommand('jumpToSavedViewerAnnotation', {
          annotation,
          selectAnnotation: true,
        });
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

      <div className="space-y-3">
        {fields.map(field => (
          <ReadField
            key={field.key}
            field={field}
            value={values[field.key]}
            disabled={context.readOnly || context.preview || isBusy}
            onChange={nextValue => updateValue(field.key, nextValue)}
          />
        ))}
      </div>

      {!context.preview ? (
        <div className="mt-4 rounded border border-gray-700 bg-gray-950 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Viewer annotations</div>
              <div className="text-xs text-gray-400">
                Saved per reader with this Research Review
              </div>
            </div>
            <span className="rounded bg-gray-800 px-2 py-1 text-xs">
              {savedAnnotations.length}
            </span>
          </div>

          {savedAnnotations.length ? (
            <div className="mt-2 space-y-1">
              {savedAnnotations.slice(0, 12).map((annotation, index) => (
                <button
                  key={getAnnotationKey(annotation) || index}
                  type="button"
                  className="block w-full rounded border border-gray-800 bg-black px-2 py-2 text-left text-xs hover:border-blue-700 disabled:opacity-50"
                  disabled={!commandsManager}
                  onClick={() => jumpToAnnotation(annotation)}
                >
                  <span className="font-semibold">
                    {getAnnotationLabel(annotation)}
                  </span>
                  {getAnnotationValue(annotation) ? (
                    <span className="ml-2 text-gray-400">
                      {getAnnotationValue(annotation)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-gray-500">
              Viewer measurements created during this read are captured when you
              save the Research Read.
            </div>
          )}
        </div>
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
