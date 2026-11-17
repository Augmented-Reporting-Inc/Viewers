/**
 * A fixed Research/Education source frame must match the DICOM SOP and the
 * complete one-based frame number. /frames/12 is not /frames/120.
 * Do not accept an image-index or frame-number fallback from another SOP.
 */
export function isExactViewerQuizSopFrameImageId(
  imageId: unknown, sopInstanceId: unknown, frameNumber: unknown
): boolean {
  const sop = String(sopInstanceId ?? '').trim();
  const frame = Number(frameNumber);
  if (!sop || !Number.isInteger(frame) || frame < 1) return false;
  const match = String(imageId ?? '').match(
    /\/instances\/([^/?#]+)\/frames\/(\d+)(?=$|[/?#&])/i
  );
  if (!match) return false;
  let actualSop = match[1];
  try {
    actualSop = decodeURIComponent(actualSop);
  } catch {
    return false;
  }
  return actualSop.toLowerCase() === sop.toLowerCase() &&
    Number(match[2]) === frame;
}
