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

/**
 * FormAPI intentionally removes geometry from persisted quiz response values.
 * For informational learner UI only, supplement those stripped rows with
 * trusted geometry loaded from the same learner copy's MeasurementAnnotations.
 * Never persist the supplemented rows as quiz answers or score from them.
 */
export function restoreBowelMeasurementSetDisplayEvidence(
  answerEntries: MeasurementAnswer[],
  verifiedEvidenceById: Record<string, any> = {}
): MeasurementAnswer[] {
  return (Array.isArray(answerEntries) ? answerEntries : []).map(entry => {
    const sourceId = clean(entry?.sourceAnnotationId);
    const existing = obj(entry?.quizSpatialEvidence);
    if (existing.source === 'dicom-calibrated-image-index-v1') return entry;
    const trusted = sourceId ? obj(verifiedEvidenceById[sourceId]) : {};
    if (trusted.source !== 'dicom-calibrated-image-index-v1') return entry;
    return { ...entry, quizSpatialEvidence: trusted };
  });
}

/** Human-readable display for the existing canonical BWT measurement labels. */
export function formatBowelBwtMeasurementLabel(value: unknown): string {
  const label = clean(value);
  const match = label.match(/^Bowel([A-Za-z]+)BWT$/);
  if (!match) return label;
  const anatomicalName = match[1]
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^neo terminal/, 'neo-terminal');
  return anatomicalName.charAt(0).toUpperCase() + anatomicalName.slice(1) + ' BWT';
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
  if (!label || !/BWT/i.test(label)) {
    return { ok: false, reason: requiredLabel
      ? `Select a bowel wall-thickness caliper with the expected anatomical label: ${formatBowelBwtMeasurementLabel(requiredLabel)}.`
      : 'Select a labelled bowel wall-thickness caliper.' };
  }
  if (requiredLabel && label !== requiredLabel) {
    return { ok: false,
      reason: `Select a bowel wall-thickness caliper with the expected anatomical label: ${formatBowelBwtMeasurementLabel(requiredLabel)} (selected: ${formatBowelBwtMeasurementLabel(label)}).` };
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


/**
 * Live learner-only estimate of minimum radial-angle separation. The BWT
 * Length axes should point toward the lumen centre, so their intersection
 * provides a candidate centre without ever accessing educator gold geometry.
 * Unlike FormAPI's official angle (educator-centred), this is instructional,
 * not an assessment result; near-parallel or uncalibrated axes fail closed.
 */
export function getBowelMeasurementSetEstimatedRadialAngleDegrees(
  entries: MeasurementAnswer[]
): number | null {
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 4) return null;
  const expectedFrame = frame(entries[0]?.viewerTarget);
  if (!expectedFrame || entries.some(entry => frame(entry?.viewerTarget) !== expectedFrame)) {
    return null;
  }
  const firstCalibration = obj(entries[0]?.quizSpatialEvidence);
  const pixel = obj(firstCalibration.pixelSpacing);
  if (firstCalibration.source !== 'dicom-calibrated-image-index-v1' ||
      !clean(firstCalibration.calibrationSource) ||
      !Number.isFinite(pixel.row) || pixel.row <= 0 ||
      !Number.isFinite(pixel.column) || pixel.column <= 0) return null;

  const measurements = entries.map(entry => {
    const evidence = obj(entry?.quizSpatialEvidence);
    const points = evidence.physicalPoints;
    if (evidence.source !== firstCalibration.source ||
        evidence.calibrationSource !== firstCalibration.calibrationSource ||
        evidence.pixelSpacing?.row !== pixel.row ||
        evidence.pixelSpacing?.column !== pixel.column ||
        !Array.isArray(points) || points.length !== 2 ||
        points.some((point: any) => !vector(point))) return null;
    const dx = points[1][0] - points[0][0];
    const dy = points[1][1] - points[0][1];
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-6) || Math.abs(points[1][2] - points[0][2]) > 1e-4) return null;
    return {
      midpoint: [(points[0][0] + points[1][0]) / 2,
        (points[0][1] + points[1][1]) / 2],
      normal: [-dy / length, dx / length],
    };
  });
  if (measurements.some(value => !value)) return null;

  // Least-squares intersection of the learner's own caliper axes.
  let xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
  for (const value of measurements) {
    const { midpoint, normal } = value!;
    const [nx, ny] = normal;
    const projected = nx * midpoint[0] + ny * midpoint[1];
    xx += nx * nx;
    xy += nx * ny;
    yy += ny * ny;
    bx += nx * projected;
    by += ny * projected;
  }
  const determinant = xx * yy - xy * xy;
  // Nearly parallel axes cannot identify a stable lumen centre.
  if (!(determinant > 1e-3)) return null;
  const center = [(bx * yy - by * xy) / determinant,
    (xx * by - xy * bx) / determinant];
  if (center.some(value => !Number.isFinite(value))) return null;
  const rays = measurements.map(value => {
    const [mx, my] = value!.midpoint;
    return [mx - center[0], my - center[1]];
  });
  if (rays.some(ray => Math.hypot(...ray) <= 1e-4)) return null;

  let minimum = Infinity;
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const a = rays[i], b = rays[j];
      const cosine = (a[0] * b[0] + a[1] * b[1]) /
        (Math.hypot(...a) * Math.hypot(...b));
      const angle = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
      minimum = Math.min(minimum, angle);
    }
  }
  return Number.isFinite(minimum) ? minimum : null;
}
