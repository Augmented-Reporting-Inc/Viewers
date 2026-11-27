/**
 * Cross-window Research protocol frame authoring uses the same active-frame
 * evidence as Education's getCurrentViewerQuizFrameAnswer command.
 * The frontend independently validates the response before changing the
 * unsaved Research ReadSchema. Never expose patient details or image pixels.
 */
import { getResearchEchoPhases, getResearchEchoPhaseTarget } from './researchEchoWorkflow';

export const RESEARCH_FRAME_CAPTURE_MESSAGE = 'ar.research.frame-target-captured.v2';
export const RESEARCH_FRAME_CAPTURE_ACK = 'ar.research.frame-target-ack.v2';

/** Launch intent authorizes the session and chooses the initial question only.
 * The actual capture destination always comes from the selected field. */
export function getResearchAuthoringFrameSelection(field: any, preferredPhase = '') {
  if (!field?.key || !field?.componentKey || field.segmentKey) return null;
  const phases = getResearchEchoPhases(field);
  if (!phases.length && field.kind !== 'measurement') return null;
  const phaseKey = phases.find(phase => phase.slot === preferredPhase)?.slot ||
    phases[0]?.slot || '';
  return {
    key: JSON.stringify([field.key, phaseKey]), fieldKey: field.key,
    componentKey: field.componentKey, phaseKey, phases,
  };
}

export function getResearchAuthoringFrameTarget(field: any, phaseKey: string, staged: Record<string, any>) {
  const selection = getResearchAuthoringFrameSelection(field, phaseKey);
  if (!selection || selection.phaseKey !== phaseKey) return null;
  return staged[selection.key] || getResearchEchoPhaseTarget(field, phaseKey);
}

/** Use Education's existing exact target command with the strict readiness
 * already used by completed Research review; do not reimplement image jumps. */
export async function navigateResearchAuthoringFrame({
  commandsManager, target, questionKey, isCancelled,
  wait = () => new Promise(resolve => setTimeout(resolve, 100)),
  attempts = 150,
}: {
  commandsManager: any; target: any; questionKey: string;
  isCancelled: () => boolean; wait?: () => Promise<unknown>; attempts?: number;
}) {
  for (let attempt = 0; attempt < attempts && !isCancelled(); attempt++) {
    const result = await commandsManager.runCommand('jumpToViewerQuizTarget', {
      viewerTarget: target, questionKey, requireExactSopFrame: true,
      pauseCineOnTarget: true, requireReadyViewport: true, isCancelled,
    });
    if (isCancelled()) return false;
    if (result?.ok === true) return true;
    if (!['quiz-target-viewport-not-ready', 'quiz-target-display-set-not-ready'].includes(result?.reason)) return false;
    if (attempt + 1 < attempts) await wait();
  }
  return false;
}

/** Only acknowledge success after the manager has staged the target.
 * An older manager ignores v2, so mixed deployments cannot silently write. */
export function sendResearchAuthoringFrame(
  host: Window, intent: NonNullable<ReturnType<typeof getResearchFramePickerIntent>>,
  selection: NonNullable<ReturnType<typeof getResearchAuthoringFrameSelection>>,
  target: any, timeoutMs = 8000
): Promise<void> {
  const opener = host.opener;
  if (!opener || opener.closed) return Promise.reject(new Error('Reopen the frame picker from Research Manager.'));
  const requestId = host.crypto?.randomUUID?.();
  if (!requestId) return Promise.reject(new Error('Secure browser frame capture is unavailable.'));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      host.clearTimeout(timer);
      host.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== opener || event.origin !== intent.parentOrigin ||
          data?.type !== RESEARCH_FRAME_CAPTURE_ACK || data.session !== intent.session ||
          data.requestId !== requestId) return;
      cleanup();
      if (data.ok === true) resolve();
      else reject(new Error(data.message || 'Research Manager rejected the selected frame.'));
    };
    const timer = host.setTimeout(() => {
      cleanup();
      reject(new Error('Research Manager did not confirm the capture. Check its draft and reopen the picker with the current software.'));
    }, timeoutMs);
    host.addEventListener('message', receive);
    try {
      opener.postMessage({
        type: RESEARCH_FRAME_CAPTURE_MESSAGE, session: intent.session, requestId,
        studyInstanceUID: intent.studyInstanceUID, componentKey: selection.componentKey,
        phaseKey: selection.phaseKey, target,
      }, intent.parentOrigin);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

const getString = (value: unknown) => String(value ?? '').trim();

export function getResearchFramePickerIntent(search: string, hash = '') {
  const params = new URLSearchParams(search);
  // Match the existing Research viewer context parser: OHIF deployments can
  // carry route arguments either in location.search or the hash query.
  const hashQuery = String(hash || '').includes('?')
    ? String(hash).slice(String(hash).indexOf('?') + 1).split('#')[0] : '';
  new URLSearchParams(hashQuery).forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  const session = getString(params.get('arResearchFramePickerSession'));
  if (!session) return null;
  const parentOrigin = getString(params.get('arResearchFramePickerParentOrigin'));
  const componentKey = getString(params.get('arResearchFramePickerComponentKey'));
  const phaseKey = getString(params.get('arResearchFramePickerPhaseKey'));
  const studyInstanceUID = getString(params.get('arResearchFramePickerStudyInstanceUID'));
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(parentOrigin);
  } catch {
    return null;
  }
  // Accept AR platform origins (plus local development), never arbitrary
  // third-party opener domains supplied in a crafted viewer URL.
  const host = parsedOrigin.hostname.toLowerCase();
  const allowedPlatform = parsedOrigin.protocol === 'https:' &&
    (host === 'futurepacs.com' || host.endsWith('.futurepacs.com'));
  const allowedLocal = ['localhost', '127.0.0.1'].includes(host) &&
    ['http:', 'https:'].includes(parsedOrigin.protocol);
  if (!allowedPlatform && !allowedLocal) return null;
  if (!/^[0-9a-f-]{36}$/i.test(session) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(componentKey) ||
      (phaseKey && !/^[a-zA-Z0-9_-]{1,100}$/.test(phaseKey)) ||
      !/^[0-9.]{1,64}$/.test(studyInstanceUID)) return null;
  return {
    session,
    parentOrigin: parsedOrigin.origin,
    studyInstanceUID,
    componentKey,
    phaseKey,
  };
}

export function getResearchCapturedFrameTarget(
  commandResult: any,
  intent: ReturnType<typeof getResearchFramePickerIntent>
) {
  if (!intent || commandResult?.ok !== true) {
    throw new Error(commandResult?.reason || 'The active viewer frame was not available.');
  }
  const target = commandResult?.answer?.selectedTarget;
  const studyInstanceUID = getString(target?.studyInstanceUID);
  const seriesInstanceUID = getString(target?.seriesInstanceUID);
  const sopInstanceUID = getString(target?.sopInstanceUID);
  const referencedImageId = getString(target?.referencedImageId);
  const frameNumber = Number(target?.frameNumber);
  if (!studyInstanceUID || studyInstanceUID !== intent.studyInstanceUID) {
    throw new Error('The active image belongs to a different DICOM study.');
  }
  if (!seriesInstanceUID || !sopInstanceUID || !referencedImageId ||
      !Number.isInteger(frameNumber) || frameNumber < 1) {
    throw new Error('Select an identified DICOM image and frame before capturing.');
  }
  return {
    studyInstanceUID,
    seriesInstanceUID,
    sopInstanceUID,
    frameNumber,
    referencedImageId,
    ...(getString(target?.displaySetInstanceUID)
      ? { displaySetInstanceUID: getString(target.displaySetInstanceUID) } : {}),
  };
}
