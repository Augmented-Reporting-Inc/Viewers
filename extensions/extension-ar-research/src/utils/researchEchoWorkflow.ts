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

export function getResearchRapChoices(field: any, domain = 'echo') {
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
  if (String(domain).toLowerCase() === 'echo' &&
      field?.componentKey === 'rap' &&
      String(field?.config?.unit || '').toLowerCase() === 'mmhg') {
    return RESEARCH_RAP_CHOICES_MMHG.map(String);
  }
  return [];
}

/**
 * Presentation-only grouping of ReadSchema components into reader questions.
 * Each component retains its own key, value, provenance, validation and
 * persistence. Explicit schema groupWithComponentKey takes precedence over
 * the backwards-compatible Echo defaults.
 *
 * Echo IVC / RAP / RVSP matches the established Education workflow: IVC
 * has guided exp/insp measurements, RAP is explicitly selected, and RVSP
 * is derived independently from source-linked TR Vmax + selected RAP.
 */
export function getResearchGroupedFields(field: any, fields: any[] = [], domain = 'echo') {
  if (!field) return [];
  const componentKey = String(field.componentKey || '');
  const isEcho = String(domain).toLowerCase() === 'echo';

  const grouped = fields.filter(item =>
    item.key !== field.key &&
    String(item?.config?.groupWithComponentKey || '').trim() === componentKey
  );

  const addLegacyCompanion = (key: string) => {
    const match = fields.find(item =>
      item.key !== field.key &&
      item.componentKey === key &&
      !String(item?.config?.groupWithComponentKey || '').trim()
    );
    if (match && !grouped.some(item => item.key === match.key)) grouped.push(match);
  };

  if (isEcho && componentKey === 'imageQuality') {
    addLegacyCompanion('readerComment');
  }
  if (isEcho && componentKey === 'ivcCollapsibility') {
    addLegacyCompanion('rap');
    addLegacyCompanion('rvsp');
  }

  // Stable protocol order for the IVC follow-up: RAP selection before RVSP.
  // Do not reorder other explicitly configured groups.
  if (isEcho && componentKey === 'ivcCollapsibility') {
    const order = { rap: 0, rvsp: 1 };
    grouped.sort((a, b) =>
      (order[a.componentKey] ?? 2) - (order[b.componentKey] ?? 2)
    );
  }
  return grouped;
}

// Preserve the older single-companion API for consumers using it.
export function getResearchCompanionField(field: any, fields: any[] = [], domain = 'echo') {
  return getResearchGroupedFields(field, fields, domain)[0] || null;
}

export function isResearchCompanionHidden(field: any, fields: any[] = [], domain = 'echo') {
  if (!field) return false;
  return fields.some(parent =>
    parent.key !== field.key &&
    getResearchGroupedFields(parent, fields, domain).some(child => child.key === field.key)
  );
}

export function getResearchQuestionLabel(field: any, fields: any[] = [], domain = 'echo') {
  const grouped = getResearchGroupedFields(field, fields, domain);
  if (String(domain).toLowerCase() === 'echo' &&
      field?.componentKey === 'ivcCollapsibility' && grouped.length) {
    const items = ['IVC', ...grouped.map(item =>
      item.componentKey === 'rap' ? 'RAP'
        : item.componentKey === 'rvsp' ? 'RVSP' : String(item.label || item.componentKey)
    )];
    return items.join(' / ');
  }
  return String(field?.label || field?.componentKey || '');
}

export function isResearchQuestionAnswered(
  field: any, fields: any[] = [], values: Record<string, any> = {}, domain = 'echo'
) {
  if (!field) return false;
  const isAnswered = (item: any) => {
    const value = values[item.key];
    return value !== null && value !== undefined && String(value).trim() !== '';
  };
  if (!isAnswered(field)) return false;

  // The IVC question represents a three-part assessment, not three
  // independent dropdown questions. Other grouped optional fields (such as
  // Reader Comment) must not change the original completion semantics.
  if (String(domain).toLowerCase() === 'echo' &&
      field.componentKey === 'ivcCollapsibility') {
    return getResearchGroupedFields(field, fields, domain).every(isAnswered);
  }
  return true;
}
