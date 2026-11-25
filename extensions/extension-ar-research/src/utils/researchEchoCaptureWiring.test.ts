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

describe('Research Length selection uses shared restoration and permissions', () => {
  it('restores linked Length before protocol-only navigation', () => {
    const start = panel.indexOf('const navigateToField = async');
    const end = panel.indexOf('const selectionGenerationRef', start);
    const navigation = panel.slice(start, end);
    expect(navigation).toContain('getResearchLengthSourceState(');
    const restoreStart = panel.indexOf('const restoreResearchAnnotationSource =');
    const restore = panel.slice(restoreStart, start);
    expect(restore).toContain('requireExactSopFrame: true, isCancelled: cancelled');
    expect(restore).toContain('deletedAnnotationIdsRef.current.has(sourceId)');
    expect(navigation.indexOf('return restoreResearchAnnotationSource(source, isCancelled)')).toBeLessThan(
      navigation.indexOf('const target = getResearchQuestionEntryTarget(field)'));
    expect(restore).toContain('isLocked: true');
    expect(navigation).toContain("state.status === 'invalid' || state.status === 'ambiguous'");
    expect(panel).toContain('selectionQueueRef.current.then(run, run)');
    expect(panel).toContain('initializedReviewRef.current === reviewKey');
    expect(panel).toContain('selectedLength ? showLengthSourceResolution');
    expect(viewerCommands).toContain('findImageIdIndexForSavedAnnotation(latestViewport, annotation, requireExactSopFrame)');
    expect(viewerCommands).toContain('saved-source-frame-changed-before-hydration');
  });
});

describe('Research LAV uses shared Education phase rows and calculation controls', () => {
  it('has one LAV panel, uses Review-owned sources and never imports quiz answer persistence', () => {
    const guided = fs.readFileSync(path.resolve(__dirname,
      '../panels/ResearchEchoGuidedControls.tsx'), 'utf8');
    const start = guided.indexOf("if (kind === 'laVolumeDisks')");
    const end = guided.indexOf('Guided Echo measurement', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const la = guided.slice(start, end);
    for (const component of ['LearningEchoAcquisitionControls', 'SharedEchoPhaseStatus',
      'SharedEchoRecalculateButton', 'EchoCompositeResultStatus', 'EchoCompositeResultCard']) {
      expect(la).toContain('<' + component);
    }
    expect(la).toContain("await runCompositeSteps('laVolumeDisks', slot");
    expect(la).toContain('await openPhase(slot)');
    expect(la).toContain('item.matchesTarget ? item.areaCM2 : null');
    expect(la).toContain('onDelete={!readOnly && onDeleteLASource');
    expect(la).toContain('Multiple contours for this phase');
    expect(panel).toContain('!selectedLA && !showInlineIVCSources');
    expect(panel).toContain('!selectedLA && !showGuidedIVCValue');
    expect(panel).toContain('getResearchLAPhaseSources(');
    expect(panel).toContain('restoreResearchAnnotationSource(item, isCancelled)');
    expect(panel).toContain('onDeleteLASource={annotation => void deleteResearchAnnotation(annotation)}');
    expect(panel).toContain('refreshViewerMeasurementBindings(undefined, selectedField.key)');
    expect(panel).toContain("field.key === explicitLAFieldKey && field.componentKey === 'laVolumeDisks'");
    expect(panel).not.toContain('saveViewerQuizResponseForActiveStudy');
  });
});
