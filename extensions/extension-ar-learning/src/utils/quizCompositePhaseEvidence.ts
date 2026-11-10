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
  return study === actualStudy && series === actualSeries && sop === actualSop &&
    actualFrame === frame;
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
  const gold = asObject(config.goldMeasurement);
  const goldParts = Array.isArray(gold.compositeResult?.components)
    ? gold.compositeResult.components : [];
  if (gold.value != null && gold.value !== '' && slots.every(slot => {
    const selected = components.find(part => part.slot === slot);
    return goldParts.some(part =>
      clean(part.slot) === slot && clean(part.annotationId) === selected?.id);
  })) return '';
  return components.map(part => part.slot + ':' + part.id).join('|');
}
