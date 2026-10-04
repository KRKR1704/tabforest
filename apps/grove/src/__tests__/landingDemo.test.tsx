import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { GUIDE_SHOWCASE, GUIDE_STEPS } from '../lib/guideGrove';
import { Landing } from '../landing/Landing';
import { DEMO_ACTIONS } from '../landing/content';
import { GUIDE_PAUSE_MS } from '../screens/GroveGuide';

const pause = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, GUIDE_PAUSE_MS + 60));
  });
};
const demo = (container: HTMLElement) => container.querySelector('#demo') as HTMLElement;
const buttons = () => within(screen.getByRole('group', { name: 'Try a change' }));

describe('landing page: try a change', () => {
  it('offers one button for each step of the tour', () => {
    expect(DEMO_ACTIONS.map((action) => action.step)).toEqual(GUIDE_STEPS.map((step) => step.id));
    render(<Landing />);
    expect(buttons().getAllByRole('button').map((button) => button.textContent)).toEqual([
      'New tab',
      'More time',
      'New path',
      'Open question',
      'Answer it',
      'Confirm a decision',
      'Close a copy',
      'Move a tab',
      'Leave it alone',
      'Come back',
      'New goal',
    ]);
    buttons()
      .getAllByRole('button')
      .forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'));
  });

  it('shows the grove before the change, then after it, and says what happened', async () => {
    const { container } = render(<Landing />);
    fireEvent.click(buttons().getByRole('button', { name: 'New tab' }));

    expect(buttons().getByRole('button', { name: 'New tab' })).toHaveAttribute('aria-pressed', 'true');
    const step = GUIDE_STEPS.find((item) => item.id === 'leaf')!;
    expect(demo(container)).toHaveTextContent(`${step.title}. ${step.browser} ${step.grove}`);
    expect(demo(container).querySelector('[data-tab-ref="g-l9"]')).toBeNull();

    await pause();
    expect(demo(container).querySelector('[data-tab-ref="g-l9"]')).not.toBeNull();
  });

  it('plays the same change again when its button is pressed again', async () => {
    const { container } = render(<Landing />);
    fireEvent.click(buttons().getByRole('button', { name: 'New tab' }));
    await pause();
    expect(demo(container).querySelector('[data-tab-ref="g-l9"]')).not.toBeNull();

    fireEvent.click(buttons().getByRole('button', { name: 'New tab' }));
    expect(demo(container).querySelector('[data-tab-ref="g-l9"]')).toBeNull();
    await pause();
    expect(demo(container).querySelector('[data-tab-ref="g-l9"]')).not.toBeNull();
  });

  it('starts each change from the same example, not from the last one', async () => {
    const { container } = render(<Landing />);
    fireEvent.click(buttons().getByRole('button', { name: 'Leave it alone' }));
    await pause();
    expect(demo(container).querySelector('[data-tree-id="guide-job"]')?.getAttribute('data-canopy')).toBe('amber');

    fireEvent.click(buttons().getByRole('button', { name: 'Open question' }));
    // The job search tree is awake again: this change is about the hackathon tree only.
    expect(demo(container).querySelector('[data-tree-id="guide-job"]')?.getAttribute('data-canopy')).toBe('green');
    expect(demo(container).querySelector('[data-kind="mushroom"]')).toBeNull();
    await pause();
    expect(demo(container).querySelector('[data-kind="mushroom"]')).not.toBeNull();
    expect(buttons().getByRole('button', { name: 'Leave it alone' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('goes back to the full example when the grow is watched again', async () => {
    const { container } = render(<Landing />);
    fireEvent.click(buttons().getByRole('button', { name: 'New goal' }));
    await pause();
    expect(demo(container).querySelectorAll('[data-kind="tree"]')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Watch tabs become a grove' }));
    expect(demo(container).querySelectorAll('[data-kind="tree"]')).toHaveLength(GUIDE_SHOWCASE.trees.length);
    expect(demo(container)).toHaveTextContent('An example:');
    buttons()
      .getAllByRole('button')
      .forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'));
  });
});
