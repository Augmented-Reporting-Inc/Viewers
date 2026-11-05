import {
  COMPOSITE_FRAME_SLOTS, getCompleteCompositeFrameTargets,
  getCompositePhaseFrameTarget, matchesConfiguredCompositeFrame,
} from './compositeFrameTargets';

const target = (sop: string, frame = 1, study = 'study-1') => ({
  studyInstanceUID: study,
  seriesInstanceUID: 'series-1',
  sopInstanceUID: sop,
  referencedImageId: `wadors:/studies/${study}/series/series-1/instances/${sop}/frames/${frame}`,
  frameNumber: frame,
});
describe('independent DICOM phase targets', () => {
  it.each(['laVolumeBiplane', 'laVolumeBiplaneDisks', 'rvFAC', 'ivcCollapsibility', 'ivcRapRvsp'])(
    '%s permits independent identified instances and frames',
    kind => {
      const slots = COMPOSITE_FRAME_SLOTS[kind];
      const targets = Object.fromEntries(slots.map(({ slot }, i) => [slot, target(`sop-${i + 1}`)]));
      const config = {
        measurementKind: kind, compositeFrameGuidanceEnabled: true,
        compositeFrameTargets: targets,
      };
      expect(getCompleteCompositeFrameTargets(config)).toEqual(targets);
      expect(getCompositePhaseFrameTarget(config, slots[1].slot)).toEqual(targets[slots[1].slot]);
      expect(getCompleteCompositeFrameTargets({
        ...config, compositeFrameGuidanceEnabled: false,
      })).toBeNull();
    }
  );
  it('requires the active viewport to match the configured source after navigation', () => {
    const expected = target('sop-a', 14);
    expect(matchesConfiguredCompositeFrame({ ...expected }, expected)).toBe(true);
    expect(matchesConfiguredCompositeFrame(target('sop-b', 14), expected)).toBe(false);
    expect(matchesConfiguredCompositeFrame(target('sop-a', 13), expected)).toBe(false);
    expect(matchesConfiguredCompositeFrame(target('sop-a', 14, 'other-study'), expected)).toBe(false);
    expect(matchesConfiguredCompositeFrame({ ...expected, seriesInstanceUID: '' }, expected)).toBe(false);
  });
  it('supports separate frames within the same DICOM cine', () => {
    const config = {
      measurementKind: 'rvFAC', compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: { RV_ED: target('sop-a', 1), RV_ES: target('sop-a', 14) },
    };
    expect(getCompleteCompositeFrameTargets(config)).not.toBeNull();
  });
  it('rejects duplicate frame, cross-study and missing provenance', () => {
    const config = {
      measurementKind: 'ivcCollapsibility', compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: { IVC_EXP: target('sop-a'), IVC_INSP: target('sop-b') },
    };
    expect(getCompleteCompositeFrameTargets({
      ...config,
      compositeFrameTargets: { IVC_EXP: target('sop-a'), IVC_INSP: target('sop-a') },
    })).toBeNull();
    expect(getCompleteCompositeFrameTargets({
      ...config,
      compositeFrameTargets: { IVC_EXP: target('sop-a'), IVC_INSP: target('sop-b', 1, 'study-2') },
    })).toBeNull();
    expect(getCompleteCompositeFrameTargets({
      ...config,
      compositeFrameTargets: { IVC_EXP: target('sop-a'), IVC_INSP: { ...target('sop-b'), sopInstanceUID: '' } },
    })).toBeNull();
  });
});
