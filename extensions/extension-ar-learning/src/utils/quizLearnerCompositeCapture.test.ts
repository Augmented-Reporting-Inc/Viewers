import {
  getLearnerCompositeAutoCaptureSignature,
  getLearnerCompositeSourceComponents,
  getLearnerCompositePersistenceSources,
  isPersistedLearnerCompositeSource,
  isLearnerCompositeCaptureCurrent,
} from './quizLearnerCompositeCapture';

const frame = (sop: string, number: number) => ({
  studyInstanceUID: 'study', seriesInstanceUID: 'series',
  sopInstanceUID: sop, frameNumber: number,
  referencedImageId: `wadors:/studies/study/series/series/instances/${sop}/frames/${number}`,
});
const contour = (slot: string, id: string, number: number, kind = 'rvFAC') => ({
  uid: id, measurementKind: kind === 'rvFAC' ? 'echoAreaSlot' : 'laVolumeSlot',
  ...(kind === 'rvFAC' ? { echoArea: { slot } } : { laVolume: { slot } }),
  referenceStudyUID: 'study', referenceSeriesUID: 'series',
  SOPInstanceUID: id, frameNumber: number,
  referencedImageId: frame(id, number).referencedImageId,
  points: [[1,1,1],[5,1,1],[3,4,1]],
});
const measurementQuestion = (kind: string) => ({
  type: 'measurementNumeric', answerConfig: { measurementKind: kind },
});
const status = {
  complete: true, value: 50, unit: '%',
  phaseValues: { RV_ED: 30, RV_ES: 15 },
};

describe('learner composite automatic calculated-value capture', () => {
  const ed = contour('RV_ED', 'rv-ed', 3);
  const es = contour('RV_ES', 'rv-es', 7);

  it('waits for two unique verified phase measurements and a complete calculator', () => {
    const args = {
      question: measurementQuestion('rvFAC'),
      liveMeasurements: [ed, es],
      status,
    };
    expect(getLearnerCompositeAutoCaptureSignature(args)).not.toBe('');
    expect(getLearnerCompositeAutoCaptureSignature({ ...args, liveMeasurements: [ed] })).toBe('');
    expect(getLearnerCompositeAutoCaptureSignature({
      ...args, liveMeasurements: [ed, es, { ...es, uid: 'other' }],
    })).toBe('');
    expect(getLearnerCompositeAutoCaptureSignature({
      ...args, status: { ...status, complete: false },
    })).toBe('');
    expect(getLearnerCompositeAutoCaptureSignature({
      ...args, status: { ...status, unit: 'cm²' },
    })).toBe('');
    expect(getLearnerCompositeAutoCaptureSignature({
      ...args, status: { ...status, phaseValues: { RV_ED: 30 } },
    })).toBe('');
  });

  it('does not recapture unchanged saved learner evidence, but detects edits', () => {
    const original = [ed, es];
    const saved = { value: 50, unit: '%', compositeResult: { components:
      original.map((m, i) => ({
        slot: i === 0 ? 'RV_ED' : 'RV_ES',
        annotationId: m.uid, points: m.points, target: frame(m.uid, m.frameNumber),
      })),
    } };
    const args = {
      question: measurementQuestion('rvFAC'), liveMeasurements: original,
      status, savedAnswer: saved,
    };
    expect(getLearnerCompositeAutoCaptureSignature(args)).toBe('');
    expect(getLearnerCompositeAutoCaptureSignature({
      ...args,
      liveMeasurements: [ed, { ...es, points: [[1,1,1],[6,1,1],[3,4,1]] }],
    })).not.toBe('');
  });

  it('works for both LA methods and explicitly labelled IVC Lengths', () => {
    for (const kind of ['laVolumeBiplane', 'laVolumeBiplaneDisks']) {
      const measurements = [
        contour('A4C', 'la-a4c', 12, kind),
        contour('A2C', 'la-a2c', 17, kind),
      ];
      expect(getLearnerCompositeAutoCaptureSignature({
        question: measurementQuestion(kind), liveMeasurements: measurements,
        status: {complete:true, value:45.12, unit:'mL',
          phaseValues:{A4C:25.2,A2C:18.6}},
      })).not.toBe('');
    }
    const ivc = [
      { ...contour('IVC_EXP','ivc-exp',3), measurementKind: 'length',
        toolName: 'Length', label: 'IVCexp' },
      { ...contour('IVC_INSP','ivc-insp',7), measurementKind: 'length',
        toolName: 'Length', label: 'IVCinsp' },
    ];
    expect(getLearnerCompositeAutoCaptureSignature({
      question: measurementQuestion('ivcCollapsibility'),
      liveMeasurements: ivc,
      status:{complete:true,value:40,unit:'%',
        phaseValues:{IVC_EXP:20,IVC_INSP:12}},
    })).not.toBe('');
    expect(getLearnerCompositeAutoCaptureSignature({
      question: measurementQuestion('ivcCollapsibility'),
      liveMeasurements:[ivc[0],{...ivc[1],label:'Length'}],
      status:{complete:true,value:40,unit:'%',
        phaseValues:{IVC_EXP:20,IVC_INSP:12}},
    })).toBe('');
  });
});

describe('learner-only composite restore source contract', () => {
  it('requires both complete, distinct phase source references', () => {
    const parts = ['RV_ED', 'RV_ES'].map((slot,i) => ({
      slot, annotationId: slot, target: frame(slot, i + 3),
      points:[[0,0,0],[3,0,0],[0,2,0]],
    }));
    const answer = { compositeResult: { components: parts } };
    expect(getLearnerCompositeSourceComponents(answer,'rvFAC')).toHaveLength(2);
    expect(getLearnerCompositeSourceComponents({
      compositeResult: {components:[parts[0]]},
    },'rvFAC')).toHaveLength(0);
    expect(getLearnerCompositeSourceComponents({
      compositeResult: {components:[parts[0],{...parts[1],points:[]}]},
    },'rvFAC')).toHaveLength(0);
    expect(getLearnerCompositeSourceComponents({
      compositeResult: {components:[parts[0],{...parts[1],target:{...parts[1].target,sopInstanceUID:''}}]},
    },'rvFAC')).toHaveLength(0);
    expect(getLearnerCompositeSourceComponents(answer,'ivcCollapsibility')).toHaveLength(0);
    expect(getLearnerCompositeSourceComponents(answer,'unknown')).toHaveLength(0);
  });
});

describe('automatic learner capture rejects asynchronous source/calibration drift', () => {
  const captured = {
    measurementKind: 'rvFAC', unit: '%', value: 50,
    compositeResult: { components: [
      { slot: 'RV_ED', annotationId: 'rv-ed',
        target: frame('rv-ed', 3), points: [[0,0,0],[3,0,0],[0,3,0]] },
      { slot: 'RV_ES', annotationId: 'rv-es',
        target: frame('rv-es', 7), points: [[0,0,0],[2,0,0],[0,2,0]] },
    ] },
  };
  const active = {
    complete:true, value:50, unit:'%',
    components:[
      {slot:'RV_ED',annotationId:'rv-ed'},
      {slot:'RV_ES',annotationId:'rv-es'},
    ],
  };
  it('accepts only two exact current source IDs and matching calculated value/unit', () => {
    expect(isLearnerCompositeCaptureCurrent(captured,active,'rvFAC')).toBe(true);
    expect(isLearnerCompositeCaptureCurrent(captured,
      {...active,value:49.9},'rvFAC')).toBe(false);
    expect(isLearnerCompositeCaptureCurrent(captured,
      {...active,unit:'cm²'},'rvFAC')).toBe(false);
    expect(isLearnerCompositeCaptureCurrent(captured,
      {...active,components:[active.components[0],
        {slot:'RV_ES',annotationId:'stale-contour'}]},'rvFAC')).toBe(false);
    expect(isLearnerCompositeCaptureCurrent(captured,
      {...active,components:[active.components[0]]},'rvFAC')).toBe(false);
    expect(isLearnerCompositeCaptureCurrent(captured,
      {...active,complete:false},'rvFAC')).toBe(false);
    expect(isLearnerCompositeCaptureCurrent({...captured,
      compositeResult:{components:[captured.compositeResult.components[0]]}},
      active,'rvFAC')).toBe(false);
  });
});

describe('read-after-write verified learner phase annotations', () => {
  const parts = ['RV_ED', 'RV_ES'].map((slot, i) => ({
    slot, annotationId:'ann-' + i,
    target:frame('sop-' + i, [3,7][i]),
    points:[[0,0,0],[3,0,0],[0,2,0]],
  }));
  const q = {questionKey:'q-rv',type:'measurementNumeric',
    answerConfig:{measurementKind:'rvFAC'}};
  const answer = {value:50,unit:'%',measurementKind:'rvFAC',
    compositeResult:{components:parts}};
  it('collects both exact source IDs, not a scalar-only quiz answer', () => {
    const saved = getLearnerCompositePersistenceSources([q], {'q-rv':answer});
    expect(saved).toHaveLength(2);
    expect(saved.map(item=>item.annotationId)).toEqual(['ann-0','ann-1']);
    expect(getLearnerCompositePersistenceSources([q], {'q-rv':{value:50,unit:'%'}}))
      .toHaveLength(0);
  });
  it('rejects wrong learner DICOM identity, frame or missing contour geometry', () => {
    const source = {annotationId:parts[0].annotationId,target:parts[0].target};
    const stored = {
      annotationId:source.annotationId,
      StudyInstanceUID:'study',SeriesInstanceUID:'series',
      SOPInstanceUID:'sop-0',
      referencedImageId:parts[0].target.referencedImageId,
      points:parts[0].points,
    };
    expect(isPersistedLearnerCompositeSource(stored,source)).toBe(true);
    expect(isPersistedLearnerCompositeSource({
      ...stored, StudyInstanceUID:'teaching-case',
    },source)).toBe(false);
    expect(isPersistedLearnerCompositeSource({
      ...stored, referencedImageId:frame('sop-0',4).referencedImageId,
    },source)).toBe(false);
    expect(isPersistedLearnerCompositeSource({
      ...stored, points:[],
    },source)).toBe(false);
    expect(isPersistedLearnerCompositeSource({...stored,annotationId:'other'},source))
      .toBe(false);
  });
});
