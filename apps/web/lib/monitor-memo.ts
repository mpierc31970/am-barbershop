// 15 s module memo for GET /api/monitor/status (13-40, P13-P28; T-13-40-04). The monitor polls
// every 60 s; a burst (or a second monitor) reuses the last document and an in-flight read is
// shared, so PocketBase sees at most one status read per 15 s per process. A failed read is
// not cached. Imported only by the route (server code).

export const MONITOR_MEMO_MS = 15_000;

type Entry<T> = { at: number; value: Promise<T> };
let entry: Entry<unknown> | null = null;

export function memoizedMonitor<T>(
  load: () => Promise<T>,
  nowMs: number = Date.now(),
): Promise<T> {
  if (entry && nowMs - entry.at < MONITOR_MEMO_MS) {
    return entry.value as Promise<T>;
  }
  const value = load();
  const mine: Entry<unknown> = { at: nowMs, value };
  entry = mine;
  value.catch(() => {
    if (entry === mine) entry = null;
  });
  return value;
}

export function resetMonitorMemoForTests(): void {
  entry = null;
}
