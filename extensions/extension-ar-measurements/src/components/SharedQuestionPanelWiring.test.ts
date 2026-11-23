import fs from 'fs';
import path from 'path';

const learning = fs.readFileSync(
  path.resolve(__dirname, '../../../extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'), 'utf8'
);
const research = fs.readFileSync(
  path.resolve(__dirname, '../../../extension-ar-research/src/panels/ResearchReadPanel.tsx'), 'utf8'
);

describe('Education and Research share the same question presentation implementation', () => {
  it('uses one selector, step navigation, card and measurement answer input', () => {
    for (const component of [
      'SharedQuestionSelector',
      'SharedQuestionStepNavigation',
      'SharedQuestionCard',
      'SharedMeasurementValueInput',
    ]) {
      expect(learning).toContain('<' + component);
      expect(research).toContain('<' + component);
    }
  });

  it('keeps workflow-specific answer ownership instead of routing Research through quiz scoring', () => {
    expect(learning).toContain('saveViewerQuizResponseForActiveStudy');
    expect(research).toContain('saveResearchReadReview');
    expect(research).toContain('completeResearchReadReview');
    expect(research).not.toContain('submitAndRefreshViewerQuizScoreForActiveStudy');
  });

  it('preserves verified derived Research EF capture and source-frame association', () => {
    expect(research).toContain('reconcileResearchEchoCompositeAnswers(');
    expect(research).toContain('getResearchCompatibleMeasurementCandidates(');
    expect(research).toContain('includeResearchEchoContours: true');
  });
});
