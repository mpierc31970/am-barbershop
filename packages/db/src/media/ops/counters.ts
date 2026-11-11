// In-process media origin error counter (07-27 choice 8; MONITOR brief `media.origin_errors_1h`).
// A rolling 1 h window of timestamps, at most MAX_KEPT kept. Fed by the CDN probe when the
// canary object itself is unreadable, and by the `/_media` route when a store read fails with
// anything but not-found. Per-process by design: the monitor reads it from the app process.
// Counts only: no key, path or org is ever recorded.

const MAX_KEPT = 10_000;
export const ORIGIN_ERROR_WINDOW_MS = 3_600_000;

let stamps: number[] = [];

/** Record one origin read failure. */
export function noteMediaOriginError(now: number = Date.now()): void {
  stamps.push(now);
  if (stamps.length > MAX_KEPT) stamps = stamps.slice(stamps.length - MAX_KEPT);
}

/** Failures within `windowMs` before `now` (older entries are pruned as it counts). */
export function mediaOriginErrorsSince(
  now: number = Date.now(),
  windowMs: number = ORIGIN_ERROR_WINDOW_MS,
): number {
  const cut = now - windowMs;
  stamps = stamps.filter((t) => t > cut);
  return stamps.filter((t) => t <= now).length;
}

/** The number of timestamps currently held (tests). */
export function mediaOriginErrorsHeld(): number {
  return stamps.length;
}

export function resetMediaCountersForTests(): void {
  stamps = [];
}
