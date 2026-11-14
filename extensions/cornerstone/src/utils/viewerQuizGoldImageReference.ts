/**
 * Resolve a temporary quiz gold overlay to a real image in the active stack.
 * Matching a DICOM URL syntactically is not enough: Cornerstone's measurement
 * mapper requires instance metadata registered under that exact imageId.
 * Never change persisted quiz evidence or fall back to a different frame.
 */
export function resolveQuizGoldViewportImage({
  savedImageId = '',
  studyInstanceUID = '',
  seriesInstanceUID = '',
  sopInstanceUID = '',
  frameNumber = null,
  viewportImageIds = [],
  getInstanceMetadata = () => null,
} = {}) {
  const clean = value => String(value ?? '').trim();
  const normalized = value => clean(value)
    .replace(/^(wadors|dicomweb):/i, '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('?')[0].toLowerCase();
  const parseDicom = value => {
    const path = normalized(value);
    const match = path.match(/\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)\/frames\/(\d+)(?:\/|$)/i);
    if (!match) return null;
    return { study: decodeURIComponent(match[1]), series: decodeURIComponent(match[2]),
      sop: decodeURIComponent(match[3]), frame: Number(match[4]) };
  };
  const saved = clean(savedImageId);
  const savedPath = parseDicom(saved);
  const expected = {
    study: clean(studyInstanceUID), series: clean(seriesInstanceUID),
    sop: clean(sopInstanceUID),
  };
  const validIdentity = (path, metadata) => {
    if (!path || !metadata || !clean(metadata.SOPInstanceUID)) return false;
    if (expected.study && path.study !== expected.study) return false;
    if (expected.series && path.series !== expected.series) return false;
    if (expected.sop && path.sop !== expected.sop) return false;
    if (clean(metadata.StudyInstanceUID) && metadata.StudyInstanceUID !== path.study) return false;
    if (clean(metadata.SeriesInstanceUID) && metadata.SeriesInstanceUID !== path.series) return false;
    if (metadata.SOPInstanceUID !== path.sop) return false;
    const metadataFrame = Number(metadata.frameNumber);
    if (metadata.frameNumber != null && Number.isInteger(metadataFrame) && metadataFrame > 0 &&
        metadataFrame !== path.frame) return false;
    return true;
  };
  if (!saved || !savedPath || !expected.sop ||
      !Number.isInteger(savedPath.frame) || savedPath.frame < 1) {
    return { ok: false, reason: 'incomplete-saved-dicom-reference' };
  }
  if (expected.study && expected.study !== savedPath.study ||
      expected.series && expected.series !== savedPath.series ||
      expected.sop !== savedPath.sop) {
    return { ok: false, reason: 'saved-dicom-identity-conflict' };
  }
  // Some legacy saved references have an inconsistent ancillary frameNumber.
  // The unambiguous frame in the saved DICOMweb image reference stays authoritative;
  // never use the loose frame number to select another image.
  const savedFrameConflict = frameNumber != null &&
    Number.isInteger(Number(frameNumber)) && Number(frameNumber) > 0 &&
    Number(frameNumber) !== savedPath.frame;
  let equivalentCount = 0;
  let lacksMetadata = false;
  for (const candidate of Array.isArray(viewportImageIds) ? viewportImageIds : []) {
    const path = parseDicom(candidate);
    if (!path || path.study !== savedPath.study || path.series !== savedPath.series ||
        path.sop !== savedPath.sop || path.frame !== savedPath.frame) continue;
    equivalentCount++;
    const metadata = getInstanceMetadata(candidate);
    if (!validIdentity(path, metadata)) { lacksMetadata = true; continue; }
    return { ok: true, imageId: candidate, reason: '', savedFrameConflict };
  }
  return { ok: false, reason: equivalentCount && lacksMetadata
    ? 'image-instance-metadata-unavailable' : 'exact-saved-frame-not-in-active-stack' };
}
