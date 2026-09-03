const restLAX = {
  viewportOptions: {
    viewportId: 'restLAX',
    viewportType: 'stack',
    toolGroupId: 'default',
    initialImageOptions: {
      // index: 5,
      preset: 'first', // 'first', 'last', 'middle'
    },
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'restLAXDisplaySet',
    },
  ],
};

const restSAX = {
  viewportOptions: {
    viewportId: 'restSAX',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'restSAXDisplaySet',
    },
  ],
};

const makeStressViewport = (viewportId, displaySetId) => ({
  viewportOptions: {
    viewportId,
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [{ id: displaySetId }],
});

const restSAXBase = makeStressViewport('restSAXBase', 'restSAXBaseDisplaySet');
const restSAXMid = makeStressViewport('restSAXMid', 'restSAXMidDisplaySet');
const restSAXApex = makeStressViewport('restSAXApex', 'restSAXApexDisplaySet');

const restAP4 = {
  viewportOptions: {
    viewportId: 'restAP4',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'restAP4DisplaySet',
    },
  ],
};

const restAP2 = {
  viewportOptions: {
    viewportId: 'restAP2',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'restAP2DisplaySet',
    },
  ],
};

const restAP3 = {
  viewportOptions: {
    viewportId: 'restAP3',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'restAP3DisplaySet',
    },
  ],
};

const restView6 = {
  viewportOptions: {
    viewportId: 'restView6',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'restView6DisplaySet',
    },
  ],
};

const peakLAX = {
  viewportOptions: {
    viewportId: 'peakLAX',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'peakLAXDisplaySet',
    },
  ],
};

const peakSAX = {
  viewportOptions: {
    viewportId: 'peakSAX',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'peakSAXDisplaySet',
    },
  ],
};

const peakSAXBase = makeStressViewport('peakSAXBase', 'peakSAXBaseDisplaySet');
const peakSAXMid = makeStressViewport('peakSAXMid', 'peakSAXMidDisplaySet');
const peakSAXApex = makeStressViewport('peakSAXApex', 'peakSAXApexDisplaySet');

const peakAP4 = {
  viewportOptions: {
    viewportId: 'peakAP4',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'peakAP4DisplaySet',
    },
  ],
};

const peakAP2 = {
  viewportOptions: {
    viewportId: 'peakAP2',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'peakAP2DisplaySet',
    },
  ],
};

const peakAP3 = {
  viewportOptions: {
    viewportId: 'peakAP3',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'peakAP3DisplaySet',
    },
  ],
};

const peakView6 = {
  viewportOptions: {
    viewportId: 'peakView6',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'peakView6DisplaySet',
    },
  ],
};

const recoveryLAX = {
  viewportOptions: {
    viewportId: 'recoveryLAX',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'recoveryLAXDisplaySet',
    },
  ],
};

const recoverySAX = {
  viewportOptions: {
    viewportId: 'recoverySAX',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'recoverySAXDisplaySet',
    },
  ],
};

const recoverySAXBase = makeStressViewport('recoverySAXBase', 'recoverySAXBaseDisplaySet');
const recoverySAXMid = makeStressViewport('recoverySAXMid', 'recoverySAXMidDisplaySet');
const recoverySAXApex = makeStressViewport('recoverySAXApex', 'recoverySAXApexDisplaySet');

const recoveryAP4 = {
  viewportOptions: {
    viewportId: 'recoveryAP4',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'recoveryAP4DisplaySet',
    },
  ],
};

const recoveryAP2 = {
  viewportOptions: {
    viewportId: 'recoveryAP2',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'recoveryAP2DisplaySet',
    },
  ],
};

const recoveryAP3 = {
  viewportOptions: {
    viewportId: 'recoveryAP3',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'recoveryAP3DisplaySet',
    },
  ],
};

const recoveryView6 = {
  viewportOptions: {
    viewportId: 'recoveryView6',
    viewportType: 'stack',
    toolGroupId: 'default',
    syncGroups: [
      {
        type: 'voi',
        id: 'ctWLSync',
        source: true,
        target: true,
      },
    ],
  },
  displaySets: [
    {
      id: 'recoveryView6DisplaySet',
    },
  ],
};

export {
  restLAX,
  restSAX,
  restSAXBase,
  restSAXMid,
  restSAXApex,
  restAP4,
  restAP2,
  restAP3,
  restView6,
  peakLAX,
  peakSAX,
  peakSAXBase,
  peakSAXMid,
  peakSAXApex,
  peakAP4,
  peakAP2,
  peakAP3,
  peakView6,
  recoveryLAX,
  recoverySAX,
  recoverySAXBase,
  recoverySAXMid,
  recoverySAXApex,
  recoveryAP4,
  recoveryAP2,
  recoveryAP3,
  recoveryView6,
};
