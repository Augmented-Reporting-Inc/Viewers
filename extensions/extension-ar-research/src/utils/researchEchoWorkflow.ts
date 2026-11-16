/**
 * Research Read uses the same Echo acquisition commands as Education.
 * This is the independently maintained viewer representation of the
 * ReadSchema config API (frontend/backend cannot share files).
 */
export const RESEARCH_RAP_CHOICES_MMHG = [3, 8, 15] as const;

const PHASES: Record<string, Array<{slot: string; label: string}>> = {
  lvEjectionFraction: [
    { slot: 'A4C_ED', label: 'A4C end diastole' },
    { slot: 'A4C_ES', label: 'A4C end systole' },
    { slot: 'A2C_ED', label: 'A2C end diastole' },
    { slot: 'A2C_ES', label: 'A2C end systole' },
  ],
  laVolumeDisks: [
    { slot: 'A4C', label: 'A4C end systole' },
    { slot: 'A2C', label: 'A2C end systole' },
  ],
  rvFac: [
    { slot: 'RV_ED', label: 'RV end diastole' },
    { slot: 'RV_ES', label: 'RV end systole' },
  ],
  ivcCollapsibility: [
    { slot: 'IVC_EXP', label: 'IVC expiration (IVCexp)' },
    { slot: 'IVC_INSP', label: 'IVC inspiration (IVCinsp)' },
  ],
};

export function getResearchEchoPhases(field: any) {
  return PHASES[String(field?.componentKey || '')] || [];
}

export function getResearchEchoPhaseTarget(field: any, slot = '') {
  const config = field?.config || {};
  return slot
    ? config.compositeFrameTargets?.[slot] || null
    : config.viewerTarget || null;
}

export function isUsableResearchTarget(value: any) {
  const sop = String(value?.sopInstanceUID || value?.SOPInstanceUID || '').trim();
  const frame = Number(value?.frameNumber);
  return !!sop && Number.isInteger(frame) && frame > 0;
}

export function isRequiredResearchPhaseMissing(field: any, slot: string) {
  return field?.config?.compositeFrameGuidanceEnabled === true &&
    !isUsableResearchTarget(getResearchEchoPhaseTarget(field, slot));
}

export function getResearchRapChoices(field: any) {
  const configured = field?.config?.options;
  if (Array.isArray(configured) && configured.length) {
    return configured.map((option: any) => {
      const raw = option && typeof option === 'object'
        ? option.value ?? option.label : option;
      return String(raw ?? '').trim();
    }).filter(Boolean);
  }
  // Backwards-compatible Echo ReadSchema (created before the RAP preset used
  // options). Only this recognized measurement component receives defaults.
  if (field?.componentKey === 'rap' &&
      String(field?.config?.unit || '').toLowerCase() === 'mmhg') {
    return RESEARCH_RAP_CHOICES_MMHG.map(String);
  }
  return [];
}

export function getResearchCompanionField(field: any, fields: any[] = []) {
  if (!field) return null;
  // Keep legacy Echo starter protocols readable without modifying saved data.
  const match = fields.find(item => item.componentKey === 'readerComment' &&
    item.key !== field.key &&
    (item.config?.groupWithComponentKey === field.componentKey ||
      (field.componentKey === 'imageQuality' && !item.config?.groupWithComponentKey))
  );
  return field.componentKey === 'imageQuality' ? match || null : null;
}

export function isResearchCompanionHidden(field: any, fields: any[] = []) {
  if (field?.componentKey !== 'readerComment') return false;
  return !!fields.find(item => getResearchCompanionField(item, fields)?.key === field.key);
}
