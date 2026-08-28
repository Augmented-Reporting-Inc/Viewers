export const BOWEL_CURVED_LENGTH_MEASUREMENT_KIND = 'bowelCurvedLength';
export const BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND = 'length';

export type BowelMeasurementTargetDefinition = {
  key: string;
  label: string;
  valueField: string;
  uomField?: string;
  uom: 'mm' | 'cm';
  decimals: number;
  measurementKinds: readonly string[];
  tenantMode: 'regular' | 'iuscan' | 'all';
  tenantIds?: readonly string[];
};

const BOWEL_SEGMENTS = Object.freeze([
  { label: 'Rectum', prefix: 'BowelRectum', regular: true },
  { label: 'Sigmoid colon', prefix: 'BowelSigmoidColon', regular: true },
  { label: 'Descending colon', prefix: 'BowelDescendingColon', regular: true },
  { label: 'Transverse colon', prefix: 'BowelTransverseColon', regular: true },
  { label: 'Ascending colon', prefix: 'BowelAscendingColon', regular: true },
  { label: 'Cecum', prefix: 'BowelCecum', regular: true },
  { label: 'Ileocecal valve', prefix: 'BowelIleocecalValve', regular: false },
  { label: 'Terminal ileum', prefix: 'BowelTerminalIleum', regular: true },
  { label: 'Ileocolic anastomosis', prefix: 'BowelIleocolicAnastomosis', regular: true },
  { label: 'Neo-terminal ileum', prefix: 'BowelNeoTerminalIleum', regular: true },
  { label: 'Proximal ileum', prefix: 'BowelProximalIleum', regular: true },
]);

const COMPLICATION_SEGMENTS = Object.freeze([
  { label: 'Ileocecal valve', prefix: 'BowelIleocecalValve' },
  { label: 'Terminal ileum', prefix: 'BowelTerminalIleum' },
  { label: 'Ileocolic anastomosis', prefix: 'BowelIleocolicAnastomosis' },
  { label: 'Neo-terminal ileum', prefix: 'BowelNeoTerminalIleum' },
]);

function buildTarget({
  label,
  valueField,
  uom,
  decimals,
  measurementKinds,
  tenantMode,
  tenantIds,
  uomField = `${valueField}UOM`,
}: Omit<BowelMeasurementTargetDefinition, 'key' | 'uomField'> & {
  uomField?: string;
}): BowelMeasurementTargetDefinition {
  return Object.freeze({
    key: `bowel.${valueField}`,
    label,
    valueField,
    ...(uomField ? { uomField } : {}),
    uom,
    decimals,
    measurementKinds: Object.freeze([...measurementKinds]),
    tenantMode,
    ...(tenantIds?.length ? { tenantIds: Object.freeze([...tenantIds]) } : {}),
  });
}

const regularBwtTargets = BOWEL_SEGMENTS.filter(segment => segment.regular).map(segment =>
  buildTarget({
    label: `${segment.label} BWT`,
    valueField: `${segment.prefix}BWT`,
    uom: 'mm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'regular',
  })
);

regularBwtTargets.push(
  buildTarget({
    label: 'Cecum appendix diameter',
    valueField: 'BowelCecumAppendix',
    uom: 'mm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'regular',
    tenantIds: ['ibd'],
    uomField: '',
  })
);

const iuscanThicknessTargets = BOWEL_SEGMENTS.flatMap(segment => [
  buildTarget({
    label: `${segment.label} BWT longitudinal`,
    valueField: `${segment.prefix}BWTLong`,
    uom: 'mm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'iuscan',
  }),
  buildTarget({
    label: `${segment.label} BWT cross-section`,
    valueField: `${segment.prefix}BWTCross`,
    uom: 'mm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'iuscan',
  }),
  buildTarget({
    label: `${segment.label} submucosa longitudinal`,
    valueField: `${segment.prefix}SubmucosaLong`,
    uom: 'mm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'iuscan',
  }),
  buildTarget({
    label: `${segment.label} submucosa cross-section`,
    valueField: `${segment.prefix}SubmucosaCross`,
    uom: 'mm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'iuscan',
  }),
]);

const iuscanStraightStrictureTargets = COMPLICATION_SEGMENTS.flatMap(segment => [
  buildTarget({
    label: `${segment.label} stricture maximum BWT`,
    valueField: `${segment.prefix}StrictureMaxBWT`,
    uom: 'cm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'iuscan',
  }),
  buildTarget({
    label: `${segment.label} minimal luminal diameter`,
    valueField: `${segment.prefix}StrictureMinimalLuminalDiameter`,
    uom: 'cm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'iuscan',
  }),
  buildTarget({
    label: `${segment.label} upstream dilation`,
    valueField: `${segment.prefix}StrictureUpstreamDilation`,
    uom: 'cm',
    decimals: 2,
    measurementKinds: [BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'iuscan',
  }),
]);

const sharedCurvedSegmentLengthTargets = [
  buildTarget({
    label: 'Terminal ileum segment length involved',
    valueField: 'BowelTerminalIleumSegmentLength',
    uom: 'cm',
    decimals: 1,
    measurementKinds: [BOWEL_CURVED_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'all',
  }),
  buildTarget({
    label: 'Neo-terminal ileum segment length involved',
    valueField: 'BowelNeoTerminalIleumSegmentLength',
    uom: 'cm',
    decimals: 1,
    measurementKinds: [BOWEL_CURVED_LENGTH_MEASUREMENT_KIND],
    tenantMode: 'all',
  }),
];

const iuscanCurvedStrictureTargets = COMPLICATION_SEGMENTS.map(segment =>
    buildTarget({
      label: `${segment.label} stricture length`,
      valueField: `${segment.prefix}StrictureLength`,
      uom: 'cm',
      decimals: 2,
      measurementKinds: [BOWEL_CURVED_LENGTH_MEASUREMENT_KIND],
      tenantMode: 'iuscan',
    })
  );

export const BOWEL_VIEWER_REPORT_TARGETS: readonly BowelMeasurementTargetDefinition[] =
  Object.freeze([
    ...regularBwtTargets,
    ...iuscanThicknessTargets,
    ...iuscanStraightStrictureTargets,
    ...sharedCurvedSegmentLengthTargets,
    ...iuscanCurvedStrictureTargets,
  ]);

const BOWEL_TARGET_BY_KEY = new Map(BOWEL_VIEWER_REPORT_TARGETS.map(target => [target.key, target]));

function normalizeTargetText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function targetMatchesMeasurementKind(target: BowelMeasurementTargetDefinition, measurementKind = '') {
  const kind = String(measurementKind || '').trim();
  return !kind || target.measurementKinds.includes(kind);
}

export function getBowelStraightLengthLabelItems({ isIuscan = false, tenantId = '' } = {}) {
  const tenantMode = isIuscan ? 'iuscan' : 'regular';
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();

  return BOWEL_VIEWER_REPORT_TARGETS.filter(
    target =>
      target.tenantMode === tenantMode &&
      (!target.tenantIds?.length || target.tenantIds.includes(normalizedTenantId)) &&
      target.measurementKinds.includes(BOWEL_STRAIGHT_LENGTH_MEASUREMENT_KIND)
  ).map(target => ({
    value: target.valueField,
    label: target.label,
  }));
}

export function getBowelCurvedLengthTargetOptions({ isIuscan = false } = {}) {
  const tenantMode = isIuscan ? 'iuscan' : 'regular';

  return BOWEL_VIEWER_REPORT_TARGETS.filter(
    target =>
      (target.tenantMode === 'all' || target.tenantMode === tenantMode) &&
      target.measurementKinds.includes(BOWEL_CURVED_LENGTH_MEASUREMENT_KIND)
  ).map(target => ({
    value: target.key,
    key: target.key,
    label: target.label,
    valueField: target.valueField,
    uomField: target.uomField,
    uom: target.uom,
  }));
}

export function findBowelMeasurementTarget({
  targetKey = '',
  label = '',
  measurementKind = '',
}: {
  targetKey?: string;
  label?: string;
  measurementKind?: string;
} = {}) {
  const direct = BOWEL_TARGET_BY_KEY.get(String(targetKey || '').trim());

  if (direct && targetMatchesMeasurementKind(direct, measurementKind)) {
    return direct;
  }

  const normalizedLabel = normalizeTargetText(label);
  if (!normalizedLabel) {
    return null;
  }

  return (
    BOWEL_VIEWER_REPORT_TARGETS.find(target => {
      if (!targetMatchesMeasurementKind(target, measurementKind)) {
        return false;
      }

      return [target.key, target.valueField, target.label].some(
        candidate => normalizeTargetText(candidate) === normalizedLabel
      );
    }) || null
  );
}

export function normalizeBowelMeasurementTargetSelection(
  value: unknown,
  { measurementKind = '' } = {}
) {
  let raw = value;

  if (raw && typeof raw === 'object') {
    const objectValue = raw as Record<string, unknown>;
    raw = objectValue.value || objectValue.key || objectValue.label || '';
  }

  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  return findBowelMeasurementTarget({
    targetKey: text,
    label: text,
    measurementKind,
  });
}
