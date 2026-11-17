import SUPPORTED_TOOLS from './constants/supportedTools';
import { getIsLocked } from './utils/getIsLocked';
import { getIsVisible } from './utils/getIsVisible';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { utils } from '@ohif/core';
import { hasUnresolvedSingleRegionLengthCalibration } from '../correctUSRegionLength';
import { resolveLengthValueForTarget } from '../resolveLengthValue';
import { getImageIdForLengthTarget } from '../usRegionLengthCalibration';

const Length = {
  toAnnotation: measurement => {},

  /**
   * Maps cornerstone annotation event data to measurement service format.
   *
   * @param {Object} cornerstone Cornerstone event data
   * @return {Measurement} Measurement instance
   */
  toMeasurement: (
    csToolsEventDetail,
    displaySetService,
    cornerstoneViewportService,
    getValueTypeFromToolType,
    customizationService
  ) => {
    const { annotation } = csToolsEventDetail;
    const { metadata, data, annotationUID } = annotation;

    const isLocked = getIsLocked(annotationUID);
    const isVisible = getIsVisible(annotationUID);
    // const colorString = config.style.getStyleProperty('color', { annotationUID });

    // color string is like 'rgb(255, 255, 255)' we need them to be in RGBA array [255, 255, 255, 255]
    // Todo: this should be in a utility
    // const color = colorString.replace('rgb(', '').replace(')', '').split(',').map(Number);

    if (!metadata || !data) {
      console.warn('Length tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;
    const validToolType = SUPPORTED_TOOLS.includes(toolName);

    if (!validToolType) {
      throw new Error('Tool not supported');
    }

    const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    let displaySet;

    if (SOPInstanceUID) {
      displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
        SOPInstanceUID,
        SeriesInstanceUID
      );
    } else {
      displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];
    }

    const { points, textBox } = data.handles;

    const mappedAnnotations = getMappedAnnotations(annotation, displaySetService);

    // Do not emit a persistable numeric measurement when a single spatial
    // ultrasound region has no image-plane spacing. Native Cornerstone can
    // apply PhysicalDelta twice in this state (6.98 mm -> 1.16 mm).
    if (
      mappedAnnotations.some(({ targetId, resolved }) =>
        !resolved &&
        hasUnresolvedSingleRegionLengthCalibration(
          getImageIdForLengthTarget(targetId, referencedImageId)
        )
      )
    ) {
      return null;
    }

    // The measurement record gets the calibrated value for panels, persistence
    // and quiz capture. The live annotation's cachedStats are NOT modified:
    // the native Length renderer owns them, and the on-image text is produced
    // from the same calibration function (createCalibratedLengthTextLines).
    // Always copy: MeasurementService keeps this object by reference and mode
    // code (e.g. iUSCAN unit normalisation) mutates measurement.data, which
    // must never reach the live annotation.
    const calibratedData = Object.fromEntries(
      mappedAnnotations.map(({ targetId, nativeStats, length, unit, resolved }) => [
        targetId,
        resolved ? { ...nativeStats, length, unit } : { ...nativeStats },
      ])
    );

    const displayText = getDisplayText(mappedAnnotations, displaySet);
    const getReport = () =>
      _getReport(mappedAnnotations, points, FrameOfReferenceUID, customizationService);

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      points,
      textBox,
      isLocked,
      isVisible,
      metadata,
      referenceSeriesUID: SeriesInstanceUID,
      referenceStudyUID: StudyInstanceUID,
      referencedImageId,
      frameNumber: mappedAnnotations[0]?.frameNumber || 1,
      toolName: metadata.toolName,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      label: data.label,
      displayText: displayText,
      data: calibratedData,
      type: getValueTypeFromToolType(toolName),
      getReport,
    };
  },
};

function getMappedAnnotations(annotation, displaySetService) {
  const { metadata, data } = annotation;
  const { cachedStats } = data;
  const { referencedImageId } = metadata;
  const targets = Object.keys(cachedStats || {});

  if (!targets.length) {
    return [];
  }

  const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
    referencedImageId,
    displaySetService,
    annotation
  );
  const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];
  const { SeriesNumber } = displaySet;

  return targets.map(targetId => {
    const nativeStats = cachedStats[targetId];
    const { length: rawLength, unit: nativeUnit = 'mm' } = nativeStats || {};
    // Shared with the on-image Length text: unchanged restored mm first,
    // otherwise the current frame's DICOM ultrasound region calibration.
    // Native non-US/unsupported values pass through unchanged.
    const resolved = resolveLengthValueForTarget(targetId, data, referencedImageId);

    return {
      targetId,
      nativeStats,
      resolved,
      SeriesInstanceUID,
      SOPInstanceUID,
      SeriesNumber,
      frameNumber,
      unit: resolved ? resolved.unit : nativeUnit,
      length: resolved ? resolved.lengthMm : rawLength,
    };
  });
}

/*
This function is used to convert the measurement data to a format that is
suitable for the report generation (e.g. for the csv report). The report
returns a list of columns and corresponding values.
*/
function _getReport(mappedAnnotations, points, FrameOfReferenceUID, customizationService) {
  const columns = [];
  const values = [];

  // Add Type
  columns.push('AnnotationType');
  values.push('Cornerstone:Length');

  mappedAnnotations.forEach(annotation => {
    const { length, unit } = annotation;
    columns.push(`Length`);
    values.push(length);
    columns.push('Unit');
    values.push(unit);
  });

  if (FrameOfReferenceUID) {
    columns.push('FrameOfReferenceUID');
    values.push(FrameOfReferenceUID);
  }

  if (points) {
    columns.push('points');
    // points has the form of [[x1, y1, z1], [x2, y2, z2], ...]
    // convert it to string of [[x1 y1 z1];[x2 y2 z2];...]
    // so that it can be used in the csv report
    values.push(points.map(p => p.join(' ')).join(';'));
  }

  return {
    columns,
    values,
  };
}

function getDisplayText(mappedAnnotations, displaySet) {
  const displayText = {
    primary: [],
    secondary: [],
  };

  if (!mappedAnnotations || !mappedAnnotations.length) {
    return displayText;
  }

  // Length is the same for all series
  const { length, SeriesNumber, SOPInstanceUID, frameNumber, unit } = mappedAnnotations[0];

  const instance = displaySet.instances.find(image => image.SOPInstanceUID === SOPInstanceUID);

  let InstanceNumber;
  if (instance) {
    InstanceNumber = instance.InstanceNumber;
  }

  const instanceText = InstanceNumber ? ` I: ${InstanceNumber}` : '';
  const frameText = displaySet.isMultiFrame ? ` F: ${frameNumber}` : '';

  if (length === null || length === undefined) {
    return displayText;
  }
  const roundedLength = utils.roundNumber(length, 2);
  displayText.primary.push(`${roundedLength} ${unit}`);
  displayText.secondary.push(`S: ${SeriesNumber}${instanceText}${frameText}`);

  return displayText;
}

export default Length;
