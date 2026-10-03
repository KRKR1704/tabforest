/** In-memory timing only. D-3 owns worker-sleep persistence/reconciliation. */
export class FocusTracker {
  private current: string | null = null;
  private totals = new Map<string, number>();
  private since: number | null = null;
  private windowFocused = false;
  private active = true;

  constructor(private readonly now: () => number = Date.now) {}

  get tabRef(): string | null { return this.current; }

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
