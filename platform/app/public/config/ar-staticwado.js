window.config = {
  name: 'config/ar-staticwado.js',
  routerBasename: null,
  extensions: [],
  modes: [],
  showPatientInfo: 'visible',
  customizationService: {
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
  showStudyList: !1,
  maxNumberOfWebWorkers: 4,
  showWarningMessageForCrossOrigin: !0,
  showCPUFallbackMessage: !0,
  showLoadingIndicator: !0,
  experimentalStudyBrowserSort: !1,
  strictZSpacingForVolumeViewport: !0,
  groupEnabledModesFirst: !0,
  allowMultiSelectExport: !1,
  maxNumRequests: { interaction: 100, thumbnail: 75, prefetch: 1e3 },
  useNorm16Texture: !0,
  useSharedArrayBuffer: 'AUTO',
  autoPlayCine: !0,
  investigationalUseDialog: { option: 'never' },
  studyPrefetcher: {
    enabled: !0,
    displaySetCount: 2,
    maxNumPrefetchRequests: 10,
    order: 'closest',
  },
  multimonitor: [
    {
      id: 'split',
      test: ({ multimonitor: e }) => 'split' === e,
      screens: [
        {
          id: 'ohif0',
          screen: null,
          location: { screen: 0, width: 0.5, height: 1, left: 0, top: 0 },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: null,
          location: { width: 0.5, height: 1, left: 0.5, top: 0 },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },
    {
      id: '2',
      test: ({ multimonitor: e }) => '2' === e,
      screens: [
        {
          id: 'ohif0',
          screen: 0,
          location: { width: 1, height: 1, left: 0, top: 0 },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: 1,
          location: { width: 1, height: 1, left: 0, top: 0 },
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
        qidoSupportsIncludeField: !1,
        imageRendering: 'wadors',
        thumbnailRendering: 'thumbnail',
        enableStudyLazyLoad: !0,
        supportsFuzzyMatching: !0,
        supportsWildcard: !1,
        staticWado: !0,
        singlepart: 'thumbnail',
        onConfiguration: e => {
          const t = new URLSearchParams(window.location.search).get('clinicName');
          return {
            ...e,
            wadoRoot: `/${t}`,
            qidoRoot: `/${t}`,
            wadoUriRoot: `/${t}`,
          };
        },
        bulkDataURI: { enabled: !0, relativeResolution: 'studies' },
        acceptHeader: [
          'multipart/related; type=application/octet-stream; transfer-syntax=*',
          //          'multipart/related; type=application/octet-stream; transfer-syntax=1.2.840.10008.1.2.4.50',
          //          'multipart/related; type=image/jpeg; transfer-syntax=*',
        ],
        omitQuotationForMultipartRequest: !0,
      },
    },
  ],
  httpErrorHandler: e => {
    (console.warn(e.status), console.warn('test, navigate to https://ohif.org/'));
  },
  whiteLabeling: {
    createLogoComponentFn: function (e) {
      return e.createElement(
        'a',
        {
          target: '_self',
          rel: 'noopener noreferrer',
          className: 'text-white text-xl font-serif',
          href: 'https://futurepacs.com',
        },
        e.createElement('div', {}, 'futurePACS')
      );
    },
  },
};
