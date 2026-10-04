import React, { useEffect, useMemo, useRef } from 'react';
import { groupNote, listTabs, type TabRow } from '../lib/tabList';
import type { GroveResponse } from '../types';

/** The tab the pointer or the keyboard is on, in the panel or on the canvas. */
export interface TabHover {
  tabRef: string;
  /** The tree it sits on; left out for sprouts, the meadow and the Unclear patch. */
  treeId?: string | null;
}

interface TabsPanelProps {
  grove: GroveResponse;
  /** The tab highlighted right now, wherever the highlight came from. */
  hovered: TabHover | null;
  onHover: (hover: TabHover | null) => void;
  onOpenTab: (tabRef: string) => void;
  onClose: () => void;
}

const sameTab = (row: TabRow, hover: TabHover | null) =>
  hover !== null &&
  hover.tabRef === row.tabRef &&
  (hover.treeId === undefined || hover.treeId === null || row.treeId === null || hover.treeId === row.treeId);

/**
 * Every tab in the grove as a list, grouped by goal and path. Pointing at a row
 * lights its leaf and branch on the canvas; pointing at a leaf lights its row.
 */
export const TabsPanel: React.FC<TabsPanelProps> = ({ grove, hovered, onHover, onOpenTab, onClose }) => {
  const groups = useMemo(() => listTabs(grove), [grove]);
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const list = useRef<HTMLDivElement>(null);

  // A leaf pointed at on the canvas brings its row into view.
  useEffect(() => {
    if (!hovered) return;
    const row = list.current?.querySelector('[data-hovered="true"]');
    if (row && !row.matches(':hover, :focus')) row.scrollIntoView?.({ block: 'nearest' });
  }, [hovered]);

  // The other copies of the hovered tab, so they can be marked too.
  const copies = useMemo(() => {
    if (!hovered) return new Set<string>();
    for (const group of groups) {
      for (const section of group.sections) {
        const row = section.rows.find((item) => sameTab(item, hovered));
        if (row) return new Set(row.duplicateRefs.map((ref) => `${row.treeId}|${ref}`));
      }
    }
    return new Set<string>();
  }, [groups, hovered]);

  return (
    <aside
      aria-label="Tabs"
      className="flex h-full w-80 shrink-0 flex-col border-r border-forest-800 bg-forest-900"
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3 border-b border-forest-800 px-4 py-3">
        <h2 className="font-serif text-base font-semibold text-forest-50">
          Tabs <span className="font-sans text-xs font-normal text-forest-400">· {total}</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-forest-300 underline-offset-4 hover:text-forest-50 hover:underline"
        >
          Hide
        </button>
      </div>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto pb-4" onMouseLeave={() => onHover(null)}>
        {total === 0 && <p className="px-4 py-4 text-sm text-forest-300">No tabs in this grove.</p>}
        {groups.map((group) => (
          <section key={group.id} aria-label={group.name} className="border-b border-forest-800 px-4 py-3">
            <h3 className="font-serif text-sm font-semibold text-forest-50">{group.name}</h3>
            <p className="text-[11px] text-forest-400">{groupNote(group)}</p>

            {group.sections.map((section, index) => (
              <div key={`${section.label}-${index}`} className="mt-2">
                {section.label && (
                  <p className="text-[11px] font-medium uppercase tracking-wider text-forest-400">
                    {section.label}
                  </p>
                )}
                <ul className="mt-1">
                  {section.rows.map((row) => {
                    const isHovered = sameTab(row, hovered);
                    const isCopy = copies.has(row.key);
                    return (
                      <li key={row.key}>
                        <button
                          type="button"
                          data-tab-row={row.tabRef}
                          data-hovered={isHovered ? 'true' : undefined}
                          data-copy={isCopy ? 'true' : undefined}
                          onMouseEnter={() => onHover({ tabRef: row.tabRef, treeId: row.treeId })}
                          onFocus={() => onHover({ tabRef: row.tabRef, treeId: row.treeId })}
                          onBlur={() => onHover(null)}
                          onClick={() => onOpenTab(row.tabRef)}
                          className={`block w-full rounded-sm border-l-2 px-2 py-1.5 text-left ${
                            isHovered
                              ? 'border-forest-400 bg-forest-800'
                              : isCopy
                                ? 'border-amberCanopy-light bg-forest-800/50'
                                : 'border-transparent hover:bg-forest-800/60'
                          }`}
                        >
                          <span className={`block truncate text-sm ${row.isOpen ? 'text-forest-50' : 'text-forest-300'}`}>
                            {row.title}
                          </span>
                          <span className="block truncate text-[11px] text-forest-400">
                            {[
                              row.domain,
                              !row.isOpen && 'closed',
                              row.fallen && 'not visited lately',
                              row.reason,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          {row.duplicate && (
                            <span className="block truncate text-[11px] text-amberCanopy-light">
                              {row.duplicate.text}
                            </span>
                          )}
                          {row.alsoOn.length > 0 && (
                            <span className="block truncate text-[11px] text-forest-300">
                              Also on {row.alsoOn.join(', ')}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
};
