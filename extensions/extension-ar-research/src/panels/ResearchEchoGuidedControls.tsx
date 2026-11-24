import React, { useState } from 'react';
import { getEchoCompositeAcquisitionSteps } from '../../../extension-ar-measurements/src/utils/echoCompositeAcquisition';
import { LearningEchoAcquisitionControls } from '../../../extension-ar-learning/src/components/LearningEchoAcquisitionControls';
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
  sourceAnnotations = [], ivcMeasurementState = null, ivcReadValue = null,
  efValue = '', onChangeEFValue, onDeleteEFValue,
  onBeginIVCPhaseRedraw, onViewIVCSource, onDeleteIVCSource,
}: {
  field: any;
  commandsManager: any;
  disabled?: boolean;
  readOnly?: boolean;
  onError?: (message: string) => void;
  sourceAnnotations?: any[];
  ivcMeasurementState?: any;
  ivcReadValue?: any;
  efValue?: string | number | null;
  onChangeEFValue?: (value: string) => void;
  onDeleteEFValue?: () => void;
  onBeginIVCPhaseRedraw?: (field: any, slot: string, existing: any[]) => void;
  onViewIVCSource?: (annotation: any) => void;
  onDeleteIVCSource?: (annotation: any) => void;
}) {
  const [busy, setBusy] = useState('');
  const kind = String(field?.componentKey || '');
  const phases = getResearchEchoPhases(field);
  const supported = ['lvEjectionFraction', 'laVolumeDisks', 'rvFac', 'ivcCollapsibility', 'trVmax'].includes(kind);
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
            for (const annotation of sourceAnnotations) {
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

  return (
    <div className="rounded border border-cyan-700/70 bg-cyan-950/10 p-3 text-xs text-gray-200">
      <div className="font-semibold text-cyan-100">Guided Echo measurement</div>
      {kind === 'trVmax' ? (
        <div className="mt-2 space-y-2">
          <p>Use the calibrated TR spectral Doppler Vmax tool. The stored value is
            converted to m/s and linked to its source annotation.</p>
          <div className="flex flex-wrap gap-2">
            {button('Measure TR Vmax', 'tr', async () => {
              await openPhase('');
              await command('startUltrasoundDirectionalWorkflow', {
                spectralVmax: true, preferredTargetKey: 'echo.trPeakVelocity',
              });
            })}
            {viewTarget('')}
          </div>
        </div>
      ) : (
        <LearningEchoAcquisitionControls
          kind={kind === 'laVolumeDisks' ? 'laVolumeDisks'
            : kind === 'rvFac' ? 'rvFac' : 'ivcCollapsibility'}
          disabled={disabled || readOnly || !!busy}
          isPhaseBlocked={slot => isRequiredResearchPhaseMissing(field, slot)}
          renderPhaseStatus={(slot, label) => {
            const diameter = kind === 'ivcCollapsibility'
              ? (slot === 'IVC_EXP'
                  ? ivcMeasurementState?.values?.expirationDiameterMM
                  : ivcMeasurementState?.values?.inspirationDiameterMM)
              : null;
            return (
              <span className="min-w-36 text-gray-100">
                {kind === 'ivcCollapsibility'
                  ? label + ' · ' + (diameter != null && Number.isFinite(Number(diameter))
                    ? Number(diameter).toFixed(1) + ' mm'
                    : 'No calibrated diameter')
                  : label}
              </span>
            );
          }}
          onAcquire={(slot, technique) => void run(
            slot + ':' + (technique || 'length'), async () => {
              await openPhase(slot);
              const acquisitionKind = kind === 'laVolumeDisks' ? 'laVolumeDisks'
                : kind === 'rvFac' ? 'rvFac' : 'ivcCollapsibility';
              await runCompositeSteps(acquisitionKind, slot, technique || 'freehand');
              if (kind === 'ivcCollapsibility') {
                const oldSources = ivcMeasurementState?.phaseSources?.[slot] || [];
                onBeginIVCPhaseRedraw?.(field, slot, oldSources);
              }
            }
          )}
          renderPhaseExtras={slot => {
            const blocked = isRequiredResearchPhaseMissing(field, slot);
            const phaseSources = kind === 'ivcCollapsibility'
              ? ivcMeasurementState?.phaseSources?.[slot] || [] : [];
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
          afterPhases={kind === 'ivcCollapsibility' ? (
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
          ) : null}
        />
      )}
    </div>
  );
}
