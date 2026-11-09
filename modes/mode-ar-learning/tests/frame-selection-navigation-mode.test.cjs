const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'extensions', 'extension-ar-learning', 'src', 'panels', 'CaseQuestionsPanel.tsx'),
  'utf8'
);

test('only explicit frame-only questions guide learners to the correct instance', () => {
  assert.match(panelSource, /function shouldGuideFrameSelectionToInstance\(question: QuizQuestion\)/);
  assert.match(panelSource, /frameSelectionMode === 'frame_only'/);
  assert.match(panelSource, /shouldGuideFrameSelectionToInstance\(question\)\s*\? configuredFrameTarget\s*: null/);
});

test('instance-and-frame questions do not jump to the correct instance', () => {
  assert.match(panelSource, /revealExactFrame \|\| !viewerTarget/);
  assert.match(panelSource, /if \(!viewerTarget\)\s*\{/);
  assert.match(panelSource, /'Find the correct instance and frame in the study/);
});

test('guided frame-only navigation strips the reference frame', () => {
  const guide = panelSource.match(
    /function getQuestionSelectionViewerTarget\([\s\S]*?\n\}\n\nasync function runViewerCommand/
  )?.[0];
  assert.ok(guide, 'Missing frame-selection navigation filter');
  assert.match(guide, /sopInstanceUID:/);
  assert.doesNotMatch(guide, /^\s*frameNumber:/m);
  assert.doesNotMatch(guide, /^\s*frameIndex:/m);
  assert.doesNotMatch(guide, /^\s*imageIndex:/m);
});

test('learner bowel measurements bind automatically, without a second capture button', () => {
  assert.match(panelSource, /autoBowelLearnerCaptureQueueRef\.current\.then\(captureQueuedCaliper, captureQueuedCaliper\)/);
  assert.match(panelSource, /measurementId, silent: true/);
  assert.match(panelSource, /getBowelMeasurementSetEntries\(\s*plainObject\(latestLearnerAnswersRef/);
  assert.match(panelSource, /Bowel measurements: \{bowelEntries\.length\} \/ \{bowelCount\}/);
  assert.match(panelSource, /Caliper not recorded\. Check its label, frame and calibration\./);
  assert.doesNotMatch(panelSource, /Completed calipers are added automatically/);
  assert.match(panelSource, /!bowelSet \? <button/);
  assert.doesNotMatch(panelSource, /Add selected BWT caliper/);
});

test('learner cards display an explicit active question status', () => {
  assert.match(panelSource, /isActiveQuestion \? \(\s*<div[^>]*>[\s\S]*?Active Question/);
});

test('learner measurement domain prefers the authorized quiz before URL fallback', () => {
  const line = panelSource.indexOf('const quizMeasurementDomain = authoringMode');
  assert.ok(line >= 0);
  const portion = panelSource.slice(line, line + 700);
  assert.match(portion, /normalizeQuizMeasurementDomain\(quiz\?\.domain\)/);
  assert.match(portion, /normalizeQuizMeasurementDomain\(payload\?\.seriesDoc\?\.measurementDomain\)/);
  assert.ok(
    portion.indexOf('normalizeQuizMeasurementDomain(quiz?.domain)') <
      portion.indexOf('getQuizAuthoringMeasurementDomainFromUrl()')
  );
});


test('quiz Length completion remains retryable until the label is available', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const modeSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'index.tsx'), 'utf8'
  );
  const start = modeSource.indexOf('const handleCompletedViewerMeasurement = async');
  const end = modeSource.indexOf('const sweepCompletedViewerMeasurements = async', start);
  assert.ok(start >= 0 && end > start, 'missing completion processing path');
  const completion = modeSource.slice(start, end);
  const labelGate = completion.indexOf("quizMeasurementWorkflow && !String(completedMeasurement?.label || '').trim()");
  const handledMark = completion.indexOf('_handledCompletedAnnotationIds.add(id)');
  assert.ok(labelGate >= 0, 'capture must require a completed label');
  assert.ok(handledMark > labelGate, 'unlabelled calipers must not be permanently marked handled');
  assert.match(completion, /dispatchViewerQuizMeasurementAdded\(completedMeasurement\)/);
});

test('learner BWT capture retains the last failure cause and clears it on success', () => {
  assert.match(panelSource, /bowelCaptureFailureReasonRef\.current\[captureKey\] = reason/);
  assert.match(panelSource, /setBowelCaptureErrors\(current => \(\{/);
  assert.match(panelSource, /delete bowelCaptureFailureReasonRef\.current\[captureKey\]/);
  assert.match(panelSource, /aria-live="polite">Bowel measurements:/);
});
