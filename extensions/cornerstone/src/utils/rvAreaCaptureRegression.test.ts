import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { getSplinePersistence, compactOversampledSpline } from './splinePersistence';
import SplineROI from './measurementServiceMappings/SplineROI';
import PlanarFreehandROI from './measurementServiceMappings/PlanarFreehandROI';
import LivewireContour from './measurementServiceMappings/LivewireContour';
import { getQuizEchoAreaSourceMetadata, calculateCalibratedEchoAreaCM2, getQuizCompositeContourViewportLines } from './quizEchoAreaCalibration';
import { calibrateUSContourPoints } from './usRegionLengthCalibration';
import { getViewerQuizCompositeStatus } from '../../../extension-ar-measurements/src/utils/viewerQuizCompositeResults';
import { getEchoAreaSlot } from '../../../extension-ar-measurements/src/utils/echoAreaMeasurements';

jest.mock('@cornerstonejs/core', () => ({metaData:{get:()=>null}}), {virtual:true});
jest.mock('@ohif/core', () => ({ utils: { roundNumber: (n: number) => n } }), {virtual:true});
jest.mock('./measurementServiceMappings/utils/getIsLocked', () => ({ getIsLocked: () => false }));
jest.mock('./measurementServiceMappings/utils/getIsVisible', () => ({ getIsVisible: () => true }));
jest.mock('./measurementServiceMappings/utils', () => ({ getDisplayUnit: (unit: string) => unit }));
jest.mock('./measurementServiceMappings/utils/getSOPInstanceAttributes', () => ({
  __esModule:true, default: (image: string) => ({StudyInstanceUID:'study',SeriesInstanceUID:'series',
    SOPInstanceUID:'sop',frameNumber:Number(image.match(/frames\/(\d+)/)?.[1])}),
}));

const commandSource = fs.readFileSync(path.join(__dirname,'../commandsModule.ts'),'utf8');
function loadFunction(name: string, context: any) {
  const start = commandSource.indexOf(`function ${name}(`);
  const end = commandSource.indexOf('\nfunction ', start + 1);
  vm.runInContext(ts.transpileModule(commandSource.slice(start,end), {
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},
  }).outputText,context);
}
const makeAnnotation = (slot: string, frame: number, width = 40) => ({
  annotationUID: slot, metadata:{toolName:'SplineROI',referencedImageId:`wadors:/studies/study/series/series/instances/sop/frames/${frame}`},
  data:{ label:slot === 'RV_ED' ? 'RVEDA':'RVESA',
    echoArea:{slot,calibrationRegions:[{minX:0,minY:0,maxX:100,maxY:100,column:1,row:1}]},
    handles:{points:[[0,0,0],[width,0,0],[width,20,0],[0,20,0]],textBox:{}},
    contour:{polyline:[[0,0,0],[width/2,0,0],[width,0,0],[width,10,0],[width,20,0],[width/2,20,0],[0,20,0],[0,10,0]],closed:true},
    cachedStats:{},spline:{type:'CATMULLROM'},
  },
});
const displaySet = {displaySetInstanceUID:'ds',SeriesNumber:1,instances:[{SOPInstanceUID:'sop'}]};
const displaySets = {getDisplaySetForSOPInstanceUID:()=>displaySet,getDisplaySetsForSeries:()=>[displaySet]};
const map = (adapter: any, annotation: any) => adapter.toMeasurement({annotation},displaySets,null,()=> 'POLYLINE',{});
function sourceContext(annotations: any[]) {
  const context = vm.createContext({
    isUltrasoundDirectionalViewerMeasurement:()=>false,isBowelCurvedLengthViewerMeasurement:()=>false,
    isLVSimpsonMeasurement:()=>false,isLAVolumeMeasurement:()=>false,
    getLVSimpsonSessionMeasurements:()=>[],getLAVolumeSessionMeasurements:()=>[],getCineCommentSessionMeasurements:()=>[],
    synchronizeViewerMeasurementSessionFallbacks:()=>{},mergeViewerMeasurementSnapshots:({liveMeasurements})=>liveMeasurements,
    getMeasurementAnnotationId:(m: any)=>m.uid || m.annotationUID,
    cornerstoneTools:{annotation:{state:{getAnnotation:(id: string)=>annotations.find(a=>a.annotationUID === id)}}},
    getQuizEchoAreaSourceMetadata,calibrateUSContourPoints,calculateCalibratedEchoAreaCM2,
    getAllCornerstoneViewerAnnotations:()=>annotations,getEchoAreaCalibrationRegions:()=>[],
    getSplinePersistence,compactOversampledSpline,
    isViewerContourTool:()=>true,parseLVTraceLabel:()=>null,
    getLVSimpsonGeometry:()=>null,getLAVolumeGeometry:()=>null,getSpectralDopplerGeometry:()=>null,
    getDecelerationTimeGeometry:()=>null,getUltrasoundDirectionalGeometry:()=>null,
    isDecelerationTimeViewerMeasurement:()=>false,getViewerRepeatedMeasurementMetadata:()=>null,
    getViewerMeasurementMetadataVector:()=>undefined,
    getFrameNumberFromReferencedImageId:(image: string)=>Number(image.match(/frames\/(\d+)/)?.[1]),
    VIEWER_MEASUREMENTS_WORKFLOW:'viewerMeasurements',
    metaData:{get:()=>({columnPixelSpacing:1,rowPixelSpacing:1})},
    SPECTRAL_DOPPLER_MEASUREMENT_KIND:'spectralDopplerVTI',getEchoAreaSlot,
    getMeasurementDisplayText:()=>[],normalizeDisplayTextUnits:(text: any)=>text,
    getImagePixelSpacingMMForMeasurement:()=>null,
  });
  for (const name of ['parseDicomWebIdsFromReferencedImageId','getCornerstoneEchoAreaMeasurementFallback','calibratedEchoAreaFromRegions','getCurrentViewerMeasurementSnapshot',
    'getMeasurementStats','finiteNumberOrNull','buildContourMeasurementPayload','serializeViewerMeasurement']) loadFunction(name,context);
  return context;
}

test.each([['SplineROI',SplineROI],['PlanarFreehandROI',PlanarFreehandROI],['LivewireContour',LivewireContour]])(
  '%s retains explicit guided phase identity on native remapping', (toolName,adapter) => {
    const annotation = makeAnnotation('RV_ED',1); annotation.metadata.toolName = toolName;
    const mapped = map(adapter,annotation);
    expect(mapped.measurementKind).toBe('echoAreaSlot');
    expect(mapped.echoArea).toEqual(annotation.data.echoArea);
    delete annotation.data.echoArea;
    expect(map(adapter,annotation).measurementKind).toBeUndefined();
  }
);

test('remap → live calibration → viewport and panel FAC → save payload use the same source areas', () => {
  const ed = makeAnnotation('RV_ED',1,40), es = makeAnnotation('RV_ES',2,20);
  const context = sourceContext([ed,es]);
  const service = {getMeasurements:()=>[map(SplineROI,ed),map(SplineROI,es)]};
  // Native pixels are deliberately wrong: verified US-region calibration wins.
  ed.data.cachedStats = {native:{area:99999,areaUnit:'px²'}} as any;
  const snapshot = context.getCurrentViewerMeasurementSnapshot(service);
  const status = getViewerQuizCompositeStatus('rvFAC',snapshot);
  expect(status.complete).toBe(true);
  expect(status.value).toBeCloseTo(50);
  expect(status.phaseValues).toEqual({RV_ED:8,RV_ES:4});
  expect(getQuizCompositeContourViewportLines(ed.data,status.phaseValues.RV_ED)).toEqual(['RVEDA: 8.00 cm²']);
  const payload = context.buildContourMeasurementPayload(snapshot[0],{measurements:{area:90,areaUnit:'cm²'}});
  expect(payload.area).toBe(8); expect(payload.areaUnit).toBe('cm2');
  const serialized = context.serializeViewerMeasurement(snapshot[0],'echo');
  expect(serialized.measurements.area).toBe(8);
  expect(serialized.measurements.areaUnit).toBe('cm2');
  expect(serialized.echoArea.calibrationRegions).toEqual(ed.data.echoArea.calibrationRegions);
  expect(serialized.splineControlPoints).toEqual(ed.data.handles.points);
  // Previously created service entries may already have lost their phase data.
  const oldMapped = {...map(SplineROI,ed)}; delete oldMapped.measurementKind; delete oldMapped.echoArea;
  const recovered = context.getCurrentViewerMeasurementSnapshot({getMeasurements:()=>[oldMapped]});
  expect(getEchoAreaSlot(recovered[0])).toBe('RV_ED');
  expect(recovered[0].measurements.area).toBe(8);
});

test('edited and out-of-region contours cannot reuse an old saved area', () => {
  const source = makeAnnotation('RV_ED',1), context = sourceContext([source]);
  const service = {getMeasurements:()=>[map(SplineROI,source)]};
  source.data.contour.polyline = source.data.contour.polyline.map(([x,y,z])=>[x/2,y,z]);
  let live = context.getCurrentViewerMeasurementSnapshot(service)[0];
  expect(live.measurements.area).toBe(4);
  source.data.contour.polyline[0] = [101,0,0];
  live = context.getCurrentViewerMeasurementSnapshot(service)[0];
  expect(live.measurements.area).toBeNull();
  expect(context.buildContourMeasurementPayload(live,{measurements:{area:90,areaUnit:'cm²'}}).area).toBeNull();
});


test('native RV acquisition is available before OHIF creates any measurement entry', () => {
  const ed = makeAnnotation('RV_ED',1,40), es = makeAnnotation('RV_ES',2,20);
  const context = sourceContext([ed,es]);
  const emptyService = {getMeasurements:()=>[]};
  context.getAllCornerstoneViewerAnnotations = () => [ed,es];
  const snapshot = context.getCurrentViewerMeasurementSnapshot(emptyService);
  expect(snapshot).toHaveLength(2);
  expect(getViewerQuizCompositeStatus('rvFAC',snapshot)).toMatchObject({
    complete:true,value:50,phaseValues:{RV_ED:8,RV_ES:4},
  });
});


test('RV source can calibrate from exact image metadata when display-set instances lack US regions', () => {
  const ed = makeAnnotation('RV_ED',1,40), es = makeAnnotation('RV_ES',2,20);
  delete ed.data.echoArea.calibrationRegions; delete es.data.echoArea.calibrationRegions;
  const context = sourceContext([ed,es]);
  const region = {RegionLocationMinX0:0,RegionLocationMinY0:0,
    RegionLocationMaxX1:100,RegionLocationMaxY1:100,
    PhysicalUnitsXDirection:3,PhysicalUnitsYDirection:3,PhysicalDeltaX:0.1,PhysicalDeltaY:0.1};
  context.metaData = {get:(module: string) => module === 'instance'
    ? {SOPInstanceUID:'sop',SequenceOfUltrasoundRegions:[region]}
    : module === 'imagePlaneModule' ? {columnPixelSpacing:1,rowPixelSpacing:1} : null};
  context.getSopInstanceIdFromImageId = (image: string)=>image.match(/instances\/([^/]+)/)?.[1];
  for (const name of ['readRawDicomValue','readDicomValue','readDicomNumber','getDicomSequenceValues',
    'normalizePhysicalUnitCode','getPhysicalUnitScaleToMM','getDisplaySetInstances','getSopInstanceIdFromSource',
    'getUltrasoundRegionsFromSource','normalizeUltrasoundRegion','getEchoAreaCalibrationRegions']) loadFunction(name,context);
  const snapshot = context.getCurrentViewerMeasurementSnapshot({getMeasurements:()=>[]});
  expect(getViewerQuizCompositeStatus('rvFAC',snapshot)).toMatchObject({complete:true,value:50});
  expect(snapshot[0].echoArea.calibrationRegions[0]).toMatchObject({column:1,row:1});
  expect(context.getEchoAreaCalibrationRegions({displaySet:null,
    imageId:ed.metadata.referencedImageId,sopInstanceId:'different-sop'})).toHaveLength(0);
});


test('native RV fallback excludes rubric overlays and mismatched image identity', () => {
  const source = makeAnnotation('RV_ED',1), context = sourceContext([source]);
  expect(context.getCornerstoneEchoAreaMeasurementFallback({...source,
    annotationUID:'ar-viewer-quiz-rubric-q'})).toBeNull();
  expect(context.getCornerstoneEchoAreaMeasurementFallback({...source,
    metadata:{...source.metadata,arMeasurementWorkflow:'viewerQuizGoldDisplay'}})).toBeNull();
  expect(context.getCornerstoneEchoAreaMeasurementFallback({...source,
    metadata:{...source.metadata,SOPInstanceUID:'wrong-sop'}})).toBeNull();
});
