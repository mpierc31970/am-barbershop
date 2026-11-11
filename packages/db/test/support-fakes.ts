// P12 Wave 0 fakes (12-01; 12-VALIDATION Wave 0). Every support function takes an injectable
// scanner and clock (12-EXECUTOR-BRIEF); tests pass these instead of the fail-closed stand-in.
import type { FileScanner, FileScanVerdict } from "../src/forms/scanner-port";

export type FakeScanner = FileScanner & {
  /** How many files were scanned. */
  calls: number;
  /** Change the verdict for later scans (e.g. a rescan that now passes). */
  setVerdict(v: FileScanVerdict): void;
};

/** A scanner that drains the stream and answers `verdict` ("error" = scanner down). */
export function fakeScanner(verdict: FileScanVerdict = "clean"): FakeScanner {
  let current = verdict;
  const s: FakeScanner = {
    name: "clamd",
    calls: 0,
    setVerdict(v) {
      current = v;
    },
    async scan(input: AsyncIterable<Uint8Array>): Promise<FileScanVerdict> {
      s.calls += 1;
      for await (const _ of input) void _;
      return current;
    },
  };
  return s;
}

export type FixedClock = {
  now(): Date;
  /** Move the clock forward by `ms`. */
  advance(ms: number): void;
  /** Jump to another instant. */
  set(iso: string): void;
};

/** A clock pinned to `iso`; `now()` returns a fresh Date each call. */
export function fixedClock(iso: string): FixedClock {
  let t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new Error(`fixedClock: invalid instant ${iso}`);
  return {
    now: () => new Date(t),
    advance(ms) {
      t += ms;
    },
    set(next) {
      const n = new Date(next).getTime();
      if (Number.isNaN(n))
        throw new Error(`fixedClock: invalid instant ${next}`);
      t = n;
    },
  };
}
