import { consumeViewerLengthFirstLabelMode } from './viewerLengthLabelMode';

describe('learner Length first-label dialog lifecycle', () => {
  it('consumes the IVC exemption only for the first newly drawn Length', () => {
    const first = consumeViewerLengthFirstLabelMode({
      mode: 'measure-only', toolName: 'Length', pendingFirstLabel: true,
    });
    expect(first).toEqual({ suppress: true, nextMode: 'prompt' });
    const next = consumeViewerLengthFirstLabelMode({
      mode: first.nextMode, toolName: 'Length', pendingFirstLabel: true,
    });
    expect(next).toEqual({ suppress: false, nextMode: 'prompt' });
  });

  it('never suppresses ordinary prompt-mode Length labels', () => {
    expect(consumeViewerLengthFirstLabelMode({
      mode: 'prompt', toolName: 'Length', pendingFirstLabel: true,
    }).suppress).toBe(false);
  });

  it('never consumes the exemption on older annotations or other tools', () => {
    expect(consumeViewerLengthFirstLabelMode({
      mode: 'measure-only', toolName: 'Length', pendingFirstLabel: false,
    })).toEqual({ suppress: false, nextMode: 'measure-only' });
    expect(consumeViewerLengthFirstLabelMode({
      mode: 'measure-only', toolName: 'SplineROI', pendingFirstLabel: true,
    }).suppress).toBe(false);
  });
});
