import {
  sanitizeLiveCornerstoneAnnotation,
  sanitizeMeasurementForIuscan,
} from './measurementUnitSanitizer';

const targetId = 'imageId:wadors:https://pacs/studies/1/series/2/instances/3/frames/1';

const liveAnnotation = (toolName, stats) => ({
  annotationUID: 'ann-1',
  invalidated: false,
  metadata: { toolName, referencedImageId: targetId.slice('imageId:'.length) },
  data: {
    handles: {
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
    },
    cachedStats: { [targetId]: stats },
  },
});

describe('iUSCAN live annotation sanitising — risk 1', () => {
  it('does not touch a native Length annotation (cachedStats, displayText, invalidated)', () => {
    // Native Cornerstone stats as produced for a single-region US image.
    const annotation = liveAnnotation('Length', { length: 0.0245, unit: 'cm US Region' });
    const before = JSON.parse(JSON.stringify(annotation));

    expect(sanitizeLiveCornerstoneAnnotation(annotation)).toBe(false);
    expect(annotation).toEqual(before);
    expect(annotation.invalidated).toBe(false);
  });

  it('breaks the update cycle: repeated MEASUREMENT_UPDATED passes never invalidate a Length', () => {
    const annotation = liveAnnotation('Length', { length: 3.07, unit: 'mm' });
    for (let i = 0; i < 5; i++) {
      expect(sanitizeLiveCornerstoneAnnotation(annotation)).toBe(false);
    }
    expect(annotation.invalidated).toBe(false);
  });

  it('still normalises other tools exactly as before (e.g. curved-length contour in cm)', () => {
    const annotation = liveAnnotation('PlanarFreehandROI', { length: 1.234, unit: 'cm US Region' });

    expect(sanitizeLiveCornerstoneAnnotation(annotation)).toBe(true);
    expect(annotation.data.cachedStats[targetId]).toMatchObject({
      length: 12.34,
      value: 12.34,
      unit: 'mm',
      lengthUnit: 'mm',
      displayText: ['12.34 mm'],
    });
    expect(annotation.data.displayText).toEqual({ primary: ['12.34 mm'], secondary: [] });
    expect(annotation.invalidated).toBe(true);
  });

  it('ignores missing annotations', () => {
    expect(sanitizeLiveCornerstoneAnnotation(undefined)).toBe(false);
    expect(sanitizeLiveCornerstoneAnnotation({ metadata: { toolName: 'Length' } })).toBe(false);
  });
});

describe('iUSCAN MeasurementService record sanitising (unchanged behaviour)', () => {
  it('keeps an already-calibrated mm Length record in mm (no second conversion)', () => {
    const record = {
      uid: 'ann-1',
      toolName: 'Length',
      data: { [targetId]: { length: 3.0745, unit: 'mm' } },
      displayText: { primary: ['3.07 mm'], secondary: ['S: 4 I: 1'] },
    };

    sanitizeMeasurementForIuscan(record);

    expect(record.data[targetId]).toMatchObject({ length: 3.0745, unit: 'mm', lengthUnit: 'mm' });
    expect(record.displayText).toEqual({ primary: ['3.07 mm'], secondary: ['S: 4 I: 1'] });
  });

  it('converts a native cm record to mm', () => {
    const record = { data: { [targetId]: { length: 0.31, unit: 'cm US Region' } } };
    sanitizeMeasurementForIuscan(record);
    expect(record.data[targetId].length).toBeCloseTo(3.1, 12);
    expect(record.data[targetId].unit).toBe('mm');
  });

  it('mutating the record cannot reach the live annotation when stats are copied', () => {
    const annotation = liveAnnotation('Length', { length: 0.31, unit: 'cm US Region' });
    // Length.toMeasurement returns a copy of each target's stats.
    const record = { data: { [targetId]: { ...annotation.data.cachedStats[targetId] } } };

    sanitizeMeasurementForIuscan(record);

    expect(record.data[targetId].unit).toBe('mm');
    expect(annotation.data.cachedStats[targetId]).toEqual({ length: 0.31, unit: 'cm US Region' });
  });
});
