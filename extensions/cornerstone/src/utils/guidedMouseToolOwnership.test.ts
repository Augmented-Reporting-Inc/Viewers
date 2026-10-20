import { createGuidedMouseToolOwnership } from './guidedMouseToolOwnership';

function makeToolGroup(initial = 'Length') {
  let current = initial;
  const passive = jest.fn((name: string) => {
    if (current === name) current = '';
  });
  const activate = jest.fn((name: string) => {
    current = name;
  });
  return {
    group: {
      getActivePrimaryMouseButtonTool: () => current,
      hasTool: (name: string) => ['Length', 'Pan', 'WindowLevel'].includes(name),
      setToolPassive: passive,
      setToolActive: activate,
    },
    passive,
    activate,
    setCurrent: (value: string) => { current = value; },
    getCurrent: () => current,
  };
}

describe('guided EF mouse-tool ownership', () => {
  const bindings = [{ mouseButton: 1 }];

  it('keeps Length passive through multiple EF drags and restores it only on completion', () => {
    const focus = createGuidedMouseToolOwnership(bindings);
    const { group, passive, activate, getCurrent } = makeToolGroup('Length');
    focus.start();
    focus.suspend(group);
    expect(getCurrent()).toBe('');
    expect(focus.shouldDeferLengthActivation('Length')).toBe(true);
    expect(focus.shouldDeferLengthActivation('Pan')).toBe(false);

    // Hinge and apex drags, and subsequent contours, do not restore Length.
    focus.suspend(group);
    focus.suspend(group);
    expect(passive).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
    expect(getCurrent()).toBe('');

    focus.restore();
    expect(getCurrent()).toBe('Length');
    expect(activate).toHaveBeenCalledWith('Length', { bindings });
    expect(focus.shouldDeferLengthActivation('Length')).toBe(false);
  });

  it('suspends each viewport tool group while changing from A4C to A2C and restores both', () => {
    const focus = createGuidedMouseToolOwnership(bindings);
    const a4c = makeToolGroup('Length');
    const a2c = makeToolGroup('Pan');
    focus.start();
    focus.suspend(a4c.group);
    focus.suspend(a2c.group);
    expect(a4c.getCurrent()).toBe('');
    expect(a2c.getCurrent()).toBe('');
    focus.restore();
    expect(a4c.getCurrent()).toBe('Length');
    expect(a2c.getCurrent()).toBe('Pan');
  });

  it('never overrides a different tool explicitly selected before cancellation', () => {
    const focus = createGuidedMouseToolOwnership(bindings);
    const tool = makeToolGroup('Length');
    focus.start();
    focus.suspend(tool.group);
    tool.setCurrent('WindowLevel');
    focus.restore();
    expect(tool.getCurrent()).toBe('WindowLevel');
    expect(tool.activate).not.toHaveBeenCalled();
  });

  it('restores once on reset and does not affect regular Length when inactive', () => {
    const focus = createGuidedMouseToolOwnership(bindings);
    const tool = makeToolGroup('Length');
    expect(focus.shouldDeferLengthActivation('Length')).toBe(false);
    focus.suspend(tool.group);
    expect(tool.getCurrent()).toBe('Length');
    focus.start();
    focus.suspend(tool.group);
    focus.start(); // Restarting EF releases the previous session's focus.
    expect(tool.getCurrent()).toBe('Length');
    focus.suspend(tool.group);
    focus.restore();
    focus.restore();
    expect(tool.activate).toHaveBeenCalledTimes(2);
  });
});
