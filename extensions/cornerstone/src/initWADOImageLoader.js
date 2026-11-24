import { volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';

const { registerVolumeLoader } = volumeLoader;

export default function initWADOImageLoader(
  userAuthenticationService,
  appConfig,
  extensionManager
) {
  registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);

  registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  dicomImageLoader.init({
    maxWebWorkers: Math.min(
      Math.max(navigator.hardwareConcurrency - 1, 1),
      appConfig.maxNumberOfWebWorkers
    ),
    beforeSend: function (xhr, imageId) {
      //TODO should be removed in the future and request emitted by DicomWebDataSource
      const sourceConfig = extensionManager.getActiveDataSource()?.[0].getConfig() ?? {};
      const headers = userAuthenticationService.getAuthorizationHeader();
      const acceptHeader = utils.generateAcceptHeader(
        sourceConfig.acceptHeader,
        sourceConfig.requestTransferSyntaxUID,
        sourceConfig.omitQuotationForMultipartRequest
      );

      const xhrRequestHeaders = {
        Accept: acceptHeader,
      };

      if (headers) {
        Object.assign(xhrRequestHeaders, headers);
      }
      // AR-1107: pixel/frame requests use the same per-window grant as QIDO
      // and metadata. Ordinary, clinical and iUSCAN bviewer sessions do not
      // have this function and preserve their existing session auth.
      if (typeof appConfig.getArImageReadHeaders === 'function') {
        if (typeof appConfig.assertArImageReadImageId !== 'function') {
          throw new Error('ar_image_read_frame_verification_missing');
        }
        appConfig.assertArImageReadImageId(imageId);
        Object.assign(xhrRequestHeaders, appConfig.getArImageReadHeaders());
      }

      return xhrRequestHeaders;
    },
    errorInterceptor: error => {
      errorHandler.getHTTPErrorHandler(error);
    },
  });
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}
