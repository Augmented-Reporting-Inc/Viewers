export function getFormApiBase() {
  const hostname = String(window.location?.hostname || '');

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'https://primebe.futurepacs.com/formapi/api';
  }

  return '/formapi/api';
}

export function buildFormApiUrl(path: string) {
  return `${getFormApiBase()}/${String(path).replace(/^\/+/, '')}`;
}
