import { hotkeys } from '@ohif/core';
import React from 'react';
import { id } from './id';
import { SyncControls } from '../../../extensions/extension-dobutamine/src/components/SyncControls';
import toolbarButtons from './toolbarButtons';
import initToolGroups from './initToolGroups.js';

const NON_IMAGE_MODALITIES = ['SM', 'ECG', 'SR', 'SEG', 'RTSTRUCT'];

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  leftPanel: '@ohif/extension-default.panelModule.seriesList',
  measurements: '@ohif/extension-default.panelModule.measurements',
};

const dobutamine = {
  rightPanel: 'extension-dobutamine.panelModule.filterStageView',
  sopClassHandler: 'extension-dobutamine.sopClassHandlerModule.dobutamine',
  hangingProtocol: 'extension-dobutamine.hangingProtocolModule.hpDobutamineResting',
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
  'extension-dobutamine': '3.11.0',
};

function modeFactory({ modeConfiguration }) {
  return {
    /**
     * Mode ID, which should be unique among modes used by the viewer. This ID
     * is used to identify the mode in the viewer's state.
     */
    id,
    routeName: 'dobutamine',
    /**
     * Mode name, which is displayed in the viewer's UI in the workList, for the
     * user to select the mode.
     */
    displayName: 'Dobutamine',
    /**
     * Runs when the Mode Route is mounted to the DOM. Usually used to initialize
     * Services and other resources.
     */
    onModeEnter: function ({ servicesManager, extensionManager, commandsManager }: withAppTypes) {
      const {
        measurementService,
        toolbarService,
        toolGroupService,
        customizationService,
        cineService,
      } = servicesManager.services;

      measurementService.clearMeasurements();

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager);

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
      });

      // Disable autoPlayCine so WrappedCinePlayer doesn't re-enable isCineEnabled.
      cineService.setIsCineEnabled(false);
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
    /** */
    validationTags: {
      study: [],
      series: [],
    },
    /**
     * A boolean return value that indicates whether the mode is valid for the
     * modalities of the selected studies. For instance a PET/CT mode should be
     */
    isValidMode: ({ modalities, study }) => {
      const description = study?.description || study?.StudyDescription || '';

      // TEMP while developing the new mode.
      // Restore the stricter dobutamine check after the extension registers cleanly.
      return {
        valid: true,
        description,
      };
    } /**
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
     */,
    routes: [
      {
        path: 'mode-dobutamine',
        layoutTemplate: ({ location, servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.leftPanel],
              leftPanelClosed: true,
              rightPanels: [dobutamine.rightPanel],
              viewports: [
                {
                  namespace: cornerstone.viewport,
                  displaySetsToDisplay: [dobutamine.sopClassHandler],
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
    hangingProtocol: [dobutamine.hangingProtocol],
    /** SopClassHandlers used by the mode */
    sopClassHandlers: [dobutamine.sopClassHandler],
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
