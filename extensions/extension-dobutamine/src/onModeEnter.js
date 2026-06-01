export default function onModeEnter({ servicesManager }) {
  const { displaySetService } = servicesManager.services;
  const displaySetCache = displaySetService.getDisplaySetCache();

  const dobutamineDisplaySets = [...displaySetCache.values()].filter(
    ds => ds.isDobutamine || ds.isStress
  );

  dobutamineDisplaySets.forEach(ds => {
    // New mode route, allow SRs to be hydrated again
    ds.isHydrated = false;
  });
}
