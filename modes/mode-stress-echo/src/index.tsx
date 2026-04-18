import { hotkeys } from '@ohif/core';
import React from 'react';
import { id } from './id';
import { SyncControls } from '../../../extensions/extension-stress-echo/src/components/SyncControls';
import toolbarButtons from './toolbarButtons';
import initToolGroups from './initToolGroups.js';

const NON_IMAGE_MODALITIES = ['SM', 'ECG', 'SR', 'SEG', 'RTSTRUCT'];

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  //  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  //  hangingProtocols: '@ohif/extension-default.hangingProtocolModule.default',
  leftPanel: '@ohif/extension-default.panelModule.seriesList',
  measurements: '@ohif/extension-default.panelModule.measurements',
};

const stressecho = {
  rightPanel: 'extension-stress-echo.panelModule.filterStageView',
  sopClassHandler: 'extension-stress-echo.sopClassHandlerModule.stressecho',
  hangingProtocol: 'extension-stress-echo.hangingProtocolModule.hpRest',
};

const cornerstone = {
  viewport: '@ohif/extension-cornerstone.viewportModule.cornerstone',
};

/**
 * Just two dependencies to be able to render a viewport with panels in order
 * to make sure that the mode is working.
 */
const extensionDependencies = {
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  'extension-stress-echo': '3.11.0',
};

function modeFactory({ modeConfiguration }) {
  return {
    /**
     * Mode ID, which should be unique among modes used by the viewer. This ID
     * is used to identify the mode in the viewer's state.
     */
    id,
    routeName: 'stressecho',
    /**
     * Mode name, which is displayed in the viewer's UI in the workList, for the
     * user to select the mode.
     */
    displayName: 'Stress Echo',
    /**
     * Runs when the Mode Route is mounted to the DOM. Usually used to initialize
     * Services and other resources.
     */
    onModeEnter: function ({ servicesManager, extensionManager, commandsManager }: withAppTypes) {
      const { measurementService, toolbarService, toolGroupService, customizationService } =
        servicesManager.services;

      measurementService.clearMeasurements();

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager);

      /* removed for 3.7 to 3.8 migration https://docs.ohif.org/migration-guide/from-3p7-to-3p8
      let unsubscribe;

      const activateTool = () => {
        toolbarService.recordInteraction({
          groupId: 'WindowLevel',
          interactionType: 'tool',
          commands: [
            {
              commandName: 'setToolActive',
              commandOptions: {
                toolName: 'WindowLevel',
              },
              context: 'CORNERSTONE',
            },
          ],
        });

        // We don't need to reset the active tool whenever a viewport is getting
        // added to the toolGroup.
        unsubscribe();
      };

      // Since we only have one viewport for the basic cs3d mode and it has
      // only one hanging protocol, we can just use the first viewport
      ({ unsubscribe } = toolGroupService.subscribe(
        toolGroupService.EVENTS.VIEWPORT_ADDED,
        activateTool
      ));
      */

      toolbarService.register(toolbarButtons);
      toolbarService.updateSection(toolbarService.sections.primary, [
        'MeasurementTools',
        'Zoom',
        'WindowLevel',
        'Pan',
        'Capture',
        'Layout',
        'Previous',
        'Next',
        'Crosshairs',
        'MoreTools',
      ]);
      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topLeft, [
        'orientationMenu',
        'dataOverlayMenu',
        {
          id: 'cardiacSyncControls',
          Component: ({ servicesManager: sm }) =>
            React.createElement(SyncControls, {
              servicesManager: sm ?? servicesManager,
            }),
        },
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
        'trackingStatus',
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
        'Angle',
        'CobbAngle',
        'Magnify',
        'CalibrationLine',
        'TagBrowser',
        'AdvancedMagnify',
        'UltrasoundDirectionalTool',
        'WindowLevelRegion',
      ]);

      customizationService.setCustomizations({
        'panelSegmentation.disableEditing': {
          $set: true,
        },
        // Hide the auto-play cine bar for stress echo — sync service drives playback instead
        'cinePlayer.enabled': {
          $set: false,
        },
      });

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
        uiDialogService,
        uiModalService,
        cardiacSyncService,
      } = servicesManager.services;

      uiDialogService.hideAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
      cardiacSyncService?.onModeExit();
    },
    validationTags: {
      study: [],
      series: [],
    },
    /**
     * A boolean return value that indicates whether the mode is valid for the
     * modalities of the selected studies. For instance a PET/CT mode should be
     */
    isValidMode: ({ modalities, study }) => {
      const modalities_list = modalities.split('\\');

      // Exclude non-image modalities
      // return !!modalities_list.filter(modality => NON_IMAGE_MODALITIES.indexOf(modality) === -1)
      //  .length;
      const description = study.description;

      const isValid =
        (modalities_list.includes('US') && description.match(/stress/i)) ||
        description.match(/dobutamine/i);

      return {
        valid: isValid,
        description: description,
      };
    },

    /**
     * Mode Routes are used to define the mode's behavior. A list of Mode Route
     * that includes the mode's path and the layout to be used. The layout will
     * include the components that are used in the layout. For instance, if the
     * default layoutTemplate is used (id: '@ohif/extension-default.layoutTemplateModule.viewerLayout')
     * it will include the leftPanels, rightPanels, and viewports. However, if
     * you define another layoutTemplate that includes a Footer for instance,
     * you should provide the Footer component here too. Note: We use Strings
     * to reference the component's ID as they are registered in the internal
     * ExtensionManager. The template for the string is:
     * `${extensionId}.{moduleType}.${componentId}`.
     */
    routes: [
      {
        path: 'mode-stress-echo',
        layoutTemplate: ({ location, servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.leftPanel],
              leftPanelClosed: true,
              rightPanels: [stressecho.rightPanel],
              viewports: [
                {
                  namespace: cornerstone.viewport,
                  displaySetsToDisplay: [stressecho.sopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],
    /** List of extensions that are used by the mode */
    extensions: extensionDependencies,
    /** HangingProtocol used by the mode */
    //    hangingProtocol: 'default',
    //    hangingProtocol: [stressecho.hangingProtocols],
    hangingProtocol: [stressecho.hangingProtocol],

    /** SopClassHandlers used by the mode */
    sopClassHandlers: [stressecho.sopClassHandler],
    /** hotkeys for mode */
    hotkeys: [...hotkeys.defaults.hotkeyBindings],
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
