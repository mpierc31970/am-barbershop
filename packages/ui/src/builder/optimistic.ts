// Optimistic commits for the builder editors (03-REVIEW CR-C01, CR-C02, WR-C01).
//
// Every structural edit (move, delete, layout, item save) shows at once and saves in the
// background. Each commit builds on the latest optimistic value, so commit B carries
// commit A's change. That makes the failure rules subtle, so they live here, framework-free
// and unit tested, and the editors share them:
//
// - The newest commit decides what the owner sees. When it fails, the view goes back to
//   the newest value the server *confirmed* (not to the props, which may be older), and
//   the caller's onRevert runs (a toast).
// - A failed commit that a newer one already superseded changes nothing on screen: the
//   newer commit carries the same change, so its result is this commit's result. Its
//   promise follows the newer commit (a form awaiting it closes as saved, or shows the
//   error, to match what the server really stored).
// - The exception: when a revert happened after this commit was sent, its change is no
//   longer in any newer commit, so it rejects.
// - An older commit that succeeds after the newest one failed moves the view to it, since
//   that is now what the server holds.
// - New props replace the view only when nothing is in flight; otherwise a parent that
//   updates its props after the first success would wipe the view of a later commit.
//
// Server Actions from one client run in order, so "newest confirmed" is what is stored.
import { useEffect, useRef, useState } from "react";

export interface OptimisticHooks<V> {
  /** Show this value, or the props when null. */
  show: (value: V | null) => void;
  /** The newest commit saved (the "Saved" label). */
  saved?: () => void;
}

export class OptimisticCommits<V> {
  private seq = 0;
  private inFlight = 0;
  private confirmedSeq = 0;
  private confirmed: { value: V } | null = null;
  private newestFailed = false;
  private revertedAt = 0;
  private newest: Promise<void> = Promise.resolve();
  private pending: { value: V } | null = null;
  private base: V;
  private readonly hooks: OptimisticHooks<V>;

  constructor(base: V, hooks: OptimisticHooks<V>) {
    this.base = base;
    this.hooks = hooks;
  }

  /** The value the next edit builds on. */
  get latest(): V {
    return this.pending ? this.pending.value : this.base;
  }

  /** True while any commit is still waiting for the server. */
  get busy(): boolean {
    return this.inFlight > 0;
  }

  /**
   * New props. Adopted only when nothing is in flight; returns true when the optimistic
   * view was dropped in favour of them.
   */
  setBase(base: V): boolean {
    this.base = base;
    if (this.inFlight > 0) return false;
    this.pending = null;
    this.confirmed = null;
    return true;
  }

  /**
   * Show `next` now and save it. Resolves when the change is stored (by this commit or a
   * newer one that carries it); rejects when it is not.
   */
  commit(
    next: V,
    save: (value: V) => Promise<void>,
    onRevert?: () => void,
  ): Promise<void> {
    const n = ++this.seq;
    this.inFlight += 1;
    this.newestFailed = false;
    this.pending = { value: next };
    this.hooks.show(next);
    const p = Promise.resolve()
      .then(() => save(next))
      .then(
        () => {
          this.inFlight -= 1;
          if (n > this.confirmedSeq) {
            this.confirmedSeq = n;
            this.confirmed = { value: next };
          }
          if (n === this.seq) this.hooks.saved?.();
          else if (this.newestFailed) this.revert();
        },
        (err: unknown) => {
          this.inFlight -= 1;
          if (n === this.seq) {
            this.newestFailed = true;
            this.revert();
            onRevert?.();
            throw err;
          }
          // A revert after this commit was sent dropped its change from every newer one.
          if (this.revertedAt >= n) throw err;
          // Superseded: the newer commit carries this change, so its result decides.
          return this.newest;
        },
      );
    this.newest = p;
    return p;
  }

  private revert(): void {
    this.revertedAt = this.seq;
    this.pending = this.confirmed ? { value: this.confirmed.value } : null;
    this.hooks.show(this.pending ? this.pending.value : null);
  }
}

/**
 * React binding: `value` is what to draw, `tracker.latest` is what the next edit builds
 * on, `tracker.commit` saves. `base` must be referentially stable between renders
 * (memoize it), because a new identity counts as new props.
 */
export function useOptimisticCommits<V>(
  base: V,
  onSaved?: () => void,
): { value: V; tracker: OptimisticCommits<V> } {
  const [pending, setPending] = useState<{ value: V } | null>(null);
  const savedRef = useRef(onSaved);
  useEffect(() => {
    savedRef.current = onSaved;
  });
  const [tracker] = useState(
    () =>
      new OptimisticCommits<V>(base, {
        show: (v) => setPending(v === null ? null : { value: v }),
        saved: () => savedRef.current?.(),
      }),
  );
  useEffect(() => {
    if (tracker.setBase(base)) setPending(null);
  }, [tracker, base]);
  return { value: pending ? pending.value : base, tracker };
}
