export const VIEWER_MEASUREMENTS_WORKFLOW = 'viewerMeasurements';
export const REVIEWER_MEASUREMENTS_WORKFLOW = 'reviewerMeasurements';

export const VIEWER_MEASUREMENT_WORKFLOWS = Object.freeze([
  VIEWER_MEASUREMENTS_WORKFLOW,
  REVIEWER_MEASUREMENTS_WORKFLOW,
]);

export type ViewerMeasurementWorkflow =
  | typeof VIEWER_MEASUREMENTS_WORKFLOW
  | typeof REVIEWER_MEASUREMENTS_WORKFLOW;

export type ViewerMeasurementDomain = 'echo' | 'bowel' | 'iuscan' | 'generic';

export type ViewerMeasurementMode = 'single' | 'repeated';

export function isViewerMeasurementWorkflow(
  workflow: unknown
): workflow is ViewerMeasurementWorkflow {
  return VIEWER_MEASUREMENT_WORKFLOWS.includes(String(workflow || '') as ViewerMeasurementWorkflow);
}

export function parseMeasurementAnnotations(raw: unknown) {
  if (!raw) {
    return { version: 1, workflows: {} };
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const parsed = raw as any;
    return {
      version: parsed.version || 1,
      workflows: parsed.workflows || {},
    };
  }

  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        version: parsed.version || 1,
        workflows: parsed.workflows || {},
      };
    }
  } catch {
    // fall through
  }

  return { version: 1, workflows: {} };
}

export function getWorkflowAnnotations(raw: unknown, workflow: string) {
  const parsed = parseMeasurementAnnotations(raw);
  const workflowPayload = parsed.workflows?.[workflow];

  return Array.isArray(workflowPayload?.annotations) ? workflowPayload.annotations : [];
}

export function getAllWorkflowAnnotations(raw: unknown) {
  const parsed = parseMeasurementAnnotations(raw);
  const workflows = parsed.workflows || {};

  return Object.entries(workflows).flatMap(([workflow, payload]: [string, any]) => {
    const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];

    return annotations.map(annotation => ({
      ...annotation,
      workflow: annotation.workflow || workflow,
      workflowSource: payload?.source || '',
      workflowSavedAt: payload?.savedAt || '',
    }));
  });
}

export function getRequestedWorkflowAnnotations(raw: unknown, workflows?: string[]) {
  if (!Array.isArray(workflows) || workflows.length === 0) {
    return getAllWorkflowAnnotations(raw);
  }

  return workflows.flatMap(workflow =>
    getWorkflowAnnotations(raw, workflow).map(annotation => ({
      ...annotation,
      workflow: annotation.workflow || workflow,
    }))
  );
}

function getAnnotationKey(annotation: any) {
  return (
    annotation?.annotationId ||
    annotation?.uid ||
    [
      annotation?.toolName || '',
      annotation?.label || '',
      annotation?.domain || '',
      annotation?.referencedImageId || '',
      JSON.stringify(annotation?.points || []),
    ].join('|')
  );
}

export function upsertMeasurementWorkflowAnnotations({
  existingRaw,
  workflow = VIEWER_MEASUREMENTS_WORKFLOW,
  source,
  annotations,
  replaceDomains = [],
  replaceFilter,
  extra = {},
}: {
  existingRaw?: unknown;
  workflow?: ViewerMeasurementWorkflow;
  source: string;
  annotations: any[];
  replaceDomains?: string[];
  replaceFilter?: (annotation: any) => boolean;
  extra?: Record<string, unknown>;
}) {
  if (!isViewerMeasurementWorkflow(workflow)) {
    throw new Error(`Unsupported measurement workflow: ${String(workflow || '')}`);
  }

  const existing = parseMeasurementAnnotations(existingRaw);
  const workflows = existing.workflows || {};
  const currentWorkflow = workflows[workflow] || {};

  const currentAnnotations = Array.isArray(currentWorkflow.annotations)
    ? currentWorkflow.annotations
    : [];

  const domainSet = new Set(replaceDomains.filter(Boolean));

  const shouldReplace =
    replaceFilter || ((annotation: any) => domainSet.size > 0 && domainSet.has(annotation?.domain));

  const keptAnnotations = currentAnnotations.filter(annotation => !shouldReplace(annotation));

  const mergedByKey = new Map();

  for (const annotation of keptAnnotations) {
    mergedByKey.set(getAnnotationKey(annotation), annotation);
  }

  for (const annotation of annotations || []) {
    mergedByKey.set(getAnnotationKey(annotation), {
      ...annotation,
      workflow,
    });
  }

  return JSON.stringify({
    version: existing.version || 1,
    workflows: {
      ...workflows,
      [workflow]: {
        ...currentWorkflow,
        source,
        savedAt: new Date().toISOString(),
        annotations: Array.from(mergedByKey.values()),
        ...extra,
      },
    },
  });
}

export function upsertViewerMeasurementAnnotations(
  options: Omit<Parameters<typeof upsertMeasurementWorkflowAnnotations>[0], 'workflow'>
) {
  return upsertMeasurementWorkflowAnnotations({
    ...options,
    workflow: VIEWER_MEASUREMENTS_WORKFLOW,
  });
}

export type ViewerRepeatedMeasurementMetadata = {
  groupKey?: string;
  siteKey?: string;
  stateKey?: string;
  axis?: string;
  measurementType?: string;
  slotIndex?: number;
  pairIndex?: number;
  maxSlots?: number;
  aggregation?: string;
};

export function getViewerRepeatedMeasurementMetadata(value: any = {}) {
  const repeatedMeasurement =
    value?.repeatedMeasurement ||
    value?.metadata?.repeatedMeasurement ||
    value?.data?.repeatedMeasurement ||
    null;

  return repeatedMeasurement && typeof repeatedMeasurement === 'object'
    ? repeatedMeasurement
    : null;
}

export function isRepeatedViewerMeasurement(value: any = {}) {
  return value?.mode === 'repeated' || !!getViewerRepeatedMeasurementMetadata(value);
}

export function getRepeatedMeasurementSlotIndex(value: any = {}) {
  const repeatedMeasurement = getViewerRepeatedMeasurementMetadata(value);
  const slotIndex = Number(repeatedMeasurement?.slotIndex ?? repeatedMeasurement?.slot);

  return Number.isInteger(slotIndex) && slotIndex >= 0 ? slotIndex : null;
}
