export interface FocusState {
  current: string | null;
  totals: [string, number][];
  since: number | null;
  windowFocused: boolean;
  active: boolean;
}

/** Pure timing; capture owns storage and browser reconciliation. */
export class FocusTracker {
  private current: string | null = null;
  private totals = new Map<string, number>();
  private since: number | null = null;
  private windowFocused = false;
  private active = true;

  constructor(private readonly now: () => number = Date.now) {}

  get tabRef(): string | null { return this.current; }

  checkpoint(at = this.now()): FocusState {
    this.stop(at);
    this.resume(at);
    return { current: this.current, totals: [...this.totals], since: this.since,
      windowFocused: this.windowFocused, active: this.active };
  }

  restore(state: FocusState, lastSeenAt: number, at = this.now()): void {
    this.current = state.current;
    this.totals = new Map(state.totals);
    this.windowFocused = state.windowFocused;
    this.active = state.active;
    this.since = null;
    if (this.current && state.since !== null && state.windowFocused && state.active) {
      const elapsed = Math.min(60_000, Math.max(0, at - lastSeenAt));
      this.totals.set(this.current, (this.totals.get(this.current) ?? 0) + elapsed);
    }
    this.resume(at);
  }

  private stop(at: number): void {
    if (this.current !== null && this.since !== null) {
      this.totals.set(this.current, (this.totals.get(this.current) ?? 0) + Math.max(0, at - this.since));
    }
    this.since = null;
  }

  private resume(at: number): void {
    if (this.current !== null && this.windowFocused && this.active) this.since = at;
  }

  select(tabRef: string | null, at = this.now()): void {
    this.stop(at);
    this.current = tabRef;
    this.resume(at);
  }

  setWindowFocused(focused: boolean, at = this.now()): void {
    this.stop(at);
    this.windowFocused = focused;
    this.resume(at);
  }

  setActive(active: boolean, at = this.now()): void {
    this.stop(at);
    this.active = active;
    this.resume(at);
  }

  /** Consume a FOCUS interval when producing BLUR. Window switches retain totals. */
  take(tabRef: string, at = this.now()): number {
    this.stop(at);
    const elapsed = Math.floor(this.totals.get(tabRef) ?? 0);
    this.totals.delete(tabRef);
    this.resume(at);
    return elapsed;
  }

  remove(tabRef: string, at = this.now()): void {
    if (this.current === tabRef) this.select(null, at);
    this.totals.delete(tabRef);
  }
}
