import {
  RESEARCH_RAP_CHOICES_MMHG,
  getResearchEchoPhases,
  getResearchEchoPhaseTarget,
  isRequiredResearchPhaseMissing,
  isUsableResearchTarget,
  getResearchRapChoices,
  getResearchCompanionField,
  getResearchGroupedFields,
  getResearchQuestionLabel,
  isResearchQuestionAnswered,
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
    expect(getResearchRapChoices({ componentKey: 'rap', config: { unit: 'mmHg' } }, 'ct'))
      .toEqual([]);
  });
  it('bundles IVC, RAP and RVSP into one Echo question while retaining independent values', () => {
    const fields = [
      { componentKey: 'trVmax', key: 'trVmax|', label: 'TR peak velocity' },
      { componentKey: 'ivcCollapsibility', key: 'ivcCollapsibility|',
        label: 'IVC collapsibility' },
      { componentKey: 'rap', key: 'rap|', label: 'Selected RAP (per protocol)',
        config: { options: ['3', '8', '15'] } },
      { componentKey: 'rvsp', key: 'rvsp|', label: 'Calculated RVSP',
        config: { calculation: { type: 'rvsp' } } },
    ];
    expect(getResearchGroupedFields(fields[1], fields).map(item => item.key))
      .toEqual(['rap|', 'rvsp|']);
    expect(getResearchQuestionLabel(fields[1], fields)).toBe('IVC / RAP / RVSP');
    expect(fields.filter(field => !isResearchCompanionHidden(field, fields))
      .map(field => field.key)).toEqual(['trVmax|', 'ivcCollapsibility|']);
    const values = {
      'trVmax|': 2.56,
      'ivcCollapsibility|': 40,
      'rap|': 3,
      'rvsp|': 29.2144,
    };
    expect(isResearchQuestionAnswered(fields[1], fields, values)).toBe(true);
    expect(isResearchQuestionAnswered(fields[1], fields, {
      ...values, 'rvsp|': '',
    })).toBe(false);
    // Grouped presentation does not rename, remove or recompute fields.
    expect(values['rap|']).toBe(3);
    expect(values['rvsp|']).toBeCloseTo(29.2144);
  });
  it('uses authored question count and sequence without viewer-only companions', () => {
    // This order is the protocol authoring order, not a guessed Echo order.
    const fields = [
      { componentKey: 'rvsp', key: 'rvsp|', label: 'Calculated RVSP',
        config: { calculation: { type: 'rvsp' } } },
      { componentKey: 'ivcCollapsibility', key: 'ivcCollapsibility|',
        label: 'IVC collapsibility' },
      { componentKey: 'readerComment', key: 'readerComment|', label: 'Comment' },
      { componentKey: 'imageQuality', key: 'imageQuality|', label: 'Quality' },
      { componentKey: 'rap', key: 'rap|', label: 'RAP' },
    ];
    const mode = 'authored';
    expect(fields.filter(field =>
      !isResearchCompanionHidden(field, fields, 'echo', mode)
    ).map(field => field.componentKey)).toEqual([
      'rvsp', 'ivcCollapsibility', 'readerComment', 'imageQuality', 'rap',
    ]);
    expect(getResearchGroupedFields(fields[1], fields, 'echo', mode)).toEqual([]);
    expect(getResearchQuestionLabel(fields[1], fields, 'echo', mode))
      .toBe('IVC collapsibility');
    const values = { 'ivcCollapsibility|': 40 };
    expect(isResearchQuestionAnswered(fields[1], fields, values, 'echo', mode)).toBe(true);
    expect(isResearchQuestionAnswered(fields[0], fields, values, 'echo', mode)).toBe(false);
    expect(fields.map(field => field.componentKey)).toHaveLength(5);
  });

  it('legacy snapshots retain the established grouped IVC navigation', () => {
    const fields = [
      { componentKey: 'ivcCollapsibility', key: 'ivcCollapsibility|' },
      { componentKey: 'rap', key: 'rap|' },
      { componentKey: 'rvsp', key: 'rvsp|' },
    ];
    expect(fields.filter(field => !isResearchCompanionHidden(field, fields))
      .map(field => field.componentKey)).toEqual(['ivcCollapsibility']);
  });

  it('does not hide RAP or RVSP when IVC is absent or on non-Echo profiles', () => {
    const fields = [
      { componentKey: 'rap', key: 'rap|' },
      { componentKey: 'rvsp', key: 'rvsp|' },
    ];
    expect(fields.every(field => !isResearchCompanionHidden(field, fields))).toBe(true);
    const full = [
      { componentKey: 'ivcCollapsibility', key: 'ivcCollapsibility|' },
      ...fields,
    ];
    expect(full.every(field => !isResearchCompanionHidden(field, full, 'ct')))
      .toBe(true);
  });
  it('respects a different explicit group assignment instead of applying Echo fallback', () => {
    const fields = [
      { componentKey: 'ivcCollapsibility', key: 'ivcCollapsibility|' },
      { componentKey: 'rap', key: 'rap|',
        config: { groupWithComponentKey: 'trVmax' } },
      { componentKey: 'rvsp', key: 'rvsp|' },
      { componentKey: 'trVmax', key: 'trVmax|' },
    ];
    expect(getResearchGroupedFields(fields[0], fields).map(x => x.componentKey))
      .toEqual(['rvsp']);
    expect(getResearchGroupedFields(fields[3], fields).map(x => x.componentKey))
      .toEqual(['rap']);
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
    expect(isResearchCompanionHidden(fields[1], fields, 'ct')).toBe(false);
    const other = [
      { componentKey: 'quality', key: 'quality|' },
      { componentKey: 'notes', key: 'notes|',
        config: { groupWithComponentKey: 'quality' } },
    ];
    expect(getResearchCompanionField(other[0], other)).toEqual(other[1]);
    expect(isResearchCompanionHidden(other[1], other)).toBe(true);
  });
});
