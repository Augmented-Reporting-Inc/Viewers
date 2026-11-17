/**
 * Resolve protocol-wide ReadSchema definitions to the exact DICOM case being
 * read. A single fixed SOP/frame must NEVER silently apply to another study.
 * The Research Manager stores captures under
 * component.config.caseFrameTargets[StudyInstanceUID].
 */
const cleanString = (value: unknown) => String(value ?? '').trim();

function targetMatchesStudy(target: any, sourceStudyInstanceUID: string) {
  const explicit = cleanString(target?.studyInstanceUID || target?.StudyInstanceUID);
  return !explicit || explicit === sourceStudyInstanceUID;
}

export function resolveResearchCaseFrameConfig(
  config: any = {}, sourceStudyInstanceUID: string
) {
  const next = { ...(config || {}) };
  const source = cleanString(sourceStudyInstanceUID);
  const caseFrames = Array.isArray(next.caseFrameTargets)
    ? next.caseFrameTargets : [];
  const anyCaseTargets = caseFrames.length > 0;
  if (!source) {
    // Cannot safely choose a case-scoped frame when the review identity is
    // missing. Do not default to the first case.
    delete next.viewerTarget;
    delete next.compositeFrameTargets;
    return next;
  }
  const current = caseFrames.find(item =>
    cleanString(item?.studyInstanceUID) === source
  );

  // A named case-scoped target always takes precedence over legacy globals.
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    delete next.viewerTarget;
    delete next.compositeFrameTargets;
    if (current.viewerTarget) next.viewerTarget = current.viewerTarget;
    if (current.compositeFrameTargets) {
      next.compositeFrameTargets = current.compositeFrameTargets;
    }
    return next;
  }

  // If the component has any case-scoped targets, do not reuse a different
  // case's global fallback for an unmatched study.
  if (anyCaseTargets) {
    delete next.viewerTarget;
    delete next.compositeFrameTargets;
    return next;
  }

  if (!targetMatchesStudy(next.viewerTarget, source)) delete next.viewerTarget;
  const globalPhases = next.compositeFrameTargets || {};
  next.compositeFrameTargets = Object.fromEntries(
    Object.entries(globalPhases).filter(([, target]) =>
      targetMatchesStudy(target, source)
    )
  );
  if (!Object.keys(next.compositeFrameTargets).length) {
    delete next.compositeFrameTargets;
  }
  return next;
}

export function resolveResearchCaseReadSchema(
  readSchema: any = {}, sourceStudyInstanceUID: string
) {
  return {
    ...readSchema,
    components: (Array.isArray(readSchema?.components)
      ? readSchema.components : [])
      .map((component: any) => ({
        ...component,
        config: resolveResearchCaseFrameConfig(
          component?.config || {}, sourceStudyInstanceUID
        ),
      })),
  };
}
