import {canShowResearchZScore,matchesSavedResearchZScoreEvidence,matchesZScoreResponse,getVisibleResearchZScore} from './researchReadZScore';

const field = {key:'root|',componentKey:'root',config:{zScore:{enabled:true,parameterKey:'ROOT'}}};
const context = {reviewKey:'test-read',preview:false,review:{reviewType:'independent'},
  readSchema:{domain:'echo',config:{zScore:{enabled:true,readerAnthropometrics:'override',verificationMode:'reader_attestation'}}}};
const state = () => ({values:{'root|':20},sources:{'root|':{source:'viewer-measurement',sourceMeasurementKey:'source-1'}}});
const annotation = () => ({annotationId:'source-1',toolName:'Length',label:'root',
  StudyInstanceUID:'1.2.3',SeriesInstanceUID:'1.2.3.4',SOPInstanceUID:'1.2.3.4.5',
  referencedImageId:'wadors:/dicom-web/studies/1.2.3/series/1.2.3.4/instances/1.2.3.4.5/frames/2',
  points:[[0,0,0],[20,0,0]],measurements:{length:20,value:20,lengthUnit:'mm',unit:'mm'}});

test('only explicitly configured independent echo Reads expose the verification UI',()=>{
  expect(canShowResearchZScore(context,field)).toBe(true);
  expect(canShowResearchZScore({...context,preview:true},field)).toBe(false);
  expect(canShowResearchZScore({...context,review:{reviewType:'adjudication'}},field)).toBe(false);
  expect(canShowResearchZScore({...context,readSchema:{domain:'echo',config:{zScore:{enabled:true}}}},field)).toBe(false);
  expect(canShowResearchZScore(context,{...field,config:{}})).toBe(false);
});

test('requires exact persisted scalar, source, geometry, frame and units',()=>{
  const check=(current:any,annotations:any[],deleted=new Set<string>())=>
    matchesSavedResearchZScoreEvidence(field.key,current,state(),annotations,[annotation()],deleted);
  expect(check(state(),[annotation()])).toBe(true);
  const changed=state(); changed.values[field.key]=21;
  expect(check(changed,[annotation()])).toBe(false);
  expect(check(state(),[{...annotation(),points:[[0,0,0],[21,0,0]]}])).toBe(false);
  expect(check(state(),[{...annotation(),referencedImageId:annotation().referencedImageId.replace('/2','/3')}])).toBe(false);
  expect(check(state(),[{...annotation(),measurements:{length:20,value:20,lengthUnit:'px',unit:'px'}}])).toBe(false);
  expect(check(state(),[{...annotation(),label:'other'}])).toBe(false);
  expect(check(state(),[annotation(),annotation()])).toBe(false);
  expect(check(state(),[],new Set(['source-1']))).toBe(false);
  expect(check(state(),[annotation()],new Set(['source-1']))).toBe(false);
});

test('response must belong to the currently saved Read and acquisition revision',()=>{
  const at='2026-01-01T00:00:00.000Z';
  const snapshot={readSavedAt:at,acquisitionRevision:2,questions:[]};
  expect(matchesZScoreResponse(snapshot,at,2)).toBe(true);
  expect(matchesZScoreResponse(snapshot,at,3)).toBe(false);
  expect(matchesZScoreResponse(snapshot,'2026-01-02T00:00:00.000Z',2)).toBe(false);
  expect(matchesZScoreResponse(snapshot,null,2)).toBe(false);
});

test('renders only a single valid server result and never reconstructs hidden scores',()=>{
  const result={componentKey:'root',parameterKey:'ROOT',modelId:'phn-2017',
    modelVersion:'phn-2017-indexed-table-v1',zScore:1.11,bsaM2:.783};
  expect(getVisibleResearchZScore({results:[result]},field)).toEqual(result);
  expect(getVisibleResearchZScore({questions:[{componentKey:'root',status:'verified'}]},field)).toBeNull();
  expect(getVisibleResearchZScore({results:[{...result,zScore:NaN}]},field)).toBeNull();
  expect(getVisibleResearchZScore({results:[{...result,parameterKey:'ANN'}]},field)).toBeNull();
  expect(getVisibleResearchZScore({results:[result,result]},field)).toBeNull();
});

test('automatic mode exposes the saved score panel only for eligible configured Reads',()=>{
  const automatic={...context,readSchema:{...context.readSchema,config:{zScore:{...context.readSchema.config.zScore,verificationMode:'automatic_calibrated'}}}};
  expect(canShowResearchZScore(automatic,field)).toBe(true);
  expect(canShowResearchZScore({...automatic,preview:true},field)).toBe(false);
  expect(canShowResearchZScore({...automatic,review:{reviewType:'adjudication'}},field)).toBe(false);
  expect(canShowResearchZScore(automatic,{...field,config:{}})).toBe(false);
});
