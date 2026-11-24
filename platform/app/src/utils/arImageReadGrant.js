/**
 * AR-1107: per-window image read grants. This module deliberately does not
 * participate in iUSCAN external website launches (which retain their own
 * session-only bviewer authorization), ordinary clinical viewers or previews.
 * Grants never enter query strings, localStorage, cookies or global state.
 */
const DICOM_ID = /^[0-9]+(?:\.[0-9]+)+$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function parseArImageReadScope(href) {
  const url = new URL(href);
  const params = url.searchParams;
  if (url.pathname.startsWith('/bviewer/') ||
      params.get('arIntegration')?.toLowerCase() === 'iuscan') {
    return null;
  }

  const learnerId = (params.get('arLearnerSeriesId') || '').trim();
  const reviewKey = (params.get('arResearchReviewKey') || '').trim();
  if (!learnerId && !reviewKey) return null;

  const studyValues = params.getAll('StudyInstanceUIDs').filter(Boolean);
  const study = studyValues.length === 1 ? studyValues[0].trim() : '';
  if ((learnerId && reviewKey) || !DICOM_ID.test(study) || study.length > 64 ||
      (learnerId && !OBJECT_ID.test(learnerId)) ||
      (reviewKey && (reviewKey.length > 200 || !/^[a-z0-9-]+$/i.test(reviewKey)))) {
    throw new Error('ar_image_read_launch_invalid');
  }

  return {
    scope: learnerId ? 'educationAttempt' : 'researchReview',
    id: learnerId || reviewKey.toLowerCase(),
    studyInstanceUID: study,
  };
}

function isOrthancDataSource(source, viewerOrigin) {
  const conf = source?.configuration;
  if (!source?.namespace?.includes('dicomweb') || !conf) return false;
  const paths = [conf.qidoRoot, conf.wadoRoot];
  return paths.every(root => {
    if (typeof root !== 'string' || !root) return false;
    try {
      const url = new URL(root, viewerOrigin);
      return url.origin === viewerOrigin &&
        url.pathname.startsWith('/orthanc/dicom-web');
    } catch {
      return false;
    }
  });
}

/** Attach a function, not a token, to the verified same-origin Orthanc
 * datasource and frame loader. Never forward the grant to a CDN/other origin.
 */
export function attachArImageReadHeaders(config, getHeaders, origin) {
  if (!config || typeof config !== 'object') {
    throw new Error('ar_image_read_viewer_config_invalid');
  }
  const candidates = Array.isArray(config.dataSources) ? config.dataSources : [];
  const targets = candidates.filter(source => isOrthancDataSource(source, origin));
  if (targets.length > 1) {
    throw new Error('ar_image_read_secure_orthanc_source_ambiguous');
  }
  // Many AR production builds contain only CloudFront/localhost examples.
  // Never fall back to any of those for a protected reader. A protected
  // launch uses a single, hardcoded same-origin Orthanc DICOMweb source and
  // removes every other datasource from its own window. Ordinary /bviewer,
  // clinical and unprotected windows retain their original configurations.
  const trusted = {
    namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
    sourceName: 'dicomweb',
    configuration: {
      friendlyName: 'AR Protected Orthanc',
      name: 'ar-protected-orthanc',
      wadoUriRoot: origin + '/orthanc/wado',
      qidoRoot: origin + '/orthanc/dicom-web',
      wadoRoot: origin + '/orthanc/dicom-web',
      staticWado: false,
      qidoSupportsIncludeField: false,
      supportsReject: false,
      supportsFuzzyMatching: false,
      supportsWildcard: false,
      imageRendering: 'wadors',
      thumbnailRendering: 'wadors',
      enableStudyLazyLoad: true,
      singlepart: 'thumbnail,bulkdata',
      bulkDataURI: { enabled: true, relativeResolution: 'studies' },
      omitQuotationForMultipartRequest: true,
      acceptHeader: [
        'multipart/related; type=application/octet-stream; transfer-syntax=*',
      ],
      getAdditionalRequestHeaders: getHeaders,
    },
  };
  // Reuse only the verified Orthanc source's non-security rendering settings
  // when it already exists; never inherit a dynamic root/redirect/source ID.
  if (targets.length === 1 && targets[0]?.configuration?.singlepart) {
    trusted.configuration.singlepart = targets[0].configuration.singlepart;
  }
  config.dataSources = [trusted];
  config.defaultDataSourceName = 'dicomweb';
  config.showStudyList = false;
  config.getArImageReadHeaders = getHeaders;
  return config;
}

export function createArImageReadGrantSession({
  href,
  fetchImpl = fetch,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = timer => clearTimeout(timer),
} = {}) {
  const target = parseArImageReadScope(href);
  let activeToken = '';
  let expiresAt = 0;
  let refreshHandle = null;
  let disposed = false;
  let protectedStudy = false;

  function resetTimer() {
    if (refreshHandle !== null) cancel(refreshHandle);
    refreshHandle = null;
  }

  function getHeaders() {
    if (!protectedStudy || !activeToken ||
        expiresAt * 1000 <= now() + 3000 || disposed) return {};
    return { 'X-AR-Image-Grant': activeToken };
  }

  async function acquire() {
    if (!target || disposed) return false;
    const response = await fetchImpl('/formapi/api/imaging-read-access/grants', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(target),
    });

    if (!response.ok) throw new Error('ar_image_read_grant_request_denied');
    const value = await response.json();
    if (value?.protected === false) {
      protectedStudy = false;
      activeToken = '';
      expiresAt = 0;
      resetTimer();
      return false;
    }

    const expiry = Number(value?.expiresAt);
    if (value?.protected !== true ||
        typeof value.grant !== 'string' ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.grant) ||
        !Number.isSafeInteger(expiry) ||
        expiry * 1000 <= now() + 10000) {
      throw new Error('ar_image_read_grant_invalid_response');
    }

    activeToken = value.grant;
    expiresAt = expiry;
    protectedStudy = true;
    resetTimer();
    // Refresh before expiry. On failure, clear the token; FormAPI independently
    // rejects expired grants and no new pixel data will be fetched.
    const refreshMs = Math.max(1000, Math.min(2147483647,
      expiry * 1000 - now() - 60000));
    refreshHandle = schedule(() => acquire().catch(() => {
      activeToken = '';
      expiresAt = 0;
      resetTimer();
    }), refreshMs);
    return true;
  }

  return {
    target,
    getHeaders,
    initialize: async () => target ? acquire() : false,
    dispose: () => {
      disposed = true;
      resetTimer();
      activeToken = '';
      expiresAt = 0;
    },
  };
}
