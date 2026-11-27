import React from 'react';

export type LearningChoice = { value: any; label?: string };

function normalizeChoice(value: any): string {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value ?? '').trim();
}

/**
 * Original Learning radio-answer interaction shared with Research. Research
 * retains its protocol field keys and own persistence callback; quiz gold,
 * scoring and attempt state never enter this component.
 */
export function LearningSingleChoiceAnswer({
  name,
  choices,
  value,
  onChange,
  disabled = false,
  reviewOnly = false,
}: {
  name: string;
  choices: LearningChoice[];
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  reviewOnly?: boolean;
}) {
  const savedValue = normalizeChoice(value);
  const matching = choices.filter(choice => normalizeChoice(choice.value) === savedValue);
  const savedLabel = matching.length === 1
    ? String(matching[0].label ?? savedValue) : savedValue;
  return (
    <div className="mt-2 space-y-1">
      {reviewOnly ? (
        <div role="status" className="rounded border border-gray-600 px-2 py-1 text-sm text-gray-100">
          {savedValue ? <>Saved answer: <span className="font-semibold">{savedLabel}</span>
            {matching.length !== 1 ? <span className="block text-xs text-amber-200">Saved value does not uniquely match the configured choices.</span> : null}
          </> : 'No saved answer available'}
        </div>
      ) : null}
      {choices.map((choice, index) => {
        const choiceValue = normalizeChoice(choice.value);
        return (
          <label
            key={choiceValue || index}
            className="flex cursor-pointer items-center gap-2 rounded border border-gray-700 px-2 py-1 text-sm hover:border-blue-400 hover:bg-gray-900"
          >
            <input
              type="radio"
              name={name}
              checked={normalizeChoice(value) === choiceValue}
              onChange={() => { if (!disabled && !reviewOnly) onChange(choice.value); }}
              disabled={disabled || reviewOnly}
            />
            <span>{choice.label || choice.value}</span>
          </label>
        );
      })}
    </div>
  );
}
