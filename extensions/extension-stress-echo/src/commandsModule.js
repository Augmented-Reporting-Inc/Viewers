import { classes } from '@ohif/core';

// const metadataProvider = classes.MetadataProvider;

const commandsModule = ({ servicesManager, extensionManager }) => {
  const { displaySetService } = servicesManager.services;

  const actions = {
    getMatchingDisplaySet: ({ viewportMatchDetails }) => {
      // Todo: this is assuming that the hanging protocol has successfully matched
      // the correct stage or view.

      let svDisplaySet = null;
      for (const [viewportId, viewportDetails] of viewportMatchDetails) {
        const { displaySetsInfo } = viewportDetails;
        const displaySets = displaySetsInfo.map(({ displaySetInstanceUID }) =>
          displaySetService.getDisplaySetByUID(displaySetInstanceUID)
        );

        if (!displaySets || displaySets.length === 0) {
          continue;
        }

        svDisplaySet = displaySets.find(displaySet => displaySet.isStress);
        console.log("svDisplaySet", svDisplaySet);
        if (svDisplaySet) {
          break;
        }
      }

      return svDisplaySet;
    },

  };

  const definitions = {
    getMatchingDisplaySet: {
      commandFn: actions.getMatchingDisplaySet,
      storeContexts: [],
      options: {},
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'STRESSECHO:CORNERSTONE',
  };
};

export default commandsModule;
