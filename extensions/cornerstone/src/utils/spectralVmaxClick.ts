/**
 * Resolve the zero-velocity spectral Doppler baseline from DICOM US region
 * calibration. ReferencePixelY0 is relative to RegionLocationMinY0.
 * Never infer the baseline from the image midpoint or a default velocity.
 */
export type SpectralRegion = {
  minX: number; maxX: number; minY: number; maxY: number;
  referenceY: number; referencePhysicalY: number;
  physicalDeltaY: number; spatialFormat: number; unitsY: number;
};

export function resolveSpectralVmaxClick(
  region: SpectralRegion,
  peakX: number,
  peakY: number
): { baselineY: number; velocityMps: number } | null {
  if (![region.minX, region.maxX, region.minY, region.maxY,
    region.referenceY, region.referencePhysicalY, region.physicalDeltaY,
    region.spatialFormat, region.unitsY, peakX, peakY].every(Number.isFinite)) return null;
  // DICOM: 3 = spectral, 7 = cm/s. Unknown/Hz units are not velocity.
  if (region.spatialFormat !== 3 || region.unitsY !== 7 || region.physicalDeltaY === 0 ||
      peakX < region.minX || peakX > region.maxX || peakY < region.minY || peakY > region.maxY) return null;
  const baselineY = region.minY + region.referenceY -
    region.referencePhysicalY / region.physicalDeltaY;
  const velocityMps = Math.abs((peakY - baselineY) * region.physicalDeltaY) / 100;
  if (!Number.isFinite(baselineY) || baselineY < region.minY ||
      baselineY > region.maxY || !Number.isFinite(velocityMps) ||
      velocityMps <= 0 || velocityMps > 7) return null;
  return { baselineY, velocityMps };
}
