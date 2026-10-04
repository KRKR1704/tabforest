// Pure helpers for the Privacy screen (SPEC §6.3, §6.4).
import { formatWhen } from './contextCard';

/** The contract's marker for "paused until resumed". */
export const PAUSED_UNTIL_RESUMED = '9999-12-31T23:59:59Z';

export type PauseOption = 'hour' | 'tomorrow' | 'resumed';

/** When a pause ends: in one hour, at the start of tomorrow, or never on its own. */
export function pauseUntil(option: PauseOption, now: Date = new Date()): string {
  if (option === 'resumed') return PAUSED_UNTIL_RESUMED;
  if (option === 'hour') return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0); // the next local midnight
  return tomorrow.toISOString();
}

export function isPaused(pausedUntil: string | null, now: Date = new Date()): boolean {
  if (!pausedUntil) return false;
  const until = Date.parse(pausedUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/** "Capturing", "Paused until Today, 12:51 PM" or "Paused until you resume". */
export function describeCapture(
  pausedUntil: string | null,
  now: Date = new Date(),
  timeZone?: string
): string {
  if (!isPaused(pausedUntil, now)) return 'Capturing';
  // Anything this far off is the "until resumed" marker, not a real time.
  if (new Date(pausedUntil as string).getUTCFullYear() >= 9999) return 'Paused until you resume';
  return `Paused until ${formatWhen(pausedUntil as string, now, timeZone)}`;
}

/**
 * A domain as the API wants it: lowercase, no scheme, path or port. Returns
 * null for anything that is not a domain, so a typo never becomes a rule.
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^\*\./, '');
  value = value.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value)) return null;
  return value;
}

/** Built into the extension's Hollow (SPEC §6.3). Tabs on these never produce an event. */
export const HOLLOW_CATEGORIES: Array<{ name: string; detail: string }> = [
  { name: 'Banking and payments', detail: 'banks, cards, payment and brokerage sites' },
  { name: 'Health portals', detail: 'patient portals, insurers, pharmacies' },
  { name: 'Personal email', detail: 'webmail inboxes' },
  { name: 'Password managers', detail: 'vaults and their web apps' },
  { name: 'Sign-in and auth pages', detail: '/login, /signin, /oauth and identity providers' },
  { name: 'Browser and local pages', detail: 'chrome://, file:// and extension pages' },
  { name: 'Incognito windows', detail: 'the extension cannot run there at all' },
];
