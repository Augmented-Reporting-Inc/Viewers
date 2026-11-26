export const acquisitionFields = [
  { key: 'heightCm', label: 'Height (cm)', max: 300 },
  { key: 'weightKg', label: 'Weight (kg)', max: 500 },
  { key: 'ageYears', label: 'Age at acquisition (years)', max: 18 },
] as const;

export function canShowResearchAcquisitionInputs(context: any) {
  const policy = context?.readSchema?.config?.zScore;
  return !!context?.reviewKey && !context.preview &&
    context.readSchema?.domain === 'echo' &&
    context.review?.reviewType === 'independent' &&
    policy?.enabled === true && policy?.readerAnthropometrics === 'override';
}

export function acquisitionInputStrings(values: any = {}) {
  return Object.fromEntries(acquisitionFields.map(({ key }) =>
    [key, typeof values?.[key] === 'number' && Number.isFinite(values[key]) ? String(values[key]) : '']));
}

export function buildAcquisitionOverrideRequest(snapshot: any, inputs: Record<string, string>, reason: string, verified: boolean, modelEligibilityVerified?: boolean) {
  if (!snapshot?.editable || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
      !snapshot.baseline?.values || reason.trim().length > 500) return null;
  const overrides: Record<string, number> = {};
  for (const { key, max } of acquisitionFields) {
    const raw = inputs[key]?.trim() || '';
    const baseline = snapshot.baseline.values[key];
    if (!raw) {
      if (verified || baseline != null) return null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value > max || (key === 'ageYears' ? value < 0 : value <= 0)) return null;
    if (value !== baseline) overrides[key] = value;
  }
  const changed = acquisitionFields.some(({key}) =>
    (overrides[key] ?? snapshot.baseline.values[key]) !==
    (snapshot.overrides?.[key] ?? snapshot.baseline.values[key]));
  const restoring = changed && Object.keys(overrides).length === 0;
  if (changed && !restoring && !reason.trim()) return null;
  return {expectedRevision: snapshot.revision, overrides, reason: reason.trim(), acquisitionVerified: verified,
    ...(typeof modelEligibilityVerified === 'boolean' ? {modelEligibilityVerified: verified && modelEligibilityVerified} : {})};
}

// Collapse only a server-confirmed saved revision, not locally checked boxes.
export function hasVerifiedAcquisitionRevision(snapshot: any, automatic: boolean) {
  return Number.isSafeInteger(snapshot?.revision) && snapshot.revision > 0 &&
    snapshot.acquisitionVerified === true && (!automatic || snapshot.modelEligibilityVerified === true);
}
