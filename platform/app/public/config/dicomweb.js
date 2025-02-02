/** @type {AppTypes.Config} */
window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],
  showPatientInfo: 'visible',
  showStudyList: true,
  // below flag is for performance reasons, but it might not work for all servers
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: false,
  showLoadingIndicator: true,
  strictZSpacingForVolumeViewport: true,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    prefetch: 1000,
  },
  useNorm16Texture: true,
  useSharedArrayBuffer: 'AUTO',
  autoPlayCine: true,
  investigationalUseDialog: {
    option: 'never',
  },
  studyPrefetcher: {
    enabled: true,
    displaySetCount: 2,
    maxNumPrefetchRequests: 10,
    order: 'closest',
  },
  // filterQueryParam: false,

  // Add some customizations to the default e2e datasource
  customizationService: [
    '@ohif/extension-default.customizationModule.datasources',
    '@ohif/extension-default.customizationModule.helloPage',
    {
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
          {
            id: 'InstanceNumber',
            customizationType: 'ohif.overlayItem',
            title: 'Instance Number',
            condition: ({ instance }) => instance && instance.InstanceNumber,
            contentF: ({ instance }) => instance.InstanceNumber,
          },
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
  ],
  defaultDataSourceName: 'dicomweb',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'e2e',
      configuration: {
        friendlyName: 'StaticWado test data',
        // The most important field to set for static WADO
        staticWado: true,
        name: 'StaticWADO',
        wadoUriRoot: '/viewer-testdata',
        qidoRoot: '/viewer-testdata',
        wadoRoot: '/viewer-testdata',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        singlepart: 'video,thumbnail,pdf',
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/index.mp4'),
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'local5000',
      configuration: {
        friendlyName: 'Static WADO Local Data',
        name: 'DCM4CHEE',
        qidoRoot: 'http://localhost:5000/dicomweb',
        wadoRoot: 'http://localhost:5000/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: true,
        supportsStow: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'docker',
      configuration: {
        friendlyName: 'Static WADO Docker Data',
        name: 'DCM4CHEE',
        qidoRoot: 'http://localhost:25080/dicomweb',
        wadoRoot: 'http://localhost:25080/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: true,
        supportsStow: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video,pdf',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        //        wadoUriRoot: '/dicomweb',
        //        qidoRoot: '/dicomweb',
        //        wadoRoot: '/dicomweb',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'thumbnail',
        onConfiguration: (dicomWebConfig, options) => {
          //         console.log("options", options);
          const { params } = options;
          const { clinic } = params;
          const pathUrlDicomWeb = `/${clinic}`;
          const pathUrlWado = `/${clinic}`;
          return {
            ...dicomWebConfig,
            wadoRoot: pathUrlDicomWeb,
            qidoRoot: pathUrlDicomWeb,
            wadoUriRoot: pathUrlWado,
          };
        },
        acceptHeader: ['multipart/related; type=application/octet-stream; transfer-syntax=*'],
        omitQuotationForMultipartRequest: true,
        dicomUploadEnabled: true,
        allowMultiSelectExport: true,
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif2',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif3',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        wadoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    {
      friendlyName: 'StaticWado default data',
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dcm4chee',
      configuration: {
        name: 'DCM4CHEE',
        wadoUriRoot: '/dicomweb',
        qidoRoot: '/dicomweb',
        wadoRoot: '/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
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
    // This is 429 when rejected from the public idc sandbox too often.
    console.warn(error.status);

    // Could use services manager here to bring up a dialog/modal if needed.
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
