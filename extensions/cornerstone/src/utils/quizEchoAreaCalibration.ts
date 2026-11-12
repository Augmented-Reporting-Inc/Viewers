import { presentVerifiedPhysicalMeasurement } from '../../../extension-ar-measurements/src/utils/physicalMeasurementPresentation';

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

/**
 * Preserve the explicit physical unit of a saved echo quiz contour. Stored
 * areas may be in cm² or mm²; a label-only conversion would be unsafe.
 * Pixel areas and missing/unknown units are not accepted as physical values.
 */
export function getSavedQuizEchoAreaDisplayInfo(area: unknown, areaUnit: unknown) {
  if (area == null || (typeof area === 'string' && !area.trim())) return null;
  const value = Number(area);
  const unit = String(areaUnit ?? '').toLowerCase().replace(/\s/g, '').replace(/²/g, '2');
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 'cm2') return { value, areaUnit: 'cm²', linearUnit: 'cm' };
  if (unit === 'mm2') return { value, areaUnit: 'mm²', linearUnit: 'mm' };
  return null;
}

/**
 * Gold comparison overlays are reconstructed from composite answer components,
 * not always from the original annotation. Restore explicit source-slot
 * metadata so the normal ROI renderer recognizes the quiz contour.
 * Never infer a slot from a generic ROI label or cross measurement kinds.
 */
export function getQuizCompositeGoldContourSlotMetadata(
  measurementKind: unknown, rawSlot: unknown
): Record<string, any> {
  const kind = String(measurementKind || '').trim();
  const slot = String(rawSlot || '').trim().toUpperCase();
  if ((kind === 'rvFAC' && (slot === 'RV_ED' || slot === 'RV_ES')) ||
      (kind === 'raArea' && slot === 'RA_ES')) {
    return {
      echoArea: { measurementKind: 'echoAreaSlot', slot,
        phase: slot === 'RV_ED' ? 'ED' : 'ES', view: 'A4C' },
    };
  }
  if ((kind === 'laVolumeBiplane' || kind === 'laVolumeBiplaneDisks') &&
      (slot === 'A4C' || slot === 'A2C')) {
    return {
      laVolume: { measurementKind: 'laVolumeSlot', slot,
        view: slot, phase: 'ES' },
    };
  }
  return {};
}

/**
 * Display-only formatter for RV/RA and LA quiz contour annotations.
 * Cornerstone's native ROI cachedStats may use a different physical scale.
 * Never relabel its raw number: display only the validated cm² phase value.
 * Unrelated (clinical, bowel, spectral) contours are not intercepted.
 */
export function getQuizCompositeContourViewportLines(
  data: any,
  calibratedAreaCM2: unknown
): string[] | null {
  const slot = String(data?.echoArea?.slot || data?.laVolume?.slot || '')
    .trim().toUpperCase();
  const labels: Record<string, string> = {
    RV_ED: 'RVEDA', RV_ES: 'RVESA', RA_ES: 'RA area',
    A4C: 'LA A4C', A2C: 'LA A2C',
  };
  const isEcho = !!data?.echoArea?.slot;
  const isLA = !!data?.laVolume?.slot;
  if ((!isEcho && !isLA) || !labels[slot] ||
      (isEcho && !['RV_ED', 'RV_ES', 'RA_ES'].includes(slot)) ||
      (isLA && !['A4C', 'A2C'].includes(slot))) return null;

  if (calibratedAreaCM2 != null && calibratedAreaCM2 !== '') {
    const value = Number(calibratedAreaCM2);
    if (Number.isFinite(value) && value > 0) {
      // Same dimension-safe display policy used by other AR measurement views.
      // The verified flag is justified by upstream composite phase validation;
      // this formatter never calibrates native ROI pixels.
      const measurementKind = slot === 'RV_ED' ? 'rvEDA'
        : slot === 'RV_ES' ? 'rvESA'
        : slot === 'RA_ES' ? 'raArea'
        : slot === 'A4C' ? 'laA4C' : 'laA2C';
      const displayed = presentVerifiedPhysicalMeasurement({
        value, unit: 'cm²', measurementKind, verified: true,
      });
      if (displayed) return [`${labels[slot]}: ${displayed.text}`];
    }
  }
  // A hydrated legacy gold contour can already have explicitly calibrated
  // display text even before the live composite snapshot is available.
  const savedLines = data?.arSavedMeasurementDisplayText;
  if (Array.isArray(savedLines)) {
    const calibrated = savedLines.filter(line =>
      /^\s*(?:[A-Za-z\s-]+:\s*)?\d+(?:\.\d+)?\s*cm(?:²|2)\s*$/i
        .test(String(line))
    );
    if (calibrated.length) return calibrated.map(line =>
      String(line).replace(/\s*cm2\s*$/i, ' cm²'));
  }
  return [`${labels[slot]}: calibrated area unavailable`];
}


/** Carry explicit guided RV/RA identity through native ROI remapping.
 * A similar free-text label alone never establishes an Echo Area source. */
export function getQuizEchoAreaSourceMetadata(data: any = {}): Record<string, any> {
  const source = data?.echoArea;
  const slot = String(source?.slot || '').trim().toUpperCase();
  if (!['RV_ED', 'RV_ES', 'RA_ES'].includes(slot)) return {};
  return { measurementKind: 'echoAreaSlot', echoArea: { ...source, slot } };
}
