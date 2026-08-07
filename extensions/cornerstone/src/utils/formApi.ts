const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function extractJwtFromValue(value = '') {
  let rawValue = String(value || '').trim();

  if (!rawValue) {
    return '';
  }

  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    rawValue = rawValue.slice(1, -1).trim();
  }

  if (/^Bearer\s+/i.test(rawValue)) {
    rawValue = rawValue.replace(/^Bearer\s+/i, '').trim();
  }

  if (JWT_RE.test(rawValue)) {
    return rawValue;
  }

  const idTokenMatch = rawValue.match(/(?:^|[;\s])idToken=([^;\s]+)/i);
  if (idTokenMatch?.[1] && JWT_RE.test(idTokenMatch[1])) {
    return idTokenMatch[1];
  }

  const accessTokenMatch = rawValue.match(/(?:^|[;\s])accessToken=([^;\s]+)/i);
  if (accessTokenMatch?.[1] && JWT_RE.test(accessTokenMatch[1])) {
    return accessTokenMatch[1];
  }

  try {
    const parsed = JSON.parse(rawValue);
    const candidate =
      parsed?.idToken ||
      parsed?.accessToken ||
      parsed?.signInUserSession?.idToken?.jwtToken ||
      parsed?.signInUserSession?.accessToken?.jwtToken ||
      parsed?.tokens?.idToken?.toString?.() ||
      parsed?.tokens?.accessToken?.toString?.() ||
      parsed?.jwtToken ||
      '';

    if (candidate && JWT_RE.test(String(candidate).trim())) {
      return String(candidate).trim();
    }
  } catch {}

  const anyJwtMatch = rawValue.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (anyJwtMatch?.[0] && JWT_RE.test(anyJwtMatch[0])) {
    return anyJwtMatch[0];
  }
  return '';
}

function getStoredCognitoJwt() {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const explicitToken = extractJwtFromValue(
      window.localStorage?.getItem('AR_FORMAPI_BEARER_TOKEN') || ''
    );

    if (explicitToken) {
      return explicitToken;
    }
  } catch {}

  const storageCandidates = [window.localStorage, window.sessionStorage].filter(Boolean);
  const fallbackTokens = [];

  for (const storage of storageCandidates) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = String(storage.key(index) || '');
        const value = String(storage.getItem(key) || '').trim();

        const token = extractJwtFromValue(value);

        if (!token) {
          continue;
        }

        fallbackTokens.push({
          key,
          token,
          isIdToken: /\.idToken$/i.test(key) || /idToken/i.test(key),
          isAccessToken: /\.accessToken$/i.test(key) || /accessToken/i.test(key),
          isCognito: /CognitoIdentityServiceProvider|cognito|amplify|oidc/i.test(key),
        });
      }
    } catch {}
  }

  const preferred =
    fallbackTokens.find(candidate => candidate.isCognito && candidate.isIdToken) ||
    fallbackTokens.find(candidate => candidate.isIdToken) ||
    fallbackTokens.find(candidate => candidate.isCognito && candidate.isAccessToken) ||
    fallbackTokens[0];

  return preferred?.token || '';

  return '';
}

function isIuscanIntegrationViewer() {
  if (typeof window === 'undefined') {
    return false;
  }

  const params = new URLSearchParams(window.location?.search || '');
  return String(params.get('arIntegration') || '').toLowerCase() === 'iuscan';
}

export function getFormApiBase() {
  if (isIuscanIntegrationViewer()) {
    return '/formapi/api/integrations/iuscan/viewer';
  }

  const overrideBase = String(window.localStorage?.getItem('AR_FORMAPI_BASE') || '').trim();
  if (overrideBase) {
    return overrideBase.replace(/\/+$/, '');
  }

  const hostname = String(window.location?.hostname || '');

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return '/formapi/api';
  }

  return '/formapi/api';
}

export function buildFormApiUrl(path: string) {
  return `${getFormApiBase()}/${String(path).replace(/^\/+/, '')}`;
}

function isFormApiDebugEnabled() {
  try {
    return window.localStorage?.getItem('AR_FORM_API_DEBUG') === '1';
  } catch {
    return false;
  }
}

export function buildFormApiFetchOptions(options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  const token = getStoredCognitoJwt();

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (String(window.localStorage?.getItem('AR_FORMAPI_AUTH_DEBUG') || '') === '1') {
    if (isFormApiDebugEnabled()) {
      console.info('[formApi] fetch options', {
        hasToken: !!token,
        tokenParts: token ? token.split('.').length : 0,
        hasAuthorization: !!headers.Authorization,
        authorizationPrefix: String(headers.Authorization || '').slice(0, 12),
      });
    }
  }

  return {
    credentials: 'include',
    ...options,
    headers,
  };
}
