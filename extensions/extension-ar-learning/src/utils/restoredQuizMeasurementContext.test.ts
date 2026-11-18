import { getRestoredQuizMeasurementKind } from './restoredQuizMeasurementContext';

const quizzes = [{
  quizKey: 'case-2',
  questions: [
    { questionKey: 'tr', type: 'measurementNumeric', answerConfig: { measurementKind: 'trVmax' } },
    { questionKey: 'lav', type: 'measurementNumeric', answerConfig: { measurementKind: 'laVolumeBiplaneDisks' } },
    { questionKey: 'frame', type: 'frameSelection', answerConfig: { measurementKind: 'trVmax' } },
  ],
}];

describe('restoring selected learner measurement context', () => {
  it('restores TR Vmax tool binding without reopening target selection', () => {
    expect(getRestoredQuizMeasurementKind({ activeQuestionKey: 'case-2:tr', quizzes }))
      .toBe('trVmax');
  });

  it('restores other kinds and does not infer a kind for nonmeasurement questions', () => {
    expect(getRestoredQuizMeasurementKind({ activeQuestionKey: 'case-2:lav', quizzes }))
      .toBe('laVolumeBiplaneDisks');
    expect(getRestoredQuizMeasurementKind({ activeQuestionKey: 'case-2:frame', quizzes }))
      .toBe('');
  });

  it('never infers a quiz target without an exact selected question', () => {
    expect(getRestoredQuizMeasurementKind({ activeQuestionKey: '', quizzes })).toBe('');
    expect(getRestoredQuizMeasurementKind({ activeQuestionKey: 'wrong:tr', quizzes })).toBe('');
    expect(getRestoredQuizMeasurementKind({ activeQuestionKey: 'case-2:missing', quizzes })).toBe('');
  });

  it('restores educator selection only when authoring mode is active', () => {
    const authoringQuestions = [{ questionKey: 'tr', type: 'measurementNumeric',
      answerConfig: { measurementKind: 'trVmax' } }];
    expect(getRestoredQuizMeasurementKind({
      activeQuestionKey: 'authoring:tr', authoringMode: true, authoringQuestions,
    })).toBe('trVmax');
    expect(getRestoredQuizMeasurementKind({
      activeQuestionKey: 'authoring:tr', quizzes,
    })).toBe('');
  });
});
