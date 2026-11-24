import { hasMatchingLVSimpsonControlPoints } from '../../../extension-ar-measurements/src/utils/lvSimpson';
import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import { buildViewerMeasurementReadUpdates } from './readSchema';
import {
  getResearchBindingSources,
  getResearchCompatibleMeasurementCandidates,
  getResearchProtocolViewerTargets,
  isResearchCandidateOnProtocolFrames,
  getResearchSourceAnnotationIds,
} from './researchFieldNavigation';

/**
 * Research composites can arrive from both the live annotation calculator
 * and the explicit Calculate EF checkpoint. They identify the same evidence,
 * not two competing answers. Keep the last (explicit) source-backed result.
 */
export function dedupeResearchMeasurementCandidates(candidates: any[] = []) {
  return Array.from(new Map(
    (Array.isArray(candidates) ? candidates : []).map(candidate =>
      [String(candidate?.source || '') + ':' +
        String(candidate?.sourceMeasurementKey || ''), candidate]
    )
  ).values());
}

/**
 * Restore exactly the four source contours named by a previously verified
 * Research EF answer when still present on protocol frames. Keep every other
 * persisted annotation untouched. An unbound/ambiguous old draft cannot
 * choose among duplicates and is returned intact for guarded review.
 */
export function getResearchEFRestoreSources(
  field: any,
  savedAnnotations: any[] = [],
  savedSourceKey: unknown = ''
) {
  const allEF = (Array.isArray(savedAnnotations) ? savedAnnotations : []).filter(
    annotation => annotation?.measurementKind === 'lvSimpsonSlot' ||
      annotation?.lvSimpson?.measurementKind === 'lvSimpsonSlot' ||
      annotation?.measurements?.lvSimpson?.measurementKind === 'lvSimpsonSlot'
  );
  const key = String(savedSourceKey || '').trim();
  if (field?.componentKey !== 'lvEjectionFraction' ||
      !key.startsWith('lv-simpson:')) return allEF;
  const ids = getResearchSourceAnnotationIds(key);
  if (ids.length !== 4) return allEF;
  const selected = ids.map(id => allEF.find(item =>
    String(item?.annotationId || item?.uid || item?.id || '') === id
  ));
  if (selected.some(item => !item)) return allEF;
  return isResearchCandidateOnProtocolFrames(
    field, { sourceMeasurementKey: key }, selected
  ) ? selected : allEF;
}

/**
 * Adapt the already-calculated, active-study EF snapshot used by Education
 * to Research's source-linked ReadSchema. This does NOT recalculate EF.
 * Every one of its four named sources must be in the current Review snapshot
 * and must match the Research protocol's exact DICOM SOP and frame.
 */
export function getVerifiedResearchEFResultCandidate(
  field: any,
  snapshot: any,
  annotations: any[] = []
) {
  if (field?.componentKey !== 'lvEjectionFraction' ||
      snapshot?.composite?.measurementKind !== 'lvSimpsonEF') return null;
  const rawValue = snapshot?.composite?.value;
  if (rawValue == null || typeof rawValue === 'boolean' ||
      String(rawValue).trim() === '' || !snapshot?.studyInstanceId) return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  const expected = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  const components = snapshot?.composite?.components;
  if (!Array.isArray(components) || components.length !== expected.length ||
      components.some((entry: any, index: number) =>
        String(entry?.slot || '') !== expected[index] ||
        !String(entry?.annotationId || '').trim())) return null;
  const ids = components.map((entry: any) => String(entry.annotationId).trim());
  if (new Set(ids).size !== expected.length) return null;
  const selected = ids.map(id => annotations.find(item =>
    String(item?.annotationId || item?.uid || item?.id || '') === id
  ));
  if (selected.some(item => !item) ||
      selected.some(item => String(item?.StudyInstanceUID || item?.referenceStudyUID || '') !==
        String(snapshot.studyInstanceId || ''))) return null;
  // The set of configured frames alone cannot detect swapped ED/ES sources.
  if (selected.some((item, index) => {
    const slot = item?.lvSimpson?.slot || item?.measurements?.lvSimpson?.slot || item?.slot;
    const target = field.config?.compositeFrameTargets?.[expected[index]];
    return (!!slot && slot !== expected[index]) ||
      (!!target && !isResearchCandidateOnProtocolFrames(
        { config: { viewerTarget: target } }, { sourceMeasurementKey: ids[index] }, [item]
      ));
  })) return null;
  const candidate = {
    labels: ['LVEF', 'LV EF', 'EF'],
    value,
    unit: '%',
    source: 'viewer-derived',
    sourceMeasurementKey: 'lv-simpson:' + ids.join(','),
  };
  return isResearchCandidateOnProtocolFrames(field, candidate, annotations)
    ? candidate : null;
}

/** A persisted answer is a display snapshot, not a new live calculation.
 * Reuse the same source/phase checks as the Education calculation checkpoint.
 * Do not use this adapter to authorize changed geometry or a new answer.
 */
export function getPersistedResearchEFCandidate(
  field: any, value: any, source: any, annotations: any[], studyInstanceId: string,
  currentAnnotations: any[] = annotations,
  invalidatedSourceIds: ReadonlySet<string> = new Set()
) {
  const key = String(source?.sourceMeasurementKey || '');
  if (source?.source !== 'viewer-derived' || !key.startsWith('lv-simpson:') ||
      value == null || typeof value === 'boolean' || String(value).trim() === '' || !studyInstanceId) return null;
  const ids = getResearchSourceAnnotationIds(key);
  const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  if (ids.length !== slots.length ||
      key.slice('lv-simpson:'.length).split(',').length !== slots.length ||
      ids.some(id => invalidatedSourceIds.has(id))) return null;
  const annotationId = (item: any) =>
    String(item?.annotationId || item?.uid || item?.id || '');
  const geometry = (item: any) => item?.lvSimpson || item?.measurements?.lvSimpson || {};
  const components = ids.map(id => {
    const annotation = annotations.find(item =>
      String(item?.annotationId || item?.uid || item?.id || '') === id);
    const slot = String(annotation?.lvSimpson?.slot ||
      annotation?.measurements?.lvSimpson?.slot || annotation?.slot || '');
    const kind = annotation?.measurementKind || annotation?.lvSimpson?.measurementKind ||
      annotation?.measurements?.lvSimpson?.measurementKind;
    const current = currentAnnotations.find(item => annotationId(item) === id);
    if (!annotation || !current || kind !== 'lvSimpsonSlot' || !slots.includes(slot)) return null;
    // Compare the editable controls, not OHIF's resampled display polyline.
    // An absent live annotation is normal during hydration; the merge retains
    // the original saved source. An edited live contour may retain the ID.
    if (current !== annotation) {
      const before = geometry(annotation).originalContourPoints || annotation.splineControlPoints;
      const after = current.splineControlPoints || current.lvSimpsonControlPoints ||
        geometry(current).originalContourPoints;
      if (!hasMatchingLVSimpsonControlPoints(before, after)) return null;
      // Recalibration can change a source without changing its ID.
      if (geometry(annotation).calibratedLongAxisLengthMM !==
          geometry(current).calibratedLongAxisLengthMM ||
          JSON.stringify(geometry(annotation).calibratedContourPoints) !==
          JSON.stringify(geometry(current).calibratedContourPoints)) return null;
    }
    return { annotationId: id, slot };
  });
  if (components.some(component => !component) ||
      new Set(components.map(component => component.slot)).size !== slots.length) return null;
  const ordered = slots.map(slot => components.find(component => component.slot === slot));
  const verified = getVerifiedResearchEFResultCandidate(field, {
    studyInstanceId,
    composite: { measurementKind: 'lvSimpsonEF', value, components: ordered },
  }, currentAnnotations);
  // Older verified Reviews may have recorded the same four IDs in a
  // different order. Preserve that saved source identity without guessing.
  return verified ? { ...verified, sourceMeasurementKey: key } : null;
}

/** Load the saved answer from the Review, not mutable question inputs. */
export function resolvePersistedResearchEF(
  fields: any[], savedValues: Record<string, any>, savedSources: Record<string, any>,
  savedAnnotations: any[], currentAnnotations: any[], studyInstanceId: string,
  invalidatedSourceIds: ReadonlySet<string> = new Set()
) {
  const field = fields.find(item => item.componentKey === 'lvEjectionFraction');
  return field ? getPersistedResearchEFCandidate(
    field, savedValues[field.key], savedSources[field.key], savedAnnotations,
    studyInstanceId, currentAnnotations, invalidatedSourceIds
  ) : null;
}

const GUIDED_COMPOSITE_KINDS = new Set([
  'lvEjectionFraction', 'laVolumeDisks', 'rvFac', 'ivcCollapsibility',
]);

/**
 * Keep Research ReadSchema ownership while reusing the verified measurement
 * engines that also serve Education. Only update composite answers from
 * unambiguously verified viewer-derived evidence; never infer an answer from
 * an annotation's displayed text, an uncalibrated ROI, or the wrong DICOM frame.
 *
 * Current annotation evidence is authoritative in editable reviews. Completed
 * reviews are deliberately excluded by the owning ResearchReadPanel.
 */
export function reconcileResearchEchoCompositeAnswers(
  fields: any[] = [],
  values: Record<string, any> = {},
  sources: Record<string, any> = {},
  annotations: any[] = [],
  verifiedLiveCandidates: any[] = [],
  { verifiedEFOnly = false }: { verifiedEFOnly?: boolean } = {}
) {
  const nextValues = { ...values };
  const nextSources = { ...sources };
  // Calibrated contours are compacted before persistence. Live verified
  // derived candidates are computed upstream from the same raw source
  // snapshot, with no second calculation or new saved-answer schema.
  const validIds = new Set((Array.isArray(annotations) ? annotations : []).map(item =>
    String(item?.annotationId || item?.uid || '').trim()
  ).filter(Boolean));
  const verified = (Array.isArray(verifiedLiveCandidates) ? verifiedLiveCandidates : [])
    .filter(candidate => {
      if (candidate?.source !== 'viewer-derived') return false;
      const key = String(candidate?.sourceMeasurementKey || '');
      const ids = key.replace(/^(lv-simpson|la-disks|rv-fac|ivc-collapse):/, '')
        .split(',').map(item => item.trim()).filter(Boolean);
      return ids.length > 0 && ids.every(id => validIds.has(id));
    });
  const candidates = [
    ...buildViewerMeasurementValueCandidates(annotations, { includeLVSimpson: !verifiedEFOnly }),
    ...verified,
  ];
  for (const field of fields) {
    if (!GUIDED_COMPOSITE_KINDS.has(String(field?.componentKey || ''))) continue;
    const compatible = getResearchCompatibleMeasurementCandidates(
      field, candidates, annotations
    ).filter(candidate => candidate?.source === 'viewer-derived');
    const current = nextSources[field.key] || {};
    const bindingSources = getResearchBindingSources(field, nextSources, compatible);
    const updates = buildViewerMeasurementReadUpdates(
      [field], compatible, bindingSources
    );
    if (updates.length === 1) {
      const update = updates[0];
      nextValues[field.key] = update.value;
      nextSources[field.key] = {
        source: update.source, sourceMeasurementKey: update.sourceMeasurementKey,
      };
    } else {
      // Even an unpinned research protocol must not retain an old derived
      // value without a valid compatible candidate and calculation. Do not
      // replace it with another candidate unless the frame-pinned workflow
      // or the reader's explicit source selection authorizes that binding.
      const fixedProtocol = getResearchProtocolViewerTargets(field).length > 0 ||
        field?.config?.compositeFrameGuidanceEnabled === true;
      if (current.source === 'viewer-derived' ||
          (fixedProtocol && String(field.componentKey) === 'ivcCollapsibility' &&
            !compatible.length)) {
        delete nextValues[field.key];
        delete nextSources[field.key];
      }
    }
  }
  return { values: nextValues, sources: nextSources, candidates };
}
