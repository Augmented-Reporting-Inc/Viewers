window.config = {
  routerBasename: '/', // '/rviewer',
  extensions: [],
  modes: [],
  showPatientInfo: 'visible',
  customizationService: {
    dicomUploadComponent:
      '@ohif/extension-cornerstone.customizationModule.cornerstoneDicomUploadComponent',
    'viewportOverlay.topLeft': {
      $push: [
        {
          id: 'Stage',
          inheritsFrom: 'ohif.overlayItem',
          condition: ({ instance }) => instance && instance.StageName,
          contentF: ({ instance }) => instance.StageName,
        },
        {
          id: 'View',
          inheritsFrom: 'ohif.overlayItem',
          condition: ({ instance }) => instance && instance.ViewName,
          contentF: ({ instance }) => instance.ViewName,
        },
        {
          id: 'Timer',
          inheritsFrom: 'ohif.overlayItem',
          label: 'timer =',
          condition: ({ instance }) => instance && instance.EventElapsedTimes,
          contentF: ({ instance, formatters: { formatDuration } }) =>
            formatDuration(instance.EventElapsedTimes),
        },
      ],
    },
    'viewportOverlay.topRight': {
      $push: [
        {
          id: 'AcquisitionTime',
          inheritsFrom: 'ohif.overlayItem',
          label: 'Acquisition',
          condition: ({ instance }) => instance && instance.AcquisitionTime,
          contentF: ({ instance, formatters: { formatTime } }) =>
            formatTime(instance.AcquisitionTime),
        },
        {
          id: 'HR',
          inheritsFrom: 'ohif.overlayItem',
          label: 'HR',
          condition: ({ instance }) => instance && instance.HeartRate,
          contentF: ({ instance }) => instance.HeartRate + ' bpm',
        },
      ],
    },
  },
  showStudyList: true,
  maxNumberOfWebWorkers: 4,
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
  useSharedArrayBuffer: 'AUTO',
  autoPlayCine: true,
  investigationalUseDialog: {
    option: 'never',
  },
  studyPrefetcher: {
    enabled: true,
    /* Number of displaysets to be prefetched  (default: 2)*/
    displaySetCount: 2,
    /**
     * Max number of concurrent prefetch requests (default: 10)
     * High numbers may impact on the time to load a new dropped series because
     * the browser will be busy with all prefetching requests. As soon as the
     * prefetch requests get fulfilled the new ones from the new dropped series
     * are sent to the server.
     *
     * */
    maxNumPrefetchRequests: 10,
    /* Display sets loading order (closest (deafult), downward or upward) */
    order: 'closest',
  },
  defaultDataSourceName: 'dicomweb',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'orthanc Server',
        name: 'dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        // https://github.com/OHIF/Viewers/pull/3878
        // https://docs.ohif.org/configuration/datasources/dicom-web/#singlepart
        singlepart: 'thumbnail,bulkdata',
        /*        wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',*/
        wadoUriRoot: 'https://primebe.futurepacs.com/orthanc/wado',
        qidoRoot: 'https://primebe.futurepacs.com/orthanc/dicom-web',
        wadoRoot: 'https://primebe.futurepacs.com/orthanc/dicom-web',
        /*       onConfiguration: (dicomWebConfig, options) => {
          const { query } = options;
          const gateway = query.get('gateway');
          const pathUrlDicomWeb = `${gateway}/orthanc/dicom-web`;
          const pathUrlWado = `${gateway}/orthanc/wado`;
          return {
            ...dicomWebConfig,
            wadoRoot: pathUrlDicomWeb,
            qidoRoot: pathUrlDicomWeb,
            wadoUriRoot: pathUrlWado,
          };
        },
*/
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        acceptHeader: [
          'multipart/related; type=application/octet-stream; transfer-syntax=*',
          //          'multipart/related; type=application/octet-stream; transfer-syntax=1.2.840.10008.1.2.4.50',
          //          'multipart/related; type=image/jpeg; transfer-syntax=*',
        ],
        omitQuotationForMultipartRequest: true,
        dicomUploadEnabled: true,
        allowMultiSelectExport: true,
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
};
