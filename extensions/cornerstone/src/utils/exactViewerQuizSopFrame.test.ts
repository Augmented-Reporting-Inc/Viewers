import { isExactViewerQuizSopFrameImageId } from './exactViewerQuizSopFrame';

describe('exact DICOM source-frame matching for guided viewer navigation', () => {
  const sop = '1.2.840.113619.2.55.3.1234';
  const image = (instance: string, frame: number) =>
    `wadors:https://pacs.example/studies/1/series/2/instances/${instance}/frames/${frame}`;

  it('accepts the exact SOP and one-based cine frame', () => {
    expect(isExactViewerQuizSopFrameImageId(image(sop, 12), sop, 12)).toBe(true);
    expect(isExactViewerQuizSopFrameImageId(image(sop, 12) + '?quality=1', sop, 12))
      .toBe(true);
  });
  it('rejects a different SOP or frame without ambiguous prefix matching', () => {
    expect(isExactViewerQuizSopFrameImageId(image(sop, 120), sop, 12)).toBe(false);
    expect(isExactViewerQuizSopFrameImageId(image(sop + '.1', 12), sop, 12)).toBe(false);
    expect(isExactViewerQuizSopFrameImageId(image(sop, 11), sop, 12)).toBe(false);
  });
  it('rejects invalid or missing image/frame identity', () => {
    expect(isExactViewerQuizSopFrameImageId('', sop, 12)).toBe(false);
    expect(isExactViewerQuizSopFrameImageId(image(sop, 12), sop, 0)).toBe(false);
    expect(isExactViewerQuizSopFrameImageId(image(sop, 12), '', 12)).toBe(false);
  });
});
