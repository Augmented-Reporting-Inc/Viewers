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
  const value = Number(snapshot?.composite?.value);
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
  field: any, value: any, source: any, annotations: any[], studyInstanceId: string
) {
  const key = String(source?.sourceMeasurementKey || '');
  if (source?.source !== 'viewer-derived' || !key.startsWith('lv-simpson:') ||
      value == null || value === '' || !studyInstanceId) return null;
  const ids = getResearchSourceAnnotationIds(key);
  const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  if (ids.length !== slots.length || new Set(ids).size !== slots.length) return null;
  const components = ids.map((id, index) => {
    const annotation = annotations.find(item =>
      String(item?.annotationId || item?.uid || item?.id || '') === id);
    const slot = String(annotation?.lvSimpson?.slot ||
      annotation?.measurements?.lvSimpson?.slot || annotation?.slot || '');
    const kind = annotation?.measurementKind || annotation?.lvSimpson?.measurementKind ||
      annotation?.measurements?.lvSimpson?.measurementKind;
    return kind === 'lvSimpsonSlot' && slot === slots[index]
      ? { annotationId: id, slot } : null;
  });
  if (components.some(component => !component)) return null;
  return getVerifiedResearchEFResultCandidate(field, {
    studyInstanceId,
    composite: { measurementKind: 'lvSimpsonEF', value, components },
  }, annotations);
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
  verifiedLiveCandidates: any[] = []
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
    ...buildViewerMeasurementValueCandidates(annotations),
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
