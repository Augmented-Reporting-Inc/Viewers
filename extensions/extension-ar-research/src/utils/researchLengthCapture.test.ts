import { buildReadFields } from './readSchema';
import { captureViewerQuestionMeasurement } from '../../../extension-ar-measurements/src/utils/questionMeasurementCapture';
import { dispatchQuestionMeasurementAdded, snapshotQuestionMeasurementCaptureContext, QUESTION_MEASUREMENT_ADDED } from '../../../../modes/longitudinal/src/questionMeasurementCompletion';
import { resolveResearchLengthCapture } from './researchLengthCapture';

describe('Research adapter for shared Education Length capture', () => {
  const study = 'study-a';
  const field = {key:'root|',componentKey:'root',label:'Aortic Root Diameter',kind:'measurement',
    config:{measurementLabels:['root-length'],viewerMeasurementTool:'Length',unit:'mm'}};
  const makeResult = () => ({
    ok:true,selectedMeasurementId:'length-1',
    answer:{sourceAnnotationId:'length-1',measurementType:'Length',value:38.4,unit:'mm',
      sourceRefs:{toolName:'Length',studyInstanceUID:study},
      reviewPayload:{annotation:{annotationId:'length-1',toolName:'Length',
        referenceStudyUID:study,referenceSeriesUID:'series-a',SOPInstanceUID:'sop-a',frameNumber:2,
        referencedImageId:'wadors:/studies/study-a/series/series-a/instances/sop-a/frames/2',
        points:[[1,2,3],[4,5,6]],measurements:{length:38.4,lengthUnit:'mm',unit:'mm'}}}}
  });

  it('uses shared calibrated value and exact annotation ID, then resolves the configured question binding', () => {
    expect(resolveResearchLengthCapture(field,makeResult(),study,'length-1',{},[field]))
      .toEqual({sourceId:'length-1',label:'root-length',
        update:{fieldKey:'root|',value:38.4,source:'viewer-measurement',sourceMeasurementKey:'length-1'}});
  });
  it('rejects wrong ID, another study, pixels and non-Length tools', () => {
    expect(resolveResearchLengthCapture(field,makeResult(),study,'different')).toBeNull();
    expect(resolveResearchLengthCapture(field,makeResult(),'other-study','length-1')).toBeNull();
    const pixels=makeResult(); pixels.answer.unit='px';
    expect(resolveResearchLengthCapture(field,pixels,study,'length-1')).toBeNull();
    const tool=makeResult(); tool.answer.sourceRefs.toolName='Angle';
    expect(resolveResearchLengthCapture(field,tool,study,'length-1')).toBeNull();
  });
  it('rejects a different semantic label and annotation linked to another answer', () => {
    const other=makeResult(); other.answer.measurementType='LVIDd';
    expect(resolveResearchLengthCapture(field,other,study,'length-1')).toBeNull();
    expect(resolveResearchLengthCapture(field,makeResult(),study,'length-1',
      {'other|':{sourceMeasurementKey:'length-1'}})).toBeNull();
    expect(resolveResearchLengthCapture(field,makeResult(),study,'length-1',{},
      [field,{...field,key:'other|'}])).toBeNull();
  });
  it('rejects mismatched pinned frame and missing geometry', () => {
    const pinned={...field,config:{...field.config,viewerTarget:{
      studyInstanceUID:study,seriesInstanceUID:'series-a',sopInstanceUID:'sop-a',frameNumber:3}}};
    expect(resolveResearchLengthCapture(pinned,makeResult(),study,'length-1')).toBeNull();
    const incomplete=makeResult(); incomplete.answer.reviewPayload.annotation.points=[];
    expect(resolveResearchLengthCapture(field,incomplete,study,'length-1')).toBeNull();
  });
  it('retains the previously configured label and converts units through existing Research transfer logic', () => {
    const result=makeResult(); result.answer.measurementType='root-length';
    result.answer.value=3.84; result.answer.unit='cm';
    expect(resolveResearchLengthCapture(field,result,study,'length-1')?.update.value).toBeCloseTo(38.4);
  });
});

test('legacy explicit scalar Length projects a stable binding without mutating its protocol', () => {
  const component = {componentKey:'root',kind:'measurement',label:'Aortic Root Diameter',
    config:{viewerMeasurementTool:'Length',unit:'mm'}};
  const [field] = buildReadFields({domain:'echo',components:[component]});
  expect(field.config.measurementLabels).toEqual(['root']);
  expect(component.config).toEqual({viewerMeasurementTool:'Length',unit:'mm'});
  expect(buildReadFields({domain:'echo',components:[{...component,config:{...component.config,measurementLabels:['AO']}}]})[0].config.measurementLabels).toEqual(['AO']);
  expect(buildReadFields({domain:'echo',components:[{...component,segmentKeys:['a','b']} ]})[0].config.measurementLabels).toEqual([]);
  expect(buildReadFields({domain:'bowel',components:[component]})[0].config.measurementLabels).toEqual([]);
});
test('both workflows use the exact shared capture command',async()=>{
  const options={question:{questionKey:'root'},measurementId:'annotation-1',unit:'mm'};
  const runCommand=jest.fn().mockResolvedValue({ok:true});
  expect(await captureViewerQuestionMeasurement({runCommand},options)).toEqual({ok:true});
  expect(runCommand).toHaveBeenCalledWith('getSelectedViewerMeasurementQuizAnswer',options);
  const run=jest.fn().mockResolvedValue({ok:true});
  await captureViewerQuestionMeasurement({run},options);
  expect(run).toHaveBeenCalledWith('getSelectedViewerMeasurementQuizAnswer',options);
});
test('shared Education event retains its delayed exact ID contract',async()=>{
  jest.useFakeTimers();
  const listener=jest.fn();
  window.addEventListener(QUESTION_MEASUREMENT_ADDED,listener);
  try {
    await dispatchQuestionMeasurementAdded({uid:'length-1',toolName:'Length'});
    expect(listener).not.toHaveBeenCalled();
    jest.advanceTimersByTime(50);
    expect(listener.mock.calls[0][0].detail).toEqual({measurementId:'length-1',toolName:'Length'});
  } finally {
    window.removeEventListener(QUESTION_MEASUREMENT_ADDED,listener);
    jest.useRealTimers();
  }
});
test('Research claims only a fresh completion with captured question context',async()=>{
  const context={fieldKey:'root|',reviewKey:'read-1',generation:1};
  const onContext=(event:Event)=>(event as CustomEvent).detail.accept(context);
  const onCompleted=(event:Event)=>{
    const detail=(event as CustomEvent).detail;
    expect(detail.captureContext).toBe(context);
    expect(detail.measurementId).toBe('length-1');
    detail.accept(Promise.resolve(true));
  };
  window.addEventListener('ar-measurements:question-capture-context',onContext);
  window.addEventListener(QUESTION_MEASUREMENT_ADDED,onCompleted);
  try {
    expect(snapshotQuestionMeasurementCaptureContext()).toBe(context);
    expect(await dispatchQuestionMeasurementAdded({uid:'length-1',toolName:'Length'},context)).toBe(true);
  } finally {
    window.removeEventListener('ar-measurements:question-capture-context',onContext);
    window.removeEventListener(QUESTION_MEASUREMENT_ADDED,onCompleted);
  }
  expect(await dispatchQuestionMeasurementAdded({uid:'length-1',toolName:'Length'},context)).toBe(false);
});
