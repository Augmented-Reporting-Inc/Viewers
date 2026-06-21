import i18n from 'i18next';
import { id } from './id';
import initToolGroups from './initToolGroups';
import toolbarButtons from './toolbarButtons';
import { LV_TRACE_MEASUREMENT_LABELS_CONFIG } from './utils/lvTraceLabels';

const ECHO_LENGTH_MEASUREMENT_LABELS_CONFIG = {
  id: 'echoLengthMeasurementLabels',
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

  return 'generic';
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

  if (toolName === 'SplineROI') {
    return {
      title: 'Set LV Slot',
      placeholder: 'Choose LV A4C/A2C ED/ES slot',
      labelConfigOverride: LV_TRACE_MEASUREMENT_LABELS_CONFIG,
    };
  }

  if (toolName !== 'Length') {
    return null;
  }

  const domain = await resolveViewerMeasurementDomain(commandsManager);

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

  return {
    // TODO: We're using this as a route segment
    // We should not be.
    id,
    routeName: 'viewer',
    displayName: i18n.t('Modes:Basic Viewer'),
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

      const {
        measurementService,
        toolbarService,
        toolGroupService,
        customizationService,
        cineService,
        panelService,
      } = servicesManager.services;

      measurementService.clearMeasurements();

      _measurementAddedSub?.unsubscribe?.();
      _measurementAddedSub = null;

      _measurementAddedSub = measurementService.subscribe(
        measurementService.EVENTS.MEASUREMENT_ADDED,
        async ({ measurement }) => {
          if (_suppressLabelPrompt) {
            return;
          }

          if (!measurement?.uid || measurement?.label) {
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
            });

            await commandsManager.runCommand('setMeasurementLabel', {
              uid: measurement.uid,
              ...labelOptions,
            });

            panelService?.activatePanel?.(
              'extension-ar-measurements.panelModule.arMeasurements',
              true
            );
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

      toolbarService.updateSection('MeasurementTools', [
        'Length',
        'Bidirectional',
        'ArrowAnnotate',
        'EllipticalROI',
        'RectangleROI',
        'CircleROI',
        'LVTrace',
        'LVTraceSlot',
        'SaveLVTraces',
        'PlanarFreehandROI',
        'SplineROI',
        'LivewireContour',
      ]);

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
          measurementLabels: {
            $set: LV_TRACE_MEASUREMENT_LABELS_CONFIG,
          },
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
        path: 'longitudinal',
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
              rightPanels: [arMeasurements.panel, cornerstone.segmentation],
              rightPanelClosed: true,
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
