// A promise queue of concurrency 1 (ONB-04, RESEARCH Pitfall 8; T-06-63). The app runs in a
// 1 GB / 1 CPU container: two concurrent 48 MP decodes could run it out of memory, so image
// work is serialised. A failed job never blocks the jobs behind it.

export type Queue = {
  run<T>(job: () => Promise<T>): Promise<T>;
  /** Jobs waiting or running (for tests and a future health view). */
  readonly pending: number;
};

export function createQueue(): Queue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      pending += 1;
      // tail never rejects (see below), so job always starts after the previous one settles.
      const next = tail.then(() => job());
      // The chain continues whatever this job does; the caller still sees its own result.
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next.finally(() => {
        pending -= 1;
      });
    },
    get pending() {
      return pending;
    },
  };
}

/** The process-wide image queue. */
export const imageQueue: Queue = createQueue();

// The process-wide video queue: separate from imageQueue so image uploads never wait behind
// a video (07-13, RESEARCH Pitfall 5).
export const videoQueue: Queue = createQueue();
