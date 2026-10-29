import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('viewer quiz compact save contract', () => {
  const apiSource = readFileSync(join(__dirname, 'viewerQuizApi.ts'), 'utf8');
  const saveStart = apiSource.indexOf('export async function saveViewerQuizResponseForActiveStudy(');
  const saveEnd = apiSource.indexOf('export async function submitViewerQuizScoreForActiveStudy()', saveStart);
  const save = apiSource.slice(saveStart, saveEnd);

  it('requests a minimal response only for the viewer quiz PUT', () => {
    expect(saveStart).toBeGreaterThanOrEqual(0);
    expect(saveEnd).toBeGreaterThan(saveStart);
    expect(save).toContain("headers: { Prefer: 'return=minimal' }");
    expect(save).toContain("method: 'PUT'");
  });

  it('still sends all answers and retains learner attempt resolution', () => {
    expect(save).toContain('answers,');
    expect(save).toContain('resolveViewerSaveSeriesDoc()');
    expect(save).toContain('rememberArLearnerSeriesId(resolvedSeriesId)');
  });
});
