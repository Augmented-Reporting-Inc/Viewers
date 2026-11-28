import {
  getResearchFramePickerIntent,
  getResearchCapturedFrameTarget,
  getResearchAuthoringFrameSelection,
  getResearchAuthoringFrameTarget,
  navigateResearchAuthoringFrame,
  sendResearchAuthoringFrame,
  RESEARCH_FRAME_CAPTURE_ACK,
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
    expect(RESEARCH_FRAME_CAPTURE_MESSAGE).toBe('ar.research.frame-target-captured.v2');
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

describe('active question frame authoring', () => {
  const scalar = (componentKey: string) => ({ key: componentKey + '|', componentKey,
    kind: 'measurement', config: {viewerTarget: target} });
  it('switches from LVIDd to aortic root and restores each independent staged target', () => {
    const lvidd = scalar('lvidd'), root = scalar('aorticRoot');
    const a = getResearchAuthoringFrameSelection(lvidd)!;
    const b = getResearchAuthoringFrameSelection(root)!;
    const staged = {[a.key]: {...target, frameNumber: 7}, [b.key]: {...target, frameNumber: 11}};
    expect(a.componentKey).toBe('lvidd');
    expect(b.componentKey).toBe('aorticRoot');
    expect(a.key).not.toBe(b.key);
    expect(getResearchAuthoringFrameTarget(lvidd, '', staged).frameNumber).toBe(7);
    expect(getResearchAuthoringFrameTarget(root, '', staged).frameNumber).toBe(11);
    expect(getResearchAuthoringFrameSelection({...root,kind:'categorical'})).toBeNull();
    expect(getResearchAuthoringFrameSelection({...root,segmentKey:'segment'})).toBeNull();
  });
  it('changes composite phases with the selected question, not the launch intent', () => {
    const la = {...scalar('laVolumeDisks'), config: {compositeFrameTargets: {A2C:target}}};
    expect(getResearchAuthoringFrameSelection(la, 'RV_ED')?.phaseKey).toBe('A4C');
    expect(getResearchAuthoringFrameSelection(la, 'A2C')?.phaseKey).toBe('A2C');
    expect(getResearchAuthoringFrameTarget(la, 'A2C', {})).toEqual(target);
    expect(getResearchAuthoringFrameTarget(la, 'RV_ED', {})).toBeNull();
    expect(getResearchAuthoringFrameSelection(scalar('lvEjectionFraction'))?.phases).toHaveLength(4);
  });
  it('reuses strict Education navigation and stops stale selection work', async () => {
    let cancelled = false;
    const runCommand = jest.fn().mockResolvedValue({ok:false,reason:'quiz-target-viewport-not-ready'});
    expect(await navigateResearchAuthoringFrame({
      commandsManager:{runCommand}, target, questionKey:'lvidd|',
      isCancelled:()=>cancelled, wait:async()=>{cancelled=true;},
    })).toBe(false);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('jumpToViewerQuizTarget',
      expect.objectContaining({questionKey:'lvidd|',requireReadyViewport:true,requireExactSopFrame:true}));
  });
  it('posts the active question and accepts only a correlated manager acknowledgement', async () => {
    const intent = getResearchFramePickerIntent('?' + search)!;
    const selection = getResearchAuthoringFrameSelection(scalar('aorticRoot'))!;
    let receive: any;
    const opener = {closed:false,postMessage:jest.fn()};
    const host = {opener, crypto:{randomUUID:()=>session},
      setTimeout:()=>1, clearTimeout:jest.fn(),
      addEventListener:(_type:any, listener:any)=>{receive=listener;},
      removeEventListener:jest.fn()} as unknown as Window;
    const pending = sendResearchAuthoringFrame(host,intent,selection,target);
    expect(opener.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      componentKey:'aorticRoot',phaseKey:'',requestId:session,session,
    }),intent.parentOrigin);
    receive({source:{},origin:intent.parentOrigin,data:{type:RESEARCH_FRAME_CAPTURE_ACK,session,requestId:session,ok:true}});
    expect(host.removeEventListener).not.toHaveBeenCalled();
    receive({source:opener,origin:intent.parentOrigin,data:{type:RESEARCH_FRAME_CAPTURE_ACK,session,requestId:session,ok:true}});
    await expect(pending).resolves.toBeUndefined();
  });
});
