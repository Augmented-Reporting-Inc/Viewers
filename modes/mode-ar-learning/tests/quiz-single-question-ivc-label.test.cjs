const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = fs.readFileSync(path.join(
  __dirname, '..', '..', '..', 'extensions', 'extension-ar-learning',
  'src', 'panels', 'CaseQuestionsPanel.tsx'
), 'utf8');
const commands = fs.readFileSync(path.join(
  __dirname, '..', '..', '..', 'extensions', 'cornerstone',
  'src', 'commandsModule.ts'
), 'utf8');

test('educator shows one selected viewer-native question without renumbering the quiz', () => {
  assert.match(panel, /id="quiz-authoring-question-select"/);
  assert.match(panel, /isViewerNativeQuestion\(question\) &&\s*activeQuestionKey === `authoring:\$\{question\.questionKey\}`/);
  assert.match(panel, /\{index \+ 1\}\. \{question\.title \|\| question\.prompt \|\| question\.questionKey\}/);
  assert.match(panel, /\? renderAuthoringQuestion\(question, index\) : null/);
  assert.match(panel, /onClick=\{saveAuthoringDraft\}/);
});

test('learner question dropdown uses saved selection and only renders its question', () => {
  assert.match(panel, /id="quiz-learner-question-select"/);
  assert.match(panel, /value=\{quizzes\.some\(quiz/);
  assert.match(panel, /if \(question\) \{\s*void selectQuestion\(quiz, question\);/);
  assert.match(panel, /if \(activeQuestionKey !== questionSelectionKey\) return null;/);
  assert.match(panel, /\{renderQuestion\(quiz, question, submitted\)\}/);
  assert.match(panel, /\{renderQuestionReview\(quiz, question, quizScore\)\}/);
});

test('learner composite calculated value appears in only one status area', () => {
  assert.match(panel, /\{renderCompositeCalculatedStatus\(quiz, question\)\}/);
  assert.doesNotMatch(panel, /Calculated answer: \$\{Number\(value\.value\)/);
  assert.match(panel, /getLearnerCompositeAutoCaptureSignature/);
  assert.match(panel, /'Recalculate from measured contours'/);
});

test('explicit learner IVC phase bypasses only the pending first label dialog', () => {
  assert.match(panel, /labelMode: 'measure-only'/);
  assert.match(panel, /pendingQuizIVCPhaseRef\.current = \{/);
  assert.match(panel, /'setViewerQuizIVCPhaseLabel'/);
  assert.match(commands, /viewerLengthLabelMode === VIEWER_LENGTH_LABEL_MODE_MEASURE_ONLY/);
  assert.match(commands, /pendingAnnotation\?\.data\?\.arPendingLengthLabel === true/);
  assert.match(commands, /measurement\.toolName === 'Length'/);
  assert.match(commands, /'ar-learning:quiz-measurement-added'/);
  assert.match(commands, /resetViewerLengthLabelMode:/);
});
