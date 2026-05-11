/**
 * Toolbar module for extension-iuscan.
 *
 * Registers:
 *   1. Two custom toolbar button definitions (Export + Clear)
 *   2. Custom evaluator: evaluate.iuscan.hasAssignments
 *      — disables Export/Clear until ≥1 slot is filled
 *
 * Standard tools (Length, WindowLevel, Pan, Zoom, Cine) are already
 * registered by @ohif/extension-cornerstone and @ohif/extension-default.
 * We just reference them by name in mode-iuscan's updateSection() calls.
 */
export default function getToolbarModule({ servicesManager }) {
  return [
    // ── Button definitions ────────────────────────────────────────────────────

    {
      name: 'iuscan.exportReport',
      uiType: 'ohif.radioGroup',
      props: {
        icon: 'icon-transfer-station-export',
        label: 'Save to Report',
        tooltip: 'Save intestinal ultrasound measurements to report (Ctrl+Shift+S)',
        commands: 'exportIUScanReport',
        evaluate: 'evaluate.iuscan.hasAssignments',
      },
    },

    {
      name: 'iuscan.clearMeasurements',
      uiType: 'ohif.radioGroup',
      props: {
        icon: 'icon-clear',
        label: 'Clear Measurements',
        tooltip: 'Clear all intestinal ultrasound measurements (Ctrl+Shift+X)',
        commands: 'clearIUScanMeasurements',
        evaluate: 'evaluate.iuscan.hasAssignments',
      },
    },

    // ── Custom evaluator ──────────────────────────────────────────────────────

    {
      name: 'evaluate.iuscan.hasAssignments',
      evaluate: () => {
        const assignSvc = servicesManager.services.iuscanAssignmentService;
        const hasAny = assignSvc?.hasAnyAssignment() ?? false;
        return {
          disabled: !hasAny,
          className: hasAny ? '!text-black bg-primary-light' : '!text-common-bright ohif-disabled',
        };
      },
    },
  ];
}
