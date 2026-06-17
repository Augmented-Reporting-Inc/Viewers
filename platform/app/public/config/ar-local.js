// ar-local.js — dev config for localhost:3000
// Same as ar.js but with routerBasename '/' and showStudyList true
// Run with: $env:APP_CONFIG="config/ar-local.js"; yarn dev

window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],
  showPatientInfo: 'visible',
  showStudyList: true,
  maxNumberOfWebWorkers: 4,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: false,
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
  defaultDataSourceName: 'dicomweb',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'dragonfoot orthanc',
        name: 'dicomweb',
        wadoUriRoot: '/orthanc/wado',
        qidoRoot: '/orthanc/dicom-web',
        wadoRoot: '/orthanc/dicom-web',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'thumbnail,bulkdata',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        acceptHeader: ['multipart/related; type=application/octet-stream; transfer-syntax=*'],
        omitQuotationForMultipartRequest: true,
        dicomUploadEnabled: true,
        allowMultiSelectExport: true,
      },
    },
  ],
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
