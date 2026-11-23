/**
 * Read-only scored-review EF contour selection. The saved submitted learner
 * response, not live MeasurementService state or a current educator definition,
 * is authoritative. Never choose an arbitrary contour by label/area.
 */
export const MAX_EF_REVIEW_CONTOUR_POINTS = 10000;
const text = (value: unknown) => String(value ?? '').trim();

function sameDicomFrame(left: any, right: any): boolean {
  return !!left && !!right &&
    ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID']
      .every(key => text(left[key]) !== '' && text(left[key]) === text(right[key])) &&
    Number.isSafeInteger(Number(left.frameNumber)) &&
    Number(left.frameNumber) > 0 &&
    Number(left.frameNumber) === Number(right.frameNumber);
}

function validPoints(points: any): points is number[][] {
  return Array.isArray(points) && points.length >= 3 &&
    points.length <= MAX_EF_REVIEW_CONTOUR_POINTS &&
    points.every(point => Array.isArray(point) && point.length >= 2 &&
      point.length <= 3 &&
      point.every((coordinate: unknown) =>
        typeof coordinate === 'number' && Number.isFinite(coordinate)));
}

export function getSubmittedEFReviewContour({
  learnerSeriesDoc, quizKey, quizVersion, questionKey, slot, goldTarget,
}: {
  learnerSeriesDoc: any;
  quizKey: string;
  quizVersion: number;
  questionKey: string;
  slot: string;
  goldTarget: any;
}): { annotationId: string; points: number[][]; target: any; volumeML: number | null } | null {
  if (learnerSeriesDoc?.isLearnerCopy !== true || !text(quizKey) ||
      !text(questionKey) || !['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'].includes(slot) ||
      !Number.isSafeInteger(Number(quizVersion)) || Number(quizVersion) < 1) return null;
  const responses = (Array.isArray(learnerSeriesDoc.viewerQuizResponses)
    ? learnerSeriesDoc.viewerQuizResponses : []).filter((response: any) =>
    text(response?.status).toLowerCase() === 'submitted' &&
    text(response?.quizKey) === text(quizKey) &&
    Number(response?.quizVersion || 1) === Number(quizVersion));
  if (responses.length !== 1) return null;
  const answerRows = (Array.isArray(responses[0].answers) ? responses[0].answers : [])
    .filter((answer: any) => text(answer?.questionKey) === text(questionKey));
  if (answerRows.length !== 1) return null;
  const value = answerRows[0]?.value;
  if (text(value?.measurementKind) !== 'lvSimpsonEF') return null;
  const components = value?.compositeResult?.components;
  if (!Array.isArray(components) || components.length !== 4 ||
      new Set(components.map((part: any) => text(part?.slot))).size !== 4) return null;
  const matches = components.filter((part: any) => text(part?.slot) === slot);
  if (matches.length !== 1) return null;
  const part = matches[0];
  if (!text(part?.annotationId) || !validPoints(part?.points) ||
      !sameDicomFrame(part.target, goldTarget)) return null;
  const rawVolume = value?.compositeResult?.derived?.slotVolumeML?.[slot];
  const volume = rawVolume == null || rawVolume === '' ? NaN : Number(rawVolume);
  return {
    annotationId: text(part.annotationId),
    points: part.points.map((point: number[]) => [...point]),
    target: { ...part.target },
    volumeML: Number.isFinite(volume) && volume > 0 ? volume : null,
  };
}
