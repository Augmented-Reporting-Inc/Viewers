/**
 * Maps measurement label strings (shown in the label picker after each caliper)
 * to { site, axis } tuples used by IUScanAssignmentService.
 *
 * MEASUREMENT_LABELS and LABEL_MAP are generated from SITES.
 * Keep SITES as the single source of truth.
 */
export const MEASUREMENT_GROUPS = [
  {
    stateKey: 'longitudinal',
    role: 'bwt',
    axis: 'longitudinal',
    suffix: 'BWTLong',
    labelSuffix: 'BWT-Long',
    label: 'BWT Longitudinal',
    shortLabel: 'BWT Long',
  },
  {
    stateKey: 'cross',
    role: 'bwt',
    axis: 'cross',
    suffix: 'BWTCross',
    labelSuffix: 'BWT-Cross',
    label: 'BWT Cross-section',
    shortLabel: 'BWT Cross',
  },
  {
    stateKey: 'submucosaLongitudinal',
    role: 'submucosa',
    axis: 'longitudinal',
    suffix: 'SubmucosaLong',
    labelSuffix: 'Submucosa-Long',
    label: 'Submucosa Longitudinal',
    shortLabel: 'Submucosa Long',
  },
  {
    stateKey: 'submucosaCross',
    role: 'submucosa',
    axis: 'cross',
    suffix: 'SubmucosaCross',
    labelSuffix: 'Submucosa-Cross',
    label: 'Submucosa Cross-section',
    shortLabel: 'Submucosa Cross',
  },
];

export const MEASUREMENT_SLOT_KEYS = MEASUREMENT_GROUPS.map(({ stateKey }) => stateKey);

const LABEL_MODAL_BOTTOM_SITE_KEYS = new Set(['rectum', 'ileocecalValve']);
/**
 * Ordered list of anatomical sites.
 * Order determines accordion display order in the panel.
 * mongoPrefix matches existing Mongo Series schema field prefixes.
 */
export const SITES = [
  {
    key: 'rectum',
    code: 'RC',
    label: 'Rectum',
    mongoPrefix: 'BowelRectum',
    hasHaustrations: true,
  },
  {
    key: 'sigmoidColon',
    code: 'SC',
    label: 'Sigmoid Colon',
    mongoPrefix: 'BowelSigmoidColon',
    hasHaustrations: true,
  },
  {
    key: 'descendingColon',
    code: 'DC',
    label: 'Descending Colon',
    mongoPrefix: 'BowelDescendingColon',
    hasHaustrations: true,
  },
  {
    key: 'transverseColon',
    code: 'TC',
    label: 'Transverse Colon',
    mongoPrefix: 'BowelTransverseColon',
    hasHaustrations: true,
  },
  {
    key: 'ascendingColon',
    code: 'AC',
    label: 'Ascending Colon',
    mongoPrefix: 'BowelAscendingColon',
    hasHaustrations: true,
  },
  {
    key: 'cecum',
    code: 'CEC',
    label: 'Cecum',
    mongoPrefix: 'BowelCecum',
    hasHaustrations: true,
  },
  {
    key: 'ileocecalValve',
    code: 'ICV',
    label: 'Ileocecal Valve',
    mongoPrefix: 'BowelIleocecalValve',
    hasComplications: true,
  },
  {
    key: 'terminalIleum',
    code: 'TI',
    label: 'Terminal Ileum',
    mongoPrefix: 'BowelTerminalIleum',
    hasSegmentLength: true,
    hasComplications: true,
  },
  {
    key: 'ileocolicAnastomosis',
    code: 'ICA',
    label: 'Ileocolic Anastomosis',
    mongoPrefix: 'BowelIleocolicAnastomosis',
    hasComplications: true,
  },
  {
    key: 'neoTerminalIleum',
    code: 'NTI',
    label: 'Neo-terminal Ileum',
    mongoPrefix: 'BowelNeoTerminalIleum',
    hasSegmentLength: true,
    hasComplications: true,
  },
];

const MEASUREMENT_LABEL_SITE_ORDER = [
  ...SITES.filter(site => !LABEL_MODAL_BOTTOM_SITE_KEYS.has(site.key)),
  ...SITES.filter(site => LABEL_MODAL_BOTTOM_SITE_KEYS.has(site.key)),
];

const getMeasurementLabelValue = (site, group) => `${site.code}-${group.labelSuffix}`;

export const MEASUREMENT_LABELS = MEASUREMENT_LABEL_SITE_ORDER.flatMap(site => {
  if (site.hasMeasurements === false) {
    return [];
  }

  return MEASUREMENT_GROUPS.map(group => ({
    value: getMeasurementLabelValue(site, group),
    label: `${site.label} – ${group.shortLabel}`,
  }));
});

export const LABEL_MAP = SITES.reduce((acc, site) => {
  if (site.hasMeasurements === false) {
    return acc;
  }

  for (const group of MEASUREMENT_GROUPS) {
    acc[getMeasurementLabelValue(site, group)] = {
      site: site.key,
      axis: group.stateKey,
      stateKey: group.stateKey,
      role: group.role,
      measurementAxis: group.axis,
      suffix: group.suffix,
    };
  }

  return acc;
}, {});

export const HAUSTRATION_REVERSE = {
  Present: 1,
  Absent: 0,
};

export const COMPLICATION_TYPES = [
  { value: 'stricture', label: 'Stricture' },
  { value: 'fistula', label: 'Fistula' },
  { value: 'sinus tract', label: 'Sinus tract' },
  { value: 'abscess', label: 'Abscess' },
  { value: 'inflammatory mass', label: 'Inflammatory mass' },
];

/**
 * Doppler score integer → Mongo string value.
 * Matches existing ak_series.json values: "0", "I", "II", "III"
 */
export const DOPPLER_MAP = ['0', 'I', 'II', 'III'];

/**
 * Reverse map for hydration: Mongo Doppler string → integer score
 */
export const DOPPLER_REVERSE = {
  // legacy Roman numeral values
  '0': 0,
  I: 1,
  II: 2,
  III: 3,
  // new descriptive values
  '1': 1,
  '2': 2,
  '3': 3,
};
