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
  if (!label || !/BWT/i.test(label) ||
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
  const evidence = obj(answer.quizSpatialEvidence);
  const physicalPoints = evidence.physicalPoints;
  if (evidence.source !== 'dicom-calibrated-image-index-v1' ||
      !Array.isArray(physicalPoints) || physicalPoints.length !== 2 ||
      physicalPoints.some(p => !vector(p))) {
    return { ok: false, reason: 'Calibrated image-index caliper positions were not captured.' };
  }
  const priorEvidence = obj(prior[0]?.quizSpatialEvidence);
  if (priorEvidence.source && (
      priorEvidence.calibrationSource !== evidence.calibrationSource ||
      priorEvidence.pixelSpacing?.row !== evidence.pixelSpacing?.row ||
      priorEvidence.pixelSpacing?.column !== evidence.pixelSpacing?.column
  )) {
    return { ok: false, reason: 'The BWT calipers use inconsistent image calibration.' };
  }
  const entry = {
    sourceAnnotationId: id,
    value: answer.value,
    unit: answer.unit,
    measurementKind: answer.measurementKind,
    measurementType: label,
    orientation,
    viewerTarget: target,
    quizSpatialEvidence: evidence,
  };
  const entries = [...prior, entry];
  const centers = entries.map(m => {
    const a = m.quizSpatialEvidence.physicalPoints[0];
    const b = m.quizSpatialEvidence.physicalPoints[1];
    return a.map((v: number, i: number) => (v + b[i]) / 2);
  });
  const a = centers[0];
  const b = centers[centers.length - 1];
  const axis = entries.length > 1 && a && b ? b.map((v: number, i: number) => v - a[i]) : undefined;
  return { ok: true, entries, referenceTarget: prior[0]?.viewerTarget || target,
    ...(axis && Math.hypot(...axis) > 0 ? { axis } : {}) };
}

/**
 * Informational learner spacing, measured between caliper midpoints in the
 * same DICOM-calibrated physical coordinate system. Unlike longitudinal
 * scoring this is Euclidean separation, not projection on the gold axis.
 * Never use the educator's gold geometry to compute learner feedback.
 */
export function getBowelMeasurementSetMidpointSpacingMm(entries: MeasurementAnswer[]): number | null {
  if (!Array.isArray(entries) || entries.length !== 2) return null;
  const points = entries.map(entry => obj(entry.quizSpatialEvidence).physicalPoints);
  if (points.some(value => !Array.isArray(value) || value.length !== 2 ||
      value.some((point: any) => !vector(point)))) return null;
  const frameKeys = entries.map(entry => frame(entry.viewerTarget));
  if (!frameKeys[0] || frameKeys[0] !== frameKeys[1]) return null;
  const calibrations = entries.map(entry => obj(entry.quizSpatialEvidence));
  if (calibrations.some(value => value.source !== 'dicom-calibrated-image-index-v1')) return null;
  if (calibrations[0].calibrationSource !== calibrations[1].calibrationSource ||
      calibrations[0].pixelSpacing?.row !== calibrations[1].pixelSpacing?.row ||
      calibrations[0].pixelSpacing?.column !== calibrations[1].pixelSpacing?.column) return null;
  const midpoint = (pair: number[][]) =>
    pair[0].map((value, index) => (value + pair[1][index]) / 2);
  const a = midpoint(points[0]);
  const b = midpoint(points[1]);
  const spacing = Math.hypot(...a.map((value, index) => value - b[index]));
  return Number.isFinite(spacing) ? spacing : null;
}
