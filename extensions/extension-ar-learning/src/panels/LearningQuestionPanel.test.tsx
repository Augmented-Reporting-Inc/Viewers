import React from 'react';
import LearningQuestionPanel from './LearningQuestionPanel';
import { LearningEchoAcquisitionControls } from '../components/LearningEchoAcquisitionControls';
import { SharedEFQuestionAnswer } from '../components/SharedEFQuestionAnswer';
import { SharedMeasurementValueInput } from '../../../extension-ar-measurements/src/components/SharedMeasurementValueInput';
import fs from 'fs';
import path from 'path';

function nodes(element: any): any[] {
  if (element == null || typeof element === 'boolean') return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (typeof element !== 'object') return [element];
  if (element.type === SharedMeasurementValueInput) return [element];
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
    expect(select.props.value).toBe('ef|');
    expect(tree.filter(element => element.type === 'div' && element.props['data-question-key'])
      .map(element => element.props['data-question-key'])).toEqual(['ef|']);
    expect(tree).toContain('Active Question');
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
    const inspiration = ivc.find(node => node.type === 'button' &&
      node.props.children === 'Measure inspiration (IVCinsp)');
    expect(inspiration).toBeTruthy();
    inspiration.props.onClick({ preventDefault() {}, stopPropagation() {} });
    expect(chosen).toEqual(['IVC_EXP', 'IVC_INSP']);
  });

  it('shares EF answer, launcher and guidance without owning persistence', () => {
    let changed = '';
    let opened = 0;
    const tree = nodes(SharedEFQuestionAnswer({
      value: '',
      onChange: value => { changed = value; },
      onOpen: () => { opened += 1; },
    }));
    const input = tree.find(node => node.type === SharedMeasurementValueInput);
    expect(input).toBeTruthy();
    input.props.onChange('58');
    expect(input.props.displayDecimalPlaces).toBe(2);
    expect(changed).toBe('58');
    const launcher = tree.find(node => node.type === 'button' &&
      node.props.children === 'Open EF panel');
    expect(launcher).toBeTruthy();
    launcher.props.onClick({ preventDefault() {}, stopPropagation() {} });
    expect(opened).toBe(1);
    expect(tree.some(node => typeof node === 'string' &&
      node.includes('Complete four LV contours'))).toBe(true);

    const complete = nodes(SharedEFQuestionAnswer({
      value: 58, onChange: () => {}, onOpen: () => {},
    }));
    expect(complete.some(node => typeof node === 'string' &&
      node.includes('Complete four LV contours'))).toBe(false);

    const noFrame = nodes(SharedEFQuestionAnswer({
      value: 58, onChange: () => {}, onOpen: () => {},
      openDisabled: true, min: 0, max: 100, step: 1,
    }));
    const numeric = noFrame.find(node => node.type === SharedMeasurementValueInput);
    expect(numeric.props.disabled).toBe(false);
    expect([numeric.props.min, numeric.props.max, numeric.props.step]).toEqual([0, 100, 1]);
    expect(noFrame.find(node => node.type === 'button' &&
      node.props.children === 'Open EF panel').props.disabled).toBe(true);
  });

  it('uses the shared EF renderer in both controllers without mixing answer APIs', () => {
    const learning = fs.readFileSync(
      path.resolve(__dirname, './CaseQuestionsPanel.tsx'), 'utf8'
    );
    const research = fs.readFileSync(
      path.resolve(__dirname, '../../../extension-ar-research/src/panels/ResearchEchoGuidedControls.tsx'), 'utf8'
    );
    expect(learning).toContain('<SharedEFQuestionAnswer');
    expect(research).toContain('<SharedEFQuestionAnswer');
    expect(research).toContain('startLVSimpsonEFWorkflow');
    expect(research).toContain('allowCanonicalFrameTargets: true');
    expect(learning).toContain('getCompleteEFContourFrameTargets(question.answerConfig)');
    expect(learning).toContain('setAnswer(');
    expect(research).not.toContain('saveViewerQuizResponseForActiveStudy');
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
