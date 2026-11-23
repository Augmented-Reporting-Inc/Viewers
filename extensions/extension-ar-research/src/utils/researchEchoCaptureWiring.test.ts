import fs from 'fs';
import path from 'path';

const panel = fs.readFileSync(path.resolve(__dirname, '../panels/ResearchReadPanel.tsx'), 'utf8');
const viewerCommands = fs.readFileSync(
  path.resolve(__dirname, '../../../cornerstone/src/commandsModule.ts'), 'utf8'
);

describe('Research source capture is opt-in without changing other viewer workflows', () => {
  it('requests complete guided Echo contours for both live binding and Save', () => {
    const optIns = panel.match(/includeResearchEchoContours: true/g) || [];
    expect(optIns).toHaveLength(2);
    expect(panel).toContain('getLVSimpsonSourceVolumes(allAnnotations)');
    expect(panel).toContain('reconcileResearchEchoCompositeAnswers(');
    expect(panel).toContain('buildViewerMeasurementValueCandidates(measurementAnnotations)');
  });

  it('allows verified Echo contours through research-only serialization while retaining normal filters', () => {
    expect(viewerCommands).toMatch(/getSerializedViewerMeasurements:\s*\(\{[\s\S]*?includeResearchEchoContours = false/);
    expect(viewerCommands).toMatch(/includeResearchEchoContours === true\s*&&\s*workflow === VIEWER_MEASUREMENTS_WORKFLOW\s*&&\s*domain === 'echo'/);
    expect(viewerCommands).toContain('isLVSimpsonMeasurement(measurement)');
    expect(viewerCommands).toContain('isLAVolumeMeasurement(measurement)');
    expect(viewerCommands).toContain('!!getEchoAreaSlot(measurement)');
  });

  it('shows missing and acquired EF phase volume slots and no unrelated-annotation accordion', () => {
    expect(panel).toContain('selectedField?.componentKey === \'lvEjectionFraction\'');
    expect(panel).toContain('<EchoEFContourVolumes volumes={efVolumes}');
    expect(panel).not.toContain('Other viewer annotations (');
  });

  it('uses a source-safe delete x and activates Length from the selected question', () => {
    expect(panel).toContain('getResearchMeasurementToolForField(field, readDomain)');
    expect(panel).toContain('activateViewerMeasurementTool');
    expect(panel).toContain('Delete ${field.label} measurement');
    expect(panel).toContain('selectedSources.length === 1');
  });
});
