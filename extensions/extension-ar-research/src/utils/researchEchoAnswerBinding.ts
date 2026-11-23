import { buildViewerMeasurementValueCandidates } from '../../../extension-ar-measurements/src/utils/measurementValueCandidates';
import { buildViewerMeasurementReadUpdates } from './readSchema';
import {
  getResearchBindingSources,
  getResearchCompatibleMeasurementCandidates,
  getResearchProtocolViewerTargets,
} from './researchFieldNavigation';

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
