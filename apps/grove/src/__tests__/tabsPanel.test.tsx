import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { resetMockBridge, sendBridgeMessage } from '../adapters/bridge';
import { TabsPanel } from '../components/TabsPanel';
import { countGroveTabs } from '../lib/grove';
import { groupNote, listTabs } from '../lib/tabList';
import { mockGroveResponse } from '../mocks/mockData';
import { CurrentGrove } from '../screens/CurrentGrove';
import { useGroveStore } from '../store/useGroveStore';
import { GroveCanvas } from '../viz/GroveCanvas';
import type { GroveResponse } from '../types';

// The real bridge, wrapped so tests can see which messages were sent.
vi.mock('../adapters/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/bridge')>();
  return { ...actual, sendBridgeMessage: vi.fn(actual.sendBridgeMessage) };
});
const bridge = vi.mocked(sendBridgeMessage);
const sent = (type: string) => bridge.mock.calls.filter(([t]) => t === type).map(([, payload]) => payload);

const grove = mockGroveResponse;
const groups = listTabs(grove);
const allRows = groups.flatMap((group) => group.sections.flatMap((section) => section.rows));
const auth = grove.trees[0];
const authGroup = groups[0];
const exactGroup = auth.redundant_groups.find((group) => group.is_exact_dup) ?? auth.redundant_groups[0];
const copyRef = exactGroup.tab_refs.find((ref) => ref !== exactGroup.keep_ref)!;

beforeEach(() => {
  resetMockBridge();
  bridge.mockClear();
  useGroveStore.setState({ grove, isStreaming: false, groveNotice: null });
});

describe('listTabs', () => {
  it('lists every tab the grove shows, grouped by goal, then sprouts, meadow and unclear', () => {
    // A tab that serves two goals has a row on each, as it has a leaf on each.
    const shared = new Set(grove.trees.flatMap((tree) => tree.shared_tab_refs ?? []));
    expect(allRows).toHaveLength(countGroveTabs(grove));
    expect(new Set(allRows.map((row) => row.key)).size).toBe(allRows.length);
    expect(shared.size).toBeGreaterThan(0);

    expect(groups.map((group) => group.kind)).toEqual([
      ...grove.trees.map(() => 'tree'),
      ...grove.sprouts.map(() => 'sprout'),
      'meadow',
      'fog',
    ]);
    expect(groups.slice(0, grove.trees.length).map((group) => group.name)).toEqual(
      grove.trees.map((tree) => tree.project.name)
    );
  });

  it('puts each tab under the path it hangs on', () => {
    expect(authGroup.sections.map((section) => section.label)).toEqual(
      auth.branches.filter((branch) => branch.tab_refs.length > 0).map((branch) => branch.label)
    );
    auth.branches.forEach((branch) => {
      const section = authGroup.sections.find((item) => item.label === branch.label);
      expect(section?.rows.map((row) => row.tabRef)).toEqual(branch.tab_refs);
    });
  });

  it('says which tab of a duplicate group is kept and which are copies', () => {
    const kept = authGroup.sections.flatMap((s) => s.rows).find((row) => row.tabRef === exactGroup.keep_ref)!;
    const copy = authGroup.sections.flatMap((s) => s.rows).find((row) => row.tabRef === copyRef)!;
    const keptTitle = auth.tabs.find((tab) => tab.tab_ref === exactGroup.keep_ref)!.title;

    expect(kept.duplicate?.kind).toBe('kept');
    expect(kept.duplicate?.text).toMatch(/^Kept · \d+ (copy|copies|overlapping tabs?)$/);
    expect(kept.duplicateRefs).toContain(copyRef);
    expect(copy.duplicate?.kind).toMatch(/copy|overlap/);
    expect(copy.duplicate?.text).toContain(keptTitle);
    expect(copy.duplicateRefs).toContain(exactGroup.keep_ref);
  });

  it('leaves a tab with no copies unmarked', () => {
    const inGroups = new Set(grove.trees.flatMap((tree) => tree.redundant_groups.flatMap((g) => [g.keep_ref, ...g.tab_refs])));
    for (const row of allRows) {
      if (!inGroups.has(row.tabRef)) {
        expect(row.duplicate).toBeNull();
        expect(row.duplicateRefs).toEqual([]);
      }
    }
  });

  it('says when a tab also serves another goal', () => {
    const sharedRef = auth.shared_tab_refs![0];
    const rows = allRows.filter((row) => row.tabRef === sharedRef);
    expect(rows).toHaveLength(2);
    expect(rows[0].alsoOn).toEqual([grove.trees[1].project.name]);
    expect(rows[1].alsoOn).toEqual([auth.project.name]);
  });

  it('carries the reason an unclear tab could not be placed', () => {
    const fog = groups.find((group) => group.kind === 'fog')!;
    expect(fog.name).toBe('Unclear');
    expect(fog.sections[0].rows[0].reason).toBe(grove.fog![0].reason);
  });

  it('marks closed and stale tabs', () => {
    const [first, ...rest] = auth.tabs;
    const changed: GroveResponse = {
      ...grove,
      trees: [{ ...auth, tabs: [{ ...first, is_open: false, fallen: true }, ...rest] }, ...grove.trees.slice(1)],
    };
    const row = listTabs(changed)[0].sections.flatMap((s) => s.rows).find((item) => item.tabRef === first.tab_ref)!;
    expect(row.isOpen).toBe(false);
    expect(row.fallen).toBe(true);
  });

  it('describes each kind of group in words', () => {
    expect(groupNote(authGroup)).toBe(`Goal · ${auth.tabs.length} tabs`);
    expect(groupNote({ ...authGroup, pending: true })).toMatch(/^Listening…/);
    expect(groupNote(groups.find((g) => g.kind === 'sprout')!)).toMatch(/^Sprout, not yet a goal/);
    expect(groupNote(groups.find((g) => g.kind === 'meadow')!)).toMatch(/^No goal/);
    expect(groupNote(groups.find((g) => g.kind === 'fog')!)).toBe('Could not be placed · 1 tab');
  });
});

describe('TabsPanel', () => {
  const show = (hovered: Parameters<typeof TabsPanel>[0]['hovered'] = null) => {
    const onHover = vi.fn();
    const onOpenTab = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <TabsPanel grove={grove} hovered={hovered} onHover={onHover} onOpenTab={onOpenTab} onClose={onClose} />
    );
    return { ...view, onHover, onOpenTab, onClose };
  };

  it('shows every tab with its site, under its goal and path', () => {
    show();
    const panel = within(screen.getByRole('complementary', { name: 'Tabs' }));
    expect(panel.getByRole('heading', { level: 2 })).toHaveTextContent(`Tabs · ${countGroveTabs(grove)}`);
    const group = within(panel.getByRole('region', { name: auth.project.name }));
    expect(group.getByText(auth.branches[0].label)).toBeInTheDocument();
    expect(group.getAllByRole('button')).toHaveLength(auth.tabs.length);
    expect(panel.getByRole('region', { name: 'Unclear' })).toHaveTextContent(grove.fog![0].reason);
  });

  it('reports the tab being pointed at, and when the pointer leaves', () => {
    const { container, onHover } = show();
    const row = container.querySelector(`[data-tab-row="${copyRef}"]`) as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(onHover).toHaveBeenLastCalledWith({ tabRef: copyRef, treeId: auth.cluster_ref });
    fireEvent.focus(row);
    expect(onHover).toHaveBeenLastCalledWith({ tabRef: copyRef, treeId: auth.cluster_ref });
    fireEvent.blur(row);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('marks the pointed-at tab and its copies', () => {
    const { container } = show({ tabRef: exactGroup.keep_ref, treeId: auth.cluster_ref });
    const marked = container.querySelectorAll('[data-hovered="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-tab-row')).toBe(exactGroup.keep_ref);
    expect(container.querySelector(`[data-tab-row="${copyRef}"]`)?.getAttribute('data-copy')).toBe('true');
  });

  it('marks only the row on the same tree for a tab that serves two goals', () => {
    const sharedRef = auth.shared_tab_refs![0];
    const { container } = show({ tabRef: sharedRef, treeId: grove.trees[1].cluster_ref });
    const marked = container.querySelectorAll('[data-hovered="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('section')?.getAttribute('aria-label')).toBe(grove.trees[1].project.name);
  });

  it('opens a tab on click and can be hidden', () => {
    const { container, onOpenTab, onClose } = show();
    fireEvent.click(container.querySelector(`[data-tab-row="${copyRef}"]`) as HTMLElement);
    expect(onOpenTab).toHaveBeenCalledWith(copyRef);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes page titles as text, never as markup', () => {
    const [first, ...rest] = auth.tabs;
    const hostile: GroveResponse = {
      ...grove,
      trees: [{ ...auth, tabs: [{ ...first, title: '<img src=x onerror=alert(1)>' }, ...rest] }, ...grove.trees.slice(1)],
    };
    const { container } = render(
      <TabsPanel grove={hostile} hovered={null} onHover={() => {}} onOpenTab={() => {}} onClose={() => {}} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});

describe('GroveCanvas highlight', () => {
  it('lights the leaf, the branch it hangs on, and its copies on the same tree', () => {
    const { container, rerender } = render(<GroveCanvas grove={grove} />);
    expect(container.querySelector('[data-hover]')).toBeNull();

    rerender(
      <GroveCanvas
        grove={grove}
        highlight={{ tabRef: exactGroup.keep_ref, treeId: auth.cluster_ref, copyRefs: [copyRef] }}
      />
    );
    const lit = container.querySelectorAll('[data-hover="true"]');
    expect(lit).toHaveLength(1);
    expect(lit[0].getAttribute('data-tab-ref')).toBe(exactGroup.keep_ref);
    expect(lit[0].closest('[data-kind="branch"]')?.getAttribute('data-hover-branch')).toBe('true');
    expect(container.querySelectorAll('[data-hover-branch="true"]')).toHaveLength(1);
    const copies = container.querySelectorAll('[data-hover-copy="true"]');
    expect(copies).toHaveLength(1);
    expect(copies[0].getAttribute('data-tab-ref')).toBe(copyRef);

    rerender(<GroveCanvas grove={grove} highlight={null} />);
    expect(container.querySelector('[data-hover], [data-hover-branch], [data-hover-copy]')).toBeNull();
  });

  it('lights only the leaf on the named tree when a tab serves two goals', () => {
    const sharedRef = auth.shared_tab_refs![0];
    const { container } = render(
      <GroveCanvas grove={grove} highlight={{ tabRef: sharedRef, treeId: grove.trees[1].cluster_ref }} />
    );
    const lit = container.querySelectorAll('[data-hover="true"]');
    expect(lit).toHaveLength(1);
    expect(lit[0].closest('[data-tree-id]')?.getAttribute('data-tree-id')).toBe(grove.trees[1].cluster_ref);
  });

  it('reports the leaf under the pointer, and when the pointer leaves it', () => {
    const onHoverLeaf = vi.fn();
    const { container } = render(<GroveCanvas grove={grove} onHoverLeaf={onHoverLeaf} />);
    const leaf = container.querySelector(`[data-tab-ref="${copyRef}"]`) as Element;
    fireEvent.mouseOver(leaf);
    expect(onHoverLeaf).toHaveBeenLastCalledWith({ tabRef: copyRef, treeId: auth.cluster_ref });
    fireEvent.mouseOut(leaf);
    expect(onHoverLeaf).toHaveBeenLastCalledWith(null);

    onHoverLeaf.mockClear();
    fireEvent.mouseOver(container.querySelector('[data-kind="trunk"]') as Element);
    expect(onHoverLeaf).not.toHaveBeenCalled();
  });
});

describe('Tabs panel in Current Grove', () => {
  const open = () => {
    const view = render(<CurrentGrove grove={grove} onShowEvidence={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show tabs' }));
    return view;
  };

  it('is closed until asked for, and can be closed again', () => {
    render(<CurrentGrove grove={grove} onShowEvidence={() => {}} />);
    expect(screen.queryByRole('complementary', { name: 'Tabs' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show tabs' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(screen.getByRole('complementary', { name: 'Tabs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide tabs' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('complementary', { name: 'Tabs' })).not.toBeInTheDocument();
  });

  it('pointing at a row lights its leaf, its branch and its copies on the canvas', () => {
    const { container } = open();
    fireEvent.mouseEnter(container.querySelector(`[data-tab-row="${exactGroup.keep_ref}"]`) as HTMLElement);

    const leaf = container.querySelector('svg [data-hover="true"]');
    expect(leaf?.getAttribute('data-tab-ref')).toBe(exactGroup.keep_ref);
    expect(leaf?.closest('[data-kind="branch"]')?.getAttribute('data-hover-branch')).toBe('true');
    // This tab is the kept one for two groups, so every copy of it is lit.
    const lit = [...container.querySelectorAll('svg [data-hover-copy="true"]')].map((node) =>
      node.getAttribute('data-tab-ref')
    );
    expect(lit).toContain(copyRef);
    expect(lit.sort()).toEqual([...new Set(auth.redundant_groups.flatMap((g) => g.tab_refs))].filter((ref) => ref !== exactGroup.keep_ref).sort());

    fireEvent.mouseLeave(screen.getByRole('complementary', { name: 'Tabs' }).querySelector('.overflow-y-auto') as Element);
    expect(container.querySelector('svg [data-hover]')).toBeNull();
  });

  it('pointing at a leaf lights its row in the panel', () => {
    const { container } = open();
    const leaf = container.querySelector(`svg [data-tab-ref="${copyRef}"]`) as Element;
    fireEvent.mouseOver(leaf);
    expect(container.querySelector(`[data-tab-row="${copyRef}"]`)?.getAttribute('data-hovered')).toBe('true');
    fireEvent.mouseOut(leaf);
    expect(container.querySelector('[data-hovered="true"]')).toBeNull();
  });

  it('opens the tab through the bridge when a row is clicked', () => {
    const { container } = open();
    fireEvent.click(container.querySelector(`[data-tab-row="${copyRef}"]`) as HTMLElement);
    expect(sent('OPEN_TAB')).toEqual([{ tab_ref: copyRef }]);
  });

  it('is not offered in the Outline view, which already lists the tabs', () => {
    render(<CurrentGrove grove={grove} onShowEvidence={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    expect(screen.queryByRole('button', { name: 'Show tabs' })).not.toBeInTheDocument();
  });

  it('does nothing on the canvas while the panel is closed', () => {
    const { container } = render(<CurrentGrove grove={grove} onShowEvidence={() => {}} />);
    fireEvent.mouseOver(container.querySelector(`svg [data-tab-ref="${copyRef}"]`) as Element);
    expect(container.querySelector('svg [data-hover]')).toBeNull();
  });
});
