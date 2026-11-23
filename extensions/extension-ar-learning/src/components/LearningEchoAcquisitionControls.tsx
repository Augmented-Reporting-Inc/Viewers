import React, { ReactNode } from 'react';
import { EchoContourTechniqueButtons } from '../../../extension-ar-measurements/src/components/EchoContourTechniqueButtons';

export type LearningEchoAcquisitionKind =
  'laVolumeDisks' | 'rvFac' | 'ivcCollapsibility';

const PHASES: Record<LearningEchoAcquisitionKind, Array<{ slot: string; label: string }>> = {
  laVolumeDisks: [
    { slot: 'A4C', label: 'Apical four-chamber' },
    { slot: 'A2C', label: 'Apical two-chamber' },
  ],
  rvFac: [
    { slot: 'RV_ED', label: 'End-diastolic area (RVEDA)' },
    { slot: 'RV_ES', label: 'End-systolic area (RVESA)' },
  ],
  ivcCollapsibility: [
    { slot: 'IVC_EXP', label: 'Measure expiration (IVCexp)' },
    { slot: 'IVC_INSP', label: 'Measure inspiration (IVCinsp)' },
  ],
};

/**
 * Existing Learning measurement controls, now shared with Research.
 * Source authority, DICOM-frame validation and capture commands are supplied
 * by the owning workflow. No quiz or Research APIs are accessed here.
 */
export function LearningEchoAcquisitionControls({
  kind,
  disabled = false,
  onAcquire,
  renderPhaseStatus,
  renderPhaseExtras,
  isPhaseBlocked,
  afterPhases,
}: {
  kind: LearningEchoAcquisitionKind;
  disabled?: boolean;
  onAcquire: (slot: string, technique?: 'freehand' | 'axisApex') => void;
  renderPhaseStatus?: (slot: string, label: string) => ReactNode;
  renderPhaseExtras?: (slot: string) => ReactNode;
  isPhaseBlocked?: (slot: string) => boolean;
  afterPhases?: ReactNode;
}) {
  const isIVC = kind === 'ivcCollapsibility';
  const heading = isIVC ? 'IVC phase measurements'
    : kind === 'rvFac' ? 'RV FAC contour technique'
    : 'LA volume contour technique';
  const description = isIVC
    ? 'Choose a phase below and draw the calibrated Length caliper. When prompted, label it IVCexp or IVCinsp respectively.'
    : kind === 'rvFac'
      ? 'For each area click the desired measuring tool to navigate to its image.'
      : 'For each apical view, click the desired measuring tool to navigate to its selected image. Freehand: click a mitral hinge, trace the LA cavity without holding the mouse, and finish at the opposite hinge. Axis + apex: draw the annular line and superior LA axis.';

  return (
    <div className={isIVC
      ? 'mt-2 rounded border border-cyan-700/70 p-2 text-xs'
      : 'mt-2 rounded border border-cyan-700 bg-cyan-950/20 p-2 text-xs'}>
      <div className="mb-1 font-semibold text-cyan-100">{heading}</div>
      <p className="mb-2 text-gray-300">{description}</p>
      <div className="space-y-2">
        {PHASES[kind].map(phase => {
          const blocked = disabled || !!isPhaseBlocked?.(phase.slot);
          return (
            <div key={phase.slot} className="flex flex-wrap items-center gap-2">
              {renderPhaseStatus?.(phase.slot, phase.label)}
              {isIVC ? (
                <button type="button"
                  disabled={blocked}
                  className="rounded border border-cyan-600 px-2 py-1 text-cyan-100 disabled:opacity-40"
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    onAcquire(phase.slot);
                  }}>
                  {phase.label}
                </button>
              ) : (
                <EchoContourTechniqueButtons
                  disabled={blocked}
                  onChoose={technique => onAcquire(phase.slot, technique)}
                />
              )}
              {renderPhaseExtras?.(phase.slot)}
            </div>
          );
        })}
      </div>
      {afterPhases}
    </div>
  );
}

export default LearningEchoAcquisitionControls;
