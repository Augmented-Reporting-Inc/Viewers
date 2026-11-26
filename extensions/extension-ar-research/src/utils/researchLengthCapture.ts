import { getResearchLengthSourceState } from './researchFieldNavigation';
import { buildViewerMeasurementReadUpdates } from './readSchema';

const clean = (value: unknown) => String(value ?? '').trim();
const token = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

// Research adapter for the same exact-annotation capture command used by
// Education. No independent measurement extraction or calibration.
export function resolveResearchLengthCapture(field: any, result: any, study: string,
  expectedAnnotationId: string, sources: Record<string, any> = {}, fields: any[] = []) {
  const labels = Array.isArray(field?.config?.measurementLabels)
    ? field.config.measurementLabels.map(clean).filter(Boolean) : [];
  if (labels.length !== 1 || !token(labels[0])) return null;
  const label = labels[0];
  // Do not let an automatic internal label link two different questions.
  if (fields.some(other => other.key !== field.key &&
      other.config?.measurementLabels?.some(item => token(item) === token(label)))) return null;
  const answer = result?.answer;
  const sourceId = clean(answer?.sourceAnnotationId);
  const source = answer?.reviewPayload?.annotation;
  if (!result?.ok || !sourceId || (expectedAnnotationId && sourceId !== expectedAnnotationId) ||
      clean(result.selectedMeasurementId) !== sourceId ||
      clean(source?.annotationId || source?.uid) !== sourceId ||
      answer?.sourceRefs?.toolName !== 'Length' || source?.toolName !== 'Length' ||
      !study || clean(answer?.sourceRefs?.studyInstanceUID) !== study ||
      !['mm','cm'].includes(clean(answer?.unit)) ||
      typeof answer?.value !== 'number' || !Number.isFinite(answer.value) || answer.value <= 0 ||
      !['mm','cm'].includes(clean(field.config?.unit))) return null;
  if (Object.entries(sources).some(([key, item]) => key !== field.key &&
      clean(item?.sourceMeasurementKey) === sourceId)) return null;
  const actualLabel = clean(answer?.measurementType || source.label);
  // Never silently relabel a different clinical measurement.
  if (actualLabel && token(actualLabel) !== 'length' && token(actualLabel) !== token(label)) return null;
  const candidate = {labels:[label], value:answer.value, unit:answer.unit,
    source:'viewer-measurement', sourceMeasurementKey:sourceId};
  const state = getResearchLengthSourceState(field, {}, [source], [candidate], study);
  if (state.eligible.length !== 1) return null;
  const [update] = buildViewerMeasurementReadUpdates([field], [candidate], {});
  return update ? {sourceId, label, update} : null;
}
