import { boundEFQuizEvidencePoints, calibratedLVContourAreaCM2 } from './viewerQuizCompositeResults';

/**
 * Revalidate the immutable quiz gold contours against their exact DICOM
 * ultrasound-region calibration. This repairs *display evidence*, never
 * updates scoring, geometry, frames or the saved calculated gold scalar.
 *
 * Frontend-only source contract; FormAPI independently stores and validates
 * quiz answers, without importing this file.
 */
type GoldComponent = {
  slot?: string;
  annotationId?: string;
  points?: number[][];
  target?: Record<string, any>;
};
type GoldAnswer = Record<string, any>;
export type GoldAreaCalibration = (component: GoldComponent) => Promise<number | null>;

const METHODS: Record<string, { method: string; slots: string[]; fields: Record<string, string> }> = {
  rvFAC: {
    method: 'rv-fac-planimetry-v1', slots: ['RV_ED', 'RV_ES'],
    fields: { RV_ED: 'edaCM2', RV_ES: 'esaCM2' },
  },
  laVolumeBiplane: {
    method: 'biplane-area-length-v1', slots: ['A4C', 'A2C'],
    fields: { A4C: 'a4cAreaCM2', A2C: 'a2cAreaCM2' },
  },
  laVolumeBiplaneDisks: {
    method: 'biplane-disks-v1', slots: ['A4C', 'A2C'],
    fields: { A4C: 'a4cAreaCM2', A2C: 'a2cAreaCM2' },
  },
};

const clean = (value: unknown) => String(value ?? '').trim();
const finitePositive = (value: unknown): number | null => {
  if (value === null || value === undefined || clean(value) === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};
const failure = (reason: string) => ({ ok: false as const, reason });

function validSource(component: GoldComponent) {
  const target = component.target || {};
  const study = clean(target.studyInstanceUID);
  const series = clean(target.seriesInstanceUID);
  const sop = clean(target.sopInstanceUID);
  const imageId = clean(target.referencedImageId);
  const frame = Number(target.frameNumber);
  const frameMatch = imageId.match(/\/frames\/([1-9][0-9]*)(?:[/?#]|$)/);
  const points = component.points;
  return Boolean(
    clean(component.annotationId) && study && series && sop && imageId &&
    Number.isSafeInteger(frame) && frame > 0 &&
    frameMatch && Number(frameMatch[1]) === frame &&
    Array.isArray(points) && points.length >= 6 && points.length <= 5000 &&
    points.every(point => Array.isArray(point) && point.length >= 2 &&
      point.length <= 3 && point.every(value => Number.isFinite(value)))
  );
}

export async function resolveViewerQuizGoldAreaBackfill({
  kind, gold, calibrate,
}: { kind: string; gold: GoldAnswer; calibrate: GoldAreaCalibration }) {
  const spec = METHODS[kind];
  if (!spec) return failure('unsupported-area-gold-kind');
  if (clean(gold?.measurementKind) !== kind) return failure('gold-kind-mismatch');
  const composite = gold?.compositeResult || {};
  if (clean(composite.methodId) !== spec.method) return failure('gold-method-mismatch');
  const value = finitePositive(gold?.value);
  if (value === null) return failure('gold-result-not-available');
  const components: GoldComponent[] = composite.components;
  if (!Array.isArray(components) || components.length !== spec.slots.length) {
    return failure('gold-contour-count-mismatch');
  }
  const ordered = spec.slots.map(slot =>
    components.filter(component => clean(component?.slot) === slot)
  );
  if (ordered.some(matches => matches.length !== 1 || !validSource(matches[0]))) {
    return failure('gold-source-frame-or-contour-invalid');
  }
  const sources = ordered.map(matches => matches[0]);
  const studies = new Set(sources.map(component => clean(component.target?.studyInstanceUID)));
  const annotationIds = new Set(sources.map(component => clean(component.annotationId)));
  const frames = new Set(sources.map(component => {
    const t = component.target || {};
    return [t.seriesInstanceUID, t.sopInstanceUID, t.frameNumber].join('|');
  }));
  if (studies.size !== 1 || annotationIds.size !== sources.length ||
      frames.size !== sources.length) {
    return failure('gold-source-identity-conflict');
  }

  const derived: Record<string, number> = { ...(composite.derived || {}) };
  for (let index = 0; index < sources.length; index++) {
    const component = sources[index];
    const slot = spec.slots[index];
    const calibratedArea = finitePositive(await calibrate(component));
    if (calibratedArea === null) {
      return failure(slot + ': exact DICOM ultrasound-region area calibration unavailable');
    }
    const field = spec.fields[slot];
    const previous = finitePositive(derived[field]);
    if (previous !== null && Math.abs(previous - calibratedArea) > 0.02) {
      return failure(slot + ': saved calibrated area disagrees with source contour');
    }
    derived[field] = calibratedArea;
  }
  if (kind === 'rvFAC') {
    const calculatedFAC = 100 * (derived.edaCM2 - derived.esaCM2) / derived.edaCM2;
    if (!(derived.edaCM2 > derived.esaCM2) || !Number.isFinite(calculatedFAC) ||
      Math.abs(Math.round(calculatedFAC * 100) / 100 - value) > 0.01) {
      return failure('recovered-RV-areas-do-not-match-saved-FAC');
    }
    derived.facPercent = value;
  } else {
    // Independent physical per-view areas can be validated from the exact
    // source contour/frame. Do not claim to reproduce a legacy LA biplane
    // volume without its original long-axis landmarks.
    derived.volumeML = value;
  }
  return { ok: true as const, derived, calibratedSlots: [...spec.slots] };
}

/**
 * Recover four EF contour areas from persisted, physically calibrated source
 * annotations. Only exact immutable gold annotation IDs, source frames and
 * retained contour evidence qualify. Does not recalculate EF or change gold.
 */
export function resolveSavedEFGoldContourAreas({
  gold, savedAnnotations,
}: { gold: GoldAnswer; savedAnnotations: any[] }) {
  if (clean(gold?.measurementKind) !== 'lvSimpsonEF' ||
      finitePositive(gold?.value) === null) return failure('EF gold result unavailable');
  const composite = gold?.compositeResult || {};
  const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  const components: GoldComponent[] = composite.components;
  if (!Array.isArray(components) || components.length !== 4 ||
      !Array.isArray(savedAnnotations)) return failure('EF gold sources incomplete');
  const selected = slots.map(slot =>
    components.filter(component => clean(component?.slot) === slot));
  if (selected.some(matches => matches.length !== 1 ||
      !validSource(matches[0]))) return failure('EF gold source frames invalid');
  const studyIds = new Set(selected.map(matches =>
    clean(matches[0].target?.studyInstanceUID)));
  const annotationIds = new Set(selected.map(matches => clean(matches[0].annotationId)));
  if (studyIds.size !== 1 || annotationIds.size !== 4) {
    return failure('EF gold source identity conflict');
  }

  const areas: Record<string, number> = {};
  for (let index = 0; index < slots.length; index++) {
    const component = selected[index][0];
    const target = component.target || {};
    const matches = savedAnnotations.filter(item =>
      clean(item.uid || item.annotationId || item.annotationUID) ===
        clean(component.annotationId));
    if (matches.length !== 1) return failure(slots[index] + ': saved source missing');
    const annotation = matches[0];
    const annotationStudy = clean(annotation.StudyInstanceUID || annotation.referenceStudyUID);
    const annotationSeries = clean(annotation.SeriesInstanceUID || annotation.referenceSeriesUID);
    const annotationSop = clean(annotation.SOPInstanceUID);
    const annotationImage = clean(annotation.referencedImageId);
    if (annotationStudy !== clean(target.studyInstanceUID) ||
        annotationSeries !== clean(target.seriesInstanceUID) ||
        annotationSop !== clean(target.sopInstanceUID) ||
        annotationImage !== clean(target.referencedImageId)) {
      return failure(slots[index] + ': saved source image/frame mismatch');
    }
    const geometry = annotation.lvSimpson || annotation.measurements?.lvSimpson || {};
    if (clean(geometry.slot) !== slots[index] || geometry.calibrationError ||
        !Array.isArray(geometry.calibratedContourPoints) ||
        !Array.isArray(geometry.originalContourPoints) ||
        geometry.calibratedContourPoints.length !== geometry.originalContourPoints.length) {
      return failure(slots[index] + ': verified physical calibration unavailable');
    }
    // The bounded gold polygon must still match the persisted annotation.
    const annotationPoints = annotation.points;
    if (!Array.isArray(annotationPoints) ||
        JSON.stringify(boundEFQuizEvidencePoints(annotationPoints)) !==
          JSON.stringify(component.points)) {
      return failure(slots[index] + ': gold contour changed after capture');
    }
    const value = calibratedLVContourAreaCM2(geometry.calibratedContourPoints);
    if (value === null) return failure(slots[index] + ': physical area unavailable');
    const oldValue = finitePositive(composite.derived?.slotAreaCM2?.[slots[index]]);
    if (oldValue !== null && Math.abs(oldValue - value) > 0.02) {
      return failure(slots[index] + ': saved physical area mismatch');
    }
    areas[slots[index]] = value;
  }
  return {
    ok: true as const,
    derived: {
      ...(composite.derived || {}),
      slotAreaCM2: areas,
    },
    calibratedSlots: [...slots],
  };
}

/**
 * Recover approved EF per-contour display areas when the original Mongo
 * annotation container is absent. Recalibrate the immutable gold geometry
 * against each exact DICOM SOP/frame; never interpret world pixels as mm.
 * This does not recalculate EF, alter source contours, or change scoring.
 */
export async function resolveVerifiedEFGoldContourAreasFromDicom({
  kind, gold, calibrate,
}: { kind: string; gold: GoldAnswer; calibrate: GoldAreaCalibration }) {
  if (kind !== 'lvSimpsonEF' ||
      clean(gold?.measurementKind) !== kind ||
      finitePositive(gold?.value) === null) {
    return failure('EF gold result unavailable');
  }
  const composite = gold?.compositeResult || {};
  const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
  const components: GoldComponent[] = composite.components;
  if (!Array.isArray(components) || components.length !== slots.length) {
    return failure('EF gold sources incomplete');
  }
  const selected = slots.map(slot =>
    components.filter(component => clean(component?.slot) === slot));
  if (selected.some(matches => matches.length !== 1 || !validSource(matches[0]))) {
    return failure('EF gold source frames invalid');
  }
  const sources = selected.map(matches => matches[0]);
  const studyIds = new Set(sources.map(source => clean(source.target?.studyInstanceUID)));
  const annotationIds = new Set(sources.map(source => clean(source.annotationId)));
  const frameIds = new Set(sources.map(source => {
    const target = source.target || {};
    return [target.seriesInstanceUID, target.sopInstanceUID, target.frameNumber].join('|');
  }));
  if (studyIds.size !== 1 || annotationIds.size !== slots.length ||
      frameIds.size !== slots.length) {
    return failure('EF gold source identity conflict');
  }
  const derived = { ...(composite.derived || {}) };
  const areas: Record<string, number> = {};
  for (let index = 0; index < slots.length; index++) {
    const source = sources[index];
    const target = source.target || {};
    // The saved image path must itself name the exact SOP and 1-based frame.
    // A valid frame suffix alone is not sufficient to establish image identity.
    const imagePath = clean(target.referencedImageId);
    const match = imagePath.match(/\/instances\/([^/?#]+)\/frames\/([1-9][0-9]*)(?:[/?#]|$)/i);
    if (!match || decodeURIComponent(match[1]) !== clean(target.sopInstanceUID) ||
        Number(match[2]) !== Number(target.frameNumber)) {
      return failure(slots[index] + ': EF gold image/frame mismatch');
    }
    const value = finitePositive(await calibrate(source));
    if (value === null) {
      return failure(slots[index] + ': exact DICOM calibration unavailable');
    }
    const previous = finitePositive(composite.derived?.slotAreaCM2?.[slots[index]]);
    if (previous !== null && Math.abs(previous - value) > 0.02) {
      return failure(slots[index] + ': saved EF area disagrees with DICOM calibration');
    }
    areas[slots[index]] = value;
  }
  return {
    ok: true as const,
    derived: { ...derived, slotAreaCM2: areas },
    calibratedSlots: [...slots],
  };
}
