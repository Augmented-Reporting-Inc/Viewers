import React, { useEffect, useMemo, useState } from 'react';
import {
  getViewerQuizzesForActiveStudy,
  getViewerQuizScoreForActiveStudy,
  saveViewerQuizResponseForActiveStudy,
  submitViewerQuizScoreForActiveStudy,
} from '../utils/viewerQuizApi';

type CaseQuestionsPanelProps = {
  commandsManager: any;
  servicesManager: any;
  extensionManager: any;
  configuration?: Record<string, any>;
};

type QuizQuestion = {
  questionKey: string;
  type: string;
  prompt: string;
  helpText?: string;
  required?: boolean;
  choices?: Array<{ value: string; label: string }>;
  sortOrder?: number;
};

type QuizDefinition = {
  quizKey: string;
  quizVersion: number;
  title?: string;
  description?: string;
  questions?: QuizQuestion[];
};

type QuizResponse = {
  quizKey: string;
  quizVersion: number;
  status?: string;
  answers?: Array<{ questionKey: string; value: any }>;
};

function cleanString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeChoiceValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  return cleanString(value);
}

function getQuestionChoices(question: QuizQuestion) {
  if (Array.isArray(question.choices) && question.choices.length > 0) {
    return question.choices;
  }

  if (question.type === 'true_false') {
    return [
      { value: 'TRUE', label: 'True' },
      { value: 'FALSE', label: 'False' },
    ];
  }

  return [];
}

function buildInitialAnswers(quizzes: QuizDefinition[] = [], responses: QuizResponse[] = []) {
  const next = {};

  quizzes.forEach(quiz => {
    const matchingResponse = responses.find(
      response =>
        response.quizKey === quiz.quizKey &&
        Number(response.quizVersion || 1) === Number(quiz.quizVersion || 1)
    );

    const quizAnswers = {};

    (matchingResponse?.answers || []).forEach(answer => {
      quizAnswers[answer.questionKey] = answer.value;
    });

    next[quiz.quizKey] = quizAnswers;
  });

  return next;
}

function buildAnswerPayload(quiz: QuizDefinition, quizAnswers = {}) {
  return (quiz.questions || []).map(question => ({
    questionKey: question.questionKey,
    value: quizAnswers[question.questionKey],
  }));
}

function hasRequiredMissing(quiz: QuizDefinition, quizAnswers = {}) {
  return (quiz.questions || []).some(question => {
    if (!question.required) {
      return false;
    }

    const value = quizAnswers[question.questionKey];

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return value === undefined || value === null || cleanString(value) === '';
  });
}

function getViewerQuizScore(scoringPayload: any) {
  return (
    scoringPayload?.officialScore?.components?.viewerQuizzes ||
    scoringPayload?.officialScore?.viewerQuizzes ||
    scoringPayload?.components?.viewerQuizzes ||
    scoringPayload?.viewerQuizzes ||
    null
  );
}

function getResponseForQuiz(responses: QuizResponse[] = [], quiz: QuizDefinition) {
  return (
    responses.find(
      response =>
        response.quizKey === quiz.quizKey &&
        Number(response.quizVersion || 1) === Number(quiz.quizVersion || 1)
    ) || null
  );
}

function getQuizScoreItem(viewerQuizScore: any, quiz: QuizDefinition) {
  const quizzes = Array.isArray(viewerQuizScore?.quizzes) ? viewerQuizScore.quizzes : [];

  return (
    quizzes.find(
      item =>
        item.quizKey === quiz.quizKey &&
        Number(item.quizVersion || 1) === Number(quiz.quizVersion || 1)
    ) || null
  );
}

function CaseQuestionsPanel({ servicesManager }: CaseQuestionsPanelProps) {
  const { uiNotificationService } = servicesManager.services;

  const [loading, setLoading] = useState(true);
  const [savingQuizKey, setSavingQuizKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [answersByQuizKey, setAnswersByQuizKey] = useState({});
  const [scoringPayload, setScoringPayload] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const quizzes: QuizDefinition[] = useMemo(() => {
    return Array.isArray(payload?.quizzes) ? payload.quizzes : [];
  }, [payload]);

  const responses: QuizResponse[] = useMemo(() => {
    return Array.isArray(payload?.responses) ? payload.responses : [];
  }, [payload]);

  const viewerQuizScore = useMemo(() => getViewerQuizScore(scoringPayload), [scoringPayload]);

  async function refresh({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }

    setErrorMessage('');

    try {
      const nextPayload = await getViewerQuizzesForActiveStudy();
      setPayload(nextPayload);
      setAnswersByQuizKey(
        buildInitialAnswers(nextPayload.quizzes || [], nextPayload.responses || [])
      );

      try {
        const nextScoringPayload = await getViewerQuizScoreForActiveStudy();
        setScoringPayload(nextScoringPayload);
      } catch {
        setScoringPayload(null);
      }
    } catch (error) {
      const message = error?.message || String(error);
      setErrorMessage(message);
      setPayload(null);
      setAnswersByQuizKey({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function setAnswer(quizKey: string, question: QuizQuestion, value: any) {
    setAnswersByQuizKey(current => ({
      ...current,
      [quizKey]: {
        ...(current[quizKey] || {}),
        [question.questionKey]: value,
      },
    }));
  }

  function toggleMultiSelectAnswer(quizKey: string, question: QuizQuestion, value: string) {
    setAnswersByQuizKey(current => {
      const quizAnswers = current[quizKey] || {};
      const existing = Array.isArray(quizAnswers[question.questionKey])
        ? quizAnswers[question.questionKey]
        : [];

      const nextValue = existing.includes(value)
        ? existing.filter(item => item !== value)
        : [...existing, value];

      return {
        ...current,
        [quizKey]: {
          ...quizAnswers,
          [question.questionKey]: nextValue,
        },
      };
    });
  }

  async function saveQuiz(quiz: QuizDefinition, status: 'draft' | 'submitted') {
    const quizAnswers = answersByQuizKey[quiz.quizKey] || {};

    if (status === 'submitted' && hasRequiredMissing(quiz, quizAnswers)) {
      uiNotificationService.show({
        title: 'Case Questions',
        message: 'Please answer all required questions before submitting.',
        type: 'warning',
        duration: 3000,
      });
      return null;
    }

    setSavingQuizKey(quiz.quizKey);
    if (status === 'submitted') {
      setSubmitting(true);
    }

    try {
      const result = await saveViewerQuizResponseForActiveStudy({
        quizKey: quiz.quizKey,
        quizVersion: Number(quiz.quizVersion) || 1,
        status,
        answers: buildAnswerPayload(quiz, quizAnswers),
      });

      let scoredPayload: any = null;

      if (status === 'submitted') {
        scoredPayload = await submitViewerQuizScoreForActiveStudy();
        setScoringPayload(scoredPayload);
      }

      const viewerQuizzes = getViewerQuizScore(scoredPayload);
      const scoredQuiz = viewerQuizzes ? getQuizScoreItem(viewerQuizzes, quiz) : null;

      uiNotificationService.show({
        title: 'Case Questions',
        message:
          status === 'submitted'
            ? scoredQuiz
              ? `Quiz submitted and scored: ${Number(scoredQuiz.total || 0)} / ${Number(scoredQuiz.max || 0)}`
              : 'Quiz submitted and scored.'
            : 'Draft answers saved.',
        type: 'success',
        duration: 3500,
      });

      window.dispatchEvent(new CustomEvent('ar:learning-library-progress-updated'));

      await refresh({ silent: true });

      return result;
    } catch (error) {
      const message =
        status === 'submitted'
          ? `Submit failed: ${error?.message || error}`
          : `Save failed: ${error?.message || error}`;

      setErrorMessage(message);

      uiNotificationService.show({
        title: 'Case Questions',
        message,
        type: 'error',
        duration: 10000,
      });

      throw error;
    } finally {
      setSavingQuizKey('');
      if (status === 'submitted') {
        setSubmitting(false);
      }
    }
  }

  function renderQuestion(quiz: QuizDefinition, question: QuizQuestion, disabled = false) {
    const quizAnswers = answersByQuizKey[quiz.quizKey] || {};
    const value = quizAnswers[question.questionKey];
    const choices = getQuestionChoices(question);

    if (question.type === 'single_choice' || question.type === 'true_false') {
      return (
        <div className="mt-2 space-y-1">
          {choices.map(choice => {
            const choiceValue = normalizeChoiceValue(choice.value);
            const selected = normalizeChoiceValue(value) === choiceValue;

            return (
              <label
                key={choiceValue}
                className="flex cursor-pointer items-center gap-2 rounded border border-gray-700 px-2 py-1 text-sm hover:border-blue-400 hover:bg-gray-900"
              >
                <input
                  type="radio"
                  name={`${quiz.quizKey}-${question.questionKey}`}
                  checked={selected}
                  onChange={() => setAnswer(quiz.quizKey, question, choice.value)}
                  disabled={disabled}
                />
                <span>{choice.label || choice.value}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (question.type === 'multi_select') {
      const selectedValues = Array.isArray(value) ? value.map(normalizeChoiceValue) : [];

      return (
        <div className="mt-2 space-y-1">
          {choices.map(choice => {
            const choiceValue = normalizeChoiceValue(choice.value);
            const selected = selectedValues.includes(choiceValue);

            return (
              <label
                key={choiceValue}
                className="flex cursor-pointer items-center gap-2 rounded border border-gray-700 px-2 py-1 text-sm hover:border-blue-400 hover:bg-gray-900"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleMultiSelectAnswer(quiz.quizKey, question, choice.value)}
                  disabled={disabled}
                />
                <span>{choice.label || choice.value}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (question.type === 'numeric') {
      return (
        <input
          className="mt-2 w-full rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
          type="number"
          value={value ?? ''}
          onChange={event => setAnswer(quiz.quizKey, question, event.target.value)}
          disabled={disabled}
        />
      );
    }

    return (
      <textarea
        className="mt-2 min-h-[80px] w-full rounded border border-gray-700 bg-black px-2 py-1 text-sm text-white"
        value={value ?? ''}
        onChange={event => setAnswer(quiz.quizKey, question, event.target.value)}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <div className="border-b border-gray-700 p-3">
        <div className="text-base font-semibold">Case Questions</div>
        <div className="mt-1 text-xs text-gray-400">Viewer-based questions for this case.</div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="text-sm text-gray-400">Loading case questions…</div>
        ) : errorMessage ? (
          <div className="bg-red-950/40 rounded border border-red-700 p-2 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : !payload?.enabled || quizzes.length === 0 ? (
          <div className="text-sm text-gray-400">No case questions for this study.</div>
        ) : (
          <div className="space-y-4">
            {viewerQuizScore ? (
              <div className="bg-green-950/30 rounded border border-green-700 p-2 text-sm">
                <div className="font-semibold">Viewer Quiz Score</div>
                <div className="mt-1">
                  {Number(viewerQuizScore.total || 0)} / {Number(viewerQuizScore.max || 0)}
                </div>
              </div>
            ) : null}

            {quizzes.map(quiz => {
              const quizSaving = savingQuizKey === quiz.quizKey;
              const questions = [...(quiz.questions || [])].sort(
                (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
              );
              const response = getResponseForQuiz(responses, quiz);
              const submitted = cleanString(response?.status).toLowerCase() === 'submitted';
              const quizScore = viewerQuizScore ? getQuizScoreItem(viewerQuizScore, quiz) : null;
              return (
                <div
                  key={`${quiz.quizKey}-${quiz.quizVersion}`}
                  className="rounded border border-gray-700 p-3"
                >
                  <div className="text-sm font-semibold">{quiz.title || 'Case Questions'}</div>

                  {quiz.description ? (
                    <div className="mt-1 text-xs text-gray-400">{quiz.description}</div>
                  ) : null}

                  <div className="mt-3 space-y-4">
                    {questions.map((question, index) => (
                      <div
                        key={question.questionKey}
                        className="bg-gray-950/50 rounded border border-gray-800 p-2"
                      >
                        <div className="text-sm font-semibold">
                          {index + 1}. {question.prompt}
                          {question.required ? <span className="text-red-300"> *</span> : null}
                        </div>

                        {question.helpText ? (
                          <div className="mt-1 text-xs text-gray-400">{question.helpText}</div>
                        ) : null}

                        {renderQuestion(quiz, question, submitted)}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3">
                    {submitted ? (
                      <div className="bg-green-950/30 rounded border border-green-700 p-2 text-sm text-green-100">
                        <div className="font-semibold">Submitted</div>
                        {quizScore ? (
                          <div className="mt-1">
                            Score: {Number(quizScore.total || 0)} / {Number(quizScore.max || 0)}
                          </div>
                        ) : (
                          <div className="mt-1 text-green-200">
                            Your answers have been submitted.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={quizSaving || submitting}
                          onClick={() => saveQuiz(quiz, 'draft')}
                        >
                          {quizSaving ? 'Saving…' : 'Save Draft'}
                        </button>

                        <button
                          type="button"
                          className="rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={quizSaving || submitting}
                          onClick={() => saveQuiz(quiz, 'submitted')}
                        >
                          {quizSaving ? 'Submitting…' : 'Submit Quiz'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default CaseQuestionsPanel;
