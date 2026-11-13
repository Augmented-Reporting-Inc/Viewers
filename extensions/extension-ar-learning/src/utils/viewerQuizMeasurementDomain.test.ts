import { getViewerQuizRouteMeasurementDomain } from './viewerQuizMeasurementDomain';

describe('viewer quiz domain fallback', () => {
  it('infers echo for the report viewer learning route without a tenant check', () => {
    expect(getViewerQuizRouteMeasurementDomain('/rviewer/learning')).toBe('echo');
    expect(getViewerQuizRouteMeasurementDomain('/rviewer')).toBe('echo');
  });
  it('preserves bowel viewer context', () => {
    expect(getViewerQuizRouteMeasurementDomain('/bviewer/iuscan')).toBe('bowel');
    expect(getViewerQuizRouteMeasurementDomain('/bviewer/learning')).toBe('bowel');
  });
  it('does not assign a domain to unrelated viewer paths', () => {
    expect(getViewerQuizRouteMeasurementDomain('/learning')).toBe('');
    expect(getViewerQuizRouteMeasurementDomain('/viewer/learning')).toBe('');
    expect(getViewerQuizRouteMeasurementDomain('')).toBe('');
  });
});
