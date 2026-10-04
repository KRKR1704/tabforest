import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EnchantedBackdrop } from '../landing/EnchantedBackdrop';
import { Landing } from '../landing/Landing';
import { GUIDE_STEPS } from '../lib/guideGrove';

const tour = () => screen.queryByRole('dialog', { name: 'How to read your grove' });

beforeEach(() => sessionStorage.clear());

describe('landing page: the tour opens with the page', () => {
  it('shows the tour as a dialog over the page when asked to', () => {
    render(<Landing tourOnOpen />);
    expect(tour()).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();
    expect(screen.getByText(GUIDE_STEPS[0].browser)).toBeInTheDocument();
    // The page is still there underneath.
    expect(screen.getAllByRole('link', { name: 'Get TabForest for Chrome' }).length).toBe(2);
  });

  it('does not open by itself without that', () => {
    render(<Landing />);
    expect(tour()).toBeNull();
  });

  it('closes, and stays closed for the rest of the visit', () => {
    const first = render(<Landing tourOnOpen />);
    fireEvent.click(screen.getByRole('button', { name: 'Close the tour' }));
    expect(tour()).toBeNull();
    first.unmount();

    // The same visit, page shown again: it does not come back by itself.
    render(<Landing tourOnOpen />);
    expect(tour()).toBeNull();
  });

  it('can be opened again from the page', () => {
    render(<Landing tourOnOpen />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));
    expect(tour()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    expect(tour()).not.toBeNull();
    expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();
  });

  it('opens every time "How it works" is clicked, after going to that section', async () => {
    render(<Landing />);
    const link = screen.getByRole('link', { name: 'How it works' });
    expect(link).toHaveAttribute('href', '#how');

    fireEvent.click(link);
    expect(await screen.findByRole('dialog', { name: 'How to read your grove' })).toBeInTheDocument();

    // Closing it does not stop it opening on the next click.
    fireEvent.click(screen.getByRole('button', { name: 'Close the tour' }));
    expect(tour()).toBeNull();
    fireEvent.click(link);
    expect(await screen.findByRole('dialog', { name: 'How to read your grove' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 11')).toBeInTheDocument();
  });

  it('ends with a button that just closes it, since there is no grove to open here', () => {
    render(<Landing tourOnOpen />);
    for (let i = 1; i < GUIDE_STEPS.length; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('button', { name: 'Open my grove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(tour()).toBeNull();
  });
});

describe('falling leaves', () => {
  it('are large and clear enough to be seen, and still few and slow', () => {
    const { container } = render(<EnchantedBackdrop />);
    const leaves = [...container.querySelectorAll<HTMLElement>('.enchanted-leaf')];
    expect(leaves.length).toBeLessThanOrEqual(8);
    for (const leaf of leaves) {
      expect(parseFloat(leaf.style.width)).toBeGreaterThanOrEqual(16);
      expect(parseFloat(leaf.style.animationDuration)).toBeGreaterThanOrEqual(20);
    }
  });
});
