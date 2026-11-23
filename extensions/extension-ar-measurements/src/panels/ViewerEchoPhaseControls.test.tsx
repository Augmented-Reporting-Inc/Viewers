import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ViewerEchoPhaseControls, { getViewerEchoPhaseSlots } from './ViewerEchoPhaseControls';

describe('shared Education and Research Echo phase controls', () => {
  test.each([
    ['laVolumeBiplaneDisks', ['A4C', 'A2C']],
    ['laVolumeBiplane', ['A4C', 'A2C']],
    ['rvFAC', ['RV_ED', 'RV_ES']],
    ['ivcCollapsibility', ['IVC_EXP', 'IVC_INSP']],
  ] as const)('%s exposes protocol phases in canonical order', (kind, expected) => {
    expect(getViewerEchoPhaseSlots(kind)).toEqual(expected);
  });

  test('LA uses the existing quiz terminology and drawing technique buttons', () => {
    const html = renderToStaticMarkup(
      <ViewerEchoPhaseControls kind="laVolumeBiplaneDisks" onCapture={() => {}} />
    );
    expect(html).toContain('LA volume contour technique');
    expect(html).toContain('Apical four-chamber');
    expect(html).toContain('Apical two-chamber');
    expect((html.match(/Freehand/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((html.match(/Axis \+ apex/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('Research can show protocol-bound status and disable an absent required frame', () => {
    const html = renderToStaticMarkup(
      <ViewerEchoPhaseControls
        kind="rvFAC"
        onCapture={() => {}}
        blockedPhase={slot => slot === 'RV_ES'}
        renderPhaseStatus={slot => <span>{slot}: saved source</span>}
      />
    );
    expect(html).toContain('RV_ED: saved source');
    expect(html).toContain('RV_ES: saved source');
    expect(html).toContain('disabled=""');
  });

  test('IVC measures two phases with the same controls, without derived RAP', () => {
    const html = renderToStaticMarkup(
      <ViewerEchoPhaseControls kind="ivcCollapsibility" onCapture={() => {}} />
    );
    expect(html).toContain('IVC phase measurements');
    expect(html).toContain('Measure IVCexp');
    expect(html).toContain('Measure IVCinsp');
    expect(html).not.toContain('RAP selection');
  });
});
