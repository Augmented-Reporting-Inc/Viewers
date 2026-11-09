import {
  appendBowelMeasurementSetAnswer,
  getBowelMeasurementSetEntries,
  restoreBowelMeasurementSetDisplayEvidence,
  formatBowelBwtMeasurementLabel,
  getBowelMeasurementSetMidpointSpacingMm,
  getBowelMeasurementSetEstimatedRadialAngleDegrees,
} from './bowelQuizMeasurementSet';

const question = {
  answerConfig: {
    measurementKind: 'length',
    measurementSet: {
      enabled: true,
      orientation: 'longitudinal',
      requiredCount: 2,
      measurementTarget: 'BowelCecumBWT',
    },
  },
};
const target = {
  studyInstanceUID: 'study',
  seriesInstanceUID: 'series',
  sopInstanceUID: 'instance',
  frameNumber: 6,
};
function caliper(id: string, x: number, overrides: Record<string, any> = {}) {
  return {
    sourceAnnotationId: id,
    value: 3.2,
    unit: 'mm',
    measurementKind: 'length',
    measurementType: 'BowelCecumBWT',
    viewerTarget: target,
    quizSpatialEvidence: {
      source: 'dicom-calibrated-image-index-v1',
      calibrationSource: 'ultrasound-region',
      pixelSpacing: { row: 0.1, column: 0.1 },
      physicalPoints: [[x, 0, 0], [x, 3.2, 0]],
    },
    ...overrides,
  };
}

describe('learner multiple-BWT capture', () => {
  it('increments count as each labelled, calibrated source is captured', () => {
    const first = appendBowelMeasurementSetAnswer(question, [], caliper('a', 0));
    expect(first.ok).toBe(true);
    expect(getBowelMeasurementSetEntries(first.entries).length).toBe(1);
    const second = appendBowelMeasurementSetAnswer(question, first.entries || [], caliper('b', 5));
    expect(second.ok).toBe(true);
    expect(getBowelMeasurementSetEntries(second.entries).length).toBe(2);
    expect(second.entries?.map(item => item.sourceAnnotationId)).toEqual(['a', 'b']);
    expect(second.axis).toEqual([5, 0, 0]);
    expect(getBowelMeasurementSetMidpointSpacingMm(second.entries || [])).toBe(5);
  });

  it('shows human-readable BWT labels and rejects the wrong bowel segment', () => {
    expect(formatBowelBwtMeasurementLabel('BowelSigmoidColonBWT')).toBe('Sigmoid colon BWT');
    expect(formatBowelBwtMeasurementLabel('BowelTerminalIleumBWT')).toBe('Terminal ileum BWT');
    expect(formatBowelBwtMeasurementLabel('BowelNeoTerminalIleumBWT')).toBe('Neo-terminal ileum BWT');
    expect(formatBowelBwtMeasurementLabel('BowelIleocolicAnastomosisBWT')).toBe('Ileocolic anastomosis BWT');
    expect(formatBowelBwtMeasurementLabel('')).toBe('');
    const wrongSegment = appendBowelMeasurementSetAnswer(question, [],
      caliper('wrong', 0, { measurementType: 'BowelTerminalIleumBWT' }));
    expect(wrongSegment.ok).toBe(false);
    expect(wrongSegment.reason).toContain('Cecum BWT');
    expect(wrongSegment.reason).toContain('Terminal ileum BWT');
    const rightSegment = appendBowelMeasurementSetAnswer(question, [], caliper('right', 0));
    expect(rightSegment.ok).toBe(true);
    expect(rightSegment.entries?.[0].measurementType).toBe('BowelCecumBWT');
  });

  it('does not duplicate a caliper from two completion notifications', () => {
    const first = appendBowelMeasurementSetAnswer(question, [], caliper('a', 0));
    const repeated = appendBowelMeasurementSetAnswer(question, first.entries || [], caliper('a', 0));
    expect(repeated.ok).toBe(false);
    expect(repeated.reason).toMatch(/already in the measurement set/);
  });

  it('does not calculate informational spacing when calibration or frame differs', () => {
    const first = caliper('a', 0);
    const otherFrame = caliper('b', 5, {
      viewerTarget: { ...target, frameNumber: 7 },
    });
    expect(getBowelMeasurementSetMidpointSpacingMm([first, otherFrame])).toBeNull();
    expect(getBowelMeasurementSetMidpointSpacingMm([first, caliper('b', 5, {
      quizSpatialEvidence: { physicalPoints: [[5, 0, 0], [5, 3.2, 0]] },
    })])).toBeNull();
    expect(getBowelMeasurementSetMidpointSpacingMm([first])).toBeNull();
  });

  it('fails closed for wrong frames and uncalibrated measurements', () => {
    const first = appendBowelMeasurementSetAnswer(question, [], caliper('a', 0));
    const otherFrame = appendBowelMeasurementSetAnswer(question, first.entries || [],
      caliper('b', 5, { viewerTarget: { ...target, frameNumber: 7 } }));
    expect(otherFrame.ok).toBe(false);
    expect(otherFrame.reason).toMatch(/same identified image\/frame/);
    const noEvidence = appendBowelMeasurementSetAnswer(question, first.entries || [],
      caliper('c', 5, { quizSpatialEvidence: {} }));
    expect(noEvidence.ok).toBe(false);
    expect(noEvidence.reason).toMatch(/Calibrated image-index/);
  });
});


describe('learner cross-sectional BWT live angle estimate', () => {
  const radialCaliper = (id: string, angleDegrees: number) => {
    const angle = angleDegrees * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    return caliper(id, 0, {
      quizSpatialEvidence: {
        source: 'dicom-calibrated-image-index-v1',
        calibrationSource: 'ultrasound-region',
        pixelSpacing: { row: 0.1, column: 0.1 },
        physicalPoints: [
          [direction[0] * 4, direction[1] * 4, 0],
          [direction[0] * 5, direction[1] * 5, 0],
        ],
      },
    });
  };

  it('calculates perpendicular and obtuse learner-caliper angles without gold geometry', () => {
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([
      radialCaliper('a', 0), radialCaliper('b', 90),
    ])).toBeCloseTo(90, 5);
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([
      radialCaliper('a', 0), radialCaliper('b', 120),
    ])).toBeCloseTo(120, 5);
  });

  it('uses minimum pairwise separation for a three-caliper set', () => {
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([
      radialCaliper('a', 0), radialCaliper('b', 90), radialCaliper('c', 170),
    ])).toBeCloseTo(80, 5);
  });

  it('never guesses angle for uncalibrated, mismatched or parallel axes', () => {
    const a = radialCaliper('a', 0);
    const b = radialCaliper('b', 90);
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([a])).toBeNull();
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([
      a, { ...b, viewerTarget: { ...target, frameNumber: 7 } },
    ])).toBeNull();
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([
      a, { ...b, quizSpatialEvidence: { physicalPoints: b.quizSpatialEvidence.physicalPoints } },
    ])).toBeNull();
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([
      a, { ...b, quizSpatialEvidence: { ...b.quizSpatialEvidence,
        pixelSpacing: { row: 0.2, column: 0.1 } } },
    ])).toBeNull();
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees([
      radialCaliper('a', 0), radialCaliper('b', 0),
    ])).toBeNull();
  });
});

describe('persisted learner multi-BWT display evidence', () => {
  it('restores longitudinal spacing from verified learner annotations without changing saved quiz answers', () => {
    // FormAPI intentionally strips quizSpatialEvidence from viewerQuizResponses.
    const savedAnswers = [caliper('a', 0), caliper('b', 5)]
      .map(({ quizSpatialEvidence, ...entry }) => entry);
    expect(getBowelMeasurementSetMidpointSpacingMm(savedAnswers)).toBeNull();
    const trusted = {
      a: caliper('a', 0).quizSpatialEvidence,
      b: caliper('b', 5).quizSpatialEvidence,
    };
    const reconstructed = restoreBowelMeasurementSetDisplayEvidence(savedAnswers, trusted);
    expect(getBowelMeasurementSetMidpointSpacingMm(reconstructed)).toBe(5);
    expect(savedAnswers[0]).not.toHaveProperty('quizSpatialEvidence');
    expect(savedAnswers[1]).not.toHaveProperty('quizSpatialEvidence');
  });

  it('restores cross-sectional angle only when both source IDs have verified calibration', () => {
    const radial = (id: string, degrees: number) => {
      const angle = degrees * Math.PI / 180;
      return caliper(id, 0, { quizSpatialEvidence: {
        source: 'dicom-calibrated-image-index-v1',
        calibrationSource: 'ultrasound-region',
        pixelSpacing: { row: 0.1, column: 0.1 },
        physicalPoints: [
          [4 * Math.cos(angle), 4 * Math.sin(angle), 0],
          [5 * Math.cos(angle), 5 * Math.sin(angle), 0],
        ],
      } });
    };
    const a = radial('a', 0);
    const b = radial('b', 90);
    const savedAnswers = [a, b].map(({ quizSpatialEvidence, ...entry }) => entry);
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees(savedAnswers)).toBeNull();
    const reconstructed = restoreBowelMeasurementSetDisplayEvidence(savedAnswers, {
      a: a.quizSpatialEvidence, b: b.quizSpatialEvidence,
    });
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees(reconstructed)).toBeCloseTo(90, 5);
    expect(getBowelMeasurementSetEstimatedRadialAngleDegrees(
      restoreBowelMeasurementSetDisplayEvidence(savedAnswers, { a: a.quizSpatialEvidence })
    )).toBeNull();
    expect(restoreBowelMeasurementSetDisplayEvidence(savedAnswers, {
      unknown: b.quizSpatialEvidence,
    })).toEqual(savedAnswers);
  });

  it('does not overwrite fresh unsaved caliper geometry with a stale restored annotation', () => {
    const current = caliper('a', 3);
    const restored = restoreBowelMeasurementSetDisplayEvidence([current], {
      a: caliper('a', 9).quizSpatialEvidence,
    });
    expect(restored[0].quizSpatialEvidence).toBe(current.quizSpatialEvidence);
  });
});
