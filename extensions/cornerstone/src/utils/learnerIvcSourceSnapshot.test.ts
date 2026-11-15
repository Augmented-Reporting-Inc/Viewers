import { reconcileLearnerIvcSnapshotSources } from './learnerIvcSourceSnapshot';

const study = 'study', series = 'series', instance = 'instance';
const target = (frameNumber: number) => ({
  studyInstanceUID: study, seriesInstanceUID: series, sopInstanceUID: instance, frameNumber,
});
const points = [[1, 2, 0], [3, 4, 0]];
const parts = [
  { slot: 'IVC_EXP', annotationId: 'expiration', target: target(2), points },
  { slot: 'IVC_INSP', annotationId: 'inspiration', target: target(12), points },
];
const evidence = { ivc: { measurementKind: 'ivcCollapsibility',
  compositeResult: { components: parts } } };
const stored = (part: any) => ({
  annotationId: part.annotationId, toolName: 'Length',
  StudyInstanceUID: study, SeriesInstanceUID: series, SOPInstanceUID: instance,
  frameNumber: part.target.frameNumber, points,
});
const native = (part: any) => ({
  annotationUID: part.annotationId,
  metadata: { toolName: 'Length', StudyInstanceUID: study, SeriesInstanceUID: series,
    SOPInstanceUID: instance,
    referencedImageId: `wadors:/orthanc/dicom-web/studies/${study}/series/${series}/instances/${instance}/frames/${part.target.frameNumber}` },
  data: { handles: { points } },
});

describe('learner IVC source snapshot reconciliation', () => {
  it('does not change an already complete snapshot', () => {
    expect(reconcileLearnerIvcSnapshotSources({
      evidence, snapshotAnnotations: parts.map(stored), nativeAnnotations: parts.map(native),
    })).toEqual({ recovered: [], missing: [] });
  });

  it('recovers only the absent inspiration source from its exact native frame', () => {
    const result = reconcileLearnerIvcSnapshotSources({
      evidence, snapshotAnnotations: [stored(parts[0])], nativeAnnotations: parts.map(native),
    });
    expect(result.missing).toEqual([]);
    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0]).toMatchObject({
      annotationId: 'inspiration', label: 'IVCinsp', frameNumber: 12,
      toolName: 'Length', points,
    });
  });

  it('does not fabricate absent source geometry from a quiz answer', () => {
    const result = reconcileLearnerIvcSnapshotSources({
      evidence, snapshotAnnotations: [stored(parts[0])], nativeAnnotations: [],
    });
    expect(result.recovered).toEqual([]);
    expect(result.missing).toEqual(['IVC inspiration']);
  });

  it('rejects mismatched frame, points or deleted source', () => {
    const source = native(parts[1]);
    const wrongFrame = { ...source, metadata: {
      ...source.metadata,
      referencedImageId: source.metadata.referencedImageId.replace('/frames/12', '/frames/11'),
    } };
    expect(reconcileLearnerIvcSnapshotSources({
      evidence, snapshotAnnotations: [stored(parts[0])], nativeAnnotations: [wrongFrame],
    }).missing).toEqual(['IVC inspiration']);
    const wrongGeometry = { ...source, data: { handles: { points: [[9, 2, 0], [3, 4, 0]] } } };
    expect(reconcileLearnerIvcSnapshotSources({
      evidence, snapshotAnnotations: [stored(parts[0])], nativeAnnotations: [wrongGeometry],
    }).missing).toEqual(['IVC inspiration']);
    expect(reconcileLearnerIvcSnapshotSources({
      evidence, snapshotAnnotations: [stored(parts[0])], nativeAnnotations: [source],
      excludedIds: new Set(['inspiration']),
    }).missing).toEqual(['IVC inspiration']);
  });

  it('does not accept a persisted annotation with a mismatched frame', () => {
    expect(reconcileLearnerIvcSnapshotSources({
      evidence, snapshotAnnotations: [stored(parts[0]), { ...stored(parts[1]), frameNumber: 11 }],
      nativeAnnotations: parts.map(native),
    }).missing).toEqual(['IVC inspiration']);
  });

  it('does not affect other viewer save workflows', () => {
    expect(reconcileLearnerIvcSnapshotSources({
      evidence: null, snapshotAnnotations: [], nativeAnnotations: parts.map(native),
    })).toEqual({ recovered: [], missing: [] });
  });
});
