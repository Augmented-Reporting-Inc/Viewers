import { getSubmittedEFReviewContour } from './quizEFSubmittedReviewContour';

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
      expect(found?.volumeML).toBe(doc.viewerQuizResponses[0].answers[0]
        .value.compositeResult.derived.slotVolumeML[slot]);
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
