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
  annotations: any[] = []
) {
  const nextValues = { ...values };
  const nextSources = { ...sources };
  const candidates = buildViewerMeasurementValueCandidates(annotations);
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
    } else if (
      // A result linked to removed, changed or now invalid source evidence
      // must not remain as a seemingly verified research answer.
      getResearchProtocolViewerTargets(field).length > 0 ||
      field?.config?.compositeFrameGuidanceEnabled === true
    ) {
      if (current.source === 'viewer-derived' ||
          (String(field.componentKey) === 'ivcCollapsibility' && !compatible.length)) {
        delete nextValues[field.key];
        delete nextSources[field.key];
      }
    }
  }
  return { values: nextValues, sources: nextSources, candidates };
}
