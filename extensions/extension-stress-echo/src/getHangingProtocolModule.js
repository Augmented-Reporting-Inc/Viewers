import 
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
  
  from '/utils/hpViewports';

/**
 * represents a 3x2 viewport layout configuration. The layout displays LAX, SAX, and AP4 
 * images in the first row, AP3, AP2 and View 6 images in the second row.
 * 0,0 1,0 2,0
 * 1,0 1,1 1,2
 * It has synchronizers for windowLevel for all images, and
 * also camera synchronizer for each orientation
 */
const rest = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
  ],
};

const rest = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
  ],
};

const stage = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
      layoutOptions: [
        {
          x: 0,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 0,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
      ],
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
    peakLAX,
    peakSAX,
    peakAP4,
    peakAP3,
    peakAP2,
    peakView6,
    recoveryLAX,
    recoverySAX,
    recoveryAP4,
    recoveryAP3,
    recoveryAP2,
    recoveryView6,
  ],
  createdDate: '2021-02-23T18:32:42.850Z',
};

const stage = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
      layoutOptions: [
        {
          x: 0,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 0,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
      ],
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
    peakLAX,
    peakSAX,
    peakAP4,
    peakAP3,
    peakAP2,
    peakView6,
    recoveryLAX,
    recoverySAX,
    recoveryAP4,
    recoveryAP3,
    recoveryAP2,
    recoveryView6,
  ],
  createdDate: '2021-02-23T18:32:42.850Z',
};

const stage = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
      layoutOptions: [
        {
          x: 0,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 0,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
      ],
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
    peakLAX,
    peakSAX,
    peakAP4,
    peakAP3,
    peakAP2,
    peakView6,
    recoveryLAX,
    recoverySAX,
    recoveryAP4,
    recoveryAP3,
    recoveryAP2,
    recoveryView6,
  ],
  createdDate: '2021-02-23T18:32:42.850Z',
};

const stage = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
      layoutOptions: [
        {
          x: 0,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 0,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
      ],
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
    peakLAX,
    peakSAX,
    peakAP4,
    peakAP3,
    peakAP2,
    peakView6,
    recoveryLAX,
    recoverySAX,
    recoveryAP4,
    recoveryAP3,
    recoveryAP2,
    recoveryView6,
  ],
  createdDate: '2021-02-23T18:32:42.850Z',
};

const stage = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
      layoutOptions: [
        {
          x: 0,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 0,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
      ],
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
    peakLAX,
    peakSAX,
    peakAP4,
    peakAP3,
    peakAP2,
    peakView6,
    recoveryLAX,
    recoverySAX,
    recoveryAP4,
    recoveryAP3,
    recoveryAP2,
    recoveryView6,
  ],
  createdDate: '2021-02-23T18:32:42.850Z',
};

const stage = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
      layoutOptions: [
        {
          x: 0,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 0,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
      ],
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
    peakLAX,
    peakSAX,
    peakAP4,
    peakAP3,
    peakAP2,
    peakView6,
    recoveryLAX,
    recoverySAX,
    recoveryAP4,
    recoveryAP3,
    recoveryAP2,
    recoveryView6,
  ],
  createdDate: '2021-02-23T18:32:42.850Z',
};

const stage = {
  name: 'default',
  viewportStructure: {
    layoutType: 'grid',
    properties: {
      rows: 2,
      columns: 3,
      layoutOptions: [
        {
          x: 0,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 0,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 0,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 1 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
        {
          x: 2 / 3,
          y: 1 / 2,
          width: 1 / 3,
          height: 1 / 2,
        },
      ],
    },
  },
  viewports: [
    restLAX,
    restSAX,
    restAP4,
    restAP3,
    restAP2,
    restView6,
    peakLAX,
    peakSAX,
    peakAP4,
    peakAP3,
    peakAP2,
    peakView6,
    recoveryLAX,
    recoverySAX,
    recoveryAP4,
    recoveryAP3,
    recoveryAP2,
    recoveryView6,
  ],
  createdDate: '2021-02-23T18:32:42.850Z',
};

const defaultProtocol = {
  id: 'stressecho',
  locked: true,
  // Don't store this hanging protocol as it applies to the currently active
  // display set by default
  // cacheId: null,
  name: 'Default',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  hpInitiationCriteria: { minSeriesLoaded: 1 },
  // -1 would be used to indicate active only, whereas other values are
  // the number of required priors referenced - so 0 means active with
  // 0 or more priors.
  numberOfPriorsReferenced: 0,
  // Default viewport is used to define the viewport when
  // additional viewports are added using the layout tool
  defaultViewport: {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
    },
    displaySets: [
      {
        id: 'defaultDisplaySetId',
        //        matchedDisplaySetsIndex: -1,
      },
    ],
  },
  displaySetSelectors: {
    defaultDisplaySetId: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        // Try to match series with images by default, to prevent weird display
        // on SEG/SR containing studies
        //        {
        //          attribute: 'numImageFrames',
        //          constraint: {
        //            greaterThan: { value: 0 },
        //          },
        //        },
        // This display set will select the specified items by preference
        // It has no affect if nothing is specified in the URL.
        {
          attribute: 'isDisplaySetFromUrl',
          weight: 10,
          constraint: {
            equals: true,
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
  },
  stages: [
    {
      name: 'default',
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 1,
        },
      },
      viewports: [
        {
          viewportOptions: {
            viewportType: 'stack',
            viewportId: 'default',
            toolGroupId: 'default',
            // This will specify the initial image options index if it matches in the URL
            // and will otherwise not specify anything.
            initialImageOptions: {
              custom: 'sopInstanceLocation',
            },
            // Other options for initialImageOptions, which can be included in the default
            // custom attribute, or can be provided directly.
            //   index: 180,
            //   preset: 'middle', // 'first', 'last', 'middle'
            // },
          },
          displaySets: [
            {
              id: 'defaultDisplaySetId',
            },
          ],
        },
      ],
      createdDate: '2021-02-23T18:32:42.850Z',
    },
  ],
};

function getHangingProtocolModule() {
  return [
    {
      name: defaultProtocol.id,
      protocol: defaultProtocol,
    },
    // Create a MxN hanging protocol available by default
    {
      name: hpMNGrid.id,
      protocol: hpMNGrid,
    },
    // Create a MxN comparison hanging protocol available by default
    {
      name: hpMNCompare.id,
      protocol: hpMNCompare,
    },
  ];
}

export default getHangingProtocolModule;
