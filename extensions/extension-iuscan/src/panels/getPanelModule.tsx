import React from 'react';
import PanelIUScan from './PanelIUScan';

export default function getPanelModule({ commandsManager, servicesManager }) {
  const wrappedPanel = () => (
    <PanelIUScan commandsManager={commandsManager} servicesManager={servicesManager} />
  );

  return [
    {
      name: 'iuscanMeasurements',
      iconName: 'list-bullets',
      iconLabel: 'IUS',
      label: 'Intestinal Ultrasound Measurements',
      component: wrappedPanel,
    },
  ];
}
