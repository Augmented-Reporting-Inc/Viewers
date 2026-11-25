import {
  calculateIVCFromMeasurements,
  isIVCDiameterMeasurement,
} from '../../../extension-ar-measurements/src/utils/rightHeartMeasurements';
import { buildViewerMeasurementValueCandidates, getResearchTRVelocityCandidate } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import { getResearchMeasurementToolForField } from './researchMeasurementTool';
import { buildViewerMeasurementReadUpdates } from './readSchema';
import { getEchoAreaSlot, getCalibratedEchoAreaCM2 } from '../../../extension-ar-measurements/src/utils/echoAreaMeasurements';
import { getLAVolumeContourSlot, getVerifiedLAVolumeContourAreaCM2 } from '../../../extension-ar-measurements/src/utils/laVolume';
import { getResearchEchoPhaseTarget, isRequiredResearchPhaseMissing } from './researchEchoWorkflow';

/**
 * Reuse existing OHIF viewer navigation commands rather than duplicating image
 * or frame selection in Research. Targets are optional ReadSchema configuration;
 * source annotations come from this review's saved/live measurement evidence.
 */
function cleanString(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeLabels(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanString).filter(Boolean)
    : [];
}

function token(value: unknown) {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getResearchFieldMeasurementCandidates(field: any, candidates: any[] = []) {
  const labels = new Set(normalizeLabels(field?.config?.measurementLabels).map(token));
  if (!labels.size) return [];

  return candidates.filter(candidate =>
    normalizeLabels(candidate?.labels).some(label => labels.has(token(label))) &&
    !!cleanString(candidate?.sourceMeasurementKey)
  );
}

export function getResearchSourceAnnotationIds(sourceKey: unknown): string[] {
  let key = cleanString(sourceKey);
  if (!key) return [];
  if (key.startsWith('rvsp:')) {
    key = key.slice('rvsp:'.length).split('+rap:')[0];
  }
  const compositePrefixes = ['lv-simpson:', 'la-disks:', 'rv-fac:', 'ivc-collapse:'];
  const prefix = compositePrefixes.find(item => key.startsWith(item));
  if (prefix) key = key.slice(prefix.length);
  return Array.from(new Set(key.split(',').map(cleanString).filter(Boolean)));
}

export function getResearchFieldSourceAnnotations(
  fieldSource: any,
  annotations: any[] = [],
  candidates: any[] = []
) {
  const keys = new Set([
    ...getResearchSourceAnnotationIds(fieldSource?.sourceMeasurementKey),
    ...candidates.flatMap(candidate => getResearchSourceAnnotationIds(candidate?.sourceMeasurementKey)),
  ]);
  if (!keys.size) return [];
  return annotations.filter(annotation =>
    keys.has(cleanString(
      annotation?.annotationId || annotation?.annotationUID ||
      annotation?.uid || annotation?.id
    ))
  );
}

export function getResearchProtocolViewerTargets(field: any): Array<{label: string; viewerTarget: any}> {
  const config = field?.config || {};
  const targets: Array<{label: string; viewerTarget: any}> = [];

  const valid = (source: any) => source && typeof source === 'object' &&
    !!cleanString(source.sopInstanceUID || source.SOPInstanceUID || source.referencedImageId) &&
    Number.isInteger(Number(source.frameNumber)) && Number(source.frameNumber) > 0;
  if (valid(config.viewerTarget)) {
    targets.push({ label: 'Protocol target', viewerTarget: config.viewerTarget });
  }
  const phases = config.compositeFrameTargets && typeof config.compositeFrameTargets === 'object'
    ? config.compositeFrameTargets : {};
  for (const [label, target] of Object.entries(phases)) {
    if (valid(target)) targets.push({ label, viewerTarget: target });
  }
  return targets;
}

/**
 * A multi-phase question normally waits for the reader to choose a phase.
 * For Research IVC, the initial expiration phase is explicitly defined by
 * protocol and is also the natural starting point in Education. Never use
 * generic "first target" ordering for EF/LA/RV or invent a missing IVC frame.
 */
export function getResearchQuestionEntryTarget(field: any) {
  const targets = getResearchProtocolViewerTargets(field);
  if (String(field?.componentKey || '').trim() === 'ivcCollapsibility') {
    return targets.find(item => item.label === 'IVC_EXP')?.viewerTarget || null;
  }
  if (targets.length === 1) return targets[0].viewerTarget;
  return null;
}

/**
 * Exact protocol source guard. Composite results can contain multiple source
 * annotation IDs, so compare their *sets* to distinct configured phase targets;
 * never accept a visually similar but different DICOM frame.
 *
 * A protocol without configured frames leaves the existing reader freedom
 * unchanged. Invalid/incomplete required phase configuration fails closed.
 */
function getAnnotationSourceFrame(annotation: any = {}) {
  const referencedImageId = cleanString(
    annotation?.referencedImageId || annotation?.metadata?.referencedImageId
  );
  const frameFromImage = referencedImageId.match(/\/frames\/(\d+)(?:\b|[/?#])/i) ||
    referencedImageId.match(/[?&]frame(?:Number)?=(\d+)/i);
  // A Length adapter can retain frameNumber=1 after a cine navigation.
  // The actual DICOMweb image frame is authoritative when present.
  const frame = Number(
    frameFromImage ? frameFromImage[1] :
    (annotation?.frameNumber ?? annotation?.FrameNumber ?? '')
  );
  const storedSop = cleanString(
    annotation?.SOPInstanceUID || annotation?.sopInstanceUID ||
    annotation?.metadata?.SOPInstanceUID
  );
  const imageSopMatch = referencedImageId.match(/\/instances\/([^/?#]+)/i);
  let imageSop = '';
  if (imageSopMatch) {
    try {
      imageSop = decodeURIComponent(imageSopMatch[1]);
    } catch {
      imageSop = 'invalid-dicom-instance';
    }
  }
  return {
    // Never treat contradictory SOP IDs as a verified protocol source.
    sop: storedSop && imageSop && storedSop !== imageSop
      ? '' : (storedSop || imageSop),
    series: cleanString(
      annotation?.referenceSeriesUID || annotation?.SeriesInstanceUID ||
      annotation?.seriesInstanceUID
    ),
    study: cleanString(
      annotation?.referenceStudyUID || annotation?.StudyInstanceUID ||
      annotation?.studyInstanceUID
    ),
    frame,
  };
}

function annotationMatchesTarget(annotation: any, target: any) {
  const source = getAnnotationSourceFrame(annotation);
  const sop = cleanString(target?.sopInstanceUID || target?.SOPInstanceUID);
  const series = cleanString(target?.seriesInstanceUID || target?.SeriesInstanceUID);
  const study = cleanString(target?.studyInstanceUID || target?.StudyInstanceUID);
  return !!source.sop && !!sop &&
    Number.isInteger(source.frame) && source.frame > 0 &&
    source.sop === sop && source.frame === Number(target?.frameNumber) &&
    (!series || source.series === series) &&
    (!study || source.study === study);
}

export function isResearchCandidateOnProtocolFrames(
  field: any, candidate: any, annotations: any[] = []
) {
  const config = field?.config || {};
  const fixedTargets = getResearchProtocolViewerTargets(field);
  const phases = config.compositeFrameTargets && typeof config.compositeFrameTargets === 'object'
    ? Object.keys(config.compositeFrameTargets) : [];
  if (config.compositeFrameGuidanceEnabled === true) {
    // Guard incomplete configs as well as missing/reordered phase sources.
    const expected: Record<string, number> = {
      lvEjectionFraction: 4, laVolumeDisks: 2,
      rvFac: 2, ivcCollapsibility: 2,
    };
    const required = expected[cleanString(field?.componentKey)] || 0;
    if (!required || phases.length !== required ||
      fixedTargets.length !== required) return false;
  }
  if (!fixedTargets.length) return true;
  const sourceKeys = getResearchSourceAnnotationIds(candidate?.sourceMeasurementKey);
  // The composite derived result must contain exactly one source per
  // configured protocol phase, not a convenient subset plus unrelated ROI.
  const completePhaseCounts: Record<string, number> = {
    lvEjectionFraction: 4, laVolumeDisks: 2,
    rvFac: 2, ivcCollapsibility: 2,
  };
  const completeCount = completePhaseCounts[cleanString(field?.componentKey)];
  // Cardinality equality only applies when the protocol pins *every* phase.
  // A legacy partially pinned protocol may legitimately have more distinct
  // annotation sources than its configured target subset.
  if (completeCount && fixedTargets.length === completeCount &&
      sourceKeys.length !== completeCount) return false;
  if (new Set(sourceKeys).size !== sourceKeys.length) return false;
  const matchedAnnotations = sourceKeys
    .map(key => annotations.find(item => cleanString(
      item?.annotationId || item?.annotationUID || item?.uid || item?.id
    ) === key))
    .filter(Boolean);
  if (matchedAnnotations.length !== sourceKeys.length) return false;
  const remaining = [...matchedAnnotations];
  for (const { viewerTarget } of fixedTargets) {
    const index = remaining.findIndex(annotation =>
      annotationMatchesTarget(annotation, viewerTarget)
    );
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

export function getResearchProtocolCompatibleCandidates(
  field: any, candidates: any[] = [], annotations: any[] = []
) {
  return candidates.filter(candidate =>
    isResearchCandidateOnProtocolFrames(field, candidate, annotations)
  );
}

/** Verify the identity of Review-owned source evidence, not the current image.
 * A display copy normalizes a stale frameNumber without rewriting stored data. */
function getResearchOwnedSourceDisplay(annotation: any, study: string) {
  const frame = getAnnotationSourceFrame(annotation);
  const reference = cleanString(annotation?.referencedImageId ||
    annotation?.metadata?.referencedImageId);
  const imageStudy = reference.match(/\/studies\/([^/?#]+)/i)?.[1];
  const imageSeries = reference.match(/\/series\/([^/?#]+)/i)?.[1];
  try {
    if ((imageStudy && decodeURIComponent(imageStudy) !== study) ||
        (imageSeries && frame.series && decodeURIComponent(imageSeries) !== frame.series)) return null;
  } catch { return null; }
  if (!study || frame.study !== study || !frame.sop ||
      !Number.isInteger(frame.frame) || frame.frame < 1) return null;
  return { ...annotation, StudyInstanceUID: frame.study, SeriesInstanceUID: frame.series,
    SOPInstanceUID: frame.sop, frameNumber: frame.frame };
}

/** The compact question layout is only for independent Echo Length fields. */
export function isResearchLengthQuestion(field: any, domain: string) {
  return getResearchMeasurementToolForField(field, domain) === 'Length' &&
    !['lvEjectionFraction', 'laVolumeDisks', 'rvFac', 'ivcCollapsibility', 'trVmax', 'rap', 'rvsp']
      .includes(cleanString(field?.componentKey)) &&
    !field?.config?.calculation && !field?.config?.options?.length &&
    !Object.keys(field?.config?.compositeFrameTargets || {}).length;
}

/** Use only Review-owned, compatible Length sources on the configured study
 * and any pinned frame. A linked source is authoritative; do not guess a
 * replacement or change manual answers. Normalize a display copy only. */
function getResearchSingleSourceState(
  field: any, fieldSource: any, annotations: any[],
  candidates: any[], studyInstanceId: unknown, toolName: string
) {
  const study = cleanString(studyInstanceId);
  const eligible = getResearchCompatibleMeasurementCandidates(field, candidates, annotations)
    .filter(candidate => candidate?.source === 'viewer-measurement' &&
      Number.isFinite(Number(candidate.value)) && Number(candidate.value) > 0 &&
      buildViewerMeasurementReadUpdates([field], [candidate], {}).length === 1)
    .flatMap(candidate => {
      const matches = getResearchFieldSourceAnnotations(
        { sourceMeasurementKey: candidate.sourceMeasurementKey }, annotations);
      if (matches.length !== 1) return [];
      const annotation = matches[0];
      const displayAnnotation = getResearchOwnedSourceDisplay(annotation, study);
      if (!displayAnnotation || annotation.toolName !== toolName ||
          !Array.isArray(annotation.points) || annotation.points.length !== 2 ||
          !annotation.points.every(point => Array.isArray(point) && point.length >= 3 &&
            point.slice(0, 3).every(Number.isFinite))) return [];
      return [{ candidate, annotation, displayAnnotation }];
    });
  const unique = Array.from(new Map(eligible.map(item =>
    [cleanString(item.candidate.sourceMeasurementKey), item])).values());
  const linkedKey = cleanString(fieldSource?.sourceMeasurementKey);
  const kind = cleanString(fieldSource?.source);
  const selected = kind === 'viewer-measurement' && linkedKey
    ? unique.find(item => cleanString(item.candidate.sourceMeasurementKey) === linkedKey) || null
    : null;
  const status = selected ? 'linked' : linkedKey || kind === 'viewer-derived'
    ? 'invalid' : kind === 'manual' ? 'manual'
      : unique.length > 1 ? 'ambiguous' : unique.length === 1 ? 'unbound' : 'none';
  return { status, selected, eligible: unique };
}

export function getResearchLengthSourceState(
  field: any, fieldSource: any, annotations: any[] = [],
  candidates: any[] = [], studyInstanceId: unknown = ''
) {
  return getResearchSingleSourceState(field, fieldSource, annotations,
    candidates, studyInstanceId, 'Length');
}

export function isResearchTRVmaxQuestion(field: any, domain: string) {
  return String(domain || '').toLowerCase() === 'echo' && field?.componentKey === 'trVmax';
}

/** Use the existing strict spectral conversion, not generic ROI candidates
 * or displayed text. Reuse Length's owned source/geometry/frame resolution. */
export function getResearchTRVmaxSourceState(
  field: any, fieldSource: any, annotations: any[] = [], studyInstanceId: unknown = ''
) {
  const candidates = annotations.flatMap(annotation => {
    const directional = annotation?.ultrasoundDirectional || annotation?.measurements?.ultrasoundDirectional;
    if (directional?.isUnitless === true || directional?.isHorizontal === true) return [];
    const result = getResearchTRVelocityCandidate(annotation);
    return result?.candidate ? [result.candidate] : [];
  });
  const state = getResearchSingleSourceState(field, fieldSource, annotations,
    candidates, studyInstanceId, 'UltrasoundDirectionalTool');
  // An explicitly configured but incomplete target is not an unpinned protocol.
  const target = getResearchEchoPhaseTarget(field, '');
  if ((target && !getResearchProtocolViewerTargets(field).length) ||
      isRequiredResearchPhaseMissing(field, '')) {
    return { status: 'invalid', selected: null, eligible: [] };
  }
  return state;
}

/** Shared Review-owned LA/RV contour display. Use the existing calibrated
 * area engines; retain off-protocol sources for explicit inspection/deletion. */
function getResearchContourPhaseSources(
  field: any, annotations: any[], studyInstanceId: unknown,
  kind: 'laVolumeDisks' | 'rvFac'
) {
  const study = cleanString(studyInstanceId);
  const isLA = kind === 'laVolumeDisks';
  const slots = isLA ? ['A4C', 'A2C'] : ['RV_ED', 'RV_ES'];
  const phaseSources: Record<string, Array<{
    annotation: any; displayAnnotation: any; areaCM2: number | null; matchesTarget: boolean;
  }>> = Object.fromEntries(slots.map(slot => [slot, []]));
  let unresolvedCount = 0;
  if (field?.componentKey !== kind) return { phaseSources, unresolvedCount };
  const seen = new Set<string>();
  for (const annotation of annotations) {
    const geometry = annotation?.laVolume || annotation?.measurements?.laVolume;
    if (isLA && geometry?.measurementKind !== 'laVolumeSlot' &&
        annotation?.measurementKind !== 'laVolumeSlot' &&
        annotation?.measurements?.measurementKind !== 'laVolumeSlot') continue;
    const slot = isLA ? getLAVolumeContourSlot(annotation) : getEchoAreaSlot(annotation);
    // RA and generic ROIs are not RV phase evidence.
    if (!isLA && !slots.includes(slot || '')) continue;
    const id = cleanString(annotation?.annotationId || annotation?.annotationUID ||
      annotation?.uid || annotation?.id);
    if (seen.has(id)) continue;
    const displayAnnotation = getResearchOwnedSourceDisplay(annotation, study);
    const tools = isLA ? ['SplineROI', 'PlanarFreehandROI', 'FreehandROI']
      : ['SplineROI', 'PlanarFreehandROI', 'LivewireContour'];
    if (!id || !slot || !phaseSources[slot] || !displayAnnotation ||
        !tools.includes(cleanString(annotation.toolName))) {
      unresolvedCount++;
      continue;
    }
    seen.add(id);
    const target = getResearchEchoPhaseTarget(field, slot);
    const matchesTarget = !isRequiredResearchPhaseMissing(field, slot) &&
      (!target || annotationMatchesTarget(annotation, target));
    const areaCM2 = isLA ? getVerifiedLAVolumeContourAreaCM2({
      ...annotation, measurementKind: 'laVolumeSlot',
    }) : getCalibratedEchoAreaCM2(annotation);
    phaseSources[slot].push({ annotation, displayAnnotation, areaCM2, matchesTarget });
  }
  return { phaseSources, unresolvedCount };
}

/** Existing LA callers retain their source and calibrated-area contract. */
export function getResearchLAPhaseSources(
  field: any, annotations: any[] = [], studyInstanceId: unknown = ''
) {
  return getResearchContourPhaseSources(field, annotations, studyInstanceId, 'laVolumeDisks');
}

export function getResearchRVFACPhaseSources(
  field: any, annotations: any[] = [], studyInstanceId: unknown = ''
) {
  return getResearchContourPhaseSources(field, annotations, studyInstanceId, 'rvFac');
}

/** Echo IVC label identity is shared by the calculator, redraw flow and UI. */
export function getResearchIVCAnnotationSlot(annotation: any): string {
  const label = cleanString(
    annotation?.label || annotation?.measurementRole || annotation?.role
  ).toLowerCase().replace(/[\s_-]+/g, '');
  if (['ivcexp', 'ivcexpiration', 'ivcendexpiration', 'ivcendexpirationdiameter'].includes(label))
    return 'IVC_EXP';
  if (['ivcinsp', 'ivcinspiration', 'ivcendinspiration', 'ivcendinspirationdiameter'].includes(label))
    return 'IVC_INSP';
  return '';
}

/** Verify the replacement using the calibrated Length engine (never pixels). */
export function isValidResearchIVCPhaseSource(
  field: any, slot: string, annotation: any
) {
  if (!annotation || getResearchIVCAnnotationSlot(annotation) !== slot ||
      !isIVCDiameterMeasurement(annotation)) return false;
  const configuredTarget = field?.config?.compositeFrameTargets?.[slot];
  if (configuredTarget && !annotationMatchesTarget(annotation, configuredTarget)) {
    return false;
  }
  const measurement = calculateIVCFromMeasurements([annotation]);
  const diameter = slot === 'IVC_EXP'
    ? measurement?.values?.expirationDiameterMM
    : measurement?.values?.inspirationDiameterMM;
  return diameter != null && Number.isFinite(Number(diameter)) &&
    (slot === 'IVC_EXP' ? Number(diameter) > 0 : Number(diameter) >= 0);
}

/**
 * Uses the existing calibrated IVC calculator, but restricts Research evidence
 * to the configured DICOM phase source when a fixed frame is provided.
 */
export function getResearchIVCMeasurementState(field: any, annotations: any[] = []) {
  const targets = field?.config?.compositeFrameTargets || {};
  const allIVC = (Array.isArray(annotations) ? annotations : [])
    .filter(isIVCDiameterMeasurement);
  const phaseSources: Record<string, any[]> = {
    IVC_EXP: [],
    IVC_INSP: [],
  };
  for (const annotation of allIVC) {
    const slot = getResearchIVCAnnotationSlot(annotation);
    if (slot && (!targets[slot] || annotationMatchesTarget(annotation, targets[slot]))) {
      phaseSources[slot].push(annotation);
    }
  }
  const selected = [...phaseSources.IVC_EXP, ...phaseSources.IVC_INSP];
  const acceptedIds = new Set(selected.map(item => String(
    item?.annotationId || item?.annotationUID || item?.uid || item?.id || ''
  )));
  // Unmatched IVC annotations can remain visible in Cornerstone even when
  // they must not participate in the Research result. Make them inspectable
  // and explicitly deletable; do not silently discard evidence.
  const excludedAnnotations = allIVC.filter(item => !acceptedIds.has(String(
    item?.annotationId || item?.annotationUID || item?.uid || item?.id || ''
  )));
  const result = calculateIVCFromMeasurements(selected);
  const candidates = buildViewerMeasurementValueCandidates(selected);
  const candidate = getResearchProtocolCompatibleCandidates(
    field, getResearchFieldMeasurementCandidates(field, candidates), selected
  ).find(item =>
    item.source === 'viewer-derived' &&
    cleanString(item.sourceMeasurementKey).startsWith('ivc-collapse:')
  ) || null;

  return {
    status: result?.status || 'incomplete',
    values: result?.values || null,
    message: result?.message || 'Capture both calibrated IVC diameters.',
    candidate,
    annotations: selected,
    phaseSources,
    excludedAnnotations,
    unmatchedSources: excludedAnnotations.length,
  };
}

/** Reuse protocol verification for all other measurements unchanged. */
export function getResearchCompatibleMeasurementCandidates(
  field: any, candidates: any[] = [], annotations: any[] = []
) {
  if (cleanString(field?.componentKey) === 'ivcCollapsibility') {
    const state = getResearchIVCMeasurementState(field, annotations);
    return state.candidate ? [state.candidate] : [];
  }
  return getResearchProtocolCompatibleCandidates(
    field, getResearchFieldMeasurementCandidates(field, candidates), annotations
  );
}

/**
 * With an explicitly pinned IVC source, a manual placeholder must never
 * suppress an actual, uniquely verified calculated result. Do not alter
 * manual-source precedence for unconfigured or non-IVC ReadSchema fields.
 */
export function getResearchBindingSources(
  field: any, sources: Record<string, any> = {}, candidates: any[] = []
) {
  const kind = cleanString(field?.componentKey);
  const isIVC = kind === 'ivcCollapsibility';
  const isGuidedComposite = ['lvEjectionFraction', 'laVolumeDisks', 'rvFac'].includes(kind);
  const fixedPhases = field?.config?.compositeFrameTargets;
  if ((!isIVC && !isGuidedComposite) ||
      !fixedPhases || typeof fixedPhases !== 'object') return sources;
  const requiredSlots: Record<string, string[]> = {
    lvEjectionFraction: ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'],
    laVolumeDisks: ['A4C', 'A2C'],
    rvFac: ['RV_ED', 'RV_ES'],
    ivcCollapsibility: ['IVC_EXP', 'IVC_INSP'],
  };
  const slots = requiredSlots[kind];
  if (!slots.every(slot => !!fixedPhases[slot])) return sources;

  const current = sources?.[field.key] || {};
  const currentKind = cleanString(current.source);
  const previousKey = cleanString(current.sourceMeasurementKey);
  // Retain existing manually selected values unless the protocol pins every
  // phase and a single verified composite calculation supplies replacement.
  // An old source key may be replaced only by one new verified candidate.
  const eligible = (Array.isArray(candidates) ? candidates : []).filter(item =>
    cleanString(item.source) === 'viewer-derived' &&
    cleanString(item.sourceMeasurementKey).startsWith(
      kind === 'lvEjectionFraction' ? 'lv-simpson:' :
      kind === 'laVolumeDisks' ? 'la-disks:' :
      kind === 'rvFac' ? 'rv-fac:' : 'ivc-collapse:'
    )
  );
  const changedVerifiedSource = eligible.length === 1 &&
    !!previousKey && previousKey !== cleanString(eligible[0].sourceMeasurementKey);
  if (currentKind !== 'manual' && !changedVerifiedSource) return sources;
  // Preserve the established IVC contract: a fixed two-phase protocol may
  // release a manual placeholder before a candidate arrives. The caller
  // still requires calibrated, source-linked evidence to populate the value.
  // Newly supported EF/LA/RV fields wait for one verified candidate instead.
  if (eligible.length !== 1 && !(isIVC && currentKind === 'manual')) return sources;
  return { ...sources, [field.key]: {
    source: 'viewer-derived',
    sourceMeasurementKey: changedVerifiedSource ? '' : previousKey,
  } };
}
