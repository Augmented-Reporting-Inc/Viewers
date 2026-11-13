/**
 * Install an idempotent Cornerstone ROI text renderer at the tool instance.
 *
 * In 3.32.x Cornerstone obtains labels through configuration.getTextLines(data,
 * targetId). Tool groups can replace configuration during viewport navigation,
 * so a boolean "installed" flag alone does not prove our callback is active.
 *
 * The caller supplies a validated quiz-contour formatter. Unrelated annotations
 * retain their prior native renderer; this does not calibrate pixels or modify
 * source measurements, stored annotations or scoring.
 */
type TextLines = string[] | null;
type Formatter = (data: any, targetId?: string) => TextLines;
type ToolInstance = {
  configuration?: Record<string, any>;
};
type ToolGroup = {
  getToolInstance?: (toolName: string) => ToolInstance | null | undefined;
  setToolConfiguration?: (toolName: string, config: Record<string, any>, overwrite?: boolean) => any;
};

type QuizTextCallback = ((data: any, ...args: any[]) => any) & {
  __arQuizAreaRenderer?: true;
  __arQuizAreaFormatter?: Formatter;
  __arQuizFallbackSanitizer?: (lines: any) => any;
};

export function installQuizContourTextRenderer({
  toolGroup,
  toolName,
  formatQuizContour,
  sanitizeFallback = (lines: any) => lines,
}: {
  toolGroup: ToolGroup | null | undefined;
  toolName: string;
  formatQuizContour: Formatter;
  sanitizeFallback?: (lines: any) => any;
}): boolean {
  const instance = toolGroup?.getToolInstance?.(toolName);
  if (!instance || !toolName) return false;

  const existing = instance.configuration?.getTextLines as QuizTextCallback | undefined;
  if (typeof existing === 'function' && existing.__arQuizAreaRenderer === true) {
    // Same tool group, a newly active viewport: update the formatter without
    // layering multiple stale callbacks over one another.
    existing.__arQuizAreaFormatter = formatQuizContour;
    existing.__arQuizFallbackSanitizer = sanitizeFallback;
    return true;
  }

  const next: QuizTextCallback = function(data: any, ...args: any[]) {
    // Use exactly the same validated quantity as the Viewer panel. A recognized
    // quiz contour produces one physical-area line (or an explicit unavailable
    // status), never native mean/max/min/perimeter or a pixel-derived area.
    const quizLines = next.__arQuizAreaFormatter?.(data, args[0]);
    if (quizLines !== null && quizLines !== undefined) return quizLines;
    const originalLines = typeof existing === 'function'
      ? existing.call(this, data, ...args) : [];
    return next.__arQuizFallbackSanitizer?.(originalLines) ?? originalLines;
  };
  next.__arQuizAreaRenderer = true;
  next.__arQuizAreaFormatter = formatQuizContour;
  next.__arQuizFallbackSanitizer = sanitizeFallback;

  const configuration = { ...(instance.configuration || {}), getTextLines: next };
  instance.configuration = configuration;
  toolGroup?.setToolConfiguration?.(toolName, configuration, true);

  // Do not set a permanent marker on the instance. If another workflow
  // replaces getTextLines, a future call must be allowed to reinstall.
  return instance.configuration?.getTextLines === next;
}
