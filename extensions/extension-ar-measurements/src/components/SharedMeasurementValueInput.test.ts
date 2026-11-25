import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { SharedMeasurementValueInput } from './SharedMeasurementValueInput';

describe('shared EF numeric display', () => {
  it('renders a stored number with two digits without changing the numeric answer; permits typing and retains blank values', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const root = createRoot(element);
    const prior = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const onChange = jest.fn();
    const show = (value: any, displayDecimalPlaces?: number) =>
      act(() => root.render(React.createElement(SharedMeasurementValueInput, {
        value, onChange, displayDecimalPlaces, unit: '%',
      })));
    try {
      show(8, 2);
      const input = element.querySelector('input')!;
      expect(input.value).toBe('8.00');
      show(8.127, 2);
      expect(input.value).toBe('8.13');
      expect(onChange).not.toHaveBeenCalled();
      act(() => input.focus());
      show(8.1, 2);
      expect(input.value).toBe('8.1');
      act(() => input.blur());
      expect(input.value).toBe('8.10');
      show('', 2);
      expect(input.value).toBe('');
      show(0, 2);
      expect(input.value).toBe('0.00');
      show(8.1);
      expect(input.value).toBe('8.1');
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      element.remove();
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prior;
    }
  });
});
