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

function normalizeMeasurementDomain(domain = '') {
  const value = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (value === 'iuscan') {
    return 'bowel';
  }

  if (value === 'nuclear' || value === 'nuccard') {
    return 'nuclear-cardiology';
  }

  return value;
}

export function getViewerMeasurementDomainFromPath() {
  const params = new URLSearchParams(window.location?.search || '');

  const integration = String(params.get('arIntegration') || '')
    .trim()
    .toLowerCase();

  if (integration === 'iuscan') {
    return 'bowel';
  }

  const urlDomain = normalizeMeasurementDomain(
    params.get('arMeasurementDomain') ||
      params.get('arViewerDomain') ||
      params.get('viewerDomain') ||
      ''
  );

  if (urlDomain) {
    return urlDomain;
  }

  const path = String(window.location?.pathname || '').toLowerCase();

  if (path.includes('/bviewer/iuscan')) {
    return 'bowel';
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
  const normalizedDomain = normalizeMeasurementDomain(domain);

  if (normalizedDomain === 'bowel') {
    return {
      id: 'bowelLengthMeasurementLabels',
      domain: 'bowel',
      dialogTitle: 'Bowel Annotation',
      annotationTitle: 'Bowel Annotation',
      labelOnMeasure: true,
      exclusive: true,
      items: BOWEL_MEASUREMENT_LABELS,
    };
  }

  if (normalizedDomain === 'echo') {
    return {
      id: 'echoLengthMeasurementLabels',
      domain: 'echo',
      dialogTitle: 'Echo Annotation',
      annotationTitle: 'Echo Annotation',
      labelOnMeasure: true,
      exclusive: true,
      items: ECHO_MEASUREMENT_LABELS,
    };
  }

  return null;
}
