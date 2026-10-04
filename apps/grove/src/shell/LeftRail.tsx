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
}) => (
  <div className="flex w-60 shrink-0 flex-col border-r border-forest-800 bg-forest-900">
    <div className="flex h-14 items-center gap-2.5 border-b border-forest-800 px-5">
      <Trees className="h-5 w-5 text-forest-400" aria-hidden="true" />
      <span className="font-serif text-lg font-semibold text-forest-50">TabForest</span>
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
                className={`flex w-full items-center gap-3 border-l-2 py-2.5 pl-[18px] pr-5 text-left text-sm ${
                  isActive
                    ? 'border-forest-400 bg-forest-800/60 font-medium text-forest-50'
                    : 'border-transparent text-forest-300 hover:bg-forest-800/30 hover:text-forest-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>

    <p className="border-t border-forest-800 px-5 py-4 text-xs leading-relaxed text-forest-400">
      {hollowLine(hollowCount)}
    </p>

    {onSignOut && (
      <div className="flex items-center justify-between gap-3 border-t border-forest-800 px-5 py-3">
        <span className="min-w-0 truncate text-xs text-forest-300">{userName || 'Signed in'}</span>
        <button
          type="button"
          onClick={onSignOut}
          className="shrink-0 text-xs text-forest-300 underline-offset-4 hover:text-forest-50 hover:underline"
        >
          Sign out
        </button>
      </div>
    )}
  </div>
);
