// Test clock (11-20; shared with 11-23's alert jobs). Pass `clock.now()` wherever a module
// takes `now`/`deps.now`; nothing global is patched.
export type FakeClock = {
  now(): Date;
  /** Move forward by `ms` (negative moves back). Returns the new time. */
  advance(ms: number): Date;
  /** Jump to an absolute instant. */
  set(iso: string | Date): Date;
};

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

function parse(iso: string | Date): number {
  const t = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (!Number.isFinite(t))
    throw new Error(`fake clock: bad time ${String(iso)}`);
  return t;
}

/** A clock frozen at `iso` until advanced. */
export function fakeNow(iso: string | Date): FakeClock {
  let t = parse(iso);
  return {
    now: () => new Date(t),
    advance(ms) {
      t += ms;
      return new Date(t);
    },
    set(next) {
      t = parse(next);
      return new Date(t);
    },
  };
}
