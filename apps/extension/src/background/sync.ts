/// <reference types="vite/client" />
import type { SendPreviewData } from '../../../../contracts/bridge.types';
import type { CaptureEvent } from './emit';
import { EventQueue, type QueueStorage } from './queue';

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8001';
export const SYNC_KEY = 'tf_event_sync';
const INTERVAL = 10_000;
type Receipt = { accepted: number; duplicates: number };
type RetryState = { nextAttempt: number; failures: number; unauthorized: boolean };

export class EventSync {
  private inFlight: Promise<Receipt | null> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastFlush = -Infinity;

  constructor(
    private readonly queue: EventQueue,
    private readonly storage: QueueStorage,
    private readonly options: {
      fetch?: typeof fetch; now?: () => number; apiBase?: string;
      token?: () => Promise<string | null>;
    } = {},
  ) {}

  private now(): number { return (this.options.now ?? Date.now)(); }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => { void this.send(false, false); }, INTERVAL);
  }

  stop(): void { clearInterval(this.timer); this.timer = undefined; }

  onEvent(): Promise<Receipt | null> {
    return this.now() - this.lastFlush >= INTERVAL ? this.send(false, false) : Promise.resolve(null);
  }

  flushNow(): Promise<Receipt | null> { return this.send(false); }
  resendLastBatch(): Promise<Receipt | null> { return this.send(true); }

  private send(resend: boolean, manual = true): Promise<Receipt | null> {
    // Both manual resend and automatic flush share one network slot.
    if (this.inFlight) return Promise.resolve(null);
    this.inFlight = this.perform(resend, manual).catch(() => null).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async backoff(state: RetryState, response?: Response): Promise<void> {
    state.failures += 1;
    let delay = Math.min(300_000, INTERVAL * 2 ** Math.min(state.failures - 1, 5));
    if (response && [429, 503].includes(response.status)) {
      const retry = response.headers.get('Retry-After');
      if (retry !== null) {
        const seconds = /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) * 1000 : Date.parse(retry) - this.now();
        if (Number.isFinite(seconds)) delay = Math.max(delay, seconds);
      }
    }
    state.nextAttempt = this.now() + delay;
    await this.storage.set({ [SYNC_KEY]: state });
  }

  private async perform(resend: boolean, manual: boolean): Promise<Receipt | null> {
    const saved = await this.storage.get(SYNC_KEY);
    const retry: RetryState = (saved[SYNC_KEY] as RetryState | undefined)
      ?? { nextAttempt: 0, failures: 0, unauthorized: false };
    if (!manual && this.now() < retry.nextAttempt) return null;
    const token = await (this.options.token ?? (async () => null))();
    const { dev_user_id } = await this.storage.get('dev_user_id');
    const devUser = typeof dev_user_id === 'string' && dev_user_id ? dev_user_id : null;
    if (!manual && retry.unauthorized && !token && !devUser) return null;
    const events = resend
      ? ((await this.storage.get('last_sent_batch')).last_sent_batch as CaptureEvent[] | undefined) ?? []
      : (await this.queue.snapshot()).events.slice(0, 500);
    if (!events.length) return null;
    this.lastFlush = this.now();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (devUser) headers['X-Dev-User'] = devUser;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${(this.options.apiBase ?? API_BASE).replace(/\/$/, '')}/api/events`, {
        method: 'POST', headers, body: JSON.stringify({ events }),
      });
    } catch { await this.backoff(retry); return null; }
    if (response.status === 401) {
      retry.unauthorized = true;
      await this.backoff(retry);
      return null;
    }
    if (response.status === 422) {
      if (!resend) await this.queue.reject(events);
      return null;
    }
    if (!response.ok) { await this.backoff(retry, response); return null; }
    let receipt: Receipt;
    try { receipt = await response.json(); } catch { await this.backoff(retry); return null; }
    if (!receipt || !Number.isInteger(receipt.accepted) || !Number.isInteger(receipt.duplicates)
      || receipt.accepted < 0 || receipt.duplicates < 0 || receipt.accepted + receipt.duplicates !== events.length) {
      await this.backoff(retry); return null;
    }
    // No queue lock was held during fetch; acknowledge the exact IDs, not a prefix.
    if (!resend) await this.queue.acknowledge(events);
    await this.storage.set({ [SYNC_KEY]: { nextAttempt: 0, failures: 0, unauthorized: false } });
    return { accepted: receipt.accepted, duplicates: receipt.duplicates };
  }

  async sendPreview(): Promise<SendPreviewData> {
    const { events } = await this.queue.snapshot();
    return {
      pending_count: events.length,
      ...(events.length ? { oldest_event_ts: events[0].ts } : {}),
      sample_events: events.slice(0, 5).map(event => ({
        event_id: event.event_id, event_type: event.type, ts: event.ts,
        ...('domain' in event ? { domain: event.domain } : {}),
      })),
    };
  }
}
