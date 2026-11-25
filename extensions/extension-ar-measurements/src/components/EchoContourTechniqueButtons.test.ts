import { EchoContourTechniqueButtons } from './EchoContourTechniqueButtons';

describe('shared Echo contour technique buttons', () => {
  it('provides identical Freehand and Axis + apex options to Education and Research', () => {
    const chosen: string[] = [];
    const view: any = EchoContourTechniqueButtons({
      onChoose: technique => chosen.push(technique),
    });
    const buttons = view.props.children as any[];
    expect(buttons.map(button => button.props.children)).toEqual(['Freehand', 'Axis + apex']);
    expect(buttons.map(button => button.props.type)).toEqual(['button', 'button']);
    const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    buttons[0].props.onClick(event);
    buttons[1].props.onClick(event);
    expect(chosen).toEqual(['freehand', 'axisApex']);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(event.stopPropagation).toHaveBeenCalledTimes(2);
  });
  it('disables both technique controls when the workflow cannot edit the phase', () => {
    const view: any = EchoContourTechniqueButtons({ disabled: true, onChoose: jest.fn() });
    const buttons = view.props.children as any[];
    expect(buttons.every(button => button.props.disabled === true)).toBe(true);
  });
});
