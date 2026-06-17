/**
 * mode-iuscan/src/index.js
 *
 * GI Ultrasound (iUSCAN) viewer mode.
 *
 * Key design decisions (relative to mode-longitudinal scaffold):
 *   - US-only isValidMode guard
 *   - US Region warning suppressed (once) — identical pattern to longitudinal
 *   - cineService.setIsCineEnabled(true) on enter — auto-plays multi-frame clips
 *   - Custom SOP class handler (from extension-iuscan) — one display set per instance
 *   - Custom HP (hpIUScan) — 1×1 grid, accepts any US study
 *   - Right panel auto-opens on first caliper via PanelService trigger
 *   - rightPanelClosed: true initially — clean UI before first caliper
 *   - toolbarService.updateSection with string keys (sections object undefined in this build)
 *   - console.warn restored on exit (improvement over longitudinal)
 */
import { hotkeys } from '@ohif/core';
import { toolbarButtons } from '@ohif/mode-longitudinal';
import { eventTarget } from '@cornerstonejs/core';
import { Enums as csToolsEnums } from '@cornerstonejs/tools';
import { id } from './id';
import initToolGroups from './initToolGroups';

const NON_IMAGE_MODALITIES = ['ECG', 'SEG', 'RTSTRUCT', 'RTPLAN', 'PR', 'SR'];

const extensionDependencies = {
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  'extension-iuscan': '^1.0.0',
};

function modeFactory({ modeConfiguration }) {
  // Closure-scoped vars — survive between onModeEnter and onModeExit
  let _activatePanelTriggersSubscriptions = [];
  let _origWarn = null;
  let _annotationCompletedHandler = null;

  return {
    id,
    routeName: 'iuscan',
    displayName: 'Intestinal Ultrasound',

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onModeEnter: ({ servicesManager, extensionManager, commandsManager }: withAppTypes) => {
      // ── Suppress repeated per-frame US Sequence of Regions warnings ─────
      // Same pattern as mode-longitudinal. We additionally restore on exit,
      // which longitudinal does not do.
      _origWarn = console.warn.bind(console);
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

      const { measurementService, toolbarService, toolGroupService, panelService, cineService } =
        servicesManager.services;

      // ── Reset measurement state ──────────────────────────────────────────
      measurementService.clearMeasurements();

      // ── Tool groups ──────────────────────────────────────────────────────
      initToolGroups(extensionManager, toolGroupService, commandsManager);

      // Register longitudinal toolbar buttons, excluding segmentation-only buttons
      // that reference evaluate.cornerstone.hasSegmentation (not available in this mode)
      const filteredButtons = toolbarButtons.filter(
        btn =>
          !JSON.stringify(btn).includes('hasSegmentation') &&
          !JSON.stringify(btn).includes('hasSegmentations')
      );
      const iuscanButtons = filteredButtons.map(btn => {
        const btnStr = JSON.stringify(btn);
        if (!btnStr.includes('setToolActiveToolbar')) {
          return btn;
        }
        return JSON.parse(
          btnStr.replace(
            /"toolGroupIds":\["default","mpr","SRToolGroup","volume3d"\]/g,
            '"toolGroupIds":["iuscan-tool-group"]'
          )
        );
      });
      toolbarService.register(iuscanButtons);

      // ── Toolbar ──────────────────────────────────────────────────────────
      // Register any mode-level button definitions (currently empty — all
      // buttons come from extension-iuscan and @ohif/extension-cornerstone)
      toolbarService.updateSection(toolbarService.sections.primary, [
        'Length', // core caliper — left-click to draw
        'WindowLevel', // W/L adjustment
        'Pan',
        'Zoom',
        'Cine',
        'Reset',
        'Previous',
        'Next',
        'iuscan.exportReport', // custom: save measurements to report
        'iuscan.clearMeasurements', // custom: clear all
      ]);

      // Viewport action menu overlays
      // topLeft: DICOM tag overlay (useful for verifying series/instance info)
      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topLeft, [
        'dataOverlayMenu',
      ]);
      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topRight, [
        'navigationComponent',
      ]);

      // ── Cine: enable auto-play so clips play when their display set loads ─
      cineService.setIsCineEnabled(true);

      // Fire label picker after each caliper is completed
      _annotationCompletedHandler = evt => {
        const uid = evt.detail?.annotation?.annotationUID;
        if (!uid) {
          return;
        }
        setTimeout(() => {
          commandsManager.runCommand('setMeasurementLabel', { uid });
        }, 0);
      };
      eventTarget.addEventListener(
        csToolsEnums.Events.ANNOTATION_COMPLETED,
        _annotationCompletedHandler
      );

      // ── Auto-open right panel when first caliper is placed ───────────────
      // Panel starts closed (rightPanelClosed: true in layoutTemplate).
      // PanelService opens it automatically on MEASUREMENT_ADDED.
      _activatePanelTriggersSubscriptions = [
        ...panelService.addActivatePanelTriggers(
          'extension-iuscan.panelModule.iuscanMeasurements',
          [
            {
              sourcePubSubService: measurementService,
              sourceEvents: [
                measurementService.EVENTS.MEASUREMENT_ADDED,
                measurementService.EVENTS.RAW_MEASUREMENT_ADDED,
                measurementService.EVENTS.MEASUREMENT_UPDATED,
              ],
            },
          ]
        ),
      ];
      console.log(
        '[iUSCAN] panel triggers registered:',
        _activatePanelTriggersSubscriptions.length
      );
    },

    onModeExit: ({ servicesManager }) => {
      const {
        toolGroupService,
        cornerstoneViewportService,
        uiDialogService,
        uiModalService,
        cineService,
        customizationService,
      } = servicesManager.services;

      // ── Restore console.warn (longitudinal doesn't do this — we improve) ─
      if (_origWarn) {
        console.warn = _origWarn;
        _origWarn = null;
      }

      // ── Stop cine playback ───────────────────────────────────────────────
      cineService.setIsCineEnabled(false);

      // ── Unsubscribe panel auto-open triggers ─────────────────────────────
      _activatePanelTriggersSubscriptions.forEach(sub => sub.unsubscribe());
      _activatePanelTriggersSubscriptions = [];

      // ── Dismiss any open dialogs/modals ──────────────────────────────────
      uiDialogService.hideAll();
      uiModalService.hide();

      if (_annotationCompletedHandler) {
        eventTarget.removeEventListener(
          csToolsEnums.Events.ANNOTATION_COMPLETED,
          _annotationCompletedHandler
        );
        _annotationCompletedHandler = null;
      }

      // ── Destroy Cornerstone state ────────────────────────────────────────
      toolGroupService.destroy();
      cornerstoneViewportService.destroy();

      // ── Remove mode-specific customizations ──────────────────────────────
      // customizationService.reset() is also called in extension-iuscan
      // onModeExit (which runs first). Calling it again here is safe
      // (idempotent) and ensures cleanup even if the extension hook failed.
      customizationService.onModeExit();
    },

    // ── Validity ──────────────────────────────────────────────────────────────

    isValidMode: ({ modalities }) => {
      const list = modalities.split('\\');
      const hasUS = list.includes('US');
      const onlyNonImaging = list.every(m => NON_IMAGE_MODALITIES.includes(m));
      return {
        valid: hasUS && !onlyNonImaging,
        description: 'Intestinal Ultrasound mode requires a US study.',
      };
    },

    // ── Routes ────────────────────────────────────────────────────────────────

    routes: [
      {
        path: 'iuscan',
        layoutTemplate: ({ location, servicesManager }) => ({
          id: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
          props: {
            // Left: standard series thumbnail list
            leftPanels: ['@ohif/extension-default.panelModule.seriesList'],
            leftPanelResizable: true,

            // Right: intestinal ultrasound measurement + observation panel
            rightPanels: ['extension-iuscan.panelModule.iuscanMeasurements'],
            // Starts closed — PanelService auto-opens on first MEASUREMENT_ADDED
            rightPanelClosed: false,
            rightPanelResizable: true,

            viewports: [
              {
                // Standard Cornerstone viewport handles US stills and clips
                namespace: '@ohif/extension-cornerstone.viewportModule.cornerstone',
                displaySetsToDisplay: [
                  // Use extension-iuscan's handler (instance-per-display-set, InstanceNumber sort)
                  //     'extension-iuscan.sopClassHandlerModule.stack',
                  //     'extension-iuscan.sopClassHandlerModule.not-supported-display-sets-handler',
                  '@ohif/extension-default.sopClassHandlerModule.stack',
                ],
              },
            ],
          },
        }),
      },
    ],

    // ── Dependencies ──────────────────────────────────────────────────────────

    extensions: extensionDependencies,

    // ── Hanging protocol ──────────────────────────────────────────────────────
    // Single named protocol — no scoring competition.
    // Accepts any US study, 1×1 grid layout.
    hangingProtocol: 'hpIUScan',

    // ── SOP class handlers (order: more specific first) ───────────────────────
    sopClassHandlers: [
      //      'extension-iuscan.sopClassHandlerModule.stack',
      //      'extension-iuscan.sopClassHandlerModule.not-supported-display-sets-handler',
      '@ohif/extension-default.sopClassHandlerModule.stack',
    ],

    // ── Hotkeys ───────────────────────────────────────────────────────────────
    hotkeys: {
      name: 'iuscan-hotkeys',
      hotkeys: [
        {
          commandName: 'exportIUScanReport',
          label: 'Export Intestinal Ultrasound Report',
          keys: ['ctrl+shift+s'],
          isEditable: true,
        },
        {
          commandName: 'clearIUScanMeasurements',
          label: 'Clear Intestinal Ultrasound Measurements',
          keys: ['ctrl+shift+x'],
          isEditable: true,
        },
        // Include standard OHIF navigation hotkeys
        ...hotkeys.defaults.hotkeyBindings,
      ],
    },

    ...modeConfiguration,
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
