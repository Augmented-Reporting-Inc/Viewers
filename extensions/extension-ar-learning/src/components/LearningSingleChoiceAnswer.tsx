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
}: {
  name: string;
  choices: LearningChoice[];
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 space-y-1">
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
              onChange={() => onChange(choice.value)}
              disabled={disabled}
            />
            <span>{choice.label || choice.value}</span>
          </label>
        );
      })}
    </div>
  );
}
