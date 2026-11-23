import { getViewerQuizComparisonLabelCanvasPosition as position } from './quizReviewLabelLayout';

describe('quiz learner and gold review label positions', () => {
  it('keeps long EF/LAV labels on opposite edges of wide viewports', () => {
    const learner = position({ width: 1300, height: 880, variant: 'learner' });
    const gold = position({ width: 1300, height: 880, variant: 'rubric' });
    expect(learner).toEqual([18, 70.4]);
    expect(gold).toEqual([930, 70.4]);
    expect(gold![0] - learner![0]).toBeGreaterThanOrEqual(360);
  });
  it('stacks labels vertically if the viewport is narrow', () => {
    const learner = position({ width: 520, height: 450, variant: 'learner' });
    const gold = position({ width: 520, height: 450, variant: 'rubric' });
    expect(learner![0]).toBe(gold![0]);
    expect(gold![1] - learner![1]).toBeGreaterThanOrEqual(60);
  });
  it('fails closed for invalid viewport geometry', () => {
    expect(position({width:0,height:600,variant:'learner'})).toBeNull();
    expect(position({width:1000,height:NaN,variant:'rubric'})).toBeNull();
  });
});
