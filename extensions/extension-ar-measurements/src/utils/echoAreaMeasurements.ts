import { calculateRAArea, calculateRVFAC } from './rightHeartMeasurements';

type Measurement = Record<string, any>;
type AreaSlot = 'RA_ES' | 'RV_ED' | 'RV_ES';

export const ECHO_AREA_LABELS = Object.freeze([
  { value: 'RAa', label: 'RA area (end-systole)', slot: 'RA_ES' },
  { value: 'RVEDA', label: 'RV end-diastolic area', slot: 'RV_ED' },
  { value: 'RVESA', label: 'RV end-systolic area', slot: 'RV_ES' },
]);

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function finitePositive(value: unknown): number | null {
  if (value === null || value === undefined || clean(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getEchoAreaSlot(measurement: Measurement): AreaSlot | null {
  const source = measurement?.echoArea || measurement?.measurements?.echoArea || {};
  const kind = clean(measurement?.measurementKind || measurement?.measurements?.measurementKind);
  // A generic ROI with a similar free-text label is not clinical evidence
  // unless the guided Echo Area workflow recorded its measurement kind/slot.
  if (!source.slot && kind !== 'echoAreaSlot') return null;
  const explicit = clean(source.slot).toUpperCase();
  if (explicit === 'RA_ES' || explicit === 'RV_ED' || explicit === 'RV_ES') {
    return explicit;
  }
  const rawLabel = clean(
    measurement?.label || measurement?.measurementRole || measurement?.role
  ).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['raa', 'raarea', 'raareaendsystole'].includes(rawLabel)) return 'RA_ES';
  if (['rveda', 'rvenddiastolicarea'].includes(rawLabel)) return 'RV_ED';
  if (['rvesa', 'rvendsystolicarea'].includes(rawLabel)) return 'RV_ES';
  return null;
}

export function isEchoAreaMeasurement(measurement: Measurement): boolean {
  return getEchoAreaSlot(measurement) !== null;
}

function isClosedContour(measurement: Measurement): boolean {
  const tool = clean(measurement?.toolName);
  return ['SplineROI', 'PlanarFreehandROI', 'LivewireContour'].includes(tool);
}

function convertAreaCM2(rawValue: unknown, rawUnit: unknown): number | null {
  const n = finitePositive(rawValue);
  const unit = clean(rawUnit).toLowerCase().replace(/\s/g, '').replace(/²/g, '2');
  if (n === null) return null;
  if (unit === 'mm2') return n / 100;
  if (unit === 'cm2') return n;
  return null;
}

/**
 * Accept calibrated Cornerstone ROI area statistics only.
 * Never convert pixel-squared area or infer a physical scale from contour pixels.
 */
export function getCalibratedEchoAreaCM2(measurement: Measurement): number | null {
  if (!isClosedContour(measurement)) return null;
  const points = measurement?.points || measurement?.measurements?.points ||
    measurement?.data?.contour?.polyline || [];
  if (!Array.isArray(points) || points.length < 3) return null;

  const measures = measurement?.measurements || {};
  const direct = convertAreaCM2(
    measures.area ?? measurement?.area,
    measures.areaUnit ?? measures.areaUnits ?? measurement?.areaUnit
  );
  if (direct !== null) return direct;

  const cached = measurement?.data || measurement?.cachedStats || {};
  if (!cached || typeof cached !== 'object') return null;
  const candidateValues = Object.values(cached)
    .filter((value): value is Record<string, any> =>
      !!value && typeof value === 'object' && !Array.isArray(value))
    .map(value => convertAreaCM2(value.area, value.areaUnit ?? value.areaUnits))
    .filter((value): value is number => value !== null);

  if (!candidateValues.length) return null;
  // Multiple conflicting cached targets should never be silently picked.
  if (candidateValues.some(value => Math.abs(value - candidateValues[0]) > 0.01)) {
    return null;
  }
  return candidateValues[0];
}

function evidence(measurement: Measurement) {
  return {
    annotationId: clean(
      measurement?.uid || measurement?.annotationUID || measurement?.annotationId || measurement?.id
    ),
    studyInstanceUID: clean(measurement?.referenceStudyUID || measurement?.StudyInstanceUID),
    seriesInstanceUID: clean(measurement?.referenceSeriesUID || measurement?.SeriesInstanceUID),
    sopInstanceUID: clean(measurement?.SOPInstanceUID || measurement?.metadata?.SOPInstanceUID),
    frameNumber: Number(measurement?.frameNumber || measurement?.metadata?.frameNumber || 0),
    referencedImageId: clean(measurement?.referencedImageId || measurement?.metadata?.referencedImageId),
  };
}

function candidates(measurements: Measurement[], slot: AreaSlot) {
  return (Array.isArray(measurements) ? measurements : [])
    .filter(m => getEchoAreaSlot(m) === slot);
}

export function calculateRAAreaFromMeasurements(measurements: Measurement[] = []) {
  const matches = candidates(measurements, 'RA_ES');
  if (!matches.length) return null;
  if (matches.length !== 1) {
    return { status: 'invalid', values: null, message: 'More than one RA area contour is labelled.' };
  }
  const areaCM2 = getCalibratedEchoAreaCM2(matches[0]);
  const result = calculateRAArea(areaCM2, 'cm²');
  return {
    status: result.status,
    values: result.status === 'complete' ? { areaCM2: result.areaCM2 } : null,
    evidence: evidence(matches[0]),
    message: result.status === 'complete' ? '' : 'RA area contour is not calibrated or not closed.',
  };
}

export function calculateRVFACFromMeasurements(measurements: Measurement[] = []) {
  const ed = candidates(measurements, 'RV_ED');
  const es = candidates(measurements, 'RV_ES');
  if (!ed.length && !es.length) return null;
  if (ed.length > 1 || es.length > 1) {
    return { status: 'invalid', values: null, message: 'Duplicate RV area contours are labelled.' };
  }
  const eda = ed.length ? getCalibratedEchoAreaCM2(ed[0]) : null;
  const esa = es.length ? getCalibratedEchoAreaCM2(es[0]) : null;
  const edEvidence = ed.length ? evidence(ed[0]) : null;
  const esEvidence = es.length ? evidence(es[0]) : null;

  if (edEvidence && esEvidence) {
    if (
      !edEvidence.studyInstanceUID || !esEvidence.studyInstanceUID ||
      edEvidence.studyInstanceUID !== esEvidence.studyInstanceUID ||
      !edEvidence.seriesInstanceUID || !esEvidence.seriesInstanceUID ||
      edEvidence.seriesInstanceUID !== esEvidence.seriesInstanceUID
    ) {
      return {
        status: 'invalid', values: null, edEvidence, esEvidence,
        message: 'RV ED and ES contours must reference the same study and cine series.',
      };
    }
  }
  const result = calculateRVFAC(eda, esa);
  return {
    status: result.status,
    values: {
      edaCM2: eda,
      esaCM2: esa,
      facPercent: result.facPercent,
    },
    edEvidence,
    esEvidence,
    message:
      result.status === 'complete'
        ? ''
        : result.status === 'invalid'
          ? 'RV end-systolic area must be smaller than end-diastolic area. Check both contours.'
          : 'Capture calibrated RV end-diastolic and end-systolic contours from the same cine series.',
  };
}


/** Applies only a validated RA planimetry value to the existing AR report field. */
export function buildClinicalRAAreaReportFieldUpdates(result: any = null) {
  const areaCM2 = result?.status === 'complete' ? Number(result.values?.areaCM2) : null;
  if (areaCM2 == null || !Number.isFinite(areaCM2) || areaCM2 <= 0) return {};
  return {
    RAa: areaCM2.toFixed(1),
    RAaUOM: 'cm2',
  };
}


/** Clinical report adapter; source contours are preserved independently. */
export function buildClinicalRVFACReportFieldUpdates(result: any = null) {
  const values = result?.status === 'complete' ? result.values : null;
  const eda = Number(values?.edaCM2);
  const esa = Number(values?.esaCM2);
  const fac = Number(values?.facPercent);
  if (!values || !Number.isFinite(eda) || !Number.isFinite(esa) ||
      !Number.isFinite(fac) || eda <= esa || esa <= 0 || fac <= 0 || fac > 100) {
    return {};
  }
  return {
    RVEDA: eda.toFixed(1),
    RVEDAUOM: 'cm2',
    RVESA: esa.toFixed(1),
    RVESAUOM: 'cm2',
    RVFAC: fac.toFixed(1),
    RVFACUOM: '%',
  };
}
