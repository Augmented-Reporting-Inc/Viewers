import { hydrateSavedViewerAnnotationForViewport } from './measurementAnnotationHydration';

jest.mock('@cornerstonejs/core', () => ({
  metaData: { get: jest.fn(() => null) },
}), { virtual: true });

jest.mock('@cornerstonejs/tools', () => {
  const annotations = new Map();
  const state = {
    getAnnotation: jest.fn((id: string) => annotations.get(id)),
    addAnnotation: jest.fn((value: any) => annotations.set(value.annotationUID, value)),
    removeAnnotation: jest.fn((id: string) => annotations.delete(id)),
    getAnnotationManager: jest.fn(() => ({ getGroupKey: jest.fn(() => 'test-group') })),
  };
  return {
    annotation: {
      state,
      selection: { setAnnotationSelected: jest.fn() },
      visibility: { setAnnotationVisibility: jest.fn() },
      locking: { setAnnotationLocked: jest.fn() },
      config: { style: { setAnnotationStyles: jest.fn() } },
    },
    ToolGroupManager: { getToolGroupForViewport: jest.fn(() => null) },
    SplineROITool: {}, PlanarFreehandROITool: {}, LivewireContourTool: {},
    LengthTool: {}, ArrowAnnotateTool: {},
  };
}, { virtual: true });

const image = (sop: string, frame: number) =>
  `wadors:/dicom-web/studies/study/series/series/instances/${sop}/frames/${frame}`;
const points = Array.from({ length: 12 }, (_, i) => [i, 40 + i, 0]);
const originalPoints = Array.from({ length: 8 }, (_, i) => [i, 30 + i, 0]);
const slots = [
  { slot: 'A4C_ED', sop: 'sop-a', frame: 4 },
  { slot: 'A4C_ES', sop: 'sop-a', frame: 8 },
  { slot: 'A2C_ED', sop: 'sop-b', frame: 14 },
  { slot: 'A2C_ES', sop: 'sop-b', frame: 19 },
];
const saved = ({ slot, sop, frame }: typeof slots[number]) => ({
  uid: `test-${slot}`,
  annotationId: `test-${slot}`,
  toolName: 'SplineROI',
  SOPInstanceUID: sop,
  frameNumber: frame,
  StudyInstanceUID: 'study',
  SeriesInstanceUID: 'series',
  referencedImageId: image(sop, frame),
  FrameOfReferenceUID: 'same-frame-of-reference-for-whole-cine',
  points: points.map(p => [...p]),
  lvSimpson: {
    measurementKind: 'lvSimpsonSlot',
    slot,
    originalContourPoints: originalPoints.map(p => [...p]),
    calibratedContourPoints: originalPoints.map(p => p.map(v => v * 0.25)),
    calibratedLongAxisLengthMM: 80,
  },
});

describe('real Cornerstone saved EF annotation hydration frame regression', () => {
  test('rejects another cine frame without touching annotation state', () => {
    const tools = require('@cornerstonejs/tools');
    const before = tools.annotation.state.addAnnotation.mock.calls.length;
    const contour = saved(slots[0]);
    const hydrated = hydrateSavedViewerAnnotationForViewport({
      annotation: contour,
      viewport: { getCurrentImageId: () => image('sop-a', 8) },
      viewportId: 'viewport',
      referencedImageIdOverride: contour.referencedImageId,
      selectAnnotation: false,
    });
    expect(hydrated).toBeNull();
    expect(tools.annotation.state.addAnnotation).toHaveBeenCalledTimes(before);
  });

  test('hydrates four saved EF slots only on their original SOP/frame and retains clinical geometry', () => {
    const tools = require('@cornerstonejs/tools');
    for (const slot of slots) {
      const contour = saved(slot);
      const hydrated = hydrateSavedViewerAnnotationForViewport({
        annotation: contour,
        viewport: {
          getCurrentImageId: () => contour.referencedImageId,
          getViewReference: () => ({ FrameOfReferenceUID: contour.FrameOfReferenceUID }),
          getCamera: () => ({}),
          getFrameOfReferenceUID: () => contour.FrameOfReferenceUID,
        },
        viewportId: 'viewport',
        selectAnnotation: false,
      });
      expect(hydrated).toBeTruthy();
      expect(hydrated?.metadata?.referencedImageId).toBe(image(slot.sop, slot.frame));
      expect(hydrated?.metadata?.SOPInstanceUID).toBe(slot.sop);
      expect(hydrated?.data?.lvSimpson?.originalContourPoints).toEqual(originalPoints);
      expect(hydrated?.data?.lvSimpson?.calibratedLongAxisLengthMM).toBe(80);
      expect(hydrated?.data?.handles?.points).toEqual(originalPoints);
      expect(tools.annotation.state.getAnnotation(contour.annotationId)).toBeTruthy();
    }
  });
});

describe('saved echo quiz contour hydration units and renderer', () => {
  const template = (slot: string, area: number, areaUnit: string) => {
    const isLA = slot === 'A4C' || slot === 'A2C';
    return {
      uid: 'quiz-' + slot,
      annotationId: 'quiz-' + slot,
      toolName: 'SplineROI',
      SOPInstanceUID: 'quiz-sop-' + slot,
      frameNumber: 14,
      StudyInstanceUID: 'study',
      SeriesInstanceUID: 'series',
      referencedImageId: image('quiz-sop-' + slot, 14),
      FrameOfReferenceUID: 'echo-frame-of-reference',
      points: points.map(p => [...p]),
      measurementKind: isLA ? 'laVolumeSlot' : 'echoAreaSlot',
      ...(isLA
        ? { laVolume: { slot, measurementKind: 'laVolumeSlot' } }
        : { echoArea: { slot, phase: slot.endsWith('_ED') ? 'ED' : 'ES', view: 'A4C' } }),
      measurements: { area, areaUnit },
    };
  };

  test.each([
    ['RV_ED', 19.31], ['RV_ES', 15.50],
    ['A4C', 31.26], ['A2C', 4.48],
  ])('reopens %s with calibrated cm² and uses it in actual Cornerstone label callback', (slot, value) => {
    const tools = require('@cornerstonejs/tools');
    const toolInstance: any = {
      configuration: { getTextLines: () => ['19.3 mm²'] },
    };
    const toolGroup = {
      getToolInstance: jest.fn(() => toolInstance),
      setToolConfiguration: jest.fn((_name: string, config: any) => {
        toolInstance.configuration = config;
      }),
    };
    tools.ToolGroupManager.getToolGroupForViewport.mockReturnValue(toolGroup);
    try {
      const contour = template(slot as string, value as number, 'cm2');
      const hydrated = hydrateSavedViewerAnnotationForViewport({
        annotation: contour,
        viewport: {
          id: 'viewport',
          getCurrentImageId: () => contour.referencedImageId,
          getViewReference: () => ({ FrameOfReferenceUID: contour.FrameOfReferenceUID }),
          getCamera: () => ({}),
          getFrameOfReferenceUID: () => contour.FrameOfReferenceUID,
          renderingEngineId: 'render',
        },
        viewportId: 'viewport',
        selectAnnotation: false,
      });
      expect(hydrated).toBeTruthy();
      const stats: any = Object.values(hydrated?.data?.cachedStats || {})[0];
      expect(stats).toMatchObject({
        area: value, areaUnit: 'cm²', unit: 'cm',
        arSavedMeasurementAreaUnit: 'cm²',
      });
      expect(hydrated?.data?.arSavedMeasurementDisplayText)
        .toEqual([(value as number).toFixed(2) + ' cm²']);
      if ((slot as string).startsWith('RV_')) {
        expect(hydrated?.data?.echoArea?.slot).toBe(slot);
      } else {
        expect(hydrated?.data?.laVolume?.slot).toBe(slot);
      }
      expect(toolInstance.configuration.getTextLines(hydrated.data, 'imageId:test'))
        .toEqual([(value as number).toFixed(2) + ' cm²']);
    } finally {
      tools.ToolGroupManager.getToolGroupForViewport.mockReturnValue(null);
    }
  });

  test('converts explicitly calibrated mm² to cm², never pixel areas', () => {
    const mm = template('RV_ED', 1931, 'mm2');
    const hydrated = hydrateSavedViewerAnnotationForViewport({
      annotation: mm,
      viewportId: 'viewport',
      selectAnnotation: false,
    });
    expect(hydrated?.data?.arSavedMeasurementDisplayText).toEqual(['19.31 cm²']);
    const stats: any = Object.values(hydrated?.data?.cachedStats || {})[0];
    expect(stats.area).toBeCloseTo(19.31, 8);
    expect(stats.areaUnit).toBe('cm²');

    const px = template('RV_ES', 19.3, 'px2');
    const invalid = hydrateSavedViewerAnnotationForViewport({
      annotation: px,
      viewportId: 'viewport',
      selectAnnotation: false,
    });
    expect(invalid?.data?.arSavedMeasurementDisplayText || []).not.toContain('19.3 mm²');
    expect(invalid?.data?.cachedStats || {}).toEqual({});
  });

  test('leaves ordinary clinical/other contour measurement units unchanged', () => {
    const generic = { ...template('RV_ED', 19.3, 'mm2'),
      uid: 'generic-echo', annotationId: 'generic-echo',
      measurementKind: 'genericROI', echoArea: undefined };
    const hydrated = hydrateSavedViewerAnnotationForViewport({
      annotation: generic, viewportId: 'viewport', selectAnnotation: false,
    });
    expect(hydrated?.data?.arSavedMeasurementDisplayText).toEqual(['19.3 mm²']);
    const stats: any = Object.values(hydrated?.data?.cachedStats || {})[0];
    expect(stats.areaUnit).toBe('mm²');
    expect(hydrated?.data?.echoArea).toBeUndefined();
  });
});

describe('saved gold comparison overlays retain measured units', () => {
  test.each([
    ['rvFAC', 'RV_ED', 19.31],
    ['rvFAC', 'RV_ES', 15.50],
    ['laVolumeBiplane', 'A4C', 31.26],
    ['laVolumeBiplaneDisks', 'A2C', 4.48],
  ])('reopens %s %s from composite gold with cm² evidence', (kind, slot, value) => {
    const { getQuizCompositeGoldContourSlotMetadata } =
      require('./quizEchoAreaCalibration');
    const gold = {
      uid: 'gold-' + kind + '-' + slot,
      annotationId: 'gold-' + kind + '-' + slot,
      toolName: 'PlanarFreehandROI',
      measurementKind: kind,
      ...getQuizCompositeGoldContourSlotMetadata(kind, slot),
      SOPInstanceUID: 'gold-sop',
      StudyInstanceUID: 'study',
      SeriesInstanceUID: 'series',
      referencedImageId: image('gold-sop', 3),
      FrameOfReferenceUID: 'gold-frame-reference',
      frameNumber: 3,
      points: points.map(p => [...p]),
      measurements: { area: value, areaUnit: 'cm2' },
    };
    const hydrated = hydrateSavedViewerAnnotationForViewport({
      annotation: gold,
      viewport: {
        id: 'viewport',
        getCurrentImageId: () => gold.referencedImageId,
        getViewReference: () => ({ FrameOfReferenceUID: gold.FrameOfReferenceUID }),
        getCamera: () => ({}),
        getFrameOfReferenceUID: () => gold.FrameOfReferenceUID,
      },
      viewportId: 'viewport',
      selectAnnotation: false,
    });
    expect(hydrated).toBeTruthy();
    const expected = (value as number).toFixed(2) + ' cm²';
    expect(hydrated?.data?.arSavedMeasurementDisplayText).toEqual([expected]);
    const stats: any = Object.values(hydrated?.data?.cachedStats || {})[0];
    expect(stats).toMatchObject({ area: value, areaUnit: 'cm²' });
    if ((slot as string).startsWith('RV_')) {
      expect(hydrated?.data?.echoArea?.slot).toBe(slot);
    } else {
      expect(hydrated?.data?.laVolume?.slot).toBe(slot);
    }
  });
});

test('reopening an RV spline repeatedly keeps original controls separate from display samples', () => {
  const tools = require('@cornerstonejs/tools');
  const controls = Array.from({length:12}, (_,i) => [Math.cos(i),Math.sin(i),0]);
  const sampled = Array.from({length:240}, (_,i) => [Math.cos(i/20),Math.sin(i/20),0]);
  const savedRV = {...saved(slots[0]),uid:'rv-controls',annotationId:'rv-controls',
    lvSimpson:null,measurementKind:'echoAreaSlot',echoArea:{slot:'RV_ED'},
    points:sampled,splineControlPoints:controls,splineType:'CATMULLROM'};
  tools.SplineROITool.hydrate = jest.fn((_viewport, handles, options) => {
    tools.annotation.state.addAnnotation({annotationUID:options.annotationUID,
      metadata:{},data:{handles:{points:handles},spline:{type:options.splineType}}});
  });
  try {
    for (let reopen = 0; reopen < 4; reopen++) {
      hydrateSavedViewerAnnotationForViewport({annotation:savedRV,
        viewport:{getCurrentImageId:()=>image('sop-a',4)},viewportId:'viewport',selectAnnotation:false});
      const restored = tools.annotation.state.getAnnotation('rv-controls');
      expect(restored.data.handles.points).toEqual(controls);
      expect(restored.data.contour.polyline).toEqual(sampled);
    }
    expect(tools.SplineROITool.hydrate).toHaveBeenCalledTimes(1);
    expect(tools.SplineROITool.hydrate.mock.calls[0][1]).toHaveLength(12);
  } finally {
    delete tools.SplineROITool.hydrate;
  }
});


test('reopened EF uses saved physical calibration instead of converting a null native area to zero', () => {
  const tools = require('@cornerstonejs/tools');
  const cm = [[0,0,0],[20,0,0],[40,0,0],[40,20,0],[20,20,0],[0,20,0]];
  const contour = {...saved(slots[0]),uid:'ef-null-area',annotationId:'ef-null-area',
    measurements:{area:null,areaUnit:'mm²'},
    lvSimpson:{...saved(slots[0]).lvSimpson,calibratedContourPoints:cm,originalContourPoints:cm,calibrationError:null}};
  const hydrated = hydrateSavedViewerAnnotationForViewport({annotation:contour,
    viewport:{getCurrentImageId:()=>image('sop-a',4)},viewportId:'viewport',selectAnnotation:false});
  expect(hydrated.data.cachedStats['imageId:' + image('sop-a',4)])
    .toMatchObject({area:8,areaUnit:'cm²'});
  expect(hydrated.data.arSavedMeasurementDisplayText.join(' ')).toContain('8.00 cm²');
  expect(hydrated.data.arSavedMeasurementDisplayText.join(' ')).not.toContain('0.00 mm');
});


test('saved EF display hook is restored when viewport navigation replaces tool configuration', () => {
  const tools = require('@cornerstonejs/tools');
  const tool = {configuration:{getTextLines:()=>['0.00 mm²']}};
  tools.ToolGroupManager.getToolGroupForViewport.mockReturnValue({getToolInstance:()=>tool,
    setToolConfiguration:(_name: string,config: any)=>{tool.configuration=config;}});
  const physical = [[0,0,0],[20,0,0],[40,0,0],[40,20,0],[20,20,0],[0,20,0]];
  const source = {...saved(slots[0]),uid:'ef-label-hook',annotationId:'ef-label-hook',
    measurements:{area:null,areaUnit:'mm²'},lvSimpson:{...saved(slots[0]).lvSimpson,
      originalContourPoints:physical,calibratedContourPoints:physical}};
  try {
    for (let i=0;i<2;i++) {
      tool.configuration = {getTextLines:()=>['0.00 mm²']};
      const restored = hydrateSavedViewerAnnotationForViewport({annotation:source,
        viewport:{id:'viewport',getCurrentImageId:()=>image('sop-a',4)},viewportId:'viewport',selectAnnotation:false});
      expect(tool.configuration.getTextLines(restored.data)).toEqual(['A4C ED: 8.00 cm²']);
    }
  } finally {
    tools.ToolGroupManager.getToolGroupForViewport.mockReturnValue(null);
  }
});

test('missing EF physical calibration is shown as unavailable rather than a zero area', () => {
  const source = {...saved(slots[0]),uid:'ef-missing-calibration',annotationId:'ef-missing-calibration',
    measurements:{area:null,areaUnit:'mm²'},lvSimpson:{...saved(slots[0]).lvSimpson,
      calibratedContourPoints:null,calibrationError:'ultrasound_regions_missing'}};
  const restored = hydrateSavedViewerAnnotationForViewport({annotation:source,
    viewport:{getCurrentImageId:()=>image('sop-a',4)},viewportId:'viewport',selectAnnotation:false});
  expect(restored.data.arSavedMeasurementDisplayText).toEqual(['A4C ED: area unavailable']);
  expect(restored.data.cachedStats['imageId:' + image('sop-a',4)]?.area).toBeUndefined();
});
