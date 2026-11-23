import {
  getResearchViewerQuestionMeasurementKind,
  setViewerQuestionMeasurementContext,
} from './viewerQuestionMeasurementContext';

describe('shared Research/Education question toolbar contract', () => {
  test.each([
    ['lvEjectionFraction', 'lvSimpsonEF'],
    ['laVolumeDisks', 'laVolumeBiplaneDisks'],
    ['laVolume', 'laVolumeBiplane'],
    ['rvFac', 'rvFAC'],
    ['ivcCollapsibility', 'ivcCollapsibility'],
    ['trVmax', 'trVmax'],
    ['imageQuality', ''],
    ['readerComment', ''],
  ])('%s resolves to the Education measurement kind %s', (componentKey, expected) => {
    expect(getResearchViewerQuestionMeasurementKind({ componentKey }, 'echo'))
      .toBe(expected);
  });

  test('no Echo tool context is assigned to unrelated modality questions', () => {
    expect(getResearchViewerQuestionMeasurementKind(
      { componentKey: 'lvEjectionFraction' }, 'bowel'
    )).toBe('');
  });

  test('uses the same OHIF command Education uses without invoking capture or save', async () => {
    const runCommand = jest.fn(async () => ({ ok: true }));
    await setViewerQuestionMeasurementContext({ runCommand }, 'lvSimpsonEF');
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('setViewerQuizMeasurementContext', {
      measurementKind: 'lvSimpsonEF',
    });
  });

  test('clears stale toolbar context for observation questions', async () => {
    const run = jest.fn(async () => ({ ok: true }));
    await setViewerQuestionMeasurementContext({ run }, '');
    expect(run).toHaveBeenCalledWith('setViewerQuizMeasurementContext', {
      measurementKind: '',
    });
  });

  test('does not throw without an OHIF commandsManager', async () => {
    await expect(setViewerQuestionMeasurementContext(null, 'lvSimpsonEF'))
      .resolves.toBeNull();
  });
});
