import {canShowResearchAcquisitionInputs, acquisitionInputStrings, buildAcquisitionOverrideRequest} from './researchAcquisitionInputs';
const context = {reviewKey:'read-1',preview:false,review:{reviewType:'independent'},readSchema:{domain:'echo',config:{zScore:{enabled:true,readerAnthropometrics:'override'}}}};
const snapshot = {editable:true,revision:2,baseline:{values:{heightCm:110,weightKg:20,ageYears:0}}};
test('only configured independent Reads show acquisition inputs',()=>{
 expect(canShowResearchAcquisitionInputs(context)).toBe(true);
 expect(canShowResearchAcquisitionInputs({...context,preview:true})).toBe(false);
 expect(canShowResearchAcquisitionInputs({...context,review:{reviewType:'adjudication'}})).toBe(false);
 expect(canShowResearchAcquisitionInputs({...context,readSchema:{domain:'echo',config:{}}})).toBe(false);
});
test('keeps zero age and submits only changed fields',()=>{
 const inputs=acquisitionInputStrings(snapshot.baseline.values);
 expect(inputs.ageYears).toBe('0');
 expect(buildAcquisitionOverrideRequest(snapshot,{...inputs,weightKg:'21'},' correction ',true)).toEqual({expectedRevision:2,overrides:{weightKg:21},reason:'correction',acquisitionVerified:true});
 expect(buildAcquisitionOverrideRequest(snapshot,inputs,'restore',true)?.overrides).toEqual({});
});
test('rejects invalid or read-only requests',()=>{
 const inputs=acquisitionInputStrings(snapshot.baseline.values);
 expect(buildAcquisitionOverrideRequest(snapshot,{...inputs,heightCm:''},'reason',true)).toBeNull();
 expect(buildAcquisitionOverrideRequest(snapshot,{...inputs,weightKg:'21'},' ',true)).toBeNull();
 expect(buildAcquisitionOverrideRequest({...snapshot,editable:false},inputs,'reason',true)).toBeNull();
});

test('confirm unchanged values and restore exact baseline without a reason',()=>{
 const inputs=acquisitionInputStrings(snapshot.baseline.values);
 expect(buildAcquisitionOverrideRequest(snapshot,inputs,'',true)?.reason).toBe('');
 const corrected={...snapshot,overrides:{weightKg:21}};
 expect(buildAcquisitionOverrideRequest(corrected,inputs,'',true)?.overrides).toEqual({});
 expect(buildAcquisitionOverrideRequest(corrected,{...inputs,weightKg:'21'},'',true)?.overrides).toEqual({weightKg:21});
 expect(buildAcquisitionOverrideRequest(corrected,{...inputs,weightKg:'22'},'',true)).toBeNull();
});
