import React from 'react';
import { FilterStageView } from './Panels';

// TODO:
// - No loading UI exists yet
// - cancel promises when component is destroyed
// - show errors in UI for thumbnails if promise fails

function getPanelModule({ commandsManager, extensionManager, servicesManager }) {
  const wrappedPanelfilterStageView = () => {
    return (
      <FilterStageView
        commandsManager={commandsManager}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
      />
    );
  };

  return [
    {
      name: 'filterStageView',
      iconName: 'tab-patient-info',
      iconLabel: 'Filter by Stage or View ',
      label: 'Filter by Stage or View',
      component: wrappedPanelfilterStageView,
    },
  ];
}

export default getPanelModule;
