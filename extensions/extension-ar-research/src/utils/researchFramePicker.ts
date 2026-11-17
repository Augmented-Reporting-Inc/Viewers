/**
 * Cross-window Research protocol frame authoring uses the same active-frame
 * evidence as Education's getCurrentViewerQuizFrameAnswer command.
 * The frontend independently validates the response before changing the
 * unsaved Research ReadSchema. Never expose patient details or image pixels.
 */
export const RESEARCH_FRAME_CAPTURE_MESSAGE = 'ar.research.frame-target-captured.v1';

const getString = (value: unknown) => String(value ?? '').trim();

export function getResearchFramePickerIntent(search: string) {
  const params = new URLSearchParams(search);
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
