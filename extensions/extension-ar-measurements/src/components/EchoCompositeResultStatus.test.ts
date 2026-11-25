import React from 'react';
import { EchoCompositeResultStatus } from './EchoCompositeResultStatus';

function textOf(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node.type === 'function') return textOf(node.type(node.props));
  return textOf(node.props?.children);
}

describe('shared Echo Research/Education calculated result presentation', () => {
  it('displays calibrated numeric value with configured unit and workflow label', () => {
    const ef = textOf(React.createElement(EchoCompositeResultStatus, {
      value: 63.126, unit: '%', label: 'Saved calculated result',
    }));
    expect(ef).toBe('Saved calculated result: 63.13 %');
    const la = textOf(React.createElement(EchoCompositeResultStatus, {
      value: 47.2, unit: 'mL', label: 'Calculated measurement',
    }));
    expect(la).toBe('Calculated measurement: 47.20 mL');
  });
  it('does not turn empty, nonnumeric or missing evidence into zero', () => {
    for (const value of ['', null, undefined, 'NaN', 'Infinity']) {
      const output = textOf(React.createElement(EchoCompositeResultStatus, {
        value, unit: '%', unavailableMessage: 'Acquire both phases.',
      }));
      expect(output).toBe('Calculation not ready: Acquire both phases.');
      expect(output).not.toContain('0.00');
    }
  });
  it('can represent valid zero without treating it as missing', () => {
    expect(textOf(React.createElement(EchoCompositeResultStatus, {
      value: 0, unit: '%',
    }))).toBe('Calculated measurement: 0.00 %');
  });
});
