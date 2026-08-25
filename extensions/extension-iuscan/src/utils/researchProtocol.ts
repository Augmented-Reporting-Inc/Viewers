import { buildFormApiFetchOptions, buildFormApiUrl } from './formApi';
import { LABEL_MAP, MEASUREMENT_GROUPS, SITES } from './labelMap';

const RESEARCH_PROTOCOL_EVENT = 'ar-research:protocol-updated';

const RESEARCH_SEGMENT_TO_IUSCAN_SITE = Object.freeze({
  sigmoid: 'sigmoidColon',
  descending: 'descendingColon',
  transverse: 'transverseColon',
  ascending: 'ascendingColon',
  terminalIleum: 'terminalIleum',
});

let activeResearchContext: any = null;
let activeResearchReview: any = null;
let activeLoadPromise: Promise<any> | null = null;
let activeLoadKey = '';

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function getViewerSearchParams() {
  const params = new URLSearchParams();

  try {
    const search = new URLSearchParams(window.location?.search || '');
    search.forEach((value, key) => params.set(key, value));
  } catch {}

  try {
    const hash = String(window.location?.hash || '');
    const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1).split('#')[0] : '';
    const hashParams = new URLSearchParams(query);
    hashParams.forEach((value, key) => {
      if (!params.has(key)) {
        params.set(key, value);
      }
    });
  } catch {}

  return params;
}

export function getResearchStudyKeyFromViewerUrl() {
  return cleanString(getViewerSearchParams().get('arResearchStudyKey'));
}

export function getResearchReviewKeyFromViewerUrl() {
  return cleanString(getViewerSearchParams().get('arResearchReviewKey'));
}

export function isResearchPreviewFromViewerUrl() {
  const value = cleanString(getViewerSearchParams().get('arResearchPreview')).toLowerCase();
  return ['1', 'true', 'yes'].includes(value);
}

function normalizeProtocol(study: any = {}, review: any = null) {
  const protocol = study?.protocol || {};
  const selectedSiteKeys = (Array.isArray(protocol.segmentKeys) ? protocol.segmentKeys : [])
    .map(segmentKey => RESEARCH_SEGMENT_TO_IUSCAN_SITE[segmentKey])
    .filter(Boolean);

  const components = (Array.isArray(protocol.components) ? protocol.components : [])
    .filter(component => cleanString(component?.componentKey))
    .map(component => ({
      ...component,
      componentKey: cleanString(component.componentKey),
      segmentKeys: Array.isArray(component.segmentKeys) ? component.segmentKeys : [],
      config: component?.config && typeof component.config === 'object' ? component.config : {},
    }));

  return {
    studyKey: cleanString(study?.studyKey),
    title: cleanString(study?.title) || 'Research Study',
    description: cleanString(study?.description),
    status: cleanString(study?.status),
    selectedSiteKeys,
    components,
    preview: isResearchPreviewFromViewerUrl(),
    reviewKey: cleanString(review?.reviewKey),
    reviewStatus: cleanString(review?.status),
    sourceStudyInstanceUID: cleanString(review?.sourceStudyInstanceUID),
    reviewerEmail: cleanString(review?.reviewerEmail),
  };
}

function dispatchResearchProtocolUpdated(context: any) {
  try {
    window.dispatchEvent(
      new CustomEvent(RESEARCH_PROTOCOL_EVENT, {
        detail: context,
      })
    );
  } catch {}
}

export function getActiveResearchContext() {
  return activeResearchContext;
}

export function getActiveResearchReview() {
  return activeResearchReview;
}

export function subscribeResearchContext(callback: (context: any) => void) {
  const handler = (event: any) => callback(event?.detail || activeResearchContext);
  window.addEventListener(RESEARCH_PROTOCOL_EVENT, handler);
  return () => window.removeEventListener(RESEARCH_PROTOCOL_EVENT, handler);
}

export async function loadResearchContextFromViewer() {
  const studyKey = getResearchStudyKeyFromViewerUrl();
  const reviewKey = getResearchReviewKeyFromViewerUrl();

  if (!studyKey && !reviewKey) {
    activeResearchContext = null;
    activeResearchReview = null;
    activeLoadPromise = null;
    activeLoadKey = '';
    dispatchResearchProtocolUpdated(null);
    return null;
  }

  const loadKey = reviewKey ? `review:${reviewKey}` : `study:${studyKey}`;

  if (activeLoadPromise && activeLoadKey === loadKey) {
    return activeLoadPromise;
  }

  activeLoadKey = loadKey;
  activeLoadPromise = (async () => {
    const endpoint = reviewKey
      ? `research/reviews/${encodeURIComponent(reviewKey)}`
      : `research/studies/${encodeURIComponent(studyKey)}`;
    const response = await fetch(
      buildFormApiUrl(endpoint),
      buildFormApiFetchOptions({ method: 'GET' })
    );

    if (!response.ok) {
      throw new Error(`Research protocol lookup failed: ${response.status}`);
    }

    const payload = await response.json();
    activeResearchReview = reviewKey ? payload : null;
    const study = reviewKey
      ? {
          studyKey: payload.studyKey,
          title: payload.studyTitle,
          status: payload.status,
          protocol: payload.protocol,
        }
      : payload;
    activeResearchContext = normalizeProtocol(study, reviewKey ? payload : null);
    dispatchResearchProtocolUpdated(activeResearchContext);
    return activeResearchContext;
  })();

  try {
    return await activeLoadPromise;
  } catch (error) {
    activeResearchReview = null;
    activeResearchContext = {
      studyKey,
      reviewKey,
      title: 'Research Study',
      selectedSiteKeys: [],
      components: [],
      preview: isResearchPreviewFromViewerUrl(),
      error: error?.message || String(error),
    };
    dispatchResearchProtocolUpdated(activeResearchContext);
    throw error;
  } finally {
    activeLoadPromise = null;
  }
}

export async function loadActiveResearchReviewFromViewer({ forceRefresh = false } = {}) {
  const reviewKey = getResearchReviewKeyFromViewerUrl();
  if (!reviewKey) return null;

  if (!forceRefresh && cleanString(activeResearchReview?.reviewKey) === reviewKey) {
    return activeResearchReview;
  }

  const response = await fetch(
    buildFormApiUrl(`research/reviews/${encodeURIComponent(reviewKey)}`),
    buildFormApiFetchOptions({ method: 'GET' })
  );

  if (!response.ok) {
    throw new Error(`Research review lookup failed: ${response.status}`);
  }

  activeResearchReview = await response.json();
  return activeResearchReview;
}

export async function saveActiveResearchReviewResults({
  measurementAnnotations = [],
  observationsBySite = {},
} = {}) {
  const reviewKey = getResearchReviewKeyFromViewerUrl();
  if (!reviewKey) {
    throw new Error('Research review key is missing from the viewer context.');
  }

  const response = await fetch(
    buildFormApiUrl(`research/reviews/${encodeURIComponent(reviewKey)}/results`),
    buildFormApiFetchOptions({
      method: 'PUT',
      body: JSON.stringify({ measurementAnnotations, observationsBySite }),
    })
  );

  if (!response.ok) {
    throw new Error(`Research review save failed: ${response.status}`);
  }

  activeResearchReview = await response.json();
  return activeResearchReview;
}

export function getResearchComponent(context: any, componentKey = '', siteKey = '') {
  if (!context || !componentKey) {
    return null;
  }

  return (
    context.components?.find(component => {
      if (component.componentKey !== componentKey) {
        return false;
      }

      const segmentKeys = Array.isArray(component.segmentKeys) ? component.segmentKeys : [];
      if (!segmentKeys.length || !siteKey) {
        return true;
      }

      const researchSegmentKey = Object.entries(RESEARCH_SEGMENT_TO_IUSCAN_SITE).find(
        ([, mappedSiteKey]) => mappedSiteKey === siteKey
      )?.[0];

      return !!researchSegmentKey && segmentKeys.includes(researchSegmentKey);
    }) || null
  );
}

export function researchComponentEnabled(context: any, componentKey = '', siteKey = '') {
  return !!getResearchComponent(context, componentKey, siteKey);
}

export function getResearchVisibleSites(context: any) {
  if (!context) {
    return SITES;
  }

  const selected = new Set(context.selectedSiteKeys || []);
  return SITES.filter(site => selected.has(site.key));
}

export function getResearchVisibleMeasurementGroups(context: any, siteKey = '') {
  if (!context) {
    return MEASUREMENT_GROUPS;
  }

  const paired = researchComponentEnabled(context, 'pairedBwtSubmucosa', siteKey);
  const bwt = paired || researchComponentEnabled(context, 'bwt', siteKey);
  const submucosa = paired || researchComponentEnabled(context, 'submucosa', siteKey);

  return MEASUREMENT_GROUPS.filter(group => {
    if (group.role === 'bwt') return bwt;
    if (group.role === 'submucosa') return submucosa;
    return false;
  });
}

export function getResearchMeasurementLabels(context: any) {
  if (!context) {
    return null;
  }

  const visibleSites = new Set(getResearchVisibleSites(context).map(site => site.key));
  const visibleStateKeysBySite = new Map(
    Array.from(visibleSites).map(siteKey => [
      siteKey,
      new Set(getResearchVisibleMeasurementGroups(context, siteKey).map(group => group.stateKey)),
    ])
  );

  return Object.entries(LABEL_MAP)
    .filter(([, mapping]: any) => {
      const siteKey = mapping?.site;
      const stateKey = mapping?.stateKey || mapping?.axis;
      return visibleSites.has(siteKey) && visibleStateKeysBySite.get(siteKey)?.has(stateKey);
    })
    .map(([value]) => {
      const mapping: any = LABEL_MAP[value];
      const site = SITES.find(item => item.key === mapping.site);
      const group = MEASUREMENT_GROUPS.find(item => item.stateKey === mapping.stateKey);
      return {
        value,
        label: `${site?.label || mapping.site} – ${group?.shortLabel || group?.label || value}`,
      };
    });
}

export function getResearchRepeatedSlotCount(context: any, siteKey = '', group: any = null) {
  if (!context || !group) {
    return 3;
  }

  if (researchComponentEnabled(context, 'pairedBwtSubmucosa', siteKey)) {
    return 2;
  }

  return 3;
}
