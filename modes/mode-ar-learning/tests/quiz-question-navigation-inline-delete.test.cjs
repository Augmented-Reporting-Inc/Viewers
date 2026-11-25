'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const panel = fs.readFileSync(
  path.resolve(__dirname, '../../../extensions/extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'),
  'utf8'
);

const sharedNavigation = fs.readFileSync(
  path.resolve(__dirname, '../../../extensions/extension-ar-measurements/src/components/SharedQuestionNavigation.tsx'),
  'utf8'
);
const learningQuestionPanel = fs.readFileSync(
  path.resolve(__dirname, '../../../extensions/extension-ar-learning/src/panels/LearningQuestionPanel.tsx'),
  'utf8'
);
const acquisitionControls = fs.readFileSync(
  path.resolve(__dirname, '../../../extensions/extension-ar-learning/src/components/LearningEchoAcquisitionControls.tsx'),
  'utf8'
);
const phaseStart = panel.indexOf('function renderCompositePhaseStatusAndDelete(');
const phaseEnd = panel.indexOf('function setAnswer(', phaseStart);
assert.ok(phaseStart >= 0 && phaseEnd > phaseStart);
const phaseAdapter = panel.slice(phaseStart, phaseEnd);
// The LAV parity refactor extracts the existing phase presentation. Verify
// the renderer actually mounted by the Education adapter, not a dead copy.
const usesSharedPhase = /<SharedEchoPhaseStatus\b/.test(phaseAdapter);
const phaseUI = usesSharedPhase ? acquisitionControls : phaseAdapter;

test('question stepping uses the existing selectQuestion workflow for both roles', () => {
  assert.match(panel, /function renderQuestionNavigation\(/);
  assert.match(panel, /void selectQuestion\(quiz, target\)/);
  assert.match(panel, /renderQuestionNavigation\(quiz, question, questions, quizSaving\)/);
  assert.doesNotMatch(panel, /renderQuestionNavigation\(quiz, question, questions, submitted \|\| quizSaving\)/);
  assert.match(panel, /authoringQuestions\.filter\(isViewerNativeQuestion\)/);
  assert.match(panel, /const navigatingDisabled = disabled \|\| !!capturingMeasurementKey/);
  assert.match(panel, /const navigatingDisabled = disabled \|\| !!capturingMeasurementKey \|\|\s*!!capturingFrameKey \|\| !!capturingPointKey \|\| !!capturingAuthoringKey/);
  assert.match(panel, /<SharedQuestionStepNavigation\s+previousKey=\{orderedQuestions\[index - 1\]\?\.questionKey \|\| ''\}\s+nextKey=\{orderedQuestions\[index \+ 1\]\?\.questionKey \|\| ''\}\s+disabled=\{navigatingDisabled\}/);
  assert.match(panel, /const target = orderedQuestions\.find\(item => item\.questionKey === questionKey\);\s*if \(target\) void selectQuestion\(quiz, target\)/);
  assert.match(learningQuestionPanel, /<SharedQuestionStepNavigation\s+previousKey=\{previousKey\}\s+nextKey=\{nextKey\}\s+disabled=\{disabled\}\s+onNavigate=\{onSelect\}/);
  assert.match(learningQuestionPanel, /const previousKey = index > 0 \? questions\[index - 1\]\.key : ''/);
  assert.match(learningQuestionPanel, /const nextKey = index >= 0 && index \+ 1 < questions\.length \? questions\[index \+ 1\]\.key : ''/);
  assert.match(sharedNavigation, /disabled=\{disabled \|\| !item\.key\}/);
  assert.match(sharedNavigation, /if \(item\.key\) onNavigate\(item\.key\)/);
  const learnerStart = panel.indexOf('<LearningQuestionPanel');
  assert.ok(learnerStart >= 0);
  const learner = panel.slice(learnerStart);
  assert.match(learner, /onSelect=\{key => \{\s*const question = questions\.find\(item => key ===[\s\S]*?if \(question\) void selectQuestion\(quiz, question\)/);
  assert.match(learner, /disabled=\{!!capturingMeasurementKey \|\| !!capturingFrameKey \|\|\s*!!capturingPointKey \|\| quizSaving\}/);
  assert.match(learner, /readOnly=\{questionLocked\}/);
});

test('measurement clear actions are inline, accessible, and retain source-aware deletions', () => {
  assert.match(phaseUI, /aria-label=\{`Delete \$\{slot\} measurement`\}/);
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
  if (usesSharedPhase) {
    assert.match(phaseUI, /export function SharedEchoPhaseStatus/);
    assert.match(phaseUI, /Jump to \$\{label\}\$\{hasSavedSource \? ' saved' : ''\} source/);
    assert.match(phaseAdapter, /hasSavedSource=\{savedNavigation\} onNavigate=\{onNavigate\}/);
    assert.match(phaseAdapter, /onDelete=\{\(getCompositePhaseMeasurementId\(live\) \|\| hasSaved\)/);
    assert.match(phaseUI, /if \(!disabled\) onDelete\(\)/);
  } else {
    assert.match(phaseUI, /Jump to \$\{label\} saved source/);
    assert.match(phaseUI, /Jump to \$\{label\} source/);
    assert.match(phaseUI, /disabled=\{disabled\}/);
  }
  assert.match(phaseAdapter, /viewerTarget: navigationTarget/);
  assert.match(phaseAdapter, /showViewerQuizLearnerCompositeMeasurement/);
  assert.match(phaseAdapter, /showViewerQuizMeasurementComparison/);
  assert.match(phaseAdapter, /deleteCompositePhaseMeasurement\(quiz, question, slot, phaseSource\)/);
  assert.match(phaseUI, /readOnly aria-label=/);
  assert.match(phaseUI, /aria-label=\{`Delete \$\{slot\} measurement`\}/);
  assert.match(panel, /renderPhaseStatus=\{\(slot, label\) =>\s*renderCompositePhaseStatusAndDelete\(quiz, question, slot, disabled,\s*kind === 'ivcCollapsibility'\s*\? slot === 'IVC_EXP' \? 'IVCexp' : 'IVCinsp'\s*: label\)/);
  for (const kind of ['laVolumeDisks', 'rvFac', 'ivcCollapsibility']) {
    assert.ok(panel.includes("return renderSharedEchoPhaseControls(quiz, question, disabled, '" + kind + "')"));
  }
  assert.match(acquisitionControls, /renderPhaseStatus\?\.\(phase\.slot, phase\.label\)/);
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
  const reviewPreviewStart = panel.indexOf('const learnerReviewPreview = {');
  const sourceRowsStart = panel.indexOf(
    'buildClinicalViewerAnnotationReviewRows(learnerReviewPreview)', reviewPreviewStart
  );
  assert.ok(reviewPreviewStart >= 0 && sourceRowsStart > reviewPreviewStart);
  const previewSource = panel.slice(reviewPreviewStart, sourceRowsStart);
  assert.ok(previewSource.includes('educationQuizHemodynamics,'));
  assert.ok(previewSource.includes("saveAction === 'draft' || !hasSavedQuizDraft"));
  assert.ok(previewSource.includes('reviewOnlyChangedAnnotationIds: undefined'));
  assert.ok(panel.indexOf('const unverified = quizEvidenceRows.filter(') < reviewPreviewStart,
    'learner hemodynamics must pass source verification before source review');
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
