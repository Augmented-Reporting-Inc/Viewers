import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  SharedQuestionSelector,
  SharedQuestionStepNavigation,
} from './SharedQuestionNavigation';
import { SharedMeasurementValueInput, SharedMeasurementLabel } from './SharedMeasurementValueInput';

function flatten(element: any): any[] {
  if (element == null || typeof element === 'boolean') return [];
  if (Array.isArray(element)) return element.flatMap(flatten);
  if (typeof element !== 'object') return [element];
  if (typeof element.type === 'function') return flatten(element.type(element.props));
  return [element, ...flatten(element.props?.children)];
}

describe('shared Learning/Research question UI', () => {
  it('preserves question identities and answered state without touching workflow data', () => {
    const selected: string[] = [];
    const view = SharedQuestionSelector({
      id: 'questions',
      groups: [{ key: 'quiz', label: 'Quiz', questions: [
        { key: 'quiz:ef', label: 'EF', answered: true },
        { key: 'quiz:lvidd', label: 'LVIDd' },
      ] }],
      selectedKey: 'quiz:ef',
      onSelect: key => selected.push(key),
    });
    const nodes = flatten(view);
    const selector = nodes.find(item => item.type === 'select');
    const options = nodes.filter(item => item.type === 'option');
    expect(options.map(item => item.props.value)).toEqual(['', 'quiz:ef', 'quiz:lvidd']);
    expect(nodes.some(item => item.type === 'optgroup')).toBe(true);
    expect(selector.props.value).toBe('quiz:ef');
    expect(options[1].props.children).toBe('1. ✓ EF');
    expect(options[2].props.children).toBe('2. LVIDd');
    selector.props.onChange({ target: { value: 'quiz:lvidd' } });
    expect(selected).toEqual(['quiz:lvidd']);
  });

  it('blocks movement at either boundary and does not navigate on disabled buttons', () => {
    const selected: string[] = [];
    const nodes = flatten(SharedQuestionStepNavigation({
      previousKey: '',
      nextKey: 'other',
      onNavigate: key => selected.push(key),
    }));
    const buttons = nodes.filter(item => item.type === 'button');
    expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[1].props.disabled).toBe(false);
    buttons[1].props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
    expect(selected).toEqual(['other']);
  });

  it('renders the same captured label and hides empty labels', () => {
    const nodes = flatten(<SharedMeasurementLabel label="LVIDd" />);
    expect(nodes.find(node => node.type === 'div').props.title).toBe('LVIDd');
    expect(nodes.filter(node => typeof node === 'string').join('')).toBe('Measurement label: LVIDd');
    expect(flatten(<SharedMeasurementLabel label="" />)).toEqual([]);
  });

  it('keeps deletion delegated to owning Learning or Research workflow', () => {
    let deleted = 0;
    let newValue = '';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const prior = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      act(() => root.render(<SharedMeasurementValueInput
        value={2.8} unit="mm" onChange={value => { newValue = value; }}
        onDelete={() => { deleted++; }} />));
      const input = container.querySelector('input')!;
      expect(input.value).toBe('2.8');
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '3.2');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(newValue).toBe('3.2');
      act(() => container.querySelector('button')!.click());
      expect(deleted).toBe(1);
      act(() => root.render(<SharedMeasurementValueInput value="" onChange={() => {}} disabled />));
      expect(container.querySelector('button')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prior;
    }
  });
});
