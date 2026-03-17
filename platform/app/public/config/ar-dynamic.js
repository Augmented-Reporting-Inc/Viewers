// config/ar-dynamic.js
// One build, runtime-switching:
// - routerBasename: '/' (CloudFront) vs '/rviewer' (EC2)
// - data source: Static-WADO (CloudFront, via ?clinicName=SPACE|PACE|...) vs Orthanc (EC2 /rviewer)

window.config = () => {
  const { pathname, search, hostname } = window.location;
  const params = new URLSearchParams(search);

  // Viewer location: CloudFront at "/" vs EC2 at "/rviewer"
  const underRViewer = pathname.startsWith('/rviewer');
  const routerBasename = underRViewer ? '/rviewer' : '/';

  // For Static-WADO (CloudFront), we select the tenant/clinic prefix from ?clinicName
  // Example: https://arview.futurepacs.com/?clinicName=SPACE  -> qido/wado roots at /SPACE
  const clinicName = (params.get('clinicName') || '').trim();

  // --- Data sources ---
  const staticWadoSource = {
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
      onConfiguration: cfg => {
        // Resolves to /<clinicName> for QIDO/WADO roots (CloudFront behaviors handle routing)
        // NOTE: ensure ?clinicName is provided on CloudFront links
        const base = clinicName ? `/${clinicName}` : '/';
        return {
          ...cfg,
          wadoRoot: base,
          qidoRoot: base,
          wadoUriRoot: base,
        };
      },
      bulkDataURI: { enabled: true, relativeResolution: 'studies' },
      acceptHeader: [
        'multipart/related; type=application/octet-stream; transfer-syntax=*',
        // 'multipart/related; type=application/octet-stream; transfer-syntax=1.2.840.10008.1.2.4.50',
        // 'multipart/related; type=image/jpeg; transfer-syntax=*',
      ],
      omitQuotationForMultipartRequest: true,
    },
  };

  const orthancSource = {
    namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
    sourceName: 'dicomweb',
    configuration: {
      friendlyName: 'Orthanc (EC2)',
      name: 'orthanc',
      qidoSupportsIncludeField: true,
      imageRendering: 'wadors',
      thumbnailRendering: 'wadors',
      enableStudyLazyLoad: true,
      supportsFuzzyMatching: true,
      supportsWildcard: true,
      staticWado: false,
      // relative to the EC2 host that serves the viewer at /rviewer
      qidoRoot: '/orthanc/dicom-web',
      wadoRoot: '/orthanc/dicom-web',
      wadoUriRoot: '/orthanc/wado',
      omitQuotationForMultipartRequest: true,
    },
  };

  const chosenSource = underRViewer ? orthancSource : staticWadoSource;

  return {
    name: 'config/ar-dynamic.js',
    routerBasename,
    extensions: [],
    modes: [],
    showPatientInfo: 'visible',
    showStudyList: true,
    maxNumberOfWebWorkers: 4,
    showWarningMessageForCrossOrigin: true,
    showCPUFallbackMessage: true,
    showLoadingIndicator: true,
    experimentalStudyBrowserSort: false,
    strictZSpacingForVolumeViewport: true,
    groupEnabledModesFirst: true,
    allowMultiSelectExport: false,
    maxNumRequests: { interaction: 100, thumbnail: 200, prefetch: 1000 },
    useNorm16Texture: true,
    useSharedArrayBuffer: 'AUTO',
    autoPlayCine: true,
    investigationalUseDialog: { option: 'never' },
    studyPrefetcher: {
      enabled: true,
      displaySetCount: 200,
      maxNumPrefetchRequests: 1000,
      order: 'closest',
    },
    defaultDataSourceName: 'dicomweb',
    dataSources: [chosenSource],
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
    httpErrorHandler: e => {
      console.warn(e?.status);
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
};
