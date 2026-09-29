import React from 'react';
import ResearchReadPanel from './panels/ResearchReadPanel';

export default function getPanelModule({ servicesManager, commandsManager }) {
  return [
    {
      name: 'researchRead',
      iconName: 'tab-linear',
      iconLabel: 'Research Read',
      label: 'Research Read',
      component: props =>
        React.createElement(ResearchReadPanel, {
          ...props,
          servicesManager,
          commandsManager,
        }),
    },
  ];
}
