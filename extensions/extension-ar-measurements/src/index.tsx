import { Types } from '@ohif/core';
import { id } from './id';
import getPanelModule from './getPanelModule';
import {
  getMeasurementLabelConfigForDomain,
  getViewerMeasurementDomainFromPath,
} from './utils/measurementLabelConfig';

const arMeasurementsExtension = {
  id,

  onModeEnter({ servicesManager }) {
    const { customizationService } = servicesManager.services;
    const domain = getViewerMeasurementDomainFromPath();

    // iUSCAN owns its repeated-measurement labels in extension-iuscan.
    if (domain === 'iuscan') {
      return;
    }

    const labelConfig = getMeasurementLabelConfigForDomain(domain);

    if (!labelConfig) {
      return;
    }

    customizationService.setCustomizations(
      {
        measurementLabels: {
          $set: labelConfig,
        },
      },
      customizationService.Scope.Mode
    );
  },

  onModeExit({ servicesManager }) {
    servicesManager.services.customizationService?.onModeExit?.();
  },

  getPanelModule,
};

export default arMeasurementsExtension as Types.Extensions.Extension;
