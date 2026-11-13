import {
  EF_CONTOUR_FRAME_SLOTS,
  getEFGoldContourAuthoringRows,
  getEFGoldDerivedEvidenceStatus,
  matchesEFContourGoldSource,
} from './efGoldContourAuthoring';

const target = (slot: string, frame: number) => ({
  studyInstanceUID: 'study-1',
  seriesInstanceUID: 'series-1',
  sopInstanceUID: 'sop-' + slot,
  referencedImageId: 'dicom:' + slot + ':' + frame,
  frameNumber: frame,
});

const configured = Object.fromEntries(
  EF_CONTOUR_FRAME_SLOTS.map(({ slot }, index) => [slot, target(slot, index + 1)])
);
const saved = EF_CONTOUR_FRAME_SLOTS.map(({ slot }, index) => ({
  slot, complete: true, target: target(slot, index + 1),
}));

describe('unified EF contour authoring rows', () => {
  it('shows four matched configured and saved sources without duplicate navigation models', () => {
    const rows = getEFGoldContourAuthoringRows({
      efContourFrameGuidanceEnabled: true, efContourTargets: configured,
    }, saved);
    expect(rows.map(row => row.slot)).toEqual(['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES']);
    expect(rows.every(row => row.configuredComplete && row.goldVerified && !row.sourceMismatch))
      .toBe(true);
  });

  it('flags a changed target frame without modifying saved gold evidence', () => {
    const changes = { ...configured, A2C_ES: target('A2C_ES', 8) };
    const rows = getEFGoldContourAuthoringRows({
      efContourFrameGuidanceEnabled: true, efContourTargets: changes,
    }, saved);
    expect(rows.filter(row => row.sourceMismatch).map(row => row.slot)).toEqual(['A2C_ES']);
    expect(rows[3].savedTarget.frameNumber).toBe(4);
    expect(rows[3].configuredTarget.frameNumber).toBe(8);
  });

  it('rejects wrong SOP, study, series or referenced image even with equal frame', () => {
    const source = configured.A4C_ED;
    for (const mismatch of [
      { sopInstanceUID: 'other' },
      { seriesInstanceUID: 'other' },
      { studyInstanceUID: 'other' },
      { referencedImageId: 'other' },
      { referencedImageId: '' },
    ]) {
      expect(matchesEFContourGoldSource(source, { ...source, ...mismatch })).toBe(false);
    }
  });

  it('keeps saved gold review available when optional frame guidance is disabled', () => {
    const rows = getEFGoldContourAuthoringRows({
      efContourFrameGuidanceEnabled: false,
    }, saved);
    expect(rows.every(row => row.goldVerified && !row.configuredComplete && !row.sourceMismatch))
      .toBe(true);
  });

  it('keeps missing gold and incomplete configured sources distinct', () => {
    const rows = getEFGoldContourAuthoringRows({
      efContourFrameGuidanceEnabled: true,
      efContourTargets: { A4C_ED: configured.A4C_ED },
    }, [{ slot: 'A4C_ED', complete: false, target: target('A4C_ED', 1) }]);
    expect(rows[0].configuredComplete).toBe(true);
    expect(rows[0].goldVerified).toBe(false);
    expect(rows[0].sourceMismatch).toBe(false);
    expect(rows[1].configuredComplete).toBe(false);
    expect(rows[1].goldVerified).toBe(false);
  });

  it('does not equate a partial configured source with a verified gold source', () => {
    const rows = getEFGoldContourAuthoringRows({
      efContourFrameGuidanceEnabled: true,
      efContourTargets: { ...configured, A4C_ED: { sopInstanceUID: 'sop-A4C_ED', frameNumber: 1 } },
    }, saved);
    expect(rows[0].configuredComplete).toBe(false);
    expect(rows[0].goldVerified).toBe(true);
    expect(rows[0].sourceMismatch).toBe(false);
  });
});

describe('approved EF gold versus complete physical evidence', () => {
  const derived = () => ({
    slotLongAxisMM: Object.fromEntries(EF_CONTOUR_FRAME_SLOTS.map(
      ({ slot }, i) => [slot, 65 + i])),
    slotAreaCM2: Object.fromEntries(EF_CONTOUR_FRAME_SLOTS.map(
      ({ slot }, i) => [slot, 16 + i])),
    edvML: 110, esvML: 47,
  });
  const gold = () => ({
    value: 57.27,
    compositeResult: { derived: derived() },
  });

  it('requires four calibrated axes, four areas and EDV/ESV for new gold captures', () => {
    const result = getEFGoldDerivedEvidenceStatus(gold());
    expect(result.complete).toBe(true);
    expect(result.missingLongAxisSlots).toEqual([]);
    expect(result.missingAreaSlots).toEqual([]);
    expect(result.hasBiplaneVolumes).toBe(true);
  });

  it('identifies absent axes in older approved gold rather than inventing them', () => {
    const oldGold = gold();
    delete (oldGold.compositeResult.derived.slotLongAxisMM as any).A2C_ES;
    const result = getEFGoldDerivedEvidenceStatus(oldGold);
    expect(result.hasEF).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.missingLongAxisSlots).toEqual(['A2C_ES']);
    expect(oldGold.compositeResult.derived.slotLongAxisMM.A2C_ES).toBeUndefined();
  });

  it('does not treat null or empty data as zero-calibrated axes or volumes', () => {
    const oldGold = gold();
    oldGold.compositeResult.derived.slotLongAxisMM = {
      A4C_ED: null, A4C_ES: '', A2C_ED: 0, A2C_ES: 76,
    } as any;
    oldGold.compositeResult.derived.edvML = null as any;
    const result = getEFGoldDerivedEvidenceStatus(oldGold);
    expect(result.missingLongAxisSlots).toEqual(['A4C_ED', 'A4C_ES', 'A2C_ED']);
    expect(result.hasBiplaneVolumes).toBe(false);
    expect(result.complete).toBe(false);
  });

  it('reports absent physical evidence separately from scalar-only EF readiness', () => {
    const onlyValue = { value: 58, compositeResult: {} };
    const result = getEFGoldDerivedEvidenceStatus(onlyValue);
    expect(result.hasEF).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.missingLongAxisSlots).toHaveLength(4);
    expect(result.missingAreaSlots).toHaveLength(4);
  });
});
