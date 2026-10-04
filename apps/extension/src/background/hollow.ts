import { httpUrl } from './url';

export const BUILTIN_DOMAINS = {
  bankingAndPayments: [
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com',
    'citibank.com', 'capitalone.com', 'usbank.com', 'pnc.com',
    'tdbank.com', 'schwab.com', 'fidelity.com', 'vanguard.com',
    'americanexpress.com', 'discover.com', 'ally.com', 'sofi.com',
    'usaa.com', 'navyfederal.org', 'paypal.com', 'venmo.com',
    'cash.app', 'zellepay.com', 'stripe.com', 'wise.com',
    'coinbase.com', 'robinhood.com',
  ],
  healthPortals: [
    'mychart.com', 'mychart.org', 'myhealth.va.gov', 'kp.org',
    'myuhc.com', 'uhc.com', 'aetna.com', 'cigna.com',
    'anthem.com', 'bcbs.com', 'humana.com', 'zocdoc.com',
    'teladoc.com', 'healow.com',
  ],
  personalEmail: [
    'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
    'mail.yahoo.com', 'mail.aol.com', 'hotmail.com', 'proton.me',
    'protonmail.com', 'icloud.com', 'fastmail.com', 'mail.zoho.com',
  ],
  passwordManagers: [
    '1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com',
    'keepersecurity.com', 'nordpass.com',
  ],
  identityProviders: [
    'accounts.google.com', 'login.microsoftonline.com', 'login.live.com', 'appleid.apple.com',
    'idmsa.apple.com', 'okta.com', 'auth0.com', 'signin.aws.amazon.com',
    'login.gov', 'id.me', 'my.njit.edu', 'cas.njit.edu',
  ],
} as const;

const suffixMatch = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function redactText(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, '[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, '[redacted]')
    .replace(/\d{9,}/g, '[redacted]');
}

export class Hollow {
  private domains: string[] = [];
  private pausedUntil: unknown;
  private resting = new Set<number>();
  private signature = '';

  constructor(private readonly storage: Pick<chrome.storage.LocalStorageArea, 'get'>,
    private readonly now: () => number = Date.now) {}

  async refresh(): Promise<boolean> {
    const [domains, pause] = await Promise.all([
      this.storage.get('user_excluded_domains'), this.storage.get('paused_until'),
    ]);
    this.domains = Array.isArray(domains.user_excluded_domains)
      ? domains.user_excluded_domains.filter((x: unknown): x is string => typeof x === 'string')
        .map((x: string) => x.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean) : [];
    this.pausedUntil = pause.paused_until;
    const until = typeof this.pausedUntil === 'number' ? this.pausedUntil
      : typeof this.pausedUntil === 'string' ? Date.parse(this.pausedUntil) : NaN;
    const signature = JSON.stringify([this.domains, this.pausedUntil, until > this.now()]);
    const changed = signature !== this.signature;
    this.signature = signature;
    return changed;
  }

  excluded(tab: Partial<Pick<chrome.tabs.Tab, 'url' | 'pendingUrl' | 'incognito'>>): boolean {
    const pause = this.pausedUntil;
    if (pause === 'until resumed') return true;
    const until = typeof pause === 'number' ? pause : typeof pause === 'string' ? Date.parse(pause) : NaN;
    if (until > this.now() || tab.incognito) return true;
    const url = httpUrl(tab.pendingUrl ?? tab.url);
    if (!url) return true;
    const domains = [...Object.values(BUILTIN_DOMAINS).flat(), ...this.domains];
    if (domains.some(domain => suffixMatch(url.hostname, domain))) return true;
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return true; }
    return /\/(login|signin|oauth|auth)(\/|$)/i.test(path);
  }

  observe(tab: chrome.tabs.Tab): boolean {
    const excluded = this.excluded(tab);
    if (tab.id !== undefined) {
      if (this.hasPrivacyReason(tab)) this.resting.add(tab.id);
      else this.resting.delete(tab.id);
    }
    return excluded;
  }

  private hasPrivacyReason(tab: chrome.tabs.Tab): boolean {
    // Unsupported pages and pause are capture controls, not private-site counts.
    const url = httpUrl(tab.pendingUrl ?? tab.url);
    if (!url) return false;
    if (tab.incognito) return true;
    const domains = [...Object.values(BUILTIN_DOMAINS).flat(), ...this.domains];
    if (domains.some(domain => suffixMatch(url.hostname, domain))) return true;
    try {
      return /\/(login|signin|oauth|auth)(\/|$)/i.test(decodeURIComponent(url.pathname));
    } catch { return false; }
  }

  restore(ids: number[]): void { this.resting = new Set(ids); }
  remove(id: number): void { this.resting.delete(id); }
  ids(): number[] { return [...this.resting]; }
  hollowCount(): number { return this.resting.size; }
}
