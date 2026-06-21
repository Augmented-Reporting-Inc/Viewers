import { utils, classes } from '@ohif/core';
import i18n from '@ohif/i18n';
import { id } from './id';
import getDisplaySetMessages from './getDisplaySetMessages';
import getDisplaySetsFromUnsupportedSeries from './getDisplaySetsFromUnsupportedSeries';
import { chartHandler } from './SOPClassHandlers/chartSOPClassHandler';

const { isImage, sopClassDictionary, isDisplaySetReconstructable } = utils;
const { ImageSet } = classes;

const DEFAULT_VOLUME_LOADER_SCHEME = 'cornerstoneStreamingImageVolume';
const DYNAMIC_VOLUME_LOADER_SCHEME = 'cornerstoneStreamingDynamicImageVolume';
const sopClassHandlerName = 'stack';
let appContext = {};

const getDynamicVolumeInfo = instances => {
  const { extensionManager } = appContext;

  if (!extensionManager) {
    throw new Error('extensionManager is not available');
  }

  const imageIds = instances.map(({ imageId }) => imageId);
  const volumeLoaderUtility = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.volumeLoader'
  );
  const { getDynamicVolumeInfo: csGetDynamicVolumeInfo } = volumeLoaderUtility.exports;

  return csGetDynamicVolumeInfo(imageIds);
};

const isMultiFrame = instance => {
  return instance.NumberOfFrames > 1;
};

const toNumberOrMax = value => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.MAX_SAFE_INTEGER;
};

const getInstanceNumber = instance => toNumberOrMax(instance?.InstanceNumber);

const getInstanceTieBreaker = instance =>
  String(
    instance?.AcquisitionDateTime ||
      instance?.AcquisitionTime ||
      instance?.SOPInstanceUID ||
      instance?.imageId ||
      ''
  );

const compareInstancesByInstanceNumber = (a, b) => {
  const instanceNumberA = getInstanceNumber(a);
  const instanceNumberB = getInstanceNumber(b);

  if (instanceNumberA !== instanceNumberB) {
    return instanceNumberA - instanceNumberB;
  }

  return getInstanceTieBreaker(a).localeCompare(getInstanceTieBreaker(b));
};

const sortInstancesByInstanceNumber = instances => {
  return [...instances].sort(compareInstancesByInstanceNumber);
};

const isSupportedImageInstance = instance => {
  return isImage(instance.SOPClassUID) || instance.Rows;
};

const getFrameCount = instance => {
  const frameCount = Number(instance?.NumberOfFrames);
  return Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 1;
};

const getImageFrameCount = ({ instances, imageIds }) => {
  if (imageIds?.length) {
    return imageIds.length;
  }

  return instances.reduce((total, instance) => total + getFrameCount(instance), 0);
};

const getFirstThumbnailSource = ({ instances, imageIds }) => {
  return {
    imageId: imageIds?.[0],
    thumbnailInstance: instances[0],
  };
};

const compareDisplaySetsByInstanceNumber = (a, b) => {
  const instanceNumberA = toNumberOrMax(a.InstanceNumber ?? a.instanceNumber);
  const instanceNumberB = toNumberOrMax(b.InstanceNumber ?? b.instanceNumber);

  if (instanceNumberA !== instanceNumberB) {
    return instanceNumberA - instanceNumberB;
  }

  return String(a.displaySetInstanceUID || '').localeCompare(String(b.displaySetInstanceUID || ''));
};

function getDisplaySetInfo(instances) {
  const dynamicVolumeInfo = getDynamicVolumeInfo(instances);
  const { isDynamicVolume, timePoints } = dynamicVolumeInfo;
  let displaySetInfo;

  const { appConfig } = appContext;

  if (isDynamicVolume) {
    const timePoint = timePoints[0];
    const instancesMap = new Map();

    // O(n) to convert it into a map and O(1) to find each instance
    instances.forEach(instance => instancesMap.set(instance.imageId, instance));

    const firstTimePointInstances = timePoint.map(imageId => instancesMap.get(imageId));

    displaySetInfo = isDisplaySetReconstructable(firstTimePointInstances, appConfig);
  } else {
    displaySetInfo = isDisplaySetReconstructable(instances, appConfig);
  }

  return {
    isDynamicVolume,
    ...displaySetInfo,
    dynamicVolumeInfo,
  };
}

const makeDisplaySet = instances => {
  const sortedInstances = sortInstancesByInstanceNumber(instances);
  const instance = sortedInstances[0];
  const instanceNumber = getInstanceNumber(instance);
  const originalSeriesNumber = instance.SeriesNumber || 0;
  const imageSet = new ImageSet(sortedInstances);
  const { extensionManager } = appContext;
  const dataSource = extensionManager.getActiveDataSource()[0];
  const {
    isDynamicVolume,
    value: isReconstructable,
    averageSpacingBetweenFrames,
    dynamicVolumeInfo,
  } = getDisplaySetInfo(instances);

  const volumeLoaderSchema = isDynamicVolume
    ? DYNAMIC_VOLUME_LOADER_SCHEME
    : DEFAULT_VOLUME_LOADER_SCHEME;

  // set appropriate attributes to image set...
  const messages = getDisplaySetMessages(instances, isReconstructable, isDynamicVolume);

  const imageIds = dataSource.getImageIdsForDisplaySet(imageSet);
  const { imageId, thumbnailInstance } = getFirstThumbnailSource({
    instances: sortedInstances,
    imageIds,
  });
  const numImageFrames = getImageFrameCount({ instances: sortedInstances, imageIds });

  imageSet.setAttributes({
    volumeLoaderSchema,
    displaySetInstanceUID: imageSet.uid, // create a local alias for the imageSet UID
    SeriesDate: instance.SeriesDate,
    SeriesTime: instance.SeriesTime,
    SeriesInstanceUID: instance.SeriesInstanceUID,
    StudyInstanceUID: instance.StudyInstanceUID,
    // This custom handler creates one displaySet per instance.
    // Use InstanceNumber as the display-set sort key so OHIF's initial
    // thumbnail/viewport selection starts with the lowest instance number.
    SeriesNumber: instanceNumber,
    originalSeriesNumber,
    InstanceNumber: instanceNumber,
    instanceNumber,
    initialImageIndex: 0,
    initialImageOptions: {
      index: 0,
    },
    FrameRate: instance.FrameTime,
    EffectiveDuration:
      instance.FrameTime && instance.NumberOfFrames
        ? (instance.FrameTime * instance.NumberOfFrames) / 1000
        : undefined,
    SOPClassUID: instance.SOPClassUID,
    SeriesDescription: instance.SeriesDescription || '',
    Modality: instance.Modality,
    isMultiFrame: sortedInstances.some(isMultiFrame),
    countIcon: isReconstructable ? 'icon-mpr' : undefined,
    numImageFrames,
    SOPClassHandlerId: `${id}.sopClassHandlerModule.${sopClassHandlerName}`,
    isReconstructable,
    messages,
    averageSpacingBetweenFrames: averageSpacingBetweenFrames || null,
    isDynamicVolume,
    dynamicVolumeInfo,
    getThumbnailSrc: dataSource.retrieve.getGetThumbnailSrc?.(thumbnailInstance, imageId),
    supportsWindowLevel: true,
    label:
      instance.SeriesDescription ||
      `${i18n.t('Series')} ${originalSeriesNumber} - ${i18n.t(instance.Modality)}`,
    FrameOfReferenceUID: instance.FrameOfReferenceUID,
  });

  // Include the first image instance number (after sorted)
  /*imageSet.setAttribute(
    'instanceNumber',
    imageSet.getImage(0).InstanceNumber
  );*/

  /*const isReconstructable = isDisplaySetReconstructable(series, instances);

  imageSet.isReconstructable = isReconstructable.value;

  if (isReconstructable.missingFrames) {
    // TODO -> This is currently unused, but may be used for reconstructing
    // Volumes with gaps later on.
    imageSet.missingFrames = isReconstructable.missingFrames;
  }*/

  return imageSet;
};

const isSingleImageModality = modality => {
  return modality === 'CR' || modality === 'MG' || modality === 'DX';
};

function getSopClassUids(instances) {
  const uniqueSopClassUidsInSeries = new Set();
  instances.forEach(instance => {
    uniqueSopClassUidsInSeries.add(instance.SOPClassUID);
  });
  const sopClassUids = Array.from(uniqueSopClassUidsInSeries);

  return sopClassUids;
}

/**
 * Basic SOPClassHandler:
 * - For all Image types that are stackable, create
 *   a displaySet with a stack of images
 *
 * @param {SeriesMetadata} series The series metadata object from which the display sets will be created
 * @returns {Array} The list of display sets created for the given series object
 */
function getDisplaySetsFromSeries(instances) {
  // If the series has no instances, stop here
  if (!instances || !instances.length) {
    throw new Error('No instances were provided');
  }

  const sopClassUids = getSopClassUids(instances);
  const imageInstances = sortInstancesByInstanceNumber(instances.filter(isSupportedImageInstance));

  const displaySets = imageInstances.map(instance => {
    const displaySet = makeDisplaySet([instance]);
    const instanceNumber = getInstanceNumber(instance);

    displaySet.setAttributes({
      sopClassUids,
      isClip: isMultiFrame(instance),
      numImageFrames: getFrameCount(instance),
      InstanceNumber: instanceNumber,
      instanceNumber,
      acquisitionDatetime: instance.AcquisitionDateTime,
    });

    return displaySet;
  });

  displaySets.sort(compareDisplaySetsByInstanceNumber);

  return displaySets;
}

const sopClassUids = [
  sopClassDictionary.ComputedRadiographyImageStorage,
  sopClassDictionary.DigitalXRayImageStorageForPresentation,
  sopClassDictionary.DigitalXRayImageStorageForProcessing,
  sopClassDictionary.DigitalMammographyXRayImageStorageForPresentation,
  sopClassDictionary.DigitalMammographyXRayImageStorageForProcessing,
  sopClassDictionary.DigitalIntraOralXRayImageStorageForPresentation,
  sopClassDictionary.DigitalIntraOralXRayImageStorageForProcessing,
  sopClassDictionary.CTImageStorage,
  sopClassDictionary.EnhancedCTImageStorage,
  sopClassDictionary.LegacyConvertedEnhancedCTImageStorage,
  sopClassDictionary.UltrasoundMultiframeImageStorage,
  sopClassDictionary.MRImageStorage,
  sopClassDictionary.EnhancedMRImageStorage,
  sopClassDictionary.EnhancedMRColorImageStorage,
  sopClassDictionary.LegacyConvertedEnhancedMRImageStorage,
  sopClassDictionary.UltrasoundImageStorage,
  sopClassDictionary.UltrasoundImageStorageRET,
  sopClassDictionary.SecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeSingleBitSecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeGrayscaleByteSecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeGrayscaleWordSecondaryCaptureImageStorage,
  sopClassDictionary.MultiframeTrueColorSecondaryCaptureImageStorage,
  sopClassDictionary.XRayAngiographicImageStorage,
  sopClassDictionary.EnhancedXAImageStorage,
  sopClassDictionary.XRayRadiofluoroscopicImageStorage,
  sopClassDictionary.EnhancedXRFImageStorage,
  sopClassDictionary.XRay3DAngiographicImageStorage,
  sopClassDictionary.XRay3DCraniofacialImageStorage,
  sopClassDictionary.BreastTomosynthesisImageStorage,
  sopClassDictionary.BreastProjectionXRayImageStorageForPresentation,
  sopClassDictionary.BreastProjectionXRayImageStorageForProcessing,
  sopClassDictionary.IntravascularOpticalCoherenceTomographyImageStorageForPresentation,
  sopClassDictionary.IntravascularOpticalCoherenceTomographyImageStorageForProcessing,
  sopClassDictionary.NuclearMedicineImageStorage,
  sopClassDictionary.VLEndoscopicImageStorage,
  sopClassDictionary.VideoEndoscopicImageStorage,
  sopClassDictionary.VLMicroscopicImageStorage,
  sopClassDictionary.VideoMicroscopicImageStorage,
  sopClassDictionary.VLSlideCoordinatesMicroscopicImageStorage,
  sopClassDictionary.VLPhotographicImageStorage,
  sopClassDictionary.VideoPhotographicImageStorage,
  sopClassDictionary.OphthalmicPhotography8BitImageStorage,
  sopClassDictionary.OphthalmicPhotography16BitImageStorage,
  sopClassDictionary.OphthalmicTomographyImageStorage,
  // Handled by another sop class module
  // sopClassDictionary.VLWholeSlideMicroscopyImageStorage,
  sopClassDictionary.PositronEmissionTomographyImageStorage,
  sopClassDictionary.EnhancedPETImageStorage,
  sopClassDictionary.LegacyConvertedEnhancedPETImageStorage,
  sopClassDictionary.RTImageStorage,
  sopClassDictionary.EnhancedUSVolumeStorage,
  sopClassDictionary.RTDoseStorage,
];

function getSopClassHandlerModule(appContextParam) {
  appContext = appContextParam;

  return [
    {
      name: sopClassHandlerName,
      sopClassUids,
      getDisplaySetsFromSeries,
    },
    {
      name: 'not-supported-display-sets-handler',
      sopClassUids: [],
      getDisplaySetsFromSeries: getDisplaySetsFromUnsupportedSeries,
    },
    {
      name: chartHandler.name,
      sopClassUids: chartHandler.sopClassUids,
      getDisplaySetsFromSeries: chartHandler.getDisplaySetsFromSeries,
    },
  ];
}

export default getSopClassHandlerModule;
