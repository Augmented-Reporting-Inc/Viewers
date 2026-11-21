const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..', '..');
const panel = fs.readFileSync(path.join(repoRoot,
  'extensions/extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'), 'utf8');
const commands = fs.readFileSync(path.join(repoRoot,
  'extensions/cornerstone/src/commandsModule.ts'), 'utf8');
const reviewModal = fs.readFileSync(path.join(repoRoot,
  'extensions/extension-ar-measurements/src/panels/ARMeasurementsPanel.tsx'), 'utf8');

const toolbar = fs.readFileSync(path.join(repoRoot,
  'modes/longitudinal/src/toolbarButtons.ts'), 'utf8');

test('TR Vmax quiz activation highlights the Vmax toolbar and starts spectral capture', () => {
  assert.match(commands, /'evaluate\.arQuizSpectralVmax': \['trVmax'\]/);
  assert.match(toolbar, /id: 'SpectralVmax',[\s\S]*?evaluate: \['evaluate\.action', 'evaluate\.arQuizSpectralVmax'\]/);
  assert.match(commands, /if \(measurementKind === 'trVmax'\)[\s\S]*?spectralVmax: true,[\s\S]*?preferredTargetKey: 'echo\.trPeakVelocity',[\s\S]*?quizCapture: true/);
  assert.match(panel, /'activateViewerQuizMeasurementTool'/);
});

test('toolbar selection preserves the active learner TR Vmax context for spectral acquisition', () => {
  const start = commands.indexOf('setToolActiveToolbar: (');
  const end = commands.indexOf('setViewerLengthLabelMode:', start);
  assert.ok(start >= 0 && end > start, 'expected toolbar action');
  const toolbarAction = commands.slice(start, end);
  assert.match(toolbarAction, /if \(activeQuizMeasurementKind !== 'trVmax'\) \{\s*setQuizToolbarMeasurementKind\(''\);/,
    'only the TR quiz keeps its selected target; other workflows must still clear toolbar context');
  assert.match(commands, /spectralVmax && activeQuizMeasurementKind === 'trVmax'/);
});

test('learner TR answer uses the same Cornerstone-native source as the report preview', () => {
  const start = commands.indexOf('getSelectedViewerMeasurementQuizAnswer:');
  const source = commands.indexOf('const nativeTRAnnotation =', start);
  const end = commands.indexOf("const measurement = requestedKind === 'trVmax'", source);
  assert.ok(start >= 0 && source > start && end > source, 'expected TR quiz capture source');
  const capture = commands.slice(source, end);
  assert.match(capture, /cornerstoneTools\.annotation\.state\.getAnnotation\?\.\(selectedMeasurementId\)/);
  assert.match(capture,
    /requestedKind === 'trVmax'[\s\S]*?getCornerstoneUltrasoundDirectionalMeasurementFallback\(nativeTRAnnotation\)/);
  assert.match(commands,
    /getCornerstoneUltrasoundDirectionalMeasurementFallbacks\(\{[\s\S]*?studyInstanceUID: snapshotStudyInstanceId/);
  assert.match(commands,
    /const measurement = requestedKind === 'trVmax'\s*\? restoredSpectralMeasurement\s*: restoredSpectralMeasurement \|\| directMeasurement/,
    'never silently accept an OHIF-only TR source that the native report preview cannot verify');
});

test('manual Vmax toolbar stays spectral and selects the quiz TR target only in TR Vmax context', () => {
  assert.match(commands, /spectralVmax && activeQuizMeasurementKind === 'trVmax'/);
  assert.match(commands, /preferredTargetKey = 'echo\.trPeakVelocity';\s*quizCapture = true/);
  assert.match(commands, /startSpectralVmaxWorkflow:[\s\S]*?spectralVmax: true/);
});

test('completed calibrated, labelled TR Vmax emits exact measurement identity for quiz capture', () => {
  assert.match(commands, /const isCurrentTrQuizCapture = spectralVmax &&\s*\(quizCapture \|\| activeQuizMeasurementKind === 'trVmax'\)/);
  assert.match(commands, /isCurrentTrQuizCapture && spectralVmax &&\s*selectedTarget\?\.key === 'echo\.trPeakVelocity'/);
  assert.match(commands, /convertedReportValue\?\.unit === 'm\/s'/);
  assert.match(commands, /window\.dispatchEvent\(new CustomEvent\('ar-learning:quiz-measurement-added', \{\s*detail: \{ measurementId: annotationId \}/);
  assert.match(panel, /captureAuthoringMeasurement\(question, \{\s*measurementId,\s*silent: true/);
  assert.match(panel, /window\.addEventListener\(AR_QUIZ_MEASUREMENT_ADDED_EVENT, handleQuizMeasurementAdded\)/);
});

test('educator IVC gold links earlier validated TR and preserves the IVC score scalar', () => {
  assert.match(panel, /function renderAuthoringIVCRapRVSPReference/);
  assert.match(panel, /goldMeasurement: accepted\.answer,[\s\S]*?goldValue: accepted\.answer\.value/);
  assert.match(panel, /'ivcCollapsibility'\s*\? renderAuthoringIVCRapRVSPReference/);
  assert.match(panel, /attachRapRvspEvidenceToIVCAnswer\(/);
  assert.match(panel, /trVmaxQuestionKey: priorTR\?\.questionKey/);
});

test('reviewing a valid saved TR Vmax does not auto-start a new spectral drawing session', () => {
  assert.match(panel, /const reviewSavedTR = authoringMode && measurementKind === 'trVmax'/);
  assert.match(panel, /existingTRGold\.sourceAnnotationId/);
  assert.match(panel, /targetHasNavigationIdentity\(existingTRGold\.viewerTarget\)/);
  assert.match(panel, /!isGuidedQuizCompositeKind\(measurementKind\) && !reviewSavedTR/);
  assert.match(commands, /startSpectralVmaxWorkflow:[\s\S]*?startUltrasoundDirectionalWorkflow\(\{ spectralVmax: true \}\)/);
});
test('EF gold keeps exact frame identity when InstanceNumber is missing', () => {
  assert.match(panel, /const sop = cleanString\(target\?\.sopInstanceUID \|\| target\?\.SOPInstanceUID\)/);
  assert.match(panel, /'SOP ' \+ sop\.slice\(-12\)/);
  assert.doesNotMatch(panel, /return 'Instance unavailable';/);
});
test('EF gold summary no longer repeats the calculated answer or gold scalar', () => {
  assert.match(panel, /Saved biplane measurements/);
  assert.match(panel, /Saved biplane EDV:/);
  assert.match(panel, /\{renderCompositeCalculatedStatus\(quiz, question\)\}/);
  assert.doesNotMatch(panel, /<div className="border-t border-gray-700 pt-2 text-xs text-emerald-100">\s*Saved result:/);
});

test('learner retries the exact calibrated TR Vmax annotation before IVC RVSP linking', () => {
  assert.match(panel, /const kind = cleanString\(plainObject\(question\.answerConfig\)\.measurementKind\);\s*if \(kind === 'trVmax'\)/);
  assert.match(panel, /autoSpectralLearnerCaptureInFlightRef\.current\.has\(captureId\)/);
  assert.match(panel, /\[100, 350, 900, 1800, 3200\]/);
  assert.match(panel, /captureSelectedMeasurementAnswer\(quiz, question, \{\s*measurementId, silent: true/);
  assert.match(panel, /lastActivatedQuestionRef\.current !== key/);
  assert.match(panel, /TR Vmax not recorded/);
  assert.match(panel, /Saved learner TR Vmax:/);
  assert.match(panel, /Available for IVC \/ RVSP calculation/);
  assert.match(panel, /targetHasNavigationIdentity\(value\?\.viewerTarget\)/);
  assert.match(panel, /'ivcCollapsibility'\)\s*\{[\s\S]*?setAnswer\(quiz\.quizKey, question/);
});

test('learner TR Vmax uses only a calibrated annotation, never a typed scalar or gold', () => {
  assert.match(panel, /cleanString\(plainObject\(question\.answerConfig\)\.measurementKind\) === 'trVmax'\s*\? null :/);
  assert.match(panel, /Complete a calibrated TR spectral peak measurement/);
  assert.match(panel, /priorTR\.questionKey/);
  assert.match(panel, /trAnswer\?\.sourceAnnotationId/);
  assert.match(commands, /directional\?\.acquisitionMode === 'spectralVmax'/);
  assert.match(commands, /directional\?\.reportUnit === 'm\/s'/);
});

test('learner TR/RAP/RVSP transfer survives simplified submission confirmation', () => {
  assert.match(panel, /function getLearnerHemodynamicQuizReviewRows\(/);
  assert.match(panel, /confirmReportOwnedMeasurementSave\(quiz, quizAnswers, status\)/);
  assert.ok(panel.includes('quizEvidenceRows: quizEvidenceRowsForReview,'),
    'review retains the separately filtered hemodynamic source rows');
  assert.ok(panel.includes('const quizEvidenceRowsForReview = hasSavedQuizDraft'),
    'repeated review must distinguish updated evidence from the full first draft');
  assert.ok(panel.includes('getUpdatedLearnerHemodynamicReviewRows({'));
  const transferVerification = panel.indexOf('const unverified = quizEvidenceRows.filter(');
  const redundantReviewShortcut = panel.indexOf(
    'if (shouldSkipUnchangedLearnerSubmitMeasurementReview({',
  );
  assert.ok(transferVerification >= 0 && redundantReviewShortcut > transferVerification,
    'source transfer must be verified before skipping an unchanged Submit dialog');
  assert.match(panel, /educationQuizHemodynamics, educationWorkflow: true, saveAction/);
  assert.match(panel, /educationQuizHemodynamics: quizMeasurementReview\.educationQuizHemodynamics/);
  assert.match(panel, /reportFieldNames: fields/,
    'the prior AR learner-report transfer selection remains the save contract');
  assert.match(reviewModal, /function LearnerViewerMeasurementConfirmationModal/);
  assert.match(reviewModal, /review\.educationWorkflow === true/);
  assert.match(reviewModal, /used in your practice report where applicable/);
  assert.match(reviewModal, /review\.quizEvidenceRows\.map/,
    'the detailed hemodynamic review is preserved for clinical workflows');
});

test('quiz save refuses incomplete TR and verifies AR server readback before success', () => {
  assert.match(panel, /autoSpectralLearnerCaptureInFlightRef\.current/);
  assert.match(panel, /getLearnerHemodynamicReadbackError\(/);
  assert.match(panel, /result\?\.response\?\.answers/);
  assert.match(panel, /if \(evidenceError\) throw new Error\(evidenceError\)/);
  assert.match(panel, /getLearnerCompositePersistenceSources\(/);
});

test('EF progress panel omits redundant active-question capture sentence', () => {
  assert.doesNotMatch(commands, /Cross-check EF = \(EDV - ESV\)/);
});

test('TR Vmax quiz clinical mapping is opt-in through existing report review only', () => {
  assert.match(commands, /const allowReportOwnedQuizTR = isCurrentTrQuizCapture && spectralVmax &&/);
  assert.match(commands, /selectedTarget\?\.key === 'echo\.trPeakVelocity'/);
  assert.match(commands, /isReportOwnedLearnerMeasurementTarget\(saveTarget\)/);
  assert.match(commands, /isClinicalReportMeasurementsSaveTarget\(saveTarget\)/);
  assert.match(commands, /\(!quizCapture \|\| allowReportOwnedQuizTR\)/);
  assert.match(panel, /saveViewerMeasurementsForActiveStudy/);
  assert.match(panel, /reportFieldNames: fields/);
});
