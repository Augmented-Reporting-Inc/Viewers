import { buildReadFields, normalizeReadSchema } from './readSchema';
import { isResearchCompanionHidden } from './researchEchoWorkflow';
import { resolveResearchCaseReadSchema } from './researchCaseFrameTargets';

describe('unified authored assessment navigation contract', () => {
  const protocol = {
    schemaKey: 'echo-core-lab-read',
    schemaVersion: '2.0',
    domain: 'echo',
    config: { questionNavigationMode: 'authored' },
    components: [
      { componentKey: 'rvsp', label: 'Calculated RVSP', kind: 'number',
        config: { calculation: { type: 'rvsp' } } },
      { componentKey: 'ivcCollapsibility', label: 'IVC collapsibility',
        kind: 'measurement', config: { unit: '%' } },
      { componentKey: 'rap', label: 'RAP selection',
        kind: 'ordinal', config: { options: ['3', '8', '15'] } },
      { componentKey: 'imageQuality', label: 'Image quality', kind: 'ordinal' },
      { componentKey: 'readerComment', label: 'Reader comment', kind: 'text' },
    ],
  };

  it('preserves the backend schema contract through normalization and case-target resolution', () => {
    const normalized = normalizeReadSchema(protocol);
    expect(normalized.config.questionNavigationMode).toBe('authored');
    const resolved = resolveResearchCaseReadSchema(normalized, '1.2.840.113619.2.1');
    expect(resolved.config.questionNavigationMode).toBe('authored');
    const fields = buildReadFields(resolved);
    expect(fields.map(field => field.componentKey))
      .toEqual(protocol.components.map(component => component.componentKey));
    expect(fields.filter(field =>
      !isResearchCompanionHidden(field, fields, 'echo',
        resolved.config.questionNavigationMode)
    )).toHaveLength(protocol.components.length);
  });

  it('removal and reordering in the saved definition translate exactly to navigation', () => {
    const edited = {
      ...protocol,
      components: [
        protocol.components[2], protocol.components[4],
        protocol.components[1], protocol.components[0],
      ],
    };
    const fields = buildReadFields(resolveResearchCaseReadSchema(
      normalizeReadSchema(edited), '1.2.840.113619.2.1'
    ));
    expect(fields.map(field => field.componentKey))
      .toEqual(['rap', 'readerComment', 'ivcCollapsibility', 'rvsp']);
    expect(fields.some(field => field.componentKey === 'imageQuality')).toBe(false);
  });

  it('retains legacy default grouping when no authored contract is present', () => {
    const old = normalizeReadSchema({
      ...protocol, config: {},
    });
    const fields = buildReadFields(old);
    expect(fields.filter(field => !isResearchCompanionHidden(
      field, fields, 'echo', 'legacy'
    )).map(field => field.componentKey))
      .toEqual(['ivcCollapsibility', 'imageQuality']);
  });
});
