export const ECHO_MEASUREMENT_LABELS = [
  { value: 'LVIDd', label: 'LVIDd' },
  { value: 'LVIDs', label: 'LVIDs' },
  { value: 'IVSd', label: 'IVSd' },
  { value: 'PWd', label: 'PWd' },
  { value: 'AO', label: 'AO' },
  { value: 'LVOTDIAM', label: 'LVOT diameter' },
  { value: 'RVIDd', label: 'RVIDd' },
  { value: 'TAPSE', label: 'TAPSE' },
];

export const BOWEL_MEASUREMENT_LABELS = [
  { value: 'BowelRectumBWT', label: 'Rectum BWT' },
  { value: 'BowelSigmoidColonBWT', label: 'Sigmoid colon BWT' },
  { value: 'BowelDescendingColonBWT', label: 'Descending colon BWT' },
  { value: 'BowelTransverseColonBWT', label: 'Transverse colon BWT' },
  { value: 'BowelAscendingColonBWT', label: 'Ascending colon BWT' },
  { value: 'BowelCecumBWT', label: 'Cecum BWT' },
  { value: 'BowelTerminalIleumBWT', label: 'Terminal ileum BWT' },
  { value: 'BowelIleocolicAnastomosisBWT', label: 'Ileocolic anastomosis BWT' },
  { value: 'BowelNeoTerminalIleumBWT', label: 'Neo-terminal ileum BWT' },
  { value: 'BowelProximalIleumBWT', label: 'Proximal ileum BWT' },
];

export function getViewerMeasurementDomainFromPath() {
  const path = String(window.location?.pathname || '').toLowerCase();

  if (path.includes('/bviewer/iuscan')) {
    return 'iuscan';
  }

  if (path.includes('/bviewer')) {
    return 'bowel';
  }

  if (path.includes('/rviewer') || path.includes('/stressecho') || path.includes('/dobutamine')) {
    return 'echo';
  }

  return 'generic';
}

export function getMeasurementLabelConfigForDomain(domain) {
  if (domain === 'bowel') {
    return {
      labelOnMeasure: true,
      exclusive: true,
      items: BOWEL_MEASUREMENT_LABELS,
    };
  }

  if (domain === 'echo') {
    return {
      labelOnMeasure: true,
      exclusive: true,
      items: ECHO_MEASUREMENT_LABELS,
    };
  }

  return null;
}
