import React, { useState } from 'react';
import { getEchoCompositeAcquisitionSteps } from '../../../extension-ar-measurements/src/utils/echoCompositeAcquisition';
import { LearningEchoAcquisitionControls, SharedEchoPhaseStatus, SharedEchoRecalculateButton } from '../../../extension-ar-learning/src/components/LearningEchoAcquisitionControls';
import { EchoCompositeResultStatus, EchoCompositeResultCard } from '../../../extension-ar-measurements/src/components/EchoCompositeResultStatus';
import { SharedEFQuestionAnswer } from '../../../extension-ar-learning/src/components/SharedEFQuestionAnswer';
import {
  getResearchEchoPhases,
  getResearchEchoPhaseTarget,
  isRequiredResearchPhaseMissing,
  isUsableResearchTarget,
} from '../utils/researchEchoWorkflow';

/**
 * Uses the existing clinical/Education Echo viewer commands. This is only
 * orchestration and phase guidance; no duplicate drawing, calibration, or
 * calculation engines are created for Research.
 */
export default function ResearchEchoGuidedControls({
  field, commandsManager, disabled = false, readOnly = false, onError,
  sourceAnnotations = [], assessmentSavedEFAnnotations = null,
  assessmentSavedEFResult = null,
  ivcMeasurementState = null, ivcReadValue = null,
  efValue = '', onChangeEFValue, onDeleteEFValue,
  onBeginIVCPhaseRedraw, onViewIVCSource, onDeleteIVCSource,
  contourPhaseState = null, contourValue = null, contourManualValue = null, hasContourManualSource = false, onClearContourManualValue,
  onViewContourSource, onDeleteContourSource,
  onViewContourProtocolTarget, onRecalculateLA,
}: {
  field: any;
  commandsManager: any;
  disabled?: boolean;
  readOnly?: boolean;
  onError?: (message: string) => void;
  sourceAnnotations?: any[];
  assessmentSavedEFAnnotations?: any[] | null;
  assessmentSavedEFResult?: any;
  ivcMeasurementState?: any;
  ivcReadValue?: any;
  efValue?: string | number | null;
  onChangeEFValue?: (value: string) => void;
  onDeleteEFValue?: () => void;
  onBeginIVCPhaseRedraw?: (field: any, slot: string, existing: any[]) => void;
  onViewIVCSource?: (annotation: any) => void;
  onDeleteIVCSource?: (annotation: any) => void;
  contourPhaseState?: any;
  contourValue?: number | string | null;
  contourManualValue?: number | string | null;
  hasContourManualSource?: boolean;
  onClearContourManualValue?: () => void;
  onViewContourSource?: (item: any) => void;
  onDeleteContourSource?: (annotation: any) => void;
  onViewContourProtocolTarget?: (slot: string) => void;
  onRecalculateLA?: () => Promise<any>;
}) {
  const [busy, setBusy] = useState('');
  const kind = String(field?.componentKey || '');
  const phases = getResearchEchoPhases(field);
  const supported = ['lvEjectionFraction', 'laVolumeDisks', 'rvFac', 'ivcCollapsibility'].includes(kind);
  if (!supported || (!commandsManager && kind !== 'lvEjectionFraction')) return null;

  const notifyError = (message: string) => onError?.(message);
  const command = async (name: string, payload: any = {}) => {
    const result = await commandsManager.runCommand(name, payload);
    if (result?.ok === false) throw new Error(result?.reason || name + ' failed');
    return result;
  };
  const runCompositeSteps = async (
    measurementKind: 'laVolumeDisks' | 'rvFac' | 'ivcCollapsibility',
    slot: string, technique: 'freehand' | 'axisApex' = 'freehand'
  ) => {
    const steps = getEchoCompositeAcquisitionSteps(measurementKind, slot, technique);
    if (!steps.length) throw new Error('Unsupported configured Echo measurement phase.');
    for (const step of steps) await command(step.name, step.payload);
  };
  const openPhase = async (slot: string) => {
    const target = getResearchEchoPhaseTarget(field, slot);
    if (isRequiredResearchPhaseMissing(field, slot)) {
      throw new Error('This protocol requires a fixed ' + slot + ' source frame; the Research Manager has not configured it.');
    }
    if (target && !isUsableResearchTarget(target)) {
      throw new Error('The configured ' + (slot || 'measurement') + ' frame is incomplete.');
    }
    if (target) {
      try {
        const result = await command('jumpToViewerQuizTarget', {
          viewerTarget: target, questionKey: field.key,
          requireExactSopFrame: true,
          pauseCineOnTarget: true,
        });
        if (result?.ok !== true) {
          throw new Error(result?.reason || 'navigation did not complete');
        }
      } catch (error) {
        // Never activate a measuring tool on a different, currently visible
        // instance/frame when the fixed source could not be reached.
        throw new Error(
          'Could not open the configured ' + (slot || 'measurement') +
          ' source frame (' + (error?.message || 'navigation failed') + ').'
        );
      }
    }
  };
  const run = async (key: string, action: () => Promise<any>) => {
    if (disabled || readOnly || busy) return;
    setBusy(key);
    try {
      await action();
    } catch (error) {
      console.warn('[AR Research] guided Echo measurement failed', error);
      notifyError(error?.message || 'Unable to activate this measurement.');
    } finally {
      setBusy('');
    }
  };
  const button = (label: string, key: string, action: () => Promise<any>, blocked = false) => (
    <button
      type="button" disabled={disabled || readOnly || !!busy || blocked}
      className="rounded border border-cyan-600 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-950/40 disabled:opacity-40"
      onClick={() => void run(key, action)}
    >{busy === key ? 'Opening…' : label}</button>
  );
  const viewTarget = (slot: string) => {
    const target = getResearchEchoPhaseTarget(field, slot);
    return target && isUsableResearchTarget(target)
      ? button('View protocol frame ' + target.frameNumber, 'view:' + slot, () => openPhase(slot))
      : null;
  };
  const hasIncompleteRequiredEF = kind === 'lvEjectionFraction' &&
    phases.some(phase => isRequiredResearchPhaseMissing(field, phase.slot));

  if (kind === 'lvEjectionFraction') {
    return (
      <div className="space-y-2">
        <SharedEFQuestionAnswer
          value={efValue}
          onChange={onChangeEFValue || (() => {})}
          onDelete={!disabled && !readOnly && efValue !== null &&
            efValue !== undefined && String(efValue).trim() !== ''
              ? onDeleteEFValue : undefined}
          unit={String(field?.config?.unit || '%')}
          min={field?.config?.min}
          max={field?.config?.max}
          step="0.01"
          disabled={disabled || readOnly || !onChangeEFValue}
          openDisabled={hasIncompleteRequiredEF || !commandsManager}
          busy={busy === 'ef'}
          onOpen={() => void run('ef', async () => {
            if (hasIncompleteRequiredEF) {
              throw new Error('Configure all four EF frames in Research Manager before opening the guided protocol.');
            }
            // Preserve Research-owned source evidence. The existing EF panel
            // remains responsible for contours, volumes, DICOM targets, and EF.
            const seen = new Set<string>();
            // Shared EF owns Review-provided restoration. Do not navigate/
            // hydrate those same annotations twice in the Research wrapper.
            for (const annotation of Array.isArray(assessmentSavedEFAnnotations)
              ? [] : sourceAnnotations) {
              const id = String(annotation?.annotationId || annotation?.uid || annotation?.id || '');
              if (!id || seen.has(id)) continue;
              seen.add(id);
              await command('jumpToSavedViewerAnnotation', {
                annotation, selectAnnotation: false,
              });
            }
            return command('startLVSimpsonEFWorkflow', {
              efContourTargets: field.config?.compositeFrameTargets || null,
              allowCanonicalFrameTargets: true,
              assessmentSavedEFAnnotations,
              assessmentSavedEFResult,
              deferSavedEFRestoration: true,
              notifyAssessmentOnCalculate: true,
              questionKey: field.key,
            });
          })}
        />
        {hasIncompleteRequiredEF ? (
          <div role="alert" className="text-xs text-amber-200">
            The Research protocol requires all four configured EF source frames
            before measurement can begin.
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === 'laVolumeDisks' || kind === 'rvFac') {
    const isLA = kind === 'laVolumeDisks';
    const unit = String(field.config?.unit || (isLA ? 'mL' : '%'));
    return (
      <div className="mt-2 w-full min-w-0 max-w-full space-y-2 overflow-hidden">
        <LearningEchoAcquisitionControls
          kind={kind}
          disabled={disabled || readOnly || !!busy}
          isPhaseBlocked={slot => isRequiredResearchPhaseMissing(field, slot)}
          onAcquire={(slot, technique) => void run(slot + ':' + technique, async () => {
            await openPhase(slot);
            await runCompositeSteps(kind, slot, technique || 'freehand');
          })}
          renderPhaseStatus={(slot, label) => {
            const sources = contourPhaseState?.phaseSources?.[slot] || [];
            const target = getResearchEchoPhaseTarget(field, slot);
            if (!sources.length) return (
              <SharedEchoPhaseStatus slot={slot} label={label} value={null}
                disabled={disabled || readOnly}
                onNavigate={target && isUsableResearchTarget(target) && onViewContourProtocolTarget
                  ? () => onViewContourProtocolTarget(slot) : undefined} />
            );
            return sources.map((item: any, index: number) => (
              <React.Fragment key={String(item.annotation.annotationId ||
                item.annotation.annotationUID || item.annotation.uid || item.annotation.id)}>
                <SharedEchoPhaseStatus slot={slot}
                  label={sources.length > 1 ? label + ' (' + (index + 1) + ')' : label}
                  value={item.matchesTarget ? item.areaCM2 : null}
                  unit="cm²" hasSavedSource
                  disabled={disabled || readOnly || !!busy}
                  onNavigate={onViewContourSource ? () => onViewContourSource(item) : undefined}
                  onDelete={!readOnly && onDeleteContourSource
                    ? () => onDeleteContourSource(item.annotation) : undefined} />
                {!item.matchesTarget ? (
                  <span className="text-amber-200">Outside the configured phase frame</span>
                ) : null}
              </React.Fragment>
            ));
          }}
          renderPhaseExtras={slot => (
            <>
              {isRequiredResearchPhaseMissing(field, slot) ? (
                <span className="text-amber-300">Missing required protocol frame</span>
              ) : null}
              {(contourPhaseState?.phaseSources?.[slot]?.length || 0) > 1 ? (
                <span className="text-amber-200">Multiple contours for this phase. Inspect and delete extras.</span>
              ) : null}
            </>
          )}
        />
        {contourPhaseState?.unresolvedCount ? (
          <div role="alert" className="text-xs text-amber-200">
            Some {isLA ? 'LA' : 'RV'} source annotations cannot be verified for this study. Review their source identity before {isLA ? 'recalculating' : 'continuing'}.
          </div>
        ) : null}
        <EchoCompositeResultCard>
          <EchoCompositeResultStatus value={contourValue}
            unit={unit}
            label={readOnly ? 'Saved answer' : 'Calculated'}
            unavailableMessage="Complete the required calibrated measurements in the same study." />
        </EchoCompositeResultCard>
        {(contourManualValue != null && String(contourManualValue).trim() !== '') ||
          (!isLA && hasContourManualSource && !readOnly) ? (
          <EchoCompositeResultCard warning>
            {contourManualValue != null && String(contourManualValue).trim() !== '' ? (
              <EchoCompositeResultStatus value={contourManualValue}
                unit={unit} label="Saved manual answer" />
            ) : <div className="text-amber-200">Manual answer mode</div>}
            <p className="mt-1 text-amber-200">
              This value is not linked to calibrated contours.
              {isLA ? 'Recalculate to replace it with a verified result.'
                : 'Clear the manual answer to enable automatic calculation from verified contours.'}
            </p>
            {!readOnly && onClearContourManualValue ? (
              <button type="button" disabled={disabled || !!busy}
                className="mt-1 text-red-200 hover:underline disabled:opacity-40"
                onClick={onClearContourManualValue}>Clear manual answer</button>
            ) : null}
          </EchoCompositeResultCard>
        ) : null}
        {isLA && !readOnly && onRecalculateLA ? (
          <SharedEchoRecalculateButton disabled={disabled || !!busy}
            busy={busy === 'la-recalculate'}
            onRecalculate={() => void run('la-recalculate', onRecalculateLA)} />
        ) : null}
        {!readOnly && (contourValue == null || String(contourValue).trim() === '') ? (
          <div className="text-xs text-gray-400">
            Draw or select a measurement annotation in the viewport.
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded border border-cyan-700/70 bg-cyan-950/10 p-3 text-xs text-gray-200">
      <div className="font-semibold text-cyan-100">Guided Echo measurement</div>
        <LearningEchoAcquisitionControls
          kind="ivcCollapsibility"
          disabled={disabled || readOnly || !!busy}
          isPhaseBlocked={slot => isRequiredResearchPhaseMissing(field, slot)}
          renderPhaseStatus={(slot, label) => {
            const diameter = slot === 'IVC_EXP'
              ? ivcMeasurementState?.values?.expirationDiameterMM
              : ivcMeasurementState?.values?.inspirationDiameterMM;
            return (
              <span className="min-w-36 text-gray-100">
                {label + ' · ' + (diameter != null && Number.isFinite(Number(diameter))
                  ? Number(diameter).toFixed(1) + ' mm' : 'No calibrated diameter')}
              </span>
            );
          }}
          onAcquire={(slot, technique) => void run(
            slot + ':' + (technique || 'length'), async () => {
              await openPhase(slot);
              await runCompositeSteps('ivcCollapsibility', slot, technique || 'freehand');
              const oldSources = ivcMeasurementState?.phaseSources?.[slot] || [];
              onBeginIVCPhaseRedraw?.(field, slot, oldSources);
            }
          )}
          renderPhaseExtras={slot => {
            const blocked = isRequiredResearchPhaseMissing(field, slot);
            const phaseSources = ivcMeasurementState?.phaseSources?.[slot] || [];
            return (
              <>
                {!blocked ? viewTarget(slot) : (
                  <span className="text-amber-300">Missing required protocol frame</span>
                )}
                {phaseSources.map((annotation: any, index: number) => (
                  <span key={String(annotation?.annotationId || annotation?.uid || index)}
                    className="inline-flex flex-wrap items-center gap-2 rounded border border-gray-700 px-2 py-1">
                    <button type="button" className="text-cyan-200 hover:underline"
                      disabled={!onViewIVCSource}
                      onClick={() => onViewIVCSource?.(annotation)}>View source</button>
                    {!disabled && !readOnly ? (
                      <button type="button" className="text-red-300 hover:underline"
                        disabled={!onDeleteIVCSource}
                        onClick={() => onDeleteIVCSource?.(annotation)}>Delete</button>
                    ) : null}
                  </span>
                ))}
                {phaseSources.length > 1 ? (
                  <span className="text-amber-200">
                    Multiple measurements for this phase. Delete extras or redraw.
                  </span>
                ) : null}
                {!blocked && !getResearchEchoPhaseTarget(field, slot) ? (
                  <span className="text-gray-400">
                    No fixed frame for this phase — uses the current viewer image
                  </span>
                ) : null}
              </>
            );
          }}
          afterPhases={(
            <div className="border-t border-gray-700 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-gray-100">Calculated IVC collapsibility</span>
                <span className="font-semibold text-cyan-100">
                  {ivcMeasurementState?.candidate &&
                    ivcReadValue !== null && ivcReadValue !== undefined &&
                    String(ivcReadValue).trim() !== '' &&
                    Number.isFinite(Number(ivcReadValue))
                    ? Number(ivcReadValue).toFixed(1) + '%'
                    : 'Not yet calculated'}
                </span>
              </div>
              {!ivcMeasurementState?.candidate ? (
                <p className="mt-1 text-amber-200">
                  {ivcMeasurementState?.message ||
                    'Draw both calibrated IVC measurements on the assigned frames.'}
                </p>
              ) : (
                <p className="mt-1 text-gray-400">
                  Derived from the two calibrated diameters on their configured DICOM frames.
                </p>
              )}
            </div>
          )}
        />
    </div>
  );
}
