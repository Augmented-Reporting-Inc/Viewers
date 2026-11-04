/**
 * Optional educational asset source-frame guidance for independently selected
 * LA, RV FAC and IVC phases. This is quiz configuration, never a viewer-side
 * study-type override. Each phase can reference a different DICOM instance.
 */
export const COMPOSITE_FRAME_SLOTS: Record<string, readonly { slot: string; label: string }[]> = {
  laVolumeBiplane: [
    { slot: 'A4C', label: 'LA apical four-chamber' },
    { slot: 'A2C', label: 'LA apical two-chamber' },
  ],
  laVolumeBiplaneDisks: [
    { slot: 'A4C', label: 'LA apical four-chamber' },
    { slot: 'A2C', label: 'LA apical two-chamber' },
  ],
  rvFAC: [
    { slot: 'RV_ED', label: 'RV end-diastole' },
    { slot: 'RV_ES', label: 'RV end-systole' },
  ],
  ivcCollapsibility: [
    { slot: 'IVC_EXP', label: 'IVC expiration' },
    { slot: 'IVC_INSP', label: 'IVC inspiration' },
  ],
  ivcRapRvsp: [
    { slot: 'IVC_EXP', label: 'IVC expiration' },
    { slot: 'IVC_INSP', label: 'IVC inspiration' },
  ],
};

function clean(value: unknown): string { return String(value ?? '').trim(); }
export function isCompleteQuizDicomFrameTarget(value: any): boolean {
  return !!clean(value?.studyInstanceUID || value?.StudyInstanceUID) &&
    !!clean(value?.seriesInstanceUID || value?.SeriesInstanceUID) &&
    !!clean(value?.sopInstanceUID || value?.SOPInstanceUID) &&
    !!clean(value?.referencedImageId) &&
    Number.isInteger(Number(value?.frameNumber)) &&
    Number(value?.frameNumber) >= 1;
}

/** Check the rendered active viewport after cross-series DICOM navigation. */
export function matchesConfiguredCompositeFrame(actual: any, configured: any): boolean {
  if (!isCompleteQuizDicomFrameTarget(actual) ||
      !isCompleteQuizDicomFrameTarget(configured)) return false;
  const identity = (target: any, lower: string, upper: string) =>
    clean(target[lower] || target[upper]);
  return [
    ['studyInstanceUID', 'StudyInstanceUID'],
    ['seriesInstanceUID', 'SeriesInstanceUID'],
    ['sopInstanceUID', 'SOPInstanceUID'],
  ].every(([lower, upper]) => identity(actual, lower, upper) === identity(configured, lower, upper)) &&
    Number(actual.frameNumber) === Number(configured.frameNumber);
}

export function getCompleteCompositeFrameTargets(answerConfig: any): Record<string, any> | null {
  const config = answerConfig && typeof answerConfig === 'object' ? answerConfig : {};
  const slots = COMPOSITE_FRAME_SLOTS[clean(config.measurementKind)];
  if (!slots?.length || config.compositeFrameGuidanceEnabled !== true) return null;
  const targets = config.compositeFrameTargets || {};
  if (!slots.every(({ slot }) => isCompleteQuizDicomFrameTarget(targets[slot]))) return null;
  const studyIds = new Set(slots.map(({ slot }) =>
    clean(targets[slot].studyInstanceUID || targets[slot].StudyInstanceUID)));
  if (studyIds.size !== 1) return null;
  const identities = slots.map(({ slot }) => {
    const target = targets[slot];
    return [
      clean(target.seriesInstanceUID || target.SeriesInstanceUID),
      clean(target.sopInstanceUID || target.SOPInstanceUID),
      Number(target.frameNumber),
    ].join('|');
  });
  // Do not bind two physiological phases or distinct LA views to the same
  // frame. Different frames within one cine remain supported.
  if (new Set(identities).size !== slots.length) return null;
  return targets;
}

export function getCompositePhaseFrameTarget(answerConfig: any, slot: string): any | null {
  const targets = getCompleteCompositeFrameTargets(answerConfig);
  return targets?.[slot] || null;
}
