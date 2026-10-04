import React from 'react';
import { Trees } from 'lucide-react';
import type { ActiveScreen } from '../store/useGroveStore';
import { NAV_ITEMS } from './navigation';

interface LeftRailProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  hollowCount: number;
  /** The signed-in user's name, shown above Sign out. */
  userName?: string;
  onSignOut?: () => void;
  /** Opens the tour of what each thing in the grove means. */
  onOpenGuide?: () => void;
}

function hollowLine(count: number): string {
  if (count === 0) return 'No tabs are resting in the Hollow';
  if (count === 1) return '1 tab is resting in the Hollow';
  return `${count} tabs are resting in the Hollow`;
}

export const LeftRail: React.FC<LeftRailProps> = ({
  activeScreen,
  onNavigate,
  hollowCount,
  userName,
  onSignOut,
  onOpenGuide,
}) => (
  <div className="flex w-14 shrink-0 flex-col border-r border-forest-800 bg-forest-900 md:w-60">
    <div className="flex h-14 items-center justify-center gap-2.5 border-b border-forest-800 md:justify-start md:px-5">
      <Trees className="h-5 w-5 text-forest-400" aria-hidden="true" />
      <span className="sr-only font-serif text-lg font-semibold text-forest-50 md:not-sr-only">TabForest</span>
    </div>

    <nav aria-label="Primary" className="flex-1 overflow-y-auto py-3">
      <ul>
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeScreen;
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
                className={`flex w-full items-center justify-center gap-3 border-l-2 py-2.5 text-left text-sm md:justify-start md:pl-[18px] md:pr-5 ${
                  isActive
                    ? 'border-forest-400 bg-forest-800/60 font-medium text-forest-50'
                    : 'border-transparent text-forest-300 hover:bg-forest-800/30 hover:text-forest-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>

    {onOpenGuide && (
      <button
        type="button"
        onClick={onOpenGuide}
        title="How to read your grove"
        className="border-t border-forest-800 py-3 text-center text-xs text-forest-300 underline-offset-4 hover:text-forest-50 hover:underline md:px-5 md:text-left"
      >
        <span aria-hidden="true" className="text-sm md:hidden">?</span>
        <span className="sr-only md:not-sr-only">How to read your grove</span>
      </button>
    )}

    <p className="hidden border-t border-forest-800 px-5 py-4 text-xs leading-relaxed text-forest-400 md:block">
      {hollowLine(hollowCount)}
    </p>

    {onSignOut && (
      <div className="flex items-center justify-center gap-3 border-t border-forest-800 px-1 py-3 md:justify-between md:px-5">
        <span className="hidden min-w-0 truncate text-xs text-forest-300 md:block">{userName || 'Signed in'}</span>
        <button
          type="button"
          onClick={onSignOut}
          className="text-center text-[11px] leading-tight text-forest-300 underline-offset-4 hover:text-forest-50 hover:underline md:shrink-0 md:text-xs"
        >
          Sign out
        </button>
      </div>
    )}
  </div>
);
