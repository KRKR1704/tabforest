import type { CaptureEvent } from './emit';

export const QUEUE_KEY = 'tf_event_queue';
export const QUEUE_CAP = 5000;

export interface QueueStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface QueueState {
  events: CaptureEvent[];
  dropped_events: number;
}

/** One queue instance per worker; all reads and writes share its serial chain. */
export class EventQueue {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: QueueStorage) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    // Return the error to the caller without poisoning later operations.
    this.pending = result.catch(() => {});
    return result;
  }

  private async read(): Promise<QueueState> {
    const data = await this.storage.get(QUEUE_KEY);
    return structuredClone((data[QUEUE_KEY] as QueueState | undefined)
      ?? { events: [], dropped_events: 0 });
  }

  enqueue(event: CaptureEvent): Promise<void> {
    // Snapshot at arrival, not after another asynchronous operation completes.
    const copy = structuredClone(event);
    return this.serial(async () => {
      const state = await this.read();
      state.events.push(copy);
      const overflow = Math.max(0, state.events.length - QUEUE_CAP);
      if (overflow) {
        state.events.splice(0, overflow);
        state.dropped_events += overflow;
      }
      await this.storage.set({ [QUEUE_KEY]: state });
    });
  }

  acknowledge(events: CaptureEvent[]): Promise<void> {
    const batch = structuredClone(events);
    const ids = new Set(batch.map(event => event.event_id));
    return this.serial(async () => {
      const state = await this.read();
      state.events = state.events.filter(event => !ids.has(event.event_id));
      await this.storage.set({ [QUEUE_KEY]: state, last_sent_batch: batch });
    });
  }

  reject(events: CaptureEvent[]): Promise<void> {
    const ids = new Set(events.map(event => event.event_id));
    return this.serial(async () => {
      const state = await this.read();
      const data = await this.storage.get('rejected_events');
      const prior = data.rejected_events as { count: number; event_ids: string[] } | undefined;
      const removed = state.events.filter(event => ids.has(event.event_id));
      state.events = state.events.filter(event => !ids.has(event.event_id));
      await this.storage.set({ [QUEUE_KEY]: state, rejected_events: {
        count: (prior?.count ?? 0) + removed.length,
        event_ids: [...new Set([...(prior?.event_ids ?? []), ...removed.map(event => event.event_id)])],
      } });
    });
  }

  snapshot(): Promise<QueueState> {
    return this.serial(() => this.read());
  }
}
