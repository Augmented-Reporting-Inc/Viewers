window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],
  customizationService: {
    dicomUploadComponent:
      '@ohif/extension-cornerstone.customizationModule.cornerstoneDicomUploadComponent',
    cornerstoneOverlayTopLeft: {
      id: 'cornerstoneOverlayTopLeft',
      customizationType: 'ohif.cornerstoneOverlay',
      items: [
        {
          id: 'Stage',
          customizationType: 'ohif.overlayItem',
          title: 'Stage Name',
          condition: ({ instance }) => instance && instance.StageName,
          contentF: ({ instance }) => instance.StageName,
        },
        {
          id: 'View',
          customizationType: 'ohif.overlayItem',
          title: 'View Name',
          condition: ({ instance }) => instance && instance.ViewName,
          contentF: ({ instance }) => instance.ViewName,
        },
        {
          id: 'Timer',
          customizationType: 'ohif.overlayItem',
          title: 'Timer Name',
          label: 'timer =',
          condition: ({ instance }) => instance && instance.EventElapsedTimes,
          contentF: ({ instance, formatters: { formatDuration } }) =>
            formatDuration(instance.EventElapsedTimes),
        },
      ],
    },
    cornerstoneOverlayTopRight: {
      id: 'cornerstoneOverlayTopRight',
      customizationType: 'ohif.cornerstoneOverlay',
      items: [
        /**        {
          id: 'InstanceNumber',
          customizationType: 'ohif.overlayItem',
          title: 'Instance Number',
          condition: ({ instance }) => instance && instance.InstanceNumber,
          contentF: ({ instance }) => instance.InstanceNumber,
        },
*/
        {
          id: 'AcquisitionTime',
          customizationType: 'ohif.overlayItem',
          title: 'Acquisition Time',
          condition: ({ instance }) => instance && instance.AcquisitionTime,
          contentF: ({ instance, formatters: { formatTime } }) =>
            formatTime(instance.AcquisitionTime),
        },
        {
          id: 'HR',
          customizationType: 'ohif.overlayItem',
          title: 'Heart Rate',
          condition: ({ instance }) => instance && instance.HeartRate,
          contentF: ({ instance }) => instance.HeartRate + ' bpm',
        },
      ],
    },
  },
  showStudyList: true,
  maxNumberOfWebWorkers: 4,
  omitQuotationForMultipartRequest: true,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  strictZSpacingForVolumeViewport: true,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    prefetch: 1000,
  },
  useNorm16Texture: true,
  autoPlayCine: true,
  defaultDataSourceName: 'dicomweb',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'orthanc Server',
        name: 'dicomweb',
        wadoUriRoot: 'https://ssoback.futurepacs.com/orthanc/dicom-web',
        qidoRoot: 'https://ssoback.futurepacs.com/orthanc/dicom-web',
        wadoRoot: 'https://ssoback.futurepacs.com/orthanc/dicom-web',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        acceptHeader: ['multipart/related; type=application/octet-stream; transfer-syntax=*'],
        omitQuotationForMultipartRequest: true,
        dicomUploadEnabled: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomwebproxy',
      sourceName: 'dicomwebproxy',
      configuration: {
        friendlyName: 'dicomweb delegating proxy',
        name: 'dicomwebproxy',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom json',
        name: 'json',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn(error.status);
    console.warn('test, navigate to https://ohif.org/');
  },
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'a',
        {
          target: '_self',
          rel: 'noopener noreferrer',
          className: 'text-white text-xl font-serif',
          href: 'https://futurepacs.com',
        },
        React.createElement('div', {}, 'futurePACS')
      );
    },
  },
  hotkeys: [
    {
      commandName: 'incrementActiveViewport',
      label: 'Next Viewport',
      keys: ['right'],
    },
    {
      commandName: 'decrementActiveViewport',
      label: 'Previous Viewport',
      keys: ['left'],
    },
    { commandName: 'rotateViewportCW', label: 'Rotate Right', keys: ['r'] },
    { commandName: 'rotateViewportCCW', label: 'Rotate Left', keys: ['l'] },
    { commandName: 'invertViewport', label: 'Invert', keys: ['i'] },
    {
      commandName: 'flipViewportHorizontal',
      label: 'Flip Horizontally',
      keys: ['h'],
    },
    {
      commandName: 'flipViewportVertical',
      label: 'Flip Vertically',
      keys: ['v'],
    },
    { commandName: 'scaleUpViewport', label: 'Zoom In', keys: ['+'] },
    { commandName: 'scaleDownViewport', label: 'Zoom Out', keys: ['-'] },
    { commandName: 'fitViewportToWindow', label: 'Zoom to Fit', keys: ['='] },
    { commandName: 'resetViewport', label: 'Reset', keys: ['space'] },
    { commandName: 'nextImage', label: 'Next Image', keys: ['down'] },
    { commandName: 'previousImage', label: 'Previous Image', keys: ['up'] },
    {
      commandName: 'previousViewportDisplaySet',
      label: 'Previous Series',
      keys: ['pagedown'],
    },
    {
      commandName: 'nextViewportDisplaySet',
      label: 'Next Series',
      keys: ['pageup'],
    },
    {
      commandName: 'setToolActive',
      commandOptions: { toolName: 'Zoom' },
      label: 'Zoom',
      keys: ['z'],
    },
    {
      commandName: 'windowLevelPreset1',
      label: 'W/L Preset 1',
      keys: ['1'],
    },
    {
      commandName: 'windowLevelPreset2',
      label: 'W/L Preset 2',
      keys: ['2'],
    },
    {
      commandName: 'windowLevelPreset3',
      label: 'W/L Preset 3',
      keys: ['3'],
    },
    {
      commandName: 'windowLevelPreset4',
      label: 'W/L Preset 4',
      keys: ['4'],
    },
    {
      commandName: 'windowLevelPreset5',
      label: 'W/L Preset 5',
      keys: ['5'],
    },
    {
      commandName: 'windowLevelPreset6',
      label: 'W/L Preset 6',
      keys: ['6'],
    },
    {
      commandName: 'windowLevelPreset7',
      label: 'W/L Preset 7',
      keys: ['7'],
    },
    {
      commandName: 'windowLevelPreset8',
      label: 'W/L Preset 8',
      keys: ['8'],
    },
    {
      commandName: 'windowLevelPreset9',
      label: 'W/L Preset 9',
      keys: ['9'],
    },
  ],
};
