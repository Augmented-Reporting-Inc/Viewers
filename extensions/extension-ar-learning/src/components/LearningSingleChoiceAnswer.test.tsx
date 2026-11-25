import React from 'react';
import { LearningSingleChoiceAnswer } from './LearningSingleChoiceAnswer';

function leaves(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(leaves);
  if (typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return leaves(node.type(node.props));
  return [node, ...leaves(node.props?.children)];
}

describe('single Learning and Research protocol choice control', () => {
  const choices = [
    { value: '3', label: 'Low' },
    { value: '8', label: 'Intermediate' },
    { value: '15', label: 'High' },
  ];

  it('uses stable controlled radio options and delegates changes to owning workflow', () => {
    let selected = '';
    const all = leaves(LearningSingleChoiceAnswer({
      name: 'sample',
      choices,
      value: '8',
      onChange: value => { selected = value; },
    }));
    const radios = all.filter(item => item.type === 'input');
    expect(radios).toHaveLength(3);
    expect(radios.map(item => item.props.checked)).toEqual([false, true, false]);
    expect(radios.map(item => item.props.name)).toEqual(['sample', 'sample', 'sample']);
    radios[0].props.onChange();
    expect(selected).toBe('3');
  });

  it('enforces read-only mode for saved Research and submitted Education', () => {
    const all = leaves(LearningSingleChoiceAnswer({
      name: 'locked',
      choices,
      value: '15',
      disabled: true,
      onChange: () => { throw Error('should not change a submitted answer'); },
    }));
    expect(all.filter(item => item.type === 'input').every(item => item.props.disabled)).toBe(true);
  });
});
