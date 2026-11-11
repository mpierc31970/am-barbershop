// Per-organization in-process mutex for content writes (T-03-24; members.ts pattern, which
// stays untouched). Sort-order renumbering and slug checks read before they write, so the
// content writers of one organization run one at a time. A second app process could still
// race; accepted at the 10-50 tenant target scale (RESEARCH A2). Internal: never exported
// from index.ts.
const chains = new Map<string, Promise<unknown>>();

export function withOrgLock<T>(
  orgId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(orgId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(orgId, tail);
  void tail.then(() => {
    if (chains.get(orgId) === tail) chains.delete(orgId);
  });
  return run;
}
