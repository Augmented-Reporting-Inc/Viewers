const VOI_SYNC_GROUP = {
  type: 'voi',
  id: 'ctWLSync',
  source: true,
  target: true,
};

const makeViewport = (viewportId, displaySetId, initialImageOptions = undefined) => ({
  viewportOptions: {
    viewportId,
    viewportType: 'stack',
    toolGroupId: 'default',
    ...(initialImageOptions ? { initialImageOptions } : {}),
    syncGroups: [{ ...VOI_SYNC_GROUP }],
  },
  displaySets: [
    {
      id: displaySetId,
    },
  ],
});

const makeStageViewports = (stagePrefix, includeInitialPreset = false) => ({
  PLAX: makeViewport(
    `${stagePrefix}PLAX`,
    `${stagePrefix}PLAXDisplaySet`,
    includeInitialPreset ? { preset: 'first' } : undefined
  ),
  SAXBase: makeViewport(`${stagePrefix}SAXBase`, `${stagePrefix}SAXBaseDisplaySet`),
  SAXMid: makeViewport(`${stagePrefix}SAXMid`, `${stagePrefix}SAXMidDisplaySet`),
  SAXApex: makeViewport(`${stagePrefix}SAXApex`, `${stagePrefix}SAXApexDisplaySet`),
  Apical4: makeViewport(`${stagePrefix}Apical4`, `${stagePrefix}Apical4DisplaySet`),
  Apical2: makeViewport(`${stagePrefix}Apical2`, `${stagePrefix}Apical2DisplaySet`),
  Apical3: makeViewport(`${stagePrefix}Apical3`, `${stagePrefix}Apical3DisplaySet`),
});

const rest = makeStageViewports('rest', true);
const lowDose = makeStageViewports('lowDose');
const peakDose = makeStageViewports('peakDose');
const recovery = makeStageViewports('recovery');

const {
  PLAX: restPLAX,
  SAXBase: restSAXBase,
  SAXMid: restSAXMid,
  SAXApex: restSAXApex,
  Apical4: restApical4,
  Apical2: restApical2,
  Apical3: restApical3,
} = rest;

const {
  PLAX: lowDosePLAX,
  SAXBase: lowDoseSAXBase,
  SAXMid: lowDoseSAXMid,
  SAXApex: lowDoseSAXApex,
  Apical4: lowDoseApical4,
  Apical2: lowDoseApical2,
  Apical3: lowDoseApical3,
} = lowDose;

const {
  PLAX: peakDosePLAX,
  SAXBase: peakDoseSAXBase,
  SAXMid: peakDoseSAXMid,
  SAXApex: peakDoseSAXApex,
  Apical4: peakDoseApical4,
  Apical2: peakDoseApical2,
  Apical3: peakDoseApical3,
} = peakDose;

const {
  PLAX: recoveryPLAX,
  SAXBase: recoverySAXBase,
  SAXMid: recoverySAXMid,
  SAXApex: recoverySAXApex,
  Apical4: recoveryApical4,
  Apical2: recoveryApical2,
  Apical3: recoveryApical3,
} = recovery;

export {
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
};
