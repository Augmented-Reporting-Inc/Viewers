/**
 * Fail-closed policy for deleting a quiz measurement's source annotation.
 * Caller must resolve persisted evidence from the learner's own Series only.
 * A matched id or image in the educator's base study is NEVER ownership proof.
 */
export function getLearnerQuizMeasurementDeleteDenial({
  canEdit = false,
  isLearnerCopy = false,
  sourceId = '',
  alreadyDeleted = false,
  persistedOwned = false,
  createdInSession = false,
  source = null,
  expectedTarget = {},
  actualTarget = {},
  liveReadOnly = false,
  stateReadOnly = false,
  normalizeImageId = (value: string) => value,
}: {
  canEdit?: boolean;
  isLearnerCopy?: boolean;
  sourceId?: string;
  alreadyDeleted?: boolean;
  persistedOwned?: boolean;
  createdInSession?: boolean;
  source?: any;
  expectedTarget?: any;
  actualTarget?: any;
  liveReadOnly?: boolean;
  stateReadOnly?: boolean;
  normalizeImageId?: (value: string) => string;
} = {}): string {
  if (!canEdit) return 'learner-measurements-not-editable';
  if (!sourceId || alreadyDeleted) return 'source-id-missing-or-already-deleted';
  if (!isLearnerCopy) return 'learner-series-not-verified';
  if (!persistedOwned && !createdInSession) return 'measurement-not-owned-by-learner';
  if (!source || String(source.uid || source.annotationId || source.annotationUID || '') !== sourceId) {
    return 'exact-learner-source-unavailable';
  }
  const expectedSop = String(expectedTarget?.sopInstanceUID || '').trim();
  const actualSop = String(actualTarget?.sopInstanceUID || '').trim();
  const expectedImage = String(expectedTarget?.referencedImageId || '').trim();
  const actualImage = String(actualTarget?.referencedImageId || '').trim();
  const expectedFrame = Number(expectedTarget?.frameNumber);
  const actualFrame = Number(actualTarget?.frameNumber);
  if ((expectedSop && expectedSop !== actualSop) ||
      (expectedImage && (!actualImage ||
        normalizeImageId(expectedImage) !== normalizeImageId(actualImage))) ||
      (Number.isInteger(expectedFrame) && expectedFrame > 0 &&
        actualFrame > 0 && expectedFrame !== actualFrame)) {
    return 'learner-source-frame-mismatch';
  }
  if (source.isLocked || source.arMeasurementReadOnly ||
      source?.data?.arMeasurementReadOnly ||
      (source.workflow && source.workflow !== 'viewerMeasurements') ||
      (source.measurementOwner &&
        String(source.measurementOwner).toLowerCase() !== 'learner') ||
      liveReadOnly || stateReadOnly) {
    return 'measurement-read-only';
  }
  return '';
}
