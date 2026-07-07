import { callInputDialogAutoComplete } from './callInputDialog';

function cleanDialogText(value = '') {
  return String(value || '').trim();
}

function getMeasurementLabelDialogTitleForDomain(domain = '') {
  const normalizedDomain = cleanDialogText(domain)
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (normalizedDomain === 'iuscan' || normalizedDomain === 'bowel') {
    return 'Bowel Annotation';
  }

  if (normalizedDomain === 'echo') {
    return 'Echo Annotation';
  }

  if (normalizedDomain === 'ecg') {
    return 'ECG Annotation';
  }

  if (
    normalizedDomain === 'nuclear' ||
    normalizedDomain === 'nuclear-cardiology' ||
    normalizedDomain === 'nuccard'
  ) {
    return 'Nuclear Cardiology Annotation';
  }

  return 'Measurement Annotation';
}

function getMeasurementLabelDialogTitle(labelConfig) {
  const config =
    labelConfig && typeof labelConfig === 'object' && !Array.isArray(labelConfig)
      ? labelConfig
      : {};

  return (
    cleanDialogText(config.dialogTitle) ||
    cleanDialogText(config.annotationTitle) ||
    cleanDialogText(config.title) ||
    getMeasurementLabelDialogTitleForDomain(config.domain)
  );
}

function normalizeMeasurementLabelConfigForDialog(labelConfig) {
  if (!labelConfig) {
    return null;
  }

  const baseConfig = Array.isArray(labelConfig)
    ? {
        id: 'measurementLabels',
        labelOnMeasure: false,
        exclusive: true,
        items: labelConfig,
      }
    : labelConfig;

  const dialogTitle = getMeasurementLabelDialogTitle(baseConfig);

  return {
    ...baseConfig,
    dialogTitle,
    annotationTitle: baseConfig.annotationTitle || dialogTitle,
    title: baseConfig.title || dialogTitle,
  };
}

function promptLabelAnnotation({ servicesManager }, ctx, evt) {
  const { measurementService, customizationService, toolGroupService, uiDialogService } =
    servicesManager.services;
  const { viewportId, StudyInstanceUID, SeriesInstanceUID, measurementId, toolName } = evt;
  return new Promise(resolve => {
    (async () => {
      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
      const activeToolOptions = toolGroup.getToolConfiguration(toolName);
      if (activeToolOptions.getTextCallback) {
        resolve({
          StudyInstanceUID,
          SeriesInstanceUID,
          viewportId,
        });
      } else {
        const labelConfig = customizationService.getCustomization('measurementLabels');
        const measurement = measurementService.getMeasurement(measurementId);
        const renderContent = customizationService.getCustomization('ui.labellingComponent');
        const normalizedLabelConfig = normalizeMeasurementLabelConfigForDialog(labelConfig);
        const dialogTitle = getMeasurementLabelDialogTitle(normalizedLabelConfig);

        const value = await callInputDialogAutoComplete({
          measurement,
          uiDialogService,
          labelConfig: normalizedLabelConfig || labelConfig,
          renderContent,
          title: dialogTitle,
        });

        measurementService.update(
          measurementId,
          {
            ...value,
          },
          true
        );

        resolve({
          StudyInstanceUID,
          SeriesInstanceUID,
          viewportId,
        });
      }
    })();
  });
}

export default promptLabelAnnotation;
