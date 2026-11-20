const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const commands = fs.readFileSync(path.join(root, 'extensions', 'cornerstone', 'src', 'commandsModule.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'extensions', 'extension-ar-measurements', 'src', 'panels', 'ARMeasurementsPanel.tsx'), 'utf8');

test('learner EF review uses verified live single-view volumes, never a compacted preview recalculation as primary source', () => {
  assert.match(commands, /calculateLVSimpsonContourVolumeForMeasurement\(candidate\)/);
  // First save may precede MeasurementService's full calibrated geometry.
  // Only an exact-ID, exact-image session/native contour may supply the
  // display value; never manufacture a scalar from an uncalibrated preview.
  assert.match(commands, /lvSimpsonSessionMeasurementsByUid\.get\(measurementId\)/);
  assert.match(commands, /isSavedLVSimpsonImageMatch\(candidate/);
  assert.match(commands, /calculateLVSimpsonContourVolumeForAnnotationData\(native\)/);
  assert.match(commands, /reviewContourValuesById\.set\(measurementId,[\s\S]*?kind: 'lvSimpsonSlot'/);
  assert.match(commands, /reviewOnlySingleViewVolumeML: source\.value/);
  assert.match(panel, /Number\(measurement\.reviewOnlySingleViewVolumeML\)/);
  assert.match(panel, /volumeML\.toFixed\(2\)\} mL/);
});

test('review-only contour scalars never enter PUT MeasurementAnnotations or canonical saved annotations', () => {
  const previewStart = commands.indexOf('if (previewOnly) {', commands.indexOf('const reportAnnotations ='));
  const previewEnd = commands.indexOf('if (Array.isArray(reportFieldNames))', previewStart);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  const preview = commands.slice(previewStart, previewEnd);
  assert.match(preview, /MeasurementAnnotations: nextMeasurementAnnotations/);
  assert.match(preview, /annotations: reportAnnotations\.map\(annotation =>/);
  assert.match(preview, /reviewOnlySingleViewVolumeML/);
  assert.match(preview, /reviewOnlyLAContourAreaCM2/);
  assert.match(preview, /source\.referencedImageId !== String\(annotation\?\.referencedImageId \|\| ''\)/);
  assert.doesNotMatch(preview.slice(0, preview.indexOf('const previewResponse')), /reviewOnlySingleViewVolumeML|reviewOnlyLAContourAreaCM2/);
});

test('learner review distinguishes single LA contour area from calculated biplane LA volume', () => {
  assert.match(commands, /getVerifiedLAVolumeContourAreaCM2\(candidate\)/);
  assert.match(panel, /hasReviewedLAArea \? `\$\{reviewedLAAreaCM2\.toFixed\(2\)\} cm²`/);
  assert.match(panel, /hasReviewedLAArea \? `LA \$\{laSlot\.replace\('_', ' '\)\} area`/);
  assert.match(panel, /review\.calculatedRows/);
});

test('TR Vmax rechecks active quiz target at completion to avoid a restoration race dialog', () => {
  const start = commands.indexOf('ultrasoundDirectionalCompletionHandler = async');
  const end = commands.indexOf('eventTarget.addEventListener(', start);
  assert.ok(start > 0 && end > start);
  const completion = commands.slice(start, end);
  assert.match(completion, /const isCurrentTrQuizCapture = spectralVmax &&\s*\(quizCapture \|\| activeQuizMeasurementKind === 'trVmax'\)/);
  assert.match(completion, /const completionTargetKey = isCurrentTrQuizCapture\s*\? 'echo\.trPeakVelocity' : preferredTargetKey/);
  assert.match(completion, /if \(!completionTargetKey && Number\.isFinite\(rawValue\)/);
  assert.match(commands, /startSpectralVmaxWorkflow:\s*\{\s*commandFn: \(\) => actions\.startUltrasoundDirectionalWorkflow\(\{ spectralVmax: true \}\)/);
});
