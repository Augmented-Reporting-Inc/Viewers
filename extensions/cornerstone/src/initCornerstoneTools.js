import {
  PanTool,
  WindowLevelTool,
  SegmentBidirectionalTool,
  StackScrollTool,
  VolumeRotateTool,
  ZoomTool,
  MIPJumpToClickTool,
  LengthTool,
  RectangleROITool,
  RectangleROIThresholdTool,
  EllipticalROITool,
  CircleROITool,
  BidirectionalTool,
  ArrowAnnotateTool,
  DragProbeTool,
  ProbeTool,
  AngleTool,
  CobbAngleTool,
  MagnifyTool,
  CrosshairsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  CircleScissorsTool,
  BrushTool,
  PaintFillTool,
  init,
  addTool,
  annotation,
  drawing,
  ReferenceLinesTool,
  TrackballRotateTool,
  AdvancedMagnifyTool,
  UltrasoundDirectionalTool,
  UltrasoundPleuraBLineTool,
  PlanarFreehandROITool,
  PlanarFreehandContourSegmentationTool,
  SplineROITool,
  LivewireContourTool,
  OrientationMarkerTool,
  WindowLevelRegionTool,
  SegmentSelectTool,
  RegionSegmentPlusTool,
  SegmentLabelTool,
} from '@cornerstonejs/tools';
import { LabelmapSlicePropagationTool, MarkerLabelmapTool } from '@cornerstonejs/ai';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

import CalibrationLineTool from './tools/CalibrationLineTool';
import ImageOverlayViewerTool from './tools/ImageOverlayViewerTool';

function wrapAnnotationTextLine(value, maxChars) {
  const source = String(value ?? '');

  if (!source) {
    return [''];
  }

  const lines = [];
  let remaining = source;

  while (remaining.length > maxChars) {
    const windowText = remaining.slice(0, maxChars + 1);
    const whitespaceIndex = Math.max(windowText.lastIndexOf(' '), windowText.lastIndexOf('\t'));
    const splitIndex = whitespaceIndex >= Math.floor(maxChars * 0.55) ? whitespaceIndex : maxChars;

    lines.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  lines.push(remaining);
  return lines;
}

function wrapAnnotationTextLines(textLines = [], maxChars = 0) {
  const resolvedMaxChars = Number(maxChars);

  if (!Number.isFinite(resolvedMaxChars) || resolvedMaxChars < 10) {
    return textLines;
  }

  return (Array.isArray(textLines) ? textLines : [textLines]).flatMap(value =>
    String(value ?? '')
      .split(/\r?\n/)
      .flatMap(line => wrapAnnotationTextLine(line, Math.floor(resolvedMaxChars)))
  );
}

const DEFAULT_ARROW_ANNOTATION_WRAP_MAX_CHARS = 48;

class ARArrowAnnotateTool extends ArrowAnnotateTool {
  constructor(...args) {
    super(...args);

    // Cornerstone 3.33.x defines renderAnnotation as an instance field rather
    // than a prototype method. Capture the bound base renderer here, then wrap
    // only the text-box portion so arrows/handles keep upstream behavior.
    const renderBaseAnnotation = this.renderAnnotation;

    this.renderAnnotation = (enabledElement, svgDrawingHelper) =>
      this.renderWrappedAnnotation(enabledElement, svgDrawingHelper, renderBaseAnnotation);
  }

  renderWrappedAnnotation(enabledElement, svgDrawingHelper, renderBaseAnnotation) {
    const { viewport } = enabledElement;
    const { element } = viewport;
    const configuredMaxChars = Number(
      this.configuration?.arTextWrapMaxChars || DEFAULT_ARROW_ANNOTATION_WRAP_MAX_CHARS
    );
    const shouldWrap =
      typeof this.configuration?.arShouldWrapAnnotationText === 'function'
        ? this.configuration.arShouldWrapAnnotationText()
        : true;

    if (!shouldWrap || !Number.isFinite(configuredMaxChars) || configuredMaxChars < 10) {
      return renderBaseAnnotation(enabledElement, svgDrawingHelper);
    }

    let annotations = annotation.state.getAnnotations?.(this.getToolName(), element) || [];
    annotations = this.filterInteractableAnnotationsForElement(element, annotations) || [];

    const maxChars = Math.floor(configuredMaxChars);
    const wrapTargets = annotations
      .filter(candidate => !!candidate?.data?.text)
      .map(candidate => ({
        annotation: candidate,
        text: String(candidate.data.text),
      }));

    if (!wrapTargets.length) {
      return renderBaseAnnotation(enabledElement, svgDrawingHelper);
    }

    // Prevent the upstream renderer from drawing its hard-coded `[text]`
    // single-line text box. It still draws all arrows and handles.
    for (const target of wrapTargets) {
      target.annotation.data.text = '';
    }

    let renderStatus;
    try {
      renderStatus = renderBaseAnnotation(enabledElement, svgDrawingHelper);
    } finally {
      for (const target of wrapTargets) {
        target.annotation.data.text = target.text;
      }
    }

    if (!viewport.getRenderingEngine?.()) {
      return renderStatus;
    }

    let wrappedTextRendered = false;

    for (const target of wrapTargets) {
      const targetAnnotation = target.annotation;
      const annotationId = targetAnnotation?.annotationUID;
      const handles = targetAnnotation?.data?.handles;
      const points = handles?.points;

      if (
        !annotationId ||
        !Array.isArray(points) ||
        points.length < 2 ||
        !handles?.textBox ||
        annotation.visibility?.isAnnotationVisible?.(annotationId) === false
      ) {
        continue;
      }

      const styleSpecifier = {
        toolGroupId: this.toolGroupId,
        toolName: this.getToolName(),
        viewportId: viewport.id,
        annotationUID: annotationId,
      };
      const options = this.getLinkedTextBoxStyle(styleSpecifier, targetAnnotation);

      if (!options.visibility) {
        handles.textBox = {
          hasMoved: false,
          worldPosition: [0, 0, 0],
          worldBoundingBox: {
            topLeft: [0, 0, 0],
            topRight: [0, 0, 0],
            bottomLeft: [0, 0, 0],
            bottomRight: [0, 0, 0],
          },
        };
        continue;
      }

      const canvasCoordinates = points.map(point => viewport.worldToCanvas(point));

      if (!handles.textBox.hasMoved) {
        handles.textBox.worldPosition = viewport.canvasToWorld(canvasCoordinates[1]);
      }

      const textBoxPosition = viewport.worldToCanvas(handles.textBox.worldPosition);
      const textLines = wrapAnnotationTextLines([target.text], maxChars);
      const boundingBox = drawing.drawLinkedTextBox(
        svgDrawingHelper,
        annotationId,
        '1',
        textLines,
        textBoxPosition,
        canvasCoordinates,
        {},
        options
      );

      const { x: left, y: top, width, height } = boundingBox;
      handles.textBox.worldBoundingBox = {
        topLeft: viewport.canvasToWorld([left, top]),
        topRight: viewport.canvasToWorld([left + width, top]),
        bottomLeft: viewport.canvasToWorld([left, top + height]),
        bottomRight: viewport.canvasToWorld([left + width, top + height]),
      };

      wrappedTextRendered = true;
    }

    return renderStatus || wrappedTextRendered;
  }
}

export default function initCornerstoneTools(configuration = {}) {
  CrosshairsTool.isAnnotation = false;
  LabelmapSlicePropagationTool.isAnnotation = false;
  MarkerLabelmapTool.isAnnotation = false;
  ReferenceLinesTool.isAnnotation = false;
  AdvancedMagnifyTool.isAnnotation = false;
  PlanarFreehandContourSegmentationTool.isAnnotation = false;

  init({
    addons: {
      polySeg,
    },
    computeWorker: {
      autoTerminateOnIdle: {
        enabled: false,
      },
    },
  });
  addTool(PanTool);
  addTool(SegmentBidirectionalTool);
  addTool(WindowLevelTool);
  addTool(StackScrollTool);
  addTool(VolumeRotateTool);
  addTool(ZoomTool);
  addTool(ProbeTool);
  addTool(MIPJumpToClickTool);
  addTool(LengthTool);
  addTool(RectangleROITool);
  addTool(RectangleROIThresholdTool);
  addTool(EllipticalROITool);
  addTool(CircleROITool);
  addTool(BidirectionalTool);
  addTool(ARArrowAnnotateTool);
  addTool(DragProbeTool);
  addTool(AngleTool);
  addTool(CobbAngleTool);
  addTool(MagnifyTool);
  addTool(CrosshairsTool);
  addTool(RectangleScissorsTool);
  addTool(SphereScissorsTool);
  addTool(CircleScissorsTool);
  addTool(BrushTool);
  addTool(PaintFillTool);
  addTool(ReferenceLinesTool);
  addTool(CalibrationLineTool);
  addTool(TrackballRotateTool);
  addTool(ImageOverlayViewerTool);
  addTool(AdvancedMagnifyTool);
  addTool(UltrasoundDirectionalTool);
  addTool(UltrasoundPleuraBLineTool);
  addTool(PlanarFreehandROITool);
  addTool(SplineROITool);
  addTool(LivewireContourTool);
  addTool(OrientationMarkerTool);
  addTool(WindowLevelRegionTool);
  addTool(PlanarFreehandContourSegmentationTool);
  addTool(SegmentSelectTool);
  addTool(SegmentLabelTool);
  addTool(LabelmapSlicePropagationTool);
  addTool(MarkerLabelmapTool);
  addTool(RegionSegmentPlusTool);
  // Modify annotation tools to use dashed lines on SR
  const annotationStyle = {
    textBoxFontSize: '15px',
    lineWidth: '1.5',
  };

  const defaultStyles = annotation.config.style.getDefaultToolStyles();
  annotation.config.style.setDefaultToolStyles({
    global: {
      ...defaultStyles.global,
      ...annotationStyle,
    },
  });
}

const toolNames = {
  Pan: PanTool.toolName,
  ArrowAnnotate: ArrowAnnotateTool.toolName,
  WindowLevel: WindowLevelTool.toolName,
  StackScroll: StackScrollTool.toolName,
  Zoom: ZoomTool.toolName,
  VolumeRotate: VolumeRotateTool.toolName,
  MipJumpToClick: MIPJumpToClickTool.toolName,
  Length: LengthTool.toolName,
  DragProbe: DragProbeTool.toolName,
  Probe: ProbeTool.toolName,
  RectangleROI: RectangleROITool.toolName,
  RectangleROIThreshold: RectangleROIThresholdTool.toolName,
  EllipticalROI: EllipticalROITool.toolName,
  CircleROI: CircleROITool.toolName,
  Bidirectional: BidirectionalTool.toolName,
  Angle: AngleTool.toolName,
  CobbAngle: CobbAngleTool.toolName,
  Magnify: MagnifyTool.toolName,
  Crosshairs: CrosshairsTool.toolName,
  Brush: BrushTool.toolName,
  PaintFill: PaintFillTool.toolName,
  ReferenceLines: ReferenceLinesTool.toolName,
  CalibrationLine: CalibrationLineTool.toolName,
  TrackballRotateTool: TrackballRotateTool.toolName,
  CircleScissors: CircleScissorsTool.toolName,
  RectangleScissors: RectangleScissorsTool.toolName,
  SphereScissors: SphereScissorsTool.toolName,
  ImageOverlayViewer: ImageOverlayViewerTool.toolName,
  AdvancedMagnify: AdvancedMagnifyTool.toolName,
  UltrasoundDirectional: UltrasoundDirectionalTool.toolName,
  UltrasoundAnnotation: UltrasoundPleuraBLineTool.toolName,
  SplineROI: SplineROITool.toolName,
  LivewireContour: LivewireContourTool.toolName,
  PlanarFreehandROI: PlanarFreehandROITool.toolName,
  OrientationMarker: OrientationMarkerTool.toolName,
  WindowLevelRegion: WindowLevelRegionTool.toolName,
  PlanarFreehandContourSegmentation: PlanarFreehandContourSegmentationTool.toolName,
  SegmentBidirectional: SegmentBidirectionalTool.toolName,
  SegmentSelect: SegmentSelectTool.toolName,
  SegmentLabel: SegmentLabelTool.toolName,
  LabelmapSlicePropagation: LabelmapSlicePropagationTool.toolName,
  MarkerLabelmap: MarkerLabelmapTool.toolName,
  RegionSegmentPlus: RegionSegmentPlusTool.toolName,
};

export { toolNames };
