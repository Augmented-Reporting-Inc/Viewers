const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const commands = fs.readFileSync(path.resolve(__dirname,'../../../extensions/cornerstone/src/commandsModule.ts'),'utf8');
const source = commands.match(/setViewerQuizMeasurementContext: (\([\s\S]*?)\n    },\n    activateViewerQuizMeasurementTool:/)[1] + '\n}';

test('switching EF to TR or IVC ends the old acquisition and mouse ownership before activation', () => {
  for (const measurementKind of ['trVmax','ivcCollapsibility','rvFAC']) {
    const ended = [];
    const context = {activeQuizMeasurementKind:'lvSimpsonEF',activeLVSimpsonWorkflowSessionId:'ef-session',
      activeLAVolumeWorkflowSessionId:'',clearEchoAreaWorkflowListeners:()=>ended.push('area'),
      clearUltrasoundDirectionalWorkflowListeners:()=>ended.push('directional'),
      clearLVSimpsonWorkflowIfCurrent:id=>ended.push(id),clearLAVolumeWorkflowIfCurrent:id=>ended.push(id),
      setQuizToolbarMeasurementKind:kind=>{context.activeQuizMeasurementKind=kind;}};
    const activate = vm.runInNewContext('(' + source + ')',context);
    const result = activate({measurementKind});
    assert.deepEqual(ended,['area','directional','ef-session']);
    assert.equal(result.measurementKind,measurementKind);
    ended.length = 0;
    activate({measurementKind});
    assert.deepEqual(ended,[], 'same-question phase actions must retain the active acquisition');
  }
});
