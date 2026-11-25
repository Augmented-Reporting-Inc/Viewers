// One completion event contract for question-based viewer workflows.
// Education preserves its existing delayed notification. Research may
// synchronously claim a fresh Length for its active question before labelling.
export const QUESTION_MEASUREMENT_ADDED = 'ar-learning:quiz-measurement-added';

// Snapshot the active question before the asynchronous annotation mapping.
export function snapshotQuestionMeasurementCaptureContext(): unknown {
  let context: unknown;
  try {
    window.dispatchEvent(new CustomEvent('ar-measurements:question-capture-context', {
      detail: { accept: (value: unknown) => { if (!context) context = value; } },
    }));
  } catch {}
  return context;
}

export function dispatchQuestionMeasurementAdded(measurement: any, claimContext?: unknown): Promise<boolean> {
  const measurementId = String(measurement?.uid || measurement?.annotationUID || measurement?.annotationId || '').trim();
  if (!measurementId) return Promise.resolve(false);
  const detail = {measurementId, toolName: measurement?.toolName || ''};
  if (!claimContext) {
    window.setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent(QUESTION_MEASUREMENT_ADDED, {detail})); } catch {}
    }, 50);
    return Promise.resolve(false);
  }
  let accepted: Promise<boolean> | undefined;
  try {
    window.dispatchEvent(new CustomEvent(QUESTION_MEASUREMENT_ADDED, {
      detail: {...detail, captureContext: claimContext, accept: (capture: Promise<boolean>) => {
        if (!accepted) accepted = capture;
      }},
    }));
  } catch { return Promise.resolve(false); }
  return accepted ? accepted.catch(() => false) : Promise.resolve(false);
}
