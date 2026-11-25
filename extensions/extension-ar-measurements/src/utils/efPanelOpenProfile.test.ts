import { beginEFOpenStage, createEFOpenProfile, measureEFOpenStage, startEFOpenProfile } from './efPanelOpenProfile';

describe('EF panel open profiling', () => {
  afterEach(() => {
    localStorage.removeItem('AR_EF_OPEN_PROFILE');
    jest.restoreAllMocks();
  });

  it('aggregates overlapping stage counts and duration without collecting source data', () => {
    let time = 0;
    const emit = jest.fn();
    const profile = createEFOpenProfile('assessment-owned', () => time, emit);
    const restore = profile.begin('saved-source-restoration');
    time = 10;
    const first = profile.begin('hydrate-A4C_ED');
    time = 35;
    first();
    first();
    const second = profile.begin('hydrate-A4C_ED');
    time = 45;
    second();
    time = 50;
    restore();
    profile.setRestoration({ savedSlots: 4, restoredSlots: 4, pending: false });
    profile.finish('review-ready');
    profile.finish('returned');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toEqual({
      mode: 'assessment-owned', outcome: 'review-ready', totalMs: 50,
      restoration: { savedSlots: 4, restoredSlots: 4, pending: false },
      stages: {
        'saved-source-restoration': { count: 1, totalMs: 50, maxMs: 50 },
        'hydrate-A4C_ED': { count: 2, totalMs: 35, maxMs: 25 },
      },
    });
  });

  it('is disabled by default and never changes the measured return value', () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    expect(startEFOpenProfile('education-or-clinical')).toBeNull();
    expect(measureEFOpenStage('panel-volume', () => 17)).toBe(17);
    expect(log).not.toHaveBeenCalled();
  });

  it('isolates successive opens and ignores spans completing after the old open', () => {
    localStorage.setItem('AR_EF_OPEN_PROFILE', '1');
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    const first = startEFOpenProfile('assessment-owned')!;
    const late = beginEFOpenStage('research-binding');
    const second = startEFOpenProfile('education-or-clinical')!;
    late();
    first.finish('returned');
    expect(measureEFOpenStage('panel-render', () => 42)).toBe(42);
    second.finish('review-ready');
    const reports = log.mock.calls.map(args => JSON.parse(args[1]));
    expect(reports).toHaveLength(2);
    expect(reports[0].outcome).toBe('superseded');
    expect(reports[1].mode).toBe('education-or-clinical');
    expect(reports[1].stages['research-binding']).toBeUndefined();
    expect(reports[1].stages['panel-render'].count).toBe(1);
  });
});
