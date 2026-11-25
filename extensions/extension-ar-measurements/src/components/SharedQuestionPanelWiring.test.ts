import fs from 'fs';
import path from 'path';

const learning = fs.readFileSync(
  path.resolve(__dirname, '../../../extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'), 'utf8'
);
const research = fs.readFileSync(
  path.resolve(__dirname, '../../../extension-ar-research/src/panels/ResearchReadPanel.tsx'), 'utf8'
);

describe('Education and Research share the same question presentation implementation', () => {
  it('mounts the actual Learning renderer and keeps numeric inputs common', () => {
    const renderer = fs.readFileSync(
      path.resolve(__dirname, '../../../extension-ar-learning/src/panels/LearningQuestionPanel.tsx'),
      'utf8'
    );
    expect(learning).toContain('<LearningQuestionPanel');
    expect(research).toContain('<LearningQuestionPanel');
    for (const component of [
      'SharedQuestionSelector',
      'SharedQuestionStepNavigation',
      'SharedQuestionCard',
    ]) {
      expect(renderer).toContain('<' + component);
    }
    expect(learning).toContain('<SharedMeasurementValueInput');
    expect(research).toContain('<SharedMeasurementValueInput');
    expect(learning).toContain('<SharedMeasurementLabel');
    expect(research).toContain('<SharedMeasurementLabel');
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
