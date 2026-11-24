import { isSavedLVSimpsonImageMatch } from './savedVolumeContourMetadata';

type RestorationDeps = {
  slots: readonly string[];
  candidatesBySlot: Map<string, any[]>;
  getId: (source: any) => string;
  getNativeAnnotation: (id: string) => any;
  removeMisplacedAnnotation: (id: string) => void;
  hydrate: (source: any) => Promise<any>;
  getRestoredMeasurement: (id: string) => any;
  getSlot: (measurement: any) => string;
  onRestored: (source: any, measurement: any) => void;
  isCancelled: () => boolean;
  isSourceDeleted?: (id: string) => boolean;
};

const RETRYABLE_RESTORATION_REASONS = new Set([
  'display-set-not-found', 'viewport-target-image-not-ready',
  'saved-image-not-ready', 'saved-image-render-not-ready',
  'annotation-hydration-failed', 'missing-native-annotation',
  'missing-live-geometry', 'image-frame-mismatch',
]);

/**
 * Shared Education/Research saved EF restoration. A native annotation hit
 * alone does not prove the saved SOP/frame or calibrated slot is available.
 * Restore unique saved sources on their exact frame, then make one bounded
 * second pass over transient failures only. Never retry successful slots or
 * turn an unavailable persisted contour into an automatic replacement.
 */
export async function restoreSavedLVSimpsonSlots(deps: RestorationDeps) {
  const {
    slots, candidatesBySlot, getId, getNativeAnnotation, removeMisplacedAnnotation,
    hydrate, getRestoredMeasurement, getSlot, onRestored, isCancelled,
    isSourceDeleted = () => false,
  } = deps;
  const status: Record<string, string> = {};
  const retry: Array<{ slot: string; source: any }> = [];
  const expected = new Set<string>();
  const inspect = (slot: string, source: any, id: string) => {
    if (!getNativeAnnotation(id)) return { reason: 'missing-native-annotation', measurement: null };
    const measurement = getRestoredMeasurement(id);
    if (!measurement?.lvSimpson || getSlot(measurement) !== slot) {
      return { reason: 'missing-live-geometry', measurement: null };
    }
    if (!isSavedLVSimpsonImageMatch(source, measurement.referencedImageId)) {
      return { reason: 'image-frame-mismatch', measurement: null };
    }
    return { reason: 'restored', measurement };
  };

  const attempt = async (slot: string, source: any) => {
    if (isCancelled()) return { reason: 'cancelled', retryable: false };
    const id = getId(source);
    if (!id) return { reason: 'missing-id', retryable: false };
    if (isSourceDeleted(id)) return { reason: 'deleted', retryable: false };
    const native = getNativeAnnotation(id);
    if (native && !isSavedLVSimpsonImageMatch(source, native?.metadata?.referencedImageId)) {
      removeMisplacedAnnotation(id);
    }
    let inspected = inspect(slot, source, id);
    if (!inspected.measurement) {
      const outcome = await hydrate(source);
      if (isCancelled()) return { reason: 'cancelled', retryable: false };
      if (isSourceDeleted(id)) return { reason: 'deleted', retryable: false };
      inspected = inspect(slot, source, id);
      if (!inspected.measurement) {
        const reason = outcome?.ok === true
          ? inspected.reason : outcome?.reason || inspected.reason;
        return { reason, retryable: !!outcome?.retryable || RETRYABLE_RESTORATION_REASONS.has(reason) };
      }
    }
    if (isSourceDeleted(id)) return { reason: 'deleted', retryable: false };
    onRestored(source, inspected.measurement);
    return { reason: 'restored', retryable: false };
  };

  const result = () => ({
    cancelled: isCancelled(),
    pending: [...expected].some(slot => status[slot] !== 'restored'),
    slots: status,
    restoredCount: Object.values(status).filter(value => value === 'restored').length,
  });
  for (const slot of slots) {
    if (isCancelled()) return result();
    const candidates = candidatesBySlot.get(slot) || [];
    if (candidates.length !== 1) {
      status[slot] = candidates.length ? 'duplicate' : 'missing';
      continue;
    }
    expected.add(slot);
    const source = candidates[0];
    const outcome = await attempt(slot, source);
    status[slot] = outcome.reason;
    if (outcome.retryable) retry.push({ slot, source });
  }
  // By this point other successful frame transitions have settled. Retry only
  // the failed saved sources, not all four contours or the entire EF workflow.
  for (const { slot, source } of retry) {
    if (isCancelled()) return result();
    status[slot] = (await attempt(slot, source)).reason;
  }
  return result();
}

/** Panel-only evidence. Never insert these records into the live measurement
 * service or use them as newly calculated EF evidence. A live same-ID record
 * supersedes its saved counterpart; deletion always wins. */
export function mergeSavedLVSimpsonPanelSources({
  saved = [], live = [], studyInstanceId, getId, getSlot, isDeleted, isChanged,
}: {
  saved?: any[]; live?: any[]; studyInstanceId: string;
  getId: (source: any) => string; getSlot: (source: any) => string;
  isDeleted: (id: string) => boolean; isChanged: (source: any) => boolean;
}) {
  const byId = new Map<string, any>();
  const belongs = (source: any) => String(source?.StudyInstanceUID ||
    source?.referenceStudyUID || '').trim() === studyInstanceId;
  for (const source of saved) {
    const id = getId(source);
    if (!studyInstanceId || !belongs(source) || !id || !getSlot(source) ||
        isDeleted(id) || isChanged(source)) continue;
    byId.set(id, { ...source, arSavedEFPanelSource: true });
  }
  for (const source of live) {
    const id = getId(source);
    if (id && belongs(source) && getSlot(source) && !isDeleted(id)) byId.set(id, source);
  }
  return [...byId.values()];
}
