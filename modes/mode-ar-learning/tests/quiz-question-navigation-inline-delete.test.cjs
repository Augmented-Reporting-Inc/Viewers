'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const panel = fs.readFileSync(
  path.resolve(__dirname, '../../../extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'),
  'utf8'
);

test('question stepping uses the existing selectQuestion workflow for both roles', () => {
  assert.match(panel, /function renderQuestionNavigation\(/);
  assert.match(panel, /void selectQuestion\(quiz, target\)/);
  assert.match(panel, /renderQuestionNavigation\(quiz, question, questions, submitted \|\| quizSaving\)/);
  assert.match(panel, /authoringQuestions\.filter\(isViewerNativeQuestion\)/);
  assert.match(panel, /const navigatingDisabled = disabled \|\| !!capturingMeasurementKey/);
  assert.match(panel, /disabled=\{navigatingDisabled \|\| !target\}/);
});

test('measurement clear actions are inline, accessible, and retain source-aware deletions', () => {
  assert.match(panel, /aria-label=\{\`Delete \$\{slot\} measurement\`\}/);
  assert.match(panel, /deleteCompositePhaseMeasurement\(quiz, question, slot, phaseSource\)/);
  assert.match(panel, /aria-label="Delete TR Vmax measurement"/);
  assert.match(panel, /deleteLearnerQuizSourceMeasurement\(quiz, question, value\)/);
  assert.doesNotMatch(panel, />Delete<\/button>/);
  assert.doesNotMatch(panel, />\s*Delete measurement\s*<\/button>/);
});

test('source-backed hemodynamics transfer remains fail-closed', () => {
  assert.match(panel, /AR could not verify \$\{unverified\.map\(row => row\.label\)\.join\(', '\)\} for transfer/);
  assert.match(panel, /const unverified = quizEvidenceRows\.filter/);
});
