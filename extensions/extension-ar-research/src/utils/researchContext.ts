import { buildFormApiFetchOptions, buildFormApiUrl } from './formApi';
import { normalizeReadSchema } from './readSchema';

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

export function getResearchViewerContext() {
  const params = getViewerSearchParams();
  const preview = ['1', 'true', 'yes'].includes(
    cleanString(params.get('arResearchPreview')).toLowerCase()
  );

  return {
    studyKey: cleanString(params.get('arResearchStudyKey')),
    reviewKey: cleanString(params.get('arResearchReviewKey')),
    imagingProfileKey: cleanString(
      params.get('arResearchImagingProfileKey')
    ).toLowerCase(),
    measurementAccess: cleanString(params.get('arMeasurementAccess')).toLowerCase(),
    preview,
  };
}

function resolveImagingProfile(protocol: any = {}, requestedProfileKey = '') {
  const profiles = Array.isArray(protocol?.imagingProfiles)
    ? protocol.imagingProfiles
    : [];
  const profileKey = cleanString(requestedProfileKey).toLowerCase();

  if (profileKey) {
    const matched = profiles.find(
      profile => cleanString(profile?.profileKey).toLowerCase() === profileKey
    );
    if (matched) return matched;
  }

  return profiles.length === 1 ? profiles[0] : null;
}

async function fetchJson(path: string, options: RequestInit = {}) {
  const response = await fetch(
    buildFormApiUrl(path),
    buildFormApiFetchOptions(options)
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error: any = new Error(
      payload?.message || `Research request failed: ${response.status}`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function loadResearchReadContext() {
  const viewer = getResearchViewerContext();
  if (!viewer.reviewKey && !viewer.studyKey) {
    throw new Error('Research viewer context is missing.');
  }

  const payload = viewer.reviewKey
    ? await fetchJson(`research/reviews/${encodeURIComponent(viewer.reviewKey)}`)
    : await fetchJson(`research/studies/${encodeURIComponent(viewer.studyKey)}`);

  const review = viewer.reviewKey ? payload : null;
  const study = viewer.reviewKey
    ? {
        studyKey: payload.studyKey,
        title: payload.studyTitle,
        protocol: payload.protocol,
      }
    : payload;
  const protocol = study?.protocol || {};
  const imagingProfile = resolveImagingProfile(
    protocol,
    review?.imagingProfileKey || viewer.imagingProfileKey
  );
  const readSchema = normalizeReadSchema(imagingProfile?.readSchema || {});
  const accessReadOnly = ['read', 'readonly'].includes(viewer.measurementAccess);
  const completed = cleanString(review?.status).toLowerCase() === 'completed';

  return {
    ...viewer,
    study,
    review,
    imagingProfile,
    readSchema,
    readOnly: viewer.preview || completed || accessReadOnly,
  };
}

export async function saveResearchReadReview({
  reviewKey,
  readResults,
  measurementAnnotations,
}: {
  reviewKey: string;
  readResults: any;
  measurementAnnotations?: any[];
}) {
  if (!reviewKey) {
    throw new Error('Research review key is missing from the viewer context.');
  }

  const body: any = { readResults };

  if (Array.isArray(measurementAnnotations)) {
    body.measurementAnnotations = measurementAnnotations;
  }

  return fetchJson(`research/reviews/${encodeURIComponent(reviewKey)}/results`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function completeResearchReadReview(reviewKey: string) {
  if (!reviewKey) {
    throw new Error('Research review key is missing from the viewer context.');
  }

  return fetchJson(`research/reviews/${encodeURIComponent(reviewKey)}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
