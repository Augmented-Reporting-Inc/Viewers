export default function initToolGroups(extensionManager, toolGroupService, commandsManager) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );
  const { toolNames, Enums } = utilityModule.exports;

  const tools = {
    active: [
      {
        toolName: toolNames.Length,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: toolNames.StackScroll,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],
      },
    ],
    passive: [
      { toolName: toolNames.WindowLevel },
      { toolName: toolNames.Bidirectional },
      {
        toolName: toolNames.ArrowAnnotate,
        configuration: {
          getTextCallback: (callback, eventDetails) =>
            commandsManager.runCommand('arrowTextCallback', { callback, eventDetails }),
          changeTextCallback: (data, eventDetails, callback) =>
            commandsManager.runCommand('arrowTextCallback', { callback, data, eventDetails }),
        },
      },
      { toolName: toolNames.EllipticalROI },
      { toolName: toolNames.CircleROI },
      { toolName: toolNames.RectangleROI },
      { toolName: toolNames.Probe },
      { toolName: toolNames.DragProbe },
      { toolName: toolNames.Angle },
      { toolName: toolNames.CobbAngle },
      { toolName: toolNames.Magnify },
      { toolName: toolNames.UltrasoundDirectional },
      { toolName: toolNames.PlanarFreehandROI },
      { toolName: toolNames.SplineROI },
      { toolName: toolNames.CalibrationLine },
      { toolName: toolNames.WindowLevelRegion },
    ],
    enabled: [{ toolName: toolNames.ImageOverlayViewer }, { toolName: toolNames.ReferenceLines }],
    disabled: [{ toolName: toolNames.AdvancedMagnify }],
  };

  toolGroupService.createToolGroupAndAddTools('iuscan-tool-group', tools);
}
