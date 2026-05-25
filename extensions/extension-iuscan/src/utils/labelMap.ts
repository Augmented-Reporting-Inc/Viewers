/**
 * Maps measurement label strings (shown in the label picker after each caliper)
 * to { site, axis } tuples used by IUScanAssignmentService.
 *
 * MEASUREMENT_LABELS and LABEL_MAP are generated from SITES.
 * Keep SITES as the single source of truth.
 */
const AXES = [
  { axis: 'longitudinal', suffix: 'Long', label: 'Long' },
  { axis: 'cross', suffix: 'Cross', label: 'Cross' },
];

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

export const MEASUREMENT_LABELS = SITES.flatMap(site => {
  if (site.hasMeasurements === false) return [];

  return AXES.map(({ suffix, label }) => ({
    value: `${site.code}-${suffix}`,
    label: `${site.label} – ${label}`,
  }));
});

export const LABEL_MAP = SITES.reduce((acc, site) => {
  if (site.hasMeasurements === false) return acc;

  for (const { axis, suffix } of AXES) {
    acc[`${site.code}-${suffix}`] = { site: site.key, axis };
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
