import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GUIDE_KEY, GUIDE_SHOWCASE } from '../lib/guideGrove';
import { countGroveTabs } from '../lib/grove';
import { Landing } from '../landing/Landing';
import {
  EXTENSION_ZIP_URL,
  INSTALL_NOTES,
  INSTALL_STEPS,
  PRIVACY_PARAGRAPH,
} from '../landing/content';
import { computeGroveLayout } from '../viz/layout';

const setReducedMotion = (reduced: boolean) => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) => ({ matches: reduced, media: query }) as MediaQueryList
  );
};
afterEach(() => setReducedMotion(true));

const stepText = (step: (typeof INSTALL_STEPS)[number]) =>
  `${step.text}${step.mark?.text ?? ''}${step.after ?? ''}`;

describe('landing page content', () => {
  it('has the seven install steps from lane D, in order', () => {
    expect(INSTALL_STEPS.map(stepText)).toEqual([
      'Download the zip and unzip it.',
      'In Chrome, type chrome://extensions in the address bar and press Enter.',
      'Turn on Developer mode (top right).',
      'Click Load unpacked and choose the unzipped folder.',
      'Click the puzzle-piece icon in the toolbar and pin TabForest.',
      'Click the TabForest icon to open your Grove.',
      'Click Sign in with Microsoft and finish the Microsoft window.',
    ]);
  });

  it('downloads the zip from the latest GitHub release', () => {
    expect(EXTENSION_ZIP_URL).toBe(
      'https://github.com/KRKR1704/tabforest/releases/latest/download/tabforest-extension.zip'
    );
  });

  it('quotes the privacy document word for word', () => {
    const doc = readFileSync(resolve(__dirname, '../../../../docs/privacy.md'), 'utf-8');
    const section = doc.split('## In one paragraph')[1].split('\n## ')[0].trim();
    expect(PRIVACY_PARAGRAPH).toBe(section);
  });

  it('says "should", not "will", about other browsers, and does not promise data survives an update', () => {
    const notes = INSTALL_NOTES.flatMap((note) => note.lines).join(' ');
    expect(notes).toContain('Tested in Chrome. Edge and Brave should work.');
    expect(notes).not.toMatch(/will work|your data (is|stays) (kept|safe)/i);
  });

  it('shows an example grove with everything in the key on it', () => {
    const layout = computeGroveLayout(GUIDE_SHOWCASE);
    const mushrooms = layout.trees.flatMap((tree) => tree.mushrooms);
    expect(mushrooms.some((m) => !m.resolved)).toBe(true);
    expect(mushrooms.some((m) => m.resolved)).toBe(true);
    expect(layout.trees.flatMap((tree) => tree.stones).some((s) => s.kind === 'carved')).toBe(true);
    expect(layout.trees.filter((tree) => tree.dormant)).toHaveLength(1);
  });
});

describe('Landing page', () => {
  it('opens with what TabForest is and a way to get it', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You opened those tabs for a reason.');
    const get = screen.getAllByRole('link', { name: 'Get TabForest for Chrome' });
    expect(get.length).toBe(2);
    get.forEach((link) => expect(link).toHaveAttribute('href', '#install'));
    // It is not a one-click install, so it never says so.
    expect(screen.queryByText(/Add to Chrome/)).not.toBeInTheDocument();
  });

  it('has the sections the page links to', () => {
    const { container } = render(<Landing />);
    const nav = within(screen.getByRole('navigation', { name: 'Page' }));
    for (const [name, id] of [
      ['How it works', 'how'],
      ['What it shows', 'key'],
      ['Privacy', 'privacy'],
      ['Install', 'install'],
    ]) {
      expect(nav.getByRole('link', { name })).toHaveAttribute('href', `#${id}`);
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it('shows the example tabs above the grove they turn into', () => {
    const { container } = render(<Landing />);
    const demo = container.querySelector('#demo') as HTMLElement;
    expect(demo.querySelector('svg.grove-canvas')).not.toBeNull();
    expect(demo.querySelectorAll('[data-kind="tree"]')).toHaveLength(GUIDE_SHOWCASE.trees.length);
    expect(demo.querySelectorAll('[data-sorted] > div')).toHaveLength(countGroveTabs(GUIDE_SHOWCASE));
    expect(demo).toHaveTextContent(`An example: ${countGroveTabs(GUIDE_SHOWCASE)} tabs, 3 goals.`);
  });

  it('plays the grow when asked, and only then', () => {
    setReducedMotion(false);
    const { container } = render(<Landing />);
    const svg = container.querySelector('svg.grove-canvas') as SVGSVGElement;
    expect(svg.hasAttribute('data-growing')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Watch tabs become a grove' }));
    expect(container.querySelector('svg.grove-canvas')?.getAttribute('data-growing')).toBe('true');
    expect(container.querySelector('[data-sorted]')?.getAttribute('data-sorted')).toBe('true');
  });

  it('explains every thing in the grove', () => {
    render(<Landing />);
    const section = document.getElementById('key') as HTMLElement;
    expect(within(section).getAllByRole('listitem')).toHaveLength(GUIDE_KEY.length);
    expect(within(section).getByText('A mushroom')).toBeInTheDocument();
    expect(within(section).getByText('A question you have not answered yet.')).toBeInTheDocument();
    expect(within(section).getByText('An amber tree')).toBeInTheDocument();
  });

  it('quotes the privacy paragraph and lists what is never collected', () => {
    render(<Landing />);
    const section = document.getElementById('privacy') as HTMLElement;
    expect(section).toHaveTextContent(PRIVACY_PARAGRAPH);
    expect(section).toHaveTextContent('privacy document, word for word.');
    expect(within(section).getByText('Passwords and cookies')).toBeInTheDocument();
    expect(within(section).getByText('Banking and payments')).toBeInTheDocument();
  });

  it('gives the download and the seven steps, with the words Chrome shows marked', () => {
    render(<Landing />);
    expect(screen.getByRole('link', { name: 'Download TabForest (.zip)' })).toHaveAttribute(
      'href',
      EXTENSION_ZIP_URL
    );
    const steps = within(screen.getByRole('list', { name: 'Install steps' })).getAllByRole('listitem');
    expect(steps).toHaveLength(7);
    expect(steps[1]).toHaveTextContent('In Chrome, type chrome://extensions in the address bar and press Enter.');
    expect(steps[1].querySelector('code')).toHaveTextContent('chrome://extensions');
    expect(steps[3]).toHaveTextContent('Click “Load unpacked” and choose the unzipped folder.');
    expect(
      screen.getByText('Chrome may show a note about developer-mode extensions. That is normal.')
    ).toBeInTheDocument();
    const next = within(screen.getByRole('list', { name: 'What happens next' })).getAllByRole('listitem');
    expect(next).toHaveLength(4);
  });

  it('promises nothing lane D said not to promise', () => {
    const { container } = render(<Landing />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Prompt Shields/i);
    expect(text).not.toMatch(/any Microsoft account/i);
    expect(text).not.toMatch(/fallback|email login|password login/i);
    expect(text).not.toMatch(/Edge and Brave will/i);
    // The only mention of the store says it is not there yet.
    expect(text.match(/Web Store/g)).toHaveLength(1);
    expect(text).toContain('not on the Chrome Web Store yet');
  });
});
