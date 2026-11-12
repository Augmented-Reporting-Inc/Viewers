import { validateAndOrderAuthoringQuestions } from './quizAuthoringQuestionIdentity';

describe('viewer quiz question identity and order', () => {
  it('orders new LAV at position six from saved sortOrder, regardless of storage array order', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, index) => ({
        questionKey: 'q-' + (index + 1), sortOrder: index < 5 ? index + 1 : index + 2,
      })),
      { questionKey: 'lav-unique', sortOrder: 6 },
    ];
    const ordered = validateAndOrderAuthoringQuestions(rows);
    expect(ordered).toHaveLength(10);
    expect(ordered[5].questionKey).toBe('lav-unique');
    expect(ordered[9].questionKey).toBe('q-9');
  });

  it('blocks duplicated LAV / TR Vmax keys before dropdown or gold editing', () => {
    const rows = [
      { questionKey: 'question_10', sortOrder: 8 },
      { questionKey: 'question_10', sortOrder: 6 },
    ];
    expect(() => validateAndOrderAuthoringQuestions(rows))
      .toThrow(/duplicated or missing question identifiers/);
  });

  it('blocks missing keys, and retains stable ordering when sortOrder ties', () => {
    expect(() => validateAndOrderAuthoringQuestions([
      { questionKey: 'valid' }, { questionKey: '' },
    ])).toThrow(/duplicated or missing/);
    const rows = [
      { questionKey: 'a', sortOrder: 1 },
      { questionKey: 'b', sortOrder: 1 },
    ];
    expect(validateAndOrderAuthoringQuestions(rows)).toEqual(rows);
  });
});
