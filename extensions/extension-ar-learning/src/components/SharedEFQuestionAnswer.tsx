import React from 'react';
import { SharedMeasurementValueInput } from '../../../extension-ar-measurements/src/components/SharedMeasurementValueInput';
import { LearningEFPanelLauncher } from './LearningEFPanelLauncher';

/**
 * Workflow-neutral EF question answer. Learning and Research own their
 * calculation, source-frame verification, answer persistence and permissions.
 * The EF panel is the single place to acquire/review the four LV contours.
 */
export function SharedEFQuestionAnswer({
  value,
  onChange,
  unit = '%',
  disabled = false,
  openDisabled = false,
  busy = false,
  onOpen,
  onDelete,
  deleteDisabled = false,
  showInstructions = true,
}: {
  value: number | string | null | undefined;
  onChange: (value: string) => void;
  unit?: string;
  disabled?: boolean;
  openDisabled?: boolean;
  busy?: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  showInstructions?: boolean;
}) {
  const empty = value === null || value === undefined ||
    String(value).trim() === '';
  return (
    <div className="mt-2 w-full min-w-0 max-w-full space-y-2 overflow-hidden"
      data-testid="shared-ef-question-answer">
      <SharedMeasurementValueInput
        value={value}
        onChange={onChange}
        unit={unit}
        disabled={disabled}
        onDelete={onDelete}
        deleteDisabled={deleteDisabled || busy}
        deleteLabel="Delete EF measurement"
      />
      <LearningEFPanelLauncher onOpen={onOpen}
        disabled={disabled || openDisabled} busy={busy} />
      {showInstructions && empty ? (
        <div className="text-xs text-gray-400">
          Complete four LV contours, select Calculate EF in the EF panel,
          then capture the calculated result.
        </div>
      ) : null}
    </div>
  );
}
