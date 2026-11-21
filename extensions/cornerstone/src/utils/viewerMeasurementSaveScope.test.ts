import {
  resolveViewerMeasurementSaveScope, settleViewerMeasurementSaveMarkers,
} from './viewerMeasurementSaveScope';

describe('Viewer restricted learner source saves', () => {
  it('recognizes explicit quiz deletion-only requests and excludes unrelated pending deletes', () => {
    const scope = resolveViewerMeasurementSaveScope({
      measurementIds: [], deleteAnnotationIds: [' deleted '],
      pendingDeletedMeasurementIds: ['deleted', 'other-deletion'],
    });
    expect(scope.isExplicitDeletionOnlySave).toBe(true);
    expect(scope.requestedMeasurementIds.size).toBe(0);
    expect([...scope.deletionIdsToApply]).toEqual(['deleted']);
  });
  it('does not classify an empty requested selection without explicit deletions as valid deletion-only', () => {
    const scope = resolveViewerMeasurementSaveScope({
      measurementIds: [], pendingDeletedMeasurementIds: ['unsaved-delete'],
    });
    expect(scope.isExplicitDeletionOnlySave).toBe(false);
    expect(scope.deletionIdsToApply.size).toBe(0);
  });
  it('does not delete unrelated sources during a selected annotation save', () => {
    const scope = resolveViewerMeasurementSaveScope({
      measurementIds: [' new-source '], pendingDeletedMeasurementIds: ['another-source'],
    });
    expect([...scope.requestedMeasurementIds]).toEqual(['new-source']);
    expect(scope.deletionIdsToApply.size).toBe(0);
  });
  it('preserves existing full-save deletion selection', () => {
    const scope = resolveViewerMeasurementSaveScope({
      pendingDeletedMeasurementIds: ['unsaved-deletion'], deleteAnnotationIds: ['explicit-deletion'],
    });
    expect(scope.restrictMeasurementIds).toBe(false);
    expect([...scope.deletionIdsToApply]).toEqual(['unsaved-deletion', 'explicit-deletion']);
  });
  it('deletion-only success retains all unrelated new, edited and deleted measurements', () => {
    const created = new Set(['new-LV', 'new-RV']);
    const modified = new Set(['edited-IVC']);
    const deleted = new Set(['deleted-contour', 'other-pending-delete']);
    const scope = resolveViewerMeasurementSaveScope({
      measurementIds: [], deleteAnnotationIds: ['deleted-contour'],
      pendingDeletedMeasurementIds: deleted,
    });
    settleViewerMeasurementSaveMarkers({
      createdMeasurementIds: created, modifiedMeasurementIds: modified,
      deletedMeasurementIds: deleted, restrictMeasurementIds: scope.restrictMeasurementIds,
      requestedMeasurementIds: scope.requestedMeasurementIds,
      deletionIdsToApply: scope.deletionIdsToApply, persistedMeasurementIds: new Set(),
    });
    expect([...created]).toEqual(['new-LV', 'new-RV']);
    expect([...modified]).toEqual(['edited-IVC']);
    expect([...deleted]).toEqual(['other-pending-delete']);
  });
  it('selected source success only acknowledges returned IDs', () => {
    const created = new Set(['selected', 'unreturned', 'unselected']);
    const modified = new Set(['selected', 'other-edited']);
    const deleted = new Set(['other-deleted']);
    settleViewerMeasurementSaveMarkers({
      createdMeasurementIds: created, modifiedMeasurementIds: modified,
      deletedMeasurementIds: deleted, restrictMeasurementIds: true,
      requestedMeasurementIds: new Set(['selected', 'unreturned']),
      deletionIdsToApply: new Set(), persistedMeasurementIds: new Set(['selected']),
    });
    expect([...created]).toEqual(['unreturned', 'unselected']);
    expect([...modified]).toEqual(['other-edited']);
    expect([...deleted]).toEqual(['other-deleted']);
  });
  it('does not acknowledge deletion when the server still contains that source', () => {
    const deleted = new Set(['not-removed']);
    settleViewerMeasurementSaveMarkers({
      createdMeasurementIds: new Set(), modifiedMeasurementIds: new Set(),
      deletedMeasurementIds: deleted, restrictMeasurementIds: true,
      requestedMeasurementIds: new Set(), deletionIdsToApply: new Set(['not-removed']),
      persistedMeasurementIds: new Set(['not-removed']),
    });
    expect([...deleted]).toEqual(['not-removed']);
  });
  it('preserves historical full-session cleanup when the full save succeeds', () => {
    const created = new Set(['new']), modified = new Set(['edited']);
    const deleted = new Set(['deleted']);
    settleViewerMeasurementSaveMarkers({
      createdMeasurementIds: created, modifiedMeasurementIds: modified,
      deletedMeasurementIds: deleted, restrictMeasurementIds: false,
      requestedMeasurementIds: new Set(), deletionIdsToApply: new Set(['deleted']),
      persistedMeasurementIds: new Set(['new', 'edited']),
    });
    expect(created.size + modified.size + deleted.size).toBe(0);
  });
});
