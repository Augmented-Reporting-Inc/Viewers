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
