import React from 'react';
import {
  SharedQuestionSelector,
  SharedQuestionStepNavigation,
} from './SharedQuestionNavigation';
import { SharedMeasurementValueInput } from './SharedMeasurementValueInput';

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

  it('keeps deletion delegated to owning Learning or Research workflow', () => {
    let deleted = 0;
    let newValue = '';
    const nodes = flatten(SharedMeasurementValueInput({
      value: 2.8, unit: 'mm', onChange: value => { newValue = value; },
      onDelete: () => { deleted++; },
    }));
    const input = nodes.find(item => item.type === 'input');
    const deleteButton = nodes.find(item => item.type === 'button');
    expect(input.props.value).toBe(2.8);
    input.props.onChange({ target: { value: '3.2' } });
    expect(newValue).toBe('3.2');
    deleteButton.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
    expect(deleted).toBe(1);
    const withoutDelete = flatten(SharedMeasurementValueInput({
      value: '', onChange: () => {}, disabled: true,
    }));
    expect(withoutDelete.some(item => item.type === 'button')).toBe(false);
  });
});
