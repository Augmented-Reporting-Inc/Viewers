import {
  getBowelStraightLengthLabelItems,
} from './bowelMeasurementTargets';

export const ECHO_MEASUREMENT_LABELS = [
  { value: 'LVIDd', label: 'LVIDd' },
  { value: 'LVIDs', label: 'LVIDs' },
  { value: 'IVSd', label: 'IVSd' },
  { value: 'PWd', label: 'PWd' },
  { value: 'AO', label: 'Aortic root' },
  { value: 'AscAo', label: 'Ascending aorta' },
  { value: 'LVOTDiam', label: 'LVOT diameter' },
  { value: 'LAd', label: 'Left atrial dimension' },
  { value: 'RVIDd', label: 'RVIDd' },
  { value: 'TAPSE', label: 'TAPSE' },
];

function getViewerUrlSearchParams() {
  const params = new URLSearchParams();

  if (typeof window === 'undefined') {
    return params;
  }

  try {
    const searchParams = new URLSearchParams(window.location?.search || '');
    searchParams.forEach((value, key) => params.set(key, value));
  } catch {}

  try {
    const hash = String(window.location?.hash || '');
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1).split('#')[0] : '';
    const hashParams = new URLSearchParams(hashQuery);

    hashParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
  } catch {}

  return params;
}

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


function getViewerTenantIdFromPath() {
  const params = getViewerUrlSearchParams();
  const integration = String(params.get('arIntegration') || '')
    .trim()
    .toLowerCase();
  const explicitTenant = String(
    params.get('arTenantId') || params.get('tenantId') || params.get('tenant') || ''
  )
    .trim()
    .toLowerCase();
  const path = typeof window === 'undefined' ? '' : String(window.location?.pathname || '').toLowerCase();

  if (integration === 'iuscan' || path.includes('/bviewer/iuscan')) {
    return 'iuscan';
  }

  return explicitTenant;
}

export function isIuscanBowelViewerContext() {
  if (typeof window === 'undefined') {
    return false;
  }

  const params = getViewerUrlSearchParams();
  const integration = String(params.get('arIntegration') || '')
    .trim()
    .toLowerCase();
  const explicitTenant = String(
    params.get('arTenantId') || params.get('tenantId') || params.get('tenant') || ''
  )
    .trim()
    .toLowerCase();
  const path = String(window.location?.pathname || '').toLowerCase();

  return integration === 'iuscan' || explicitTenant === 'iuscan' || path.includes('/bviewer/iuscan');
}

export function getViewerMeasurementDomainFromPath({ fallback = 'generic' } = {}) {
  const params = getViewerUrlSearchParams();

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

  if (
    path.includes('/rviewer') ||
    path.includes('/viewer') ||
    path.includes('/stressecho') ||
    path.includes('/dobutamine')
  ) {
    return 'echo';
  }

  return normalizeMeasurementDomain(fallback) || 'generic';
}

export function getMeasurementLabelConfigForDomain(domain) {
  const normalizedDomain = normalizeMeasurementDomain(domain);

  if (normalizedDomain === 'bowel') {
    const isIuscan = isIuscanBowelViewerContext();
    const tenantId = getViewerTenantIdFromPath();

    return {
      id: isIuscan ? 'bowelIuscanLengthMeasurementLabels' : 'bowelLengthMeasurementLabels',
      domain: 'bowel',
      dialogTitle: 'Bowel Annotation',
      annotationTitle: 'Bowel Annotation',
      labelOnMeasure: true,
      exclusive: true,
      items: getBowelStraightLengthLabelItems({ isIuscan, tenantId }),
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
