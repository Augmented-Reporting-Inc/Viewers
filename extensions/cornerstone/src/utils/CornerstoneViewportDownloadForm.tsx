import React, { useEffect, useState } from 'react';
import html2canvas from 'html2canvas';
import { getEnabledElement, StackViewport, BaseVolumeViewport } from '@cornerstonejs/core';
import { ToolGroupManager, segmentation, Enums } from '@cornerstonejs/tools';
import { getEnabledElement as OHIFgetEnabledElement } from '../state';
import { useSystem } from '@ohif/core/src';

const DEFAULT_SIZE = 512;
const MAX_TEXTURE_SIZE = 10000;
const VIEWPORT_ID = 'cornerstone-viewport-download-form';

const getMimeType = (fileType: string) => {
  return fileType === 'png' ? 'image/png' : 'image/jpeg';
};

const getFileExtension = (fileType: string) => {
  return fileType === 'png' ? 'png' : 'jpg';
};

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error);
};

const canvasToBlob = (canvas: HTMLCanvasElement, fileType: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('Unable to create image blob.'));
          return;
        }
        resolve(blob);
      },
      getMimeType(fileType),
      1.0
    );
  });
};

const FILE_TYPE_OPTIONS = [
  {
    value: 'jpg',
    label: 'JPG',
  },
  {
    value: 'png',
    label: 'PNG',
  },
];

type ViewportDownloadFormProps = {
  hide: () => void;
  activeViewportId: string;
};

const CornerstoneViewportDownloadForm = ({
  hide,
  activeViewportId: activeViewportIdProp,
}: ViewportDownloadFormProps) => {
  const { servicesManager } = useSystem();
  const {
    customizationService,
    cornerstoneViewportService,
    displaySetService,
    measurementService,
    viewportGridService,
    uiNotificationService,
  } = servicesManager.services;
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [isSavingToPatientFolder, setIsSavingToPatientFolder] = useState(false);
  const [viewportDimensions, setViewportDimensions] = useState({
    width: DEFAULT_SIZE,
    height: DEFAULT_SIZE,
  });

  const warningState = customizationService.getCustomization('viewportDownload.warningMessage') as {
    enabled: boolean;
    value: string;
  };

  const refViewportEnabledElementOHIF = OHIFgetEnabledElement(activeViewportIdProp);
  const activeViewportElement = refViewportEnabledElementOHIF?.element;
  const activeEnabledElement = activeViewportElement
    ? getEnabledElement(activeViewportElement)
    : null;

  const activeViewportId = activeEnabledElement?.viewportId;
  const renderingEngineId = activeEnabledElement?.renderingEngineId;

  const renderingEngine = cornerstoneViewportService.getRenderingEngine();
  const toolGroup =
    activeViewportId && renderingEngineId
      ? ToolGroupManager.getToolGroupForViewport(activeViewportId, renderingEngineId)
      : null;

  useEffect(() => {
    if (!toolGroup?.toolOptions) {
      return;
    }

    const toolModeAndBindings = Object.keys(toolGroup.toolOptions).reduce((acc, toolName) => {
      const tool = toolGroup.toolOptions[toolName];
      const { mode, bindings } = tool;

      return {
        ...acc,
        [toolName]: { mode, bindings },
      };
    }, {});

    return () => {
      Object.keys(toolModeAndBindings).forEach(toolName => {
        const { mode, bindings } = toolModeAndBindings[toolName];
        toolGroup.setToolMode(toolName, mode, { bindings });
      });
    };
  }, [toolGroup]);

  const handleEnableViewport = (viewportElement: HTMLElement) => {
    if (!viewportElement || !activeViewportElement || !renderingEngine) {
      return;
    }

    const activeViewportEnabledElement = getEnabledElement(activeViewportElement);
    if (!activeViewportEnabledElement) {
      return;
    }

    const { viewport } = activeViewportEnabledElement;

    const viewportInput = {
      viewportId: VIEWPORT_ID,
      element: viewportElement,
      type: viewport.type,
      defaultOptions: {
        background: viewport.defaultOptions.background,
        orientation: viewport.defaultOptions.orientation,
      },
    };

    renderingEngine.enableElement(viewportInput);
  };

  const handleDisableViewport = async () => {
    if (!renderingEngine) {
      return;
    }

    renderingEngine.disableElement(VIEWPORT_ID);
  };

  const handleLoadImage = async (width: number, height: number) => {
    if (!activeViewportElement || !activeViewportId || !renderingEngine) {
      return;
    }

    const activeViewportEnabledElement = getEnabledElement(activeViewportElement);
    if (!activeViewportEnabledElement) {
      return;
    }

    const segmentationRepresentations =
      segmentation.state.getViewportSegmentationRepresentations(activeViewportId) || [];

    const { viewport } = activeViewportEnabledElement;
    const downloadViewport = renderingEngine.getViewport(VIEWPORT_ID);
    if (!downloadViewport) {
      return;
    }

    try {
      if (downloadViewport instanceof StackViewport) {
        const imageId = viewport.getCurrentImageId();
        const properties = viewport.getProperties();

        await downloadViewport.setStack([imageId]);
        downloadViewport.setProperties(properties);
      } else if (downloadViewport instanceof BaseVolumeViewport) {
        const volumeIds = viewport.getAllVolumeIds();
        downloadViewport.setVolumes([{ volumeId: volumeIds[0] }]);
      }

      if (segmentationRepresentations.length > 0) {
        segmentationRepresentations.forEach(segRepresentation => {
          const { segmentationId, colorLUTIndex, type } = segRepresentation;
          if (type === Enums.SegmentationRepresentations.Labelmap) {
            segmentation.addLabelmapRepresentationToViewportMap({
              [downloadViewport.id]: [
                {
                  segmentationId,
                  type: Enums.SegmentationRepresentations.Labelmap,
                  config: {
                    colorLUTOrIndex: colorLUTIndex,
                  },
                },
              ],
            });
          }

          if (type === Enums.SegmentationRepresentations.Contour) {
            segmentation.addContourRepresentationToViewportMap({
              [downloadViewport.id]: [
                {
                  segmentationId,
                  type: Enums.SegmentationRepresentations.Contour,
                  config: {
                    colorLUTOrIndex: colorLUTIndex,
                  },
                },
              ],
            });
          }
        });
      }

      return {
        width: Math.min(width || DEFAULT_SIZE, MAX_TEXTURE_SIZE),
        height: Math.min(height || DEFAULT_SIZE, MAX_TEXTURE_SIZE),
      };
    } catch (error) {
      console.error('Error loading image:', error);
    }
  };

  const handleToggleAnnotations = (show: boolean) => {
    if (!activeViewportElement || !renderingEngine) {
      return;
    }

    const activeViewportEnabledElement = getEnabledElement(activeViewportElement);
    if (!activeViewportEnabledElement) {
      return;
    }

    const downloadViewport = renderingEngine.getViewport(VIEWPORT_ID);
    if (!downloadViewport) {
      return;
    }

    const { viewportId: activeViewportId, renderingEngineId } = activeViewportEnabledElement;
    const { id: downloadViewportId } = downloadViewport;

    const toolGroup = ToolGroupManager.getToolGroupForViewport(activeViewportId, renderingEngineId);
    if (!toolGroup) {
      return;
    }

    toolGroup.addViewport(downloadViewportId, renderingEngineId);

    const toolInstances = toolGroup.getToolInstances();
    const toolInstancesArray = Object.values(toolInstances);

    toolInstancesArray.forEach(toolInstance => {
      if (toolInstance.constructor.isAnnotation !== false) {
        if (show) {
          toolGroup.setToolEnabled(toolInstance.toolName);
        } else {
          toolGroup.setToolDisabled(toolInstance.toolName);
        }
      }
    });
  };

  useEffect(() => {
    if (!renderingEngine) {
      return;
    }

    if (viewportDimensions.width && viewportDimensions.height) {
      setTimeout(() => {
        handleLoadImage(viewportDimensions.width, viewportDimensions.height);
        handleToggleAnnotations(showAnnotations);
        // we need a resize here to make suer annotations world to canvas
        // are properly calculated
        renderingEngine.resize();
        renderingEngine.render();
      }, 100);
    }
  }, [viewportDimensions, showAnnotations, renderingEngine]);

  const getCaptureCanvas = async () => {
    const divForDownloadViewport = document.querySelector(
      `div[data-viewport-uid="${VIEWPORT_ID}"]`
    );

    if (!divForDownloadViewport) {
      throw new Error('No viewport found for capture.');
    }

    return html2canvas(divForDownloadViewport as HTMLElement);
  };

  const getActiveDisplaySet = () => {
    const { activeViewportId: currentViewportId, viewports } = viewportGridService.getState();
    const targetViewportId = activeViewportIdProp || currentViewportId;
    const activeViewport = viewports?.get?.(targetViewportId) ?? viewports?.[targetViewportId];

    const displaySetInstanceId = activeViewport?.displaySetInstanceUIDs?.[0];
    if (!displaySetInstanceId) {
      return null;
    }

    return displaySetService.getDisplaySetByUID(displaySetInstanceId);
  };

  const waitForActiveDisplaySet = async () => {
    for (let i = 0; i < 20; i++) {
      const displaySet = getActiveDisplaySet();
      if (displaySet?.StudyInstanceUID) {
        return displaySet;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return null;
  };

  const resolveSeriesDocument = async () => {
    const displaySet = await waitForActiveDisplaySet();
    const studyInstanceId = displaySet?.StudyInstanceUID;
    const seriesInstanceId = displaySet?.SeriesInstanceUID;

    if (!studyInstanceId) {
      throw new Error('Cannot determine active study.');
    }

    // Same lookup pattern as extension-iuscan.
    const studyResponse = await fetch(
      `/formapi/api/series/study/${encodeURIComponent(studyInstanceId)}`,
      { credentials: 'include' }
    );

    if (studyResponse.ok) {
      return studyResponse.json();
    }

    // Fallback only: useful when a Mongo document exists by SeriesInstanceUID
    // but StudyInstanceUID does not match for some legacy/anonymized edge case.
    if (seriesInstanceId) {
      const seriesResponse = await fetch(
        `/formapi/api/series/siuid/${encodeURIComponent(seriesInstanceId)}`,
        { credentials: 'include' }
      );

      if (seriesResponse.ok) {
        return seriesResponse.json();
      }
    }

    throw new Error(
      `Series lookup failed: study=${studyResponse.status}, StudyInstanceUID=${studyInstanceId}, SeriesInstanceUID=${seriesInstanceId || ''}`
    );
  };

  const serializeLengthAnnotations = () => {
    try {
      const allMeasurements = measurementService?.getMeasurements?.() || [];

      return allMeasurements
        .filter(measurement => measurement?.toolName === 'Length')
        .map(measurement => ({
          uid: measurement.uid,
          label: measurement.label || '',
          SOPInstanceUID: measurement.SOPInstanceUID,
          referenceSeriesUID: measurement.referenceSeriesUID,
          referencedImageId: measurement.referencedImageId,
          frameNumber: measurement.frameNumber ?? 1,
          points: measurement.points,
        }))
        .filter(annotation => annotation.referencedImageId || annotation.points?.length);
    } catch (error) {
      console.warn('[AR] Could not serialize Length annotations:', getErrorMessage(error));
      return [];
    }
  };

  const buildCaliperReportPayload = () => {
    const assignSvc = servicesManager.services.iuscanAssignmentService;
    const hasAssignments = assignSvc?.hasAnyAssignment?.() === true;

    const payload =
      hasAssignments && typeof assignSvc.buildReportPayload === 'function'
        ? assignSvc.buildReportPayload(measurementService)
        : { accessType: 'update' };

    const lengthAnnotations = serializeLengthAnnotations();
    if (lengthAnnotations.length > 0) {
      payload.IUScanAnnotations = JSON.stringify(lengthAnnotations);
    }

    if (!hasAssignments && lengthAnnotations.length === 0) {
      return null;
    }

    payload.accessType = payload.accessType || 'update';
    return payload;
  };

  const saveCalipersToSeriesDocument = async seriesDoc => {
    if (!seriesDoc?._id) {
      return false;
    }

    const payload = buildCaliperReportPayload();
    if (!payload) {
      return false;
    }

    const response = await fetch(`/formapi/api/series/${seriesDoc._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Caliper save failed: ${response.status}`);
    }

    return true;
  };

  const handleDownload = async (filename: string, fileType: string) => {
    const canvas = await getCaptureCanvas();
    const link = document.createElement('a');
    link.download = `${filename}.${getFileExtension(fileType)}`;
    link.href = canvas.toDataURL(getMimeType(fileType), 1.0);
    link.click();
  };

  const handleSaveToPatientFolder = async (filename: string, fileType: string) => {
    setIsSavingToPatientFolder(true);

    try {
      const canvas = await getCaptureCanvas();
      const imageBlob = await canvasToBlob(canvas, fileType);
      const seriesDoc = await resolveSeriesDocument();
      const displaySet = getActiveDisplaySet();

      if (!seriesDoc?._id) {
        throw new Error('Series document is missing Mongo id.');
      }

      const formData = new FormData();
      formData.append('seriesKey', String(seriesDoc._id));
      formData.append('image', imageBlob, `${filename}.${getFileExtension(fileType)}`);
      formData.append('filename', filename);
      formData.append('fileType', getFileExtension(fileType));
      formData.append(
        'metadata',
        JSON.stringify({
          StudyInstanceUID: displaySet?.StudyInstanceUID || '',
          SeriesInstanceUID: displaySet?.SeriesInstanceUID || '',
          viewportId: activeViewportIdProp,
          width: viewportDimensions.width,
          height: viewportDimensions.height,
          includeAnnotations: showAnnotations,
        })
      );

      const uploadResponse = await fetch(`/formapi/api/series/${seriesDoc._id}/captures`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Capture upload failed: ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json().catch(() => null);
      const calipersSaved = await saveCalipersToSeriesDocument(seriesDoc);

      const attachmentMessage = {
        type: 'AR_REPORT_ATTACHMENT_UPDATED',
        seriesKey: String(seriesDoc._id || ''),
        fileName: uploadResult?.fileName || '',
        key: uploadResult?.key || '',
      };

      try {
        window.opener?.postMessage(attachmentMessage, '*');
        window.parent?.postMessage(attachmentMessage, '*');
      } catch (messageError) {
        console.warn('[AR] unable to notify report page of attachment update:', messageError);
      }

      uiNotificationService.show({
        title: 'Augmented Reporting',
        message: calipersSaved
          ? 'Image and measurements attached to report.'
          : 'Image attached to report.',
        type: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('[AR] save viewport capture failed:', error);
      uiNotificationService.show({
        title: 'Augmented Reporting',
        message: `Image save failed: ${getErrorMessage(error)}`,
        type: 'error',
        duration: 5000,
      });
      throw error;
    } finally {
      setIsSavingToPatientFolder(false);
    }
  };

  const ViewportDownloadFormNew = customizationService.getCustomization(
    'ohif.captureViewportModal'
  );

  if (!activeEnabledElement || !activeViewportId || !renderingEngine) {
    return null;
  }

  return (
    <ViewportDownloadFormNew
      onClose={hide}
      defaultSize={DEFAULT_SIZE}
      fileTypeOptions={FILE_TYPE_OPTIONS}
      viewportId={VIEWPORT_ID}
      showAnnotations={showAnnotations}
      onAnnotationsChange={setShowAnnotations}
      dimensions={viewportDimensions}
      onDimensionsChange={setViewportDimensions}
      onEnableViewport={handleEnableViewport}
      onDisableViewport={handleDisableViewport}
      onDownload={handleDownload}
      onSaveToPatientFolder={handleSaveToPatientFolder}
      isSavingToPatientFolder={isSavingToPatientFolder}
      warningState={warningState}
    />
  );
};

export default CornerstoneViewportDownloadForm;
