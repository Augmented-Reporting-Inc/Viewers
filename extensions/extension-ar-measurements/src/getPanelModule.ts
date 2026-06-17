import React from 'react';
import ARMeasurementsPanel from './panels/ARMeasurementsPanel';

export default function getPanelModule({ servicesManager, commandsManager }) {
  return [
    {
      name: 'arMeasurements',
      iconName: 'tab-linear',
      iconLabel: 'AR Measurements',
      label: 'AR Measurements',
      component: props =>
        React.createElement(ARMeasurementsPanel, {
          ...props,
          servicesManager,
          commandsManager,
        }),
    },
  ];
}
