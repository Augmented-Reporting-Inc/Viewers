/**
 * Keeps a pointer-driven guided workflow in charge of the primary mouse binding
 * across individual drags and viewport switches. Only the workflow owner starts
 * and restores the focus; ordinary tools retain their normal behavior otherwise.
 */
export function createGuidedMouseToolOwnership(primaryBindings: any[]) {
  const previousTools = new Map<any, string>();
  let active = false;

  function restore() {
    active = false;
    for (const [toolGroup, previousToolName] of previousTools) {
      // An explicit user selection made since the workflow started wins.
      if (
        previousToolName &&
        toolGroup.hasTool?.(previousToolName) &&
        !toolGroup.getActivePrimaryMouseButtonTool?.()
      ) {
        toolGroup.setToolActive?.(previousToolName, { bindings: primaryBindings });
      }
    }
    previousTools.clear();
  }

  return {
    start() {
      restore();
      active = true;
    },
    suspend(toolGroup: any) {
      if (!active || !toolGroup) return;
      const activeTool = toolGroup.getActivePrimaryMouseButtonTool?.() || '';
      if (!previousTools.has(toolGroup)) {
        previousTools.set(toolGroup, activeTool);
      }
      if (activeTool) {
        toolGroup.setToolPassive?.(activeTool);
      }
    },
    shouldDeferLengthActivation(toolName: string) {
      return active && toolName === 'Length';
    },
    isActive() {
      return active;
    },
    restore,
  };
}
