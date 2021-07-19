window.config = {
  routerBasename: '/',
  whiteLabelling: {},
  extensions: [],
  showStudyList: true,
  filterQueryParam: false,
  servers: {
    dicomWeb: [
      {
        name: 'Orthanc',
        wadoUriRoot: `${process.env.REACT_APP_VIEWER_URL}/orthanc/wado`,
        qidoRoot: `${process.env.REACT_APP_VIEWER_URL}/orthanc/dicom-web`,
        wadoRoot: `${process.env.REACT_APP_VIEWER_URL}/orthanc/dicom-web`,
        qidoSupportsIncludeField: false,
        imageRendering: `${process.env.REACT_APP_RENDERING_FORMAT}`,
        thumbnailRendering: `${process.env.REACT_APP_RENDERING_FORMAT}`,
        enableStudyLazyLoad: true,
        requestOptions: {
          auth: `${process.env.REACT_APP_ORTHANC_AUTH}`,
          logRequests: true,
          logResponses: true,
          logTiming: true
        },
      },
    ],
  },
    cornerstoneExtensionConfig: {},
 oidc: [
    {
      // ~ REQUIRED
      // Authorization Server URL
      authority: `${process.env.REACT_APP_COGNITO_AUTH_URL}`,
      client_id: `${process.env.REACT_APP_COGNITO_CLIENT_ID}`,
      redirect_uri: `${process.env.REACT_APP_VIEWER_URL}/callback`, // `OHIFStandaloneViewer.js`
      response_type: 'code', // "Authorization Code Flow"
      scope: 'openid', // email profile openid
      // ~ OPTIONAL
//      post_logout_redirect_uri: '/logout-redirect.html',
    },
  ],
};
