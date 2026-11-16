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
  const frame = Number(
    annotation?.frameNumber ?? annotation?.FrameNumber ??
    (frameFromImage ? frameFromImage[1] : '')
  );
  return {
    sop: cleanString(
      annotation?.SOPInstanceUID || annotation?.sopInstanceUID ||
      annotation?.metadata?.SOPInstanceUID
    ),
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
