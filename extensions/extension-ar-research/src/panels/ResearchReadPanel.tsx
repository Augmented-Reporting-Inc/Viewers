import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import { EchoEFContourVolumes, getLVSimpsonSourceVolumes } from '../../../extension-ar-measurements/src/components/EchoEFContourVolumes';
import { EchoCompositeResultStatus } from '../../../extension-ar-measurements/src/components/EchoCompositeResultStatus';
import { SharedQuestionSelector, SharedQuestionStepNavigation } from '../../../extension-ar-measurements/src/components/SharedQuestionNavigation';
import { SharedMeasurementValueInput } from '../../../extension-ar-measurements/src/components/SharedMeasurementValueInput';
import LearningQuestionPanel from '../../../extension-ar-learning/src/panels/LearningQuestionPanel';
import { LearningSingleChoiceAnswer } from '../../../extension-ar-learning/src/components/LearningSingleChoiceAnswer';
import ResearchEchoGuidedControls from './ResearchEchoGuidedControls';
import { reconcileResearchEchoCompositeAnswers } from '../utils/researchEchoAnswerBinding';
import { getResearchMeasurementToolForField } from '../utils/researchMeasurementTool';
import {
  getResearchFramePickerIntent,
  getResearchCapturedFrameTarget,
  RESEARCH_FRAME_CAPTURE_MESSAGE,
} from '../utils/researchFramePicker';
import {
  getResearchRapChoices,
  getResearchGroupedFields,
  getResearchQuestionLabel,
  isResearchQuestionAnswered,
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
  getResearchSourceAnnotationIds,
  getResearchCompatibleMeasurementCandidates,
  getResearchIVCMeasurementState,
  getResearchQuestionEntryTarget,
  getResearchIVCAnnotationSlot,
  isValidResearchIVCPhaseSource,
  getResearchBindingSources,
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

function mergeMeasurementAnnotations(
  saved: any[] = [], live: any[] = [],
  deletedIds: Set<string> = new Set()
) {
  const merged = new Map<string, any>();

  for (const annotation of [...(saved || []), ...(live || [])]) {
    const key = getAnnotationKey(annotation);
    if (key && !deletedIds.has(key)) {
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
  onDelete,
  readDomain,
  hideHeader = false,
}: {
  field: any;
  value: any;
  source?: any;
  disabled: boolean;
  onChange: (value: any) => void;
  onDelete?: () => void;
  readDomain?: string;
  hideHeader?: boolean;
}) {
  const kind = cleanString(field.kind).toLowerCase();
  const numeric = ['measurement', 'continuous', 'number', 'numeric'].includes(kind);
  const text = ['text', 'comment', 'textarea'].includes(kind);
  const unit = cleanString(field?.config?.unit);
  const configuredOptions = Array.isArray(field?.config?.options) ? field.config.options : [];
  const options = configuredOptions.length
    ? configuredOptions.map(option => ({
        ...option,
        label: field.componentKey === 'rap' && unit.toLowerCase() === 'mmhg' &&
          !String(option.label || '').toLowerCase().includes('mmhg')
          ? String(option.label || option.value) + ' mmHg'
          : option.label,
      }))
    : getResearchRapChoices(field, readDomain).map(value => ({ value, label: value + ' mmHg' }));
  const calculated = cleanString(field?.config?.calculation?.type).toLowerCase() === 'rvsp';

  return (
    <div className="rounded border border-gray-700 bg-gray-950 p-3">
      {!hideHeader ? (
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
      ) : null}

      {['viewer-measurement', 'viewer-derived'].includes(cleanString(source?.source)) ? (
        <div className="mb-2 text-xs text-blue-300">
          {source.source === 'viewer-derived' ? 'Calculated from viewer evidence' : 'Linked to viewer measurement'}
        </div>
      ) : null}

      {options.length > 0 && field.componentKey !== 'rap' ? (
        <LearningSingleChoiceAnswer
          name={field.key}
          choices={options}
          value={value}
          disabled={disabled || calculated}
          onChange={onChange}
        />
      ) : options.length > 0 ? (
        // RAP is a clinical numeric interpretation; Learning also uses
        // a dropdown for RAP. Never infer it from IVC automatically.
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
      ) : numeric ? (
        <SharedMeasurementValueInput
          value={value}
          onChange={onChange}
          unit={unit}
          disabled={disabled || calculated}
          min={field?.config?.min}
          max={field?.config?.max}
          step={field?.config?.step || 'any'}
          onDelete={!disabled && !calculated &&
            value !== null && value !== undefined && String(value).trim() !== ''
              ? onDelete : undefined}
          deleteLabel={`Delete ${field.label} measurement`}
        />
      ) : (
        <input
          className="w-full min-w-0 rounded border border-gray-600 bg-black px-3 py-2 text-sm text-white"
          type="text"
          value={value ?? ''}
          disabled={disabled || calculated}
          onChange={event => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export default function ResearchReadPanel({ servicesManager, commandsManager }) {
  const [context, setContext] = useState<any>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [valueSources, setValueSources] = useState<Record<string, any>>({});
  const [viewerCandidates, setViewerCandidates] = useState<any[] | null>(null);
  const [liveVerifiedEchoEvidence, setLiveVerifiedEchoEvidence] = useState<{
    candidates: any[]; efVolumes: Record<string, number | null>;
  }>({ candidates: [], efVolumes: {} });
  const valueSourcesRef = useRef<Record<string, any>>({});
  const [savedAnnotations, setSavedAnnotations] = useState<any[]>([]);
  const [liveAnnotations, setLiveAnnotations] = useState<any[]>([]);
  // Explicit research-source deletion is carried through Save even if
  // legacy clinical Series hydration is unavailable for this research case.
  const deletedAnnotationIdsRef = useRef<Set<string>>(new Set());
  // Redraw is transactional in the local draft: retain the old source until
  // a NEW calibrated, correctly labelled annotation lands on the pinned SOP/
  // frame. Closing the viewer without completing does not delete old evidence.
  const pendingIVCReplacementRef = useRef<null | {
    slot: string; fieldKey: string; priorIds: string[];
  }>(null);
  const [selectedFieldKey, setSelectedFieldKey] = useState('');
  const [capturingProtocolFrame, setCapturingProtocolFrame] = useState(false);
  const [capturedProtocolFrame, setCapturedProtocolFrame] = useState('');
  const protocolFramePickerIntent = useMemo(
    () => getResearchFramePickerIntent(
      typeof window !== 'undefined' ? window.location.search : '',
      typeof window !== 'undefined' ? window.location.hash : ''
    ),
    []
  );
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
      deletedAnnotationIdsRef.current = new Set();
      pendingIVCReplacementRef.current = null;
      setLiveAnnotations([]);
      setLiveVerifiedEchoEvidence({ candidates: [], efVolumes: {} });
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
  const readDomain = cleanString(context?.readSchema?.domain).toLowerCase();
  const visibleFields = useMemo(
    () => fields.filter(field => !isResearchCompanionHidden(field, fields, readDomain)),
    [fields, readDomain]
  );
  useEffect(() => {
    if (!visibleFields.length) return;
    setSelectedFieldKey(current =>
      visibleFields.some(field => field.key === current) ? current :
      (visibleFields.find(field => field.required)?.key || visibleFields[0].key)
    );
  }, [visibleFields]);

  useEffect(() => {
    if (!protocolFramePickerIntent || !visibleFields.length) return;
    const target = visibleFields.find(field =>
      field.componentKey === protocolFramePickerIntent.componentKey
    );
    if (target) setSelectedFieldKey(target.key);
  }, [protocolFramePickerIntent, visibleFields]);

  const allAnnotations = useMemo(
    () => mergeMeasurementAnnotations(
      savedAnnotations, liveAnnotations, deletedAnnotationIdsRef.current
    ),
    [savedAnnotations, liveAnnotations]
  );

  const calculatedReadState = useMemo(() => {
    if (context?.readOnly || context?.preview) {
      return { values, sources: valueSources };
    }
    // All guided Echo composites now reconcile from the same verified
    // source-annotation snapshot. Education and Research share the calculation
    // engines; Research retains its own ReadSchema values and ownership.
    const reconciled = reconcileResearchEchoCompositeAnswers(
      fields, values, valueSources, allAnnotations,
      liveVerifiedEchoEvidence.candidates
    );
    return buildCalculatedReadState(
      fields, reconciled.values, reconciled.sources, viewerCandidates
    );
  }, [context?.readOnly, context?.preview, fields, values, valueSources,
      viewerCandidates, allAnnotations, liveVerifiedEchoEvidence.candidates]);
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
          includeResearchEchoContours: true,
        }
      );

      const snapshot = (Array.isArray(serialized?.annotations)
        ? serialized.annotations : []).filter(annotation =>
        !deletedAnnotationIdsRef.current.has(getAnnotationKey(annotation))
      );
      setLiveAnnotations(snapshot);
      // A Research Review owns its persisted annotations. Unlike clinical
      // reports, this shared Research study need not have an AR Series doc.
      // Rebind from this review's saved evidence as well as current live work.
      // Source selection must use the same tombstone-filtered snapshot as
      // candidate creation; otherwise a replaced IVC phase is still counted
      // twice until the next React render.
      const available = mergeMeasurementAnnotations(
        savedAnnotations, snapshot, deletedAnnotationIdsRef.current
      );
      const evidence = serialized?.researchEchoEvidence || {};
      const liveVerified = (Array.isArray(evidence.candidates)
        ? evidence.candidates : []).filter(candidate =>
        getResearchSourceAnnotationIds(candidate?.sourceMeasurementKey).every(id =>
          available.some(item => getAnnotationKey(item) === id)
        )
      );
      setLiveVerifiedEchoEvidence({
        candidates: liveVerified,
        efVolumes: evidence.efVolumes || {},
      });
      const candidates = [
        ...buildViewerMeasurementValueCandidates(available),
        ...liveVerified,
      ];
      setViewerCandidates(candidates);
      const updates = fields.flatMap(field => {
        const compatible = getResearchCompatibleMeasurementCandidates(
          field, candidates, available
        );
        return buildViewerMeasurementReadUpdates(
          [field], compatible,
          getResearchBindingSources(field, valueSourcesRef.current, compatible)
        );
      });

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

  const removeResearchSourceIds = useCallback(async (ids: string[]) => {
    const unique = Array.from(new Set(ids.map(cleanString).filter(Boolean)));
    if (!unique.length) return;
    const removed = new Set(unique);
    // Tombstone first. A subsequent MeasurementService update or snapshot must
    // never resurrect superseded evidence before the Research Read is saved.
    unique.forEach(id => deletedAnnotationIdsRef.current.add(id));
    setSavedAnnotations(current =>
      current.filter(item => !removed.has(getAnnotationKey(item)))
    );
    setLiveAnnotations(current =>
      current.filter(item => !removed.has(getAnnotationKey(item)))
    );
    setViewerCandidates(current => (current || []).filter(candidate =>
      !getResearchSourceAnnotationIds(candidate?.sourceMeasurementKey)
        .some(id => removed.has(id))
    ));
    setLiveVerifiedEchoEvidence(current => ({
      candidates: current.candidates.filter(candidate =>
        !getResearchSourceAnnotationIds(candidate?.sourceMeasurementKey)
          .some(id => removed.has(id))
      ),
      // Clear live slot readouts until the post-deletion snapshot is verified.
      efVolumes: {},
    }));
    const affected = new Set(Object.entries(valueSourcesRef.current)
      .filter(([, source]) =>
        getResearchSourceAnnotationIds(source?.sourceMeasurementKey)
          .some(id => removed.has(id))
      )
      .map(([key]) => key));
    setValueSources(current => {
      const next = { ...current };
      affected.forEach(key => delete next[key]);
      valueSourcesRef.current = next;
      return next;
    });
    setValues(current => {
      const next = { ...current };
      affected.forEach(key => delete next[key]);
      return next;
    });
    for (const id of unique) {
      try {
        await commandsManager?.runCommand('removeMeasurement', { uid: id });
      } catch (removeError) {
        // The tombstone still prevents the old evidence from being persisted.
        // A viewer restart will rehydrate only the saved Research annotations.
        console.warn('[AR Research] could not remove old on-screen measurement', removeError);
      }
    }
  }, [commandsManager]);

  const beginIVCPhaseRedraw = useCallback(
    (field: any, slot: string, existingSources: any[] = []) => {
      const priorIds = existingSources.map(getAnnotationKey).filter(Boolean);
      pendingIVCReplacementRef.current = priorIds.length
        ? { slot, fieldKey: field.key, priorIds } : null;
    }, []
  );

  const completeIVCPhaseRedraw = useCallback(async (measurementId: string) => {
    const pending = pendingIVCReplacementRef.current;
    const id = cleanString(measurementId);
    if (!pending || !pending.priorIds.length || !id ||
        pending.priorIds.includes(id) || !commandsManager) return;
    const field = fields.find(item => item.key === pending.fieldKey &&
      item.componentKey === 'ivcCollapsibility');
    if (!field) return;
    try {
      const snapshot = await commandsManager.runCommand(
        'getSerializedViewerMeasurements',
        { domain: 'echo', workflow: VIEWER_MEASUREMENTS_WORKFLOW }
      );
      const newAnnotation = (snapshot?.annotations || []).find(
        item => getAnnotationKey(item) === id
      );
      // A user might select another label or draw on another frame. Never
      // discard a previous measurement until its replacement is validated.
      if (!isValidResearchIVCPhaseSource(field, pending.slot, newAnnotation)) {
        notify(servicesManager,
          'The new IVC measurement was not calibrated on the configured phase frame. The previous source is preserved.',
          'warning');
        return;
      }
      // Only the most recently armed redraw may consume the old sources.
      if (pendingIVCReplacementRef.current !== pending) return;
      pendingIVCReplacementRef.current = null;
      await removeResearchSourceIds(pending.priorIds);
      notify(servicesManager,
        'IVC source replaced. Save the Research Read to persist the change.');
      void refreshViewerMeasurementBindings();
    } catch (error) {
      console.warn('[AR Research] could not complete IVC redraw', error);
      notify(servicesManager,
        'Could not verify the replacement IVC source. The previous measurement was preserved.',
        'warning');
    }
  }, [commandsManager, fields, removeResearchSourceIds, servicesManager,
      refreshViewerMeasurementBindings]);

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
      'ar-measurements:saved-annotations-updated',
    ];
    const labelled = (event: Event) => {
      const measurementId = cleanString((event as CustomEvent)?.detail?.measurementId);
      if (measurementId) void completeIVCPhaseRedraw(measurementId);
      refresh();
    };
    windowEvents.forEach(eventName =>
      window.addEventListener(eventName, refresh)
    );
    // Keep the old source until the newly labelled Length has been verified
    // on the exact target frame. Never tombstone it just on button click.
    window.addEventListener('ar-learning:quiz-measurement-labelled', labelled);

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
      window.removeEventListener('ar-learning:quiz-measurement-labelled', labelled);
    };
  }, [
    servicesManager,
    context?.readOnly,
    context?.preview,
    fields.length,
    refreshViewerMeasurementBindings,
    completeIVCPhaseRedraw,
  ]);

  const captureViewerAnnotations = useCallback(async () => {
    if (!commandsManager) throw new Error('Viewer measurement service unavailable');

    try {
      const serialized = await commandsManager.runCommand(
        'getSerializedViewerMeasurements',
        {
          domain: cleanString(context?.readSchema?.domain) || 'generic',
          workflow: VIEWER_MEASUREMENTS_WORKFLOW,
          includeResearchEchoContours: true,
        }
      );
      if (!Array.isArray(serialized?.annotations)) {
        throw new Error('Viewer measurement snapshot is unavailable');
      }

      return {
        annotations: mergeMeasurementAnnotations(
          savedAnnotations,
          Array.isArray(serialized?.annotations) ? serialized.annotations : [],
          deletedAnnotationIdsRef.current
        ),
        verifiedCandidates: Array.isArray(serialized?.researchEchoEvidence?.candidates)
          ? serialized.researchEchoEvidence.candidates : [],
      };
    } catch (captureError) {
      console.warn(
        '[AR Research] viewer measurement capture failed; preserving saved annotations',
        captureError
      );
      throw new Error('Could not capture current viewer annotations. Research Read was not saved.');
    }
  }, [commandsManager, context?.readSchema?.domain, savedAnnotations]);

  const save = useCallback(async () => {
    if (!context?.reviewKey || context?.readOnly || context?.preview) {
      return context?.review || null;
    }

    setSaving(true);
    setError('');

    try {
      const captured = await captureViewerAnnotations();
      const measurementAnnotations = captured.annotations;
      // Recompute against the exact annotations being persisted. Otherwise a
      // fresh toolbar measurement can race the React event/state update and
      // save as an unlinked viewer annotation with an empty numeric field.
      const validCapturedIds = new Set(measurementAnnotations.map(getAnnotationKey));
      const freshVerified = captured.verifiedCandidates.filter(candidate =>
        getResearchSourceAnnotationIds(candidate?.sourceMeasurementKey).every(id =>
          validCapturedIds.has(id)
        )
      );
      const latestCandidates = [
        ...buildViewerMeasurementValueCandidates(measurementAnnotations),
        ...freshVerified,
      ];
      const freshUpdates = fields.flatMap(field => {
        const compatible = getResearchCompatibleMeasurementCandidates(
          field, latestCandidates, measurementAnnotations
        );
        return buildViewerMeasurementReadUpdates(
          [field], compatible,
          getResearchBindingSources(field, valueSourcesRef.current, compatible)
        );
      });
      // Save must use the same verified derived values shown in the question,
      // even if the last MeasurementService event has not yet been delivered.
      const reconciled = reconcileResearchEchoCompositeAnswers(
        fields, values, valueSourcesRef.current, measurementAnnotations,
        freshVerified
      );
      const latestValues = { ...reconciled.values };
      const latestSources = { ...reconciled.sources };
      for (const update of freshUpdates) {
        latestValues[update.fieldKey] = update.value;
        latestSources[update.fieldKey] = {
          source: update.source,
          sourceMeasurementKey: update.sourceMeasurementKey,
        };
      }
      const ivcField = fields.find(field =>
        field.componentKey === 'ivcCollapsibility'
      );
      if (ivcField && getResearchProtocolViewerTargets(ivcField).length) {
        const state = getResearchIVCMeasurementState(
          ivcField, measurementAnnotations
        );
        if (state.phaseSources?.IVC_EXP?.length > 1 ||
            state.phaseSources?.IVC_INSP?.length > 1) {
          throw new Error(
            'Multiple IVC measurements exist for the same protocol phase. ' +
            'Use the phase View/Delete controls to resolve duplicates before saving.'
          );
        }
        // A partially redrawn IVC question is an incomplete draft, not a
        // valid old percentage. Keep annotations and allow draft Save.
        if (!state.candidate) {
          delete latestValues[ivcField.key];
          delete latestSources[ivcField.key];
        }
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
        const match = getResearchCompatibleMeasurementCandidates(
          field, latestCandidates, measurementAnnotations
        ).find(candidate => candidate.sourceMeasurementKey === source.sourceMeasurementKey);
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
      deletedAnnotationIdsRef.current = new Set();
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
          pauseCineOnSource: true,
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

  const deleteResearchAnnotation = async (annotation: any) => {
    if (context?.readOnly || context?.preview || saving || completing) return;
    const id = getAnnotationKey(annotation);
    if (!id || !window.confirm('Delete this research measurement source? Save the Read to persist the deletion.')) return;
    try {
      pendingIVCReplacementRef.current = null;
      await removeResearchSourceIds([id]);
      notify(servicesManager, 'Research source deleted. Save the Read to persist the change.');
    } catch (removeError) {
      console.warn('[AR Research] source deletion failed', removeError);
      notify(servicesManager, 'Unable to delete this research source.', 'warning');
    }
  };

  const captureCurrentProtocolFrame = async () => {
    if (!context?.preview || !protocolFramePickerIntent ||
        capturingProtocolFrame || !commandsManager) return;
    if (!window.opener || window.opener.closed) {
      notify(servicesManager,
        'The Research Manager window is unavailable. Reopen the frame picker from the manager.',
        'warning');
      return;
    }
    setCapturingProtocolFrame(true);
    setCapturedProtocolFrame('');
    try {
      // EXACTLY the Education authoring frame command: it captures active
      // OHIF viewport study/series/SOP/frame, not a display-text guess.
      const response = await commandsManager.runCommand('getCurrentViewerQuizFrameAnswer', {});
      const target = getResearchCapturedFrameTarget(response, protocolFramePickerIntent);
      window.opener.postMessage({
        type: RESEARCH_FRAME_CAPTURE_MESSAGE,
        session: protocolFramePickerIntent.session,
        studyInstanceUID: protocolFramePickerIntent.studyInstanceUID,
        componentKey: protocolFramePickerIntent.componentKey,
        phaseKey: protocolFramePickerIntent.phaseKey,
        target,
      }, protocolFramePickerIntent.parentOrigin);
      setCapturedProtocolFrame(
        'Captured frame ' + target.frameNumber +
        ' for ' + protocolFramePickerIntent.componentKey +
        (protocolFramePickerIntent.phaseKey
          ? ' / ' + protocolFramePickerIntent.phaseKey : '') +
        '. Return to Research Manager and click Save.'
      );
      notify(servicesManager, 'Frame sent to Research Manager. Save the protocol there.');
    } catch (captureError) {
      console.warn('[AR Research] unable to capture authoring frame', captureError);
      notify(servicesManager,
        captureError?.message || 'Unable to capture the active DICOM frame.',
        'warning');
    } finally {
      setCapturingProtocolFrame(false);
    }
  };

  const jumpToProtocolTarget = async (target: any, fieldKey: string) => {
    if (!commandsManager) return;
    try {
      const result = await commandsManager.runCommand('jumpToViewerQuizTarget', {
        viewerTarget: target,
        questionKey: fieldKey,
        requireExactSopFrame: true,
        pauseCineOnTarget: true,
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
    const initialTarget = getResearchQuestionEntryTarget(field);
    // Research IVC starts at the explicit expiration frame, as Education
    // does; other multi-phase questions still require an explicit choice.
    if (initialTarget) {
      await jumpToProtocolTarget(initialTarget, field.key);
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

  const latestSelectionRef = useRef('');
  const selectField = (key: string) => {
    const field = fields.find(item => item.key === key);
    if (!field) return;
    // Leaving an unfinished redraw abandons the pending replacement, not the
    // old source. No annotation is removed until a new one has been verified.
    pendingIVCReplacementRef.current = null;
    latestSelectionRef.current = key;
    setSelectedFieldKey(key);
    void (async () => {
      await navigateToField(field);
      if (latestSelectionRef.current !== key ||
          context?.readOnly || context?.preview || saving || completing) return;
      const toolName = getResearchMeasurementToolForField(field, readDomain);
      if (toolName) {
        await commandsManager?.runCommand('activateViewerMeasurementTool', {
          toolName, stopCine: true,
        });
      }
    })().catch(error => {
      console.warn('[AR Research] could not activate configured measurement tool', error);
      notify(servicesManager, 'Unable to activate the selected measurement tool.', 'warning');
    });
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
  const selectedField = visibleFields.find(field => field.key === selectedFieldKey) ||
    visibleFields[0];
  const groupedFields = getResearchGroupedFields(selectedField, fields, readDomain);
  const isIVCRapRVSPQuestion = readDomain === 'echo' &&
    selectedField?.componentKey === 'ivcCollapsibility' &&
    groupedFields.some(item => ['rap', 'rvsp'].includes(item.componentKey));
  const selectedCandidates = selectedField
    ? getResearchCompatibleMeasurementCandidates(
        selectedField, viewerCandidates || [], allAnnotations
      ) : [];
  const selectedSources = selectedField
    ? getResearchFieldSourceAnnotations(
        calculatedReadState.sources[selectedField.key], allAnnotations, selectedCandidates
      ) : [];
  // Research review annotations are already review-scoped. Use the same
  // verified single-view calculator and display component as Education.
  // This is presentation only; Research ReadSchema owns the numeric answer.
  const efVolumes = selectedField?.componentKey === 'lvEjectionFraction'
    ? {
        ...getLVSimpsonSourceVolumes(allAnnotations),
        ...liveVerifiedEchoEvidence.efVolumes,
      } : {};
  const protocolTargets = selectedField ? getResearchProtocolViewerTargets(selectedField) : [];
  const guidedOwnsProtocolFrames = readDomain === 'echo' &&
    ['trVmax', 'lvEjectionFraction', 'laVolumeDisks', 'rvFac', 'ivcCollapsibility']
      .includes(cleanString(selectedField?.componentKey));
  const genericProtocolTargets = guidedOwnsProtocolFrames ? [] : protocolTargets;
  const ivcMeasurementState = selectedField?.componentKey === 'ivcCollapsibility'
    ? getResearchIVCMeasurementState(selectedField, allAnnotations)
    : null;
  const guidedIVCValue = selectedField
    ? calculatedReadState.values[selectedField.key] : null;
  const showInlineIVCSources = readDomain === 'echo' &&
    selectedField?.componentKey === 'ivcCollapsibility';
  const showGuidedIVCValue = guidedOwnsProtocolFrames &&
    selectedField?.componentKey === 'ivcCollapsibility' &&
    protocolTargets.length > 0;
  const isSelectedMeasurement = selectedField && (
    ['measurement', 'continuous'].includes(cleanString(selectedField.kind).toLowerCase()) ||
    !!selectedField?.config?.calculation
  );
  const completedFields = visibleFields.filter(field =>
    isResearchQuestionAnswered(field, fields, calculatedReadState.values, readDomain)
  ).length;

  // The Research controller retains its Research Review contract, verified
  // DICOM source evidence and completion authorization. The rendered panel
  // itself is the same LearningQuestionPanel used by Education.
  return (
    <LearningQuestionPanel
      title={title}
      groups={[{
        key: 'research-read-fields',
        questions: visibleFields.map(field => ({
          key: field.key,
          label: getResearchQuestionLabel(field, fields, readDomain),
          answered: isResearchQuestionAnswered(
            field, fields, calculatedReadState.values, readDomain
          ),
          required: field.required,
        })),
      }]}
      selectedKey={selectedField?.key || ''}
      selectedQuestion={selectedField ? {
        key: selectedField.key,
        index: visibleFields.indexOf(selectedField),
        title: getResearchQuestionLabel(selectedField, fields, readDomain),
        required: selectedField.required,
        hasViewerTarget: getResearchProtocolViewerTargets(selectedField).length > 0,
      } : null}
      onSelect={selectField}
      disabled={isBusy}
      readOnly={context.readOnly}
      selectorTitle="Question"
      description={
        (cleanString(context?.imagingProfile?.label) ||
          cleanString(context?.imagingProfileKey) || 'Research imaging profile') +
        ' · ' + cleanString(context?.readSchema?.schemaKey) +
        (context?.readSchema?.schemaVersion ? ' v' + context.readSchema.schemaVersion : '')
      }
      topContent={
        <>
          <div className="text-xs text-gray-400">
            {context.preview ? 'Protocol preview' : reviewStatus}
            {' · '}{completedFields}/{visibleFields.length} questions answered
          </div>
      {context.preview ? (
        <div className="mb-3 rounded border border-blue-900 bg-blue-950 p-3 text-xs text-blue-100">
          Protocol preview. Fields are shown exactly as readers will receive them;
          no Research Review will be saved.
        </div>
      ) : null}

      {context.preview && protocolFramePickerIntent ? (
        <div className="mb-3 rounded border border-cyan-700 bg-cyan-950/30 p-3 text-xs text-cyan-100">
          <div className="font-semibold text-sm">Research protocol frame authoring</div>
          <p className="mt-1">
            Capture the source for {protocolFramePickerIntent.componentKey}
            {protocolFramePickerIntent.phaseKey
              ? ' / ' + protocolFramePickerIntent.phaseKey : ''}.
            Select the correct instance and cine frame in the viewer first.
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-cyan-500 bg-cyan-900 px-3 py-2 font-semibold text-white disabled:opacity-40"
            disabled={capturingProtocolFrame || !commandsManager}
            onClick={() => void captureCurrentProtocolFrame()}
          >
            {capturingProtocolFrame ? 'Capturing current frame…' : 'Capture current frame'}
          </button>
          {capturedProtocolFrame ? (
            <div role="status" className="mt-2 text-green-200">
              {capturedProtocolFrame}
            </div>
          ) : null}
        </div>
      ) : null}
        </>
      }
      questionContent={
        <>
          {!showGuidedIVCValue ? (
            <ReadField
              key={selectedField.key}
              field={selectedField}
              readDomain={readDomain}
              hideHeader
              value={calculatedReadState.values[selectedField.key] ?? ''}
              source={calculatedReadState.sources[selectedField.key]}
              disabled={context.readOnly || context.preview || isBusy}
              onChange={nextValue => updateValue(selectedField.key, nextValue)}
              onDelete={() => {
                const source = calculatedReadState.sources[selectedField.key];
                if (['viewer-derived', 'viewer-measurement'].includes(source?.source)) {
                  if (selectedSources.length === 1) {
                    void deleteResearchAnnotation(selectedSources[0]);
                  } else {
                    notify(servicesManager,
                      'Select the exact measurement source to delete; multiple sources are linked.',
                      'warning');
                  }
                } else {
                  updateValue(selectedField.key, '');
                }
              }}
            />
          ) : null}
          {['lvEjectionFraction', 'laVolumeDisks', 'rvFac'].includes(
            cleanString(selectedField?.componentKey)
          ) ? (
            <div className="rounded border border-gray-700 bg-gray-950 p-2 text-xs">
              <EchoCompositeResultStatus
                value={calculatedReadState.sources[selectedField.key]?.source === 'viewer-derived'
                  ? calculatedReadState.values[selectedField.key] : null}
                unit={cleanString(selectedField.config?.unit)}
                label={context.readOnly ? 'Saved calculated result' : 'Calculated measurement'}
                unavailableMessage="Complete the calibrated contours on their protocol-selected frames."
              />
            </div>
          ) : null}
          {selectedField?.componentKey === 'lvEjectionFraction' ? (
            <EchoEFContourVolumes volumes={efVolumes} status={context.readOnly ? "Saved" : "Current"} />
          ) : null}
          {!isIVCRapRVSPQuestion ? groupedFields.map(companionField => (
            <ReadField
              key={companionField.key}
              field={companionField}
              readDomain={readDomain}
              value={calculatedReadState.values[companionField.key] ?? ''}
              source={calculatedReadState.sources[companionField.key]}
              disabled={context.readOnly || context.preview || isBusy}
              onChange={nextValue => updateValue(companionField.key, nextValue)}
            />
          )) : null}
          {cleanString(context?.readSchema?.domain).toLowerCase() === 'echo' ? (
            <ResearchEchoGuidedControls
              field={selectedField}
              commandsManager={commandsManager}
              sourceAnnotations={selectedSources}
              ivcMeasurementState={ivcMeasurementState}
              ivcReadValue={guidedIVCValue}
              onBeginIVCPhaseRedraw={beginIVCPhaseRedraw}
              onViewIVCSource={annotation => void jumpToAnnotation(annotation)}
              onDeleteIVCSource={annotation => void deleteResearchAnnotation(annotation)}
              disabled={context.readOnly || context.preview || isBusy}
              readOnly={context.readOnly || context.preview}
              onError={message => notify(servicesManager, message, 'warning')}
            />
          ) : null}
          {!showInlineIVCSources && (isSelectedMeasurement || genericProtocolTargets.length > 0) ? (
            <div className="rounded border border-gray-700 bg-gray-950 p-3 text-xs">
              <div className="font-semibold text-gray-100">Measurement sources</div>
              {genericProtocolTargets.length ? (
                <div className="mt-2 space-y-1">
                  <div className="text-gray-400">Protocol-selected instance/frame</div>
                  {genericProtocolTargets.map(({ label, viewerTarget }) => (
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
                    <div
                      key={getAnnotationKey(annotation)}
                      className="flex min-w-0 items-center gap-2 rounded border border-gray-700 bg-black p-2"
                    >
                      <span className="min-w-0 flex-1 break-words text-gray-200">
                        {getAnnotationLabel(annotation)}
                        {getAnnotationValue(annotation)
                          ? ' · ' + getAnnotationValue(annotation) : ''}
                      </span>
                      <button type="button"
                        className="shrink-0 text-blue-300 hover:underline disabled:opacity-40"
                        disabled={!commandsManager}
                        onClick={() => void jumpToAnnotation(annotation)}
                      >View source</button>
                      {!context.readOnly && !context.preview &&
                        selectedSources.length > 1 ? (
                        <button type="button" aria-label="Delete this measurement source"
                          className="shrink-0 rounded border border-gray-600 px-2 py-1 font-bold text-red-200 disabled:opacity-40"
                          disabled={isBusy}
                          onClick={() => void deleteResearchAnnotation(annotation)}
                        >×</button>
                      ) : null}
                    </div>
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
              {isSelectedMeasurement && !selectedSources.length &&
               !guidedOwnsProtocolFrames && !genericProtocolTargets.length ? (
                <div className="mt-2 text-gray-400">
                  {selectedCandidates.length
                    ? 'A compatible value is available. Its source frame will appear when the annotation is ready.'
                    : 'Choose the appropriate image and frame in the viewer, then use the measurement toolbar. The calibrated value will populate here automatically.'}
                </div>
              ) : null}
            </div>
          ) : null}
          {isIVCRapRVSPQuestion ? (
            <div className="space-y-2 rounded border border-cyan-700/70 bg-cyan-950/10 p-2">
              <div className="text-xs font-semibold text-cyan-100">
                RAP selection and calculated RVSP
              </div>
              <div className="text-xs text-gray-300">
                After measuring IVC expiration and inspiration, select RAP
                explicitly. RVSP uses the previously measured TR peak velocity;
                AR does not infer RAP from IVC collapsibility.
              </div>
              {groupedFields.map(groupedField => (
                <ReadField
                  key={groupedField.key}
                  field={groupedField}
                  readDomain={readDomain}
                  value={calculatedReadState.values[groupedField.key] ?? ''}
                  source={calculatedReadState.sources[groupedField.key]}
                  disabled={context.readOnly || context.preview || isBusy}
                  onChange={nextValue => updateValue(groupedField.key, nextValue)}
                />
              ))}
              {fields.some(field => field.componentKey === 'trVmax') ? (
                <button
                  type="button"
                  className="text-xs text-blue-300 hover:underline disabled:opacity-40"
                  disabled={isBusy}
                  onClick={() => {
                    const trField = fields.find(field => field.componentKey === 'trVmax');
                    if (trField) selectField(trField.key);
                  }}
                >View the linked TR peak velocity question</button>
              ) : null}
            </div>
          ) : null}
        </>
      }
      footer={!context.preview && !context.readOnly ? (
        <div className="space-y-2">
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
    />
  );
}
