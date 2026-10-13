const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the pure policy functions from the actual learning-mode module
// without importing the full OHIF/Cornerstone browser runtime in Node.
const learningSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'index.tsx'),
  'utf8'
);
const longitudinalToolbarSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'longitudinal', 'src', 'toolbarButtons.ts'),
  'utf8'
);

function sourceDeclaration(name) {
  const marker = name.startsWith('function ') ? name : 'const ' + name;
  const start = learningSource.indexOf(marker);
  assert.notEqual(start, -1, 'Missing ' + marker);
  const end = learningSource.indexOf('\n}', start);
  if (name.startsWith('function ')) {
    assert.notEqual(end, -1, 'Missing function end for ' + marker);
    return learningSource.slice(start, end + 2);
  }
  const declarationEnd = learningSource.indexOf('];', start);
  assert.notEqual(declarationEnd, -1, 'Missing array end for ' + marker);
  return learningSource.slice(start, declarationEnd + 2);
}

const policySource = [
  sourceDeclaration('BASE_MEASUREMENT_TOOL_IDS'),
  sourceDeclaration('ECHO_ONLY_MEASUREMENT_TOOL_IDS'),
  sourceDeclaration('GENERIC_CONTOUR_TOOL_IDS'),
  sourceDeclaration('function getMeasurementToolIdsForDomain'),
  sourceDeclaration('function getEditablePrimaryToolbarIdsForDomain'),
].join('\n');

const policy = vm.runInNewContext(
  policySource + '\n({base: BASE_MEASUREMENT_TOOL_IDS,' +
    ' echoOnly: ECHO_ONLY_MEASUREMENT_TOOL_IDS,' +
    ' drawTools: getMeasurementToolIdsForDomain,' +
    ' primary: getEditablePrimaryToolbarIdsForDomain})',
  {}
);

test('learning Echo toolbar exposes every registered clinical Echo workflow', () => {
  const expected = [
    'LVSimpsonEF',
    'LAVolume',
    'SpectralDopplerVTI',
    'DecelerationTime',
    'UltrasoundDirectionalTool',
  ];
  assert.deepEqual(Array.from(policy.echoOnly), expected);
  const echoPrimary = Array.from(policy.primary('echo'));
  for (const id of expected) {
    assert.ok(echoPrimary.includes(id), 'Missing Echo button ' + id);
    assert.match(
      longitudinalToolbarSource,
      new RegExp("id:\\s*['\"]" + id + "['\"]"),
      'Unregistered Echo button ' + id
    );
  }
  assert.ok(!echoPrimary.includes('LVTraceSlot'));
});

test('bowel and generic learning toolbars exclude Echo specialty workflows', () => {
  for (const domain of ['generic', 'bowel']) {
    const primary = Array.from(policy.primary(domain));
    for (const id of Array.from(policy.echoOnly)) {
      assert.ok(!primary.includes(id), domain + ' must not receive ' + id);
    }
  }
  assert.ok(Array.from(policy.primary('bowel')).includes('BowelCurvedLength'));
});

test('drawing menu retains baseline tools without duplicating guided workflows', () => {
  const baseline = Array.from(policy.drawTools());
  for (const id of ['Length', 'LengthMeasureOnly', 'Bidirectional', 'EllipticalROI']) {
    assert.ok(baseline.includes(id), 'Missing baseline tool ' + id);
  }
  for (const id of Array.from(policy.echoOnly)) {
    assert.ok(!baseline.includes(id), id + ' belongs on primary toolbar');
  }
});

test('measurement read-only branch remains navigation-only', () => {
  const branch = learningSource.match(
    /if \(measurementToolsReadOnly\) \{[\s\S]*?\} else \{/
  )?.[0];
  assert.ok(branch, 'Missing read-only measurement branch');
  assert.match(branch, /Zoom/);
  assert.match(branch, /Pan/);
  assert.doesNotMatch(branch, /getEditablePrimaryToolbarIdsForDomain/);
  assert.doesNotMatch(branch, /ECHO_ONLY_MEASUREMENT_TOOL_IDS/);
});
