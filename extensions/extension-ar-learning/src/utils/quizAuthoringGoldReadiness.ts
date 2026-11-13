/**
 * Read-only educator dropdown status. A check means the question has the
 * expected persisted gold *values and source references*, not merely a draft
 * response or an overlay visible in the current viewport.
 */
const clean = (value: unknown) => String(value ?? '').trim();
const object = (value: any): any => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const positive = (value: any) => value != null && clean(value) !== '' &&
  Number.isFinite(Number(value)) && Number(value) > 0;
const finite = (value: any) => value != null && clean(value) !== '' &&
  Number.isFinite(Number(value));
const targetReady = (value: any) => {
  const target = object(value);
  return Boolean(clean(target.sopInstanceUID || target.SOPInstanceUID) &&
    Number.isInteger(Number(target.frameNumber)) && Number(target.frameNumber) > 0);
};
const slotsForKind: Record<string, string[]> = {
  lvSimpsonEF: ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'],
  rvFAC: ['RV_ED', 'RV_ES'],
  laVolumeBiplane: ['A4C', 'A2C'],
  laVolumeBiplaneDisks: ['A4C', 'A2C'],
  raArea: ['RA_ES'],
  ivcCollapsibility: ['IVC_EXP', 'IVC_INSP'],
};
const valueFields: Record<string, Record<string, string>> = {
  rvFAC: { RV_ED: 'edaCM2', RV_ES: 'esaCM2' },
  laVolumeBiplane: { A4C: 'a4cAreaCM2', A2C: 'a2cAreaCM2' },
  laVolumeBiplaneDisks: { A4C: 'a4cAreaCM2', A2C: 'a2cAreaCM2' },
  raArea: { RA_ES: 'areaCM2' },
  ivcCollapsibility: { IVC_EXP: 'expirationDiameterMM', IVC_INSP: 'inspirationDiameterMM' },
};

export function hasAllRequiredViewerGoldValues(
  question: any, correctMarkerIds: string[] = []
): boolean {
  const config = object(question?.answerConfig);
  const type = clean(question?.type);
  if (type === 'frameSelection') return targetReady(config.goldTarget);
  if (['markerChoice', 'multipleMarkerChoice', 'markerMultiSelect'].includes(type)) {
    return correctMarkerIds.some(value => clean(value));
  }
  if (['placeMarker', 'pointPlacement'].includes(type)) {
    const point = object(config.goldPoint);
    return finite(point.x) && finite(point.y);
  }
  if (type !== 'measurementNumeric') return false;

  const kind = clean(config.measurementKind);
  const gold = object(config.goldMeasurement);
  const scalar = gold.value ?? config.goldValue;
  if (!finite(scalar)) return false;

  const set = object(config.measurementSet);
  if (set.enabled === true) {
    const count = Number(set.requiredCount);
    const entries = config.goldMeasurements;
    return Number.isInteger(count) && count >= 2 && count <= 4 &&
      Array.isArray(entries) && entries.length === count &&
      entries.every((entry: any) => positive(entry?.value) &&
        clean(entry?.sourceAnnotationId) && targetReady(entry?.viewerTarget || entry?.target));
  }

  const slots = slotsForKind[kind];
  if (slots) {
    const composite = object(gold.compositeResult);
    const components = composite.components;
    if (!Array.isArray(components) || components.length !== slots.length ||
      !slots.every(slot => components.filter((component: any) =>
        clean(component?.slot) === slot && clean(component?.annotationId) &&
        targetReady(component?.target)).length === 1)) return false;
    const derived = object(composite.derived);
    if (kind === 'lvSimpsonEF') {
      // The published rubric grades the approved EF percent. Verified
      // per-contour areas, long axes and derived volumes are informative
      // evidence, not additional independent gold answers. Their absence on
      // legacy approved EF must not mark a gradeable question incomplete.
      return positive(scalar);
    }
    const fields = valueFields[kind] || {};
    return slots.every(slot => positive(derived[fields[slot]]));
  }

  // Ordinary source-linked numeric questions need an actual viewer gold,
  // not just the typed numeric field in the quiz editor.
  return clean(kind) !== '' && positive(scalar) &&
    clean(gold.sourceAnnotationId) !== '' &&
    targetReady(gold.viewerTarget);
}
