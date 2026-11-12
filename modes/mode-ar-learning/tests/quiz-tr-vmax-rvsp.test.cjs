const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..', '..');
const panel = fs.readFileSync(path.join(repoRoot,
  'extensions/extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'), 'utf8');
const commands = fs.readFileSync(path.join(repoRoot,
  'extensions/cornerstone/src/commandsModule.ts'), 'utf8');
const toolbar = fs.readFileSync(path.join(repoRoot,
  'modes/longitudinal/src/toolbarButtons.ts'), 'utf8');

test('TR Vmax quiz activation highlights the Vmax toolbar and starts spectral capture', () => {
  assert.match(commands, /'evaluate\.arQuizSpectralVmax': \['trVmax'\]/);
  assert.match(toolbar, /id: 'SpectralVmax',[\s\S]*?evaluate: \['evaluate\.action', 'evaluate\.arQuizSpectralVmax'\]/);
  assert.match(commands, /if \(measurementKind === 'trVmax'\)[\s\S]*?spectralVmax: true,[\s\S]*?preferredTargetKey: 'echo\.trPeakVelocity',[\s\S]*?quizCapture: true/);
  assert.match(panel, /'activateViewerQuizMeasurementTool'/);
});

test('manual Vmax toolbar stays spectral and selects the quiz TR target only in TR Vmax context', () => {
  assert.match(commands, /spectralVmax && activeQuizMeasurementKind === 'trVmax'/);
  assert.match(commands, /preferredTargetKey = 'echo\.trPeakVelocity';\s*quizCapture = true/);
  assert.match(commands, /startSpectralVmaxWorkflow:[\s\S]*?spectralVmax: true/);
});

test('completed calibrated, labelled TR Vmax emits exact measurement identity for quiz capture', () => {
  assert.match(commands, /quizCapture && spectralVmax &&\s*selectedTarget\?\.key === 'echo\.trPeakVelocity'/);
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
