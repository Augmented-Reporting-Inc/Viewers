'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const panel = fs.readFileSync(
  path.resolve(__dirname, '../../../extensions/extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'),
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

const viewerCommands = fs.readFileSync(
  path.resolve(__dirname, '../../../extensions/cornerstone/src/commandsModule.ts'),
  'utf8'
);

test('TR toolbar preserves exact quiz spectral capture and clinical workflows', () => {
  assert.match(viewerCommands, /const quizTrVmax = activeQuizMeasurementKind === 'trVmax'/);
  assert.match(viewerCommands, /spectralVmax: quizTrVmax/);
  assert.match(viewerCommands, /preferredTargetKey: quizTrVmax \? 'echo\.trPeakVelocity' : ''/);
  assert.match(viewerCommands, /quizCapture: quizTrVmax/);
  assert.match(viewerCommands, /isReportOwnedLearnerMeasurementTarget\(getArViewerSaveTargetFromUrl\(\)\)/);
  assert.match(viewerCommands, /const isCurrentTrQuizCapture = spectralVmax &&/);
});

test('source-backed hemodynamics transfer remains fail-closed', () => {
  assert.match(panel, /AR could not verify \$\{unverified\.map\(row => row\.label\)\.join\(', '\)\} for transfer/);
  assert.match(panel, /const unverified = quizEvidenceRows\.filter/);
});

const review = fs.readFileSync(
  path.resolve(__dirname, '../../../extensions/extension-ar-measurements/src/panels/ARMeasurementsPanel.tsx'),
  'utf8'
);

test('EF-style LA, RV FAC and IVC rows have source links, value boxes and inline deletion', () => {
  assert.match(panel, /function renderCompositePhaseStatusAndDelete\(/);
  assert.match(panel, /Jump to \$\{label\} saved source/);
  assert.match(panel, /Jump to \$\{label\} source/);
  assert.match(panel, /viewerTarget: navigationTarget/);
  assert.match(panel, /readOnly aria-label=/);
  assert.match(panel, /aria-label=\{`Delete \$\{slot\} measurement`\}/);
  assert.match(panel, /renderCompositePhaseStatusAndDelete\(quiz, question, slot, disabled, label\)/);
  assert.doesNotMatch(panel, />View saved<\/button>/);
  assert.doesNotMatch(panel, /Review LA view selection and contour placement if possible/);
});

test('staged saves list only changed source annotations in learner confirmation', () => {
  assert.match(viewerCommands, /reviewOnlyChangedAnnotationIds: Array\.from\(changedClinicalMeasurementIds\)/);
  assert.match(review, /const changedIds = Array\.isArray\(preview\?\.reviewOnlyChangedAnnotationIds\)/);
  assert.match(review, /\(changedIds && !changedIds\.has\(id\)\)/);
  assert.match(review, /const efChangedInCurrentSave = !changedIds/);
  assert.match(review, /educationQuizHemodynamics\?\.trVmax\?\.sourceAnnotationId/);
});

test('RAP and TR Vmax are measured; RVSP and verified RV FAC are calculated', () => {
  assert.match(review, /'quiz-tr': 'TR Vmax', 'quiz-rap': 'RAP', 'quiz-rvsp': 'RVSP'/);
  assert.match(review, /const measuredQuizResults = quizResults\.filter/);
  assert.match(review, /const calculatedQuizResults = quizResults\.filter/);
  assert.match(review, /\['TRVEL', 'RASP', 'RVSP'\]\.includes\(field\.toUpperCase\(\)\)/);
  assert.match(review, /preview\?\.reviewOnlyRVFACPercent/);
  assert.match(viewerCommands, /calculateRVFACFromMeasurements\(verifiedRVSources/);
  assert.match(viewerCommands, /rvReviewResult\?\.status === 'complete'/);
});

test('learner TR preview deduplicates one annotation without dropping transfer evidence', () => {
  assert.match(panel, /const learnerReviewPreview = \\{\\s*\\.\\.\\.preview,\\s*educationQuizHemodynamics,/);
  assert.match(panel, /saveAction === 'draft' \\|\\| !hasSavedQuizDraft[\\s\\S]*?reviewOnlyChangedAnnotationIds: undefined/,
    'first Save Draft must include full learner measurement source review');
  assert.match(panel, /const unverified = quizEvidenceRows.filter\\(row => row.recorded &&/,
    'learner TR transfer must reject hemodynamics not confirmed by AR preview');
  assert.match(panel, /buildClinicalViewerAnnotationReviewRows\(learnerReviewPreview\)/);
  assert.match(panel, /buildLearnerCalculatedMeasurementReviewRows\(learnerReviewPreview\)/);
  assert.match(panel, /educationQuizHemodynamics: quizMeasurementReview\.educationQuizHemodynamics/);
  assert.match(review, /quizTRSourceId && id === quizTRSourceId/);
});

test('first learner save cannot claim success when its annotation snapshot is empty', () => {
  assert.match(viewerCommands, /\[AR Learner save trace\]/);
  assert.match(viewerCommands, /reportAnnotations\.length === 0/);
  assert.match(viewerCommands, /changedClinicalMeasurementIds\.size > 0/);
  assert.match(viewerCommands, /No learner measurement annotations reached the AR save payload/);
  assert.match(viewerCommands, /pending viewer measurements have been retained/);
});
