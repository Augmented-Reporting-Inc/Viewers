const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'extensions', 'extension-ar-learning', 'src', 'panels', 'CaseQuestionsPanel.tsx'),
  'utf8'
);
const commandsSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'extensions', 'cornerstone', 'src', 'commandsModule.ts'),
  'utf8'
);

test('saved, unscored learner measurement answers trigger viewport restoration', () => {
  // A saved draft is not necessarily scored: never require scoreItem to
  // reconstruct the learner measurement reference for selected questions.
  const section = panelSource.match(
    /const learnerMeasurement\s*=[\s\S]*?\n\s*const hasViewerTargetOverride\s*=/
  )?.[0];
  assert.ok(section, 'Missing learner measurement reference selection');
  assert.match(section, /question\.type === 'measurementNumeric'/);
  assert.match(section, /mergeReviewReferenceValues\(\s*questionAnswer,/);
  assert.match(section, /scoreItem\?\.learnerResponse/);
  assert.doesNotMatch(section, /scoreItem\s*&&\s*question\.type/);
  assert.match(panelSource, /hasMeasurementComparisonReference\(learnerMeasurement\)/);
  assert.match(panelSource, /'showViewerQuizLearnerMeasurement'/);
});

test('restoration retains learner evidence and separate EF frame-aware saved contour path', () => {
  assert.match(commandsSource, /showViewerQuizLearnerMeasurement:\s*async/);
  assert.match(commandsSource, /findViewerQuizMeasurementAnnotationInSeriesDocs\(learnerMeasurement/);
  assert.match(commandsSource, /jumpToSavedViewerAnnotation\(\{/);
  assert.match(commandsSource, /\[LV EF saved-slot restoration\]/);
  assert.match(commandsSource, /isSavedLVSimpsonImageMatch/);
  assert.match(commandsSource, /rowButton\('Freehand'/);
  assert.match(commandsSource, /rowButton\('Axis \+ Apex'/);
});
