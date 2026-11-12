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

test('late viewer navigation cannot restore a previously selected LAV question', () => {
  const selection = panel.match(/async function selectQuestion\([\s\S]*?\n  async function captureCurrentFrameAnswer/)?.[0];
  assert.ok(selection, 'Question selection function exists');
  assert.match(selection, /setActiveQuestionKey\(nextActiveQuestionKey\);/);
  assert.match(selection, /if \(lastActivatedQuestionRef\.current !== nextActiveQuestionKey\) return;/);
  assert.equal((selection.match(/setActiveQuestionKey\(nextActiveQuestionKey\);/g) || []).length, 1,
    'The active question is set once, before asynchronous viewer operations');
});

test('delayed educator gold capture cannot reselect its old question', () => {
  const capture = panel.match(/async function captureAuthoringMeasurement\([\s\S]*?\n  async function /)?.[0];
  assert.ok(capture, 'Educator capture function exists');
  assert.doesNotMatch(capture, /setActiveQuestionKey\(`authoring:/);
  assert.match(capture, /options\.silent &&[\s\S]*?lastActivatedQuestionRef\.current !==/);
});

test('learner question dropdown shows answer status without exposing educator gold', () => {
  assert.match(panel, /id="quiz-learner-question-select"/);
  assert.match(panel, /function isLearnerQuestionAnswered\(/);
  assert.match(panel, /isLearnerQuestionAnswered\(\s*question, answersByQuizKey\?\.\[quiz\.quizKey\]/);
  assert.match(panel, /'✓ Answered' : '○ Unanswered'/);
  assert.doesNotMatch(panel, /An assigned target opens its/);
  assert.doesNotMatch(panel, /'Opens target instance' : 'Opens target'/);
});

test('learner removes redundant text and generic recapture while retaining calculated result', () => {
  assert.doesNotMatch(panel, /Recapture selected measurement/);
  assert.doesNotMatch(panel, /then use it as the answer/);
  assert.doesNotMatch(panel, /Navigate to the required DICOM instance and frame for each phase/);
  assert.doesNotMatch(panel, /Learner source saved/);
  assert.doesNotMatch(panel, /Calculated and saved learner answer/);
  assert.doesNotMatch(panel, /The selected phase is assigned automatically/);
  assert.doesNotMatch(panel, /Both values are included in the quiz answer on Save or Submit/);
  assert.match(panel, /Recalculate from measured contours/);
});
