import { Types } from '@ohif/core';
import React from 'react';

import getPanelModule from './getPanelModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';
import getCommandsModule from './commandsModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCustomizationModule from './getCustomizationModule';
import { id } from './id';
import preRegistration from './init';
import { SyncControls } from './components/SyncControls';

const Component = React.lazy(() => {
  return import(/* webpackPrefetch: true */ './viewports/DobutamineViewport');
});

const DobutamineViewport = props => {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Component {...props} />
    </React.Suspense>
  );
};

const dobutamineExtension: Types.Extensions.Extension = {
  id,
  preRegistration,
  onModeExit({ servicesManager }) {
    servicesManager.services.cardiacSyncService?.onModeExit();
  },

  getPanelModule,

  getViewportModule({ servicesManager, extensionManager }) {
    const ExtendedDobutamineViewport = props => {
      return (
        <DobutamineViewport
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          {...props}
        />
      );
    };

    return [{ name: 'dobutamine', component: ExtendedDobutamineViewport }];
  },

  getHangingProtocolModule,
  getSopClassHandlerModule,
  getCommandsModule,
  getCustomizationModule,

  getComponentModule: () => [
    {
      name: 'syncControls',
      component: SyncControls,
    },
  ],
};

export default dobutamineExtension;

export {};
