import { hasAllRequiredViewerGoldValues } from './quizAuthoringGoldReadiness';

const target = (frameNumber = 1) => ({
  studyInstanceUID: 'study', seriesInstanceUID: 'series',
  sopInstanceUID: 'sop-' + frameNumber, frameNumber,
});
const slots = ['A4C_ED', 'A4C_ES', 'A2C_ED', 'A2C_ES'];
const ef = () => ({
  type: 'measurementNumeric',
  answerConfig: {
    measurementKind: 'lvSimpsonEF',
    goldMeasurement: {
      measurementKind: 'lvSimpsonEF', value: 58,
      compositeResult: {
        components: slots.map((slot, i) => ({
          slot, annotationId: 'a-' + slot, target: target(i + 1),
        })),
        derived: {
          slotAreaCM2: Object.fromEntries(slots.map(slot => [slot, 20])),
          slotLongAxisMM: Object.fromEntries(slots.map(slot => [slot, 80])),
          edvML: 110, esvML: 46,
        },
      },
    },
  },
});

describe('educator question dropdown gold readiness', () => {
  it('marks approved EF gold ready with four source frames even when optional display axes/areas are absent', () => {
    const complete = ef();
    expect(hasAllRequiredViewerGoldValues(complete)).toBe(true);
    const noAxis = ef();
    delete (noAxis.answerConfig.goldMeasurement.compositeResult.derived.slotLongAxisMM as any).A2C_ES;
    expect(hasAllRequiredViewerGoldValues(noAxis)).toBe(true);
    const noArea = ef();
    delete (noArea.answerConfig.goldMeasurement.compositeResult.derived.slotAreaCM2 as any).A4C_ED;
    expect(hasAllRequiredViewerGoldValues(noArea)).toBe(true);
    const noSource = ef();
    noSource.answerConfig.goldMeasurement.compositeResult.components[2].annotationId = '';
    expect(hasAllRequiredViewerGoldValues(noSource)).toBe(false);
  });

  it('requires the gold target for frame questions and coordinates for point questions', () => {
    expect(hasAllRequiredViewerGoldValues({
      type: 'frameSelection', answerConfig: { goldTarget: target(3) },
    })).toBe(true);
    expect(hasAllRequiredViewerGoldValues({
      type: 'frameSelection', answerConfig: { goldTarget: { frameNumber: 3 } },
    })).toBe(false);
    expect(hasAllRequiredViewerGoldValues({
      type: 'placeMarker', answerConfig: { goldPoint: { x: 0, y: 25 } },
    })).toBe(true);
    expect(hasAllRequiredViewerGoldValues({
      type: 'pointPlacement', answerConfig: { goldPoint: {} },
    })).toBe(false);
  });

  it('requires selected marker IDs and source-linked numeric gold evidence', () => {
    const marker = { type: 'markerMultiSelect', answerConfig: {} };
    expect(hasAllRequiredViewerGoldValues(marker, ['marker-1'])).toBe(true);
    expect(hasAllRequiredViewerGoldValues(marker, [])).toBe(false);
    const scalar = {
      type: 'measurementNumeric', answerConfig: {
        measurementKind: 'length', goldValue: 14.1,
        goldMeasurement: { value: 14.1, sourceAnnotationId: 'length-1', viewerTarget: target(7) },
      },
    };
    expect(hasAllRequiredViewerGoldValues(scalar)).toBe(true);
    expect(hasAllRequiredViewerGoldValues({
      ...scalar, answerConfig: { ...scalar.answerConfig, goldMeasurement: { value: 14.1 } },
    })).toBe(false);
  });

  it('rejects incomplete calibrated RV FAC phase data', () => {
    const fac = {
      type: 'measurementNumeric', answerConfig: {
        measurementKind: 'rvFAC',
        goldMeasurement: {
          value: 40,
          compositeResult: {
            components: ['RV_ED', 'RV_ES'].map((slot, i) => ({
              slot, annotationId: slot, target: target(i + 1),
            })),
            derived: { edaCM2: 24, esaCM2: 14.4 },
          },
        },
      },
    };
    expect(hasAllRequiredViewerGoldValues(fac)).toBe(true);
    fac.answerConfig.goldMeasurement.compositeResult.derived.esaCM2 = 0;
    expect(hasAllRequiredViewerGoldValues(fac)).toBe(false);
  });
});
