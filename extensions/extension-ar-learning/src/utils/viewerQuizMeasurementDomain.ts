/** Return the imaging domain from the configured viewer route, not tenant identity.
 * Quiz-authored domains and launch settings retain precedence over this fallback.
 */
export function getViewerQuizRouteMeasurementDomain(path: unknown): 'echo' | 'bowel' | '' {
  const route = String(path || '').trim().toLowerCase();
  if (/^\/rviewer(?:\/|$)/.test(route)) return 'echo';
  if (/^\/bviewer(?:\/|$)/.test(route)) return 'bowel';
  return '';
}
