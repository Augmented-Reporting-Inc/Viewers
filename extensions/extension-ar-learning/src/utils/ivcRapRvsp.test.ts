import { composeIVCRapRVSP, attachRapRvspEvidenceToIVCAnswer, attachLearnerRapRvspToIVCAnswer, attachLearnerRapSelectionToIVCAnswer, isIVCReviewCurrent, isLearnerIVCRapSelectionComplete, reconcileLearnerIVCRecapture } from './ivcRapRvsp';

function target(instance: string, frame: number) {
  return {
    studyInstanceUID: 'study-1',
    seriesInstanceUID: instance,
    sopInstanceUID: instance,
    frameNumber: frame,
  };
}
const ivc = {
  measurementKind: 'ivcCollapsibility',
  unit: '%',
  value: 60,
  compositeResult: {
    methodId: 'ivc-collapsibility-v1',
    components: [
      { slot: 'IVC_EXP', annotationId: 'exp', points: [[0,0,0],[20,0,0]], target: target('exp-sop',1) },
      { slot: 'IVC_INSP', annotationId: 'insp', points: [[0,0,0],[8,0,0]], target: target('insp-sop',1) },
    ],
  },
};
const tr = {
  measurementKind: 'trVmax', unit: 'm/s', value: 2.8,
  sourceAnnotationId: 'tr-source', viewerTarget: target('tr-sop',1),
};
const args = { ivcAnswer: ivc, trVmaxAnswer: tr, trVmaxQuestionKey: 'q-tr', rapMMHG: 3 };

describe('linked educational IVC/RAP/RVSP result', () => {
  it('does not infer RAP and uses the prior TR answer to compute RVSP', () => {
    expect(composeIVCRapRVSP({ ...args, rapMMHG: undefined }).status).toBe('unavailable');
    const result = composeIVCRapRVSP(args);
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') return;
    expect(result.value).toBe(34.36);
    expect(result.compositeResult.rapMMHG).toBe(3);
    expect(result.compositeResult.trVmax.questionKey).toBe('q-tr');
    const rap8 = composeIVCRapRVSP({ ...args, rapMMHG: 8 });
    const rap15 = composeIVCRapRVSP({ ...args, rapMMHG: 15 });
    expect(rap8.status === 'complete' ? rap8.value : null).toBe(39.36);
    expect(rap15.status === 'complete' ? rap15.value : null).toBe(46.36);
  });
  it('requires persisted source references rather than synthesized numbers', () => {
    expect(composeIVCRapRVSP({ ...args, trVmaxAnswer: { ...tr, sourceAnnotationId: '' } }).status).toBe('unavailable');
    expect(composeIVCRapRVSP({ ...args, trVmaxQuestionKey: '' }).status).toBe('unavailable');
    expect(composeIVCRapRVSP({ ...args, rapMMHG: 5 }).status).toBe('unavailable');
    expect(composeIVCRapRVSP({ ...args, ivcAnswer: {
      ...ivc, compositeResult: { ...ivc.compositeResult, components: ivc.compositeResult.components.slice(0,1) },
    }}).status).toBe('unavailable');
  });
});

describe('IVC review integrity checkpoint', () => {
  it('allows the exact reviewed source calipers to be accepted', () => {
    expect(isIVCReviewCurrent(ivc, JSON.parse(JSON.stringify(ivc)))).toBe(true);
  });
  it('invalidates source, geometry and derived value changes', () => {
    const differentFrame = JSON.parse(JSON.stringify(ivc));
    differentFrame.compositeResult.components[0].target.frameNumber = 2;
    expect(isIVCReviewCurrent(ivc, differentFrame)).toBe(false);
    const editedContour = JSON.parse(JSON.stringify(ivc));
    editedContour.compositeResult.components[1].points[1][0] = 9;
    expect(isIVCReviewCurrent(ivc, editedContour)).toBe(false);
    expect(isIVCReviewCurrent(ivc, { ...ivc, value: 65 })).toBe(false);
  });
});

describe('educator IVC gold reference from earlier gold TR Vmax', () => {
  it('retains the IVC scored percent and links the exact TR source', () => {
    const composed = attachRapRvspEvidenceToIVCAnswer({
      ...args, rapMMHG: 8,
    });
    expect(composed.status).toBe('complete');
    if (composed.status !== 'complete') return;
    expect(composed.answer.measurementKind).toBe('ivcCollapsibility');
    expect(composed.answer.value).toBe(60);
    expect(composed.answer.unit).toBe('%');
    expect(composed.answer.compositeResult.components).toEqual(ivc.compositeResult.components);
    expect(composed.answer.compositeResult.rapMMHG).toBe(8);
    expect(composed.answer.compositeResult.rvspMMHG).toBe(39.36);
    expect(composed.answer.compositeResult.rapRvsp.trVmax.questionKey).toBe('q-tr');
    expect(composed.answer.compositeResult.rapRvsp.trVmax.answer.sourceAnnotationId)
      .toBe('tr-source');
  });
  it('does not calculate RVSP from an unverified TR source or unsupported RAP', () => {
    expect(attachRapRvspEvidenceToIVCAnswer({
      ...args, trVmaxAnswer: { ...tr, viewerTarget: null },
    }).status).toBe('unavailable');
    expect(attachRapRvspEvidenceToIVCAnswer({
      ...args, rapMMHG: 10,
    }).status).toBe('unavailable');
  });
});

describe('independent learner RAP without a source-linked TR answer', () => {
  it('saves an explicit RAP on verified IVC but leaves RVSP unavailable', () => {
    const result = attachLearnerRapSelectionToIVCAnswer({
      ivcAnswer: ivc, rapMMHG: 8,
    });
    expect(result.status).toBe('rap-only');
    if (result.status !== 'rap-only') return;
    expect(result.answer.value).toBe(60);
    expect(result.answer.unit).toBe('%');
    expect(result.answer.compositeResult.components).toEqual(ivc.compositeResult.components);
    expect(result.answer.compositeResult.rapMMHG).toBe(8);
    expect(result.answer.compositeResult.rvspMMHG).toBeNull();
    expect(result.answer.compositeResult.trGradientMMHG).toBeNull();
    expect(result.answer.compositeResult.rapRvsp.ivc).toBe(ivc);
    expect(result.answer.compositeResult.rapRvsp).not.toHaveProperty('trVmax');
  });
  it('rejects an inferred RAP, incomplete caliper sources and invalid selection', () => {
    expect(attachLearnerRapSelectionToIVCAnswer({ ivcAnswer: ivc }).status)
      .toBe('unavailable');
    expect(attachLearnerRapSelectionToIVCAnswer({
      ivcAnswer: ivc, rapMMHG: 5,
    }).status).toBe('unavailable');
    expect(attachLearnerRapSelectionToIVCAnswer({
      ivcAnswer: { ...ivc, compositeResult: {
        ...ivc.compositeResult, components: ivc.compositeResult.components.slice(0, 1),
      } },
      rapMMHG: 8,
    }).status).toBe('unavailable');
  });
});

describe('existing IVC collapsibility quiz with additional reviewed RAP and RVSP', () => {
  it('retains the original collapsibility percent and exact source contours', () => {
    const answer = attachLearnerRapRvspToIVCAnswer(args);
    expect(answer.status).toBe('complete');
    if (answer.status !== 'complete') return;
    expect(answer.answer.measurementKind).toBe('ivcCollapsibility');
    expect(answer.answer.unit).toBe('%');
    expect(answer.answer.value).toBe(60);
    expect(answer.answer.compositeResult.components).toEqual(ivc.compositeResult.components);
    expect(answer.answer.compositeResult.rapMMHG).toBe(3);
    expect(answer.answer.compositeResult.rvspMMHG).toBe(34.36);
    expect(answer.answer.compositeResult.rapRvsp.trVmax.questionKey).toBe('q-tr');
    expect(isIVCReviewCurrent(answer.answer.compositeResult.rapRvsp.ivc, ivc)).toBe(true);
    expect(ivc.compositeResult).not.toHaveProperty('rapMMHG');
  });
  it('refuses missing source-linked TR velocity or an unreviewed RAP', () => {
    expect(attachLearnerRapRvspToIVCAnswer({
      ...args, rapMMHG: undefined,
    }).status).toBe('unavailable');
    expect(attachLearnerRapRvspToIVCAnswer({
      ...args, trVmaxAnswer: { ...tr, sourceAnnotationId: '' },
    }).status).toBe('unavailable');
  });
});

describe('learner recapture of reviewed IVC calipers', () => {
  const reviewed = attachLearnerRapRvspToIVCAnswer({ ...args, rapMMHG: 8 });
  const previous = reviewed.status === 'complete' ? reviewed.answer : null;
  const capture = () => JSON.parse(JSON.stringify(ivc));
  const reconcile = (capturedAnswer: any, trVmaxAnswer: any = tr, trVmaxQuestionKey = 'q-tr') =>
    reconcileLearnerIVCRecapture({
      previousAnswer: previous, capturedAnswer, trVmaxAnswer, trVmaxQuestionKey,
    });

  it('preserves an explicit RAP and RVSP on an identical source recapture', () => {
    const current = reconcile(capture());
    expect(current.measurementKind).toBe('ivcCollapsibility');
    expect(current.value).toBe(60);
    expect(current.compositeResult.rapMMHG).toBe(8);
    expect(current.compositeResult.rvspMMHG).toBe(39.36);
    expect(current.compositeResult.rapRvsp.trVmax.answer.sourceAnnotationId).toBe('tr-source');
    expect(isIVCReviewCurrent(current.compositeResult.rapRvsp.ivc, current)).toBe(true);
  });

  it('invalidates RAP/RVSP after changed IVC geometry or frame', () => {
    for (const change of ['geometry', 'frame']) {
      const edited = capture();
      if (change === 'geometry') edited.compositeResult.components[1].points[1][0] = 9;
      else edited.compositeResult.components[0].target.frameNumber = 2;
      const current = reconcile(edited);
      expect(current.compositeResult).not.toHaveProperty('rapMMHG');
      expect(current.compositeResult).not.toHaveProperty('rvspMMHG');
      expect(current.compositeResult).not.toHaveProperty('rapRvsp');
    }
  });

  it('retains explicitly reviewed RAP but never stale RVSP after TR changes', () => {
    const current = reconcile(capture(), { ...tr, sourceAnnotationId: 'another-tr' });
    expect(current.compositeResult.rapMMHG).toBe(8);
    expect(current.compositeResult.rvspMMHG).toBeNull();
    expect(current.compositeResult.rapRvsp).not.toHaveProperty('trVmax');
  });

  it('retains a RAP-only review without calculating RVSP from a later TR', () => {
    const rapOnly = attachLearnerRapSelectionToIVCAnswer({ ivcAnswer: ivc, rapMMHG: 15 });
    expect(rapOnly.status).toBe('rap-only');
    if (rapOnly.status !== 'rap-only') return;
    const current = reconcileLearnerIVCRecapture({
      previousAnswer: rapOnly.answer, capturedAnswer: capture(),
      trVmaxAnswer: tr, trVmaxQuestionKey: 'q-tr',
    });
    expect(current.compositeResult.rapMMHG).toBe(15);
    expect(current.compositeResult.rvspMMHG).toBeNull();
  });

  it('does not restore unreviewed RAP or accept another TR question', () => {
    const noRAP = reconcileLearnerIVCRecapture({
      previousAnswer: ivc, capturedAnswer: capture(),
      trVmaxAnswer: tr, trVmaxQuestionKey: 'q-tr',
    });
    expect(noRAP.compositeResult).not.toHaveProperty('rapMMHG');
    const wrongQuestion = reconcile(capture(), tr, 'wrong-tr');
    expect(wrongQuestion.compositeResult.rapMMHG).toBe(8);
    expect(wrongQuestion.compositeResult.rvspMMHG).toBeNull();
  });
});

describe('learner IVC question completion requires selected RAP', () => {
  const rawCalipers = JSON.parse(JSON.stringify(ivc));
  const withRAP = attachLearnerRapSelectionToIVCAnswer({ ivcAnswer: ivc, rapMMHG: 8 });
  const withRVSP = attachLearnerRapRvspToIVCAnswer({ ...args, rapMMHG: 15 });

  it('does not consider two valid calipers and calculated collapse complete without RAP', () => {
    expect(isLearnerIVCRapSelectionComplete(rawCalipers)).toBe(false);
    expect(isLearnerIVCRapSelectionComplete({ ...rawCalipers, compositeResult: {
      ...rawCalipers.compositeResult, rapMMHG: 8,
    } })).toBe(false); // an unreviewed scalar is never a selection
  });

  it('accepts an explicitly selected RAP even while RVSP awaits a TR answer', () => {
    expect(withRAP.status).toBe('rap-only');
    if (withRAP.status !== 'rap-only') return;
    expect(isLearnerIVCRapSelectionComplete(withRAP.answer)).toBe(true);
    expect(withRAP.answer.compositeResult.rvspMMHG).toBeNull();
    expect(withRVSP.status).toBe('complete');
    if (withRVSP.status !== 'complete') return;
    expect(isLearnerIVCRapSelectionComplete(withRVSP.answer)).toBe(true);
  });

  it('requires one of 3, 8 or 15 mmHg and matching reviewed value', () => {
    if (withRAP.status !== 'rap-only') return;
    const edited = JSON.parse(JSON.stringify(withRAP.answer));
    for (const invalid of [0, 5, 99, null]) {
      edited.compositeResult.rapMMHG = invalid;
      expect(isLearnerIVCRapSelectionComplete(edited)).toBe(false);
    }
    edited.compositeResult.rapMMHG = 15; // review still says 8
    expect(isLearnerIVCRapSelectionComplete(edited)).toBe(false);
  });

  it('invalidates RAP completion after IVC source geometry, frame or collapse changes', () => {
    if (withRAP.status !== 'rap-only') return;
    for (const type of ['geometry', 'frame', 'collapse']) {
      const changed = JSON.parse(JSON.stringify(withRAP.answer));
      if (type === 'geometry') changed.compositeResult.components[0].points[1][0] += 1;
      if (type === 'frame') changed.compositeResult.components[1].target.frameNumber += 1;
      if (type === 'collapse') changed.value += 1;
      expect(isLearnerIVCRapSelectionComplete(changed)).toBe(false);
    }
  });

  it('preserves completion after identical IVC re-capture but not changed source', () => {
    if (withRAP.status !== 'rap-only') return;
    const recaptured = reconcileLearnerIVCRecapture({
      previousAnswer: withRAP.answer, capturedAnswer: JSON.parse(JSON.stringify(ivc)),
    });
    expect(isLearnerIVCRapSelectionComplete(recaptured)).toBe(true);
    const changed = JSON.parse(JSON.stringify(ivc));
    changed.compositeResult.components[0].annotationId = 'new-exp-source';
    const stale = reconcileLearnerIVCRecapture({
      previousAnswer: withRAP.answer, capturedAnswer: changed,
    });
    expect(isLearnerIVCRapSelectionComplete(stale)).toBe(false);
  });
});
