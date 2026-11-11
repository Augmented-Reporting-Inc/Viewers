import {
  getCompositePhaseSlot, getCompositePhaseMeasurementId, getGoldPhaseMeasurementSummary,
  matchesCompositePhaseSource, getCompositeGoldCaptureSignature, getSavedCompositePhaseValues,
  needsSavedCalibratedGoldAreas,
  findEditableCompositePhaseMeasurement, clearSavedCompositeGoldPhase,
  getCompositeGoldPersistenceError, getIncompleteCompositeGoldReplacementReason,
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
  it('clears old A2C gold by saved annotation identity even when its DICOM frame is unloaded', () => {
    const oldTarget = { studyInstanceUID: 'study', seriesInstanceUID: 'series-old',
      sopInstanceUID: 'sop-old', frameNumber: 8 };
    const replacementTarget = { studyInstanceUID: 'study', seriesInstanceUID: 'series-new',
      sopInstanceUID: 'sop-new', frameNumber: 22 };
    const a4c = { slot: 'A4C', annotationId: 'four', target: {
      ...oldTarget, frameNumber: 12 } };
    const a2c = { slot: 'A2C', annotationId: 'old-two', target: oldTarget };
    const question = { type: 'measurementNumeric', answerConfig: {
      measurementKind: 'laVolumeBiplane', goldValue: 68.59,
      compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: { A4C: a4c.target, A2C: oldTarget },
      goldMeasurement: { value: 68.59, compositeResult: {
        value: 68.59, components: [a4c, a2c],
        derived: { a4cAreaCM2: 31.26, a2cAreaCM2: 4.48 },
      } },
    } };
    const newContour = { uid: 'new-two', measurementKind: 'laVolumeSlot',
      laVolume: { slot: 'A2C' }, referenceStudyUID: 'study',
      referenceSeriesUID: 'series-new', SOPInstanceUID: 'sop-new', frameNumber: 22 };
    // Never confuse a new contour with the old gold merely because both
    // represent A2C in the same study.
    expect(findEditableCompositePhaseMeasurement([newContour],
      'laVolumeBiplane', 'A2C', { annotationId: 'old-two', target: oldTarget })).toBeNull();
    expect(clearSavedCompositeGoldPhase(question, 'A2C', 'wrong-id')).toBeNull();
    const cleared = clearSavedCompositeGoldPhase(question, 'A2C', 'old-two');
    expect(cleared.answerConfig.goldValue).toBeNull();
    expect(cleared.answerConfig.goldMeasurement.value).toBeNull();
    expect(cleared.answerConfig.goldMeasurement.compositeResult.value).toBeNull();
    expect(cleared.answerConfig.goldMeasurement.compositeResult.derived).toBeNull();
    expect(cleared.answerConfig.goldMeasurement.compositeResult.components).toEqual([a4c]);
    expect(cleared.answerConfig.compositeFrameTargets.A4C).toEqual(a4c.target);
    expect(cleared.answerConfig.compositeFrameTargets.A2C).toBeUndefined();
    expect(question.answerConfig.goldValue).toBe(68.59);
    expect(getCompositeGoldPersistenceError([cleared], [question]))
      .toContain('cleared gold answer');
    expect(getCompositeGoldPersistenceError([cleared], [cleared])).toBe('');
    // After explicit Replace source, the new source must survive a delayed
    // clear of old gold.
    const updated = { ...question, answerConfig: { ...question.answerConfig,
      compositeFrameTargets: { ...question.answerConfig.compositeFrameTargets,
        A2C: replacementTarget } } };
    expect(clearSavedCompositeGoldPhase(updated, 'A2C', 'old-two')
      .answerConfig.compositeFrameTargets.A2C).toEqual(replacementTarget);
  });
  it('clears RV ED independently without retaining obsolete calculated FAC', () => {
    const source = { slot: 'RV_ED', annotationId: 'rv-old',
      target: { studyInstanceUID: 's', seriesInstanceUID: 'x',
        sopInstanceUID: 'old', frameNumber: 3 } };
    const other = { slot: 'RV_ES', annotationId: 'rv-es' };
    const question = { answerConfig: {
      goldValue: 27, goldMeasurement: { value: 27,
        compositeResult: { components: [source, other],
          derived: { edaCM2: 35, esaCM2: 25 } } },
    } };
    const cleared = clearSavedCompositeGoldPhase(question, 'RV_ED', 'rv-old');
    expect(cleared.answerConfig.goldValue).toBeNull();
    expect(cleared.answerConfig.goldMeasurement.compositeResult.derived).toBeNull();
    expect(cleared.answerConfig.goldMeasurement.compositeResult.components).toEqual([other]);
    expect(clearSavedCompositeGoldPhase(cleared, 'RV_ED', 'rv-old')).toBeNull();
  });
  it('blocks a misleading save after one LAV phase was replaced but gold was not recaptured', () => {
    const pending = { type: 'measurementNumeric', answerConfig: {
      measurementKind: 'laVolumeBiplane', goldValue: null,
      goldMeasurement: { value: null, compositeResult: {
        components: [{ slot: 'A4C', annotationId: 'kept-a4c' }],
      } },
    } };
    expect(getIncompleteCompositeGoldReplacementReason([pending]))
      .toContain('A2C');
    expect(getIncompleteCompositeGoldReplacementReason([{
      ...pending, answerConfig: { ...pending.answerConfig,
        goldValue: 51, goldMeasurement: { value: 51, compositeResult: {
          components: [
            { slot: 'A4C', annotationId: 'kept-a4c' },
            { slot: 'A2C', annotationId: 'new-a2c' },
          ],
        } },
      },
    }])).toBe('');
    expect(getIncompleteCompositeGoldReplacementReason([{
      ...pending, answerConfig: { measurementKind: 'laVolumeBiplane' },
    }])).toBe('');
  });
  it('also detects a partially removed RV phase without affecting complete answers', () => {
    const rv = { answerConfig: { measurementKind: 'rvFAC', goldValue: null,
      goldMeasurement: { compositeResult: { components: [
        { slot: 'RV_ES', annotationId: 'es' },
      ] } },
    } };
    expect(getIncompleteCompositeGoldReplacementReason([rv])).toContain('RV_ED');
    expect(getIncompleteCompositeGoldReplacementReason([])).toBe('');
  });
  it('preserves A4C evidence when replacing A2C on another frame', () => {
    const target = (sop: string, frameNumber: number) => ({
      studyInstanceUID: 'study', seriesInstanceUID: 'series',
      sopInstanceUID: sop, frameNumber,
      referencedImageId: 'wadors:study/series/' + sop + '/frames/' + frameNumber,
    });
    const a4c = { slot: 'A4C', annotationId: 'a4c-existing', target: target('sop-a4c', 18) };
    const previousA2C = { slot: 'A2C', annotationId: 'a2c-old', target: target('sop-a2c-old', 8) };
    const original = { type: 'measurementNumeric', questionKey: 'lav', answerConfig: {
      measurementKind: 'laVolumeBiplane', compositeFrameGuidanceEnabled: true,
      compositeFrameTargets: { A4C: a4c.target, A2C: previousA2C.target },
      goldValue: 68.59, goldMeasurement: { value: 68.59, compositeResult: {
        components: [a4c, previousA2C], derived: { a4cAreaCM2: 25, a2cAreaCM2: 22 },
      } },
    } };
    const cleared = clearSavedCompositeGoldPhase(original, 'A2C', 'a2c-old');
    expect(cleared.answerConfig.goldMeasurement.compositeResult.components).toEqual([a4c]);
    expect(cleared.answerConfig.compositeFrameTargets.A4C).toEqual(a4c.target);
    const newTarget = target('sop-a2c-new', 29);
    const updated = { ...cleared, answerConfig: {
      ...cleared.answerConfig,
      compositeFrameTargets: { ...cleared.answerConfig.compositeFrameTargets, A2C: newTarget },
    } };
    const measurement = (slot: string, annotationId: string, source: any) => ({
      uid: annotationId, measurementKind: 'laVolumeSlot', laVolume: { slot },
      referenceStudyUID: 'study', referenceSeriesUID: 'series',
      SOPInstanceUID: source.sopInstanceUID, frameNumber: source.frameNumber,
      referencedImageId: source.referencedImageId,
    });
    // The prior A4C must remain eligible for a new complete calculated gold
    // without requiring a new A4C annotation ID.
    expect(getCompositeGoldCaptureSignature(updated, [
      measurement('A4C', 'a4c-existing', a4c.target),
      measurement('A2C', 'a2c-new', newTarget),
    ])).toBe('A4C:a4c-existing|A2C:a2c-new');
    expect(getIncompleteCompositeGoldReplacementReason([updated])).toContain('A2C');
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
