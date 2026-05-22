/**
 * Maps measurement label strings (shown in the label picker after each caliper)
 * to { site, axis } tuples used by IUScanAssignmentService.
 *
 * Keep in sync with the measurementLabels array in extension-iuscan/src/index.js
 * onModeEnter.
 */
export const LABEL_MAP = {
  'SC-Long': { site: 'sigmoidColon', axis: 'longitudinal' },
  'SC-Cross': { site: 'sigmoidColon', axis: 'cross' },
  'DC-Long': { site: 'descendingColon', axis: 'longitudinal' },
  'DC-Cross': { site: 'descendingColon', axis: 'cross' },
  'TC-Long': { site: 'transverseColon', axis: 'longitudinal' },
  'TC-Cross': { site: 'transverseColon', axis: 'cross' },
  'AC-Long': { site: 'ascendingColon', axis: 'longitudinal' },
  'AC-Cross': { site: 'ascendingColon', axis: 'cross' },
  'TI-Long': { site: 'terminalIleum', axis: 'longitudinal' },
  'TI-Cross': { site: 'terminalIleum', axis: 'cross' },
  'ICA-Long': { site: 'ileocolicAnastomosis', axis: 'longitudinal' },
  'ICA-Cross': { site: 'ileocolicAnastomosis', axis: 'cross' },
  'NTI-Long': { site: 'neoTerminalIleum', axis: 'longitudinal' },
  'NTI-Cross': { site: 'neoTerminalIleum', axis: 'cross' },
};

/**
 * Ordered list of anatomical sites.
 * Order determines accordion display order in the panel.
 * mongoPrefix matches existing Mongo Series schema field prefixes.
 */
export const SITES = [
  {
    key: 'sigmoidColon',
    label: 'Sigmoid Colon',
    mongoPrefix: 'BowelSigmoidColon',
  },
  {
    key: 'descendingColon',
    label: 'Descending Colon',
    mongoPrefix: 'BowelDescendingColon',
  },
  {
    key: 'transverseColon',
    label: 'Transverse Colon',
    mongoPrefix: 'BowelTransverseColon',
  },
  {
    key: 'ascendingColon',
    label: 'Ascending Colon',
    mongoPrefix: 'BowelAscendingColon',
  },
  {
    key: 'terminalIleum',
    label: 'Terminal Ileum',
    mongoPrefix: 'BowelTerminalIleum',
  },
  {
    key: 'ileocolicAnastomosis',
    label: 'Ileocolic Anastomosis',
    mongoPrefix: 'BowelIleocolicAnastomosis',
  },
  {
    key: 'neoTerminalIleum',
    label: 'Neo-terminal Ileum',
    mongoPrefix: 'BowelNeoTerminalIleum',
  },
];

/**
 * Doppler score integer → Mongo string value.
 * Matches existing ak_series.json values: "0", "I", "II", "III"
 */
export const DOPPLER_MAP = ['0', '1', '2', '3'];

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
