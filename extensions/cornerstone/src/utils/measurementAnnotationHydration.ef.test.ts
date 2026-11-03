import { hydrateSavedViewerAnnotationForViewport } from './measurementAnnotationHydration';

jest.mock('@cornerstonejs/core', () => ({
  metaData: { get: jest.fn(() => null) },
}));

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
});

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
