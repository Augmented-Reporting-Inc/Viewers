import { composeIVCRapRVSP, attachLearnerRapRvspToIVCAnswer, isIVCReviewCurrent } from './ivcRapRvsp';

// Jest's jsdom runtime may not expose structuredClone even on Node 20+.
function cloneTestEvidence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

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
