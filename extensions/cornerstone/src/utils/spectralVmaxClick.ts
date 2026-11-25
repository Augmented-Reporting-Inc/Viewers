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

/** Resolve native VTK geometry from either a StackViewport image-data
 * descriptor or a direct vtkImageData. Never substitute pixel coordinates
 * for world coordinates. Failure leaves the native two-point tool available. */
export function resolveSpectralVmaxWorldClick(
  imageData: any, worldPoint: unknown, regions: SpectralRegion[]
): { baselineWorld: number[]; velocityMps: number } | null {
  const vector = (value: any): number[] | null => {
    if (!value || typeof value.length !== 'number' || value.length !== 3) return null;
    const coordinates = Array.from(value) as number[];
    return coordinates.every(Number.isFinite) ? coordinates : null;
  };
  const point = vector(worldPoint);
  if (!point) return null;
  const vtk = [imageData?.imageData, imageData].find(candidate =>
    typeof candidate?.worldToIndex === 'function' &&
    typeof candidate?.indexToWorld === 'function');
  if (!vtk) return null;
  try {
    const peak = vector(vtk.worldToIndex(point));
    if (!peak) return null;
    const matches = regions.map(region => resolveSpectralVmaxClick(region, peak[0], peak[1]))
      .filter(result => result !== null);
    const result = matches[0];
    if (!result || matches.some(match =>
      Math.abs(match.baselineY - result.baselineY) > 1e-6 ||
      Math.abs(match.velocityMps - result.velocityMps) > 1e-6)) return null;
    const baseline = vector(vtk.indexToWorld([peak[0], result.baselineY, peak[2]]));
    if (!baseline) return null;
    const roundTrip = vector(vtk.worldToIndex(baseline));
    if (!roundTrip || Math.abs(roundTrip[0] - peak[0]) > 1e-4 ||
        Math.abs(roundTrip[1] - result.baselineY) > 1e-4 ||
        Math.abs(roundTrip[2] - peak[2]) > 1e-4) return null;
    return { baselineWorld: baseline, velocityMps: result.velocityMps };
  } catch {
    return null;
  }
}
