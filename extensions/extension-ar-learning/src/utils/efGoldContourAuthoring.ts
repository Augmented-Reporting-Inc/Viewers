import { isCompleteQuizDicomFrameTarget } from './compositeFrameTargets';

/**
 * One authoring row per EF contour. Guided target configuration and saved gold
 * evidence remain separate: changing a target must not rewrite accepted gold.
 */
export const EF_CONTOUR_FRAME_SLOTS = [
  { slot: 'A4C_ED', label: 'A4C end-diastole' },
  { slot: 'A4C_ES', label: 'A4C end-systole' },
  { slot: 'A2C_ED', label: 'A2C end-diastole' },
  { slot: 'A2C_ES', label: 'A2C end-systole' },
] as const;

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function identifier(target: any, lower: string, upper: string): string {
  return clean(target?.[lower] || target?.[upper]);
}

/** Compare the persisted DICOM sources, never a visible instance label. */
export function matchesEFContourGoldSource(configured: any, saved: any): boolean {
  if (!isCompleteQuizDicomFrameTarget(configured)) return false;
  const identifiers = [
    ['studyInstanceUID', 'StudyInstanceUID'],
    ['seriesInstanceUID', 'SeriesInstanceUID'],
    ['sopInstanceUID', 'SOPInstanceUID'],
  ] as const;
  if (!identifiers.every(([lower, upper]) =>
    identifier(configured, lower, upper) &&
    identifier(configured, lower, upper) === identifier(saved, lower, upper))) {
    return false;
  }
  if (!Number.isInteger(Number(saved?.frameNumber)) ||
      Number(saved.frameNumber) < 1 ||
      Number(configured.frameNumber) !== Number(saved.frameNumber)) {
    return false;
  }
  // A missing saved image reference is not proof of a verified guided source.
  return !!clean(saved?.referencedImageId) &&
    clean(configured.referencedImageId) === clean(saved.referencedImageId);
}

export function getEFGoldContourAuthoringRows(answerConfig: any, savedComponents: any[]) {
  const guidanceEnabled = answerConfig?.efContourFrameGuidanceEnabled === true;
  const configured = answerConfig?.efContourTargets || {};
  const saved = Array.isArray(savedComponents) ? savedComponents : [];
  return EF_CONTOUR_FRAME_SLOTS.map(({ slot, label }) => {
    const configuredTarget = configured[slot] || {};
    const savedComponent = saved.find(component => component?.slot === slot);
    const savedTarget = savedComponent?.target || {};
    const configuredComplete = isCompleteQuizDicomFrameTarget(configuredTarget);
    const goldVerified = savedComponent?.complete === true;
    const sourceMismatch = guidanceEnabled && configuredComplete && goldVerified &&
      !matchesEFContourGoldSource(configuredTarget, savedTarget);
    return {
      slot, label, configuredTarget, savedTarget, configuredComplete,
      goldVerified, sourceMismatch,
    };
  });
}
