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
