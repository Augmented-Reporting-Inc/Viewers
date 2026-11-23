import React from 'react';

/**
 * Shared viewer question chrome for Education and Research.
 *
 * This component owns presentation/navigation only. It must not load,
 * save, submit, score, or mutate measurement annotations; those remain
 * with their authorized Education or Research workflows.
 */
export function ViewerQuestionCard({
  number,
  title,
  prompt = '',
  helpText = '',
  showPrompt = false,
  required = false,
  active = true,
  hasViewerTarget = false,
  onSelect,
  onFocusCapture,
  children,
}: {
  number: number;
  title: string;
  prompt?: string;
  helpText?: string;
  showPrompt?: boolean;
  required?: boolean;
  active?: boolean;
  hasViewerTarget?: boolean;
  onSelect?: () => void;
  onFocusCapture?: (event: React.FocusEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-gray-950/50 w-full min-w-0 max-w-full overflow-hidden rounded border p-2 ${
        active ? 'border-blue-400' : hasViewerTarget ? 'border-gray-600' : 'border-gray-800'
      }`}
      onClick={onSelect}
      onFocusCapture={onFocusCapture}
    >
      {active ? (
        <div className="mb-1 inline-flex rounded bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">
          Active Question
        </div>
      ) : null}
      <div
        className="min-w-0 max-w-full text-sm font-semibold"
        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
      >
        {number}. {title}
        {required ? <span className="text-red-300"> *</span> : null}
      </div>
      {showPrompt && prompt ? (
        <div
          className="mt-1 min-w-0 max-w-full text-xs text-gray-300"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
        >
          {prompt}
        </div>
      ) : null}
      {helpText ? (
        <div
          className="mt-1 min-w-0 max-w-full text-xs text-gray-400"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
        >
          {helpText}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function ViewerQuestionNavigation({
  index,
  count,
  disabled = false,
  onNavigate,
}: {
  index: number;
  count: number;
  disabled?: boolean;
  onNavigate: (nextIndex: number) => void;
}) {
  return (
    <nav
      aria-label="Question navigation"
      className="mt-3 flex items-center justify-between gap-2 border-t border-gray-700 pt-3"
    >
      {([-1, 1] as const).map(direction => {
        const nextIndex = index + direction;
        const label = direction === -1 ? 'Previous' : 'Next';
        return (
          <button
            key={direction}
            type="button"
            data-quiz-review-action="navigation"
            aria-label={`${label} question`}
            className="rounded border border-blue-600 px-3 py-2 text-xs font-semibold text-blue-100 hover:bg-blue-950 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disabled || nextIndex < 0 || nextIndex >= count}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              if (nextIndex >= 0 && nextIndex < count) onNavigate(nextIndex);
            }}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
