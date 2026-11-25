export type EchoCompositeKind = 'laVolumeDisks' | 'rvFac' | 'ivcCollapsibility';
export type EchoContourTechnique = 'freehand' | 'axisApex';

export type EchoViewerCommandStep = {
  name: string;
  payload: Record<string, any>;
};

/**
 * Shared viewer tool command contract for Education and Research.
 * Callers remain responsible for authorizing the current workflow, selecting
 * and verifying the exact DICOM frame, capturing answers, saving and deletion.
 * Do not change a running tool or inference/scoring behavior here.
 */
export function getEchoCompositeAcquisitionSteps(
  kind: EchoCompositeKind,
  slot: string,
  technique: EchoContourTechnique = 'freehand'
): EchoViewerCommandStep[] {
  if (kind === 'laVolumeDisks') {
    if (!['A4C', 'A2C'].includes(slot) || !['freehand', 'axisApex'].includes(technique)) return [];
    return [{ name: 'startLAVolumeWorkflow',
      payload: { slot, contourTechnique: technique, autoContinue: false } }];
  }
  if (kind === 'rvFac') {
    if (!['RV_ED', 'RV_ES'].includes(slot) || !['freehand', 'axisApex'].includes(technique)) return [];
    return technique === 'freehand'
      ? [{ name: 'startEchoAreaContourWorkflow', payload: { slot, clickTrace: true } }]
      : [{ name: 'startGuidedRVFACContourWorkflow', payload: { slot } }];
  }
  if (kind === 'ivcCollapsibility') {
    if (!['IVC_EXP', 'IVC_INSP'].includes(slot)) return [];
    return [
      { name: 'resetViewerLengthLabelMode', payload: {} },
      { name: 'activateViewerMeasurementTool', payload: { toolName: 'Length', stopCine: true } },
    ];
  }
  return [];
}
