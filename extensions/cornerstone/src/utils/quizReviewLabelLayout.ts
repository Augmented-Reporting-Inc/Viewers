/**
 * Stable, read-only quiz comparison label positions in viewport canvas pixels.
 * Keep the two long EF/LAV labels apart without modifying contour geometry.
 * Narrow viewports use separate rows rather than clipping the gold label.
 */
export function getViewerQuizComparisonLabelCanvasPosition({
  width, height, variant,
}: {
  width: number; height: number; variant: 'learner' | 'rubric';
}): [number, number] | null {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    return null;
  }
  const margin = 18;
  const upperY = Math.min(Math.max(32, height * 0.08), Math.max(32, height - 92));
  if (width < 760) {
    return [margin, variant === 'learner' ? upperY : Math.min(height - 24, upperY + 62)];
  }
  // Reserve 360 CSS pixels for long EF labels. Gold stays at the opposite
  // edge, with ample whitespace between labels when the viewport is wide.
  return [variant === 'learner' ? margin : width - 370, upperY];
}
