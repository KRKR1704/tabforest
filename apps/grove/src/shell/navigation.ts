import type { LucideIcon } from 'lucide-react';
import {
  Bookmark,
  Briefcase,
  ChartNoAxesGantt,
  MessageCircleQuestion,
  Shield,
  Trees,
} from 'lucide-react';
import type { ActiveScreen } from '../store/useGroveStore';

export interface NavItem {
  id: ActiveScreen;
  label: string;
  /** One line on what the screen is for (SPEC §9.2). */
  description: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'grove',
    label: 'Current Grove',
    description: 'One tree for each goal you are pursuing right now.',
    icon: Trees,
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'How each research path evolved over time.',
    icon: ChartNoAxesGantt,
  },
  {
    id: 'saved',
    label: 'Saved Groves',
    description: 'Contexts you saved, ready to resume.',
    icon: Bookmark,
  },
  {
    id: 'work-context',
    label: 'Work Context',
    description: 'Reconstruct a project from pages, documents and notes you hand over.',
    icon: Briefcase,
  },
  {
    id: 'memory',
    label: 'Ask Memory',
    description: 'Check whether you have researched something before.',
    icon: MessageCircleQuestion,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Pause capture, manage the Hollow and delete your data.',
    icon: Shield,
  },
];

export function navItemFor(screen: ActiveScreen): NavItem {
  return NAV_ITEMS.find((item) => item.id === screen) ?? NAV_ITEMS[0];
}
