import { resolveViewerQuizGoldAreaBackfill } from './quizGoldAreaBackfill';

const source = (slot: string, frame: number) => ({
  slot, annotationId: 'annotation-' + slot,
  points: [[0, 0, 0], [2, 0, 0], [3, 1, 0], [2, 3, 0],
    [1, 3, 0], [0, 2, 0]],
  target: {
    studyInstanceUID: 'study', seriesInstanceUID: 'series',
    sopInstanceUID: 'sop-' + slot, frameNumber: frame,
    referencedImageId: 'wadors:studies/study/series/series/instances/sop-' +
      slot + '/frames/' + frame,
  },
});
const gold = (kind: string, methodId: string, components: any[], value: number) => ({
  measurementKind: kind, value, compositeResult: { methodId, components },
});

describe('validated per-phase gold area recovery from saved DICOM contours', () => {
  it('restores RVEDA/RVESA only if the saved FAC matches the calibrated areas', async () => {
    const rubric = gold('rvFAC', 'rv-fac-planimetry-v1',
      [source('RV_ED', 14), source('RV_ES', 17)], 20);
    let calls = 0;
    const calibration = async component => {
      calls += 1;
      return component.slot === 'RV_ED' ? 30 : 24;
    };
    const result = await resolveViewerQuizGoldAreaBackfill({
      kind: 'rvFAC', gold: rubric, calibrate: calibration,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.derived).toMatchObject({
      edaCM2: 30, esaCM2: 24, facPercent: 20,
    });
    expect(calls).toBe(2);
    expect(rubric.compositeResult).not.toHaveProperty('derived');
  });

  it('refuses to alter gold when the recovered areas disagree with saved FAC', async () => {
    const result = await resolveViewerQuizGoldAreaBackfill({
      kind: 'rvFAC', gold: gold('rvFAC', 'rv-fac-planimetry-v1',
        [source('RV_ED', 14), source('RV_ES', 17)], 19.71),
      calibrate: async component => component.slot === 'RV_ED' ? 30 : 24,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/FAC/);
  });

  it.each(['laVolumeBiplane', 'laVolumeBiplaneDisks'])(
    'independently restores calibrated A4C/A2C areas for %s without changing LAV', async kind => {
      const result = await resolveViewerQuizGoldAreaBackfill({
        kind, gold: gold(kind, kind === 'laVolumeBiplane'
          ? 'biplane-area-length-v1' : 'biplane-disks-v1',
        [source('A4C', 8), source('A2C', 22)], 68.59),
        calibrate: async component => component.slot === 'A4C' ? 18.5 : 14.2,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.derived).toEqual({
        a4cAreaCM2: 18.5, a2cAreaCM2: 14.2, volumeML: 68.59,
      });
    }
  );

  it('refuses unsupported sources, same-frame reuse, absent calibration and conflicts', async () => {
    const components = [source('RV_ED', 14), source('RV_ES', 17)];
    const base = gold('rvFAC', 'rv-fac-planimetry-v1', components, 20);
    const noSource = JSON.parse(JSON.stringify(base));
    noSource.compositeResult.components[0].target.referencedImageId = '';
    expect((await resolveViewerQuizGoldAreaBackfill({
      kind: 'rvFAC', gold: noSource, calibrate: async () => 10,
    })).ok).toBe(false);
    const duplicate = JSON.parse(JSON.stringify(base));
    duplicate.compositeResult.components[1].target = {
      ...duplicate.compositeResult.components[0].target,
    };
    expect((await resolveViewerQuizGoldAreaBackfill({
      kind: 'rvFAC', gold: duplicate, calibrate: async () => 10,
    })).ok).toBe(false);
    const unavailable = await resolveViewerQuizGoldAreaBackfill({
      kind: 'rvFAC', gold: base, calibrate: async () => null,
    });
    expect(unavailable.ok).toBe(false);
    const conflicting = gold('rvFAC', 'rv-fac-planimetry-v1',
      components, 20) as any;
    conflicting.compositeResult.derived = { edaCM2: 90 };
    expect((await resolveViewerQuizGoldAreaBackfill({
      kind: 'rvFAC', gold: conflicting,
      calibrate: async c => c.slot === 'RV_ED' ? 30 : 24,
    })).ok).toBe(false);
  });
});
