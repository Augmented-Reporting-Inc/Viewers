import { Types } from '@ohif/core';

import getPanelModule from './getPanelModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';
import getCommandsModule from './commandsModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCustomizationModule from './getCustomizationModule';
import { id } from './id';
import preRegistration from './init';
import React from 'react';
import { SyncControls } from './components/SyncControls';

const Component = React.lazy(() => {
  return import(/* webpackPrefetch: true */ './viewports/StressEchoViewport');
});

const StressEchoViewport = props => {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Component {...props} />
    </React.Suspense>
  );
};

const stressechoExtension: Types.Extensions.Extension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id,
  preRegistration,
  onModeExit({ servicesManager }) {
    servicesManager.services.cardiacSyncService?.onModeExit();
  },
  getPanelModule,
  getViewportModule({ servicesManager, extensionManager }) {
    const ExtendedStressEchoViewport = props => {
      return (
        <StressEchoViewport
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          {...props}
        />
      );
    };

    return [{ name: 'stressecho', component: ExtendedStressEchoViewport }];
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

export default stressechoExtension;

export {};
