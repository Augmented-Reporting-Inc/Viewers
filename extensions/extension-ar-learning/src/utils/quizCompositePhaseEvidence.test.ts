import {
  getCompositePhaseSlot, getCompositePhaseMeasurementId, getGoldPhaseMeasurementSummary,
  matchesCompositePhaseSource, getCompositeGoldCaptureSignature, findEditableCompositePhaseMeasurement,
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
  it('refuses a same-study wrong-phase-frame measurement during deletion', () => {
    const source = {
      uid: 'measured-ra', measurementKind: 'echoAreaSlot', echoArea: { slot: 'RA_ES' },
      referenceStudyUID: 'study-1', referenceSeriesUID: 'series-1',
      SOPInstanceUID: 'sop-1', frameNumber: 14,
    };
    const target = {
      studyInstanceUID: 'study-1', seriesInstanceUID: 'series-1',
      sopInstanceUID: 'sop-1', frameNumber: 14,
    };
    expect(matchesCompositePhaseSource(source, { target })).toBe(true);
    expect(matchesCompositePhaseSource(source, { target: { ...target, frameNumber: 15 } })).toBe(false);
    expect(matchesCompositePhaseSource(source, { target: { ...target, sopInstanceUID: 'sop-2' } })).toBe(false);
    expect(matchesCompositePhaseSource(source, { annotationId: 'measured-ra' })).toBe(true);
    expect(matchesCompositePhaseSource(source, { annotationId: 'different-ra' })).toBe(false);
    expect(matchesCompositePhaseSource(source)).toBe(false);
  });
  it('requires both unique RV phases in the same study before educator auto-capture', () => {
    const ed = { uid: 'ed', measurementKind: 'echoAreaSlot', echoArea: { slot: 'RV_ED' },
      referenceStudyUID: 'study', referenceSeriesUID: 'series', SOPInstanceUID: 'sop',
      frameNumber: 14 };
    const es = { ...ed, uid: 'es', echoArea: { slot: 'RV_ES' }, frameNumber: 17 };
    const question = { type: 'measurementNumeric', answerConfig: { measurementKind: 'rvFAC' } };
    expect(getCompositeGoldCaptureSignature(question, [ed])).toBe('');
    expect(getCompositeGoldCaptureSignature(question, [ed, es])).toBe('RV_ED:ed|RV_ES:es');
    expect(getCompositeGoldCaptureSignature(question, [ed, es, { ...es, uid: 'duplicate' }])).toBe('');
    expect(getCompositeGoldCaptureSignature(question, [ed, { ...es, referenceStudyUID: 'other' }])).toBe('');
  });
  it('does not auto-capture off-frame guided sources or an already-captured gold result', () => {
    const ed = { uid: 'ed', measurementKind: 'echoAreaSlot', echoArea: { slot: 'RV_ED' },
      referenceStudyUID: 'study', referenceSeriesUID: 'series', SOPInstanceUID: 'sop',
      frameNumber: 14 };
    const es = { ...ed, uid: 'es', echoArea: { slot: 'RV_ES' }, frameNumber: 17 };
    const target = frame => ({ studyInstanceUID: 'study', seriesInstanceUID: 'series',
      sopInstanceUID: 'sop', frameNumber: frame });
    const question = { type: 'measurementNumeric', answerConfig: {
      measurementKind: 'rvFAC', compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: { RV_ED: target(14), RV_ES: target(17) },
    }};
    expect(getCompositeGoldCaptureSignature(question, [ed, es])).toBe('RV_ED:ed|RV_ES:es');
    question.answerConfig.compositeFrameTargets.RV_ES = target(16);
    expect(getCompositeGoldCaptureSignature(question, [ed, es])).toBe('');
    question.answerConfig.compositeFrameTargets.RV_ES = target(17);
    question.answerConfig.goldMeasurement = { value: 50, compositeResult: { components: [
      { slot: 'RV_ED', annotationId: 'ed' }, { slot: 'RV_ES', annotationId: 'es' },
    ] }};
    expect(getCompositeGoldCaptureSignature(question, [ed, es])).toBe('');
  });
  it('detects two labelled IVC Length calipers without accepting unlabelled lengths', () => {
    const exp = { uid: 'exp', toolName: 'Length', label: 'IVCexp', referenceStudyUID: 'study' };
    const insp = { uid: 'insp', toolName: 'Length', label: 'IVCinsp', referenceStudyUID: 'study' };
    const question = { type: 'measurementNumeric', answerConfig: { measurementKind: 'ivcCollapsibility' } };
    expect(getCompositeGoldCaptureSignature(question, [exp, insp])).toBe('IVC_EXP:exp|IVC_INSP:insp');
    expect(getCompositeGoldCaptureSignature(question, [exp, { ...insp, label: 'Length' }])).toBe('');
  });
  it('keeps RV phase delete actions independently enabled for unique measurements', () => {
    const ed = { uid: 'ed', measurementKind: 'echoAreaSlot', echoArea: { slot: 'RV_ED' },
      referenceStudyUID: 'study', referenceSeriesUID: 'series', SOPInstanceUID: 'sop',
      frameNumber: 14 };
    const es = { ...ed, uid: 'es', echoArea: { slot: 'RV_ES' }, frameNumber: 17 };
    expect(findEditableCompositePhaseMeasurement([ed, es], 'rvFAC', 'RV_ED', {}).uid).toBe('ed');
    expect(findEditableCompositePhaseMeasurement([ed, es], 'rvFAC', 'RV_ES', {}).uid).toBe('es');
    expect(findEditableCompositePhaseMeasurement([ed, es], 'rvFAC', 'RV_ES',
      { target: { studyInstanceUID: 'study', seriesInstanceUID: 'series',
        sopInstanceUID: 'sop', frameNumber: 17 } }).uid).toBe('es');
    expect(findEditableCompositePhaseMeasurement([ed, es], 'rvFAC', 'RV_ES',
      { target: { studyInstanceUID: 'study', seriesInstanceUID: 'series',
        sopInstanceUID: 'sop', frameNumber: 16 } })).toBeNull();
    expect(findEditableCompositePhaseMeasurement([ed, es], 'rvFAC', 'RV_ES',
      { annotationId: 'missing' })).toBeNull();
  });
  it('accepts exact referenced DICOM imageId if a restored entry omits its numeric frame', () => {
    const target = { studyInstanceUID: 'study', seriesInstanceUID: 'series',
      sopInstanceUID: 'sop', frameNumber: 14, referencedImageId: 'wadors:study/series/sop/frame/14' };
    const measurement = { uid: 'ann', measurementKind: 'echoAreaSlot',
      echoArea: { slot: 'RV_ED' }, referenceStudyUID: 'study',
      referencedImageId: 'wadors:study/series/sop/frame/14' };
    expect(matchesCompositePhaseSource(measurement, { target })).toBe(true);
    expect(findEditableCompositePhaseMeasurement([measurement], 'rvFAC', 'RV_ED',
      { target })).toEqual(measurement);
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
