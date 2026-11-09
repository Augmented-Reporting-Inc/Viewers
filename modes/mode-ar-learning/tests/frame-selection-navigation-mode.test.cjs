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
  assert.match(panelSource, /getLearnerBwtCaptureFailureMessage\(reason\)/);
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


test('learner auto-capture also works when active question comes from saved session', () => {
  assert.match(panelSource, /lastActivated\s*\?\s*lastActivated !== activationKey\s*:\s*activeQuestionKey !== activationKey/);
  assert.match(panelSource, /const \[activeQuestionKey, setActiveQuestionKey\] = useState/);
  assert.match(panelSource, /initialSessionState\?\.activeQuestionKey/);
});


test('frame-only navigation re-resolves the display-set viewport and reports failure', () => {
  const commandsSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'extensions', 'cornerstone', 'src', 'commandsModule.ts'),
    'utf8'
  );
  assert.match(commandsSource, /await Promise\.resolve\(actions\.setDisplaySetsForViewports\(\{ viewportsToUpdate \}\)\)/);
  assert.match(commandsSource, /await waitForViewerQuizTargetImageMatch\(viewport, target, attempts, resolveViewport\)/);
  assert.match(commandsSource, /cornerstoneViewportService\.getCornerstoneViewport\(targetViewportId\)/);
  assert.match(commandsSource, /const targetViewport = latestViewport \|\| viewport/);
  assert.match(commandsSource, /seriesDisplaySets\.find\(displaySet =>\s*displaySetContainsSavedAnnotation/);
  assert.match(commandsSource, /seriesDisplaySets\.length > 1\) return null/);
  assert.match(panelSource, /guided frame question missing learner navigation hint/);
  assert.match(panelSource, /frameNavigationErrors\[captureKey\]/);
  assert.match(panelSource, /shouldGuideFrameSelectionToInstance\(question\) && result\?\.ok !== true/);
});

test('measurement label wraps and longitudinal caliper spacing uses learner calibration', () => {
  assert.match(panelSource, /getBowelMeasurementSetMidpointSpacingMm\(bowelEntries\)/);
  assert.match(panelSource, /Caliper midpoint spacing:/);
  assert.match(panelSource, /whitespace-normal break-words text-xs text-gray-300/);
  assert.match(panelSource, /getLearnerBwtCaptureFailureMessage\(reason\)/);
});


test('frame-only navigation selects a matching SOP display set rather than first-in-series', () => {
  const vm = require('node:vm');
  const commandsSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'extensions', 'cornerstone', 'src', 'commandsModule.ts'),
    'utf8'
  );
  const start = commandsSource.indexOf('function getDisplaySetForViewerQuizTarget(');
  const end = commandsSource.indexOf('function findImageIdIndexForViewerQuizTarget(', start);
  assert.ok(start >= 0 && end > start);
  const getter = vm.runInNewContext([
    'const displaySetContainsSavedAnnotation = (set, annotation) =>',
    '  (set.images || []).some(image => image.SOPInstanceUID === annotation.SOPInstanceUID);',
    commandsSource.slice(start, end),
    'getDisplaySetForViewerQuizTarget',
  ].join('\n'));
  const wrong = { displaySetInstanceUID: 'set-1', images: [{ SOPInstanceUID: 'other-sop' }] };
  const correct = { displaySetInstanceUID: 'set-2', images: [{ SOPInstanceUID: 'gold-sop' }] };
  const service = {
    getDisplaySetForSOPInstanceUID: () => null,
    getDisplaySetsForSeries: () => [wrong, correct],
  };
  const resolved = getter(service, { seriesInstanceId: 'series-a', sopInstanceId: 'gold-sop' });
  assert.equal(resolved.displaySetInstanceUID, 'set-2');
  service.getDisplaySetByUID = () => wrong;
  const staleHint = getter(service, {
    seriesInstanceId: 'series-a', sopInstanceId: 'gold-sop',
    displaySetInstanceId: 'set-1',
  });
  assert.equal(staleHint.displaySetInstanceUID, 'set-2',
    'a stale display-set hint must not override the authored SOP identity');
  assert.equal(getter(service, { seriesInstanceId: 'series-a', sopInstanceId: 'unknown' }), null);
});

test('instance-only target finds requested cine SOP without gold frame information', () => {
  const vm = require('node:vm');
  const commandsSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'extensions', 'cornerstone', 'src', 'commandsModule.ts'),
    'utf8'
  );
  const start = commandsSource.indexOf('function findImageIdIndexForViewerQuizTarget(');
  const end = commandsSource.indexOf('async function waitForViewerQuizTargetImageMatch(', start);
  assert.ok(start >= 0 && end > start);
  const getMatch = vm.runInNewContext([
    'const getViewportImageIds = viewport => viewport.getImageIds();',
    'const normalizeImageIdForCompare = imageId => String(imageId || "").toLowerCase().replace(/^wadors:/, "");',
    commandsSource.slice(start, end),
    'findImageIdIndexForViewerQuizTarget',
  ].join('\n'));
  const viewport = { getImageIds: () => [
    'wadors:/studies/study-a/series/series-a/instances/other-sop/frames/1',
    'wadors:/studies/study-a/series/series-a/instances/gold-sop/frames/1',
    'wadors:/studies/study-a/series/series-a/instances/gold-sop/frames/18',
  ] };
  const target = {
    sopInstanceId: 'gold-sop', referencedImageId: '',
    frameNumber: null, imageIndex: null,
  };
  const match = getMatch(viewport, target);
  assert.equal(match.index, 1, 'opens the requested SOP at its first available frame');
  assert.equal(match.source, 'sop', 'the gold frame must not select the starting image');
});


test('async instance navigation refreshes a replaced viewport before matching', async () => {
  const vm = require('node:vm');
  const commandsSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'extensions', 'cornerstone', 'src', 'commandsModule.ts'),
    'utf8'
  );
  const start = commandsSource.indexOf('async function waitForViewerQuizTargetImageMatch(');
  const end = commandsSource.indexOf('async function jumpViewportToViewerQuizTargetImage(', start);
  assert.ok(start >= 0 && end > start);
  const waitForMatch = vm.runInNewContext([
    'const sleep = async () => {};',
    'const findImageIdIndexForViewerQuizTarget = viewport => viewport.hasSop',
    '  ? { index: 2, imageId: "requested-sop", imageIds: ["other", "another", "requested-sop"], source: "sop" }',
    '  : { index: -1, imageId: "", imageIds: ["other"], source: "not-found" };',
    commandsSource.slice(start, end),
    'waitForViewerQuizTargetImageMatch',
  ].join('\n'));
  const originalViewport = { hasSop: false };
  const currentViewport = { hasSop: true };
  let resolves = 0;
  const match = await waitForMatch(originalViewport, {}, 3, () => {
    resolves += 1;
    return resolves >= 2 ? currentViewport : originalViewport;
  });
  assert.equal(match.index, 2);
  assert.equal(match.viewport, currentViewport);
  assert.ok(resolves >= 2);
});


test('Show your answer explicitly opens the learner-selected exact frame', () => {
  const start = panelSource.indexOf('function renderQuestionReview(');
  const end = panelSource.indexOf('function renderAuthoringQuestion(', start);
  const review = panelSource.slice(start, end > start ? end : undefined);
  const showYourAnswer = review.slice(review.indexOf('Show your answer') - 800, review.indexOf('Show your answer'));
  assert.match(showYourAnswer, /viewerTarget: learnerTarget/);
  assert.match(showYourAnswer, /revealExactFrame: question\.type === 'frameSelection'/);
  assert.match(panelSource, /frame-selection configuration/);
  assert.match(panelSource, /Mode: Find frame only/);
});

test('multiple-BWT post-score review shows each gold length and scoring rules', () => {
  assert.match(panelSource, /bowelReference\.goldMeasurements/);
  assert.match(panelSource, /Correct reference lengths/);
  assert.match(panelSource, /numeric tolerance:/i);
  assert.match(panelSource, /current rubric does not require/);
  assert.match(panelSource, /reviewDetails\.spatial\.observed/);
});


test('review buttons cannot re-trigger question-open navigation on focus', () => {
  assert.match(panelSource, /data-quiz-review-action="learner"/);
  assert.match(panelSource, /data-quiz-review-action="correct"/);
  assert.match(panelSource, /closest\?\.\('\[data-quiz-review-action\]'\)/);
  assert.match(panelSource, /revealExactFrame: question\.type === 'frameSelection'/);
});
