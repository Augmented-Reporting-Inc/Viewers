import {
  getCompositePhaseSlot, getCompositePhaseMeasurementId, getGoldPhaseMeasurementSummary,
  matchesCompositePhaseSource, getCompositeGoldCaptureSignature, getSavedCompositePhaseValues,
  needsSavedCalibratedGoldAreas,
  findEditableCompositePhaseMeasurement,
  getCompositeGoldPersistenceError,
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
    expect(getCompositeGoldCaptureSignature({
      ...question, viewerTarget: { studyInstanceUID: 'other-study' },
    }, [ed, es])).toBe('');
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
    ], derived: { edaCM2: 30, esaCM2: 18 } }};
    expect(getCompositeGoldCaptureSignature(question, [ed, es])).toBe('');
  });
  it('safely detects legacy gold missing physical phase values', () => {
    const ed = { uid: 'ed', measurementKind: 'echoAreaSlot',
      echoArea: { slot: 'RV_ED' }, referenceStudyUID: 'study' };
    const es = { ...ed, uid: 'es', echoArea: { slot: 'RV_ES' } };
    const question = { type: 'measurementNumeric', answerConfig: {
      measurementKind: 'rvFAC', goldMeasurement: { value: 40, compositeResult: {
        components: [{ slot: 'RV_ED', annotationId: 'ed' },
          { slot: 'RV_ES', annotationId: 'es' }],
      } },
    } };
    expect(getCompositeGoldCaptureSignature(question, [ed, es]))
      .toBe('backfill:RV_ED:ed|RV_ES:es');
    question.answerConfig.goldMeasurement.compositeResult.derived = {
      edaCM2: 30, esaCM2: 18,
    };
    expect(getCompositeGoldCaptureSignature(question, [ed, es])).toBe('');
    const modified = { ...es, uid: 'replaced' };
    expect(getCompositeGoldCaptureSignature(question, [ed, modified]))
      .toBe('RV_ED:ed|RV_ES:replaced');
  });
  it('automatically identifies older RV/LA gold requiring source-based area hydration', () => {
    const question = (kind: string, slots: string[]) => ({
      type: 'measurementNumeric', answerConfig: {
        measurementKind: kind, goldMeasurement: {
          value: kind === 'rvFAC' ? 19.71 : 68.59,
          compositeResult: { components: slots.map((slot, index) => ({
            slot, annotationId: 'a' + index,
            target: { sopInstanceUID: 'sop-' + index },
          })) },
        },
      },
    });
    const rv = question('rvFAC', ['RV_ED', 'RV_ES']);
    const la = question('laVolumeBiplane', ['A4C', 'A2C']);
    expect(needsSavedCalibratedGoldAreas(rv)).toBe(true);
    expect(needsSavedCalibratedGoldAreas(la)).toBe(true);
    expect(needsSavedCalibratedGoldAreas(question('laVolumeBiplaneDisks', ['A4C', 'A2C'])))
      .toBe(true);
    rv.answerConfig.goldMeasurement.compositeResult.derived = {
      edaCM2: 29.7, esaCM2: 23.85,
    };
    expect(needsSavedCalibratedGoldAreas(rv)).toBe(false);
    la.answerConfig.goldMeasurement.compositeResult.derived = { a4cAreaCM2: 15.2 };
    expect(needsSavedCalibratedGoldAreas(la)).toBe(true);
    la.answerConfig.goldMeasurement.compositeResult.derived.a2cAreaCM2 = 14.2;
    expect(needsSavedCalibratedGoldAreas(la)).toBe(false);
    expect(needsSavedCalibratedGoldAreas(question('ivcCollapsibility',
      ['IVC_EXP', 'IVC_INSP']))).toBe(false);
    const noSource = question('rvFAC', ['RV_ED', 'RV_ES']);
    noSource.answerConfig.goldMeasurement.compositeResult.components[0].target.sopInstanceUID = '';
    expect(needsSavedCalibratedGoldAreas(noSource)).toBe(false);
  });

  it('projects only saved validated RV, LA and IVC phase values', () => {
    expect(getSavedCompositePhaseValues({ compositeResult: { derived: {
      edaCM2: 25.25, esaCM2: 15.1,
    } } }, 'rvFAC')).toEqual({ RV_ED: 25.25, RV_ES: 15.1 });
    expect(getSavedCompositePhaseValues({ compositeResult: { derived: {
      a4cAreaCM2: 16, a2cAreaCM2: 11.25,
    } } }, 'laVolumeBiplane')).toEqual({ A4C: 16, A2C: 11.25 });
    expect(getSavedCompositePhaseValues({ compositeResult: { derived: {
      expirationDiameterMM: 20.5, inspirationDiameterMM: 10.5,
    } } }, 'ivcCollapsibility')).toEqual({ IVC_EXP: 20.5, IVC_INSP: 10.5 });
    expect(getSavedCompositePhaseValues({ compositeResult: { components: [
      { points: [[0,0,0],[10,0,0]] },
    ] } }, 'ivcCollapsibility')).toEqual({});
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
  it('detects FormAPI gold/source evidence dropped during quiz save', () => {
    const target = { studyInstanceUID: 'study', seriesInstanceUID: 'series',
      sopInstanceUID: 'sop', frameNumber: 14 };
    const question = { questionKey: 'q-rv', type: 'measurementNumeric', answerConfig: {
      measurementKind: 'rvFAC', compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: { RV_ED: target },
      goldMeasurement: { value: 50, compositeResult: { components: [
        { slot: 'RV_ED', annotationId: 'ed', target, points: [[0,0],[1,0],[1,1]] },
      ] } },
    } };
    expect(getCompositeGoldPersistenceError([question], [question])).toBe('');
    expect(getCompositeGoldPersistenceError([question], [{
      ...question, answerConfig: { ...question.answerConfig, goldMeasurement: null },
    }])).toContain('gold measurement');
    expect(getCompositeGoldPersistenceError([question], [{
      ...question, answerConfig: { ...question.answerConfig, compositeFrameTargets: {} },
    }])).toContain('source frame');
    const enriched = { ...question, answerConfig: { ...question.answerConfig,
      goldMeasurement: { ...question.answerConfig.goldMeasurement,
        compositeResult: { ...question.answerConfig.goldMeasurement.compositeResult,
          derived: { edaCM2: 30, esaCM2: 18 },
        },
      },
    } };
    expect(getCompositeGoldPersistenceError([enriched], [question]))
      .toContain('calibrated gold phase values');
    expect(getCompositeGoldPersistenceError([enriched], [enriched])).toBe('');
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
