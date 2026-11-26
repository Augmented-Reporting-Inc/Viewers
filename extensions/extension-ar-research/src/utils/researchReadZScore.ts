// Presentation guards only. Z-scores, BSA and trusted attestations are
// calculated by FormAPI, never inferred from the displayed measurement.
const clean = (v: unknown) => String(v ?? '').trim();

export function canShowResearchZScore(context: any, field: any) {
  const policy = context?.readSchema?.config?.zScore;
  return !!context?.reviewKey && !context.preview &&
    context.review?.reviewType === 'independent' && context.readSchema?.domain === 'echo' &&
    policy?.enabled === true && policy?.verificationMode === 'reader_attestation' &&
    policy?.readerAnthropometrics === 'override' && field?.config?.zScore?.enabled === true &&
    !!clean(field.config.zScore.parameterKey);
}

function sourceSignature(a: any) {
  const id = clean(a?.annotationId || a?.uid);
  const study = clean(a?.StudyInstanceUID || a?.referenceStudyUID);
  const series = clean(a?.SeriesInstanceUID || a?.referenceSeriesUID);
  const sop = clean(a?.SOPInstanceUID);
  const image = clean(a?.referencedImageId);
  const m = a?.measurements;
  if (!id || !study || !series || !sop || !image || a?.toolName !== 'Length' ||
      !Array.isArray(a.points) || a.points.length !== 2 ||
      !a.points.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) ||
      typeof m?.length !== 'number' || !Number.isFinite(m.length) || m.length <= 0 ||
      !['mm','cm'].includes(m.lengthUnit) ||
      (m.value !== undefined && m.value !== m.length) ||
      (m.unit !== undefined && m.unit !== m.lengthUnit)) return null;
  return JSON.stringify([id,study,series,sop,image,a.toolName,
    clean(a.label),clean(a.measurementRole),clean(a.role),a.points,m.length,m.lengthUnit]);
}

export function matchesSavedResearchZScoreEvidence(fieldKey: string, current: any, saved: any,
  currentAnnotations: any[], savedAnnotations: any[], deleted: ReadonlySet<string> = new Set()) {
  const a = current?.sources?.[fieldKey], b = saved?.sources?.[fieldKey];
  const sourceId = clean(b?.sourceMeasurementKey);
  if (!sourceId || deleted.has(sourceId) || a?.source !== 'viewer-measurement' ||
      b?.source !== 'viewer-measurement' || clean(a.sourceMeasurementKey) !== sourceId ||
      typeof current?.values?.[fieldKey] !== 'number' ||
      current.values[fieldKey] !== saved?.values?.[fieldKey]) return false;
  const find = (annotations: any[]) => annotations.filter(item =>
    clean(item?.annotationId || item?.uid) === sourceId);
  const currentMatches = find(currentAnnotations), savedMatches = find(savedAnnotations);
  if (currentMatches.length !== 1 || savedMatches.length !== 1) return false;
  const signature = sourceSignature(savedMatches[0]);
  return signature !== null && signature === sourceSignature(currentMatches[0]);
}

export function matchesZScoreResponse(snapshot: any, savedAt: unknown, acquisitionRevision: unknown) {
  return !!savedAt && typeof acquisitionRevision === 'number' &&
    Number.isSafeInteger(acquisitionRevision) && acquisitionRevision > 0 &&
    Number.isFinite(Date.parse(String(savedAt))) &&
    Date.parse(String(snapshot?.readSavedAt)) === Date.parse(String(savedAt)) &&
    snapshot?.acquisitionRevision === acquisitionRevision &&
    Array.isArray(snapshot?.questions);
}

export function getVisibleResearchZScore(snapshot: any, field: any) {
  // No local computation or fallback to hidden metadata. Server response is
  // the authority, including when the current protocol is more restrictive.
  if (!Array.isArray(snapshot?.results)) return null;
  const matches = snapshot.results.filter(r => r?.componentKey === field?.componentKey &&
    r.parameterKey === field?.config?.zScore?.parameterKey &&
    typeof r.zScore === 'number' && Number.isFinite(r.zScore) &&
    typeof r.bsaM2 === 'number' && Number.isFinite(r.bsaM2) && r.bsaM2 > 0 &&
    r.modelId === 'phn-2017' && r.modelVersion === 'phn-2017-indexed-table-v1');
  return matches.length === 1 ? matches[0] : null;
}
