import { resolveQuizGoldViewportImage } from './viewerQuizGoldImageReference';

const prefix = 'wadors:/studies/study-a/series/series-a/instances/sop-a/frames/';
const metadata = { StudyInstanceUID: 'study-a', SeriesInstanceUID: 'series-a', SOPInstanceUID: 'sop-a' };
const resolve = overrides => resolveQuizGoldViewportImage({
  savedImageId: prefix + '5',
  studyInstanceUID: 'study-a',
  seriesInstanceUID: 'series-a',
  sopInstanceUID: 'sop-a',
  frameNumber: 5,
  viewportImageIds: ['dicomweb:/studies/study-a/series/series-a/instances/sop-a/frames/5'],
  getInstanceMetadata: () => metadata,
  ...overrides,
});

describe('temporary quiz gold image resolution', () => {
  it('uses the registered viewport imageId, not the saved reference scheme', () => {
    expect(resolve({})).toMatchObject({
      ok: true,
      imageId: 'dicomweb:/studies/study-a/series/series-a/instances/sop-a/frames/5',
    });
  });
  it('preserves legacy frame conflicts when the saved URL is exact', () => {
    expect(resolve({ frameNumber: 4 })).toMatchObject({ ok: true, savedFrameConflict: true });
  });
  it('never uses a different frame or SOP from the same series', () => {
    expect(resolve({ viewportImageIds: [prefix + '6'] }).ok).toBe(false);
    expect(resolve({ viewportImageIds: [prefix.replace('sop-a', 'sop-b') + '5'] }).ok).toBe(false);
  });
  it('rejects a mismatched saved study rather than substituting the tenant asset identity', () => {
    expect(resolve({ studyInstanceUID: 'another-study' }).reason).toBe('saved-dicom-identity-conflict');
  });
  it('fails closed on missing or inconsistent Cornerstone instance metadata', () => {
    expect(resolve({ getInstanceMetadata: () => undefined }).reason)
      .toBe('image-instance-metadata-unavailable');
    expect(resolve({ getInstanceMetadata: () => ({ ...metadata, SOPInstanceUID: 'sop-b' }) }).ok)
      .toBe(false);
  });
  it('rejects ambiguous or incomplete saved DICOM identity', () => {
    expect(resolve({ savedImageId: 'wadors:/studies/study-a/series/series-a/instances/sop-a' }).ok).toBe(false);
  });
});
