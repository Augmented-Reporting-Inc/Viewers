import { getSubmittedEFReviewContour, getFocusedEFComparisonImageId, isComparisonAnnotationIndexed } from './quizEFSubmittedReviewContour';

const frame = (slot: string) => ({
  studyInstanceUID: 'study-test', seriesInstanceUID: 'series-test',
  sopInstanceUID: 'sop-' + slot, frameNumber: 2,
  referencedImageId: 'wadors:/studies/study-test/series/series-test/instances/sop-' + slot + '/frames/2',
});
const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
const points = (count = 4096) =>
  Array.from({ length: count }, (_, i) => [i / 50, i % 30, 0]);
const submitted = () => ({
  isLearnerCopy: true,
  viewerQuizResponses: [{
    quizKey: 'case2', quizVersion: 1, status: 'submitted',
    answers: [{
      questionKey: 'ef', value: {
        measurementKind: 'lvSimpsonEF',
        compositeResult: {
          components: slots.map(slot => ({
            slot, annotationId: 'learner-' + slot, target: frame(slot),
            points: points(),
          })),
          derived: {
            slotVolumeML: {
              A4C_ED: 86.44, A4C_ES: 53.88, A2C_ED: 103.42, A2C_ES: 60.38,
            },
          },
        },
      },
    }],
  }],
});
const select = (doc: any, slot = 'A4C_ED', target = frame(slot)) =>
  getSubmittedEFReviewContour({
    learnerSeriesDoc: doc, quizKey: 'case2', quizVersion: 1,
    questionKey: 'ef', slot, goldTarget: target,
  });

describe('submitted EF answer review contour selection', () => {
  it('selects each phase by exact submitted slot and immutable DICOM identity', () => {
    const doc = submitted();
    for (const slot of slots) {
      const found = select(doc, slot);
      expect(found?.annotationId).toBe('learner-' + slot);
      expect(found?.points.length).toBe(4096);
      const volumes: Record<string, number> = doc.viewerQuizResponses[0].answers[0]
        .value.compositeResult.derived.slotVolumeML;
      expect(found?.volumeML).toBe(volumes[slot]);
    }
    expect(select(doc, 'A4C_ED')?.annotationId).not.toBe(select(doc, 'A2C_ES')?.annotationId);
  });
  it('fails closed for another image, quiz version or an unsubmitted attempt', () => {
    const doc = submitted();
    expect(select(doc, 'A4C_ED', frame('A4C_ES'))).toBeNull();
    expect(getSubmittedEFReviewContour({
      learnerSeriesDoc: doc, quizKey: 'case2', quizVersion: 2,
      questionKey: 'ef', slot: 'A4C_ED', goldTarget: frame('A4C_ED'),
    })).toBeNull();
    doc.viewerQuizResponses[0].status = 'draft';
    expect(select(doc)).toBeNull();
  });
  it('rejects missing/duplicated phase, malformed coordinates and more than 10k points', () => {
    const doc = submitted();
    const components = doc.viewerQuizResponses[0].answers[0].value.compositeResult.components;
    components[0].points = points(10001);
    expect(select(doc)).toBeNull();
    components[0].points = [[0, 0], [1, Infinity], [2, 2]];
    expect(select(doc)).toBeNull();
    components[0].points = points(4096);
    components[0].slot = 'A2C_ES';
    expect(select(doc)).toBeNull();
  });
  it('does not invent a volume when the submitted answer lacks one', () => {
    const doc = submitted();
    delete doc.viewerQuizResponses[0].answers[0].value.compositeResult.derived.slotVolumeML.A4C_ED;
    expect(select(doc)?.volumeML).toBeNull();
    doc.isLearnerCopy = false;
    expect(select(doc)).toBeNull();
  });
});

describe('focused submitted EF comparison uses the actual active frame', () => {
  it('resolves all four submitted contours, including non-first stack frames and stale cache URLs', () => {
    const doc = submitted();
    for (const slot of slots) {
      const gold = frame(slot);
      const learner = select(doc, slot, gold)!;
      const active = {...gold, referencedImageId: gold.referencedImageId.replace('wadors:/', 'wadors:https://current.invalid/')};
      const firstImage = active.referencedImageId.replace('/frames/2', '/frames/1');
      for (const sourceTarget of [gold, learner.target]) {
        expect(getFocusedEFComparisonImageId({
          activeTarget: active, sourceTarget, currentImageId: active.referencedImageId,
        })).toBe(active.referencedImageId);
        expect(getFocusedEFComparisonImageId({
          activeTarget: active, sourceTarget, currentImageId: firstImage,
        })).toBe('');
      }
      expect(learner.target.referencedImageId).toBe(gold.referencedImageId);
    }
  });
  it('rejects wrong study, series, instance, frame and stale active viewport identity', () => {
    const active = frame('A4C_ES');
    for (const sourceTarget of [
      {...active, studyInstanceUID: 'other-study'},
      {...active, seriesInstanceUID: 'other-series'},
      {...active, sopInstanceUID: 'other-sop'},
      {...active, frameNumber: 20},
      {...active, frameNumber: 0},
      null,
    ]) {
      expect(getFocusedEFComparisonImageId({
        activeTarget: active, sourceTarget, currentImageId: active.referencedImageId,
      })).toBe('');
    }
    expect(getFocusedEFComparisonImageId({
      activeTarget: {...active, referencedImageId: active.referencedImageId.replace('/frames/2','/frames/20')},
      sourceTarget: active, currentImageId: active.referencedImageId.replace('/frames/2','/frames/20'),
    })).toBe('');
  });
});

describe('comparison annotation indexing uses the actual Cornerstone group result', () => {
  const element = {};
  const native = { annotationUID: 'learner-A4C_ED', metadata: { toolName: 'PlanarFreehandROI' } };
  const id = native.annotationUID;
  it('does not call the unfiltered group lookup when the native contour is absent', () => {
    const state = { getAnnotations: jest.fn(() => ({ PlanarFreehandROI: [native] })) };
    expect(isComparisonAnnotationIndexed(state, element, null, id)).toBe(false);
    expect(isComparisonAnnotationIndexed(state, element, { metadata: {} }, id)).toBe(false);
    expect(isComparisonAnnotationIndexed(state, element, { metadata: { toolName: '' } }, id)).toBe(false);
    expect(state.getAnnotations).not.toHaveBeenCalled();
  });
  it('handles both a named-tool array and a tool-keyed group without throwing', () => {
    for (const result of [[native], { PlanarFreehandROI: [native] }]) {
      const state = { getAnnotations: jest.fn(() => result) };
      expect(isComparisonAnnotationIndexed(state, element, native, id)).toBe(true);
      expect(state.getAnnotations).toHaveBeenCalledWith('PlanarFreehandROI', element);
    }
    for (const result of [null, undefined, {}, { PlanarFreehandROI: {} },
      { SplineROI: [native] }, [null, { annotationUID: 'gold-A4C_ED' }]]) {
      const state = { getAnnotations: jest.fn(() => result) };
      expect(isComparisonAnnotationIndexed(state, element, native, id)).toBe(false);
    }
  });
  it('allows learner and gold overlays to be independently indexed after hydration', () => {
    const gold = { ...native, annotationUID: 'gold-A4C_ED' };
    const state = { getAnnotations: jest.fn()
      .mockReturnValueOnce({}).mockReturnValueOnce([native, gold])
      .mockReturnValueOnce({ PlanarFreehandROI: [native, gold] }) };
    expect(isComparisonAnnotationIndexed(state, element, native, id)).toBe(false);
    expect(isComparisonAnnotationIndexed(state, element, native, id)).toBe(true);
    expect(isComparisonAnnotationIndexed(state, element, gold, gold.annotationUID)).toBe(true);
  });
});
