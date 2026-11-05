import {
  isMatchingQuizEFCompletion,
  isGuidedQuizCompositeKind,
  getInitialGuidedEFQuestionTarget,
  getEFQuizSubmissionEvidenceError,
} from './quizCompositeCaptureIntent';

const matching = {
  mode: 'completed',
  authoringMode: false,
  questionKind: 'lvSimpsonEF',
  eventStudy: 'study-a',
  activeStudy: 'study-a',
  eventValue: 53.234,
  currentValue: 53.232,
};

describe('guided quiz measurement activation', () => {
  it('identifies supported clinical composites without treating Length as composite', () => {
    expect(isGuidedQuizCompositeKind('lvSimpsonEF')).toBe(true);
    expect(isGuidedQuizCompositeKind('laVolumeBiplane')).toBe(true);
    for (const kind of ['laVolumeBiplaneDisks', 'rvFAC', 'raArea', 'ivcCollapsibility', 'trVmax', 'trVTI']) {
      expect(isGuidedQuizCompositeKind(kind)).toBe(true);
    }
    expect(isGuidedQuizCompositeKind('Length')).toBe(false);
    expect(isGuidedQuizCompositeKind('')).toBe(false);
  });
});

describe('fourth-contour EF capture', () => {
  it('accepts a learner completion from the same study at quiz precision', () => {
    expect(isMatchingQuizEFCompletion(matching)).toBe(true);
  });
  it('never auto-captures a gold answer on educator completion', () => {
    expect(isMatchingQuizEFCompletion({ ...matching, authoringMode: true })).toBe(false);
    expect(isMatchingQuizEFCompletion({
      ...matching, authoringMode: true, mode: 'manual',
    })).toBe(true);
  });
  it('rejects wrong question, invalid event and unrelated study', () => {
    expect(isMatchingQuizEFCompletion({ ...matching, questionKind: 'laVolumeBiplane' })).toBe(false);
    expect(isMatchingQuizEFCompletion({ ...matching, questionKind: 'Length' })).toBe(false);
    expect(isMatchingQuizEFCompletion({ ...matching, eventStudy: 'study-b' })).toBe(false);
    expect(isMatchingQuizEFCompletion({ ...matching, eventStudy: '' })).toBe(false);
    expect(isMatchingQuizEFCompletion({ ...matching, mode: 'unknown' })).toBe(false);
  });
  it('rejects incomplete, nonfinite and changed EF values', () => {
    expect(isMatchingQuizEFCompletion({ ...matching, currentValue: undefined })).toBe(false);
    expect(isMatchingQuizEFCompletion({ ...matching, eventValue: NaN })).toBe(false);
    expect(isMatchingQuizEFCompletion({ ...matching, currentValue: Infinity })).toBe(false);
    expect(isMatchingQuizEFCompletion({ ...matching, currentValue: 53.237 })).toBe(false);
  });
});

describe('initial guided EF question navigation', () => {
  const first = { sopInstanceUID: '1.2.3.101', instanceNumber: 101, frameNumber: 4 };
  const last = { sopInstanceUID: '1.2.3.119', instanceNumber: 119, frameNumber: 19 };

  it('opens A4C_ED instead of the saved final EF answer frame', () => {
    expect(getInitialGuidedEFQuestionTarget({
      questionType: 'measurementNumeric',
      measurementKind: 'lvSimpsonEF',
      authoredFirstFrame: first,
      existingTarget: last,
    })).toEqual(first);
  });

  it('preserves explicit navigation overrides, including review actions', () => {
    expect(getInitialGuidedEFQuestionTarget({
      questionType: 'measurementNumeric',
      measurementKind: 'lvSimpsonEF',
      authoredFirstFrame: first,
      existingTarget: last,
      hasTargetOverride: true,
    })).toEqual(last);
  });

  it('preserves the previous behavior for manual EF and other measurements', () => {
    for (const [questionType, measurementKind, authoredFirstFrame] of [
      ['measurementNumeric', 'lvSimpsonEF', null],
      ['measurementNumeric', 'laVolumeBiplane', first],
      ['frameSelection', 'lvSimpsonEF', first],
      ['measurementNumeric', 'length', first],
    ] as const) {
      expect(getInitialGuidedEFQuestionTarget({
        questionType, measurementKind, authoredFirstFrame, existingTarget: last,
      })).toEqual(last);
    }
  });
});

describe('EF submitted evidence gate', () => {
  const question: any = {
    type: 'measurementNumeric',
    answerConfig: { measurementKind: 'lvSimpsonEF' },
    scoringConfig: { absoluteTolerance: 10, radius: '20' },
  };
  const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  const complete = {
    value: 32.5, measurementKind: 'lvSimpsonEF',
    compositeResult: {
      components: slots.map((slot, index) => ({
        slot, annotationId: 'contour-' + index,
        target: { sopInstanceUID: 'sop-' + index, frameNumber: 1 },
        points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      })),
    },
  };
  it('rejects a scalar-only saved EF when spatial radius is configured', () => {
    expect(getEFQuizSubmissionEvidenceError(question, { value: 32.5, unit: '%' }))
      .toMatch(/missing captured contour evidence/);
  });
  it('accepts a complete four-slot EF result', () => {
    expect(getEFQuizSubmissionEvidenceError(question, complete)).toBe('');
  });
  it('rejects missing and duplicate slots', () => {
    const missing = { ...complete, compositeResult: { components: complete.compositeResult.components.slice(1) } };
    expect(getEFQuizSubmissionEvidenceError(question, missing)).not.toBe('');
    const duplicate = { ...complete, compositeResult: { components: [
      ...complete.compositeResult.components.slice(0, 3), complete.compositeResult.components[0],
    ] } };
    expect(getEFQuizSubmissionEvidenceError(question, duplicate)).not.toBe('');
  });
  it('preserves numeric-only legacy EF and unrelated questions', () => {
    expect(getEFQuizSubmissionEvidenceError({ ...question, scoringConfig: { absoluteTolerance: 10 } }, { value: 32.5 })).toBe('');
    expect(getEFQuizSubmissionEvidenceError({
      ...question, scoringConfig: { compositeContour: { enabled: true } },
    }, { value: 32.5 })).not.toBe('');
    expect(getEFQuizSubmissionEvidenceError({
      ...question, answerConfig: { measurementKind: 'length' },
    }, { value: 32.5 })).toBe('');
  });
});
