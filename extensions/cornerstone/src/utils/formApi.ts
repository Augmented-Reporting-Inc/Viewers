function isIuscanIntegrationViewer() {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location?.search || '');
  return String(params.get('arIntegration') || '').toLowerCase() === 'iuscan';
}

export function getFormApiBase() {
  if (isIuscanIntegrationViewer()) {
    return '/formapi/api/integrations/iuscan/viewer';
  }

  const hostname = String(window.location?.hostname || '');

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'https://primebe.futurepacs.com/formapi/api';
  }

  return '/formapi/api';
}

export function buildFormApiUrl(path: string) {
  return `${getFormApiBase()}/${String(path).replace(/^\/+/, '')}`;
}
