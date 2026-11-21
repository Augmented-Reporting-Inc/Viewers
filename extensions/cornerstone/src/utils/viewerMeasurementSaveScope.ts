/**
 * Selection and post-commit bookkeeping for the existing Viewer measurement
 * save command. An explicit deletion-only quiz save must not acknowledge
 * unrelated new/edited measurements or pending deletions.
 *
 * FormAPI remains responsible for authorizing and persisting clinical records.
 */
export function resolveViewerMeasurementSaveScope({
  measurementIds = null,
  deleteAnnotationIds = [],
  pendingDeletedMeasurementIds = [],
}: {
  measurementIds?: string[] | null;
  deleteAnnotationIds?: string[];
  pendingDeletedMeasurementIds?: Iterable<string>;
} = {}) {
  const restrictMeasurementIds = Array.isArray(measurementIds);
  const requestedMeasurementIds = new Set<string>(
    (restrictMeasurementIds ? measurementIds : [])
      .map(value => String(value || '').trim()).filter(Boolean)
  );
  const explicitDeleteIds = new Set<string>(
    (Array.isArray(deleteAnnotationIds) ? deleteAnnotationIds : [])
      .map(value => String(value || '').trim()).filter(Boolean)
  );
  // When saving a selected subset, never delete other pending sources.
  const deletionIdsToApply = restrictMeasurementIds
    ? new Set(explicitDeleteIds)
    : new Set<string>([
        ...Array.from(pendingDeletedMeasurementIds || []),
        ...explicitDeleteIds,
      ].map(value => String(value || '').trim()).filter(Boolean));

  return {
    explicitDeleteIds, restrictMeasurementIds, requestedMeasurementIds,
    deletionIdsToApply,
    isExplicitDeletionOnlySave:
      restrictMeasurementIds && requestedMeasurementIds.size === 0 &&
      explicitDeleteIds.size > 0,
  };
}

/**
 * Mutates session markers only after FormAPI has confirmed the saved Series.
 * For restricted saves, retain unselected/unsaved IDs for the next save.
 */
export function settleViewerMeasurementSaveMarkers({
  createdMeasurementIds, modifiedMeasurementIds, deletedMeasurementIds,
  restrictMeasurementIds, requestedMeasurementIds, deletionIdsToApply,
  persistedMeasurementIds,
}: {
  createdMeasurementIds: Set<string>;
  modifiedMeasurementIds: Set<string>;
  deletedMeasurementIds: Set<string>;
  restrictMeasurementIds: boolean;
  requestedMeasurementIds: Set<string>;
  deletionIdsToApply: Set<string>;
  persistedMeasurementIds: Set<string>;
}): void {
  if (!restrictMeasurementIds) {
    createdMeasurementIds.clear();
    modifiedMeasurementIds.clear();
    deletedMeasurementIds.clear();
    return;
  }
  for (const annotationId of requestedMeasurementIds) {
    if (persistedMeasurementIds.has(annotationId)) {
      createdMeasurementIds.delete(annotationId);
      modifiedMeasurementIds.delete(annotationId);
    }
  }
  for (const annotationId of deletionIdsToApply) {
    if (!persistedMeasurementIds.has(annotationId)) {
      createdMeasurementIds.delete(annotationId);
      modifiedMeasurementIds.delete(annotationId);
      deletedMeasurementIds.delete(annotationId);
    }
  }
}
