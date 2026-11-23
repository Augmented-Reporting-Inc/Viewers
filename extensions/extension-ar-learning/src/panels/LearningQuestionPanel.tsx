import React from 'react';
import type { ReactNode } from 'react';
import {
  SharedQuestionSelector,
  SharedQuestionStepNavigation,
  type QuestionNavigationGroup,
} from '../../../extension-ar-measurements/src/components/SharedQuestionNavigation';
import { SharedQuestionCard } from '../../../extension-ar-measurements/src/components/SharedQuestionCard';

/**
 * The actual Learning question-panel presentation, independent of its workflow.
 *
 * Education owns quiz attempts, educator gold, scoring and learner-copy writes.
 * Research owns ReadSchema, Research Review snapshots and reader permissions.
 * Neither is accessed by this panel. Both controllers render THIS component.
 *
 * Its public API is an explicit UI contract; do not pass persistence services.
 */
export type LearningQuestionPanelQuestion = {
  key: string;
  index: number;
  title: string;
  prompt?: string;
  helpText?: string;
  required?: boolean;
  hasViewerTarget?: boolean;
};

export function LearningQuestionPanel({
  title,
  groups,
  selectedKey,
  selectedQuestion,
  onSelect,
  onActivateSelected,
  onFocusActivateSelected,
  disabled = false,
  readOnly = false,
  loading = false,
  error = '',
  emptyMessage = 'No case questions for this study.',
  selectorTitle = 'Question',
  description,
  instructions = 'Select a question above before answering.',
  topContent,
  questionContent,
  footer,
  overlay,
}: {
  title: string;
  groups: QuestionNavigationGroup[];
  selectedKey: string;
  selectedQuestion?: LearningQuestionPanelQuestion | null;
  onSelect: (key: string) => void;
  onActivateSelected?: () => void;
  onFocusActivateSelected?: (event: React.FocusEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  selectorTitle?: string;
  description?: ReactNode;
  instructions?: string;
  topContent?: ReactNode;
  questionContent?: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
}) {
  const questions = groups.flatMap(group => group.questions);
  const index = questions.findIndex(question => question.key === selectedKey);
  const previousKey = index > 0 ? questions[index - 1].key : '';
  const nextKey = index >= 0 && index + 1 < questions.length ? questions[index + 1].key : '';

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-x-hidden bg-black text-white">
      <div className="min-w-0 shrink-0 border-b border-gray-700 p-3">
        <div className="min-w-0 max-w-full text-base font-semibold"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          {title}
        </div>
        {!loading && !error && questions.length ? (
          <SharedQuestionSelector
            id="learning-question-panel-select"
            title={selectorTitle}
            groups={groups}
            selectedKey={selectedKey}
            disabled={disabled}
            onSelect={onSelect}
          />
        ) : null}
      </div>
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto p-3">
        {loading ? (
          <div className="text-sm text-gray-400">Loading case questions…</div>
        ) : error ? (
          <div role="alert" className="bg-red-950/40 rounded border border-red-700 p-2 text-sm text-red-200">
            {error}
          </div>
        ) : !questions.length ? (
          <div className="text-sm text-gray-400">{emptyMessage}</div>
        ) : (
          <div className="space-y-4">
            {readOnly ? (
              <div role="status" className="rounded border border-blue-700 bg-blue-950/30 p-2 text-sm font-semibold text-blue-100">
                Review — Read Only. Saved answers cannot be changed.
              </div>
            ) : null}
            {topContent}
            <div className="min-w-0 max-w-full overflow-hidden rounded border border-gray-700 p-3">
              {description ? (
                <div className="min-w-0 max-w-full text-xs text-gray-400"
                  style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                  {description}
                </div>
              ) : null}
              {instructions ? (
                <div className="bg-blue-950/30 mt-3 min-w-0 max-w-full rounded border border-blue-700 p-2 text-xs text-blue-100">
                  {instructions}
                </div>
              ) : null}
              {selectedQuestion ? (
                <div className="mt-3 space-y-4">
                  <SharedQuestionCard
                    id={selectedQuestion.key}
                    index={selectedQuestion.index}
                    title={selectedQuestion.title}
                    prompt={selectedQuestion.prompt}
                    helpText={selectedQuestion.helpText}
                    required={selectedQuestion.required}
                    hasViewerTarget={selectedQuestion.hasViewerTarget}
                    onActivate={onActivateSelected}
                    onFocusActivate={onFocusActivateSelected}
                  >
                    {questionContent}
                    <SharedQuestionStepNavigation
                      previousKey={previousKey}
                      nextKey={nextKey}
                      disabled={disabled}
                      onNavigate={onSelect}
                    />
                  </SharedQuestionCard>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-gray-700 bg-black p-3">{footer}</div>
      ) : null}
      {overlay}
    </div>
  );
}

export default LearningQuestionPanel;
