import React from 'react';

export type QuestionNavigationItem = {
  key: string;
  label: string;
  answered?: boolean;
  required?: boolean;
};

export type QuestionNavigationGroup = {
  key: string;
  label?: string;
  questions: QuestionNavigationItem[];
};

/**
 * Workflow-neutral question selector used by Learning and Research.
 * The owning workflow supplies question identity, answered state, permissions
 * and navigation. Neither quiz scoring nor Research persistence belongs here.
 */
export function SharedQuestionSelector({
  id,
  groups,
  selectedKey,
  onSelect,
  disabled = false,
  title = 'Question',
  emptyLabel = 'Select a question…',
  className = 'mt-1 w-full min-w-0 rounded border border-gray-600 bg-gray-900 px-2 py-2 text-sm text-white',
}: {
  id: string;
  groups: QuestionNavigationGroup[];
  selectedKey: string;
  onSelect: (key: string) => void;
  disabled?: boolean;
  title?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const groupList = Array.isArray(groups) ? groups : [];
  const prefix = (question: QuestionNavigationItem, index: number) =>
    `${index + 1}. ${question.answered ? '✓ ' : ''}${question.label}${question.required ? ' (required)' : ''}`;

  return (
    <>
      <label htmlFor={id} className="mt-3 block text-xs font-semibold text-gray-200">
        {title}
      </label>
      <select
        id={id}
        className={className}
        value={selectedKey}
        disabled={disabled}
        onChange={event => onSelect(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {groupList.length === 1 && !groupList[0].label
          ? groupList[0].questions.map((question, index) => (
              <option key={question.key} value={question.key}>
                {prefix(question, index)}
              </option>
            ))
          : groupList.map(group => (
              <optgroup key={group.key} label={group.label || 'Questions'}>
                {group.questions.map((question, index) => (
                  <option key={question.key} value={question.key}>
                    {prefix(question, index)}
                  </option>
                ))}
              </optgroup>
            ))}
      </select>
    </>
  );
}

/** Shared Previous/Next UI; the caller controls whether movement is allowed. */
export function SharedQuestionStepNavigation({
  previousKey = '',
  nextKey = '',
  onNavigate,
  disabled = false,
  compact = false,
}: {
  previousKey?: string;
  nextKey?: string;
  onNavigate: (key: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <nav
      aria-label="Question navigation"
      className={compact
        ? 'flex items-center gap-1'
        : 'mt-3 flex items-center justify-between gap-2 border-t border-gray-700 pt-3'}
    >
      {([
        { key: previousKey, text: 'Previous' },
        { key: nextKey, text: 'Next' },
      ]).map(item => (
        <button
          key={item.text}
          type="button"
          data-quiz-review-action="navigation"
          aria-label={`${item.text} question`}
          className={compact
            ? 'rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 disabled:opacity-40'
            : 'rounded border border-blue-600 px-3 py-2 text-xs font-semibold text-blue-100 hover:bg-blue-950 disabled:cursor-not-allowed disabled:opacity-40'}
          disabled={disabled || !item.key}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            if (item.key) onNavigate(item.key);
          }}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
