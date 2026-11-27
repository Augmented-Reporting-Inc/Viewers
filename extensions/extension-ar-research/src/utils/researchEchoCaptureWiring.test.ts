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

describe('Completed Research measurement review', () => {
  const guided = fs.readFileSync(path.resolve(__dirname,
    '../panels/ResearchEchoGuidedControls.tsx'), 'utf8');
  const cine = fs.readFileSync(path.resolve(__dirname,
    '../../../cornerstone/src/components/CinePlayer/CinePlayer.tsx'), 'utf8');
  it('re-enters read-only mode and uses immutable saved evidence', () => {
    expect(panel).toContain('getCompletedResearchReadOnlyUrl(');
    expect(panel).toContain('window.location.replace(lockedUrl)');
    expect(panel).toContain('context?.readOnly ? savedAnnotations : mergeMeasurementAnnotations(');
    expect(panel).toContain('if (context?.readOnly && !context?.preview) return persistedReadState;');
    expect(panel).toContain('onActivateSelected={selectedField && context.readOnly');
    expect(panel).toContain('pauseCineOnSource: true');
    expect(cine).toContain('!isLearningRoute && !isReadOnlyResearchRoute()');
    expect(cine).toContain('isLengthMeasurementActive || isReadOnlyResearchRoute()');
  });
  it('restores the linked composite frame on question entry and initial completed Read load', () => {
    const navigation = panel.slice(panel.indexOf('const navigateToField = async'),
      panel.indexOf('const selectionGenerationRef'));
    expect(navigation).toContain('getResearchCompositeReviewEntrySource(');
    expect(navigation).toContain('persistedReadState.sources[field.key], savedAnnotations');
    expect(navigation).toContain('context?.readOnly && !context?.preview && isResearchCompositeReviewQuestion');
    expect(navigation.indexOf('return restoreResearchAnnotationSource(source, isCancelled,'))
      .toBeLessThan(navigation.indexOf('const targets = getResearchProtocolViewerTargets(field)'));
    expect(panel).toContain('(context?.readOnly && isResearchCompositeReviewQuestion(field, readDomain))) runFieldSelection(field)');
    expect(panel).toContain('reviewOnly={context.readOnly && !context.preview}');
  });
  it('does not dispatch saved display sets before a current viewport is ready', () => {
    const start = viewerCommands.indexOf('jumpToSavedViewerAnnotation: async');
    const finish = viewerCommands.indexOf('endViewportSetup();\n      const endViewportReady', start);
    const navigation = viewerCommands.slice(start, finish);
    expect(navigation).toContain('await waitForDisplaySetForSavedAnnotation({');
    expect(navigation).toContain('getReadySavedNavigationViewportId(viewportGridService, cornerstoneViewportService, useQuizTargetNavigation) !== activeViewportId');
    expect(navigation).not.toContain('const activeViewportId = viewportGridService.getActiveViewportId();');
    expect(navigation.indexOf('hasValidSavedNavigationUpdates(viewportGridService, viewportsToUpdate)')).toBeLessThan(
      navigation.indexOf('actions.setDisplaySetsForViewports({ viewportsToUpdate })'));
  });
  it('uses Education scored-review frame navigation for completed EF, without a viewport reset', () => {
    const navigation = panel.slice(panel.indexOf('const navigateToField = async'),
      panel.indexOf('if (isResearchTRVmaxQuestion(field, readDomain))', panel.indexOf('const navigateToField = async')));
    expect(navigation).toContain("field.componentKey === 'lvEjectionFraction'");
    expect(panel).toContain('isCancelled: cancelled, useQuizTargetNavigation');
    const slot = viewerCommands.slice(viewerCommands.indexOf('async onNavigateSlot(slot'),
      viewerCommands.indexOf('const savedSlot = panelFirst', viewerCommands.indexOf('async onNavigateSlot(slot')));
    expect(slot).toContain('if (assessmentReviewOnly)');
    expect(slot).toContain('useQuizTargetNavigation: true');
    const jump = viewerCommands.slice(viewerCommands.indexOf('jumpToSavedViewerAnnotation: async'),
      viewerCommands.indexOf('showSavedViewerAnnotationsForSameImage: async'));
    expect(jump).toContain('useQuizTargetNavigation = false');
    expect(jump).toContain('quizNavigation = await actions.jumpToViewerQuizTarget({');
    expect(jump).toContain('requireExactSopFrame: true, pauseCineOnTarget: true');
    expect(jump).toContain('requireReadyViewport: true, isCancelled');
    expect(jump).toContain('? quizNavigation.imageId');
    expect(jump).not.toContain('resetCamera');
    expect(jump).not.toContain('resetProperties');
  });
  it('opens the shared EF panel for review, not acquisition or calculation', () => {
    expect(guided).toContain('reviewNavigation={readOnly}');
    expect(guided).toContain('assessmentReviewOnly: true');
    expect(viewerCommands).toContain('canEdit: !assessmentReviewOnly');
    expect(viewerCommands).toContain('if (this.canEdit === false || !LV_TRACE_REQUIRED_SLOTS.includes(slot)');
    expect(viewerCommands).toContain('if (assessmentReviewOnly || suppressLVSimpsonRecoveryEvents');
    const review = viewerCommands.slice(
      viewerCommands.indexOf('if (assessmentReviewOnly) {\n        // Display the immutable'),
      viewerCommands.indexOf('if (panelOnly) {\n        // Educator authoring uses'));
    expect(review).toContain('onCalculate = null');
    expect(review).toContain('Saved LVEF:');
    expect(review).not.toContain('calculateEF(');
    expect(guided).toContain('readOnly={readOnly}');
    expect(guided).toContain('onDelete={!readOnly && onDeleteContourSource');
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

describe('Research LA/RV use shared Education phase rows and calculation controls', () => {
  it('has one contour panel for LA and RV, uses Review-owned sources and never imports quiz answer persistence', () => {
    const guided = fs.readFileSync(path.resolve(__dirname,
      '../panels/ResearchEchoGuidedControls.tsx'), 'utf8');
    const start = guided.indexOf("if (kind === 'laVolumeDisks' || kind === 'rvFac')");
    const end = guided.indexOf('kind="ivcCollapsibility"', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const la = guided.slice(start, end);
    for (const component of ['LearningEchoAcquisitionControls', 'SharedEchoPhaseStatus',
      'SharedEchoRecalculateButton', 'EchoCompositeResultStatus', 'EchoCompositeResultCard']) {
      expect(la).toContain('<' + component);
    }
    expect(la).toContain('kind={kind}');
    expect(la).toContain('await runCompositeSteps(kind, slot');
    expect(la).toContain("const unit = String(field.config?.unit || (isLA ? 'mL' : '%'))");
    expect(la).toContain('isLA && !readOnly && onRecalculateLA');
    expect(la).toContain('await openPhase(slot)');
    expect(la).toContain('item.matchesTarget ? item.areaCM2 : null');
    expect(la).toContain('onDelete={!readOnly && onDeleteContourSource');
    expect(la).toContain('Multiple contours for this phase');
    expect(panel).toContain('!selectedContourComposite && !showInlineIVCSources');
    expect(panel).toContain('!selectedContourComposite && !showGuidedIVCValue');
    expect(panel).toContain('const selectedContourComposite = selectedLA || selectedRVFAC');
    expect(panel).toContain('getResearchRVFACPhaseSources(');
    expect(panel).toContain("if (!selectedRVFAC || valueSourcesRef.current[key]?.source !== 'manual') return;");
    expect(panel).toContain("if (current[key]?.source !== 'manual') return current;");
    expect(panel).toContain('getResearchLAPhaseSources(');
    expect(panel).toContain('restoreResearchAnnotationSource(item, isCancelled)');
    expect(panel).toContain('onDeleteContourSource={annotation => void deleteResearchAnnotation(annotation)}');
    expect(panel).toContain('refreshViewerMeasurementBindings(undefined, selectedField.key)');
    expect(panel).toContain("field.key === explicitLAFieldKey && field.componentKey === 'laVolumeDisks'");
    expect(panel).not.toContain('saveViewerQuizResponseForActiveStudy');
  });
});

describe('Research TR Vmax uses shared Education presentation and guarded acquisition', () => {
  it('reuses source restoration and calibrated workflow without quiz capture or extra panel', () => {
    const guided = fs.readFileSync(path.resolve(__dirname,'../panels/ResearchEchoGuidedControls.tsx'),'utf8');
    const learning = fs.readFileSync(path.resolve(__dirname,'../../../extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'),'utf8');
    expect(learning).toContain('<SharedTRVmaxQuestionAnswer');
    expect(panel).toContain('<SharedTRVmaxQuestionAnswer');
    expect(guided).not.toContain("button('Measure TR Vmax'");
    expect(panel).toContain('!selectedTR && !selectedContourComposite');
    expect(panel).toContain('getResearchTRVmaxSourceState(');
    const nav = panel.slice(panel.indexOf('const navigateToField ='),panel.indexOf('const selectionGenerationRef'));
    expect(nav).toContain('return restoreResearchAnnotationSource(source, isCancelled)');
    expect(nav).toContain('isRequiredResearchPhaseMissing(field,');
    expect(nav).toContain('return target ? jumpToProtocolTarget(target, field.key) : true;');
    const run = panel.slice(panel.indexOf('const runFieldSelection ='),panel.indexOf('const selectField ='));
    expect(run).toContain("runCommand('startUltrasoundDirectionalWorkflow'");
    expect(run).toContain("preferredTargetKey: 'echo.trPeakVelocity'");
    expect(run).toContain('!editingAllowedRef.current');
    expect(run).toContain('isCancelled: () => isCancelled() || !editingAllowedRef.current');
    expect(run).not.toContain('quizCapture: true');
    expect(panel).toContain('deleteResearchAnnotation(trState.selected.annotation)');
    expect(panel).toContain('Resolve TR Vmax source');
  });
});

describe('Research IVC shares Education phase and RAP/RVSP controls', () => {
  it('renders compact verified phase rows and preserves guarded redraw and source ownership', () => {
    const guided=fs.readFileSync(path.resolve(__dirname,'../panels/ResearchEchoGuidedControls.tsx'),'utf8');
    const learning=fs.readFileSync(path.resolve(__dirname,'../../../extension-ar-learning/src/panels/CaseQuestionsPanel.tsx'),'utf8');
    const ivc=guided.slice(guided.lastIndexOf('kind="ivcCollapsibility"'));
    expect(ivc).toContain('<SharedEchoPhaseStatus');
    expect(ivc).toContain('item.matchesTarget ? item.diameterMM : null');
    expect(ivc).toContain('await openPhase(slot)');
    expect(ivc).toContain('onBeginIVCPhaseRedraw?.(field, slot, oldSources)');
    expect(ivc).toContain('<EchoCompositeResultCard>');
    expect(guided).not.toContain('View protocol frame ');
    expect(learning).toContain('<SharedIVCRapRVSPAnswer');
    expect(panel).toContain('<SharedIVCRapRVSPAnswer');
    expect(panel).toContain('getResearchRapChoices(rapField, readDomain)');
    expect(panel).toContain('getResearchTRVmaxSourceState(');
    expect(panel).toContain('const showGuidedIVCValue = showInlineIVCSources');
    expect(panel).toContain('completeIVC={guidedIVCValue != null}');
    expect(panel).toContain('updateValue(rapField.key, value)');
    expect(panel).toContain('onDeleteIVCSource={annotation => void deleteResearchAnnotation(annotation)}');
  });
});

describe('strict completed EF navigation uses the initialized Education target route', () => {
  it('waits for completed stack data and avoids reinitializing a matching stack', () => {
    const navigation = viewerCommands.slice(viewerCommands.indexOf('jumpToViewerQuizTarget: async'),
      viewerCommands.indexOf('clearViewerQuizMarkerOptions:', viewerCommands.indexOf('jumpToViewerQuizTarget: async')));
    expect(navigation).toContain('getReadySavedNavigationViewportId(viewportGridService, cornerstoneViewportService, true)');
    expect(navigation).toContain('displaySet?.displaySetInstanceUID && !reuseReadyStack');
    expect(navigation).toContain('if (!requireReadyViewport) await sleep(300)');
    expect(navigation.indexOf('await waitForSavedNavigationViewportData({'))
      .toBeLessThan(navigation.indexOf('await jumpViewportToViewerQuizTargetImage('));
    expect(navigation).not.toContain('resetCamera');
    expect(navigation).not.toContain('resetProperties');
  });
});
