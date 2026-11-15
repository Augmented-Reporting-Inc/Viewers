/**
 * Preserve independent source evidence for guided learner IVC composites.
 * Only exact Cornerstone-native Length annotations can repair an omitted
 * MeasurementService snapshot entry. No answer geometry is promoted to evidence.
 */
const clean = (value: unknown) => String(value ?? '').trim();
const identity = (annotation: any) =>
  clean(annotation?.uid || annotation?.annotationId || annotation?.annotationUID || annotation?.id);

const targetOf = (annotation: any) => {
  const metadata = annotation?.metadata || {};
  const image = clean(metadata.referencedImageId || annotation?.referencedImageId);
  const match = image.match(/\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)(?:\/frames\/(\d+))?/i);
  return {
    studyInstanceUID: clean(annotation?.StudyInstanceUID || annotation?.referenceStudyUID || metadata.StudyInstanceUID || match?.[1]),
    seriesInstanceUID: clean(annotation?.SeriesInstanceUID || annotation?.referenceSeriesUID || metadata.SeriesInstanceUID || match?.[2]),
    sopInstanceUID: clean(annotation?.SOPInstanceUID || metadata.SOPInstanceUID || match?.[3]),
    frameNumber: Number(annotation?.frameNumber || match?.[4]),
  };
};

const matchesTarget = (left: any, right: any) =>
  ['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID'].every(
    key => clean(left?.[key]) !== '' && clean(left?.[key]) === clean(right?.[key])
  ) && Number.isInteger(Number(left?.frameNumber)) && Number(left.frameNumber) > 0 &&
  Number(left.frameNumber) === Number(right?.frameNumber);

const nativePoints = (item: any) => item?.data?.handles?.points;
const storedPoints = (item: any) => item?.points;
const samePoints = (left: any, right: any) =>
  Array.isArray(left) && left.length === 2 && Array.isArray(right) &&
  right.length === 2 && JSON.stringify(left) === JSON.stringify(right);

export function reconcileLearnerIvcSnapshotSources({
  evidence, snapshotAnnotations = [], nativeAnnotations = [], excludedIds = new Set<string>(),
}: {
  evidence?: any;
  snapshotAnnotations?: any[];
  nativeAnnotations?: any[];
  excludedIds?: Set<string>;
} = {}): { recovered: any[]; missing: string[] } {
  const ivc = evidence?.ivc;
  if (!ivc || ivc.measurementKind !== 'ivcCollapsibility') {
    return { recovered: [], missing: [] };
  }

  const components = ivc?.compositeResult?.components;
  const expected = [
    { slot: 'IVC_EXP', label: 'IVCexp', description: 'expiration' },
    { slot: 'IVC_INSP', label: 'IVCinsp', description: 'inspiration' },
  ];
  if (!Array.isArray(components) || components.length !== 2) {
    return { recovered: [], missing: ['IVC expiration', 'IVC inspiration'] };
  }

  const recovered: any[] = [];
  const missing: string[] = [];
  for (const phase of expected) {
    const part = components.find((entry: any) => entry?.slot === phase.slot);
    const annotationId = clean(part?.annotationId);
    const partTarget = part?.target;
    if (!annotationId || excludedIds.has(annotationId) ||
        !samePoints(part?.points, part?.points) || !matchesTarget(partTarget, partTarget)) {
      missing.push(`IVC ${phase.description}`);
      continue;
    }

    const existing = snapshotAnnotations.find(item => identity(item) === annotationId);
    if (existing) {
      if (existing.toolName !== 'Length' ||
          !matchesTarget(targetOf(existing), partTarget) ||
          !samePoints(storedPoints(existing), part.points)) {
        missing.push(`IVC ${phase.description}`);
      }
      continue;
    }

    const native = nativeAnnotations.find(item => identity(item) === annotationId);
    const metadata = native?.metadata || {};
    const points = nativePoints(native);
    if (!native || metadata.toolName !== 'Length' ||
        native?.isLocked || native?.isVisible === false ||
        metadata.arMeasurementWorkflow === 'viewerQuizGoldDisplay' ||
        metadata.arMeasurementReadOnly === true ||
        native?.data?.arMeasurementReadOnly === true ||
        !matchesTarget(targetOf(native), partTarget) ||
        !samePoints(points, part.points)) {
      missing.push(`IVC ${phase.description}`);
      continue;
    }

    recovered.push({
      annotationId, uid: annotationId, workflow: 'viewerMeasurements',
      role: phase.label, measurementRole: phase.label, label: phase.label,
      domain: 'echo', mode: 'single', toolName: 'Length',
      StudyInstanceUID: partTarget.studyInstanceUID,
      SeriesInstanceUID: partTarget.seriesInstanceUID,
      SOPInstanceUID: partTarget.sopInstanceUID,
      frameNumber: Number(partTarget.frameNumber),
      referencedImageId: clean(metadata.referencedImageId),
      FrameOfReferenceUID: clean(metadata.FrameOfReferenceUID),
      displaySetInstanceUID: clean(metadata.displaySetInstanceUID),
      referenceSeriesUID: partTarget.seriesInstanceUID,
      points: points.map((point: any) => [...point]),
    });
  }

  return { recovered, missing };
}
