import {
  restPLAX,
  restSAXBase,
  restSAXMid,
  restSAXApex,
  restApical4,
  restApical2,
  restApical3,
  lowDosePLAX,
  lowDoseSAXBase,
  lowDoseSAXMid,
  lowDoseSAXApex,
  lowDoseApical4,
  lowDoseApical2,
  lowDoseApical3,
  peakDosePLAX,
  peakDoseSAXBase,
  peakDoseSAXMid,
  peakDoseSAXApex,
  peakDoseApical4,
  peakDoseApical2,
  peakDoseApical3,
  recoveryPLAX,
  recoverySAXBase,
  recoverySAXMid,
  recoverySAXApex,
  recoveryApical4,
  recoveryApical2,
  recoveryApical3,
} from './utils/hpViewports';

const PROTOCOL_PREFIX = 'extension-dobutamine.hangingProtocolModule.';

const BASE_PROTOCOL = {
  locked: true,
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2026-06-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
};

const makeGridStage = (name, rows, columns, viewports) => ({
  name,
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows,
      columns,
    },
  },
  viewports,
});

const STAGE_MATCHES = {
  // Philips dobutamine sample uses StageName: "Base" for resting/baseline.
  resting: ['Base', 'Baseline', 'Rest', 'Resting'],

  // Keep these broad enough for common vendor spellings.
  lowDose: ['Low dose', 'Low-dose', 'LowDose', 'Low Dose', 'Low'],
  peakDose: [
    'Peak dose',
    'Peak-dose',
    'PeakDose',
    'Peak Dose',
    'Peak',
    'High dose',
    'High-dose',
    'HighDose',
    'High',
  ],
  recovery: ['Recovery', 'Recover', 'Post', 'Post stress', 'Post-stress'],
};

const VIEW_MATCHES = {
  PLAX: ['PLAX', 'LAX', 'Parasternal long', 'Parasternal long axis'],
  SAXBase: [
    'SAX_MV',
    'SAX_B',
    'SAX_BASE',
    'SAX base',
    'SAX Base',
    'SAXBASE',
    'PSAX base',
    'PSAX Base',
    'Short axis base',
    'Short-axis base',
    'Base SAX',
    'SAX MV',
    'Mitral',
  ],
  SAXMid: [
    'SAX_P',
    'SAX_PM',
    'SAX mid',
    'SAX Mid',
    'SAXMID',
    'PSAX mid',
    'PSAX Mid',
    'Short axis mid',
    'Short-axis mid',
    'Mid SAX',
    'SAX PM',
    'Papillary',
  ],
  SAXApex: [
    'SAX_AP',
    'SAX_APEX',
    'SAX apex',
    'SAX Apex',
    'SAXAPEX',
    'PSAX apex',
    'PSAX Apex',
    'Short axis apex',
    'Short-axis apex',
    'Apex SAX',
  ],
  Apical4: ['AP_4', 'Apical 4', 'AP4', '4Ch', '4 chamber', 'A4C'],
  Apical2: ['AP_2', 'Apical 2', 'AP2', '2Ch', '2 chamber', 'A2C'],
  Apical3: ['AP_3', 'Apical 3', 'AP3', '3Ch', '3 chamber', 'A3C'],
};

const STAGE_DEFINITIONS = {
  resting: {
    protocolName: 'hpDobutamineResting',
    stageName: 'resting',
    prefix: 'rest',
    stage: makeGridStage('resting', 2, 4, [
      restPLAX,
      restSAXBase,
      restSAXMid,
      restSAXApex,
      restApical4,
      restApical2,
      restApical3,
    ]),
  },
  lowDose: {
    protocolName: 'hpLowDose',
    stageName: 'lowDose',
    prefix: 'lowDose',
    stage: makeGridStage('lowDose', 2, 4, [
      lowDosePLAX,
      lowDoseSAXBase,
      lowDoseSAXMid,
      lowDoseSAXApex,
      lowDoseApical4,
      lowDoseApical2,
      lowDoseApical3,
    ]),
  },
  peakDose: {
    protocolName: 'hpPeakDose',
    stageName: 'peakDose',
    prefix: 'peakDose',
    stage: makeGridStage('peakDose', 2, 4, [
      peakDosePLAX,
      peakDoseSAXBase,
      peakDoseSAXMid,
      peakDoseSAXApex,
      peakDoseApical4,
      peakDoseApical2,
      peakDoseApical3,
    ]),
  },
  recovery: {
    protocolName: 'hpDobutamineRecovery',
    stageName: 'recovery',
    prefix: 'recovery',
    stage: makeGridStage('recovery', 2, 4, [
      recoveryPLAX,
      recoverySAXBase,
      recoverySAXMid,
      recoverySAXApex,
      recoveryApical4,
      recoveryApical2,
      recoveryApical3,
    ]),
  },
};

const VIEW_DEFINITIONS = {
  PLAX: {
    protocolName: 'hpPLAX',
    stage: makeGridStage('PLAX', 1, 4, [restPLAX, lowDosePLAX, peakDosePLAX, recoveryPLAX]),
  },
  SAXBase: {
    protocolName: 'hpSAXBase',
    stage: makeGridStage('SAXBase', 1, 4, [
      restSAXBase,
      lowDoseSAXBase,
      peakDoseSAXBase,
      recoverySAXBase,
    ]),
  },
  SAXMid: {
    protocolName: 'hpSAXMid',
    stage: makeGridStage('SAXMid', 1, 4, [
      restSAXMid,
      lowDoseSAXMid,
      peakDoseSAXMid,
      recoverySAXMid,
    ]),
  },
  SAXApex: {
    protocolName: 'hpSAXApex',
    stage: makeGridStage('SAXApex', 1, 4, [
      restSAXApex,
      lowDoseSAXApex,
      peakDoseSAXApex,
      recoverySAXApex,
    ]),
  },
  Apical4: {
    protocolName: 'hpApical4',
    stage: makeGridStage('Apical4', 1, 4, [
      restApical4,
      lowDoseApical4,
      peakDoseApical4,
      recoveryApical4,
    ]),
  },
  Apical2: {
    protocolName: 'hpApical2',
    stage: makeGridStage('Apical2', 1, 4, [
      restApical2,
      lowDoseApical2,
      peakDoseApical2,
      recoveryApical2,
    ]),
  },
  Apical3: {
    protocolName: 'hpApical3',
    stage: makeGridStage('Apical3', 1, 4, [
      restApical3,
      lowDoseApical3,
      peakDoseApical3,
      recoveryApical3,
    ]),
  },
};

const makeDisplaySetSelector = (stageKey, viewKey, displaySetId) => ({
  [displaySetId]: {
    seriesMatchingRules: [
      {
        attribute: 'StageName',
        constraint: {
          containsI: STAGE_MATCHES[stageKey],
        },
        required: true,
      },
      {
        attribute: 'ViewName',
        constraint: {
          containsI: VIEW_MATCHES[viewKey],
        },
        required: true,
      },
    ],
  },
});

const buildSelectorsForStage = stageKey => {
  const { prefix } = STAGE_DEFINITIONS[stageKey];

  return Object.assign(
    {},
    ...Object.keys(VIEW_DEFINITIONS).map(viewKey =>
      makeDisplaySetSelector(stageKey, viewKey, `${prefix}${viewKey}DisplaySet`)
    )
  );
};

const buildSelectorsForView = viewKey =>
  Object.assign(
    {},
    ...Object.entries(STAGE_DEFINITIONS).map(([stageKey, { prefix }]) =>
      makeDisplaySetSelector(stageKey, viewKey, `${prefix}${viewKey}DisplaySet`)
    )
  );

const makeProtocol = (protocolName, displaySetSelectors, stages) => ({
  ...BASE_PROTOCOL,
  id: `${PROTOCOL_PREFIX}${protocolName}`,
  name: protocolName,
  displaySetSelectors,
  stages,
});

const hpDobutamineResting = makeProtocol(
  STAGE_DEFINITIONS.resting.protocolName,
  buildSelectorsForStage('resting'),
  [STAGE_DEFINITIONS.resting.stage]
);

const hpLowDose = makeProtocol(
  STAGE_DEFINITIONS.lowDose.protocolName,
  buildSelectorsForStage('lowDose'),
  [STAGE_DEFINITIONS.lowDose.stage]
);

const hpPeakDose = makeProtocol(
  STAGE_DEFINITIONS.peakDose.protocolName,
  buildSelectorsForStage('peakDose'),
  [STAGE_DEFINITIONS.peakDose.stage]
);

const hpDobutamineRecovery = makeProtocol(
  STAGE_DEFINITIONS.recovery.protocolName,
  buildSelectorsForStage('recovery'),
  [STAGE_DEFINITIONS.recovery.stage]
);

const hpPLAX = makeProtocol(VIEW_DEFINITIONS.PLAX.protocolName, buildSelectorsForView('PLAX'), [
  VIEW_DEFINITIONS.PLAX.stage,
]);

const hpSAXBase = makeProtocol(
  VIEW_DEFINITIONS.SAXBase.protocolName,
  buildSelectorsForView('SAXBase'),
  [VIEW_DEFINITIONS.SAXBase.stage]
);

const hpSAXMid = makeProtocol(
  VIEW_DEFINITIONS.SAXMid.protocolName,
  buildSelectorsForView('SAXMid'),
  [VIEW_DEFINITIONS.SAXMid.stage]
);

const hpSAXApex = makeProtocol(
  VIEW_DEFINITIONS.SAXApex.protocolName,
  buildSelectorsForView('SAXApex'),
  [VIEW_DEFINITIONS.SAXApex.stage]
);

const hpApical4 = makeProtocol(
  VIEW_DEFINITIONS.Apical4.protocolName,
  buildSelectorsForView('Apical4'),
  [VIEW_DEFINITIONS.Apical4.stage]
);

const hpApical2 = makeProtocol(
  VIEW_DEFINITIONS.Apical2.protocolName,
  buildSelectorsForView('Apical2'),
  [VIEW_DEFINITIONS.Apical2.stage]
);

const hpApical3 = makeProtocol(
  VIEW_DEFINITIONS.Apical3.protocolName,
  buildSelectorsForView('Apical3'),
  [VIEW_DEFINITIONS.Apical3.stage]
);

function getHangingProtocolModule() {
  return [
    {
      name: hpDobutamineResting.id,
      protocol: hpDobutamineResting,
    },
    {
      name: hpLowDose.id,
      protocol: hpLowDose,
    },
    {
      name: hpPeakDose.id,
      protocol: hpPeakDose,
    },
    {
      name: hpDobutamineRecovery.id,
      protocol: hpDobutamineRecovery,
    },
    {
      name: hpPLAX.id,
      protocol: hpPLAX,
    },
    {
      name: hpSAXBase.id,
      protocol: hpSAXBase,
    },
    {
      name: hpSAXMid.id,
      protocol: hpSAXMid,
    },
    {
      name: hpSAXApex.id,
      protocol: hpSAXApex,
    },
    {
      name: hpApical4.id,
      protocol: hpApical4,
    },
    {
      name: hpApical2.id,
      protocol: hpApical2,
    },
    {
      name: hpApical3.id,
      protocol: hpApical3,
    },
  ];
}

export default getHangingProtocolModule;
