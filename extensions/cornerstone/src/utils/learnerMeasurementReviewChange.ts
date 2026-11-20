/**
 * An unchanged report-owned learner quiz can submit its previously saved
 * measurement answers without saving those annotations a second time.
 *
 * This is an *eligibility hint* for the Case Questions review. It is not a
 * scoring or source-authority substitute. Only persisted learner-copy
 * annotations may establish an unchanged snapshot; live edits, new sources,
 * and deletions must keep the normal review/save path.
 */
function sourceId(source: any): string {
  return String(source?.annotationId || source?.uid || source?.annotationUID || '').trim();
}

function isSameSourceGeometry(left: any, right: any): boolean {
  if (String(left?.referencedImageId || '') !== String(right?.referencedImageId || '') ||
      String(left?.toolName || '') !== String(right?.toolName || '') ||
      JSON.stringify(left?.points || []) !== JSON.stringify(right?.points || [])) {
    return false;
  }
  // A missing frame number on a hydrated source is not a new frame; the
  // referencedImageId above remains mandatory and authoritative.
  if (left?.frameNumber != null && right?.frameNumber != null &&
      Number(left.frameNumber) !== Number(right.frameNumber)) {
    return false;
  }
  const storedValue = left?.measurements?.value;
  const liveValue = right?.measurements?.value;
  if (storedValue != null && liveValue != null &&
      JSON.stringify(storedValue) !== JSON.stringify(liveValue)) {
    return false;
  }
  return true;
}

export function hasUnpersistedLearnerMeasurementChanges({
  isLearnerCopy = false,
  persistedAnnotations = [],
  liveAnnotations = [],
  changedIds = [],
  deletedIds = [],
}: {
  isLearnerCopy?: boolean;
  persistedAnnotations?: any[];
  liveAnnotations?: any[];
  changedIds?: string[];
  deletedIds?: string[];
} = {}): boolean {
  // Unknown ownership or absence of saved source evidence must always require
  // the original review/validation. Never use educator/base-study annotations.
  if (!isLearnerCopy || !Array.isArray(persistedAnnotations) ||
      persistedAnnotations.length === 0 ||
      !Array.isArray(liveAnnotations) ||
      changedIds.length > 0 || deletedIds.length > 0) {
    return true;
  }
  const persistedById = new Map(
    persistedAnnotations.filter(annotation => sourceId(annotation))
      .map(annotation => [sourceId(annotation), annotation])
  );
  if (persistedById.size === 0) return true;

  // A restored learner attempt may not hydrate earlier saved annotations in
  // the active viewport. No live annotations is therefore NOT proof of a
  // missing source when exact learner-copy annotations were read from FormAPI.
  return liveAnnotations.some(annotation => {
    const id = sourceId(annotation);
    const persisted = persistedById.get(id);
    return !id || !persisted || !isSameSourceGeometry(persisted, annotation);
  });
}
