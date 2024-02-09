import { isImage } from '@ohif/core/src/utils/isImage';
import ImageSet from '@ohif/core/src/classes/ImageSet';
import isDisplaySetReconstructable from '@ohif/core/src/utils/isDisplaySetReconstructable';
import { id } from './id';

const sopClassHandlerName = 'stressecho';

// mandatory to declare sopClassUids or extension will fail to register
const sopClassUids = [
  '1.2.840.10008.5.1.4.1.1.3.1', // UltrasoundMultiframeImageStorage:
  '1.2.840.10008.5.1.4.1.1.6.1', // UltrasoundImageStorage:
];

const makeDisplaySet = instances => {
  const instance = instances[0];

  const imageSet = new ImageSet(instances);

  const { value: isReconstructable, averageSpacingBetweenFrames } =
    isDisplaySetReconstructable(instances);

  imageSet.setAttributes({
    displaySetInstanceUID: imageSet.uid, // mandatory create a local alias for the imageSet UID
    SeriesDate: instance.SeriesDate,
    SeriesTime: instance.SeriesTime,
    SeriesInstanceUID: instance.SeriesInstanceUID,
    StudyInstanceUID: instance.StudyInstanceUID,
    SeriesNumber: instance.SeriesNumber || 0,
    InstanceNumber: instance.InstanceNumber,
    FrameRate: instance.FrameTime,
    SOPClassUID: instance.SOPClassUID,
    SeriesDescription: instance.SeriesDescription || '',
    Modality: instance.Modality,
    isStress: isStress(instance),
    countIcon: isReconstructable ? 'icon-mpr' : undefined,
    numImageFrames: instances.length,
    SOPClassHandlerId: `${id}.sopClassHandlerModule.${sopClassHandlerName}`,
    isReconstructable,
    averageSpacingBetweenFrames: averageSpacingBetweenFrames || null,
  });

  // Sort the images in this series if needed
  const shallSort = true; //!OHIF.utils.ObjectPath.get(Meteor, 'settings.public.ui.sortSeriesByIncomingOrder');
  if (shallSort) {
    imageSet.sortBy((a, b) => {
      // Sort by InstanceNumber (0020,0013)
      return (parseInt(a.InstanceNumber) || 0) - (parseInt(b.InstanceNumber) || 0);
    });
  }

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
 * @param {Array} sopClassHandlerModules List of SOP Class Modules
 * @param {SeriesMetadata} series The series metadata object from which the display sets will be created
 * @returns {Array} The list of display sets created for the given series object
 */
function getDisplaySetsFromSeries(instances) {
  // If the series has no instances, stop here
  if (!instances || !instances.length) {
    throw new Error('No instances were provided');
  }

  const displaySets = [];
  const sopClassUids = getSopClassUids(instances);

  instances.forEach(instance => {
    // All imaging modalities must have a valid value for sopClassUid (x00080016) or rows (x00280010)
    if (!isImage(instance.SOPClassUID) && !instance.Rows) {
      return;
    }

    let displaySet;

    displaySet = makeDisplaySet([instance]);

    displaySet.setAttributes({
      sopClassUids,
      isClip: instance.NumberOfFrames > 1,
      numImageFrames: instance.NumberOfFrames || 1,
      instanceNumber: instance.InstanceNumber,
      acquisitionDatetime: instance.AcquisitionDateTime,
    });
    displaySets.push(displaySet);
    displaySets.sort((a, b) => (a.InstanceNumber > b.InstanceNumber ? 1 : -1));
  });

  return displaySets;
}

/**
  if (instanceDetail.PerformedProcedureStepDescription === "Stress Study") {
    arrPatMeasures.ProtocolName = "Stress";
  }
  //  if (instanceDetail.PerformedProcedureStepDescription === "Dobutamine Study") {
  if (
    instanceDetail.PerformedProcedureStepDescription?.toLowerCase().includes(
      "dobutamine"
    )
  ) {
    arrPatMeasures.ProtocolName = "Dobutamine";
  }
*/

const isStress = instance => {
  return instance.PerformedProcedureStepDescription.includes('Stress Study');
};

function getSopClassHandlerModule() {
  return [
    {
      name: sopClassHandlerName,
      sopClassUids,
      getDisplaySetsFromSeries,
    },
  ];
}

export default getSopClassHandlerModule;
