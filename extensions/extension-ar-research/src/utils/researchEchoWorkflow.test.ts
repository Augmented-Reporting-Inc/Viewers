import {
  RESEARCH_RAP_CHOICES_MMHG,
  getResearchEchoPhases,
  getResearchEchoPhaseTarget,
  isRequiredResearchPhaseMissing,
  isUsableResearchTarget,
  getResearchRapChoices,
  getResearchCompanionField,
  isResearchCompanionHidden,
} from './researchEchoWorkflow';

describe('Echo Research mirrors existing guided education controls', () => {
  it('lists 4 Simpson, 2 LA, 2 RV, and 2 IVC source phases', () => {
    expect(getResearchEchoPhases({ componentKey: 'lvEjectionFraction' })
      .map(item => item.slot)).toEqual(['A4C_ED','A4C_ES','A2C_ED','A2C_ES']);
    expect(getResearchEchoPhases({ componentKey: 'laVolumeDisks' })
      .map(item => item.slot)).toEqual(['A4C','A2C']);
    expect(getResearchEchoPhases({ componentKey: 'rvFac' })
      .map(item => item.slot)).toEqual(['RV_ED','RV_ES']);
    expect(getResearchEchoPhases({ componentKey: 'ivcCollapsibility' })
      .map(item => item.slot)).toEqual(['IVC_EXP','IVC_INSP']);
  });
  it('requires exact frame targets only when the protocol opts into phase guidance', () => {
    const field = { componentKey: 'laVolumeDisks',
      config: { compositeFrameGuidanceEnabled: true, compositeFrameTargets: {
        A4C: { sopInstanceUID: 'sop-1', frameNumber: 7 },
      } },
    };
    expect(isRequiredResearchPhaseMissing(field, 'A4C')).toBe(false);
    expect(isRequiredResearchPhaseMissing(field, 'A2C')).toBe(true);
    expect(getResearchEchoPhaseTarget(field, 'A4C').frameNumber).toBe(7);
    expect(isUsableResearchTarget({ sopInstanceUID: 'sop-1', frameNumber: 0 })).toBe(false);
  });
  it('uses same three explicit RAP choices, preserving custom protocol choices', () => {
    expect(RESEARCH_RAP_CHOICES_MMHG).toEqual([3,8,15]);
    expect(getResearchRapChoices({ componentKey: 'rap', config: { unit: 'mmHg' } }))
      .toEqual(['3','8','15']);
    expect(getResearchRapChoices({ componentKey: 'rap', config: {
      unit: 'mmHg', options: [{ value: '3', label: '3 mmHg' }],
    } })).toEqual(['3']);
    expect(getResearchRapChoices({ componentKey: 'other', config: { unit: 'mmHg' } }))
      .toEqual([]);
  });
  it('groups Image quality and Reader comment without changing stored keys', () => {
    const fields = [
      { componentKey: 'imageQuality', key: 'imageQuality|' },
      { componentKey: 'readerComment', key: 'readerComment|', config: {} },
      { componentKey: 'trVmax', key: 'trVmax|' },
    ];
    expect(getResearchCompanionField(fields[0], fields)).toEqual(fields[1]);
    expect(isResearchCompanionHidden(fields[1], fields)).toBe(true);
    expect(isResearchCompanionHidden(fields[2], fields)).toBe(false);
    const other = [
      { componentKey: 'quality', key: 'quality|' },
      { componentKey: 'notes', key: 'notes|',
        config: { groupWithComponentKey: 'quality' } },
    ];
    expect(getResearchCompanionField(other[0], other)).toEqual(other[1]);
    expect(isResearchCompanionHidden(other[1], other)).toBe(true);
  });
});
