/**
 * Physical contour area only: caller must first calibrate every point using
 * an unambiguous DICOM ultrasound spatial region (mm units).
 * Never pass raw canvas/pixel/world coordinates into this helper.
 */
export function calculateCalibratedEchoAreaCM2(pointsMM: number[][]): number | null {
  if (!Array.isArray(pointsMM) || pointsMM.length < 3 ||
      pointsMM.some(point => !Array.isArray(point) || point.length < 2 ||
        !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1])))) {
    return null;
  }
  let doubleAreaMM2 = 0;
  for (let i = 0; i < pointsMM.length; i += 1) {
    const [x1, y1] = pointsMM[i];
    const [x2, y2] = pointsMM[(i + 1) % pointsMM.length];
    doubleAreaMM2 += x1 * y2 - x2 * y1;
  }
  const cm2 = Math.abs(doubleAreaMM2) / 200;
  return Number.isFinite(cm2) && cm2 > 0 ? cm2 : null;
}
