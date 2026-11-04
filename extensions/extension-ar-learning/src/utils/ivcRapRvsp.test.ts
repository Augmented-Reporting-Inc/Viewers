import { composeIVCRapRVSP } from './ivcRapRvsp';

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
    expect(composeIVCRapRVSP({ ...args, rapMMHG: 8 }).value).toBe(39.36);
    expect(composeIVCRapRVSP({ ...args, rapMMHG: 15 }).value).toBe(46.36);
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
