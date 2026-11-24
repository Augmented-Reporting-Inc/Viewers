// Local, opt-in performance diagnostic shared by Education and Research.
// No measurement values, coordinates, identifiers, URLs or user data.
export type EFOpenStage =
  | 'saved-source-fetch' | 'saved-source-restoration' | 'hydrate-attempt'
  | 'display-set-lookup' | 'viewport-setup' | 'viewport-ready'
  | 'frame-jump' | 'frame-ready' | 'settle-delay' | 'annotation-hydration'
  | 'display-registration' | 'viewport-render' | 'final-frame-check'
  | 'measurement-snapshot' | 'research-serialization' | 'research-binding'
  | 'research-saved-volumes' | 'research-live-volumes'
  | 'panel-render' | 'panel-volume' | 'viewport-volume' | 'review-calculation'
  | 'hydrate-A4C_ED' | 'hydrate-A4C_ES' | 'hydrate-A2C_ED' | 'hydrate-A2C_ES';

type Mode = 'assessment-owned' | 'education-or-clinical' | 'panel-only';
type Outcome = 'review-ready' | 'drawing-ready' | 'panel-only-ready' | 'returned' | 'superseded';
type Metric = { count: number; totalMs: number; maxMs: number };
type Restoration = { savedSlots: number; restoredSlots: number; pending: boolean };

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
const rounded = (value: number) => Math.round(value * 10) / 10;
const noop = () => {};
let active: ReturnType<typeof createEFOpenProfile> | null = null;

export function createEFOpenProfile(
  mode: Mode,
  clock: () => number = now,
  emit: (report: any) => void = report =>
    console.info('[AR EF open profile]', JSON.stringify(report))
) {
  const started = clock();
  const metrics: Partial<Record<EFOpenStage, Metric>> = {};
  let finished = false;
  let restoration: Restoration | undefined;
  return {
    begin(stage: EFOpenStage) {
      if (finished) return noop;
      const start = clock();
      let ended = false;
      return () => {
        if (finished || ended) return;
        ended = true;
        const elapsed = Math.max(0, clock() - start);
        const metric = metrics[stage] ||= { count: 0, totalMs: 0, maxMs: 0 };
        metric.count++;
        metric.totalMs += elapsed;
        metric.maxMs = Math.max(metric.maxMs, elapsed);
      };
    },
    setRestoration(summary: Restoration) {
      if (!finished) restoration = {
        savedSlots: summary.savedSlots,
        restoredSlots: summary.restoredSlots,
        pending: summary.pending,
      };
    },
    finish(outcome: Outcome) {
      if (finished) return;
      finished = true;
      emit({
        mode, outcome, totalMs: rounded(clock() - started),
        restoration,
        stages: Object.fromEntries(Object.entries(metrics).map(([key, metric]) =>
          [key, { count: metric.count, totalMs: rounded(metric.totalMs), maxMs: rounded(metric.maxMs) }]
        )),
      });
    },
  };
}

/** Enable using localStorage AR_EF_OPEN_PROFILE=1. No logs by default. */
export function startEFOpenProfile(mode: Mode) {
  try {
    if (typeof window === 'undefined' ||
      window.localStorage?.getItem('AR_EF_OPEN_PROFILE') !== '1') return null;
  } catch { return null; }
  active?.finish('superseded');
  const profile = createEFOpenProfile(mode);
  active = profile;
  return {
    setRestoration: profile.setRestoration,
    finish(outcome: Outcome) {
      if (active === profile) active = null;
      profile.finish(outcome);
    },
  };
}

export function beginEFOpenStage(stage: EFOpenStage) {
  return active?.begin(stage) || noop;
}

export function measureEFOpenStage<T>(stage: EFOpenStage, work: () => T): T {
  const end = beginEFOpenStage(stage);
  try { return work(); } finally { end(); }
}
