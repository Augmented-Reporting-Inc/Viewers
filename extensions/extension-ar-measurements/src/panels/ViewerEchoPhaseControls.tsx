import React from 'react';

export type ViewerEchoPhaseKind =
  | 'laVolumeBiplane'
  | 'laVolumeBiplaneDisks'
  | 'rvFAC'
  | 'ivcCollapsibility';

type Action = 'freehand' | 'axisApex' | 'length';
type Phase = { slot: string; label: string };

const ECHO_PHASE_CONFIG: Record<ViewerEchoPhaseKind, {
  title: string;
  guidance: string;
  phases: Phase[];
  actions: { key: Action; label: string }[];
}> = {
  laVolumeBiplane: {
    title: 'LA volume contour technique',
    guidance: 'For each apical view, click the desired measuring tool to navigate to its selected image. Freehand: click a mitral hinge, trace the LA cavity without holding the mouse, and finish at the opposite hinge. Axis + apex: draw the annular line and superior LA axis.',
    phases: [{ slot: 'A4C', label: 'Apical four-chamber' }, { slot: 'A2C', label: 'Apical two-chamber' }],
    actions: [{ key: 'freehand', label: 'Freehand' }, { key: 'axisApex', label: 'Axis + apex' }],
  },
  laVolumeBiplaneDisks: {
    title: 'LA volume contour technique',
    guidance: 'For each apical view, click the desired measuring tool to navigate to its selected image. Freehand: click a mitral hinge, trace the LA cavity without holding the mouse, and finish at the opposite hinge. Axis + apex: draw the annular line and superior LA axis.',
    phases: [{ slot: 'A4C', label: 'Apical four-chamber' }, { slot: 'A2C', label: 'Apical two-chamber' }],
    actions: [{ key: 'freehand', label: 'Freehand' }, { key: 'axisApex', label: 'Axis + apex' }],
  },
  rvFAC: {
    title: 'RV FAC contour technique',
    guidance: 'For each area click the desired measuring tool to navigate to its image.',
    phases: [{ slot: 'RV_ED', label: 'End-diastolic area (RVEDA)' }, { slot: 'RV_ES', label: 'End-systolic area (RVESA)' }],
    actions: [{ key: 'freehand', label: 'Freehand' }, { key: 'axisApex', label: 'Axis + apex' }],
  },
  ivcCollapsibility: {
    title: 'IVC phase measurements',
    guidance: 'Choose a phase below and draw the calibrated Length caliper. When prompted, label it IVCexp or IVCinsp respectively.',
    phases: [{ slot: 'IVC_EXP', label: 'IVCexp' }, { slot: 'IVC_INSP', label: 'IVCinsp' }],
    actions: [{ key: 'length', label: 'Measure' }],
  },
};

export function getViewerEchoPhaseSlots(kind: ViewerEchoPhaseKind): string[] {
  return (ECHO_PHASE_CONFIG[kind]?.phases || []).map(phase => phase.slot);
}

/**
 * Same visual controls for Education learner questions and Research reads.
 * Only the caller decides what a phase button does after selection:
 * navigation, authorization, annotation deletion and writes stay with the
 * owning workflow.
 */
export default function ViewerEchoPhaseControls({
  kind,
  disabled = false,
  blockedPhase,
  renderPhaseStatus,
  renderPhaseTrailing,
  onCapture,
}: {
  kind: ViewerEchoPhaseKind;
  disabled?: boolean;
  blockedPhase?: (slot: string) => boolean;
  renderPhaseStatus?: (slot: string, label: string) => React.ReactNode;
  renderPhaseTrailing?: (slot: string) => React.ReactNode;
  onCapture: (slot: string, action: Action) => void | Promise<void>;
}) {
  const definition = ECHO_PHASE_CONFIG[kind];
  if (!definition) return null;

  return (
    <div className="mt-2 rounded border border-cyan-700 bg-cyan-950/20 p-2 text-xs">
      <div className="mb-1 font-semibold text-cyan-100">{definition.title}</div>
      <p className="mb-2 text-gray-300">{definition.guidance}</p>
      <div className="space-y-2">
        {definition.phases.map(phase => (
          <div key={phase.slot} className="flex flex-wrap items-center gap-2">
            {renderPhaseStatus?.(phase.slot, phase.label)}
            {definition.actions.map(action => (
              <button
                key={action.key}
                type="button"
                disabled={disabled || blockedPhase?.(phase.slot) === true}
                className="rounded border border-cyan-600 px-2 py-1 text-cyan-100 disabled:opacity-40"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onCapture(phase.slot, action.key);
                }}
              >
                {action.key === 'length' ? `${action.label} ${phase.label}` : action.label}
              </button>
            ))}
            {renderPhaseTrailing?.(phase.slot)}
          </div>
        ))}
      </div>
    </div>
  );
}
