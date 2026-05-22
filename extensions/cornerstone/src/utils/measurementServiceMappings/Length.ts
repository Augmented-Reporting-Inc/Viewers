import SUPPORTED_TOOLS from './constants/supportedTools';
import { getIsLocked } from './utils/getIsLocked';
import { getIsVisible } from './utils/getIsVisible';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import { utils } from '@ohif/core';
import { metaData } from '@cornerstonejs/core';

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
      data: data.cachedStats,
      type: getValueTypeFromToolType(toolName),
      getReport,
    };
  },
};

function getMappedAnnotations(annotation, displaySetService) {
  const { metadata, data } = annotation;
  const { cachedStats } = data;
  const { referencedImageId } = metadata;
  const targets = Object.keys(cachedStats);

  if (!targets.length) {
    return [];
  }

  const annotations = [];
  Object.keys(cachedStats).forEach(targetId => {
    const targetStats = cachedStats[targetId];

    const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    const displaySet = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)[0];

    const { SeriesNumber } = displaySet;
    const { length: rawLength, unit = 'mm' } = targetStats;
    const length = _correctUSRegionLength(rawLength, referencedImageId, annotation);
    targetStats.length = length; // write back so cachedStats stays consistent

    annotations.push({
      SeriesInstanceUID,
      SOPInstanceUID,
      SeriesNumber,
      frameNumber,
      unit,
      length,
    });
  });

  return annotations;
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

function _correctUSRegionLength(rawLength, referencedImageId, annotation) {
  if (!referencedImageId) return rawLength;
  try {
    const calibration = metaData.get('calibrationModule', referencedImageId);
    const regions = calibration?.sequenceOfUltrasoundRegions;
    if (!regions?.length) return rawLength;

    const SUPPORTED = [1, 2, 3, 4];
    const handles = annotation?.data?.handles?.points;
    if (!handles || handles.length < 2) return rawLength;

    const imagePlane = metaData.get('imagePlaneModule', referencedImageId);
    const colSpacing = imagePlane?.columnPixelSpacing ?? 1.0;
    const rowSpacing = imagePlane?.rowPixelSpacing ?? 1.0;

    const pixelHandles = handles.map(w => ({
      x: w[0] / colSpacing,
      y: w[1] / rowSpacing,
    }));

    const region = regions.find(
      r =>
        SUPPORTED.includes(r.regionDataType) &&
        pixelHandles.every(
          px =>
            px.x >= r.regionLocationMinX0 &&
            px.x <= r.regionLocationMaxX1 &&
            px.y >= r.regionLocationMinY0 &&
            px.y <= r.regionLocationMaxY1
        )
    );

    if (!region) return rawLength;

    const [p1, p2] = pixelHandles;
    const dxPhys = (p1.x - p2.x) * Math.abs(region.physicalDeltaX);
    const dyPhys = (p1.y - p2.y) * Math.abs(region.physicalDeltaY);
    const corrected = Math.sqrt(dxPhys * dxPhys + dyPhys * dyPhys);
    return corrected;
  } catch (e) {
    console.error('[Length] error:', e);
    return rawLength;
  }
}

export default Length;
