import {
  calculateIVCFromMeasurements,
  isIVCDiameterMeasurement,
} from '../../../extension-ar-measurements/src/utils/rightHeartMeasurements';
import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';

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
  const matchedAnnotations = sourceKeys
    .map(key => annotations.find(item => cleanString(
      item?.annotationId || item?.annotationUID || item?.uid || item?.id
    ) === key))
    .filter(Boolean);
  if (!matchedAnnotations.length) return false;
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
    unmatchedSources: allIVC.length - selected.length,
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
  const fixedPhases = field?.config?.compositeFrameTargets;
  if (cleanString(field?.componentKey) !== 'ivcCollapsibility' ||
      !fixedPhases || typeof fixedPhases !== 'object' ||
      !fixedPhases.IVC_EXP || !fixedPhases.IVC_INSP) return sources;

  const current = sources?.[field.key] || {};
  const currentKind = cleanString(current.source);
  const previousKey = cleanString(current.sourceMeasurementKey);
  // When the reader intentionally replaces a validated Length, both source
  // annotation IDs change. Keep the no-guessing rule: release the previous key
  // only if there is exactly one compatible, verified IVC candidate.
  const eligible = (Array.isArray(candidates) ? candidates : []).filter(item =>
    cleanString(item.source) === 'viewer-derived' &&
    cleanString(item.sourceMeasurementKey).startsWith('ivc-collapse:')
  );
  const changedVerifiedSource = eligible.length === 1 &&
    !!previousKey && previousKey !== cleanString(eligible[0].sourceMeasurementKey);
  if (currentKind !== 'manual' && !changedVerifiedSource) return sources;

  return { ...sources, [field.key]: {
    source: 'viewer-derived', sourceMeasurementKey:
      changedVerifiedSource ? '' : previousKey,
  } };
}
