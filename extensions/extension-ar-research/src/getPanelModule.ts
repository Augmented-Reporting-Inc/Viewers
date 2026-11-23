import React from 'react';
import ResearchReadPanel from './panels/ResearchReadPanel';

export default function getPanelModule({ servicesManager, commandsManager }) {
  return [
    {
      name: 'researchRead',
      iconName: 'tab-linear',
      iconLabel: 'Questions',
      label: 'Case Questions',
      component: props =>
        React.createElement(ResearchReadPanel, {
          ...props,
          servicesManager,
          commandsManager,
        }),
    },
  ];
}
