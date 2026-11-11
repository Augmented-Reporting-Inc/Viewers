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
