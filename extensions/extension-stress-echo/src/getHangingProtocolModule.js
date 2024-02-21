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

/** stages
 * represents a 2x3 viewport layout configuration. The layout displays LAX, SAX, and AP4
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
  viewports: [restLAX, restSAX, restAP4, restAP3, restAP2, restView6],
};

const peak = {
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

const recovery = {
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

// protocol definition
const stressecho = {
  id: 'extension-stress-echo.hangingProtocolModule.stressecho',
  locked: true,
  // Don't store this hanging protocol as it applies to the currently active
  // display set by default
  // cacheId: null,
  name: 'Default',
  createdDate: '2021-02-23T19:22:08.894Z',
  modifiedDate: '2023-04-01',
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveTopToBottom', // "default" , "interleaveTopToBottom",  "interleaveCenter"
  protocolMatchingRules: [
    {
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: 'US',
      },
    },
    {
      attribute: 'StudyDescription',
      constraint: {
        containsI: 'stress',
      },
    },
    {
      attribute: 'StudyDescription',
      constraint: {
        containsI: 'dobutamine',
      },
    },
    {
      attribute: 'StageName',
      constraint: {
        containsI: 'Rest',
      },
    },
    {
      attribute: 'StageName',
      constraint: {
        containsI: 'Peak',
      },
    },
    {
      attribute: 'StageName',
      constraint: {
        containsI: 'Recovery',
      },
    },
    {
      attribute: 'StageName',
      constraint: {
        containsI: 'Post',
      },
    },
    {
      attribute: 'ViewName',
      constraint: {
        contains: 'LAX',
      },
    },
    {
      attribute: 'ViewName',
      constraint: {
        contains: 'SAX',
      },
    },
    {
      attribute: 'ViewName',
      constraint: {
        contains: 'AP4',
      },
    },
    {
      attribute: 'ViewName',
      constraint: {
        contains: 'AP2',
      },
    },
    {
      attribute: 'ViewName',
      constraint: {
        contains: 'AP3',
      },
    },
    {
      attribute: 'ViewName',
      constraint: {
        containsI: 'View6',
      },
    },
  ],
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
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Rest',
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
    },
    restSAXDisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Rest',
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
    },   
    restAP4DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Rest',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'AP4',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
    },  
    restAP2DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Rest',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'AP2',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
    },  
    restAP3DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Rest',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'AP3',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
    },  
    restView6DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Rest',
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
    },  
    peakLAXDisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
    peakSAXDisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
    peakAP4DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
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
            containsI: 'AP4',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
    peakAP2DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
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
            containsI: 'AP2',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
    peakAP3DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
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
            containsI: 'AP3',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
    peakView6DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
    recoveryLAXDisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Recovery',
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Post',
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
    recoverySAXDisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Recovery',
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Post',
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
  },
  recoveryAP4DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Recovery',
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Post',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'AP4',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
  },
  recoveryAP2DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Recovery',
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Post',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'AP2',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
  },
  recoveryAP3DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Recovery',
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Post',
          },
          required: true,
        },
        {
          attribute: 'ViewName',
          constraint: {
            containsI: 'AP3',
          },
          required: true,
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
  },
    recoveryView6DisplaySet: {
      // Matches displaysets, NOT series
      seriesMatchingRules: [
        {
          attribute: 'Modality',
          constraint: {
            equals: {
              value: 'US',
            },
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Recovery',
          },
          required: true,
        },
        {
          attribute: 'StageName',
          constraint: {
            containsI: 'Post',
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
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'stress',
          },
        },
        {
          attribute: 'StudyDescription',
          constraint: {
            containsI: 'dobutamine',
          },
        },
      ],
      // Can be used to select matching studies
      // studyMatchingRules: [],
    },
  },
  stages: [rest, peak, recovery, LAX, SAX, AP4, AP2, AP3, View6],
};

function getHangingProtocolModule() {
  return [
    {
      name: stressecho.id,
      protocol: stressecho,
    },
  ];
}

export default getHangingProtocolModule;
