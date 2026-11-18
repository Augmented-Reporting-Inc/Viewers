/**
 * Reconstruct the toolbar's selected measurement context from the learner's
 * (or educator's) saved active question. UI restoration must not implicitly
 * start a drawing command or infer a target when no question is selected.
 */
export function getRestoredQuizMeasurementKind({
  activeQuestionKey = '',
  authoringMode = false,
  authoringQuestions = [],
  quizzes = [],
}: {
  activeQuestionKey?: string;
  authoringMode?: boolean;
  authoringQuestions?: any[];
  quizzes?: any[];
} = {}): string {
  const key = String(activeQuestionKey || '').trim();
  if (!key) return '';
  let question: any = null;
  if (authoringMode) {
    if (!key.startsWith('authoring:')) return '';
    const questionKey = key.slice('authoring:'.length);
    question = authoringQuestions.find(item => item?.questionKey === questionKey);
  } else {
    const separator = key.indexOf(':');
    if (separator <= 0) return '';
    const quizKey = key.slice(0, separator);
    const questionKey = key.slice(separator + 1);
    const quiz = quizzes.find(item => item?.quizKey === quizKey);
    question = quiz?.questions?.find(item => item?.questionKey === questionKey);
  }
  return question?.type === 'measurementNumeric'
    ? String(question?.answerConfig?.measurementKind || '').trim()
    : '';
}
