// Viewer-side source evidence projection. Kept independent of the echoar portal contract.
function clean(value: any): string { return String(value ?? '').trim(); }
function asObject(value: any): any { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

export function getCompositePhaseSlot(measurement: any, kind: string): string {
  const source = asObject(measurement);
  const measurementKind = clean(source.measurementKind ||
    asObject(source.measurements).measurementKind);
  if (kind === 'rvFAC' || kind === 'raArea') {
    if (measurementKind !== 'echoAreaSlot') return '';
    return clean(source.echoArea?.slot || source.measurements?.echoArea?.slot || source.slot);
  }
  if (kind === 'laVolumeBiplane' || kind === 'laVolumeBiplaneDisks') {
    if (measurementKind !== 'laVolumeSlot') return '';
    return clean(source.laVolume?.slot || source.measurements?.laVolume?.slot || source.slot);
  }
  if (kind === 'ivcCollapsibility' || kind === 'ivcRapRvsp') {
    if (clean(source.toolName) !== 'Length') return '';
    const label = clean(source.label || source.measurementRole || source.role)
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['ivcexp', 'ivcexpiration', 'ivcendexpiration', 'ivcendexpirationdiameter'].includes(label)) {
      return 'IVC_EXP';
    }
    if (['ivcinsp', 'ivcinspiration', 'ivcendinspiration', 'ivcendinspirationdiameter'].includes(label)) {
      return 'IVC_INSP';
    }
  }
  return '';
}

export function getCompositePhaseMeasurementId(measurement: any): string {
  return clean(measurement?.uid || measurement?.annotationUID ||
    measurement?.annotationId || measurement?.id);
}

const PHASE_VALUE_FIELDS: Record<string, Record<string, string>> = {
  rvFAC: { RV_ED: 'edaCM2', RV_ES: 'esaCM2' },
  laVolumeBiplane: { A4C: 'a4cAreaCM2', A2C: 'a2cAreaCM2' },
  laVolumeBiplaneDisks: { A4C: 'a4cAreaCM2', A2C: 'a2cAreaCM2' },
  ivcCollapsibility: {
    IVC_EXP: 'expirationDiameterMM',
    IVC_INSP: 'inspirationDiameterMM',
  },
};

/**
 * Legacy RV/LA answers may contain a valid saved gold and two source contours
 * without the individual physically calibrated area fields. Rehydration must
 * happen automatically when the educator opens that question, not through a
 * dedicated repair button. No source geometry is estimated here.
 */
export function needsSavedCalibratedGoldAreas(question: any): boolean {
  if (question?.type !== 'measurementNumeric') return false;
  const config = asObject(question.answerConfig);
  const kind = clean(config.measurementKind);
  const expectedSlots = kind === 'rvFAC' ? ['RV_ED', 'RV_ES'] :
    ['laVolumeBiplane', 'laVolumeBiplaneDisks'].includes(kind) ? ['A4C', 'A2C'] : null;
  if (!expectedSlots) return false;
  const gold = asObject(config.goldMeasurement);
  if (!Number.isFinite(Number(gold.value)) || gold.value == null || gold.value === '') return false;
  const components = asObject(gold.compositeResult).components;
  if (!Array.isArray(components) || components.length !== expectedSlots.length ||
      expectedSlots.some(slot =>
        components.filter(part => clean(part?.slot) === slot &&
          clean(part?.annotationId) && asObject(part?.target).sopInstanceUID).length !== 1
      )) return false;
  const values = getSavedCompositePhaseValues(gold, kind);
  return expectedSlots.some(slot => values[slot] == null);
}

/** Read only viewer-validated physical gold values. Never infer from raw points. */
export function getSavedCompositePhaseValues(answer: any, kind: string): Record<string, number> {
  const result = asObject(asObject(answer).compositeResult);
  const derived = asObject(result.derived);
  const resultValues: Record<string, number> = {};
  for (const [slot, field] of Object.entries(PHASE_VALUE_FIELDS[kind] || {})) {
    const value = derived[field];
    if (value == null || clean(value) === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) resultValues[slot] = numeric;
  }
  return resultValues;
}


export function getGoldPhaseMeasurementSummary(component: any, kind: string): string {
  const points = component?.points;
  if (!Array.isArray(points) || points.some(point => !Array.isArray(point))) {
    return 'Gold source recorded';
  }
  if (['ivcCollapsibility', 'ivcRapRvsp'].includes(kind)) {
    if (points.length !== 2) return 'Caliper saved';
    const length = Math.hypot(...[0, 1, 2].map(axis =>
      Number(points[1][axis] ?? 0) - Number(points[0][axis] ?? 0)));
    return Number.isFinite(length) && length > 0
      ? 'Diameter ≈ ' + length.toFixed(2) + ' mm' : 'Caliper saved';
  }
  if (points.length < 3) return 'Contour saved';
  const total = [0, 0, 0];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    const az = Number(a[2] ?? 0), bz = Number(b[2] ?? 0);
    total[0] += Number(a[1]) * bz - az * Number(b[1]);
    total[1] += az * Number(b[0]) - Number(a[0]) * bz;
    total[2] += Number(a[0]) * Number(b[1]) - Number(a[1]) * Number(b[0]);
  }
  const cm2 = Math.hypot(...total) / 200;
  return Number.isFinite(cm2) && cm2 > 0
    ? 'Contour area ≈ ' + cm2.toFixed(2) + ' cm²' : 'Contour saved';
}


/**
 * A phase name alone is not sufficient authority to delete a measurement:
 * distinct quiz questions can use the same study and anatomical slot.
 * Match saved evidence by annotation ID, or guided evidence by exact DICOM
 * study/series/SOP/frame identity. Without either, selection is ambiguous.
 */
export function matchesCompositePhaseSource(
  measurement: any,
  source: { annotationId?: string; target?: any } = {}
): boolean {
  const expectedId = clean(source.annotationId);
  if (expectedId) return getCompositePhaseMeasurementId(measurement) === expectedId;

  const target = asObject(source.target);
  const sop = clean(target.sopInstanceUID || target.SOPInstanceUID);
  const study = clean(target.studyInstanceUID || target.StudyInstanceUID);
  const series = clean(target.seriesInstanceUID || target.SeriesInstanceUID);
  const frame = Number(target.frameNumber);
  if (!study || !series || !sop || !Number.isInteger(frame) || frame < 1) return false;
  const actual = asObject(measurement);
  const actualStudy = clean(actual.referenceStudyUID || actual.StudyInstanceUID);
  const actualSeries = clean(actual.referenceSeriesUID || actual.SeriesInstanceUID);
  const actualSop = clean(actual.SOPInstanceUID || actual.metadata?.SOPInstanceUID);
  const actualFrame = Number(actual.frameNumber || actual.metadata?.frameNumber);
  if (study === actualStudy && series === actualSeries && sop === actualSop &&
      actualFrame === frame) return true;
  // Some MeasurementService adapters omit the numeric frame after restoration,
  // but preserve the exact DICOMweb imageId. Compare the *entire* imageId,
  // never just instance/series proximity.
  const expectedImage = clean(target.referencedImageId);
  const actualImage = clean(actual.referencedImageId || actual.metadata?.referencedImageId);
  return Boolean(expectedImage && actualImage && expectedImage === actualImage &&
    study === actualStudy);
}

/**
 * Determines whether an educator's live composite measurement is complete
 * enough to request the existing authoritative quiz-capture command.
 * This is a readiness check only: no numeric gold value is calculated here.
 */
export function getCompositeGoldCaptureSignature(question: any, measurements: any[]): string {
  const kind = clean(question?.answerConfig?.measurementKind);
  const slotsByKind: Record<string, string[]> = {
    rvFAC: ['RV_ED', 'RV_ES'],
    laVolumeBiplane: ['A4C', 'A2C'],
    laVolumeBiplaneDisks: ['A4C', 'A2C'],
    ivcCollapsibility: ['IVC_EXP', 'IVC_INSP'],
    raArea: ['RA_ES'],
  };
  const slots = slotsByKind[kind];
  if (question?.type !== 'measurementNumeric' || !slots) return '';
  const config = asObject(question.answerConfig);
  const guided = config.compositeFrameGuidanceEnabled === true;
  const guidedFrames = asObject(config.compositeFrameTargets);
  const live = Array.isArray(measurements) ? measurements : [];
  const components: any[] = [];
  for (const slot of slots) {
    const target = guidedFrames[slot];
    const candidates = live.filter(item => {
      if (item?.isLocked || item?.arMeasurementReadOnly) return false;
      if (getCompositePhaseSlot(item, kind) !== slot) return false;
      if (guided) return matchesCompositePhaseSource(item, { target });
      return true;
    });
    if (candidates.length !== 1) return '';
    const item = candidates[0];
    const id = getCompositePhaseMeasurementId(item);
    const study = clean(item.referenceStudyUID || item.StudyInstanceUID);
    if (!id || !study) return '';
    components.push({ slot, id, study });
  }
  if (new Set(components.map(part => part.study)).size !== 1) return '';
  const questionTarget = asObject(question.viewerTarget || config.viewerTarget || config.goldTarget);
  const expectedStudy = clean(questionTarget.studyInstanceUID || questionTarget.StudyInstanceUID);
  if (expectedStudy && components[0].study !== expectedStudy) return '';
  const gold = asObject(config.goldMeasurement);
  const goldParts = Array.isArray(gold.compositeResult?.components)
    ? gold.compositeResult.components : [];
  const sameSourceGold = gold.value != null && gold.value !== '' &&
    slots.every(slot => {
      const selected = components.find(part => part.slot === slot);
      return goldParts.some(part =>
        clean(part.slot) === slot && clean(part.annotationId) === selected?.id);
    });
  const signature = components.map(part => part.slot + ':' + part.id).join('|');
  if (!sameSourceGold) return signature;
  const fields = PHASE_VALUE_FIELDS[kind];
  if (fields) {
    const savedValues = getSavedCompositePhaseValues(gold, kind);
    // The caller validates a complete clinical calculation and verifies the
    // stored gold scalar still matches before upgrading an older gold capture.
    if (!slots.every(slot => savedValues[slot] != null)) {
      return 'backfill:' + signature;
    }
  }
  return '';
}

export function findEditableCompositePhaseMeasurement(
  measurements: any[], kind: string, slot: string,
  source: { annotationId?: string; target?: any } = {}
): any | null {
  const target = asObject(source.target);
  const study = clean(target.studyInstanceUID || target.StudyInstanceUID);
  const candidates = (Array.isArray(measurements) ? measurements : []).filter(item => {
    if (item?.isLocked || item?.arMeasurementReadOnly) return false;
    if (getCompositePhaseSlot(item, kind) !== slot) return false;
    const actualStudy = clean(item.referenceStudyUID || item.StudyInstanceUID);
    return !study || (actualStudy && actualStudy === study);
  });
  const exact = candidates.filter(item => matchesCompositePhaseSource(item, source));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 || clean(source.annotationId)) return null;

  // If the source specifies an exact frame, a different identified frame must
  // not silently become the selected/deleted contour.
  const identified = clean(target.sopInstanceUID || target.SOPInstanceUID) &&
    Number.isInteger(Number(target.frameNumber)) && Number(target.frameNumber) > 0;
  if (identified && candidates.some(item =>
    clean(item.SOPInstanceUID || item.metadata?.SOPInstanceUID) &&
    Number.isInteger(Number(item.frameNumber || item.metadata?.frameNumber)) &&
    Number(item.frameNumber || item.metadata?.frameNumber) > 0)) return null;

  // No saved gold identity yet: only a unique phase in this study is safe.
  return candidates.length === 1 ? candidates[0] : null;
}

/** Clear one authoritatively saved gold phase without requiring its annotation
 * to be hydrated on the current viewport. The saved annotation identity is the
 * authority; never select an arbitrary same-slot live contour as a substitute.
 * A missing/mismatched saved phase is a no-op (another edit may have won). */
export function clearSavedCompositeGoldPhase(
  question: any, slot: string, expectedAnnotationId: string
): any | null {
  const config = asObject(question?.answerConfig);
  const gold = asObject(config.goldMeasurement);
  const composite = asObject(gold.compositeResult);
  const components = Array.isArray(composite.components) ? composite.components : [];
  const matching = components.filter(part => clean(part?.slot) === slot);
  if (!clean(expectedAnnotationId) || matching.length !== 1 ||
      clean(matching[0]?.annotationId) !== clean(expectedAnnotationId)) return null;

  const surviving = components.filter(part => clean(part?.slot) !== slot);
  const configuredTargets = asObject(config.compositeFrameTargets);
  const oldTarget = asObject(matching[0].target);
  const configured = asObject(configuredTargets[slot]);
  const sameTarget = ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID']
    .every(key => clean(configured[key]) && clean(configured[key]) === clean(oldTarget[key])) &&
    Number(configured.frameNumber) === Number(oldTarget.frameNumber);
  const nextTargets = { ...configuredTargets };
  // Do not discard a newer educator-selected replacement source.
  if (sameTarget) delete nextTargets[slot];

  return {
    ...question,
    answerConfig: {
      ...config,
      compositeFrameTargets: nextTargets,
      goldValue: null,
      goldMeasurement: surviving.length ? {
        ...gold,
        value: null,
        sourceAnnotationId: clean(surviving[0]?.annotationId),
        // Derived values are tied to the COMPLETE former contour pair.
        // Do not retain old A2C/ED or calculated values after deletion.
        compositeResult: { ...composite, value: null, derived: null, components: surviving },
      } : null,
    },
  };
}

/** Compare the FormAPI readback to the just-saved quiz. Session storage does
 * not prove persistence, so a missing gold value or contour must be reported. */
export function getCompositeGoldPersistenceError(expectedQuestions: any[], persistedQuestions: any[]): string {
  const remoteByKey = new Map((Array.isArray(persistedQuestions) ? persistedQuestions : [])
    .map(question => [clean(question?.questionKey), question]));
  for (const question of Array.isArray(expectedQuestions) ? expectedQuestions : []) {
    const config = asObject(question?.answerConfig);
    const kind = clean(config.measurementKind);
    if (!['rvFAC', 'laVolumeBiplane', 'laVolumeBiplaneDisks', 'ivcCollapsibility', 'raArea']
      .includes(kind)) continue;
    const gold = asObject(config.goldMeasurement);
    const parts = Array.isArray(gold.compositeResult?.components)
      ? gold.compositeResult.components : [];
    const hasGold = gold.value != null && gold.value !== '' && parts.length > 0;
    const remote = remoteByKey.get(clean(question.questionKey));
    if (!remote) return 'Question ' + clean(question.questionKey) + ' is missing from the saved draft.';
    const remoteConfig = asObject(remote.answerConfig);
    if (config.compositeFrameGuidanceEnabled === true) {
      for (const [slot, source] of Object.entries(asObject(config.compositeFrameTargets))) {
        const expected = asObject(source);
        const actual = asObject(remoteConfig.compositeFrameTargets)[slot];
        if (!actual || ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID'].some(
          field => clean(expected[field]) !== clean(actual[field])
        ) || Number(expected.frameNumber) !== Number(actual.frameNumber)) {
          return kind + ' ' + slot + ' saved source frame was not persisted.';
        }
      }
    }
    if (!hasGold) {
      // A successful HTTP save is not evidence of deletion if the server
      // silently preserved an older full calculated gold answer.
      const actualGold = asObject(remoteConfig.goldMeasurement);
      if (actualGold.value != null && actualGold.value !== '' ||
          remoteConfig.goldValue != null && remoteConfig.goldValue !== '') {
        return kind + ' cleared gold answer was not persisted.';
      }
      continue;
    }
    const actualGold = asObject(remoteConfig.goldMeasurement);
    const actualParts = Array.isArray(actualGold.compositeResult?.components)
      ? actualGold.compositeResult.components : [];
    if (!Number.isFinite(Number(actualGold.value)) ||
        Number(actualGold.value) !== Number(gold.value) ||
        parts.length !== actualParts.length ||
        parts.some(part => !actualParts.some(saved =>
          clean(saved?.slot) === clean(part?.slot) &&
          clean(saved?.annotationId) === clean(part?.annotationId) &&
          Number(saved?.target?.frameNumber) === Number(part?.target?.frameNumber) &&
          (!Array.isArray(part?.points) || (
            Array.isArray(saved?.points) && saved.points.length === part.points.length))
        ))) {
      return kind + ' saved gold measurement or contour evidence was not persisted.';
    }
    const phaseValues = getSavedCompositePhaseValues(gold, kind);
    const remoteValues = getSavedCompositePhaseValues(actualGold, kind);
    if (Object.keys(phaseValues).some(slot => remoteValues[slot] !== phaseValues[slot])) {
      return kind + ' calibrated gold phase values were not persisted.';
    }
  }
  return '';
}
