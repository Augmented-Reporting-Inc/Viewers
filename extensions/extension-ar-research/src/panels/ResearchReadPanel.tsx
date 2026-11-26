import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { beginEFOpenStage, measureEFOpenStage } from '../../../extension-ar-measurements/src/utils/efPanelOpenProfile';
import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import { EchoEFContourVolumes, getLVSimpsonSourceVolumes } from '../../../extension-ar-measurements/src/components/EchoEFContourVolumes';
import { SharedQuestionSelector, SharedQuestionStepNavigation } from '../../../extension-ar-measurements/src/components/SharedQuestionNavigation';
import { SharedMeasurementValueInput, SharedMeasurementLabel } from '../../../extension-ar-measurements/src/components/SharedMeasurementValueInput';
import LearningQuestionPanel from '../../../extension-ar-learning/src/panels/LearningQuestionPanel';
import { SharedTRVmaxQuestionAnswer } from '../../../extension-ar-learning/src/components/SharedTRVmaxQuestionAnswer';
import { SharedIVCRapRVSPAnswer } from '../../../extension-ar-learning/src/components/SharedIVCRapRVSPAnswer';
import { LearningSingleChoiceAnswer } from '../../../extension-ar-learning/src/components/LearningSingleChoiceAnswer';
import ResearchEchoGuidedControls from './ResearchEchoGuidedControls';
import ResearchAcquisitionInputs from './ResearchAcquisitionInputs';
import ResearchReadZScore, {ResearchReadZScorePreview} from './ResearchReadZScore';
import {canShowResearchZScore,matchesSavedResearchZScoreEvidence,buildResearchZScorePreviewRequest} from '../utils/researchReadZScore';
import { resolveResearchLengthCapture } from '../utils/researchLengthCapture';
import { captureViewerQuestionMeasurement } from '../../../extension-ar-measurements/src/utils/questionMeasurementCapture';
import { canShowResearchAcquisitionInputs } from '../utils/researchAcquisitionInputs';
import {
  reconcileResearchEchoCompositeAnswers,
  getVerifiedResearchEFResultCandidate,
  dedupeResearchMeasurementCandidates,
  getResearchEFRestoreSources,
  resolvePersistedResearchEF,
  getResearchAnnotationKey as getAnnotationKey,
  mergeResearchMeasurementAnnotations as mergeMeasurementAnnotations,
  applyResearchSnapshotEvidence,
  withPersistedResearchEF as withPersistedEF,
} from '../utils/researchEchoAnswerBinding';
import { isMatchingQuizEFCompletion } from '../../../extension-ar-learning/src/utils/quizCompositeCaptureIntent';
import { getResearchMeasurementToolForField } from '../utils/researchMeasurementTool';
import {
  getResearchFramePickerIntent,
  getResearchCapturedFrameTarget,
  RESEARCH_FRAME_CAPTURE_MESSAGE,
} from '../utils/researchFramePicker';
import {
  getResearchRapChoices,
  getResearchEchoPhases,
  getResearchEchoPhaseTarget,
  getResearchGroupedFields,
  getResearchQuestionLabel,
  isResearchQuestionAnswered,
  isResearchCompanionHidden,
  isUsableResearchTarget,
  isRequiredResearchPhaseMissing,
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
  isResearchLengthQuestion,
  getResearchLengthSourceState,
  isResearchTRVmaxQuestion,
  getResearchTRVmaxSourceState,
  getResearchLAPhaseSources,
  getResearchRVFACPhaseSources,
  getResearchFieldSourceAnnotations,
  getResearchProtocolViewerTargets,
  getResearchSourceAnnotationIds,
  getResearchCompatibleMeasurementCandidates,
  getResearchIVCMeasurementState,
  getResearchIVCPhaseDisplayState,
  getResearchQuestionEntryTarget,
  getResearchIVCAnnotationSlot,
  isValidResearchIVCPhaseSource,
  getResearchBindingSources,
  isResearchCandidateOnProtocolFrames,
} from '../utils/researchFieldNavigation';
import {
  completeResearchReadReview,
  getCompletedResearchReadOnlyUrl,
  loadResearchReadContext,
  saveResearchReadReview,
} from '../utils/researchContext';

const VIEWER_MEASUREMENTS_WORKFLOW = 'viewerMeasurements';

function cleanString(value: unknown) {
  return String(value || '').trim();
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
  lengthAnswer = false,
  measurementLabel = '',
}: {
  field: any;
  value: any;
  source?: any;
  disabled: boolean;
  onChange: (value: any) => void;
  onDelete?: () => void;
  readDomain?: string;
  hideHeader?: boolean;
  lengthAnswer?: boolean;
  measurementLabel?: string;
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

  // The shared question card supplies the heading and border.
  if (lengthAnswer) {
    return (
      <div className="space-y-2">
        <SharedMeasurementValueInput
          value={value}
          onChange={onChange}
          unit={unit}
          disabled={disabled}
          min={field?.config?.min}
          max={field?.config?.max}
          step={field?.config?.step || 'any'}
          onDelete={onDelete}
          deleteLabel={`Delete ${field.label} measurement`}
        />
        <SharedMeasurementLabel label={measurementLabel} />
      </div>
    );
  }

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
  const invalidatedEFSourceIdsRef = useRef<Set<string>>(new Set());
  // Redraw is transactional in the local draft: retain the old source until
  // a NEW calibrated, correctly labelled annotation lands on the pinned SOP/
  // frame. Closing the viewer without completing does not delete old evidence.
  const pendingIVCReplacementRef = useRef<null | {
    slot: string; fieldKey: string; priorIds: string[];
  }>(null);
  const [selectedFieldKey, setSelectedFieldKey] = useState('');
  const [capturingProtocolFrame, setCapturingProtocolFrame] = useState(false);
  const [capturedProtocolFrame, setCapturedProtocolFrame] = useState('');
  const [capturePhaseSelection, setCapturePhaseSelection] = useState('');
  const protocolFramePickerIntent = useMemo(
    () => getResearchFramePickerIntent(
      typeof window !== 'undefined' ? window.location.search : '',
      typeof window !== 'undefined' ? window.location.hash : ''
    ),
    []
  );
  const isBatchFramePicker = protocolFramePickerIntent?.phaseKey === '__all__';
  const capturePhases = isBatchFramePicker
    ? getResearchEchoPhases({ componentKey: protocolFramePickerIntent.componentKey })
    : [];
  const capturePhaseKey = isBatchFramePicker
    ? (capturePhases.find(phase => phase.slot === capturePhaseSelection)?.slot ||
      capturePhases[0]?.slot || '')
    : (protocolFramePickerIntent?.phaseKey || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [acquisitionBusy, setAcquisitionBusy] = useState(false);
  const [scoreBusy,setScoreBusy] = useState(false);
  const [acquisitionEvidence,setAcquisitionEvidence] = useState<{revision:number;verified:boolean;dirty:boolean}|null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setAcquisitionEvidence(null);
    setError('');

    try {
      const next = await loadResearchReadContext();
      const lockedUrl = next.reviewKey && !next.preview
        ? getCompletedResearchReadOnlyUrl(window.location.href, next.review?.status, next.measurementAccess)
        : null;
      if (lockedUrl) {
        window.location.replace(lockedUrl);
        return;
      }
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
      invalidatedEFSourceIdsRef.current = new Set();
      pendingIVCReplacementRef.current = null;
      setLiveAnnotations([]);
      setLiveVerifiedEchoEvidence({ candidates: [], efVolumes: {} });
      setViewerCandidates(buildViewerMeasurementValueCandidates(persistedAnnotations, { includeLVSimpson: false }));
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
  // The authoring modal and in-viewer assessment must consume the same
  // ordered question definition. Legacy grouping remains for old snapshots.
  const questionNavigationMode =
    context?.readSchema?.config?.questionNavigationMode === 'authored'
      ? 'authored' : 'legacy';
  const visibleFields = useMemo(
    () => fields.filter(field =>
      !isResearchCompanionHidden(field, fields, readDomain, questionNavigationMode)),
    [fields, readDomain, questionNavigationMode]
  );
  useEffect(() => {
    if (!visibleFields.length) return;
    setSelectedFieldKey(current =>
      visibleFields.some(field => field.key === current) ? current :
      (questionNavigationMode === 'authored'
        ? visibleFields[0].key
        : (visibleFields.find(field => field.required)?.key || visibleFields[0].key))
    );
  }, [visibleFields, questionNavigationMode]);

  useEffect(() => {
    if (!protocolFramePickerIntent || !visibleFields.length) return;
    const target = visibleFields.find(field =>
      field.componentKey === protocolFramePickerIntent.componentKey
    );
    if (target) setSelectedFieldKey(target.key);
  }, [protocolFramePickerIntent, visibleFields]);

  const allAnnotations = useMemo(
    () => context?.readOnly ? savedAnnotations : mergeMeasurementAnnotations(
      savedAnnotations, liveAnnotations, deletedAnnotationIdsRef.current,
      invalidatedEFSourceIdsRef.current
    ),
    [context?.readOnly, savedAnnotations, liveAnnotations]
  );
  const persistedReadState = useMemo(
    () => buildReadValueState(context?.review?.readResults || {}),
    [context?.review?.readResults]
  );
  const persistedEF = useMemo(() => resolvePersistedResearchEF(
    fields, persistedReadState.values, persistedReadState.sources,
    savedAnnotations, allAnnotations, context?.sourceStudyInstanceUID,
    invalidatedEFSourceIdsRef.current
  ), [fields, persistedReadState, savedAnnotations, allAnnotations, context?.sourceStudyInstanceUID]);
  const savedEFVolumes = useMemo(() => {
    const efField = fields.find(field => field.componentKey === 'lvEjectionFraction');
    const selected = getResearchEFRestoreSources(
      efField, savedAnnotations, persistedReadState.sources[efField?.key]?.sourceMeasurementKey
    ).filter(annotation => {
      const id = getAnnotationKey(annotation);
      return !deletedAnnotationIdsRef.current.has(id) &&
        !invalidatedEFSourceIdsRef.current.has(id);
    });
    return measureEFOpenStage('research-saved-volumes', () =>
      getLVSimpsonSourceVolumes(selected, { verifiedSavedSources: !!persistedEF }));
  }, [fields, savedAnnotations, persistedReadState, allAnnotations, persistedEF]);
  const displayedEFVolumes = {
    ...liveVerifiedEchoEvidence.efVolumes,
    ...Object.fromEntries(Object.entries(savedEFVolumes).filter(
      ([slot, volume]) => volume != null || liveVerifiedEchoEvidence.efVolumes[slot] == null
    )),
  };
  const calculatedReadState = useMemo(() => {
    if (context?.readOnly && !context?.preview) return persistedReadState;
    if (context?.preview) {
      return { values, sources: valueSources };
    }
    // All guided Echo composites now reconcile from the same verified
    // source-annotation snapshot. Education and Research share the calculation
    // engines; Research retains its own ReadSchema values and ownership.
    const reconciled = reconcileResearchEchoCompositeAnswers(
      fields, values, valueSources, allAnnotations,
      withPersistedEF(liveVerifiedEchoEvidence.candidates, persistedEF),
      { verifiedEFOnly: true }
    );
    return buildCalculatedReadState(
      fields, reconciled.values, reconciled.sources, viewerCandidates
    );
  }, [context?.readOnly, context?.preview, fields, values, valueSources,
      viewerCandidates, allAnnotations, liveVerifiedEchoEvidence.candidates, persistedEF, persistedReadState]);
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

  const refreshViewerMeasurementBindings = useCallback(async (
    prepared?: { serialized: any; efSnapshot: any }, explicitLAFieldKey = ''
  ) => {
    if (
      !commandsManager ||
      !fields.length ||
      !context ||
      context.readOnly ||
      context.preview
    ) {
      return;
    }

    const endBinding = beginEFOpenStage('research-binding');
    try {
      const serialized = prepared?.serialized ?? await commandsManager.runCommand(
        'getSerializedViewerMeasurements',
        {
          domain: cleanString(context?.readSchema?.domain) || 'generic',
          workflow: VIEWER_MEASUREMENTS_WORKFLOW,
          includeResearchEchoContours: true,
          researchSavedAnnotations: savedAnnotations,
          researchStudyInstanceId: context?.sourceStudyInstanceUID,
        }
      );
      const evidence = applyResearchSnapshotEvidence(
        serialized, deletedAnnotationIdsRef.current, invalidatedEFSourceIdsRef.current
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
        savedAnnotations, snapshot, deletedAnnotationIdsRef.current,
        invalidatedEFSourceIdsRef.current
      );
      const liveVerified = (Array.isArray(evidence.candidates)
        ? evidence.candidates : []).filter(candidate =>
        getResearchSourceAnnotationIds(candidate?.sourceMeasurementKey).every(id =>
          available.some(item => getAnnotationKey(item) === id)
        )
      );
      const efField = fields.find(field => field.componentKey === 'lvEjectionFraction');
      let verifiedEF: any = null;
      if (efField) {
        const reviewedEF = prepared?.efSnapshot ?? await commandsManager.runCommand('getViewerQuizLVSimpsonForActiveStudy');
        verifiedEF = String(reviewedEF?.studyInstanceId || '') ===
          String(context?.sourceStudyInstanceUID || '')
          ? getVerifiedResearchEFResultCandidate(efField, reviewedEF, available) : null;
      }
      // An explicit Calculate EF snapshot is the same trusted result the
      // Education capture command uses. Deduplicate by source identity:
      // repeated live/explicit candidates are not competing measurements.
      const verifiedEvidence = dedupeResearchMeasurementCandidates([
        ...liveVerified, ...(verifiedEF ? [verifiedEF] : []),
      ]);
      setLiveVerifiedEchoEvidence({
        candidates: verifiedEvidence,
        efVolumes: evidence.efVolumes || {},
      });
      const savedEF = resolvePersistedResearchEF(
        fields, persistedReadState.values, persistedReadState.sources,
        savedAnnotations, available, context?.sourceStudyInstanceUID,
        invalidatedEFSourceIdsRef.current
      );
      const candidateList = [
        ...buildViewerMeasurementValueCandidates(available, { includeLVSimpson: false }),
        ...withPersistedEF(verifiedEvidence, savedEF),
      ];
      const candidates = dedupeResearchMeasurementCandidates(candidateList);
      setViewerCandidates(candidates);
      const updates = fields.flatMap(field => {
        const compatible = getResearchCompatibleMeasurementCandidates(
          field, candidates, available
        );
        if (field.key === explicitLAFieldKey && field.componentKey === 'laVolumeDisks') {
          // Explicit recalculation may replace a legacy manual answer, but
          // only from the two unambiguous, calibrated and verified sources.
          const phases = getResearchLAPhaseSources(field, available, context.sourceStudyInstanceUID);
          const rows = ['A4C', 'A2C'].map(slot => phases.phaseSources[slot]);
          if (phases.unresolvedCount || rows.some(items => items.length !== 1 ||
              !items[0].matchesTarget || items[0].areaCM2 == null)) return [];
          const ids = rows.map(items => getAnnotationKey(items[0].annotation));
          const derived = compatible.filter(candidate =>
            candidate.source === 'viewer-derived' &&
            cleanString(candidate.sourceMeasurementKey).startsWith('la-disks:') &&
            getResearchSourceAnnotationIds(candidate.sourceMeasurementKey).length === 2 &&
            ids.every(id => getResearchSourceAnnotationIds(candidate.sourceMeasurementKey).includes(id)));
          return buildViewerMeasurementReadUpdates([field], derived, {});
        }
        return buildViewerMeasurementReadUpdates(
          [field], compatible,
          getResearchBindingSources(field, valueSourcesRef.current, compatible)
        );
      });

      if (explicitLAFieldKey && !updates.some(update => update.fieldKey === explicitLAFieldKey)) {
        notify(servicesManager, 'LA volume could not be recalculated from two verified calibrated contours.', 'warning');
      }
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
      if (explicitLAFieldKey) {
        notify(servicesManager, 'Unable to recalculate LA volume. Existing saved evidence was not changed.', 'warning');
      }
    } finally { endBinding(); }
  }, [
    commandsManager,
    context?.preview,
    context?.readOnly,
    context?.readSchema?.domain,
    context?.sourceStudyInstanceUID,
    fields,
    savedAnnotations,
    persistedReadState,
    servicesManager,
  ]);

  // Education already listens to this exact EF calculation/capture event.
  // Research subscribes to the same checkpoint and supplies its own saved
  // ReadSchema source/answer adapter; never trust the event value alone.
  useEffect(() => {
    if (!commandsManager || !context?.reviewKey ||
        context.readOnly || context.preview) return;
    const onCalculatedEF = (event: Event) => {
      void (async () => {
        const detail = (event as CustomEvent)?.detail || {};
        const field = fields.find(item =>
          item.componentKey === 'lvEjectionFraction' && item.key === selectedFieldKey
        );
        if (!field) return;
        const snapshot = await commandsManager.runCommand('getViewerQuizLVSimpsonForActiveStudy');
        if (!isMatchingQuizEFCompletion({
          mode: String(detail.mode || ''),
          authoringMode: false,
          questionKind: 'lvSimpsonEF',
          eventStudy: String(detail.studyInstanceId || ''),
          activeStudy: String(snapshot?.studyInstanceId || ''),
          eventValue: detail.value,
          currentValue: snapshot?.composite?.value,
        }) || String(snapshot?.studyInstanceId || '') !==
          String(context.sourceStudyInstanceUID || '')) return;

        const serialized = await commandsManager.runCommand('getSerializedViewerMeasurements', {
          domain: 'echo', workflow: VIEWER_MEASUREMENTS_WORKFLOW,
          includeResearchEchoContours: true,
          researchSavedAnnotations: savedAnnotations,
          researchStudyInstanceId: context?.sourceStudyInstanceUID,
        });
        applyResearchSnapshotEvidence(
          serialized, deletedAnnotationIdsRef.current, invalidatedEFSourceIdsRef.current
        );
        const available = mergeMeasurementAnnotations(
          savedAnnotations, Array.isArray(serialized?.annotations) ? serialized.annotations : [],
          deletedAnnotationIdsRef.current, invalidatedEFSourceIdsRef.current
        );
        const verified = getVerifiedResearchEFResultCandidate(field, snapshot, available);
        if (!verified) {
          notify(servicesManager,
            'EF calculated, but its four saved contours do not match the Research protocol frames. Review each source frame before saving.',
            'warning');
          return;
        }
        await refreshViewerMeasurementBindings({ serialized, efSnapshot: snapshot });
      })().catch(error =>
        console.warn('[AR Research] verified EF capture refresh failed', error)
      );
    };
    window.addEventListener('ar-measurements:lv-simpson-capture-requested', onCalculatedEF);
    return () => window.removeEventListener('ar-measurements:lv-simpson-capture-requested', onCalculatedEF);
  }, [commandsManager, context?.reviewKey, context?.readOnly, context?.preview,
      context?.sourceStudyInstanceUID, fields, selectedFieldKey, savedAnnotations,
      refreshViewerMeasurementBindings, servicesManager]);

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

    let refreshTimer: number | undefined;
    let running = false;
    let pending = false;
    const refresh = () => {
      if (cancelled) return;
      pending = true;
      if (running || refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(async () => {
        refreshTimer = undefined;
        if (cancelled) return;
        running = true;
        pending = false;
        try { await refreshViewerMeasurementBindings(); }
        finally {
          running = false;
          if (pending && !cancelled) refresh();
        }
      }, 50);
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
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);

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
          researchSavedAnnotations: savedAnnotations,
          researchStudyInstanceId: context?.sourceStudyInstanceUID,
        }
      );
      if (!Array.isArray(serialized?.annotations)) {
        throw new Error('Viewer measurement snapshot is unavailable');
      }

      const evidence = applyResearchSnapshotEvidence(
        serialized, deletedAnnotationIdsRef.current, invalidatedEFSourceIdsRef.current
      );
      const liveIds = new Set(serialized.annotations.map(getAnnotationKey));
      // Never save stale geometry after a genuine edit if that source is
      // temporarily unavailable. Unchanged saved sources need no hydration.
      if (savedAnnotations.some(annotation => {
        const id = getAnnotationKey(annotation);
        return invalidatedEFSourceIdsRef.current.has(id) &&
          !deletedAnnotationIdsRef.current.has(id) && !liveIds.has(id);
      })) throw new Error('An edited EF contour is not available. Restore its frame before saving.');
      return {
        annotations: mergeMeasurementAnnotations(
          savedAnnotations, serialized.annotations, deletedAnnotationIdsRef.current,
          invalidatedEFSourceIdsRef.current
        ),
        verifiedCandidates: Array.isArray(evidence.candidates) ? evidence.candidates : [],
      };
    } catch (captureError) {
      console.warn(
        '[AR Research] viewer measurement capture failed; preserving saved annotations',
        captureError
      );
      throw new Error('Could not capture current viewer annotations. Research Read was not saved.');
    }
  }, [commandsManager, context?.readSchema?.domain, context?.sourceStudyInstanceUID, savedAnnotations]);

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
      const efField = fields.find(field => field.componentKey === 'lvEjectionFraction');
      const efSnapshot = efField
        ? await commandsManager.runCommand('getViewerQuizLVSimpsonForActiveStudy')
        : null;
      const verifiedEF = efField && String(efSnapshot?.studyInstanceId || '') ===
        String(context?.sourceStudyInstanceUID || '')
        ? getVerifiedResearchEFResultCandidate(efField, efSnapshot, measurementAnnotations)
        : null;
      const savedEF = resolvePersistedResearchEF(
        fields, persistedReadState.values, persistedReadState.sources,
        savedAnnotations, measurementAnnotations, context?.sourceStudyInstanceUID,
        invalidatedEFSourceIdsRef.current
      );
      const freshVerifiedEvidence = withPersistedEF([
        ...freshVerified, ...(verifiedEF ? [verifiedEF] : []),
      ], savedEF);
      const candidateList = [
        ...buildViewerMeasurementValueCandidates(measurementAnnotations, { includeLVSimpson: false }),
        ...freshVerifiedEvidence,
      ];
      const latestCandidates = dedupeResearchMeasurementCandidates(candidateList);
      // An explicitly calculated EF with contour evidence is never a
      // successful zero-result draft. Preserve the measurements and explain
      // the frame/source failure rather than silently saving an empty answer.
      if (efField && efSnapshot?.composite?.measurementKind === 'lvSimpsonEF' &&
          !verifiedEF) {
        throw new Error(
          'Calculated EF cannot be saved: its four contours do not match the ' +
          'Research protocol DICOM frames or contain duplicate/invalid source IDs. ' +
          'Review each EF frame; existing annotations were not overwritten.'
        );
      }
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
        freshVerifiedEvidence, { verifiedEFOnly: true }
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
      // A complete EF contour set without a valid structured EF answer is
      // not a successful assessment save. Partial drafts remain saveable.
      // Do not silently overwrite a previously saved Research EF with zero.
      const efSlots = new Set(measurementAnnotations
        .filter(annotation =>
          annotation?.measurementKind === 'lvSimpsonSlot' ||
          annotation?.lvSimpson?.measurementKind === 'lvSimpsonSlot' ||
          annotation?.measurements?.lvSimpson?.measurementKind === 'lvSimpsonSlot'
        )
        .map(annotation => String(annotation?.slot ||
          annotation?.lvSimpson?.slot || annotation?.measurements?.lvSimpson?.slot || ''))
        .filter(Boolean));
      if (efField &&
          ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'].every(slot => efSlots.has(slot)) &&
          !readResults.entries.some(entry => entry.componentKey === 'lvEjectionFraction')) {
        throw new Error(
          'All four EF contour phases are present, but no protocol-verified EF answer ' +
          'could be captured. Research Read was not saved; check duplicate contours ' +
          'and exact frame targets in the EF panel.'
        );
      }
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
      invalidatedEFSourceIdsRef.current = new Set();
      setLiveAnnotations([]);
      setLiveVerifiedEchoEvidence({ candidates: [], efVolumes: {} });
      setViewerCandidates(latestCandidates);
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
    persistedReadState,
    savedAnnotations,
    commandsManager,
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
      const lockedUrl = getCompletedResearchReadOnlyUrl(
        window.location.href, completed?.status, context.measurementAccess);
      if (lockedUrl) window.location.replace(lockedUrl);
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
    async (annotation: any, options: {
      requireExactSopFrame?: boolean; isCancelled?: () => boolean;
    } = {}) => {
      if (options.isCancelled?.()) return false;
      try {
        const result = await commandsManager.runCommand('jumpToSavedViewerAnnotation', {
          annotation,
          selectAnnotation: true,
          pauseCineOnSource: true,
          ...options,
        });
        if (options.isCancelled?.()) return false;
        if (result?.ok !== true) {
          throw new Error(result?.reason || 'saved source navigation was unsuccessful');
        }
        return true;
      } catch (jumpError) {
        if (options.isCancelled?.()) return false;
        console.warn('[AR Research] saved annotation navigation failed', jumpError);
        notify(
          servicesManager,
          'Unable to navigate to the saved viewer annotation.',
          'warning'
        );
        return false;
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
        phaseKey: capturePhaseKey,
        target,
      }, protocolFramePickerIntent.parentOrigin);
      setCapturedProtocolFrame(
        'Captured frame ' + target.frameNumber +
        ' for ' + protocolFramePickerIntent.componentKey +
        (capturePhaseKey ? ' / ' + capturePhaseKey : '') +
        '. Return to Research Manager and click Save.'
      );
      notify(servicesManager, 'Frame sent to Research Manager. Save the protocol there.');
      if (isBatchFramePicker) {
        const currentIndex = capturePhases.findIndex(phase => phase.slot === capturePhaseKey);
        if (currentIndex >= 0 && currentIndex + 1 < capturePhases.length) {
          setCapturePhaseSelection(capturePhases[currentIndex + 1].slot);
        }
      }
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
    if (!commandsManager) return false;
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
      return true;
    } catch (navigationError) {
      console.warn('[AR Research] protocol frame navigation failed', navigationError);
      notify(servicesManager, 'Unable to open the configured protocol instance/frame.', 'warning');
      return false;
    }
  };

  // A deleted source must not be restored by queued navigation. Reuse this
  // same guarded display path for automatic selection and explicit resolution.
  const restoreResearchAnnotationSource = (item: any, isCancelled: () => boolean) => {
    const sourceId = getAnnotationKey(item.annotation);
    const cancelled = () => isCancelled() || !sourceId ||
      deletedAnnotationIdsRef.current.has(sourceId);
    return jumpToAnnotation({
      ...item.displayAnnotation,
      ...(context?.readOnly || context?.preview ? { isLocked: true } : {}),
    }, { requireExactSopFrame: true, isCancelled: cancelled });
  };

  const navigateToField = async (field: any, isCancelled: () => boolean) => {
    if (isCancelled()) return false;
    if (isResearchTRVmaxQuestion(field, readDomain)) {
      const state = getResearchTRVmaxSourceState(
        field, calculatedReadState.sources[field.key], allAnnotations,
        context?.sourceStudyInstanceUID);
      const target = getResearchEchoPhaseTarget(field, '');
      if ((target && !isUsableResearchTarget(target)) || isRequiredResearchPhaseMissing(field, '')) {
        notify(servicesManager, 'The configured TR Vmax frame is incomplete.', 'warning');
        return false;
      }
      const source = state.selected || (state.status === 'unbound' &&
        !context?.readOnly && !context?.preview ? state.eligible[0] : null);
      if (source) return restoreResearchAnnotationSource(source, isCancelled);
      if (state.status === 'invalid' || state.status === 'ambiguous' || state.status === 'manual') {
        notify(servicesManager, 'Resolve the TR Vmax source before measuring again.', 'warning');
        return false;
      }
      return target ? jumpToProtocolTarget(target, field.key) : true;
    }
    if (isResearchLengthQuestion(field, readDomain)) {
      const state = getResearchLengthSourceState(
        field, calculatedReadState.sources[field.key], allAnnotations,
        viewerCandidates || [], context?.sourceStudyInstanceUID);
      const source = state.selected || (state.status === 'unbound' &&
        !context?.readOnly && !context?.preview ? state.eligible[0] : null);
      if (source) return restoreResearchAnnotationSource(source, isCancelled);
      if (state.status === 'invalid' || state.status === 'ambiguous') {
        notify(servicesManager, 'Choose or resolve the exact Length measurement source before continuing.', 'warning');
        return false;
      }
      const target = getResearchQuestionEntryTarget(field);
      return target ? jumpToProtocolTarget(target, field.key) : true;
    }
    const targets = getResearchProtocolViewerTargets(field);
    const initialTarget = getResearchQuestionEntryTarget(field);
    // Research IVC starts at the explicit expiration frame, as Education
    // does; other multi-phase questions still require an explicit choice.
    if (initialTarget) {
      await jumpToProtocolTarget(initialTarget, field.key);
      return true;
    }
    if (targets.length > 1) return true;
    const sourceAnnotations = getResearchFieldSourceAnnotations(
      calculatedReadState.sources[field.key], allAnnotations,
      getResearchFieldMeasurementCandidates(field, viewerCandidates || [])
    );
    if (sourceAnnotations.length === 1) {
      await jumpToAnnotation(sourceAnnotations[0], { isCancelled });
    }
    return true;
  };

  const selectionGenerationRef = useRef(0);
  const selectionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const initializedReviewRef = useRef('');
  const editingAllowedRef = useRef(false);
  editingAllowedRef.current = !!context && !context.readOnly && !context.preview &&
    !saving && !completing && !acquisitionBusy && !scoreBusy;
  // Serialize navigation and invalidate stale work, including A -> B -> A.
  const queueNavigation = (work: (isCancelled: () => boolean) => Promise<void>) => {
    const generation = ++selectionGenerationRef.current;
    const isCancelled = () => selectionGenerationRef.current !== generation;
    const run = async () => { if (!isCancelled()) await work(isCancelled); };
    selectionQueueRef.current = selectionQueueRef.current.then(run, run).catch(error => {
      if (isCancelled()) return;
      console.warn('[AR Research] question navigation failed', error);
      notify(servicesManager, 'Unable to navigate to the selected measurement.', 'warning');
    });
  };
  const runFieldSelection = (field: any) => queueNavigation(async isCancelled => {
    const navigated = await navigateToField(field, isCancelled);
    if (!navigated || isCancelled() || !editingAllowedRef.current) return;
    if (isResearchTRVmaxQuestion(field, readDomain)) {
      // Same calibrated acquisition command used by Education. Do not enter
      // quiz capture mode or publish Education answer events for a Research Read.
      const result = await commandsManager?.runCommand('startUltrasoundDirectionalWorkflow', {
        spectralVmax: true, preferredTargetKey: 'echo.trPeakVelocity',
        isCancelled: () => isCancelled() || !editingAllowedRef.current,
      });
      if (result?.ok === false) throw new Error(result.reason || 'TR Vmax activation failed');
      return;
    }
    const toolName = getResearchMeasurementToolForField(field, readDomain);
    if (toolName) {
      await commandsManager?.runCommand('activateViewerMeasurementTool', {
        toolName, stopCine: true,
      });
    }
  });
  const selectField = (key: string) => {
    const field = fields.find(item => item.key === key);
    if (!field) return;
    pendingIVCReplacementRef.current = null;
    initializedReviewRef.current = cleanString(context?.reviewKey);
    setSelectedFieldKey(key);
    runFieldSelection(field);
  };
  // A reopened review's first selected Length question also restores its
  // saved source. Do not jump again whenever binding refreshes or Save runs.
  useEffect(() => {
    const reviewKey = cleanString(context?.reviewKey);
    if (loading || !commandsManager || context?.preview || !reviewKey ||
        initializedReviewRef.current === reviewKey || !selectedFieldKey) return;
    const field = visibleFields.find(item => item.key === selectedFieldKey);
    if (!field) return;
    initializedReviewRef.current = reviewKey;
    if (isResearchLengthQuestion(field, readDomain) || isResearchTRVmaxQuestion(field, readDomain)) runFieldSelection(field);
  }, [loading, commandsManager, context?.reviewKey, context?.preview,
    selectedFieldKey, visibleFields, readDomain]);
  useEffect(() => () => { ++selectionGenerationRef.current; },
    [context?.reviewKey, context?.readOnly, context?.preview]);

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

  // Education and Research consume the SAME calibrated, exact-ID viewer
  // capture command. This adapter only establishes Research's own answer link.
  const activeCaptureRef = useRef({ fieldKey: '', reviewKey: '' });
  activeCaptureRef.current = { fieldKey: selectedFieldKey, reviewKey: cleanString(context?.reviewKey) };
  const lengthCaptureInFlightRef = useRef(new Set<string>());
  const captureSharedLength = async (field: any, measurementId: string) => {
    if (!measurementId || !field || !isResearchLengthQuestion(field, readDomain) ||
        !editingAllowedRef.current || !context?.reviewKey || !commandsManager) return false;
    const generation = selectionGenerationRef.current;
    const reviewKey = cleanString(context.reviewKey);
    const isCurrent = () => editingAllowedRef.current &&
      generation === selectionGenerationRef.current &&
      activeCaptureRef.current.fieldKey === field.key &&
      activeCaptureRef.current.reviewKey === reviewKey;
    if (!isCurrent() || valueSourcesRef.current[field.key]?.source) return false;
    const pendingKey = reviewKey + '|' + field.key + '|' + measurementId;
    if (lengthCaptureInFlightRef.current.has(pendingKey)) return false;
    lengthCaptureInFlightRef.current.add(pendingKey);
    try {
      const result = await captureViewerQuestionMeasurement(commandsManager, {
        question: { questionKey: field.componentKey, answerConfig: { measurementKind: 'length' } },
        unit: field.config?.unit, measurementId,
      });
      if (!isCurrent() || valueSourcesRef.current[field.key]?.source) return false;
      const capture = resolveResearchLengthCapture(field, result,
        cleanString(context.sourceStudyInstanceUID), measurementId, valueSourcesRef.current, fields);
      if (!capture || deletedAnnotationIdsRef.current.has(capture.sourceId)) {
        return false;
      }
      const measurementService = servicesManager?.services?.measurementService;
      const measurement = measurementService?.getMeasurement?.(capture.sourceId);
      if (!measurement || measurement.toolName !== 'Length' || !isCurrent()) return false;
      const label = cleanString(measurement.label || measurement.measurementRole);
      const normalizeLabel = value => cleanString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (label && !['length', normalizeLabel(capture.label)].includes(normalizeLabel(label))) return false;
      // Use the existing shared MeasurementService annotation update, exactly
      // as the viewer's established label dialog/IVC phase binding does.
      if (normalizeLabel(label) !== normalizeLabel(capture.label)) {
        measurementService.update(capture.sourceId, {
          ...measurement, label: capture.label, measurementRole: capture.label,
        }, true);
      }
      if (!isCurrent()) return false;
      const nextSources = { ...valueSourcesRef.current, [field.key]: {
        source: capture.update.source, sourceMeasurementKey: capture.sourceId,
      } };
      valueSourcesRef.current = nextSources;
      setValueSources(nextSources);
      setValues(current => ({ ...current, [field.key]: capture.update.value }));
      void refreshViewerMeasurementBindings();
      return true;
    } catch {
      return false;
    } finally {
      lengthCaptureInFlightRef.current.delete(pendingKey);
    }
  };

  useEffect(() => {
    const field = fields.find(item => item.key === selectedFieldKey);
    if (!field || !isResearchLengthQuestion(field, readDomain) ||
        context?.readOnly || context?.preview || !context?.reviewKey) return;
    const snapshotContext = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (typeof detail?.accept !== 'function' || !editingAllowedRef.current ||
          valueSourcesRef.current[field.key]?.source) return;
      detail.accept({ ...activeCaptureRef.current, generation: selectionGenerationRef.current });
    };
    const completed = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const owner = detail?.captureContext;
      if (owner?.fieldKey !== field.key || owner?.reviewKey !== activeCaptureRef.current.reviewKey ||
          owner?.generation !== selectionGenerationRef.current) return;
      // Only the mode's fresh completion event can claim a Research caliper.
      // Raw, restored and ordinary MeasurementService updates never auto-bind.
      if (typeof detail?.accept !== 'function' || detail.toolName !== 'Length' ||
          !detail.measurementId || !editingAllowedRef.current ||
          valueSourcesRef.current[field.key]?.source) return;
      detail.accept(captureSharedLength(field, cleanString(detail.measurementId)));
    };
    window.addEventListener('ar-measurements:question-capture-context', snapshotContext);
    window.addEventListener('ar-learning:quiz-measurement-added', completed);
    return () => {
      window.removeEventListener('ar-measurements:question-capture-context', snapshotContext);
      window.removeEventListener('ar-learning:quiz-measurement-added', completed);
    };
  }, [selectedFieldKey, fields, readDomain, context?.reviewKey, context?.readOnly, context?.preview,
    context?.sourceStudyInstanceUID, servicesManager, commandsManager, refreshViewerMeasurementBindings]);

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
  const isBusy = saving || completing || acquisitionBusy || scoreBusy;
  const selectedField = visibleFields.find(field => field.key === selectedFieldKey) ||
    visibleFields[0];
  const groupedFields = getResearchGroupedFields(
    selectedField, fields, readDomain, questionNavigationMode
  );
  const isIVCRapRVSPQuestion = readDomain === 'echo' &&
    selectedField?.componentKey === 'ivcCollapsibility' &&
    groupedFields.some(item => ['rap', 'rvsp'].includes(item.componentKey));
  const selectedCandidates = selectedField
    ? getResearchCompatibleMeasurementCandidates(
        selectedField, viewerCandidates || [], allAnnotations
      ) : [];
  const selectedLA = readDomain === 'echo' && selectedField?.componentKey === 'laVolumeDisks';
  const selectedRVFAC = readDomain === 'echo' && selectedField?.componentKey === 'rvFac';
  const selectedContourComposite = selectedLA || selectedRVFAC;
  const contourPhaseState = selectedLA ? getResearchLAPhaseSources(
    selectedField, allAnnotations, context?.sourceStudyInstanceUID
  ) : selectedRVFAC ? getResearchRVFACPhaseSources(
    selectedField, allAnnotations, context?.sourceStudyInstanceUID
  ) : null;
  const contourValue = selectedContourComposite &&
    calculatedReadState.sources[selectedField.key]?.source === 'viewer-derived'
    ? calculatedReadState.values[selectedField.key] : null;
  const hasContourManualSource = selectedContourComposite &&
    calculatedReadState.sources[selectedField.key]?.source === 'manual';
  const contourManualValue = hasContourManualSource
    ? calculatedReadState.values[selectedField.key] : null;
  const selectedTR = isResearchTRVmaxQuestion(selectedField, readDomain);
  const trState = selectedTR ? getResearchTRVmaxSourceState(
    selectedField, calculatedReadState.sources[selectedField.key], allAnnotations,
    context?.sourceStudyInstanceUID
  ) : null;
  const trValue = selectedTR ? calculatedReadState.values[selectedField.key] : null;
  const trCaptured = !!trState?.selected && trValue != null &&
    cleanString(trValue) !== '' && Number.isFinite(Number(trValue)) &&
    Math.abs(Number(trValue) - Number(trState.selected.candidate.value)) <=
      Math.max(0.005000001, Number(selectedField?.config?.step || 0.01) / 2 + 1e-9);
  const trNeedsResolution = !!trState &&
    (trState.status === 'invalid' || trState.status === 'ambiguous' ||
      trState.status === 'manual' || trState.status === 'unbound' ||
      trState.eligible.length > 1 || (trState.status === 'linked' && !trCaptured));
  const selectedLength = isResearchLengthQuestion(selectedField, readDomain);
  const automaticZScore = context?.readSchema?.config?.zScore?.verificationMode === 'automatic_calibrated';
  const showZScore = selectedLength && canShowResearchZScore(context,selectedField);
  const savedZScoreEvidence = showZScore && !!context.review?.savedAt &&
    !!acquisitionEvidence?.verified && !acquisitionEvidence.dirty &&
    matchesSavedResearchZScoreEvidence(selectedField.key,calculatedReadState,persistedReadState,
      allAnnotations,savedAnnotations,deletedAnnotationIdsRef.current);
  const lengthState = selectedLength ? getResearchLengthSourceState(
    selectedField, calculatedReadState.sources[selectedField.key], allAnnotations,
    viewerCandidates || [], context?.sourceStudyInstanceUID) : null;
  const previewRequest = showZScore && automaticZScore && !savedZScoreEvidence &&
    !saving && !completing && !acquisitionBusy && !!acquisitionEvidence?.verified &&
    !acquisitionEvidence.dirty && lengthState?.status === 'linked'
    ? buildResearchZScorePreviewRequest(context,selectedField,acquisitionEvidence.revision,
      buildReadResultEntries(fields,calculatedReadState.values,calculatedReadState.sources),
      allAnnotations,deletedAnnotationIdsRef.current) : null;
  const previewRequestBody = previewRequest ? JSON.stringify(previewRequest) : '';
  const selectedSources = lengthState
    ? lengthState.eligible.map(item => item.annotation)
    : selectedField ? getResearchFieldSourceAnnotations(
        calculatedReadState.sources[selectedField.key], allAnnotations, selectedCandidates
      ) : [];
  const showLengthSourceResolution = !!lengthState &&
    (lengthState.status === 'invalid' || lengthState.status === 'ambiguous' ||
      lengthState.eligible.length > 1 ||
      (lengthState.status === 'manual' && lengthState.eligible.length > 0) ||
      (lengthState.status === 'unbound' && (context.readOnly || context.preview)));
  const sourceResolutionCandidates = lengthState
    ? lengthState.eligible.map(item => item.candidate) : selectedCandidates;
  const viewLengthSource = (item: any) => queueNavigation(async isCancelled => {
    await restoreResearchAnnotationSource(item, isCancelled);
  });
  // Research review annotations are already review-scoped. Use the same
  // verified single-view calculator and display component as Education.
  // This is presentation only; Research ReadSchema owns the numeric answer.
  const protocolTargets = selectedField ? getResearchProtocolViewerTargets(selectedField) : [];
  const guidedOwnsProtocolFrames = readDomain === 'echo' &&
    ['trVmax', 'lvEjectionFraction', 'laVolumeDisks', 'rvFac', 'ivcCollapsibility']
      .includes(cleanString(selectedField?.componentKey));
  const genericProtocolTargets = guidedOwnsProtocolFrames ? [] : protocolTargets;
  const showInlineIVCSources = readDomain === 'echo' &&
    selectedField?.componentKey === 'ivcCollapsibility';
  const showGuidedIVCValue = showInlineIVCSources;
  const ivcMeasurementState = showInlineIVCSources
    ? getResearchIVCPhaseDisplayState(selectedField, allAnnotations, context?.sourceStudyInstanceUID)
    : null;
  const ivcSource = showInlineIVCSources ? calculatedReadState.sources[selectedField.key] : null;
  const ivcValue = showInlineIVCSources ? calculatedReadState.values[selectedField.key] : null;
  const guidedIVCValue = ivcMeasurementState?.candidate &&
    ivcSource?.source === 'viewer-derived' &&
    ivcSource.sourceMeasurementKey === ivcMeasurementState.candidate.sourceMeasurementKey &&
    ivcValue != null && String(ivcValue).trim() !== '' &&
    Math.abs(Number(ivcValue) - Number(ivcMeasurementState.candidate.value)) <=
      Math.max(0.005000001, Number(selectedField?.config?.step || 0.01) / 2 + 1e-9)
    ? ivcValue : null;
  const rapFields = groupedFields.filter(item => item.componentKey === 'rap');
  const rvspFields = groupedFields.filter(item => item.componentKey === 'rvsp');
  const rapField = rapFields.length === 1 ? rapFields[0] : null;
  const rvspField = rvspFields.length === 1 ? rvspFields[0] : null;
  const rapChoices = rapField ? getResearchRapChoices(rapField, readDomain).map(value => {
    const configured = rapField.config?.options?.find(option =>
      String(option?.value ?? option?.label ?? option ?? '').trim() === value);
    const label = cleanString(configured?.label || value);
    return { value, label: /mmhg/i.test(label) ? label : label + ' mmHg' };
  }) : [];
  const formula = rvspField?.config?.calculation;
  const trFields = fields.filter(item => item.componentKey === formula?.trVmaxComponentKey);
  const linkedTR = trFields.length === 1 && trFields[0].componentKey === 'trVmax' ? trFields[0] : null;
  const useSharedRap = isIVCRapRVSPQuestion && !!rapField && !!rvspField &&
    rapChoices.length > 0 && formula?.type === 'rvsp' &&
    formula.rapComponentKey === rapField.componentKey && !!linkedTR &&
    [rapField, rvspField].every(item => cleanString(item.config?.unit).toLowerCase() === 'mmhg') &&
    cleanString(linkedTR.config?.unit).toLowerCase() === 'm/s';
  const rapSelection = useSharedRap ? String(calculatedReadState.values[rapField.key] ?? '').trim() : '';
  const rapComplete = !!rapSelection && rapChoices.some(choice => choice.value === rapSelection);
  const linkedTRValue = linkedTR ? calculatedReadState.values[linkedTR.key] : null;
  const linkedTRState = useSharedRap ? getResearchTRVmaxSourceState(
    linkedTR, calculatedReadState.sources[linkedTR.key], allAnnotations, context?.sourceStudyInstanceUID
  ) : null;
  const linkedTRRecorded = !!linkedTRState?.selected && linkedTRValue != null &&
    cleanString(linkedTRValue) !== '' && Number.isFinite(Number(linkedTRValue)) &&
    Math.abs(Number(linkedTRValue) - Number(linkedTRState.selected.candidate.value)) <=
      Math.max(0.005000001, Number(linkedTR?.config?.step || 0.01) / 2 + 1e-9);
  const sharedRVSP = useSharedRap && linkedTRRecorded && rapComplete &&
    calculatedReadState.sources[rvspField.key]?.source === 'viewer-derived'
    ? calculatedReadState.values[rvspField.key] : null;
  const isSelectedMeasurement = selectedField && (
    ['measurement', 'continuous'].includes(cleanString(selectedField.kind).toLowerCase()) ||
    !!selectedField?.config?.calculation
  );
  const completedFields = visibleFields.filter(field =>
    isResearchQuestionAnswered(
      field, fields, calculatedReadState.values, readDomain, questionNavigationMode
    )
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
          label: getResearchQuestionLabel(field, fields, readDomain, questionNavigationMode),
          answered: isResearchQuestionAnswered(
            field, fields, calculatedReadState.values, readDomain, questionNavigationMode
          ),
          required: field.required,
        })),
      }]}
      selectedKey={selectedField?.key || ''}
      selectedQuestion={selectedField ? {
        key: selectedField.key,
        index: visibleFields.indexOf(selectedField),
        title: getResearchQuestionLabel(selectedField, fields, readDomain, questionNavigationMode),
        required: selectedField.required,
        hasViewerTarget: getResearchProtocolViewerTargets(selectedField).length > 0,
      } : null}
      onSelect={selectField}
      onActivateSelected={selectedField && context.readOnly && !context.preview
        ? () => selectField(selectedField.key) : undefined}
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
      {canShowResearchAcquisitionInputs(context) ? (
        <ResearchAcquisitionInputs key={context.reviewKey}
          reviewKey={context.reviewKey} readOnly={context.readOnly}
          disabled={saving || completing || scoreBusy} onBusy={setAcquisitionBusy}
          onEvidenceState={setAcquisitionEvidence} automatic={automaticZScore} />
      ) : null}
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
            {!isBatchFramePicker && protocolFramePickerIntent.phaseKey
              ? ' / ' + protocolFramePickerIntent.phaseKey : ''}.
            Select the correct instance and cine frame in the viewer first.
            {isBatchFramePicker
              ? ' Capture each phase here without reopening the viewer.' : ''}
          </p>
          {isBatchFramePicker && capturePhases.length > 0 ? (
            <label className="mt-2 block text-xs">
              Contour / measurement phase
              <select
                className="mt-1 block w-full rounded border border-cyan-500 bg-gray-950 p-2 text-white"
                value={capturePhaseKey}
                disabled={capturingProtocolFrame}
                onChange={event => setCapturePhaseSelection(event.target.value)}
              >
                {capturePhases.map(phase => (
                  <option key={phase.slot} value={phase.slot}>{phase.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="mt-2 rounded border border-cyan-500 bg-cyan-900 px-3 py-2 font-semibold text-white disabled:opacity-40"
            disabled={capturingProtocolFrame || !commandsManager}
            onClick={() => void captureCurrentProtocolFrame()}
          >
            {capturingProtocolFrame
              ? 'Capturing current frame…'
              : isBatchFramePicker && capturePhaseKey
                ? 'Capture ' + capturePhaseKey + ' frame'
                : 'Capture current frame'}
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
          {selectedTR ? (
            <SharedTRVmaxQuestionAnswer captured={trCaptured} value={trValue}
              ownerLabel="reader" captureLabel="Read"
              disabled={isBusy} readOnly={context.readOnly || context.preview}
              showInstructions={!trCaptured && !trNeedsResolution}
              issue={trNeedsResolution ? 'TR Vmax source needs review before it can be used as a verified answer.' : ''}
              onNavigate={trState?.selected ? () => queueNavigation(async isCancelled => {
                await restoreResearchAnnotationSource(trState.selected, isCancelled);
              }) : undefined}
              onDelete={trState?.selected ? () => void deleteResearchAnnotation(trState.selected.annotation) : undefined}
            />
          ) : null}
          {!selectedTR && !selectedContourComposite && !showGuidedIVCValue && selectedField?.componentKey !== 'lvEjectionFraction' ? (
            <ReadField
              key={selectedField.key}
              field={selectedField}
              readDomain={readDomain}
              hideHeader
              lengthAnswer={selectedLength}
              measurementLabel={lengthState?.selected
                ? getAnnotationLabel(lengthState.selected.annotation) : ''}
              value={calculatedReadState.values[selectedField.key] ?? ''}
              source={calculatedReadState.sources[selectedField.key]}
              disabled={context.readOnly || context.preview || isBusy}
              onChange={nextValue => updateValue(selectedField.key, nextValue)}
              onDelete={selectedLength && !lengthState?.selected &&
                !(lengthState?.status === 'manual' &&
                  cleanString(calculatedReadState.values[selectedField.key])) ? undefined : () => {
                if (lengthState?.selected) {
                  void deleteResearchAnnotation(lengthState.selected.annotation);
                  return;
                }
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
          {showZScore ? (
            savedZScoreEvidence && !saving && !completing && !acquisitionBusy ? (
              <ResearchReadZScore
                key={`${context.reviewKey}:${selectedField.key}:${context.review.savedAt}:${acquisitionEvidence.revision}:${reviewStatus}`}
                reviewKey={context.reviewKey} field={selectedField} savedAt={context.review.savedAt}
                acquisitionRevision={acquisitionEvidence.revision} readOnly={context.readOnly}
                disabled={saving || completing || acquisitionBusy}
                visibility={context.readSchema.config.zScore.visibility} completed={reviewStatus === 'completed'}
                onBusy={setScoreBusy} automatic={automaticZScore} />
            ) : previewRequestBody ? <ResearchReadZScorePreview
                key={JSON.stringify([context.reviewKey,context.review?.savedAt,previewRequestBody])}
                reviewKey={context.reviewKey} field={selectedField}
                acquisitionRevision={acquisitionEvidence.revision} requestBody={previewRequestBody} />
              : <p className="mt-2 text-xs text-gray-400">{automaticZScore ? "Confirm acquisition inputs and reference eligibility, then capture a calibrated measurement. Save Read to persist eligible Z-scores; visibility follows the protocol." : "Save the measurement and confirmed acquisition inputs before verifying its Z-score."}</p>
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
          {!selectedTR && cleanString(context?.readSchema?.domain).toLowerCase() === 'echo' ? (
            <ResearchEchoGuidedControls
              field={selectedField}
              commandsManager={commandsManager}
              sourceAnnotations={selectedSources}
              assessmentSavedEFAnnotations={selectedField?.componentKey === 'lvEjectionFraction'
                ? getResearchEFRestoreSources(
                    selectedField,
                    allAnnotations.filter(annotation =>
                      String(annotation?.StudyInstanceUID || annotation?.referenceStudyUID || '') ===
                        String(context?.sourceStudyInstanceUID || '') &&
                      (!invalidatedEFSourceIdsRef.current.has(getAnnotationKey(annotation)) ||
                        liveAnnotations.some(item => getAnnotationKey(item) === getAnnotationKey(annotation)))
                    ),
                    calculatedReadState.sources[selectedField.key]?.sourceMeasurementKey
                  )
                : null}
              assessmentSavedEFResult={selectedField?.componentKey === 'lvEjectionFraction'
                ? persistedEF : null}
              ivcMeasurementState={ivcMeasurementState}
              ivcReadValue={guidedIVCValue}
              ivcManualValue={ivcSource?.source === 'manual' ? ivcValue : null}
              onClearIVCManualValue={() => {
                if (!editingAllowedRef.current || valueSourcesRef.current[selectedField.key]?.source !== 'manual') return;
                const key = selectedField.key;
                setValues(current => { const next = { ...current }; delete next[key]; return next; });
                setValueSources(current => {
                  if (current[key]?.source !== 'manual') return current;
                  const next = { ...current }; delete next[key]; valueSourcesRef.current = next; return next;
                });
              }}
              contourPhaseState={contourPhaseState}
              contourValue={contourValue}
              contourManualValue={contourManualValue}
              hasContourManualSource={hasContourManualSource}
              onClearContourManualValue={() => {
                if (context.readOnly || context.preview || isBusy) return;
                if (selectedLA) {
                  updateValue(selectedField.key, '');
                  return;
                }
                // Release only a legacy RV manual override; clearing it must
                // not leave a manual source flag that suppresses auto-binding.
                const key = selectedField.key;
                if (!selectedRVFAC || valueSourcesRef.current[key]?.source !== 'manual') return;
                setValues(current => {
                  const next = { ...current };
                  delete next[key];
                  return next;
                });
                setValueSources(current => {
                  if (current[key]?.source !== 'manual') return current;
                  const next = { ...current };
                  delete next[key];
                  valueSourcesRef.current = next;
                  return next;
                });
              }}
              onViewContourSource={item => queueNavigation(async isCancelled => {
                await restoreResearchAnnotationSource(item, isCancelled);
              })}
              onDeleteContourSource={annotation => void deleteResearchAnnotation(annotation)}
              onViewContourProtocolTarget={slot => queueNavigation(async isCancelled => {
                if (!isCancelled()) await jumpToProtocolTarget(
                  getResearchEchoPhaseTarget(selectedField, slot), selectedField.key);
              })}
              onRecalculateLA={selectedLA
                ? () => refreshViewerMeasurementBindings(undefined, selectedField.key) : undefined}
              efValue={calculatedReadState.values[selectedField.key] ?? ''}
              onChangeEFValue={nextValue => updateValue(selectedField.key, nextValue)}
              onDeleteEFValue={() => {
                const source = calculatedReadState.sources[selectedField.key];
                if (['viewer-derived', 'viewer-measurement'].includes(source?.source)) {
                  if (selectedSources.length === 1) {
                    void deleteResearchAnnotation(selectedSources[0]);
                  } else {
                    notify(servicesManager,
                      'Open the EF panel to manage the linked contours.',
                      'warning');
                  }
                } else {
                  updateValue(selectedField.key, '');
                }
              }}
              onBeginIVCPhaseRedraw={beginIVCPhaseRedraw}
              onViewIVCSource={item => queueNavigation(async isCancelled => {
                await restoreResearchAnnotationSource(item, isCancelled);
              })}
              onDeleteIVCSource={annotation => void deleteResearchAnnotation(annotation)}
              disabled={context.preview || isBusy}
              readOnly={context.readOnly || context.preview}
              onError={message => notify(servicesManager, message, 'warning')}
            />
          ) : null}
          {selectedField?.componentKey === 'lvEjectionFraction' && (
            <EchoEFContourVolumes
              volumes={displayedEFVolumes}
              status={persistedEF ? 'Saved' : Object.keys(liveVerifiedEchoEvidence.efVolumes).length ? 'Current' : 'Saved'}
            />
          )}
          {selectedTR && trNeedsResolution ? (
            <div className="rounded border border-gray-700 p-2 text-xs space-y-2">
              <div className="font-semibold">Resolve TR Vmax source</div>
              {trState.status === 'manual' || trState.status === 'invalid' ||
                (trState.status === 'linked' && !trCaptured) ? (
                <div className="text-amber-200">Existing answer: {cleanString(trValue) || 'unavailable'} m/s.
                  It has not been changed.</div>
              ) : null}
              {trState.eligible.map(item => (
                <div key={item.candidate.sourceMeasurementKey} className="flex flex-wrap gap-2 items-center">
                  <button type="button" className="text-cyan-200 underline"
                    onClick={() => queueNavigation(async isCancelled => {
                      await restoreResearchAnnotationSource(item, isCancelled);
                    })}>{Number(item.candidate.value).toFixed(2)} m/s · View source</button>
                  {!context.readOnly && !context.preview ? (
                    <>
                      <button type="button" disabled={isBusy} className="text-cyan-200 underline"
                        onClick={() => {
                          selectSourceCandidate(selectedField, item.candidate);
                          queueNavigation(async isCancelled => {
                            await restoreResearchAnnotationSource(item, isCancelled);
                          });
                        }}>Use source</button>
                      <button type="button" disabled={isBusy} className="text-red-200 underline"
                        aria-label="Delete this TR Vmax source"
                        onClick={() => void deleteResearchAnnotation(item.annotation)}>×</button>
                    </>
                  ) : null}
                </div>
              ))}
              {!context.readOnly && !context.preview && ['manual', 'invalid'].includes(trState.status) ? (
                <button type="button" disabled={isBusy} className="text-red-200 underline"
                  onClick={() => {
                    if (!editingAllowedRef.current ||
                        !window.confirm('Clear the TR Vmax answer link? Source annotations will be preserved.')) return;
                    const key = selectedField.key;
                    setValues(current => { const next = { ...current }; delete next[key]; return next; });
                    setValueSources(current => {
                      const next = { ...current }; delete next[key]; valueSourcesRef.current = next; return next;
                    });
                  }}>Clear answer link</button>
              ) : null}
            </div>
          ) : null}
          {!selectedTR && !selectedContourComposite && !showInlineIVCSources &&
            selectedField?.componentKey !== 'lvEjectionFraction' &&
            (selectedLength ? showLengthSourceResolution :
              (isSelectedMeasurement || genericProtocolTargets.length > 0)) ? (
            <div className="rounded border border-gray-700 bg-gray-950 p-3 text-xs">
              <div className="font-semibold text-gray-100">Measurement sources</div>
              {selectedLength && lengthState?.status === 'invalid' ? (
                <div role="alert" className="mt-2 text-amber-200">
                  The linked Length source is missing or does not match the configured study/frame.
                  The saved answer has not been changed.
                </div>
              ) : null}
              {!selectedLength && genericProtocolTargets.length ? (
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
                        onClick={() => {
                          const item = lengthState?.eligible.find(source =>
                            getAnnotationKey(source.annotation) === getAnnotationKey(annotation));
                          if (item) viewLengthSource(item);
                          else if (!selectedLength) void jumpToAnnotation(annotation);
                        }}
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
              {isSelectedMeasurement && (selectedLength
                ? sourceResolutionCandidates.length > 0 : selectedCandidates.length > 1) &&
                !context.preview && !context.readOnly ? (
                <div className="mt-2 space-y-1">
                  <div className="text-amber-200">
                    Multiple matching measurements. Choose the intended source rather than automatically accepting another frame.
                  </div>
                  {sourceResolutionCandidates.map((candidate, index) => (
                    <button
                      key={candidate.sourceMeasurementKey || index}
                      type="button"
                      className="block w-full rounded border border-blue-800 px-2 py-2 text-left text-blue-100 hover:bg-blue-950/40"
                      onClick={() => {
                        selectSourceCandidate(selectedField, candidate);
                        const item = lengthState?.eligible.find(source =>
                          source.candidate.sourceMeasurementKey === candidate.sourceMeasurementKey);
                        if (item) viewLengthSource(item);
                      }}
                    >
                      Use {Number(candidate.value).toFixed(2)} {candidate.unit}
                      {' · '}{candidate.sourceMeasurementKey}
                    </button>
                  ))}
                </div>
              ) : null}
              {!selectedLength && isSelectedMeasurement && !selectedSources.length &&
               !guidedOwnsProtocolFrames && !genericProtocolTargets.length ? (
                <div className="mt-2 text-gray-400">
                  {selectedCandidates.length
                    ? 'A compatible value is available. Its source frame will appear when the annotation is ready.'
                    : 'Choose the appropriate image and frame in the viewer, then use the measurement toolbar. The calibrated value will populate here automatically.'}
                </div>
              ) : null}
            </div>
          ) : null}
          {useSharedRap ? (
            <>
              <SharedIVCRapRVSPAnswer
                completeIVC={guidedIVCValue != null}
                selection={rapSelection} choices={rapChoices} rapComplete={rapComplete}
                trIsRecorded={linkedTRRecorded} trValue={linkedTRRecorded ? Number(linkedTRValue) : null}
                rvspValue={sharedRVSP} ownerLabel="reader" captureLabel="Read" allowClear
                disabled={isBusy} readOnly={context.readOnly || context.preview}
                onChange={value => {
                  if (editingAllowedRef.current && guidedIVCValue != null &&
                      (value === '' || rapChoices.some(choice => choice.value === value))) {
                    updateValue(rapField.key, value);
                  }
                }}
                onViewTR={() => selectField(linkedTR.key)}
              />
              {groupedFields.filter(item => item !== rapField && item !== rvspField).map(groupedField => (
                <ReadField key={groupedField.key} field={groupedField} readDomain={readDomain}
                  value={calculatedReadState.values[groupedField.key] ?? ''}
                  source={calculatedReadState.sources[groupedField.key]}
                  disabled={context.readOnly || context.preview || isBusy}
                  onChange={value => updateValue(groupedField.key, value)} />
              ))}
            </>
          ) : isIVCRapRVSPQuestion ? (
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
          {showInlineIVCSources && !context.readOnly && !context.preview && guidedIVCValue == null ? (
            <div className="text-xs text-gray-400">Draw or select a measurement annotation in the viewport.</div>
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
