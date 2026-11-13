/**
 * One-shot learner IVC label exemption. Only a new, pending Length annotation
 * may skip the dialog. Consuming the exemption always restores prompt mode.
 */
export function consumeViewerLengthFirstLabelMode({
  mode, toolName, pendingFirstLabel,
}: { mode: string; toolName: string; pendingFirstLabel: boolean }) {
  const suppress = mode === 'measure-only' &&
    toolName === 'Length' && pendingFirstLabel === true;
  return {
    suppress,
    nextMode: suppress ? 'prompt' : mode,
  };
}
