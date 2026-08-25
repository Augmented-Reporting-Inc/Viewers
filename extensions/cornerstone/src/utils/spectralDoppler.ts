import { utilities as csUtils } from '@cornerstonejs/core';

export const SPECTRAL_DOPPLER_MEASUREMENT_KIND = 'spectralDopplerVTI';
export const SPECTRAL_DOPPLER_LABEL = 'VTI';

const SPECTRAL_SPATIAL_FORMAT = 3;
const PW_SPECTRAL_DOPPLER_DATA_TYPE = 3;
const CW_SPECTRAL_DOPPLER_DATA_TYPE = 4;
const SECONDS_UNIT = 4;
const CM_PER_SECOND_UNIT = 7;
const MIN_TRACE_PIXEL_COLUMNS = 3;
const MIN_TRACE_DURATION_SECONDS = 0.005;
const MIN_CALIBRATED_TRACE_POINT_RATIO = 0.98;

function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readRawDicomValue(source, keys = []) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function readDicomValue(source, keys = []) {
  const value = readRawDicomValue(source, keys);

  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  if (Array.isArray(value?.Value)) {
    return value.Value[0];
  }

  if (Array.isArray(value?.value)) {
    return value.value[0];
  }

  return value;
}

function readDicomNumber(source, keys = []) {
  return finiteNumber(readDicomValue(source, keys));
}

function getDicomSequenceValues(source, keys = []) {
  const value = readRawDicomValue(source, keys);

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.Value)) {
    return value.Value;
  }

  if (Array.isArray(value?.value)) {
    return value.value;
  }

  return [value];
}

function normalizeDicomCode(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).trim();
  const hexMatch = text.match(/^0*([0-9a-f]+)h$/i);

  if (hexMatch) {
    return parseInt(hexMatch[1], 16);
  }

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function getSpectralDopplerRegionsFromSource(source) {
  const candidates = [
    source,
    source?.metadata,
    source?.Metadata,
    source?.instance,
    source?.attributes,
    source?.dicom,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const regions = getDicomSequenceValues(candidate, [
      'SequenceOfUltrasoundRegions',
      'sequenceOfUltrasoundRegions',
      '00186011',
      'x00186011',
    ]);

    if (regions.length) {
      return regions;
    }
  }

  return [];
}

function normalizeSpectralDopplerRegion(region) {
  const spatialFormat = normalizeDicomCode(
    readDicomValue(region, [
      'RegionSpatialFormat',
      'regionSpatialFormat',
      '00186012',
      'x00186012',
    ])
  );
  const dataType = normalizeDicomCode(
    readDicomValue(region, ['RegionDataType', 'regionDataType', '00186014', 'x00186014'])
  );
  const minX = readDicomNumber(region, [
    'RegionLocationMinX0',
    'regionLocationMinX0',
    '00186018',
    'x00186018',
  ]);
  const minY = readDicomNumber(region, [
    'RegionLocationMinY0',
    'regionLocationMinY0',
    '0018601A',
    'x0018601A',
  ]);
  const maxX = readDicomNumber(region, [
    'RegionLocationMaxX1',
    'regionLocationMaxX1',
    '0018601C',
    'x0018601C',
  ]);
  const maxY = readDicomNumber(region, [
    'RegionLocationMaxY1',
    'regionLocationMaxY1',
    '0018601E',
    'x0018601E',
  ]);
  const referencePixelX0 = readDicomNumber(region, [
    'ReferencePixelX0',
    'referencePixelX0',
    '00186020',
    'x00186020',
  ]);
  const referencePixelY0 = readDicomNumber(region, [
    'ReferencePixelY0',
    'referencePixelY0',
    '00186022',
    'x00186022',
  ]);
  const physicalUnitsXDirection = normalizeDicomCode(
    readDicomValue(region, [
      'PhysicalUnitsXDirection',
      'physicalUnitsXDirection',
      '00186024',
      'x00186024',
    ])
  );
  const physicalUnitsYDirection = normalizeDicomCode(
    readDicomValue(region, [
      'PhysicalUnitsYDirection',
      'physicalUnitsYDirection',
      '00186026',
      'x00186026',
    ])
  );
  const referencePhysicalValueX = readDicomNumber(region, [
    'ReferencePixelPhysicalValueX',
    'referencePixelPhysicalValueX',
    'RefPixelPhysicalValueX',
    'refPixelPhysicalValueX',
    '00186028',
    'x00186028',
  ]);
  const referencePhysicalValueY = readDicomNumber(region, [
    'ReferencePixelPhysicalValueY',
    'referencePixelPhysicalValueY',
    'RefPixelPhysicalValueY',
    'refPixelPhysicalValueY',
    '0018602A',
    'x0018602A',
  ]);
  const physicalDeltaX = readDicomNumber(region, [
    'PhysicalDeltaX',
    'physicalDeltaX',
    '0018602C',
    'x0018602C',
  ]);
  const physicalDeltaY = readDicomNumber(region, [
    'PhysicalDeltaY',
    'physicalDeltaY',
    '0018602E',
    'x0018602E',
  ]);

  const isSpectralType =
    spatialFormat === SPECTRAL_SPATIAL_FORMAT ||
    dataType === PW_SPECTRAL_DOPPLER_DATA_TYPE ||
    dataType === CW_SPECTRAL_DOPPLER_DATA_TYPE;

  if (
    !isSpectralType ||
    minX == null ||
    minY == null ||
    maxX == null ||
    maxY == null ||
    referencePixelX0 == null ||
    referencePixelY0 == null ||
    referencePhysicalValueX == null ||
    referencePhysicalValueY == null ||
    physicalDeltaX == null ||
    physicalDeltaY == null ||
    physicalDeltaX === 0 ||
    physicalDeltaY === 0 ||
    physicalUnitsXDirection !== SECONDS_UNIT ||
    physicalUnitsYDirection !== CM_PER_SECOND_UNIT
  ) {
    return null;
  }

  // DICOM defines Reference Pixel x0/y0 as offsets from Region Location Min.
  const referenceImageX = minX + referencePixelX0;
  const referenceImageY = minY + referencePixelY0;

  return {
    minX,
    minY,
    maxX,
    maxY,
    spatialFormat,
    dataType,
    referencePixelX0,
    referencePixelY0,
    referenceImageX,
    referenceImageY,
    referencePhysicalValueX,
    referencePhysicalValueY,
    physicalUnitsXDirection,
    physicalUnitsYDirection,
    physicalDeltaX,
    physicalDeltaY,
  };
}

function getRegionPixelArea(region) {
  return Math.abs((region.maxX - region.minX) * (region.maxY - region.minY));
}

function pointIsInsideRegion(point, region) {
  return (
    point &&
    point[0] >= region.minX &&
    point[0] <= region.maxX &&
    point[1] >= region.minY &&
    point[1] <= region.maxY
  );
}

function chooseSpectralDopplerRegion(regions, imagePoints = []) {
  const normalizedRegions = (Array.isArray(regions) ? regions : [])
    .map(normalizeSpectralDopplerRegion)
    .filter(Boolean);

  if (!normalizedRegions.length) {
    return null;
  }

  const validPoints = (Array.isArray(imagePoints) ? imagePoints : []).filter(
    point => Array.isArray(point) && point.length >= 2
  );

  if (validPoints.length) {
    const scored = normalizedRegions
      .map(region => ({
        region,
        insideCount: validPoints.filter(point => pointIsInsideRegion(point, region)).length,
      }))
      .sort((a, b) => {
        if (b.insideCount !== a.insideCount) {
          return b.insideCount - a.insideCount;
        }

        return getRegionPixelArea(a.region) - getRegionPixelArea(b.region);
      });

    if (scored[0]?.insideCount > 0) {
      return scored[0].region;
    }
  }

  return normalizedRegions.sort((a, b) => getRegionPixelArea(b) - getRegionPixelArea(a))[0];
}

function worldPointsToImagePoints(points = [], referencedImageId = '') {
  if (!referencedImageId) {
    return [];
  }

  return (Array.isArray(points) ? points : [])
    .map(point => {
      if (!Array.isArray(point) || point.length < 2) {
        return null;
      }

      try {
        const imagePoint = csUtils.worldToImageCoords(referencedImageId, point);
        const x = finiteNumber(imagePoint?.[0]);
        const y = finiteNumber(imagePoint?.[1]);

        return x == null || y == null ? null : [x, y];
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function convertImagePointToSpectralValues(point, region) {
  const imageX = Number(point[0]);
  const imageY = Number(point[1]);
  const timeSeconds =
    region.referencePhysicalValueX + (imageX - region.referenceImageX) * region.physicalDeltaX;
  const velocityCmPerSecond =
    region.referencePhysicalValueY + (imageY - region.referenceImageY) * region.physicalDeltaY;

  if (!Number.isFinite(timeSeconds) || !Number.isFinite(velocityCmPerSecond)) {
    return null;
  }

  return {
    imageX,
    imageY,
    timeSeconds,
    velocityCmPerSecond,
  };
}

function collapseTraceByPixelColumn(samples = []) {
  const byColumn = new Map();

  for (const sample of samples) {
    const column = Math.round(sample.imageX);
    const existing = byColumn.get(column);

    if (
      !existing ||
      Math.abs(sample.velocityCmPerSecond) > Math.abs(existing.velocityCmPerSecond)
    ) {
      byColumn.set(column, sample);
    }
  }

  return Array.from(byColumn.values()).sort((a, b) => a.timeSeconds - b.timeSeconds);
}

function formatVTI(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatVelocityMPerSecond(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return value.toFixed(2);
}

function formatDurationSeconds(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return value < 1 ? value.toFixed(3) : value.toFixed(2);
}

export function buildSpectralDopplerDisplayText(spectralDoppler = {}) {
  const values = spectralDoppler?.values || {};

  if (
    spectralDoppler?.status === 'complete' &&
    Number.isFinite(Number(values.vtiCM)) &&
    Number.isFinite(Number(values.peakVelocityMPerSec))
  ) {
    return [
      `VTI ${formatVTI(Number(values.vtiCM))} cm`,
      `Vmax ${formatVelocityMPerSecond(Number(values.peakVelocityMPerSec))} m/s`,
    ];
  }

  return ['VTI: spectral Doppler calibration unavailable'];
}

function buildUnavailableResult(message, extras = {}) {
  const result = {
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    status: 'unavailable',
    message,
    values: null,
    ...extras,
  };

  return {
    ...result,
    displayText: buildSpectralDopplerDisplayText(result),
  };
}

export function calculateSpectralDopplerVTI({
  points = [],
  referencedImageId = '',
  dicomSource = null,
} = {}) {
  const imagePoints = worldPointsToImagePoints(points, referencedImageId);

  if (imagePoints.length < 2) {
    return buildUnavailableResult(
      'The VTI trace could not be converted from world coordinates to image coordinates.'
    );
  }

  const regions = getSpectralDopplerRegionsFromSource(dicomSource);
  const region = chooseSpectralDopplerRegion(regions, imagePoints);

  if (!region) {
    return buildUnavailableResult(
      'No calibrated spectral Doppler region with seconds on X and cm/s on Y was found.'
    );
  }

  const insideImagePoints = imagePoints.filter(point => pointIsInsideRegion(point, region));
  const insideRatio = insideImagePoints.length / imagePoints.length;

  if (
    insideImagePoints.length < 2 ||
    insideRatio < MIN_CALIBRATED_TRACE_POINT_RATIO
  ) {
    return buildUnavailableResult(
      'The VTI trace extends outside the calibrated Doppler region. Redraw the complete envelope inside the spectral Doppler region.',
      {
        calibration: {
          spatialFormat: region.spatialFormat,
          dataType: region.dataType,
          insideRatio,
          minimumInsideRatio: MIN_CALIBRATED_TRACE_POINT_RATIO,
          sourcePointCount: imagePoints.length,
          calibratedPointCount: insideImagePoints.length,
        },
      }
    );
  }

  const samples = insideImagePoints
    .map(point => convertImagePointToSpectralValues(point, region))
    .filter(Boolean);
  const envelope = collapseTraceByPixelColumn(samples);

  if (envelope.length < MIN_TRACE_PIXEL_COLUMNS) {
    return buildUnavailableResult('The VTI trace does not span enough Doppler time columns.', {
      calibration: {
        spatialFormat: region.spatialFormat,
        dataType: region.dataType,
        insideRatio,
      },
    });
  }

  const firstTime = envelope[0].timeSeconds;
  const lastTime = envelope[envelope.length - 1].timeSeconds;
  const durationSeconds = Math.abs(lastTime - firstTime);

  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_TRACE_DURATION_SECONDS) {
    return buildUnavailableResult('The VTI trace duration is too short to calculate.', {
      calibration: {
        spatialFormat: region.spatialFormat,
        dataType: region.dataType,
        insideRatio,
      },
    });
  }

  let vtiCM = 0;

  for (let index = 1; index < envelope.length; index += 1) {
    const first = envelope[index - 1];
    const second = envelope[index];
    const deltaTime = Math.abs(second.timeSeconds - first.timeSeconds);

    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      continue;
    }

    const firstVelocity = Math.abs(first.velocityCmPerSecond);
    const secondVelocity = Math.abs(second.velocityCmPerSecond);
    vtiCM += ((firstVelocity + secondVelocity) / 2) * deltaTime;
  }

  const peakSample = envelope.reduce((currentPeak, sample) => {
    if (!currentPeak) {
      return sample;
    }

    return Math.abs(sample.velocityCmPerSecond) > Math.abs(currentPeak.velocityCmPerSecond)
      ? sample
      : currentPeak;
  }, null);

  const peakVelocityCmPerSec = Math.abs(Number(peakSample?.velocityCmPerSecond));
  const peakVelocityMPerSec = peakVelocityCmPerSec / 100;
  const meanVelocityMPerSec = durationSeconds > 0 ? vtiCM / durationSeconds / 100 : null;

  if (
    !Number.isFinite(vtiCM) ||
    vtiCM <= 0 ||
    !Number.isFinite(peakVelocityMPerSec) ||
    peakVelocityMPerSec <= 0
  ) {
    return buildUnavailableResult('The calibrated Doppler trace did not produce a valid VTI.', {
      calibration: {
        spatialFormat: region.spatialFormat,
        dataType: region.dataType,
        insideRatio,
      },
    });
  }

  const result = {
    measurementKind: SPECTRAL_DOPPLER_MEASUREMENT_KIND,
    status: 'complete',
    message: '',
    calibration: {
      source: 'SequenceOfUltrasoundRegions',
      spatialFormat: region.spatialFormat,
      dataType: region.dataType,
      physicalUnitsXDirection: region.physicalUnitsXDirection,
      physicalUnitsYDirection: region.physicalUnitsYDirection,
      physicalDeltaX: region.physicalDeltaX,
      physicalDeltaY: region.physicalDeltaY,
      referencePixelX0: region.referencePixelX0,
      referencePixelY0: region.referencePixelY0,
      referencePhysicalValueX: region.referencePhysicalValueX,
      referencePhysicalValueY: region.referencePhysicalValueY,
      insideRatio,
    },
    trace: {
      sourcePointCount: imagePoints.length,
      calibratedPointCount: insideImagePoints.length,
      envelopeColumnCount: envelope.length,
      startTimeSeconds: Math.min(firstTime, lastTime),
      endTimeSeconds: Math.max(firstTime, lastTime),
      durationSeconds,
    },
    values: {
      vtiCM,
      peakVelocityMPerSec,
      meanVelocityMPerSec,
      durationSeconds,
    },
  };

  return {
    ...result,
    displayText: buildSpectralDopplerDisplayText(result),
  };
}

export function getSpectralDopplerSummaryText(spectralDoppler = {}) {
  if (spectralDoppler?.status !== 'complete') {
    return spectralDoppler?.message || 'Spectral Doppler calibration unavailable.';
  }

  const values = spectralDoppler.values || {};
  return `VTI ${formatVTI(Number(values.vtiCM))} cm, Vmax ${formatVelocityMPerSecond(
    Number(values.peakVelocityMPerSec)
  )} m/s, duration ${formatDurationSeconds(Number(values.durationSeconds))} s`;
}
