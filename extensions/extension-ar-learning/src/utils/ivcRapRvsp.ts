/**
 * Education-only composition of previously recorded calibrated quiz sources.
 * This never writes to the clinical report or infers RAP from IVC percentage.
 * Viewer and AR validate the versioned JSON contract independently.
 */
export const IVC_RAP_RVSP_METHOD = 'ivc-rap-rvsp-v1';
export const RAP_CHOICES_MMHG = [3, 8, 15] as const;

function clean(value: unknown): string { return String(value ?? '').trim(); }
function finite(value: unknown): number | null {
  if (value === null || value === undefined || clean(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function hasSourceTarget(target: any): boolean {
  return !!clean(target?.studyInstanceUID) &&
    !!clean(target?.seriesInstanceUID) &&
    !!clean(target?.sopInstanceUID) &&
    Number.isInteger(Number(target?.frameNumber)) &&
    Number(target?.frameNumber) >= 1;
}
function validCaliperComponents(value: any): boolean {
  const parts = value?.compositeResult?.components;
  if (!Array.isArray(parts) || parts.length !== 2) return false;
  const slots = new Set(parts.map((part: any) => clean(part?.slot)));
  if (slots.size !== 2 || !slots.has('IVC_EXP') || !slots.has('IVC_INSP')) return false;
  return parts.every((part: any) =>
    clean(part?.annotationId) &&
    hasSourceTarget(part?.target) &&
    Array.isArray(part?.points) && part.points.length === 2 &&
    part.points.every((point: any) =>
      Array.isArray(point) && point.length === 3 &&
      point.every((coordinate: unknown) => finite(coordinate) !== null)
    )
  );
}

/**
 * A RAP selection is informed by an explicitly reviewed pair of IVC calipers.
 * Reject acceptance if the source identifiers, frames, geometry, or calculated
 * collapse changed since the review checkpoint.
 */
export function isIVCReviewCurrent(reviewed: any, latest: any): boolean {
  if (reviewed?.measurementKind !== 'ivcCollapsibility' ||
      latest?.measurementKind !== 'ivcCollapsibility') return false;
  const a = reviewed?.compositeResult;
  const b = latest?.compositeResult;
  if (a?.methodId !== 'ivc-collapsibility-v1' ||
      b?.methodId !== 'ivc-collapsibility-v1' ||
      !validCaliperComponents(reviewed) ||
      !validCaliperComponents(latest)) return false;
  const aValue = finite(reviewed?.value);
  const bValue = finite(latest?.value);
  if (aValue === null || bValue === null ||
      Math.abs(aValue - bValue) > 0.005) return false;
  const slots = ['IVC_EXP', 'IVC_INSP'];
  return slots.every(slot => {
    const aPart = a.components.find((part: any) => part.slot === slot);
    const bPart = b.components.find((part: any) => part.slot === slot);
    if (clean(aPart.annotationId) !== clean(bPart.annotationId)) return false;
    if (!['studyInstanceUID', 'seriesInstanceUID', 'sopInstanceUID', 'frameNumber']
      .every(key => clean(aPart.target[key]) === clean(bPart.target[key]))) return false;
    return JSON.stringify(aPart.points) === JSON.stringify(bPart.points);
  });
}

export function composeIVCRapRVSP({
  ivcAnswer,
  rapMMHG,
  trVmaxAnswer,
  trVmaxQuestionKey,
}: {
  ivcAnswer?: any;
  rapMMHG?: unknown;
  trVmaxAnswer?: any;
  trVmaxQuestionKey?: string;
} = {}) {
  const rap = finite(rapMMHG);
  const tr = finite(trVmaxAnswer?.value);
  const collapse = finite(ivcAnswer?.value);

  if (ivcAnswer?.measurementKind !== 'ivcCollapsibility' ||
      ivcAnswer?.compositeResult?.methodId !== 'ivc-collapsibility-v1' ||
      ivcAnswer?.unit !== '%' || collapse === null || collapse < 0 || collapse > 100 ||
      !validCaliperComponents(ivcAnswer)) {
    return { status: 'unavailable' as const, reason: 'ivc-caliper-evidence-incomplete' };
  }
  if (!RAP_CHOICES_MMHG.includes(rap as 3 | 8 | 15)) {
    return { status: 'unavailable' as const, reason: 'select-rap-3-8-or-15' };
  }
  if (!clean(trVmaxQuestionKey) ||
      trVmaxAnswer?.measurementKind !== 'trVmax' ||
      trVmaxAnswer?.unit !== 'm/s' ||
      tr === null || tr <= 0 || tr > 8 ||
      !clean(trVmaxAnswer?.sourceAnnotationId) ||
      !hasSourceTarget(trVmaxAnswer?.viewerTarget)) {
    return { status: 'unavailable' as const, reason: 'previous-tr-vmax-required' };
  }

  const gradientMMHG = Number((4 * tr * tr).toFixed(2));
  const rvspMMHG = Number((gradientMMHG + rap).toFixed(2));
  return {
    status: 'complete' as const,
    measurementKind: 'ivcRapRvsp',
    measurementType: 'ivcRapRvsp',
    value: rvspMMHG,
    unit: 'mmHg',
    compositeResult: {
      schemaVersion: 1,
      methodId: IVC_RAP_RVSP_METHOD,
      ivc: ivcAnswer,
      rapMMHG: rap,
      trVmax: {
        questionKey: clean(trVmaxQuestionKey),
        answer: trVmaxAnswer,
      },
      trGradientMMHG: gradientMMHG,
      rvspMMHG,
    },
  };
}
