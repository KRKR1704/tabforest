import React from 'react';
import type { ActiveScreen } from '../store/useGroveStore';
import { LeftRail } from './LeftRail';
import { TopBar } from './TopBar';
import { navItemFor } from './navigation';

interface AppShellProps {
  activeScreen: ActiveScreen;
  onNavigate: (screen: ActiveScreen) => void;
  hollowCount: number;
  userName?: string;
  onSignOut?: () => void;
  openQuestionCount: number;
  isGrowing?: boolean;
  onGrow?: () => void;
  onAskMemory?: (query: string) => void;
  /** Rendered to the right of the screen, e.g. the evidence drawer. */
  drawer?: React.ReactNode;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  activeScreen,
  onNavigate,
  hollowCount,
  userName,
  onSignOut,
  openQuestionCount,
  isGrowing,
  onGrow,
  onAskMemory,
  drawer,
  children,
}) => (
  <div className="flex h-screen bg-forest-950 font-sans text-forest-50">
    <LeftRail
      activeScreen={activeScreen}
      onNavigate={onNavigate}
      hollowCount={hollowCount}
      userName={userName}
      onSignOut={onSignOut}
    />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar
        title={navItemFor(activeScreen).label}
        openQuestionCount={openQuestionCount}
        isGrowing={isGrowing}
        onGrow={onGrow}
        onAskMemory={onAskMemory}
      />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        {drawer}
      </div>
    </div>
  </div>
);
