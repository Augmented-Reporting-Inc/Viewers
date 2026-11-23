import React, { ReactNode } from 'react';

/**
 * One question/measurement presentation surface for Education and Research.
 * The caller owns question selection, controlled answers and authorization.
 */
export function SharedQuestionCard({
  id,
  index,
  title,
  prompt = '',
  helpText = '',
  required = false,
  active = true,
  hasViewerTarget = false,
  onActivate,
  onFocusActivate,
  children,
}: {
  id: string;
  index: number;
  title: string;
  prompt?: string;
  helpText?: string;
  required?: boolean;
  active?: boolean;
  hasViewerTarget?: boolean;
  onActivate?: () => void;
  onFocusActivate?: (event: React.FocusEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      data-question-key={id}
      className={`bg-gray-950/50 w-full min-w-0 max-w-full overflow-hidden rounded border p-2 ${
        active ? 'border-blue-400' : hasViewerTarget ? 'border-gray-600' : 'border-gray-800'
      }`}
      onClick={onActivate}
      onFocusCapture={onFocusActivate}
    >
      {active ? (
        <div className="mb-1 inline-flex rounded bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
          Active Question
        </div>
      ) : null}
      <div className="min-w-0 max-w-full text-sm font-semibold"
        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
        {index + 1}. {title}
        {required ? <span className="text-red-300"> *</span> : null}
      </div>
      {prompt ? (
        <div className="mt-1 min-w-0 max-w-full text-xs text-gray-300"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          {prompt}
        </div>
      ) : null}
      {helpText ? (
        <div className="mt-1 min-w-0 max-w-full text-xs text-gray-400"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          {helpText}
        </div>
      ) : null}
      <div className="mt-2 min-w-0">{children}</div>
    </div>
  );
}
