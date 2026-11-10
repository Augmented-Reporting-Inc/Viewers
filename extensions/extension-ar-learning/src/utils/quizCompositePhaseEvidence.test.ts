import {
  getCompositePhaseSlot, getCompositePhaseMeasurementId, getGoldPhaseMeasurementSummary,
} from './quizCompositePhaseEvidence';

describe('quiz composite phase evidence', () => {
  it('matches only explicitly tagged right-heart contours', () => {
    const rv = { uid: 'rv-ed', measurementKind: 'echoAreaSlot', echoArea: { slot: 'RV_ED' } };
    expect(getCompositePhaseSlot(rv, 'rvFAC')).toBe('RV_ED');
    expect(getCompositePhaseMeasurementId(rv)).toBe('rv-ed');
    expect(getCompositePhaseSlot({ ...rv, measurementKind: 'area' }, 'rvFAC')).toBe('');
    expect(getCompositePhaseSlot(rv, 'laVolumeBiplane')).toBe('');
  });
  it('matches LA slots independently of RV and RA', () => {
    expect(getCompositePhaseSlot({
      measurementKind: 'laVolumeSlot', laVolume: { slot: 'A2C' },
    }, 'laVolumeBiplaneDisks')).toBe('A2C');
  });
  it('recognizes only labelled IVC Length calipers', () => {
    expect(getCompositePhaseSlot({ toolName: 'Length', label: 'IVCexp' }, 'ivcCollapsibility'))
      .toBe('IVC_EXP');
    expect(getCompositePhaseSlot({ toolName: 'Length', label: 'IVCinsp' }, 'ivcCollapsibility'))
      .toBe('IVC_INSP');
    expect(getCompositePhaseSlot({ toolName: 'Length', label: 'RVEDA' }, 'ivcCollapsibility'))
      .toBe('');
    expect(getCompositePhaseSlot({ toolName: 'PlanarFreehandROI', label: 'IVCexp' }, 'ivcCollapsibility'))
      .toBe('');
  });
  it('formats physical geometry as approximate and does not treat missing geometry as numeric', () => {
    expect(getGoldPhaseMeasurementSummary({
      points: [[0,0,0],[10,0,0],[10,10,0],[0,10,0]],
    }, 'rvFAC')).toContain('1.00 cm²');
    expect(getGoldPhaseMeasurementSummary({
      points: [[0,0,0],[3,4,0]],
    }, 'ivcCollapsibility')).toContain('5.00 mm');
    expect(getGoldPhaseMeasurementSummary({}, 'raArea')).toBe('Gold source recorded');
  });
});
