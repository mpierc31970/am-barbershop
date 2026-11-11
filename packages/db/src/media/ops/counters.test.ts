import { beforeEach, describe, expect, it } from "vitest";
import {
  mediaOriginErrorsHeld,
  mediaOriginErrorsSince,
  noteMediaOriginError,
  resetMediaCountersForTests,
} from "./counters";

const HOUR = 3_600_000;

describe("media origin error counter (07-27 choice 8)", () => {
  beforeEach(() => resetMediaCountersForTests());

  it("counts errors inside the window", () => {
    const now = 10 * HOUR;
    noteMediaOriginError(now - 1000);
    noteMediaOriginError(now - 2000);
    noteMediaOriginError(now);
    expect(mediaOriginErrorsSince(now, HOUR)).toBe(3);
  });

  it("does not count entries older than 1 h", () => {
    const now = 10 * HOUR;
    noteMediaOriginError(now - HOUR - 1);
    noteMediaOriginError(now - 5);
    expect(mediaOriginErrorsSince(now, HOUR)).toBe(1);
    expect(mediaOriginErrorsHeld()).toBe(1);
  });

  it("never holds more than 10 000 timestamps", () => {
    for (let i = 0; i < 10_050; i++) noteMediaOriginError(i);
    expect(mediaOriginErrorsHeld()).toBe(10_000);
  });

  it("reset empties it", () => {
    noteMediaOriginError(1);
    resetMediaCountersForTests();
    expect(mediaOriginErrorsHeld()).toBe(0);
  });
});
