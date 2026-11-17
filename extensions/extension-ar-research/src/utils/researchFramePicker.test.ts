import {
  getResearchFramePickerIntent,
  getResearchCapturedFrameTarget,
  RESEARCH_FRAME_CAPTURE_MESSAGE,
} from './researchFramePicker';

const session = '12345678-1234-4123-a123-123456789abc';
const search = new URLSearchParams({
  arResearchFramePickerSession: session,
  arResearchFramePickerParentOrigin: 'https://ar.futurepacs.com',
  arResearchFramePickerComponentKey: 'laVolumeDisks',
  arResearchFramePickerPhaseKey: 'A2C',
  arResearchFramePickerStudyInstanceUID: '1.2.840.113619.2',
}).toString();
const target = {
  studyInstanceUID: '1.2.840.113619.2',
  seriesInstanceUID: '1.2.840.113619.3',
  sopInstanceUID: '1.2.840.113619.4',
  referencedImageId: 'wadors:https://pacs/studies/1.2.840.113619.2/series/1.2.840.113619.3/instances/1.2.840.113619.4/frames/17',
  frameNumber: 17,
};

describe('Research Manager source-frame authoring', () => {
  it('accepts a platform-origin session tied to an exact case and phase', () => {
    expect(RESEARCH_FRAME_CAPTURE_MESSAGE).toBe('ar.research.frame-target-captured.v1');
    expect(getResearchFramePickerIntent('?' + search)).toEqual({
      session,
      parentOrigin: 'https://ar.futurepacs.com',
      componentKey: 'laVolumeDisks',
      phaseKey: 'A2C',
      studyInstanceUID: '1.2.840.113619.2',
    });
  });

  it('accepts a standard OHIF hash-router query without changing its case identity', () => {
    expect(getResearchFramePickerIntent('', '#/viewer?' + search)).toEqual(
      getResearchFramePickerIntent('?' + search)
    );
  });

  it('rejects untrusted origin, bad session and unrecognized DICOM study', () => {
    const original = new URLSearchParams(search);
    const evil = new URLSearchParams(search);
    evil.set('arResearchFramePickerParentOrigin', 'https://attacker.invalid');
    expect(getResearchFramePickerIntent('?' + evil)).toBeNull();
    original.set('arResearchFramePickerSession', 'user-controlled-token');
    expect(getResearchFramePickerIntent('?' + original)).toBeNull();
    const badStudy = new URLSearchParams(search);
    badStudy.set('arResearchFramePickerStudyInstanceUID', '../../study');
    expect(getResearchFramePickerIntent('?' + badStudy)).toBeNull();
  });

  it('uses authoritative active viewport frame and retains full navigation identity', () => {
    const intent = getResearchFramePickerIntent('?' + search);
    expect(getResearchCapturedFrameTarget({
      ok: true, answer: { selectedTarget: target },
    }, intent)).toEqual(target);
  });

  it('does not accept different study, blank image, unframed or failed viewport result', () => {
    const intent = getResearchFramePickerIntent('?' + search);
    const failures = [
      { ok: false, reason: 'viewport-not-found' },
      { ok: true, answer: { selectedTarget: { ...target, studyInstanceUID: '1.2.99' } } },
      { ok: true, answer: { selectedTarget: { ...target, frameNumber: 0 } } },
      { ok: true, answer: { selectedTarget: { ...target, referencedImageId: '' } } },
    ];
    for (const candidate of failures) {
      expect(() => getResearchCapturedFrameTarget(candidate, intent)).toThrow();
    }
  });
});
