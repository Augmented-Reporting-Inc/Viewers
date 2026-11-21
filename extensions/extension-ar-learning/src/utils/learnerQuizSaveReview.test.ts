import {
  getLearnerQuizSaveButtonLabels,
  getUpdatedLearnerHemodynamicReviewRows,
  isLearnerHemodynamicReviewRowPersisted,
  shouldSkipUnchangedLearnerSubmitMeasurementReview,
} from './learnerQuizSaveReview';

const rows = [
  { key: 'quiz-tr:q1', label: 'TR Vmax', display: '2.52 m/s (source-linked)', recorded: true },
  { key: 'quiz-rap:q2', label: 'RAP', display: '15 mmHg', recorded: true },
  { key: 'quiz-rvsp:q2', label: 'RVSP', display: '40.40 mmHg', recorded: true },
];
const series = {
  isLearnerCopy: true, TRVel: '2.52', TRVelUOM: 'm/s',
  RASP: '15', RASPUOM: 'mmHg', RVSP: '40.4', RVSPUOM: 'mmHg',
};
const preview = {
  previewOnly: true, isClinicalReportSave: true,
  measurementAnnotationsChanged: false,
  annotations: [{ annotationId: 'saved-length', toolName: 'Length' }],
  seriesDoc: series, reviewOnlyChangedAnnotationIds: [],
};

describe('learner reporting Save Draft / Submit confirmation', () => {
  const shouldSkip = (p: any = preview, r: any[] = rows, action: 'draft' | 'submitted' = 'submitted',
    reportRows: any[] = [], hasSavedQuizDraft = true) =>
    shouldSkipUnchangedLearnerSubmitMeasurementReview({
      saveAction: action, hasSavedQuizDraft, preview: p, reportRows, quizEvidenceRows: r,
    });

  it('shows the full initial Save Draft review, even when a source was previously saved', () => {
    expect(shouldSkip(preview, rows, 'draft')).toBe(false);
    expect(shouldSkip({
      ...preview, measurementAnnotationsChanged: true, annotations: [],
      seriesDoc: { isLearnerCopy: true },
    }, rows)).toBe(false);
  });

  it('skips only redundant Submit after a verified unchanged learner-copy draft', () => {
    expect(rows.every(row => isLearnerHemodynamicReviewRowPersisted(row, series))).toBe(true);
    expect(shouldSkip()).toBe(true);
    // A learner who goes straight to Submit without first saving the quiz
    // must still review all measurements, even when Series values happen to match.
    expect(shouldSkip(preview, rows, 'submitted', [], false)).toBe(false);
  });

  it('reopens review for new or edited source annotations or a pending report update', () => {
    expect(shouldSkip({ ...preview, measurementAnnotationsChanged: true })).toBe(false);
    expect(shouldSkip(preview, rows, 'submitted', [{ key: 'RVSP', changed: true }])).toBe(false);
  });

  it('reopens review if learner selected a new RAP or recalculated RVSP without a caliper edit', () => {
    expect(shouldSkip(preview, [
      rows[0], { ...rows[1], display: '8 mmHg' },
      { ...rows[2], display: '33.40 mmHg' },
    ])).toBe(false);
    expect(shouldSkip({ ...preview, seriesDoc: { ...series, RVSP: '33.4' } })).toBe(false);
  });

  it('requires saved units and does not trust a missing/empty report field', () => {
    expect(shouldSkip({ ...preview, seriesDoc: { ...series, RVSPUOM: '' } })).toBe(false);
    expect(shouldSkip({ ...preview, seriesDoc: { ...series, RASP: '' } })).toBe(false);
    expect(shouldSkip({ ...preview, seriesDoc: { ...series, TRVelUOM: 'cm/s' } })).toBe(false);
    expect(shouldSkip({ ...preview, seriesDoc: { ...series, isLearnerCopy: false } })).toBe(false);
  });

  it('fails closed on unavailable, unrecorded, or incomplete persisted measurement evidence', () => {
    expect(shouldSkip({ ...preview, annotations: [] })).toBe(false);
    expect(shouldSkip({ ...preview, measurementAnnotationsChanged: undefined })).toBe(false);
    expect(shouldSkip({ ...preview, seriesDoc: null })).toBe(false);
    expect(shouldSkip(preview, [{ ...rows[0], recorded: false }, ...rows.slice(1)])).toBe(false);
    expect(shouldSkip(preview, [{ key: 'unknown', display: '1.2', recorded: true }])).toBe(false);
  });

  it('can skip a source-only guided EF submit with no hemodynamic questions, provided persisted sources are verified', () => {
    expect(shouldSkip(preview, [])).toBe(true);
    expect(shouldSkip({ ...preview, annotations: [] }, [])).toBe(false);
  });

  it('shows only changed linked hemodynamic values on a changed Submit', () => {
    expect(getUpdatedLearnerHemodynamicReviewRows({
      saveAction: 'submitted',
      preview: { ...preview, measurementAnnotationsChanged: true, reviewOnlyChangedAnnotationIds: ['other-EF'] },
      quizEvidenceRows: rows,
      evidence: { trVmax: { sourceAnnotationId: 'tr' }, ivc: { compositeResult: {
        components: [{ annotationId: 'exp' }, { annotationId: 'insp' }],
      } } },
    })).toEqual([]);

    const input = {
      saveAction: 'submitted' as const,
      preview: { ...preview, measurementAnnotationsChanged: true, reviewOnlyChangedAnnotationIds: ['exp'] },
      quizEvidenceRows: rows,
      evidence: { trVmax: { sourceAnnotationId: 'tr' }, ivc: { compositeResult: {
        components: [{ annotationId: 'exp' }, { annotationId: 'insp' }],
      } } },
    };
    expect(getUpdatedLearnerHemodynamicReviewRows(input).map(row => row.key))
      .toEqual(['quiz-rap:q2', 'quiz-rvsp:q2']);
    expect(getUpdatedLearnerHemodynamicReviewRows({
      ...input, preview: { ...input.preview, reviewOnlyChangedAnnotationIds: ['tr'] },
    }).map(row => row.key)).toEqual(['quiz-tr:q1', 'quiz-rvsp:q2']);
  });

  it('does not filter evidence on Save Draft or when change-marker data is missing', () => {
    const input = { saveAction: 'draft' as const, preview, quizEvidenceRows: rows, evidence: {} };
    expect(getUpdatedLearnerHemodynamicReviewRows(input)).toEqual(rows);
    expect(getUpdatedLearnerHemodynamicReviewRows({
      ...input, saveAction: 'submitted', preview: { ...preview, reviewOnlyChangedAnnotationIds: undefined },
    })).toEqual(rows);
  });
});

describe('per-button learner save activity', () => {
  it('shows Saving only on Save Draft, keeping Submit labelled normally', () => {
    expect(getLearnerQuizSaveButtonLabels({
      quizSaving: true, savingAction: 'draft', deferredReportScoring: true,
    })).toEqual({ draft: 'Saving…', submit: 'Submit answers' });
  });
  it('shows Submitting only on Submit, keeping Save Draft labelled normally', () => {
    expect(getLearnerQuizSaveButtonLabels({
      quizSaving: true, savingAction: 'submitted', deferredReportScoring: true,
    })).toEqual({ draft: 'Save Draft', submit: 'Submitting…' });
  });
  it('preserves standard quiz labels while idle and during independent scoring', () => {
    expect(getLearnerQuizSaveButtonLabels({ deferredReportScoring: false }))
      .toEqual({ draft: 'Save Draft', submit: 'Submit Quiz' });
    expect(getLearnerQuizSaveButtonLabels({ quizSaving: true, deferredReportScoring: true }))
      .toEqual({ draft: 'Save Draft', submit: 'Submit answers' });
  });
});
