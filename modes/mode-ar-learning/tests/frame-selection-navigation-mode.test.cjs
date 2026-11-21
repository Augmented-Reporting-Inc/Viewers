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
  // The current learner BWT flow automatically queues completed calipers;
  // no legacy standalone capture button is required or exposed.
  assert.doesNotMatch(panelSource, /Add selected BWT caliper/);
});

test('viewer authoring retains full quiz ordinals while skipping non-viewer questions', () => {
  const start = panelSource.indexOf('if (authoringMode) {', panelSource.indexOf('function renderAuthoringQuestion('));
  const end = panelSource.indexOf('const hasLearnerQuizContent', start);
  assert.ok(start > 0 && end > start, 'Missing viewer quiz authoring panel');
  const authoringPanel = panelSource.slice(start, end);
  assert.ok(authoringPanel.includes('authoringQuestions.map((question, index) =>'));
  assert.match(authoringPanel,
    /isViewerNativeQuestion\(question\) &&\s*activeQuestionKey === `authoring:\$\{question\.questionKey\}`\s*\? renderAuthoringQuestion\(question, index\) : null/
  );
  assert.ok(!authoringPanel.includes('authoringQuestions.filter(isViewerNativeQuestion).map'));
  assert.ok(panelSource.includes(
    '{index + 1}. {question.title || question.prompt || question.questionKey}'
  ));
  const questions = [true, true, false, true, false, true, true, true];
  const numbers = questions.flatMap((needsViewer, index) => needsViewer ? [index + 1] : []);
  assert.deepEqual(numbers, [1, 2, 4, 6, 7, 8]);
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
  assert.match(effect, /\[activeQuestionKey, quizzes, payload, authoringMode, authoringMeasurementDomain, authoringQuestions, commandsManager\]/);

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
  assert.match(command, /findViewerQuizLearnerOwnedAnnotation\(reference, learnerSeriesDoc\)/);
  const ownershipStart = source.indexOf('function findViewerQuizLearnerOwnedAnnotation(');
  const ownershipEnd = source.indexOf('function getViewerQuizMeasurementReferenceTarget(', ownershipStart);
  assert.ok(ownershipStart >= 0 && ownershipEnd > ownershipStart,
    'learner source lookup must keep an exact, learner-copy-only authorization boundary');
  const ownership = source.slice(ownershipStart, ownershipEnd);
  assert.match(ownership, /learnerSeriesDoc\?\.isLearnerCopy !== true/);
  assert.match(ownership, /getRequestedWorkflowAnnotations\(/);
  assert.match(ownership, /getMeasurementAnnotationId\(item\) === sourceId/);
  assert.match(command, /viewerMeasurementsCreatedInSession\.has\(sourceId\)/);
  assert.doesNotMatch(command, /baseSeriesDoc/, 'never display source-study gold annotations');
  assert.match(command, /getFrameNumberForAnnotation\(saved\)/);
  assert.match(command, /actions\.showSavedViewerAnnotationsForSameImage\(/);
  assert.match(command, /renderedCount !== verified\.length/);
  assert.match(command, /getAnnotations\?\.\('Length', viewport\.element\)/);
  assert.match(command, /getMeasurementAnnotationId\(item\) === annotationId/,
    'Cornerstone Length annotation IDs are annotationUID, not saved annotationId');
  assert.match(command, /getViewerQuizMeasurementSeriesDocs\(\{ includeBaseSeries: false \}\)/);
  assert.match(command, /trustedSpatialEvidence/);
  assert.match(command, /quizSpatialEvidence: evidence/);
  assert.match(panelSource, /restoreBowelMeasurementSetDisplayEvidence\(/);
  assert.match(panelSource, /setTrustedBowelSpatialByQuestion\(/);
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
  assert.match(completion, /const freshDrawingCompleted =\s*quizMeasurementWorkflow &&/);
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
  assert.match(commandsSource, /await waitForViewerQuizTargetImageMatch\(\s*viewport, target, attempts, resolveViewport, \{ requireExactSopFrame \}\s*\)/);
  assert.match(commandsSource, /cornerstoneViewportService\.getCornerstoneViewport\(targetViewportId\)/);
  assert.match(commandsSource, /const targetViewport = latestViewport \|\| viewport/);
  assert.match(commandsSource, /seriesDisplaySets\.find\(displaySet =>\s*displaySetContainsSavedAnnotation/);
  assert.match(commandsSource, /seriesDisplaySets\.length > 1\) return null/);
  assert.match(panelSource, /guided frame question missing learner navigation hint/);
  assert.match(panelSource, /frameNavigationErrors\[captureKey\]/);
  assert.match(panelSource, /shouldGuideFrameSelectionToInstance\(question\) && result\?\.ok !== true/);
});

test('measurement label wraps and longitudinal caliper spacing uses learner calibration', () => {
  assert.match(panelSource, /getBowelMeasurementSetMidpointSpacingMm\(bowelGeometryEntries\)/);
  assert.match(panelSource, /Caliper midpoint spacing:/);
  assert.match(panelSource, /whitespace-normal break-words text-xs text-gray-300/);
  assert.match(panelSource, /getLearnerBwtCaptureFailureMessage\(reason\)/);
});


test('learner cross-sectional BWT displays a live estimated angle without gold centre data', () => {
  assert.match(panelSource, /getBowelMeasurementSetEstimatedRadialAngleDegrees\(bowelGeometryEntries\)/);
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


test('single-slot EF redraw keeps the shared panel open for learners and educators', () => {
  const commands = fs.readFileSync(path.join(
    __dirname, '..', '..', '..', 'extensions', 'cornerstone', 'src', 'commandsModule.ts'
  ), 'utf8');
  const begin = commands.indexOf('if (nextSlot && singleSlot) {');
  const end = commands.indexOf('// End interactive drawing', begin);
  assert.ok(begin > 0 && end > begin, 'missing shared single-slot completion path');
  const completed = commands.slice(begin, end);
  assert.match(completed, /activeLVSimpsonWorkflowSessionId = ''/);
  assert.match(completed, /renderLVSimpsonWorkflowPanel\(/);
  assert.match(completed, /goldAuthoringEditable\s*\?/,
    'educator and learner receive their respective next-contour instructions');
  assert.doesNotMatch(completed, /clearLVSimpsonWorkflowIfCurrent\(/,
    'contour completion must not close the overall EF panel');
  assert.doesNotMatch(completed, /hideLVSimpsonWorkflowPanel\(\)/,
    'the panel stays mounted until explicitly closed by the user');
});

test('report quiz review lists source-backed measurements without synthetic report changes', () => {
  const measurementsPanel = fs.readFileSync(path.join(
    __dirname, '..', '..', '..', 'extensions',
    'extension-ar-measurements', 'src', 'panels', 'ARMeasurementsPanel.tsx'
  ), 'utf8');
  const start = measurementsPanel.indexOf('export function buildClinicalViewerAnnotationReviewRows(');
  const end = measurementsPanel.indexOf('const LEARNER_REPORT_FIELD_LABELS:', start);
  assert.ok(start > 0 && end > start, 'missing source-backed review builder');
  const source = measurementsPanel.slice(start, end)
    .replace('export function buildClinicalViewerAnnotationReviewRows(preview: any = {})',
      'function buildClinicalViewerAnnotationReviewRows(preview = {})')
    .replace('(measurement: any)', '(measurement)')
    .replaceAll('(id: any)', '(id)')
    .replace('new Set<string>()', 'new Set()');
  const vm = require('node:vm');
  const build = vm.runInNewContext(
    [source, 'buildClinicalViewerAnnotationReviewRows'].join('\n'),
    {
      getMeasurementValue: measurement => measurement.displayText?.[0] || '',
      calculateLVSimpsonContourVolumeForMeasurement: () => 46.2,
      LV_SIMPSON_SLOT_ORDER: ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'],
      formatMeasurementValue: (value, unit) => [value, unit].filter(Boolean).join(' '),
    }
  );
  const withId = (id, value) => ({
    annotationId: id, toolName: 'Length', measurementRole: 'LV dimension',
    workflow: 'viewerMeasurements', displayText: [value], frameNumber: 3,
  });
  const rows = build({ items: [], annotations: [
    withId('learner-a', '22 mm'), withId('learner-a', '22 mm'),
    { ...withId('gold', '25 mm'), workflow: 'viewerQuizGoldDisplay' },
    withId('learner-b', '26 mm'), { annotationId: 'no-tool' },
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual(Array.from(rows, row => row.key), ['learner-a', 'learner-b']);
  assert.deepEqual(Array.from(rows, row => row.value), ['22 mm', '26 mm']);
  const ef = build({ annotations: [
    { ...withId('ef-ed', '6.31 cm²'), measurementKind: 'lvSimpsonSlot',
      lvSimpson: { measurementKind: 'lvSimpsonSlot', slot: 'A4C_ED' } },
  ] });
  assert.equal(ef.length, 1);
  assert.equal(ef[0].label, 'LV A4C ED volume');
  assert.equal(ef[0].value, '46.20 mL');
  assert.doesNotMatch(ef[0].value, /cm²|mm²/,
    'never substitute contour area for EF contour volume');
  assert.match(measurementsPanel, /review\.educationWorkflow && annotationRows\.length > 0/);
  assert.match(panelSource, /const learnerReviewPreview = \\{\\s*\\.\\.\\.preview,\\s*educationQuizHemodynamics,[\\s\\S]*?const annotationRows = buildClinicalViewerAnnotationReviewRows\\(learnerReviewPreview\\)/,
    'learner review keeps source-linked hemodynamics across the conditional full-vs-changed preview');
  assert.match(panelSource, /saveAction === 'draft' \\|\\| !hasSavedQuizDraft[\\s\\S]*?reviewOnlyChangedAnnotationIds: undefined/,
    'first Save Draft must include all source measurements, not just changed annotations');
  assert.match(panelSource, /if \\(quizEvidenceRows.some\\(row => row.recorded\\) && preview.educationQuizHemodynamicsSupported !== true\\)/,
    'the AR hemodynamics capability gate must precede review presentation');
  assert.match(panelSource, /const unverified = quizEvidenceRows.filter\\(row => row.recorded &&/,
    'unverified source evidence must fail closed before review display');
  assert.match(panelSource, /rows, annotationRows, calculatedRows,/);
  assert.match(panelSource, /if \(!annotationRows\.length\)\s*\{\s*throw new Error/,
    'a truly empty annotation preview must fail rather than display a blank review');
});

test('learner quiz confirmation hides clinical review mechanics but keeps the same save path', () => {
  const measurementPanel = fs.readFileSync(path.join(
    __dirname, '..', '..', '..', 'extensions',
    'extension-ar-measurements', 'src', 'panels', 'ARMeasurementsPanel.tsx'
  ), 'utf8');
  const confirmationStart = measurementPanel.indexOf('function LearnerViewerMeasurementConfirmationModal(');
  const clinicalStart = measurementPanel.indexOf('export function ClinicalReportMeasurementReviewModal(', confirmationStart);
  assert.ok(confirmationStart > 0 && clinicalStart > confirmationStart,
    'learner confirmation and existing clinical report modal must both exist');
  const confirmation = measurementPanel.slice(confirmationStart, clinicalStart);
  assert.match(confirmation, /Review your measurements/);
  assert.match(confirmation, /Measured values \(/);
  assert.match(confirmation, /Calculated values \(/);
  assert.doesNotMatch(confirmation, /<details|<summary/,
    'measured and calculated results must always be visible');
  assert.match(confirmation, /onClick=\{onApply\}/);
  assert.doesNotMatch(confirmation, /selectedRowKeys|Select All|Apply Selected|Review AR report values/,
    'learner should not see clinical field selection or review preferences');
  const clinical = measurementPanel.slice(clinicalStart);
  assert.match(clinical, /review\.educationWorkflow === true/);
  assert.match(clinical, /<LearnerViewerMeasurementConfirmationModal/);
  assert.match(clinical, /selected\.size\} of \{rows\.length\} report value/,
    'original clinical report review must remain available for other workflows');
  assert.match(panelSource, /confirmReportOwnedMeasurementSave\(quiz, quizAnswers, status\)/);
  assert.match(panelSource, /educationWorkflow: true, saveAction/);
  assert.match(panelSource, /reportFieldNames: fields/,
    'learner confirmation must retain exactly the existing report-field save contract');
});

test('learner summary includes all server calculated values and verified EF biplane results', () => {
  const measurementPanel = fs.readFileSync(path.join(
    __dirname, '..', '..', '..', 'extensions',
    'extension-ar-measurements', 'src', 'panels', 'ARMeasurementsPanel.tsx'
  ), 'utf8');
  const start = measurementPanel.indexOf('const LEARNER_REPORT_FIELD_LABELS:');
  const end = measurementPanel.indexOf('function hasClinicalReportDerivedConsequences(', start);
  assert.ok(start > 0 && end > start, 'missing calculated learner review mapping');
  const source = measurementPanel.slice(start, end)
    .replace('const LEARNER_REPORT_FIELD_LABELS: Record<string, string>',
      'const LEARNER_REPORT_FIELD_LABELS')
    .replace('function formatLearnerIndexedUnit(unit: any)',
      'function formatLearnerIndexedUnit(unit)')
    .replace('export function buildLearnerCalculatedMeasurementReviewRows(preview: any = {})',
      'function buildLearnerCalculatedMeasurementReviewRows(preview = {})')
    .replace('const calculated: Array<{ key: string; label: string; value: string }> = [];',
      'const calculated = [];')
    .replaceAll('new Set<string>()', 'new Set()')
    .replaceAll('(id: any)', '(id)')
    .replace('const append = (field: string, label: string, value: any, uom: string = \u0027\u0027)',
      'const append = (field, label, value, uom = \u0027\u0027)')
    .replace('(name: string) =>', '(name) =>')
    .replace('const bySlot = new Map<string, any[]>();', 'const bySlot = new Map();')
    .replace('bySlot.get(slot)![0]', 'bySlot.get(slot)[0]');
  const vm = require('node:vm');
  const build = vm.runInNewContext(
    [source, 'buildLearnerCalculatedMeasurementReviewRows'].join('\n'),
    {
      buildClinicalViewerAnnotationReviewRows: () => [{ reportField: 'PWd' }],
      buildClinicalReportReviewRows: preview => preview.items.map(item => ({
        ...item, fieldNames: item.fields,
      })),
      formatClinicalReportFieldLabel: field => field,
      LV_SIMPSON_SLOT_ORDER: ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'],
      calculateLVSimpson: () => ({
        status: 'complete',
        values: { edvML: 112.23, esvML: 41.67,
          ejectionFraction: 62.87, strokeVolumeML: 70.56 },
      }),
    }
  );
  const preview = {
    annotations: ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'].map(slot => ({
      annotationId: slot, toolName: 'SplineROI',
      measurementKind: 'lvSimpsonSlot', lvSimpson: { slot },
    })),
    items: [
      { key: 'PWd', fields: ['PWd'], label: 'PWd', incomingValue: '10.1 mm' },
      { key: 'RWT', fields: ['RWT'], label: 'RWT', incomingValue: '0.29 ratio' },
      { key: 'LVMass', fields: ['LVMass'], label: 'LVMass', incomingValue: '324 g' },
      { key: 'lvSimpson', fields: ['EFSimpsons', 'LVEDV', 'LVESV'],
        label: 'LV EF', incomingValue: '62.9 %' },
    ],
    derivedConsequences: [
      { field: 'LVMassIndex', label: 'LV Mass Index', status: 'calculated',
        calculatedValue: '163', uom: 'g/m2' },
      { field: 'LVEDVx', label: 'Indexed LV EDV', status: 'calculated',
        calculatedValue: '56.3', uom: 'ml/m2' },
      { field: 'LVESVx', label: 'Indexed LV ESV', status: 'calculated',
        calculatedValue: '20.8', uom: 'ml/m2' },
    ],
  };
  const rows = build(preview);
  const byField = Object.fromEntries(rows.map(row => [row.key, row]));
  for (const field of ['RWT', 'LVMass', 'LVMassIndex',
    'LVEDVx', 'LVESVx', 'LVEDV', 'LVESV', 'EFSimpsons', 'SV']) {
    assert.ok(byField[field], `missing calculated result ${field}`);
  }
  assert.equal(byField.RWT.value, '0.29 ratio');
  assert.equal(byField.LVMass.value, '324 g');
  assert.equal(byField.LVMassIndex.value, '163 g/m²');
  assert.equal(byField.LVEDVx.value, '56.3 mL/m²');
  assert.equal(byField.LVESVx.value, '20.8 mL/m²');
  assert.equal(byField.LVEDV.value, '112.23 mL');
  assert.equal(byField.LVESV.value, '41.67 mL');
  assert.ok(!byField.PWd, 'raw PWd is already shown in measured values');
  assert.match(measurementPanel, /calculatedRows\.map/);
  assert.match(panelSource, /const calculatedRows = buildLearnerCalculatedMeasurementReviewRows\(learnerReviewPreview\)/);
});
