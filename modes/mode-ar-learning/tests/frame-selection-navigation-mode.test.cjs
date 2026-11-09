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
  assert.match(panelSource, /Completed calipers are added automatically/);
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
