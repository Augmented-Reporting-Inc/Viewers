import { getUSRegionLengthCalibrationForTarget } from './correctUSRegionLength';

/**
 * Resolve one physical Length value for both the native viewport text and the
 * MeasurementService mapping. Restored annotations retain their saved mm only
 * for the original frame and unchanged world-coordinate endpoints. Newly drawn
 * or edited Length annotations always use the live DICOM calibration.
 */
export function getUnchangedRestoredLengthMm(
  data: any,
  targetId: unknown,
  referencedImageId = ''
): number | null {
  const saved = data?.arRestoredLengthEvidence;
  if (
    !saved ||
    typeof targetId !== 'string' ||
    !targetId.startsWith('imageId:') ||
    !saved.referencedImageId
  ) {
    return null;
  }

  const currentImageId = targetId.slice('imageId:'.length);
  if (
    !currentImageId ||
    currentImageId !== saved.referencedImageId ||
    (referencedImageId && referencedImageId !== saved.referencedImageId)
  ) {
    return null;
  }

  const current = data?.handles?.points;
  const original = saved.points;
  if (
    !Array.isArray(current) ||
    !Array.isArray(original) ||
    current.length !== 2 ||
    original.length !== 2
  ) {
    return null;
  }

  const unchanged = current.every((point, i) =>
    Array.isArray(point) &&
    Array.isArray(original[i]) &&
    point.length >= 3 &&
    original[i].length >= 3 &&
    [0, 1, 2].every(axis => {
      const currentCoordinate = Number(point[axis]);
      const savedCoordinate = Number(original[i][axis]);
      return (
        Number.isFinite(currentCoordinate) &&
        Number.isFinite(savedCoordinate) &&
        Math.abs(currentCoordinate - savedCoordinate) < 1e-7
      );
    })
  );
  const value = Number(saved.valueMm);
  return unchanged && Number.isFinite(value) && value > 0 ? value : null;
}

export type ResolvedLengthValue = {
  lengthMm: number;
  unit: 'mm';
  source: 'restored' | 'dicom';
};

/**
 * One decision for both UI and persisted MeasurementService:
 * 1. The unchanged, frame-bound saved mm value on restore.
 * 2. The live frame-specific ultrasound-region calibration otherwise.
 * 3. Null; callers may retain native behaviour only when it is safe.
 *
 * Do not use the persisted value after a handle edit or frame change, even
 * when the new calibration is temporarily unavailable.
 */
export function resolveLengthValueForTarget(
  targetId: unknown,
  data: any,
  referencedImageId = ''
): ResolvedLengthValue | null {
  const restoredMm = getUnchangedRestoredLengthMm(data, targetId, referencedImageId);
  if (restoredMm !== null) {
    return { lengthMm: restoredMm, unit: 'mm', source: 'restored' };
  }

  const dicom = getUSRegionLengthCalibrationForTarget(targetId, data, referencedImageId);
  if (!dicom || !Number.isFinite(dicom.lengthMm)) {
    return null;
  }

  return { lengthMm: dicom.lengthMm, unit: 'mm', source: 'dicom' };
}
