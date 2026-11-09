const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'extensions', 'extension-ar-learning', 'src', 'panels', 'CaseQuestionsPanel.tsx'),
  'utf8'
);

test('legacy and explicit frame-only questions open the assigned instance without its frame', () => {
  assert.match(panelSource, /function shouldGuideFrameSelectionToInstance\(question: QuizQuestion\)/);
  assert.match(panelSource, /mode === '' \|\| mode === 'frame_only'/);
  assert.match(panelSource, /shouldGuideFrameSelectionToInstance\(question\)\s*\? configuredFrameTarget\s*: null/);
  assert.doesNotMatch(panelSource, /Mode: Legacy — viewer opens the assigned instance/);
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
  const start = panelSource.indexOf('function getLearnerQuizMeasurementDomain(');
  const end = panelSource.indexOf('function resolveQuizAuthoringMeasurementDomain(', start);
  assert.ok(start >= 0 && end > start);
  const portion = panelSource.slice(start, end);
  assert.match(portion, /normalizeQuizMeasurementDomain\(quiz\?\.domain\)/);
  assert.match(portion, /normalizeQuizMeasurementDomain\(source\?\.seriesDoc\?\.measurementDomain\)/);
  assert.ok(
    portion.indexOf('normalizeQuizMeasurementDomain(quiz?.domain)') <
      portion.indexOf('getQuizAuthoringMeasurementDomainFromUrl()')
  );
  assert.match(panelSource, /getQuizQuestionMeasurementDomain\(quiz, question, payload\)/);
  assert.match(panelSource, /isBowelMeasurementSetQuestion\(question\) \? 'bowel'/);
});


test('BWT learner panel shows each captured anatomical label and the required segment', () => {
  assert.match(panelSource, /Required anatomical label: \{requiredBowelLabel\}/);
  assert.match(panelSource, /formatBowelBwtMeasurementLabel\(measurement\.measurementType\)/);
  assert.match(panelSource, /formatBowelBwtMeasurementLabel\(bowelSettings\.measurementTarget\)/);
  assert.doesNotMatch(panelSource, /Mode: Find frame only/);
  assert.doesNotMatch(panelSource, /Mode: Find instance and frame/);
});

test('restored active learner question re-broadcasts the Bowel domain before labelling', () => {
  const start = panelSource.indexOf('// The highlighted question is restored from session storage on reopen.');
  const end = panelSource.indexOf('async function refreshScoringPayload()', start);
  const effect = panelSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(effect, /activeQuestionKey\.split\(':\'\)/);
  assert.match(effect, /getQuizQuestionMeasurementDomain\(quiz, question, payload\)/);
  assert.match(effect, /syncQuizMeasurementDomainToUrl\(domain, \{ overwrite: true \}\)/);
  assert.match(effect, /getLearnerQuizMeasurementDomain\(item, payload\)/);
  assert.match(effect, /if \(domains\.length === 1\) domain = domains\[0\]/);
  assert.match(effect, /\[activeQuestionKey, quizzes, payload, authoringMode, authoringMeasurementDomain, authoringQuestions\]/);

  const fs = require('node:fs');
  const path = require('node:path');
  const modeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.tsx'), 'utf8');
  const labelStart = modeSource.indexOf('async function getLabelConfigForMeasurement(');
  const labelEnd = modeSource.indexOf('async function waitForViewerMeasurementServiceEntry(', labelStart);
  const labelConfig = modeSource.slice(labelStart, labelEnd);
  assert.match(labelConfig, /normalizeQuizMeasurementDomain\(quizMeasurementDomain\) \|\|\s*getExplicitQuizMeasurementDomainFromUrl\(\)/);
  const resolution = labelConfig.slice(labelConfig.indexOf('const resolvedStudyDomain'),
    labelConfig.indexOf('const domain =', labelConfig.indexOf('const resolvedStudyDomain')));
  assert.doesNotMatch(resolution, /getViewerMeasurementDomainFromPath\(\)/,
    'a generic /rviewer/ location must never default a bowel quiz to Echo');
  assert.doesNotMatch(labelConfig, /resolveViewerMeasurementDomain\(commandsManager\)\)\s*:\s*await/,
    'quiz branches must not inherit unverified study labels');
});

test('learner quiz domain is retained in URL when the mode event was missed', () => {
  const vm = require('node:vm');
  const start = panelSource.indexOf('function syncQuizMeasurementDomainToUrl(');
  const end = panelSource.indexOf('function looksLikeInternalQuizLabel(', start);
  assert.ok(start >= 0 && end > start, 'quiz domain must have a shared URL synchronization helper');
  let url = 'https://example.test/rviewer/learning?arMeasurementDomain=echo';
  const dispatched = [];
  const runtime = {
    normalizeQuizMeasurementDomain: value => ['bowel', 'echo'].includes(value) ? value : '',
    dispatchQuizMeasurementDomain: value => dispatched.push(value),
    window: {
      location: { href: url },
      history: {
        state: null,
        replaceState(_state, _title, next) {
          url = next;
          runtime.window.location.href = next;
        },
      },
    },
    URL,
  };
  // This contract is TypeScript source; remove only its parameter types
  // when running the existing plain-JavaScript helper under node:vm.
  const syncSource = panelSource.slice(start, end).replace(
    /value: unknown,\s*\{ overwrite = false \}: \{ overwrite\?: boolean \} = \{\}/,
    'value, { overwrite = false } = {}'
  );
  const sync = vm.runInNewContext([
    syncSource,
    'syncQuizMeasurementDomainToUrl',
  ].join('\n'), runtime);
  sync('bowel', { overwrite: true });
  assert.equal(new URL(url).searchParams.get('arMeasurementDomain'), 'bowel',
    'the next Length label prompt should recover Bowel even if it missed the event');
  assert.deepEqual(dispatched, ['bowel']);
  sync('', { overwrite: true });
  assert.equal(new URL(url).searchParams.has('arMeasurementDomain'), false);
});

test('multi-BWT opens its complete saved learner annotation set, never the gold set', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'extensions', 'cornerstone', 'src', 'commandsModule.ts'),
    'utf8'
  );
  const start = source.indexOf('showViewerQuizLearnerBwtMeasurementSet: async');
  const end = source.indexOf('showViewerQuizLearnerMeasurement: async', start);
  assert.ok(start >= 0 && end > start, 'missing dedicated multi-BWT learner display command');
  const command = source.slice(start, end);
  assert.match(command, /findViewerQuizBowelLearnerAnnotation\(reference, learnerSeriesDoc\)/);
  assert.match(command, /viewerMeasurementsCreatedInSession\.has\(sourceId\)/);
  assert.doesNotMatch(command, /baseSeriesDoc/, 'never display source-study gold annotations');
  assert.match(command, /getFrameNumberForAnnotation\(saved\)/);
  assert.match(command, /actions\.showSavedViewerAnnotationsForSameImage\(/);
  assert.match(command, /renderedCount !== verified\.length/);
  assert.match(command, /getAnnotations\?\.\('Length', viewport\.element\)/);
  assert.match(command, /getGroupKey\?\.\(viewport\.element\)/);
  assert.match(command, /manager\.addAnnotation\(live, groupKey\)/);
  assert.match(command, /indexedCount !== verified\.length/);
  assert.match(source, /commandFn: actions\.showViewerQuizLearnerBwtMeasurementSet/);
  const selectStart = panelSource.indexOf('async function selectQuestion(');
  const selectEnd = panelSource.indexOf('async function captureCurrentFrameAnswer(', selectStart);
  const selection = panelSource.slice(selectStart, selectEnd);
  assert.match(selection, /getBowelMeasurementSetEntries\(plainObject\(questionAnswer\)\.measurements\)/);
  assert.match(selection, /showLearnerBowelMeasurements\(quiz, question, savedBowelMeasurements\)/);
  assert.match(panelSource, /data-quiz-review-action="learner"[\s\S]*?\>View<\/button\>/);
});

test('quiz measurement labels use restored specialty, never generic /rviewer/ Echo fallback', async () => {
  const vm = require('node:vm');
  const modeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.tsx'), 'utf8');
  const start = modeSource.indexOf('async function getLabelConfigForMeasurement(');
  const end = modeSource.indexOf('async function waitForViewerMeasurementServiceEntry(', start);
  assert.ok(start >= 0 && end > start);
  const getLabelConfig = vm.runInNewContext([
    'const isViewerQuizMeasurementCaptureMode = () => true;',
    'const normalizeQuizMeasurementDomain = v => ["bowel", "echo"].includes(v) ? v : "";',
    'const getExplicitQuizMeasurementDomainFromUrl = () => "";',
    'const resolveViewerMeasurementDomain = async () => "echo";',
    'const getViewerMeasurementDomainFromPath = () => "echo";',
    'const BOWEL_LENGTH_MEASUREMENT_LABELS_CONFIG = { id: "bowel" };',
    'const ECHO_LENGTH_MEASUREMENT_LABELS_CONFIG = { id: "echo" };',
    modeSource.slice(start, end),
    'getLabelConfigForMeasurement',
  ].join('\n'), { console });
  const bowel = await getLabelConfig({ toolName: 'Length' }, {}, {
    quizMeasurementDomain: 'bowel',
  });
  assert.equal(bowel.title, 'Set Bowel Measurement');
  assert.equal(bowel.labelConfigOverride.id, 'bowel');
  const missing = await getLabelConfig({ toolName: 'Length' }, {}, {});
  assert.equal(missing, null, 'a quiz without a verified domain cannot silently open an Echo label dialog');
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
  assert.match(completion, /source === 'cornerstone-annotation-completed' && !!sourceAnnotation/);
  assert.match(completion, /\(_suppressLabelPrompt && !freshDrawingCompleted\)/);
  assert.match(completion, /isHydratedSavedWorkflowAnnotation\(id, resolvedAnnotation\)/);
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


test('learner cross-sectional BWT displays a live estimated angle without gold centre data', () => {
  assert.match(panelSource, /getBowelMeasurementSetEstimatedRadialAngleDegrees\(bowelEntries\)/);
  assert.match(panelSource, /Estimated radial angle: \{estimatedRadialAngle\.toFixed\(1\)\}°/);
  assert.match(panelSource, /official scored angle uses the educator-defined lumen centre/);
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
  assert.doesNotMatch(panelSource, /Mode: Find frame only/);
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
