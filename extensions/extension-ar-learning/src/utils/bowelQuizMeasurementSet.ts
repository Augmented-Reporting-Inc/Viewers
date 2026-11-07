/** Bowel quiz measurement-set helpers (viewer-only; FormAPI independently validates JSON). */
type MeasurementAnswer = Record<string, any>;
type QuestionLike = { answerConfig?: Record<string, any> };
const obj = (v: any): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const clean = (v: any) => String(v ?? '').trim();
const vector = (v: any): number[] | null =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))
    ? v : null;
const frame = (v: any) => {
  const t = obj(v);
  const ids = ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID'].map(k => clean(t[k]));
  const n = Number(t.frameNumber);
  return ids.every(Boolean) && Number.isInteger(n) && n >= 1 ? [...ids, n].join('|') : '';
};
export const isBowelMeasurementSetQuestion = (question: QuestionLike): boolean =>
  obj(question?.answerConfig).measurementSet?.enabled === true;

export function getBowelMeasurementSetEntries(value: any): MeasurementAnswer[] {
  return Array.isArray(value) ? value : [];
}
export function appendBowelMeasurementSetAnswer(
  question: QuestionLike,
  existing: MeasurementAnswer[],
  answer: MeasurementAnswer
): { ok: boolean; reason?: string; entries?: MeasurementAnswer[]; referenceTarget?: Record<string, any>; axis?: number[] } {
  const settings = obj(obj(question?.answerConfig).measurementSet);
  const count = Number(settings.requiredCount);
  if (!Number.isInteger(count) || count < 2 || count > 4) {
    return { ok: false, reason: 'Configure between 2 and 4 measurements.' };
  }
  const orientation = clean(settings.orientation);
  if (!['longitudinal', 'crossSection'].includes(orientation)) {
    return { ok: false, reason: 'Choose longitudinal or cross-sectional orientation first.' };
  }
  if (clean(obj(question?.answerConfig).measurementKind) !== 'length' ||
      clean(answer.measurementKind) !== 'length' ||
      clean(answer.unit).toLowerCase() !== 'mm' ||
      !(Number.isFinite(answer.value) && answer.value > 0)) {
    return { ok: false, reason: 'Use a calibrated Length measurement in millimetres.' };
  }
  const label = clean(answer.measurementType || obj(answer.reviewPayload).label);
  const requiredLabel = clean(settings.measurementTarget);
  if (!label || !/(?:\\bBWT\\b|BWT(?:Long|Cross)?$)/i.test(label) ||
      (requiredLabel && label !== requiredLabel)) {
    return { ok: false, reason: 'Select a bowel wall-thickness caliper with the expected anatomical label.' };
  }
  const id = clean(answer.sourceAnnotationId);
  const target = obj(answer.viewerTarget);
  const sourceFrame = frame(target);
  if (!id || !sourceFrame) return { ok: false, reason: 'The selected caliper needs an exact DICOM frame and source ID.' };
  const prior = Array.isArray(existing) ? existing : [];
  if (prior.some(m => clean(m.sourceAnnotationId) === id)) {
    return { ok: false, reason: 'This caliper is already in the measurement set.' };
  }
  if (prior.length >= count) {
    return { ok: false, reason: 'Measurement set is full. Remove a measurement before adding another.' };
  }
  const expectedFrame = frame(settings.referenceTarget) || frame(prior[0]?.viewerTarget);
  if (expectedFrame && expectedFrame !== sourceFrame) {
    return { ok: false, reason: 'Measurements must be on the same identified image/frame for spatial scoring.' };
  }
  const annotation = obj(obj(answer.reviewPayload).annotation || answer.annotation);
  const points = annotation.points;
  if (!Array.isArray(points) || points.length !== 2 || points.some(p => !vector(p))) {
    return { ok: false, reason: 'Calibrated world-coordinate caliper endpoints were not captured.' };
  }
  const entry = {
    sourceAnnotationId: id,
    value: answer.value,
    unit: answer.unit,
    measurementKind: answer.measurementKind,
    measurementType: label,
    orientation,
    viewerTarget: target,
    annotation: { points },
  };
  const entries = [...prior, entry];
  const centers = entries.map(m => {
    const a = m.annotation.points[0];
    const b = m.annotation.points[1];
    return a.map((v: number, i: number) => (v + b[i]) / 2);
  });
  const a = centers[0];
  const b = centers[centers.length - 1];
  const axis = entries.length > 1 && a && b ? b.map((v: number, i: number) => v - a[i]) : undefined;
  return { ok: true, entries, referenceTarget: prior[0]?.viewerTarget || target,
    ...(axis && Math.hypot(...axis) > 0 ? { axis } : {}) };
}
