import {
  restLAX,
  restSAX,
  restAP4,
  restAP2,
  restAP3,
  restView6,
  peakLAX,
  peakSAX,
  peakAP4,
  peakAP2,
  peakAP3,
  peakView6,
  recoveryLAX,
  recoverySAX,
  recoveryAP4,
  recoveryAP2,
  recoveryAP3,
  recoveryView6,
} from './utils/hpViewports';

/** stages - determine grid layout
 * represents a 2x3 viewport layout configuration. The layout displays LAX, SAX, and AP4
 * images in the first row, AP3, AP2 and View 6 images in the second row.
 * synchronizers are defined in each viewport
 */
const Rest = {
  name: 'rest',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
    },
  },
  viewports: [restLAX, restSAX, restAP4, restAP3, restAP2, restView6],
};

const Peak = {
  name: 'peak',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
    },
  },
  viewports: [peakLAX, peakSAX, peakAP4, peakAP3, peakAP2, peakView6],
};

const Recovery = {
  name: 'recovery',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
    },
  },
  viewports: [recoveryLAX, recoverySAX, recoveryAP4, recoveryAP3, recoveryAP2, recoveryView6],
};

const LAX = {
  name: 'LAX',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 1,
      columns: 3,
    },
  },
  viewports: [restLAX, peakLAX, recoveryLAX],
};

const SAX = {
  name: 'SAX',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 1,
      columns: 3,
    },
  },
  viewports: [restSAX, peakSAX, recoverySAX],
};

const AP4 = {
  name: 'AP4',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 1,
      columns: 3,
    },
  },
  viewports: [restAP4, peakAP4, recoveryAP4],
};

const AP2 = {
  name: 'AP2',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 1,
      columns: 3,
    },
  },
  viewports: [restAP2, peakAP2, recoveryAP2],
};

const AP3 = {
  name: 'AP3',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 1,
      columns: 3,
    },
  },
  viewports: [restAP3, peakAP3, recoveryAP3],
};

const View6 = {
  name: 'View6',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 1,
      columns: 3,
    },
  },
  viewports: [restView6, peakView6, recoveryView6],
};

// protocol definitions
const hpRest = {
  id: 'extension-stress-echo.hangingProtocolModule.hpRest',
  locked: true,
  // Don't store this hanging protocol as it applies to the currently active
  // display set by default
  // cacheId: null,
  name: 'hpRest',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom', // "default" , "interleaveTopToBottom",  "interleaveCenter"
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  // -1 would be used to indicate active only, whereas other values are
  // the number of required priors referenced - so 0 means active with
  // 0 or more priors.
  displaySetSelectors: {
    restLAXDisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'LAX',
          },
          required: true,
        },
      ],
    },
    restSAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'SAX',
          },
          required: true,
        },
      ],
    },
    restAP4DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP4', '4Ch'],
          },
          required: true,
        },
      ],
    },
    restAP2DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP2', '2Ch'],
          },
          required: true,
        },
      ],
    },
    restAP3DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP3', '3Ch', '3'],
          },
          required: true,
        },
      ],
    },
    restView6DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['View6', '55'],
          },
          required: true,
        },
      ],
    },
  },
  // determines which stage is displayed first
  stages: [Rest],
};

const hpPeak = {
  id: 'extension-stress-echo.hangingProtocolModule.hpPeak',
  locked: true,
  name: 'hpPeak',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    peakLAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'LAX',
          },
          required: true,
        },
      ],
    },
    peakSAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'SAX',
          },
          required: true,
        },
      ],
    },
    peakAP4DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP4', '4Ch'],
          },
          required: true,
        },
      ],
    },
    peakAP2DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP2', '2Ch'],
          },
          required: true,
        },
      ],
    },
    peakAP3DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP3', '3Ch', '3'],
          },
          required: true,
        },
      ],
    },
    peakView6DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['View6', '55', '3'],
          },
          required: true,
        },
      ],
    },
  },
  stages: [Peak],
};

const hpRecovery = {
  id: 'extension-stress-echo.hangingProtocolModule.hpRecovery',
  locked: true,
  name: 'hpRecovery',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    recoveryLAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'LAX',
          },
          required: true,
        },
      ],
    },
    recoverySAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'SAX',
          },
          required: true,
        },
      ],
    },
    recoveryAP4DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP4', '4Ch'],
          },
          required: true,
        },
      ],
    },
    recoveryAP2DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP2', '2Ch'],
          },
          required: true,
        },
      ],
    },
    recoveryAP3DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP3', '3Ch'],
          },
          required: true,
        },
      ],
    },
    recoveryView6DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'View6',
          },
          required: true,
        },
      ],
    },
  },
  stages: [Recovery],
};

const hpLAX = {
  id: 'extension-stress-echo.hangingProtocolModule.hpLAX',
  locked: true,
  name: 'hpLAX',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    restLAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'LAX',
          },
          required: true,
        },
      ],
    },
    peakLAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'LAX',
          },
          required: true,
        },
      ],
    },
    recoveryLAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'LAX',
          },
          required: true,
        },
      ],
    },
  },
  stages: [LAX],
};

const hpSAX = {
  id: 'extension-stress-echo.hangingProtocolModule.hpSAX',
  locked: true,
  name: 'hpSAX',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    restSAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'SAX',
          },
          required: true,
        },
      ],
    },
    peakSAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'SAX',
          },
          required: true,
        },
      ],
    },
    recoverySAXDisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'SAX',
          },
          required: true,
        },
      ],
    },
  },
  stages: [SAX],
};

const hpAP4 = {
  id: 'extension-stress-echo.hangingProtocolModule.hpAP4',
  locked: true,
  name: 'hpAP4',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    restAP4DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP4', '4Ch'],
          },
          required: true,
        },
      ],
    },
    peakAP4DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP4', '4Ch'],
          },
          required: true,
        },
      ],
    },
    recoveryAP4DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP4', '4Ch'],
          },
          required: true,
        },
      ],
    },
  },
  stages: [AP4],
};

const hpAP2 = {
  id: 'extension-stress-echo.hangingProtocolModule.hpAP2',
  locked: true,
  name: 'hpAP2',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    restAP2DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP2', '2Ch'],
          },
          required: true,
        },
      ],
    },
    peakAP2DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP2', '2Ch'],
          },
          required: true,
        },
      ],
    },
    recoveryAP2DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP2', '2Ch'],
          },
          required: true,
        },
      ],
    },
  },
  stages: [AP2],
};

const hpAP3 = {
  id: 'extension-stress-echo.hangingProtocolModule.hpAP3',
  locked: true,
  name: 'hpAP3',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    restAP3DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP3', '3Ch'],
          },
          required: true,
        },
      ],
    },
    peakAP3DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP3', '3Ch'],
          },
          required: true,
        },
      ],
    },
    recoveryAP3DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: ['AP3', '3Ch'],
          },
          required: true,
        },
      ],
    },
  },
  stages: [AP3],
};

const hpView6 = {
  id: 'extension-stress-echo.hangingProtocolModule.hpView6',
  locked: true,
  name: 'hpView6',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  displaySetSelectors: {
    restView6DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Rest', 'Baseline'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'View6',
          },
          required: true,
        },
      ],
    },
    peakView6DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Peak',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'View6',
          },
          required: true,
        },
      ],
    },
    recoveryView6DisplaySet: {
      seriesMatchingRules: [
        {
          attribute: 'StageName',
          constraint: {
            containsI: ['Recovery', 'Post'],
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'View6',
          },
          required: true,
        },
      ],
    },
  },
  stages: [View6],
};

function getHangingProtocolModule() {
  return [
    {
      name: hpRest.id,
      protocol: hpRest,
    },
    {
      name: hpPeak.id,
      protocol: hpPeak,
    },
    {
      name: hpRecovery.id,
      protocol: hpRecovery,
    },
    {
      name: hpLAX.id,
      protocol: hpLAX,
    },
    {
      name: hpSAX.id,
      protocol: hpSAX,
    },
    {
      name: hpAP4.id,
      protocol: hpAP4,
    },
    {
      name: hpAP2.id,
      protocol: hpAP2,
    },
    {
      name: hpAP3.id,
      protocol: hpAP3,
    },
    {
      name: hpView6.id,
      protocol: hpView6,
    },
  ];
}

export default getHangingProtocolModule;
