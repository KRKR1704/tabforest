import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EnchantedBackdrop } from '../landing/EnchantedBackdrop';
import { GroveGuide } from '../screens/GroveGuide';
import { GUIDE_STEPS } from '../lib/guideGrove';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/** The declarations of the first rule whose selector contains every given part. */
const rule = (...parts: string[]): string => {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) =>
    parts.every((part) => match[1].includes(part))
  );
  if (!found) throw new Error(`no rule for ${parts.join(' ')}`);
  return found[2];
};

describe('pointing at the grove', () => {
  it('brightens a tree or a leaf without moving or resizing anything', () => {
    const tree = rule("[data-kind='tree']:hover");
    const leaf = rule('.leaf:hover');
    for (const declarations of [tree, leaf]) {
      expect(declarations).toMatch(/filter:/);
      expect(declarations).not.toMatch(/transform|width|height|margin|padding/);
    }
  });

  it('lets the other trees step back only a little', () => {
    const others = rule(":has([data-kind='tree']:hover)", ':not(:hover)');
    const brightness = Number(/brightness\(([\d.]+)\)/.exec(others)?.[1]);
    expect(brightness).toBeGreaterThanOrEqual(0.85);
    expect(brightness).toBeLessThanOrEqual(0.95);
  });

  it('leaves a picked tree, a drop target and the grow animation alone', () => {
    const selector = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .map((match) => match[1])
      .find((text) => text.includes("[data-kind='tree']:hover:not"));
    expect(selector).toContain(":not([data-selected='true'])");
    expect(selector).toContain(":not([data-drop-target='true'])");
    expect(selector).toContain(":not([data-growing='true'])");
  });
});

describe('entrances', () => {
  it('play only for people who have not asked for reduced motion', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('@keyframes grove-rise-in'));
    for (const name of ['.grove-guide-backdrop', '.grove-guide ', '.grove-guide-step', '.grove-canvas']) {
      expect(block).toContain(name);
    }
    // Outside that block nothing gives these an animation.
    const outside = css.slice(0, start);
    expect(outside).not.toMatch(/\.grove-guide(-step|-backdrop)? \{[^}]*animation/);
  });

  it('are short, so the page is usable at once', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    const block = css.slice(start, css.indexOf('@keyframes grove-rise-in'));
    const times = [...block.matchAll(/(\d+)ms/g)].map((match) => Number(match[1]));
    expect(times.length).toBeGreaterThan(0);
    for (const ms of times) expect(ms).toBeLessThanOrEqual(300);
  });
});

describe('the tour dialog', () => {
  it('keeps its steps, focus and progress while its words fade between steps', () => {
    const { container } = render(<GroveGuide onDone={() => {}} />);
    expect(container.querySelector('.grove-guide-backdrop .grove-guide')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('grove-guide-step');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(GUIDE_STEPS[1].title);
    expect(heading).toHaveFocus();
    expect(screen.getByText('Step 2 of 11')).toBeInTheDocument();

    const marks = [...container.querySelectorAll('[data-kind="guide-progress"] li')];
    expect(marks).toHaveLength(GUIDE_STEPS.length);
    expect(marks[1]).toHaveClass('bg-forest-300');
    expect(marks[0]).toHaveClass('bg-forest-500');
    expect(marks[2]).toHaveClass('bg-forest-700');
  });
});

describe('the landing backdrop', () => {
  it('has far foliage, and mostly gold fireflies with a couple of muted violet ones', () => {
    const { container } = render(<EnchantedBackdrop />);
    expect(container.querySelector('svg.enchanted-foliage')).not.toBeNull();
    const flies = container.querySelectorAll('.enchanted-fly');
    const violet = container.querySelectorAll('.enchanted-fly-violet');
    expect(flies.length).toBeLessThanOrEqual(10);
    expect(violet.length).toBeGreaterThan(0);
    expect(violet.length).toBeLessThanOrEqual(2);
  });

  it('puts less in the air on a tablet and very little on a phone', () => {
    const { container } = render(<EnchantedBackdrop />);
    const everywhere = (kind: string) =>
      [...container.querySelectorAll(kind)].filter(
        (node) => !node.classList.contains('enchanted-wide') && !node.classList.contains('enchanted-mid')
      ).length;
    const onTablet = (kind: string) =>
      [...container.querySelectorAll(kind)].filter((node) => !node.classList.contains('enchanted-wide')).length;

    expect(onTablet('.enchanted-leaf')).toBeLessThan(container.querySelectorAll('.enchanted-leaf').length);
    expect(everywhere('.enchanted-leaf')).toBeLessThanOrEqual(2);
    expect(everywhere('.enchanted-fly')).toBeLessThanOrEqual(3);
    expect(css).toMatch(/@media \(max-width: 1023px\) \{\s*\.enchanted-wide \{\s*display: none;/);
    expect(css).toMatch(/@media \(max-width: 639px\) \{\s*\.enchanted-mid \{\s*display: none;/);
  });

  it('stays out of the way: hidden from assistive technology and from the pointer', () => {
    const { container } = render(<EnchantedBackdrop />);
    const backdrop = container.querySelector('[data-kind="enchanted-backdrop"]');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop).toHaveClass('pointer-events-none');
  });

  it('varies how the leaves fall', () => {
    const { container } = render(<EnchantedBackdrop />);
    const leaves = [...container.querySelectorAll<HTMLElement>('.enchanted-leaf')];
    expect(new Set(leaves.map((leaf) => leaf.style.opacity)).size).toBeGreaterThan(2);
    expect(new Set(leaves.map((leaf) => leaf.style.animationDuration)).size).toBeGreaterThan(4);
    expect(container.querySelectorAll('.enchanted-leaf-drift').length).toBeGreaterThan(0);
  });
});
