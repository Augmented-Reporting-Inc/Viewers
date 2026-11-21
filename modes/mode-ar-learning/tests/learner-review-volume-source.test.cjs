const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const commands = fs.readFileSync(path.join(root, 'extensions', 'cornerstone', 'src', 'commandsModule.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'extensions', 'extension-ar-measurements', 'src', 'panels', 'ARMeasurementsPanel.tsx'), 'utf8');

test('learner EF review uses verified live single-view volumes, never a compacted preview recalculation as primary source', () => {
  assert.match(commands, /calculateLVSimpsonContourVolumeForMeasurement\(candidate\)/);
  // First save may precede MeasurementService's full calibrated geometry.
  // Only an exact-ID, exact-image session/native contour may supply the
  // display value; never manufacture a scalar from an uncalibrated preview.
  assert.match(commands, /lvSimpsonSessionMeasurementsByUid\.get\(measurementId\)/);
  assert.match(commands, /isSavedLVSimpsonImageMatch\(candidate/);
  assert.match(commands, /calculateLVSimpsonContourVolumeForAnnotationData\(native\)/);
  assert.match(commands, /reviewContourValuesById\.set\(measurementId,[\s\S]*?kind: 'lvSimpsonSlot'/);
  assert.match(commands, /reviewOnlySingleViewVolumeML: source\.value/);
  assert.match(panel, /Number\(measurement\.reviewOnlySingleViewVolumeML\)/);
  assert.match(panel, /volumeML\.toFixed\(2\)\} mL/);
});

test('review-only contour scalars never enter PUT MeasurementAnnotations or canonical saved annotations', () => {
  const previewStart = commands.indexOf('if (previewOnly) {', commands.indexOf('const reportAnnotations ='));
  const previewEnd = commands.indexOf('if (Array.isArray(reportFieldNames))', previewStart);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  const preview = commands.slice(previewStart, previewEnd);
  assert.match(preview, /MeasurementAnnotations: nextMeasurementAnnotations/);
  assert.match(preview, /annotations: reportAnnotations\.map\(annotation =>/);
  assert.match(preview, /reviewOnlySingleViewVolumeML/);
  assert.match(preview, /reviewOnlyLAContourAreaCM2/);
  assert.match(preview, /source\.referencedImageId !== String\(annotation\?\.referencedImageId \|\| ''\)/);
  assert.doesNotMatch(preview.slice(0, preview.indexOf('const previewResponse')), /reviewOnlySingleViewVolumeML|reviewOnlyLAContourAreaCM2/);
});

test('learner review distinguishes single LA contour area from calculated biplane LA volume', () => {
  assert.match(commands, /getVerifiedLAVolumeContourAreaCM2\(candidate\)/);
  assert.match(panel, /hasReviewedLAArea \? `\$\{reviewedLAAreaCM2\.toFixed\(2\)\} cm²`/);
  assert.match(panel, /hasReviewedLAArea \? `LA \$\{laSlot\.replace\('_', ' '\)\} area`/);
  assert.match(panel, /review\.calculatedRows/);
});

test('TR Vmax rechecks active quiz target at completion to avoid a restoration race dialog', () => {
  const start = commands.indexOf('ultrasoundDirectionalCompletionHandler = async');
  const end = commands.indexOf('eventTarget.addEventListener(', start);
  assert.ok(start > 0 && end > start);
  const completion = commands.slice(start, end);
  assert.match(completion, /const isCurrentTrQuizCapture = spectralVmax &&\s*\(quizCapture \|\| activeQuizMeasurementKind === 'trVmax'\)/);
  assert.match(completion, /const completionTargetKey = isCurrentTrQuizCapture\s*\? 'echo\.trPeakVelocity' : preferredTargetKey/);
  assert.match(completion, /if \(!completionTargetKey && Number\.isFinite\(rawValue\)/);
  assert.match(commands, /startSpectralVmaxWorkflow:\s*\{\s*commandFn: \(\) => actions\.startUltrasoundDirectionalWorkflow\(\{ spectralVmax: true \}\)/);
});

test('learner Submit skips only after server preview and persisted learner report verification', () => {
  const questions = fs.readFileSync(path.join(root, 'extensions', 'extension-ar-learning', 'src', 'panels', 'CaseQuestionsPanel.tsx'), 'utf8');
  const handler = questions.slice(
    questions.indexOf('async function confirmReportOwnedMeasurementSave('),
    questions.indexOf('async function saveQuiz(', questions.indexOf('async function confirmReportOwnedMeasurementSave('))
  );
  assert.match(handler, /previewOnly: true, educationQuizHemodynamics/);
  assert.match(handler, /preview\.educationQuizHemodynamicFields\?\.includes/);
  assert.match(handler, /shouldSkipUnchangedLearnerSubmitMeasurementReview\(/);
  assert.match(handler, /getUpdatedLearnerHemodynamicReviewRows\(/);
  const previewOffset = handler.indexOf('previewOnly: true, educationQuizHemodynamics');
  const verifyOffset = handler.indexOf('preview.educationQuizHemodynamicFields?.includes');
  const skipOffset = handler.indexOf('shouldSkipUnchangedLearnerSubmitMeasurementReview(');
  assert.ok(previewOffset >= 0 && previewOffset < verifyOffset && verifyOffset < skipOffset);
  // The independent learner quiz source verification must still run after review
  // (or after the safe no-dialog path) and before saving quiz answers.
  const saveQuiz = questions.slice(questions.indexOf('async function saveQuiz('), questions.indexOf('async function retryScoreQuiz('));
  assert.match(saveQuiz, /getLearnerCompositePersistenceSources\(/);
  assert.match(saveQuiz, /isPersistedLearnerCompositeSource\(/);
  assert.match(saveQuiz, /saveViewerQuizResponseForActiveStudy\(/);
  assert.ok(saveQuiz.indexOf('isPersistedLearnerCompositeSource(') < saveQuiz.indexOf('saveViewerQuizResponseForActiveStudy('));
});

test('learner footer uses per-action labels while retaining shared disabled state', () => {
  const questions = fs.readFileSync(path.join(root, 'extensions', 'extension-ar-learning', 'src', 'panels', 'CaseQuestionsPanel.tsx'), 'utf8');
  const footer = questions.slice(questions.indexOf('{learnerFooterQuizzes.map(quiz => {'));
  assert.match(footer, /getLearnerQuizSaveButtonLabels\(\{/);
  assert.match(footer, /savingAction: savingQuizAction/);
  assert.match(footer, /\{saveButtonLabels\.draft\}/);
  assert.match(footer, /\{saveButtonLabels\.submit\}/);
  assert.match(footer, /disabled=\{quizSaving \|\| submitting\}/);
  assert.doesNotMatch(footer, /quizSaving \? 'Saving…'/);
  assert.doesNotMatch(footer, /quizSaving \? 'Submitting…'/);
});
