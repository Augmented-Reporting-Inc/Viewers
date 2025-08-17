/** @type {AppTypes.Config} */

window.config = {
  name: 'config/ar.js',
  routerBasename: null,
  extensions: [],
  modes: [],
  showPatientInfo: 'visible',
  customizationService: [
    {
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
  showStudyList: false,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
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
  multimonitor: [
    {
      id: 'split',
      test: ({ multimonitor }) => multimonitor === 'split',
      screens: [
        {
          id: 'ohif0',
          screen: null,
          location: {
            screen: 0,
            width: 0.5,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: null,
          location: {
            width: 0.5,
            height: 1,
            left: 0.5,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },

    {
      id: '2',
      test: ({ multimonitor }) => multimonitor === '2',
      screens: [
        {
          id: 'ohif0',
          screen: 0,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: 1,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },
  ],
  defaultDataSourceName: 'dicomweb',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'thumbnail',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: false,
        staticWado: true,
        singlepart: 'thumbnail',
        onConfiguration: dicomWebConfig => {
          const clinicName = new URLSearchParams(window.location.search).get('clinicName');
          return {
            ...dicomWebConfig,
            wadoRoot: `/${clinicName}`,
            qidoRoot: `/${clinicName}`,
            wadoUriRoot: `/${clinicName}`,
          };
        },
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
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
};
