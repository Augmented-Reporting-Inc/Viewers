import {
  appendBowelMeasurementSetAnswer,
  getBowelMeasurementSetEntries,
} from './bowelQuizMeasurementSet';

const question = {
  answerConfig: {
    measurementKind: 'length',
    measurementSet: {
      enabled: true,
      orientation: 'longitudinal',
      requiredCount: 2,
      measurementTarget: 'BowelCecumBWT',
    },
  },
};
const target = {
  studyInstanceUID: 'study',
  seriesInstanceUID: 'series',
  sopInstanceUID: 'instance',
  frameNumber: 6,
};
function caliper(id: string, x: number, overrides: Record<string, any> = {}) {
  return {
    sourceAnnotationId: id,
    value: 3.2,
    unit: 'mm',
    measurementKind: 'length',
    measurementType: 'BowelCecumBWT',
    viewerTarget: target,
    quizSpatialEvidence: {
      source: 'dicom-calibrated-image-index-v1',
      calibrationSource: 'ultrasound-region',
      pixelSpacing: { row: 0.1, column: 0.1 },
      physicalPoints: [[x, 0, 0], [x, 3.2, 0]],
    },
    ...overrides,
  };
}

describe('learner multiple-BWT capture', () => {
  it('increments count as each labelled, calibrated source is captured', () => {
    const first = appendBowelMeasurementSetAnswer(question, [], caliper('a', 0));
    expect(first.ok).toBe(true);
    expect(getBowelMeasurementSetEntries(first.entries).length).toBe(1);
    const second = appendBowelMeasurementSetAnswer(question, first.entries || [], caliper('b', 5));
    expect(second.ok).toBe(true);
    expect(getBowelMeasurementSetEntries(second.entries).length).toBe(2);
    expect(second.entries?.map(item => item.sourceAnnotationId)).toEqual(['a', 'b']);
    expect(second.axis).toEqual([5, 0, 0]);
  });

  it('does not duplicate a caliper from two completion notifications', () => {
    const first = appendBowelMeasurementSetAnswer(question, [], caliper('a', 0));
    const repeated = appendBowelMeasurementSetAnswer(question, first.entries || [], caliper('a', 0));
    expect(repeated.ok).toBe(false);
    expect(repeated.reason).toMatch(/already in the measurement set/);
  });

  it('fails closed for wrong frames and uncalibrated measurements', () => {
    const first = appendBowelMeasurementSetAnswer(question, [], caliper('a', 0));
    const otherFrame = appendBowelMeasurementSetAnswer(question, first.entries || [],
      caliper('b', 5, { viewerTarget: { ...target, frameNumber: 7 } }));
    expect(otherFrame.ok).toBe(false);
    expect(otherFrame.reason).toMatch(/same identified image\/frame/);
    const noEvidence = appendBowelMeasurementSetAnswer(question, first.entries || [],
      caliper('c', 5, { quizSpatialEvidence: {} }));
    expect(noEvidence.ok).toBe(false);
    expect(noEvidence.reason).toMatch(/Calibrated image-index/);
  });
});
