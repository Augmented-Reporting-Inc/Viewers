const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const commands = fs.readFileSync(path.resolve(__dirname,
  '../../../extensions/cornerstone/src/commandsModule.ts'), 'utf8');

test('guided EF pauses cine and verifies exact DICOM image on every protocol navigation', () => {
  const start = commands.indexOf('startLVSimpsonEFWorkflow: async');
  const end = commands.indexOf('startLVSimpsonEFWorkflow: {', start);
  assert.ok(start >= 0 && end > start);
  const workflow = commands.slice(start, end);
  const jumps = [
    /jumpToViewerQuizTarget\(\{\s*viewerTarget: initialTarget,\s*questionKey,\s*pauseCineOnTarget: true,\s*requireExactSopFrame: true/,
    /jumpToViewerQuizTarget\(\{\s*viewerTarget: target, questionKey,\s*pauseCineOnTarget: true,\s*requireExactSopFrame: true/,
    /jumpToViewerQuizTarget\(\{\s*viewerTarget: nextTarget,\s*questionKey,\s*pauseCineOnTarget: true,\s*requireExactSopFrame: true/,
  ];
  for (const pattern of jumps) assert.match(workflow, pattern);
  assert.match(workflow, /if \(!panelOnly\) stopSourceCineForViewport\(activeViewportId\)/);
  assert.match(workflow, /didNavigateToExactEFContourFrame\(navigation,/);
});

test('shared target navigation pauses playback without activating another measurement tool', () => {
  assert.match(commands, /jumpToViewerQuizTarget: async \(\{[\s\S]*?pauseCineOnTarget = false/);
  assert.match(commands, /if \(pauseCineOnTarget\) stopSourceCineForViewport\(targetViewportId\)/);
  assert.match(commands, /cineService\.setCine\(\{\s*id: viewportId,[\s\S]*?isPlaying: false/);
});
