/**
 * Presentation-only decisions for an education learner's measurement review.
 *
 * These never authorize a save or substitute for FormAPI's preview,
 * existing learner-copy annotations, exact DICOM sources, or post-save
 * response readback. Non-report-owned workflows do not call these helpers.
 */

export type LearnerQuizSaveAction = 'draft' | 'submitted';

export type LearnerHemodynamicReviewRow = {
  key: string;
  label: string;
  display: string;
  recorded: boolean;
};

const QUIZ_HEMODYNAMIC_FIELDS = {
  'quiz-tr': { name: 'TRVel', unit: 'm/s' },
  'quiz-rap': { name: 'RASP', unit: 'mmHg' },
  'quiz-rvsp': { name: 'RVSP', unit: 'mmHg' },
} as const;

function rowField(row: LearnerHemodynamicReviewRow) {
  const kind = String(row?.key || '').split(':')[0] as keyof typeof QUIZ_HEMODYNAMIC_FIELDS;
  return QUIZ_HEMODYNAMIC_FIELDS[kind] || null;
}

/**
 * An unchanged viewer annotation snapshot alone is insufficient: an edited
 * RAP selection can alter report transfer without touching a caliper.
 * Require every recorded quiz hemodynamic result AND its unit to equal the
 * already-persisted learner Series field before omitting the submit dialog.
 */
export function isLearnerHemodynamicReviewRowPersisted(
  row: LearnerHemodynamicReviewRow,
  savedSeries: any
): boolean {
  const field = rowField(row);
  if (!row?.recorded || !field || savedSeries?.isLearnerCopy !== true) {
    return false;
  }
  const actual = savedSeries[field.name];
  const raw = String(actual == null ? '' : actual).trim();
  const expected = Number.parseFloat(String(row.display || ''));
  const stored = Number(raw);
  return raw !== '' && Number.isFinite(expected) && Number.isFinite(stored) &&
    Math.abs(expected - stored) <= 0.01 &&
    String(savedSeries[field.name + 'UOM'] || '').trim().toLowerCase() ===
      field.unit.toLowerCase();
}

export function shouldSkipUnchangedLearnerSubmitMeasurementReview({
  saveAction,
  preview,
  reportRows,
  quizEvidenceRows,
}: {
  saveAction: LearnerQuizSaveAction;
  preview: any;
  reportRows: any[];
  quizEvidenceRows: LearnerHemodynamicReviewRow[];
}): boolean {
  // Missing/uncertain preview data must continue through the existing review
  // or fail-closed FormAPI verification. Never skip an initial unsaved attempt.
  if (
    saveAction !== 'submitted' ||
    preview?.measurementAnnotationsChanged !== false ||
    preview?.seriesDoc?.isLearnerCopy !== true ||
    !Array.isArray(preview?.annotations) ||
    preview.annotations.length === 0 ||
    !Array.isArray(reportRows) || reportRows.length > 0 ||
    !Array.isArray(quizEvidenceRows)
  ) return false;

  return quizEvidenceRows.every(row =>
    isLearnerHemodynamicReviewRowPersisted(row, preview.seriesDoc)
  );
}

/**
 * On a changed Submit, the modal should describe updates, not relist unchanged
 * TR/RAP/RVSP quiz results from the last saved draft. Keep any row with a
 * changed source or changed/missing persisted report value.
 */
export function getUpdatedLearnerHemodynamicReviewRows({
  saveAction,
  preview,
  quizEvidenceRows,
  evidence,
}: {
  saveAction: LearnerQuizSaveAction;
  preview: any;
  quizEvidenceRows: LearnerHemodynamicReviewRow[];
  evidence: any;
}): LearnerHemodynamicReviewRow[] {
  if (saveAction !== 'submitted' || preview?.seriesDoc?.isLearnerCopy !== true ||
      !Array.isArray(preview?.reviewOnlyChangedAnnotationIds)) {
    return quizEvidenceRows;
  }

  const changedIds = new Set(preview.reviewOnlyChangedAnnotationIds
    .map((id: any) => String(id || '').trim()).filter(Boolean));
  const trSourceChanged = changedIds.has(
    String(evidence?.trVmax?.sourceAnnotationId || '').trim()
  );
  const ivcSources = evidence?.ivc?.compositeResult?.components;
  const ivcSourceChanged = Array.isArray(ivcSources) && ivcSources.some(
    (part: any) => changedIds.has(String(part?.annotationId || '').trim())
  );

  return quizEvidenceRows.filter(row => {
    const kind = String(row?.key || '').split(':')[0];
    if (!row.recorded ||
        !isLearnerHemodynamicReviewRowPersisted(row, preview.seriesDoc)) return true;
    if (kind === 'quiz-tr') return trSourceChanged;
    if (kind === 'quiz-rap') return ivcSourceChanged;
    if (kind === 'quiz-rvsp') return trSourceChanged || ivcSourceChanged;
    return true;
  });
}

/** Separate text activity from the shared disable/busy state of both buttons. */
export function getLearnerQuizSaveButtonLabels({
  quizSaving = false,
  savingAction = null,
  deferredReportScoring = false,
}: {
  quizSaving?: boolean;
  savingAction?: LearnerQuizSaveAction | null;
  deferredReportScoring?: boolean;
} = {}) {
  return {
    draft: quizSaving && savingAction === 'draft' ? 'Saving…' : 'Save Draft',
    submit: quizSaving && savingAction === 'submitted'
      ? 'Submitting…'
      : deferredReportScoring ? 'Submit answers' : 'Submit Quiz',
  };
}
