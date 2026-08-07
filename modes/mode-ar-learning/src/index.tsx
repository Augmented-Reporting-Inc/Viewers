import i18n from 'i18next';
import { eventTarget, metaData } from '@cornerstonejs/core';
import {
  Enums as CornerstoneToolsEnums,
  annotation as cornerstoneAnnotation,
} from '@cornerstonejs/tools';
import { id } from './id';
import { initToolGroups, toolbarButtons } from '@ohif/mode-longitudinal';

const ECHO_LENGTH_MEASUREMENT_LABELS_CONFIG = {
  id: 'echoLengthMeasurementLabels',
  domain: 'echo',
  dialogTitle: 'Echo Annotation',
  annotationTitle: 'Echo Annotation',
  labelOnMeasure: true,
  exclusive: true,
  items: [
    { value: 'LVIDd', label: 'LVIDd' },
    { value: 'LVIDs', label: 'LVIDs' },
    { value: 'IVSd', label: 'IVSd' },
    { value: 'PWd', label: 'PWd' },
    { value: 'AO', label: 'Aortic root' },
    { value: 'AscAo', label: 'Ascending aorta' },
    { value: 'LVOTDiam', label: 'LVOT diameter' },
    { value: 'LAd', label: 'Left atrial dimension' },
    { value: 'RVIDd', label: 'RVIDd' },
    { value: 'TAPSE', label: 'TAPSE' },
  ],
};

const BOWEL_LENGTH_MEASUREMENT_LABELS_CONFIG = {
  id: 'bowelLengthMeasurementLabels',
  domain: 'bowel',
  dialogTitle: 'Bowel Annotation',
  annotationTitle: 'Bowel Annotation',
  labelOnMeasure: true,
  exclusive: true,
  items: [
    { value: 'BowelRectumBWT', label: 'Rectum BWT' },
    { value: 'BowelSigmoidColonBWT', label: 'Sigmoid colon BWT' },
    { value: 'BowelDescendingColonBWT', label: 'Descending colon BWT' },
    { value: 'BowelTransverseColonBWT', label: 'Transverse colon BWT' },
    { value: 'BowelAscendingColonBWT', label: 'Ascending colon BWT' },
    { value: 'BowelCecumBWT', label: 'Cecum BWT' },
    { value: 'BowelTerminalIleumBWT', label: 'Terminal ileum BWT' },
    { value: 'BowelIleocolicAnastomosisBWT', label: 'Ileocolic anastomosis BWT' },
    { value: 'BowelNeoTerminalIleumBWT', label: 'Neo-terminal ileum BWT' },
  ],
};

function getViewerMeasurementDomainFromPath() {
  const params = new URLSearchParams(window.location?.search || '');

  const integration = String(params.get('arIntegration') || '')
    .trim()
    .toLowerCase();

  if (integration === 'iuscan') {
    return 'bowel';
  }

  const explicitDomain = String(
    params.get('arMeasurementDomain') ||
      params.get('arViewerDomain') ||
      params.get('viewerDomain') ||
      ''
  )
    .trim()
    .toLowerCase();

  if (['iuscan', 'bowel', 'echo', 'generic'].includes(explicitDomain)) {
    return explicitDomain === 'iuscan' ? 'bowel' : explicitDomain;
  }

  const path = String(window.location?.pathname || '').toLowerCase();

  if (path.includes('/bviewer/iuscan')) {
    return 'bowel';
  }

  if (path.includes('/bviewer')) {
    return 'bowel';
  }

  if (path.includes('/rviewer') || path.includes('/stressecho') || path.includes('/dobutamine')) {
    return 'echo';
  }

  // Learning workflows may contain multiple clinical specialties.
  // Do not silently default them to Echo when no study-level domain exists.
  return 'generic';
}

function getLearningUrlParam(name) {
  try {
    return String(new URLSearchParams(window.location?.search || '').get(name) || '')
      .trim()
      .toLowerCase();
  } catch {
    return '';
  }
}

function normalizeLearningUrlToken(value = '') {
  return String(value || '')
    .trim()
    .replace(/[_\s-]+/g, '')
    .toLowerCase();
}

function isViewerMeasurementReadOnlyFromUrl() {
  return ['readonly', 'feedbackreadonly'].includes(
    normalizeLearningUrlToken(getLearningUrlParam('arMeasurementAccess'))
  );
}

function isEditableReviewMeasurementWorkflowFromUrl() {
  return (
    normalizeLearningUrlToken(getLearningUrlParam('arReviewWorkflowType')) ===
      'virtualcoaching' &&
    normalizeLearningUrlToken(getLearningUrlParam('arSaveTarget')) ===
      'reviewworkflowmeasurements' &&
    normalizeLearningUrlToken(getLearningUrlParam('arMeasurementAccess')) === 'edit'
  );
}

function isTruthyLearningUrlFlag(value = '') {
  return ['1', 'true', 'yes', 'y'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function isViewerQuizAuthoringFromUrl() {
  return isTruthyLearningUrlFlag(getLearningUrlParam('arQuizAuthoring'));
}

const AR_QUIZ_MEASUREMENT_DOMAIN_EVENT = 'ar-learning:quiz-measurement-domain';

function normalizeQuizMeasurementDomain(value = '') {
  const domain = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (domain === 'iuscan') {
    return 'bowel';
  }

  return ['echo', 'bowel'].includes(domain) ? domain : '';
}

function isViewerQuizMeasurementCaptureMode() {
  const captureMode = getLearningUrlParam('arQuizMeasurementCapture');

  return ['selected', 'manual', 'quiz'].includes(captureMode) || isViewerQuizWorkflowFromUrl();
}

const AR_QUIZ_MEASUREMENT_ADDED_EVENT = 'ar-learning:quiz-measurement-added';

function dispatchViewerQuizMeasurementAdded(measurement) {
  if (!isViewerQuizMeasurementCaptureMode()) {
    return;
  }

  const measurementId = String(
    measurement?.uid || measurement?.annotationUID || measurement?.annotationId || ''
  ).trim();

  if (!measurementId) {
    return;
  }

  window.setTimeout(() => {
    try {
      window.dispatchEvent(
        new CustomEvent(AR_QUIZ_MEASUREMENT_ADDED_EVENT, {
          detail: {
            measurementId,
            toolName: measurement?.toolName || '',
          },
        })
      );
    } catch {}
  }, 50);
}

const AR_US_REGION_PIXEL_SPACING_PROVIDER_PRIORITY = 10000;

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
  const numberValue = Number(readDicomValue(source, keys));
  return Number.isFinite(numberValue) ? numberValue : null;
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

function parseDicomWebImageIdParts(imageId = '') {
  const match = String(imageId).match(
    /\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)(?:\/frames\/\d+)?/i
  );

  if (!match) {
    return null;
  }

  return {
    studyInstanceId: decodeURIComponent(match[1]),
    seriesInstanceId: decodeURIComponent(match[2]),
    sopInstanceId: decodeURIComponent(match[3]),
  };
}

function getSopInstanceIdFromSource(source) {
  return (
    source?.SOPInstanceUID ||
    source?.sopInstanceUID ||
    source?.metadata?.SOPInstanceUID ||
    source?.Metadata?.SOPInstanceUID ||
    readDicomValue(source, ['SOPInstanceUID', '00080018', 'x00080018'])
  );
}

function normalizeImageIdForCompare(imageId = '') {
  return String(imageId || '')
    .replace(/^wadors:/i, '')
    .replace(/^dicomweb:/i, '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .toLowerCase();
}

function getDisplaySetImageIds(displaySet) {
  const candidates = [
    displaySet?.imageIds,
    displaySet?.images?.map(image => image?.imageId),
    displaySet?.instances?.map(instance => instance?.imageId),
  ].filter(Boolean);

  return candidates.flatMap(candidate => (Array.isArray(candidate) ? candidate : [candidate]));
}

function getDisplaySetInstances(displaySet) {
  const candidates = [
    displaySet?.images,
    displaySet?.instances,
    displaySet?.instance,
    displaySet?.metadata?.images,
    displaySet?.metadata?.instances,
  ].filter(Boolean);

  return candidates.flatMap(candidate => (Array.isArray(candidate) ? candidate : [candidate]));
}

function getDicomInstanceForImageId(displaySetService, imageId = '') {
  if (!displaySetService || !imageId) {
    return null;
  }

  const normalizedImageId = normalizeImageIdForCompare(imageId);
  const ids = parseDicomWebImageIdParts(imageId);
  const sopInstanceId = ids?.sopInstanceId || '';

  const displaySets =
    displaySetService.getActiveDisplaySets?.() || displaySetService.getDisplaySets?.() || [];

  for (const displaySet of displaySets) {
    const imageIds = getDisplaySetImageIds(displaySet).map(normalizeImageIdForCompare);
    const instances = getDisplaySetInstances(displaySet);

    const imageIdIndex = imageIds.findIndex(candidate => {
      return (
        candidate === normalizedImageId ||
        candidate.endsWith(normalizedImageId) ||
        normalizedImageId.endsWith(candidate)
      );
    });

    if (imageIdIndex >= 0 && instances[imageIdIndex]) {
      return instances[imageIdIndex];
    }

    if (sopInstanceId) {
      const matchedInstance = instances.find(
        instance => String(getSopInstanceIdFromSource(instance) || '') === sopInstanceId
      );

      if (matchedInstance) {
        return matchedInstance;
      }
    }
  }

  return null;
}

function normalizePhysicalUnitCode(unitCode) {
  if (unitCode === undefined || unitCode === null) {
    return null;
  }

  if (typeof unitCode === 'number') {
    return unitCode;
  }

  const text = String(unitCode).trim();
  const hexMatch = text.match(/^0*([0-9a-f]+)h$/i);

  if (hexMatch) {
    return parseInt(hexMatch[1], 16);
  }

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getPhysicalUnitScaleToMM(unitCode) {
  const code = normalizePhysicalUnitCode(unitCode);

  // DICOM US Region Calibration:
  // 0003H = cm, so cm/pixel -> mm/pixel requires × 10.
  // Do not use non-spatial units such as seconds, hertz, velocity, etc.
  if (code === 3) {
    return 10;
  }

  return null;
}

function getUltrasoundRegionsFromInstance(instance) {
  const candidates = [
    instance,
    instance?.metadata,
    instance?.Metadata,
    instance?.attributes,
    instance?.dicom,
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

function normalizeUltrasoundRegion(region) {
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
  const physicalUnitsX = readDicomValue(region, [
    'PhysicalUnitsXDirection',
    'physicalUnitsXDirection',
    '00186024',
    'x00186024',
  ]);
  const physicalUnitsY = readDicomValue(region, [
    'PhysicalUnitsYDirection',
    'physicalUnitsYDirection',
    '00186026',
    'x00186026',
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

  const xScale = getPhysicalUnitScaleToMM(physicalUnitsX);
  const yScale = getPhysicalUnitScaleToMM(physicalUnitsY);

  if (
    physicalDeltaX == null ||
    physicalDeltaY == null ||
    !xScale ||
    !yScale ||
    physicalDeltaX === 0 ||
    physicalDeltaY === 0
  ) {
    return null;
  }

  return {
    sourceRegion: region,
    minX,
    minY,
    maxX,
    maxY,
    physicalDeltaX,
    physicalDeltaY,
    physicalUnitsXDirection: normalizePhysicalUnitCode(physicalUnitsX),
    physicalUnitsYDirection: normalizePhysicalUnitCode(physicalUnitsY),
    column: Math.abs(physicalDeltaX) * xScale,
    row: Math.abs(physicalDeltaY) * yScale,
  };
}

function getRegionPixelArea(region) {
  if (
    region?.minX == null ||
    region?.minY == null ||
    region?.maxX == null ||
    region?.maxY == null
  ) {
    return 0;
  }

  return Math.abs((region.maxX - region.minX) * (region.maxY - region.minY));
}

function chooseRepresentativeUltrasoundRegion(regions = []) {
  const normalizedRegions = regions.map(normalizeUltrasoundRegion).filter(Boolean);

  if (!normalizedRegions.length) {
    return null;
  }

  // Metadata providers receive only imageId, not measurement points.
  // Prefer the largest spatially calibrated region as the best image-level
  // approximation for B-mode echo/US anatomy.
  return normalizedRegions.sort((a, b) => getRegionPixelArea(b) - getRegionPixelArea(a))[0];
}

function buildCornerstoneUltrasoundRegionMetadata(region) {
  if (!region) {
    return null;
  }

  return {
    ...(region.sourceRegion || {}),

    // Cornerstone core reads the lower-camel names from ultrasoundRegions metadata.
    regionLocationMinX0: region.minX,
    regionLocationMinY0: region.minY,
    regionLocationMaxX1: region.maxX,
    regionLocationMaxY1: region.maxY,
    physicalUnitsXDirection: region.physicalUnitsXDirection,
    physicalUnitsYDirection: region.physicalUnitsYDirection,
    physicalDeltaX: region.physicalDeltaX,
    physicalDeltaY: region.physicalDeltaY,
  };
}

function getRepresentativeUltrasoundRegionMetadataForImageId(displaySetService, imageId = '') {
  const instance = getDicomInstanceForImageId(displaySetService, imageId);

  if (!instance) {
    return undefined;
  }

  const regions = getUltrasoundRegionsFromInstance(instance);
  const region = chooseRepresentativeUltrasoundRegion(regions);
  const cornerstoneRegion = buildCornerstoneUltrasoundRegionMetadata(region);

  if (!cornerstoneRegion) {
    return undefined;
  }

  return [cornerstoneRegion];
}

function getUSRegionCalibratedPixelSpacingForImageId(displaySetService, imageId = '') {
  const instance = getDicomInstanceForImageId(displaySetService, imageId);

  if (!instance) {
    return undefined;
  }

  const regions = getUltrasoundRegionsFromInstance(instance);
  const region = chooseRepresentativeUltrasoundRegion(regions);

  if (!region?.row || !region?.column) {
    return undefined;
  }

  return {
    rowPixelSpacing: region.row,
    columnPixelSpacing: region.column,
    spacing: [region.row, region.column],
    unit: 'mm',
    type: 'AR_US_REGION_CALIBRATION',
  };
}

function createARUSRegionCalibrationProvider({ displaySetService }) {
  const debug = String(window.localStorage?.getItem('AR_US_REGION_CAL_DEBUG') || '') === '1';

  return function arUSRegionCalibrationProvider(type, imageId) {
    if (type === 'ultrasoundRegions') {
      const ultrasoundRegions = getRepresentativeUltrasoundRegionMetadataForImageId(
        displaySetService,
        imageId
      );

      if (debug) {
        console.info(
          `[AR US Region Calibration] ultrasoundRegions lookup ${JSON.stringify({
            hit: !!ultrasoundRegions,
            imageId,
            regionCount: ultrasoundRegions?.length || 0,
            region: ultrasoundRegions?.[0] || null,
          })}`
        );
      }

      return ultrasoundRegions;
    }

    if (type === 'calibratedPixelSpacing') {
      const spacing = getUSRegionCalibratedPixelSpacingForImageId(displaySetService, imageId);

      if (debug) {
        console.info(
          `[AR US Region Calibration] calibratedPixelSpacing lookup ${JSON.stringify({
            hit: !!spacing,
            imageId,
            spacing: spacing || null,
          })}`
        );
      }

      return spacing;
    }

    return undefined;
  };
}

const BASE_MEASUREMENT_TOOL_IDS = [
  'Length',
  'Bidirectional',
  'EllipticalROI',
  'RectangleROI',
  'CircleROI',
];

const ECHO_ONLY_MEASUREMENT_TOOL_IDS = ['LVSimpsonEF', 'LVTraceSlot'];

const GENERIC_CONTOUR_TOOL_IDS = ['PlanarFreehandROI', 'SplineROI', 'LivewireContour'];

function getMeasurementToolIdsForDomain(domain) {
  return [
    ...BASE_MEASUREMENT_TOOL_IDS,
    ...(domain === 'echo' ? ECHO_ONLY_MEASUREMENT_TOOL_IDS : []),
    ...GENERIC_CONTOUR_TOOL_IDS,
  ];
}

function getRegisteredToolbarButtonIds(buttons = []) {
  const entries = Array.isArray(buttons) ? buttons : [];

  return new Set(
    entries
      .map(button => String(button?.id || '').trim())
      .filter(Boolean)
  );
}

function filterRegisteredToolbarButtonIds(
  buttonIds = [],
  registeredButtonIds = new Set(),
  sectionName = ''
) {
  const requested = Array.isArray(buttonIds) ? buttonIds.filter(Boolean) : [];

  if (!registeredButtonIds.size) {
    console.warn('[AR Learning Toolbar] toolbar registry was empty', {
      sectionName,
      requested,
    });
    return [];
  }

  const missing = requested.filter(buttonId => !registeredButtonIds.has(buttonId));

  if (missing.length) {
    console.warn('[AR Learning Toolbar] skipped unregistered button ids', {
      sectionName,
      missing,
    });
  }

  return requested.filter(buttonId => registeredButtonIds.has(buttonId));
}

async function resolveViewerMeasurementDomain(commandsManager) {
  try {
    const resolvedDomain = await commandsManager.runCommand(
      'getViewerMeasurementDomainForActiveStudy'
    );

    if (resolvedDomain) {
      return resolvedDomain;
    }
  } catch (error) {
    console.warn('[AR Measurements] could not resolve measurement domain:', error);
  }

  return getViewerMeasurementDomainFromPath();
}

async function getLabelConfigForMeasurement(
  measurement,
  commandsManager,
  { quizMeasurementDomain = '' } = {}
) {
  const toolName = measurement?.toolName;
  const viewerQuizMeasurementWorkflow = isViewerQuizMeasurementCaptureMode();
  const resolvedStudyDomain = viewerQuizMeasurementWorkflow
    ? normalizeQuizMeasurementDomain(quizMeasurementDomain) ||
      normalizeQuizMeasurementDomain(getViewerMeasurementDomainFromPath()) ||
      normalizeQuizMeasurementDomain(await resolveViewerMeasurementDomain(commandsManager))
    : await resolveViewerMeasurementDomain(commandsManager);
  const domain = resolvedStudyDomain === 'iuscan' ? 'bowel' : resolvedStudyDomain;

  // Both quiz authoring and learner quiz answering use the clinical study type
  // attached to the active quiz question. Do not silently fall back to the wrong
  // specialty for mixed-specialty learning tenants.
  if (viewerQuizMeasurementWorkflow && !['echo', 'bowel'].includes(domain)) {
    console.warn('[AR Measurements] quiz measurement domain is not selected', {
      domain,
      quizMeasurementDomain,
      urlDomain: getViewerMeasurementDomainFromPath(),
    });
    return null;
  }

  if (toolName === 'SplineROI' && domain === 'echo') {
    return {
      commandName: 'setLVTraceMeasurementLabel',
    };
  }

  if (toolName !== 'Length') {
    return null;
  }

  if (domain === 'iuscan') {
    return null;
  }

  if (domain === 'bowel') {
    return {
      title: 'Set Bowel Measurement',
      placeholder: 'Choose bowel measurement',
      labelConfigOverride: BOWEL_LENGTH_MEASUREMENT_LABELS_CONFIG,
    };
  }

  if (domain === 'echo') {
    return {
      title: 'Set Echo Measurement',
      placeholder: 'Choose echo measurement',
      labelConfigOverride: ECHO_LENGTH_MEASUREMENT_LABELS_CONFIG,
    };
  }

  return null;
}

async function waitForViewerMeasurementServiceEntry(
  measurementService,
  annotationId,
  attempts = 40
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const measurement = measurementService.getMeasurement?.(annotationId);

    if (measurement) {
      return measurement;
    }

    await new Promise(resolve => window.setTimeout(resolve, 25));
  }

  return null;
}

function isHydratedSavedWorkflowAnnotation(annotationId, fallbackAnnotation = null) {
  const sourceAnnotation =
    cornerstoneAnnotation.state.getAnnotation?.(annotationId) || fallbackAnnotation;

  return !!(
    sourceAnnotation?.data?.arMeasurementWorkflow || sourceAnnotation?.data?.arMeasurementReadOnly
  );
}

function getMeasurementAnnotationId(measurement = null) {
  return String(
    measurement?.uid ||
      measurement?.annotationUID ||
      measurement?.annotationId ||
      measurement?.id ||
      ''
  ).trim();
}

function getMeasurementAnnotationForId(annotationId = '') {
  const id = String(annotationId || '').trim();
  return id ? cornerstoneAnnotation.state.getAnnotation?.(id) || null : null;
}

function isMeasurementDrawingComplete(measurement = null, sourceAnnotation = null) {
  const toolName = String(
    measurement?.toolName || sourceAnnotation?.metadata?.toolName || ''
  ).trim();
  const points = Array.isArray(measurement?.points)
    ? measurement.points
    : sourceAnnotation?.data?.handles?.points;
  const activeHandleIndex = sourceAnnotation?.data?.handles?.activeHandleIndex;

  if (!toolName) {
    return false;
  }

  if (activeHandleIndex !== null && activeHandleIndex !== undefined) {
    return false;
  }

  if (toolName === 'Length') {
    return Array.isArray(points) && points.length >= 2;
  }

  return true;
}

// Allow this mode by excluding non-imaging modalities such as SR, SEG
// Also, SM is not a simple imaging modalities, so exclude it.
const NON_IMAGE_MODALITIES = ['ECG', 'SEG', 'RTSTRUCT', 'RTPLAN', 'PR'];

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  thumbnailList: '@ohif/extension-default.panelModule.seriesList',
  wsiSopClassHandler:
    '@ohif/extension-cornerstone.sopClassHandlerModule.DicomMicroscopySopClassHandler',
};

const cornerstone = {
  measurements: '@ohif/extension-cornerstone.panelModule.panelMeasurement',
  segmentation: '@ohif/extension-cornerstone.panelModule.panelSegmentation',
  viewport: '@ohif/extension-cornerstone.viewportModule.cornerstone',
};

const arMeasurements = {
  panel: 'extension-ar-measurements.panelModule.arMeasurements',
};

const arLearning = {
  caseQuestions: 'extension-ar-learning.panelModule.caseQuestions',
};

function isVirtualCoachingWorkflowFromUrl() {
  return getLearningUrlParam('arReviewWorkflowType').replace(/[_\s-]+/g, '') === 'virtualcoaching';
}

function getLearningInitialPanelFromUrl() {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const params = new URLSearchParams(window.location?.search || '');
    const raw = String(params.get('arInitialPanel') || params.get('arOpenPanel') || '')
      .trim()
      .replace(/[_\s-]+/g, '')
      .toLowerCase();

    if (['casequestions', 'questions', 'quiz', 'viewerquiz', 'quizauthoring'].includes(raw)) {
      return 'caseQuestions';
    }

    if (['armeasurements', 'measurements'].includes(raw)) {
      return 'arMeasurements';
    }

    if (isVirtualCoachingWorkflowFromUrl()) {
      return 'arMeasurements';
    }

    return '';
  } catch {
    return '';
  }
}

function isViewerQuizWorkflowFromUrl() {
  const scoringMode = getLearningUrlParam('arEducationScoringMode').replace(/[_\s-]+/g, '');

  return (
    isTruthyLearningUrlFlag(getLearningUrlParam('arQuizAuthoring')) ||
    scoringMode === 'viewerquiz' ||
    getLearningInitialPanelFromUrl() === 'caseQuestions'
  );
}

function getLearningInitialPanelId() {
  const initialPanel = getLearningInitialPanelFromUrl();

  if (initialPanel === 'caseQuestions') {
    return arLearning.caseQuestions;
  }

  if (initialPanel === 'arMeasurements') {
    return arMeasurements.panel;
  }

  return '';
}

function getLearningRightPanels() {
  return isViewerQuizWorkflowFromUrl()
    ? [arLearning.caseQuestions]
    : [arLearning.caseQuestions, arMeasurements.panel];
}

function shouldOpenLearningRightPanelByDefault() {
  return !!getLearningInitialPanelId();
}

const dicomsr = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr',
  sopClassHandler3D: '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr-3d',
  viewport: '@ohif/extension-cornerstone-dicom-sr.viewportModule.dicom-sr',
};

const dicomvideo = {
  sopClassHandler: '@ohif/extension-dicom-video.sopClassHandlerModule.dicom-video',
  viewport: '@ohif/extension-dicom-video.viewportModule.dicom-video',
};

const dicompdf = {
  sopClassHandler: '@ohif/extension-dicom-pdf.sopClassHandlerModule.dicom-pdf',
  viewport: '@ohif/extension-dicom-pdf.viewportModule.dicom-pdf',
};

const dicomSeg = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-seg.sopClassHandlerModule.dicom-seg',
  viewport: '@ohif/extension-cornerstone-dicom-seg.viewportModule.dicom-seg',
};

const dicomPmap = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-pmap.sopClassHandlerModule.dicom-pmap',
  viewport: '@ohif/extension-cornerstone-dicom-pmap.viewportModule.dicom-pmap',
};

const dicomRT = {
  viewport: '@ohif/extension-cornerstone-dicom-rt.viewportModule.dicom-rt',
  sopClassHandler: '@ohif/extension-cornerstone-dicom-rt.sopClassHandlerModule.dicom-rt',
};

const extensionDependencies = {
  // Can derive the versions at least process.env.from npm_package_version
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  'extension-ar-measurements': '^1.0.0',
  'extension-ar-learning': '^1.0.0',
  '@ohif/extension-cornerstone-dicom-sr': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-seg': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-pmap': '^3.0.0',
  '@ohif/extension-cornerstone-dicom-rt': '^3.0.0',
  '@ohif/extension-dicom-pdf': '^3.0.1',
  '@ohif/extension-dicom-video': '^3.0.1',
};

function modeFactory({ modeConfiguration }) {
  let _activatePanelTriggersSubscriptions = [];
  let _measurementAddedSub = null;
  let _measurementCompletionSubscriptions = [];
  let _annotationCompletedHandler: null | ((event: Event) => void) = null;
  const _measurementCompletionTimers = new Set<number>();
  const _handledCompletedAnnotationIds = new Set<string>();
  let _suppressLabelPrompt = false;
  let _quizMeasurementDomain = '';
  let _quizMeasurementDomainHandler: null | ((event: Event) => void) = null;
  let restoreConsoleWarn: null | (() => void) = null;
  let removeARUSRegionPixelSpacingProvider: null | (() => void) = null;

  return {
    // TODO: We're using this as a route segment
    // We should not be.
    id,
    routeName: 'learning',
    displayName: i18n.t('Modes:Learning Viewer'),
    /**
     * Lifecycle hooks
     */
    onModeEnter: function ({ servicesManager, extensionManager, commandsManager }: withAppTypes) {
      // Suppress repeated per-frame US region calibration warning
      const _origWarn = console.warn.bind(console);
      let _usRegionWarnSuppressed = false;
      console.warn = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('Sequence of Ultrasound Regions')) {
          if (!_usRegionWarnSuppressed) {
            _usRegionWarnSuppressed = true;
            _origWarn('[once]', ...args);
          }
          return;
        }
        _origWarn(...args);
      };

      restoreConsoleWarn = () => {
        console.warn = _origWarn;
        restoreConsoleWarn = null;
      };

      removeARUSRegionPixelSpacingProvider?.();

      const {
        measurementService,
        toolbarService,
        toolGroupService,
        customizationService,
        cineService,
        panelService,
        displaySetService,
      } = servicesManager.services;

      const arUSRegionPixelSpacingProvider = createARUSRegionCalibrationProvider({
        displaySetService,
      });

      (metaData as any).addProvider?.(
        arUSRegionPixelSpacingProvider,
        AR_US_REGION_PIXEL_SPACING_PROVIDER_PRIORITY
      );

      removeARUSRegionPixelSpacingProvider = () => {
        (metaData as any).removeProvider?.(arUSRegionPixelSpacingProvider);
        removeARUSRegionPixelSpacingProvider = null;
      };

      commandsManager.runCommand('clearViewerMeasurementsCreatedInSession');
      measurementService.clearMeasurements();

      _measurementAddedSub?.unsubscribe?.();
      _measurementAddedSub = null;

      _measurementCompletionSubscriptions.forEach(subscription =>
        subscription?.unsubscribe?.()
      );
      _measurementCompletionSubscriptions = [];

      _measurementCompletionTimers.forEach(timerId => window.clearTimeout(timerId));
      _measurementCompletionTimers.clear();

      if (_annotationCompletedHandler) {
        eventTarget.removeEventListener(
          CornerstoneToolsEnums.Events.ANNOTATION_COMPLETED,
          _annotationCompletedHandler
        );
      }

      _handledCompletedAnnotationIds.clear();

      if (_quizMeasurementDomainHandler) {
        window.removeEventListener(
          AR_QUIZ_MEASUREMENT_DOMAIN_EVENT,
          _quizMeasurementDomainHandler
        );
      }

      _quizMeasurementDomain = normalizeQuizMeasurementDomain(
        getViewerMeasurementDomainFromPath()
      );

      _quizMeasurementDomainHandler = (event: Event) => {
        const nextDomain = normalizeQuizMeasurementDomain(
          (event as CustomEvent)?.detail?.domain
        );

        _quizMeasurementDomain = nextDomain;

        console.info('[AR Measurements] quiz measurement domain updated', {
          domain: _quizMeasurementDomain || '(none)',
        });
      };

      window.addEventListener(
        AR_QUIZ_MEASUREMENT_DOMAIN_EVENT,
        _quizMeasurementDomainHandler
      );

      const measurementToolsReadOnly = isViewerMeasurementReadOnlyFromUrl();
      const editableReviewWorkflow = isEditableReviewMeasurementWorkflowFromUrl();
      const quizMeasurementWorkflow = isViewerQuizMeasurementCaptureMode();
      const completionAwareMeasurementWorkflow =
        editableReviewWorkflow || quizMeasurementWorkflow;

      const handleCompletedViewerMeasurement = async ({
        annotationId,
        sourceAnnotation = null,
        source = 'measurement-service',
      } = {}) => {
        const id = String(annotationId || '').trim();

        if (
          !completionAwareMeasurementWorkflow ||
          measurementToolsReadOnly ||
          _suppressLabelPrompt ||
          !id ||
          _handledCompletedAnnotationIds.has(id)
        ) {
          return false;
        }

        await new Promise(resolve => window.setTimeout(resolve, 0));

        const resolvedAnnotation = getMeasurementAnnotationForId(id) || sourceAnnotation;

        if (isHydratedSavedWorkflowAnnotation(id, resolvedAnnotation)) {
          return false;
        }

        const measurement = await waitForViewerMeasurementServiceEntry(measurementService, id);

        if (!measurement || !isMeasurementDrawingComplete(measurement, resolvedAnnotation)) {
          return false;
        }

        _handledCompletedAnnotationIds.add(id);

        commandsManager.runCommand('markViewerMeasurementCreatedInSession', {
          uid: id,
        });

        const currentMeasurement = measurementService.getMeasurement?.(id) || measurement;

        console.info('[AR Measurements] completed viewer measurement', {
          annotationId: id,
          source,
          toolName: currentMeasurement?.toolName || resolvedAnnotation?.metadata?.toolName || '',
        });

        if (!currentMeasurement?.label) {
          const labelOptions = await getLabelConfigForMeasurement(
            currentMeasurement,
            commandsManager,
            {
              quizMeasurementDomain: _quizMeasurementDomain,
            }
          );

          if (labelOptions) {
            try {
              console.info('[AR Measurements] label prompt config', {
                toolName: currentMeasurement?.toolName,
                title: labelOptions.title,
                placeholder: labelOptions.placeholder,
                labelConfigId: labelOptions.labelConfigOverride?.id,
                commandName: labelOptions.commandName,
              });

              if (labelOptions.commandName) {
                await commandsManager.runCommand(labelOptions.commandName, {
                  uid: id,
                });
              } else {
                await commandsManager.runCommand('setMeasurementLabel', {
                  uid: id,
                  ...labelOptions,
                });
              }
            } catch (error) {
              console.warn('[AR Measurements] label prompt failed:', error);
            }
          }
        }

        const completedMeasurement =
          measurementService.getMeasurement?.(id) || currentMeasurement;

        dispatchViewerQuizMeasurementAdded(completedMeasurement);

        if (!isViewerQuizMeasurementCaptureMode()) {
          panelService?.activatePanel?.(arMeasurements.panel, true);
        }

        return true;
      };

      const sweepCompletedViewerMeasurements = async (source = 'measurement-service') => {
        if (!completionAwareMeasurementWorkflow || measurementToolsReadOnly || _suppressLabelPrompt) {
          return;
        }

        const measurements = measurementService.getMeasurements?.() || [];

        for (const measurement of measurements) {
          const annotationId = getMeasurementAnnotationId(measurement);

          if (!annotationId || _handledCompletedAnnotationIds.has(annotationId)) {
            continue;
          }

          await handleCompletedViewerMeasurement({
            annotationId,
            sourceAnnotation: getMeasurementAnnotationForId(annotationId),
            source,
          });
        }
      };

      const scheduleCompletedViewerMeasurementSweep = (
        source = 'measurement-service'
      ) => {
        if (!completionAwareMeasurementWorkflow || measurementToolsReadOnly || _suppressLabelPrompt) {
          return;
        }

        [0, 75, 200, 500].forEach(delay => {
          const timerId = window.setTimeout(() => {
            _measurementCompletionTimers.delete(timerId);
            void sweepCompletedViewerMeasurements(source);
          }, delay);

          _measurementCompletionTimers.add(timerId);
        });
      };

      _annotationCompletedHandler = async (event: Event) => {
        const eventDetail = (event as CustomEvent)?.detail || {};
        const sourceAnnotation = eventDetail.annotation;
        const annotationId = String(sourceAnnotation?.annotationUID || '').trim();

        const handled = await handleCompletedViewerMeasurement({
          annotationId,
          sourceAnnotation,
          source: 'cornerstone-annotation-completed',
        });

        if (!handled) {
          scheduleCompletedViewerMeasurementSweep('cornerstone-completion-fallback');
        }
      };

      eventTarget.addEventListener(
        CornerstoneToolsEnums.Events.ANNOTATION_COMPLETED,
        _annotationCompletedHandler
      );

      const measurementEvents = measurementService.EVENTS || {};

      _measurementAddedSub = measurementEvents.MEASUREMENT_ADDED
        ? measurementService.subscribe(measurementEvents.MEASUREMENT_ADDED, async event => {
            const measurement = event?.measurement || event;

            if (!measurement) {
              return;
            }

            if (completionAwareMeasurementWorkflow) {
              scheduleCompletedViewerMeasurementSweep(
                `measurement-service:${measurementEvents.MEASUREMENT_ADDED}`
              );
              return;
            }

            dispatchViewerQuizMeasurementAdded(measurement);

            if (measurementToolsReadOnly || _suppressLabelPrompt || measurement?.label) {
              return;
            }

            const measurementId = getMeasurementAnnotationId(measurement);
            if (!measurementId) {
              return;
            }

            const labelOptions = await getLabelConfigForMeasurement(
              measurement,
              commandsManager,
              {
                quizMeasurementDomain: _quizMeasurementDomain,
              }
            );
            if (!labelOptions) {
              return;
            }

            try {
              console.info('[AR Measurements] label prompt config', {
                toolName: measurement?.toolName,
                title: labelOptions.title,
                placeholder: labelOptions.placeholder,
                labelConfigId: labelOptions.labelConfigOverride?.id,
                commandName: labelOptions.commandName,
              });

              if (labelOptions.commandName) {
                await commandsManager.runCommand(labelOptions.commandName, {
                  uid: measurementId,
                });
              } else {
                await commandsManager.runCommand('setMeasurementLabel', {
                  uid: measurementId,
                  ...labelOptions,
                });
              }

              if (!isViewerQuizMeasurementCaptureMode()) {
                panelService?.activatePanel?.(arMeasurements.panel, true);
              }
            } catch (error) {
              console.warn('[AR Measurements] label prompt failed:', error);
            }
          })
        : null;

      _measurementCompletionSubscriptions = [
        measurementEvents.MEASUREMENT_UPDATED,
        measurementEvents.RAW_MEASUREMENT_ADDED,
      ]
        .filter(Boolean)
        .map(eventName =>
          measurementService.subscribe(eventName, () => {
            scheduleCompletedViewerMeasurementSweep(`measurement-service:${eventName}`);
          })
        );

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager);

      toolbarService.register(toolbarButtons);

      const registeredToolbarButtonIds = getRegisteredToolbarButtonIds(toolbarButtons);
      const safeToolbarIds = (buttonIds, sectionName) =>
        filterRegisteredToolbarButtonIds(
          buttonIds,
          registeredToolbarButtonIds,
          sectionName
        );

      if (measurementToolsReadOnly) {
        // Review-only sessions use a deliberately flat toolbar. This prevents
        // ToolbarService from evaluating nested controls that are not registered
        // in this build, while preserving essential navigation controls.
        toolbarService.updateSection(
          toolbarService.sections.primary,
          safeToolbarIds(
            ['Zoom', 'Pan', 'WindowLevel', 'Cine', 'Previous', 'Next'],
            'primary-read-only'
          )
        );

        toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topLeft, []);
        toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomMiddle, []);
        toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topRight, []);
        toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomLeft, []);
      } else {
        toolbarService.updateSection(
          toolbarService.sections.primary,
          safeToolbarIds(
            [
              'MeasurementTools',
              'ArrowAnnotate',
              'Zoom',
              'Pan',
              'TrackballRotate',
              'WindowLevel',
              'Capture',
              'Layout',
              'Cine',
              'Previous',
              'Next',
              'Crosshairs',
              'MoreTools',
            ],
            'primary-editable'
          )
        );

        toolbarService.updateSection(
          toolbarService.sections.viewportActionMenu.topLeft,
          safeToolbarIds(['orientationMenu', 'dataOverlayMenu'], 'viewport-top-left')
        );

        toolbarService.updateSection(
          toolbarService.sections.viewportActionMenu.bottomMiddle,
          safeToolbarIds(['AdvancedRenderingControls'], 'viewport-bottom-middle')
        );

        if (registeredToolbarButtonIds.has('AdvancedRenderingControls')) {
          toolbarService.updateSection(
            'AdvancedRenderingControls',
            safeToolbarIds(
              [
                'windowLevelMenuEmbedded',
                'voiManualControlMenu',
                'Colorbar',
                'opacityMenu',
                'thresholdMenu',
              ],
              'AdvancedRenderingControls'
            )
          );
        }

        toolbarService.updateSection(
          toolbarService.sections.viewportActionMenu.topRight,
          safeToolbarIds(['modalityLoadBadge', 'navigationComponent'], 'viewport-top-right')
        );

        toolbarService.updateSection(
          toolbarService.sections.viewportActionMenu.bottomLeft,
          safeToolbarIds(['windowLevelMenu'], 'viewport-bottom-left')
        );

        const initialMeasurementDomain = getViewerMeasurementDomainFromPath();

        if (registeredToolbarButtonIds.has('MeasurementTools')) {
          toolbarService.updateSection(
            'MeasurementTools',
            safeToolbarIds(
              getMeasurementToolIdsForDomain(initialMeasurementDomain),
              'MeasurementTools-initial'
            )
          );

          Promise.resolve(resolveViewerMeasurementDomain(commandsManager))
            .then(resolvedDomain => {
              toolbarService.updateSection(
                'MeasurementTools',
                safeToolbarIds(
                  getMeasurementToolIdsForDomain(
                    resolvedDomain || initialMeasurementDomain
                  ),
                  'MeasurementTools-resolved'
                )
              );
            })
            .catch(error => {
              console.warn('[AR Measurements] could not refresh measurement tools:', error);
            });
        }

        if (registeredToolbarButtonIds.has('MoreTools')) {
          toolbarService.updateSection(
            'MoreTools',
            safeToolbarIds(
              [
                'Reset',
                'rotate-right',
                'flipHorizontal',
                'ImageSliceSync',
                'ReferenceLines',
                'ImageOverlayViewer',
                'StackScroll',
                'invert',
                'Probe',
                'Cine',
                'Angle',
                'CobbAngle',
                'Magnify',
                'CalibrationLine',
                'TagBrowser',
                'AdvancedMagnify',
                'UltrasoundDirectionalTool',
                'WindowLevelRegion',
                'SegmentLabelTool',
              ],
              'MoreTools'
            )
          );
        }
      }

      customizationService.setCustomizations(
        {
          'panelSegmentation.disableEditing': {
            $set: true,
          },
        },
        customizationService.Scope.Mode
      );

      _suppressLabelPrompt = true;

      Promise.resolve(
        commandsManager.runCommand('hydrateMeasurementAnnotationsForActiveStudy', {
          workflows: ['viewerMeasurements'],
          domains: ['echo', 'bowel', 'generic'],
          notify: false,
        })
      )
        .catch(error => {
          console.warn('[MeasurementAnnotations] longitudinal hydration failed:', error);
        })
        .finally(() => {
          _suppressLabelPrompt = false;
        });

      // Keep cine controls enabled for manual playback. The shared CinePlayer
      // suppresses automatic startup on learning routes.
      cineService.setIsCineEnabled(true);

      const initialPanelId = getLearningInitialPanelId();

      if (initialPanelId) {
        window.setTimeout(() => {
          try {
            panelService?.activatePanel?.(initialPanelId, true);
          } catch (error) {
            console.warn('[AR Learning] initial panel activation failed:', error);
          }
        }, 0);
      }

      // // ActivatePanel event trigger for when a segmentation or measurement is added.
      // // Do not force activation so as to respect the state the user may have left the UI in.
      // _activatePanelTriggersSubscriptions = [
      //   ...panelService.addActivatePanelTriggers(
      //     cornerstone.segmentation,
      //     [
      //       {
      //         sourcePubSubService: segmentationService,
      //         sourceEvents: [segmentationService.EVENTS.SEGMENTATION_ADDED],
      //       },
      //     ],
      //     true
      //   ),
      //   ...panelService.addActivatePanelTriggers(
      //     tracked.measurements,
      //     [
      //       {
      //         sourcePubSubService: measurementService,
      //         sourceEvents: [
      //           measurementService.EVENTS.MEASUREMENT_ADDED,
      //           measurementService.EVENTS.RAW_MEASUREMENT_ADDED,
      //         ],
      //       },
      //     ],
      //     true
      //   ),
      //   true,
      // ];
    },
    onModeExit: ({ servicesManager }: withAppTypes) => {
      const {
        toolGroupService,
        syncGroupService,
        segmentationService,
        cornerstoneViewportService,
        customizationService,
        uiDialogService,
        uiModalService,
      } = servicesManager.services;

      _activatePanelTriggersSubscriptions.forEach(sub => sub.unsubscribe());
      _activatePanelTriggersSubscriptions = [];

      _measurementAddedSub?.unsubscribe?.();
      _measurementAddedSub = null;

      _measurementCompletionSubscriptions.forEach(subscription =>
        subscription?.unsubscribe?.()
      );
      _measurementCompletionSubscriptions = [];

      _measurementCompletionTimers.forEach(timerId => window.clearTimeout(timerId));
      _measurementCompletionTimers.clear();

      if (_annotationCompletedHandler) {
        eventTarget.removeEventListener(
          CornerstoneToolsEnums.Events.ANNOTATION_COMPLETED,
          _annotationCompletedHandler
        );
        _annotationCompletedHandler = null;
      }

      _handledCompletedAnnotationIds.clear();
      _suppressLabelPrompt = false;

      if (_quizMeasurementDomainHandler) {
        window.removeEventListener(
          AR_QUIZ_MEASUREMENT_DOMAIN_EVENT,
          _quizMeasurementDomainHandler
        );
        _quizMeasurementDomainHandler = null;
      }
      _quizMeasurementDomain = '';

      restoreConsoleWarn?.();
      removeARUSRegionPixelSpacingProvider?.();
      customizationService.onModeExit();

      uiDialogService.hideAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
    },
    validationTags: {
      study: [],
      series: [],
    },

    isValidMode: function ({ modalities }) {
      const modalities_list = modalities.split('\\');

      // Exclude non-image modalities
      return {
        valid: !!modalities_list.filter(modality => NON_IMAGE_MODALITIES.indexOf(modality) === -1)
          .length,
        description:
          'The mode does not support studies that ONLY include the following modalities: SM, ECG, SEG, RTSTRUCT',
      };
    },
    routes: [
      {
        path: 'learning',
        /*init: ({ servicesManager, extensionManager }) => {
          //defaultViewerRouteInit
        },*/
        layoutTemplate: () => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.thumbnailList],
              leftPanelResizable: true,
              // Quiz taking and quiz authoring intentionally expose only Case Questions.
              // Non-quiz learning workflows retain the AR Measurements tab.
              rightPanels: getLearningRightPanels(),
              rightPanelClosed: !shouldOpenLearningRightPanelByDefault(),
              rightPanelResizable: true,
              viewports: [
                {
                  namespace: '@ohif/extension-cornerstone.viewportModule.cornerstone',
                  displaySetsToDisplay: [
                    ohif.sopClassHandler,
                    dicomvideo.sopClassHandler,
                    ohif.wsiSopClassHandler,
                  ],
                },
                {
                  namespace: dicomsr.viewport,
                  displaySetsToDisplay: [dicomsr.sopClassHandler, dicomsr.sopClassHandler3D],
                },
                {
                  namespace: dicompdf.viewport,
                  displaySetsToDisplay: [dicompdf.sopClassHandler],
                },
                {
                  namespace: dicomSeg.viewport,
                  displaySetsToDisplay: [dicomSeg.sopClassHandler],
                },
                {
                  namespace: dicomPmap.viewport,
                  displaySetsToDisplay: [dicomPmap.sopClassHandler],
                },
                {
                  namespace: dicomRT.viewport,
                  displaySetsToDisplay: [dicomRT.sopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],
    extensions: extensionDependencies,
    // Default protocol gets self-registered by default in the init
    hangingProtocol: 'default',
    // Order is important in sop class handlers when two handlers both use
    // the same sop class under different situations.  In that case, the more
    // general handler needs to come last.  For this case, the dicomvideo must
    // come first to remove video transfer syntax before ohif uses images
    sopClassHandlers: [
      dicomvideo.sopClassHandler,
      dicomSeg.sopClassHandler,
      dicomPmap.sopClassHandler,
      ohif.sopClassHandler,
      ohif.wsiSopClassHandler,
      dicompdf.sopClassHandler,
      dicomsr.sopClassHandler3D,
      dicomsr.sopClassHandler,
      dicomRT.sopClassHandler,
    ],
    ...modeConfiguration,
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
export { initToolGroups, toolbarButtons };
