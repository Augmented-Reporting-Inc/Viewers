import { installQuizContourTextRenderer } from './installQuizContourTextRenderer';
import { getQuizCompositeContourViewportLines } from './quizEchoAreaCalibration';

function makeGroup() {
  const toolInstance: any = {
    configuration: { getTextLines: () =>
      ['Area: 19.3 mm²', 'Mean: 21', 'Max: 30', 'Min: 12', 'Std Dev: 4', 'Perimeter: 75 mm'] },
  };
  const group = {
    getToolInstance: jest.fn(() => toolInstance),
    setToolConfiguration: jest.fn((_toolName, config) => {
      toolInstance.configuration = config;
    }),
  };
  return { toolInstance, group };
}

describe('Cornerstone quiz contour text renderer', () => {
  const rvData = { echoArea: { slot: 'RV_ED' } };
  const laData = { laVolume: { slot: 'A4C' } };
  const format = (values: Record<string, number>) => (data: any) => {
    const slot = data?.echoArea?.slot || data?.laVolume?.slot;
    return getQuizCompositeContourViewportLines(data, values[slot]);
  };

  it('uses the validated RV/LA numeric area and cm², never native statistics', () => {
    const { toolInstance, group } = makeGroup();
    expect(installQuizContourTextRenderer({
      toolGroup: group, toolName: 'SplineROI',
      formatQuizContour: format({ RV_ED: 19.31, A4C: 31.26 }),
    })).toBe(true);
    expect(toolInstance.configuration.getTextLines(rvData, 'imageId:source'))
      .toEqual(['RVEDA: 19.31 cm²']);
    expect(toolInstance.configuration.getTextLines(laData, 'imageId:source'))
      .toEqual(['LA A4C: 31.26 cm²']);
  });

  it('does not adopt native mm² data if the physical phase is unavailable', () => {
    const { toolInstance, group } = makeGroup();
    installQuizContourTextRenderer({
      toolGroup: group, toolName: 'SplineROI',
      formatQuizContour: format({}),
    });
    expect(toolInstance.configuration.getTextLines(rvData, 'imageId:source'))
      .toEqual(['RVEDA: calibrated area unavailable']);
  });

  it('preserves generic clinical and bowel ROI rendering', () => {
    const { toolInstance, group } = makeGroup();
    installQuizContourTextRenderer({
      toolGroup: group, toolName: 'SplineROI',
      formatQuizContour: format({ RV_ED: 19.31 }),
    });
    expect(toolInstance.configuration.getTextLines({ label: 'Unrelated ROI' }, 'imageId:other'))
      .toEqual(['Area: 19.3 mm²', 'Mean: 21', 'Max: 30', 'Min: 12',
        'Std Dev: 4', 'Perimeter: 75 mm']);
  });

  it('reinstalls after tool-group reconfiguration instead of trusting an old flag', () => {
    const { toolInstance, group } = makeGroup();
    installQuizContourTextRenderer({
      toolGroup: group, toolName: 'PlanarFreehandROI',
      formatQuizContour: format({ RV_ED: 19.31 }),
    });
    const oldCallback = toolInstance.configuration.getTextLines;
    toolInstance.configuration = { getTextLines: () => ['Area: 19.3 mm²'] };
    expect(installQuizContourTextRenderer({
      toolGroup: group, toolName: 'PlanarFreehandROI',
      formatQuizContour: format({ RV_ED: 19.31 }),
    })).toBe(true);
    expect(toolInstance.configuration.getTextLines).not.toBe(oldCallback);
    expect(toolInstance.configuration.getTextLines(rvData, 'imageId:source'))
      .toEqual(['RVEDA: 19.31 cm²']);
  });

  it('reuses the existing wrapper while updating its validator for a new viewport', () => {
    const { toolInstance, group } = makeGroup();
    installQuizContourTextRenderer({
      toolGroup: group, toolName: 'SplineROI',
      formatQuizContour: format({ RV_ED: 19.31 }),
    });
    const oldCallback = toolInstance.configuration.getTextLines;
    expect(installQuizContourTextRenderer({
      toolGroup: group, toolName: 'SplineROI',
      formatQuizContour: format({ RV_ED: 20.11 }),
    })).toBe(true);
    expect(toolInstance.configuration.getTextLines).toBe(oldCallback);
    expect(toolInstance.configuration.getTextLines(rvData, 'imageId:other'))
      .toEqual(['RVEDA: 20.11 cm²']);
  });

  it('does not infer quiz identity from a generic clinical ROI label', () => {
    const { toolInstance, group } = makeGroup();
    installQuizContourTextRenderer({
      toolGroup: group, toolName: 'SplineROI',
      formatQuizContour: format({ RV_ED: 19.31 }),
    });
    const genericLabelOnly = { label: 'RVEDA' };
    expect(toolInstance.configuration.getTextLines(genericLabelOnly, 'imageId:source'))
      .toContain('Area: 19.3 mm²');
  });

  it('returns false when no Cornerstone ROI tool is installed', () => {
    expect(installQuizContourTextRenderer({
      toolGroup: { getToolInstance: () => undefined }, toolName: 'SplineROI',
      formatQuizContour: format({ RV_ED: 19.31 }),
    })).toBe(false);
  });
});
