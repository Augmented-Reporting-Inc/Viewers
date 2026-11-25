import { getEchoCompositeAcquisitionSteps } from './echoCompositeAcquisition';

describe('shared Research/Education Echo acquisition command contracts', () => {
  it('uses the same LA 20-disk phase and technique commands', () => {
    expect(getEchoCompositeAcquisitionSteps('laVolumeDisks', 'A4C', 'freehand'))
      .toEqual([{ name: 'startLAVolumeWorkflow', payload: {
        slot: 'A4C', contourTechnique: 'freehand', autoContinue: false,
      } }]);
    expect(getEchoCompositeAcquisitionSteps('laVolumeDisks', 'A2C', 'axisApex'))
      .toEqual([{ name: 'startLAVolumeWorkflow', payload: {
        slot: 'A2C', contourTechnique: 'axisApex', autoContinue: false,
      } }]);
  });
  it('preserves RV freehand and guided-axis tool semantics', () => {
    expect(getEchoCompositeAcquisitionSteps('rvFac', 'RV_ED', 'freehand'))
      .toEqual([{ name: 'startEchoAreaContourWorkflow', payload: {
        slot: 'RV_ED', clickTrace: true,
      } }]);
    expect(getEchoCompositeAcquisitionSteps('rvFac', 'RV_ES', 'axisApex'))
      .toEqual([{ name: 'startGuidedRVFACContourWorkflow', payload: { slot: 'RV_ES' } }]);
  });
  it('resets label mode before activating the existing calibrated Length tool', () => {
    expect(getEchoCompositeAcquisitionSteps('ivcCollapsibility', 'IVC_INSP'))
      .toEqual([
        { name: 'resetViewerLengthLabelMode', payload: {} },
        { name: 'activateViewerMeasurementTool', payload: {
          toolName: 'Length', stopCine: true,
        } },
      ]);
  });
  it('refuses missing and unsupported phase/technique combinations', () => {
    expect(getEchoCompositeAcquisitionSteps('laVolumeDisks', 'RV_ED')).toEqual([]);
    expect(getEchoCompositeAcquisitionSteps('rvFac', 'IVC_EXP')).toEqual([]);
    expect(getEchoCompositeAcquisitionSteps('ivcCollapsibility', 'A4C')).toEqual([]);
    expect(getEchoCompositeAcquisitionSteps('laVolumeDisks', 'A4C', 'bad' as any)).toEqual([]);
  });
});
