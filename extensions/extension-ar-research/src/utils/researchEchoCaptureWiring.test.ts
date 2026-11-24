import fs from 'fs';
import path from 'path';

const panel = fs.readFileSync(path.resolve(__dirname, '../panels/ResearchReadPanel.tsx'), 'utf8');
const viewerCommands = fs.readFileSync(
  path.resolve(__dirname, '../../../cornerstone/src/commandsModule.ts'), 'utf8'
);

describe('Research source capture is opt-in without changing other viewer workflows', () => {
  it('requests complete guided Echo contours for both live binding and Save', () => {
    const optIns = panel.match(/includeResearchEchoContours: true/g) || [];
    // Live binding, explicit Calculate EF event, and Save each require
    // their own verified snapshot of the Research-owned contour sources.
    expect(optIns).toHaveLength(3);
    expect(panel).toContain('reconcileResearchEchoCompositeAnswers(');
    expect(panel).toContain('buildViewerMeasurementValueCandidates(measurementAnnotations)');
  });

  it('reuses the verified Calculate EF snapshot and coalesces event bursts', () => {
    expect(panel).toContain('refreshViewerMeasurementBindings({ serialized, efSnapshot: snapshot })');
    expect(panel).toContain('if (running || refreshTimer !== undefined) return');
    expect(panel).toContain('if (pending && !cancelled) refresh()');
  });

  it('allows verified Echo contours through research-only serialization while retaining normal filters', () => {
    expect(viewerCommands).toMatch(/getSerializedViewerMeasurements:\s*\(\{[\s\S]*?includeResearchEchoContours = false/);
    expect(viewerCommands).toMatch(/includeResearchEchoContours === true\s*&&\s*workflow === VIEWER_MEASUREMENTS_WORKFLOW\s*&&\s*domain === 'echo'/);
    expect(viewerCommands).toContain('isLVSimpsonMeasurement(measurement)');
    expect(viewerCommands).toContain('isLAVolumeMeasurement(measurement)');
    expect(viewerCommands).toContain('!!getEchoAreaSlot(measurement)');
  });

  it('delegates EF presentation to the shared Learning component with no second Research EF UI', () => {
    const guided = fs.readFileSync(path.resolve(__dirname,
      '../panels/ResearchEchoGuidedControls.tsx'), 'utf8');
    expect(panel).toContain('efValue={calculatedReadState.values[selectedField.key]');
    expect(panel).toContain('<EchoEFContourVolumes');
    expect(panel).toContain("selectedField?.componentKey !== 'lvEjectionFraction' &&");
    expect(panel).toContain('getLVSimpsonSourceVolumes(savedAnnotations)');
    expect(guided).toContain('<SharedEFQuestionAnswer');
    expect(guided).toContain('efContourTargets: field.config?.compositeFrameTargets');
    expect(guided).toContain('allowCanonicalFrameTargets: true');
    expect(guided).toContain('jumpToSavedViewerAnnotation');
    expect(panel).not.toContain('Other viewer annotations (');
  });

  it('reuses Education EF capture and restores Research-owned contours without querying AR Series', () => {
    const guided = fs.readFileSync(path.resolve(__dirname,
      '../panels/ResearchEchoGuidedControls.tsx'), 'utf8');
    expect(guided).toContain('assessmentSavedEFAnnotations');
    expect(guided).toContain('notifyAssessmentOnCalculate: true');
    expect(panel).toContain('getViewerQuizLVSimpsonForActiveStudy');
    expect(panel).toContain('isMatchingQuizEFCompletion(');
    expect(panel).toContain('getVerifiedResearchEFResultCandidate(');
    expect(panel).toContain('ar-measurements:lv-simpson-capture-requested');
    expect(panel).toContain('Calculated EF cannot be saved:');
    expect(panel).toContain('All four EF contour phases are present, but no protocol-verified EF answer');
    expect(viewerCommands).toContain('const assessmentOwned = Array.isArray(assessmentSavedEFAnnotations)');
    expect(viewerCommands).toContain('notifyAssessmentOnCalculate');
  });

  it('uses a source-safe delete x and activates Length from the selected question', () => {
    expect(panel).toContain('getResearchMeasurementToolForField(field, readDomain)');
    expect(panel).toContain('activateViewerMeasurementTool');
    expect(panel).toContain('Delete ${field.label} measurement');
    expect(panel).toContain('selectedSources.length === 1');
  });
});
