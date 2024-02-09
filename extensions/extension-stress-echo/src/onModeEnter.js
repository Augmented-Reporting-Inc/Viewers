export default function onModeEnter({ servicesManager }) {
  const { displaySetService } = servicesManager.services;
  const displaySetCache = displaySetService.getDisplaySetCache();

  const stressEchoDisplaySets = [...displaySetCache.values()].filter(ds => ds.isStress);

  stressEchoDisplaySets.forEach(ds => {
    // New mode route, allow SRs to be hydrated again
    ds.isHydrated = false;
  });
}
