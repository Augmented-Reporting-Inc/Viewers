import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewerNumericMeasurementInput, ViewerQuestionCard, ViewerQuestionNavigation } from './ViewerQuestionChrome';

describe('quiz/research shared viewer question presentation', () => {
  test('renders the exact selected-question treatment and required marker', () => {
    const html = renderToStaticMarkup(
      <ViewerQuestionCard number={2} title="LVEF" required>
        <span data-testid="research-answer">45%</span>
      </ViewerQuestionCard>
    );
    expect(html).toContain('Active Question');
    expect(html).toContain('border-blue-400');
    expect(html).toContain('2. LVEF');
    expect(html).toContain('text-red-300');
    expect(html).toContain('research-answer');
  });

  test('renders identically labelled and accessible Previous/Next controls', () => {
    const html = renderToStaticMarkup(
      <ViewerQuestionNavigation index={0} count={3} onNavigate={() => {}} />
    );
    expect(html).toContain('Question navigation');
    expect(html).toContain('Previous question');
    expect(html).toContain('Next question');
    expect(html).toContain('data-quiz-review-action="navigation"');
    expect((html.match(/disabled=""/g) || []).length).toBe(1);
  });

  test('Education and Research display the same numeric row and unit badge', () => {
    const html = renderToStaticMarkup(
      <ViewerNumericMeasurementInput
        value={42.5}
        unit="%"
        onChange={() => {}}
        onDelete={() => {}}
      />
    );
    expect(html).toContain('type="number"');
    expect(html).toContain('42.5');
    expect(html).toContain('%');
    expect(html).toContain('aria-label="Delete measurement"');
    expect(html).toContain('data-quiz-review-action="delete"');
  });

  test('calculated Research result cannot be edited or deleted', () => {
    const html = renderToStaticMarkup(
      <ViewerNumericMeasurementInput value={55} unit="mmHg" readOnly
        onChange={() => {}} onDelete={() => {}} />
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('mmHg');
    expect(html).not.toContain('Delete measurement');
  });

  test('retains the quiz question prompt and help presentation', () => {
    const html = renderToStaticMarkup(
      <ViewerQuestionCard number={1} title="TR Vmax" prompt="Measure TR"
        helpText="Open the guided frame" showPrompt active={false}>
        <span>Calibrated measurement</span>
      </ViewerQuestionCard>
    );
    expect(html).toContain('Measure TR');
    expect(html).toContain('Open the guided frame');
    expect(html).toContain('Calibrated measurement');
    expect(html).not.toContain('Active Question');
  });
});
