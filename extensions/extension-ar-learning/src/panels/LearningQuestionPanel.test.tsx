import React from 'react';
import LearningQuestionPanel from './LearningQuestionPanel';
import { LearningEchoAcquisitionControls } from '../components/LearningEchoAcquisitionControls';
import fs from 'fs';
import path from 'path';

function nodes(element: any): any[] {
  if (element == null || typeof element === 'boolean') return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (typeof element !== 'object') return [element];
  if (typeof element.type === 'function') return nodes(element.type(element.props));
  return [element, ...nodes(element.props?.children)];
}

describe('Education and Research use Learning question renderer', () => {
  it('renders question navigation and delegated answer controls with no scoring fields', () => {
    let navigated = '';
    const tree = nodes(LearningQuestionPanel({
      title: 'Research Read',
      groups: [{ key: 'read', questions: [
        { key: 'ef|', label: 'EF' },
        { key: 'lvidd|', label: 'LVIDd', answered: true },
      ] }],
      selectedKey: 'ef|',
      selectedQuestion: { key: 'ef|', index: 0, title: 'EF', required: true },
      onSelect: key => { navigated = key; },
      questionContent: React.createElement('div', {}, 'Answer controlled by Research'),
    }));
    const select = tree.find(element => element.type === 'select');
    expect(select).toBeTruthy();
    select.props.onChange({ target: { value: 'lvidd|' } });
    expect(navigated).toBe('lvidd|');
    expect(tree.some(element => element.type === 'div' &&
      element.props['data-question-key'] === 'ef|')).toBe(true);
    const html = tree.flatMap(node => typeof node === 'string' ? [node] : []);
    expect(html.join(' ')).not.toContain('Viewer Quiz Score');
  });

  it('uses one acquisition component for LA, RV and IVC, never quiz persistence', () => {
    const chosen: string[] = [];
    const rv = nodes(LearningEchoAcquisitionControls({
      kind: 'rvFac',
      onAcquire: (slot, technique) => chosen.push(slot + ':' + technique),
    }));
    expect(rv.filter(node => node.type === 'button').length).toBeGreaterThan(0);
    const ivc = nodes(LearningEchoAcquisitionControls({
      kind: 'ivcCollapsibility',
      onAcquire: slot => chosen.push(slot),
    }));
    const button = ivc.find(node => node.type === 'button');
    button.props.onClick({ preventDefault() {}, stopPropagation() {} });
    expect(chosen).toEqual(['IVC_EXP']);
  });

  it('wires both controllers to the actual Learning renderer and leaves Research APIs isolated', () => {
    const learning = fs.readFileSync(
      path.resolve(__dirname, './CaseQuestionsPanel.tsx'), 'utf8'
    );
    const research = fs.readFileSync(
      path.resolve(__dirname, '../../../extension-ar-research/src/panels/ResearchReadPanel.tsx'), 'utf8'
    );
    expect(learning).toContain('<LearningQuestionPanel');
    expect(research).toContain('<LearningQuestionPanel');
    expect(learning).toContain('<LearningEchoAcquisitionControls');
    const guided = fs.readFileSync(
      path.resolve(__dirname, '../../../extension-ar-research/src/panels/ResearchEchoGuidedControls.tsx'), 'utf8'
    );
    expect(guided).toContain('<LearningEchoAcquisitionControls');
    expect(research).toContain('saveResearchReadReview');
    expect(research).toContain('completeResearchReadReview');
    expect(research).not.toContain('submitAndRefreshViewerQuizScoreForActiveStudy');
  });
});
