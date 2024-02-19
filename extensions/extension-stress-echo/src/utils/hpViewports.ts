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
      id: 'restDisplaySet',
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
      id: 'restDisplaySet',
    },
  ],
};

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
      id: 'restDisplaySet',
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
      id: 'restDisplaySet',
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
      id: 'restDisplaySet',
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
      id: 'restDisplaySet',
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
      id: 'restDisplaySet',
    },
  ],
};

export {
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
};
