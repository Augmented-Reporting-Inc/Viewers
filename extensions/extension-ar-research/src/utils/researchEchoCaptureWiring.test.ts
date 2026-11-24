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
    expect(panel).toContain('buildViewerMeasurementValueCandidates(measurementAnnotations, { includeLVSimpson: false })');
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
    expect(panel).toContain('getLVSimpsonSourceVolumes(selected, { verifiedSavedSources: !!persistedEF })');
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
    expect(viewerCommands).toContain('restoreSavedLVSimpsonSlots({');
    expect(viewerCommands).toContain('pendingSavedEFRestoration');
    expect(viewerCommands).toContain('Retry saved contours');
    expect(guided).toContain('assessmentSavedEFResult');
    expect(guided).toContain('deferSavedEFRestoration: true');
    expect(viewerCommands).toContain('efSaved.length > 0 && !panelFirst');
    expect(viewerCommands).toContain('restoreSources(savedSlot, cancelled, [slot])');
    expect(viewerCommands).toContain('visible.filter(item => item.arSavedEFPanelSource), cancelled');
    expect(panel).toContain('applyResearchSnapshotEvidence(');
    expect(panel).toContain('withPersistedEF(liveVerifiedEchoEvidence.candidates, persistedEF)');
    expect(panel).toContain('freshVerifiedEvidence, { verifiedEFOnly: true }');
  });

  it('uses a defined current shared EF snapshot for both drawing methods and preserves the partial panel', () => {
    const start = viewerCommands.indexOf('startLVSimpsonEFWorkflow: async');
    const end = viewerCommands.indexOf('startLAVolumeWorkflow: async', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const workflow = viewerCommands.slice(start, end);
    expect(workflow).not.toMatch(/\b(?:liveMeasurements|sessionLVSimpsonMeasurements)\b/);
    expect(workflow.match(/measurements: lvSimpsonPanelController\?\.getMeasurements\?\.\(\) \|\| \[\]/g)).toHaveLength(3);
    expect(workflow).toContain('pendingSavedEFRestoration || slotCandidates.size > 0 || hasSavedPanelSources');
    expect(workflow).toContain('cancelDrawingWithoutClosingPanel();\n            await actions.startLVSimpsonEFWorkflow');
    expect(workflow).toContain('viewerMeasurementsDeletedInSession.has(getMeasurementAnnotationId(item))');
  });

  it('uses a source-safe delete x and activates Length from the selected question', () => {
    expect(panel).toContain('getResearchMeasurementToolForField(field, readDomain)');
    expect(panel).toContain('activateViewerMeasurementTool');
    expect(panel).toContain('Delete ${field.label} measurement');
    expect(panel).toContain('selectedSources.length === 1');
  });
});
