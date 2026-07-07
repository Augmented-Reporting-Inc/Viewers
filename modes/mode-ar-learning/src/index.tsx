import i18n from 'i18next';
import { metaData } from '@cornerstonejs/core';
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
    return 'iuscan';
  }

  if (path.includes('/bviewer')) {
    return 'bowel';
  }

  if (path.includes('/rviewer') || path.includes('/stressecho') || path.includes('/dobutamine')) {
    return 'echo';
  }

  // This is the longitudinal mode. If it is not explicitly a bowel/iUSCAN route,
  // treat it as echo so echo-only tools such as LV Trace are available even when
  // the dev/local route basename is '/'.
  return 'echo';
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

function isViewerQuizMeasurementCaptureMode() {
  const captureMode = getLearningUrlParam('arQuizMeasurementCapture');
  const scoringMode = getLearningUrlParam('arEducationScoringMode');
  const initialPanel = getLearningUrlParam('arInitialPanel');

  return (
    ['selected', 'manual', 'quiz'].includes(captureMode) ||
    (['viewerquiz', 'viewer-quiz'].includes(scoringMode) &&
      ['casequestions', 'questions', 'quiz', 'viewerquiz'].includes(
        initialPanel.replace(/[_\s-]+/g, '')
      ))
  );
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
  'ArrowAnnotate',
  'EllipticalROI',
  'RectangleROI',
  'CircleROI',
];

const ECHO_ONLY_MEASUREMENT_TOOL_IDS = ['LVTrace', 'LVTraceSlot'];

const GENERIC_CONTOUR_TOOL_IDS = ['PlanarFreehandROI', 'SplineROI', 'LivewireContour'];

function getMeasurementToolIdsForDomain(domain) {
  return [
    ...BASE_MEASUREMENT_TOOL_IDS,
    ...(domain === 'echo' ? ECHO_ONLY_MEASUREMENT_TOOL_IDS : []),
    ...GENERIC_CONTOUR_TOOL_IDS,
  ];
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

async function getLabelConfigForMeasurement(measurement, commandsManager) {
  const toolName = measurement?.toolName;
  const domain = await resolveViewerMeasurementDomain(commandsManager);

  if (toolName === 'SplineROI') {
    return {
      commandName: 'setLVTraceMeasurementLabel',
    };
  }

  if (toolName !== 'Length') {
    return null;
  }

  if (isViewerQuizMeasurementCaptureMode()) {
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

    return '';
  } catch {
    return '';
  }
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
  let _suppressLabelPrompt = false;
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

      measurementService.clearMeasurements();

      _measurementAddedSub?.unsubscribe?.();
      _measurementAddedSub = null;

      _measurementAddedSub = measurementService.subscribe(
        measurementService.EVENTS.MEASUREMENT_ADDED,
        async ({ measurement }) => {
          if (!measurement?.uid) {
            return;
          }

          dispatchViewerQuizMeasurementAdded(measurement);

          if (_suppressLabelPrompt || measurement?.label) {
            return;
          }

          const labelOptions = await getLabelConfigForMeasurement(measurement, commandsManager);
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
                uid: measurement.uid,
              });
            } else {
              await commandsManager.runCommand('setMeasurementLabel', {
                uid: measurement.uid,
                ...labelOptions,
              });
            }

            if (!isViewerQuizMeasurementCaptureMode()) {
              panelService?.activatePanel?.(
                'extension-ar-measurements.panelModule.arMeasurements',
                true
              );
            }
          } catch (error) {
            console.warn('[AR Measurements] label prompt failed:', error);
          }
        }
      );

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager);

      toolbarService.register(toolbarButtons);
      toolbarService.updateSection(toolbarService.sections.primary, [
        'MeasurementTools',
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
      ]);

      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topLeft, [
        'orientationMenu',
        'dataOverlayMenu',
      ]);

      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomMiddle, [
        'AdvancedRenderingControls',
      ]);

      toolbarService.updateSection('AdvancedRenderingControls', [
        'windowLevelMenuEmbedded',
        'voiManualControlMenu',
        'Colorbar',
        'opacityMenu',
        'thresholdMenu',
      ]);

      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topRight, [
        'modalityLoadBadge',
        'navigationComponent',
      ]);

      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomLeft, [
        'windowLevelMenu',
      ]);

      toolbarService.updateSection(
        'MeasurementTools',
        getMeasurementToolIdsForDomain(getViewerMeasurementDomainFromPath())
      );

      toolbarService.updateSection('MoreTools', [
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
      ]);

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

      // Start with cine enabled so autoPlayCine triggers when display sets load
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
      _suppressLabelPrompt = false;

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
              // Keep AR Measurements first so the right panel defaults to
              // Measurements when opened. Segmentation remains available as tab 2.
              rightPanels: [arLearning.caseQuestions, arMeasurements.panel],
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
