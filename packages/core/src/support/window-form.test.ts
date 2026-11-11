// 13-36 choice 2: console service-window form rules (business time, presets, WINDOW-RANGE).
import { describe, expect, it } from "vitest";
import {
  applyWindowPreset,
  businessWallToUtc,
  fromBusinessLocalInput,
  toBusinessLocalInput,
  windowCreatedLine,
  windowRangeOk,
} from "./window-form";

const NOW = new Date("2026-10-15T19:00:00Z"); // 2:00 pm Central (CDT)

describe("business wall time", () => {
  it("round-trips datetime-local in Central, across DST", () => {
    expect(toBusinessLocalInput(NOW)).toBe("2026-10-15T14:00");
    expect(fromBusinessLocalInput("2026-10-15T14:00")?.toISOString()).toBe(
      NOW.toISOString(),
    );
    // 1 Nov 2026 is the fall-back day: noon is CST (UTC-6).
    expect(businessWallToUtc(2026, 11, 2, 12, 0).toISOString()).toBe(
      "2026-11-02T18:00:00.000Z",
    );
    expect(fromBusinessLocalInput("2026-02-31T10:00")).toBeNull();
    expect(fromBusinessLocalInput("junk")).toBeNull();
  });
});

describe("applyWindowPreset", () => {
  it("Now, +1 hour, +4 hours, Tonight", () => {
    const empty = { start: null, end: null };
    expect(applyWindowPreset("now", empty, NOW)).toEqual({
      start: NOW,
      end: new Date(NOW.getTime() + 3_600_000),
    });
    expect(applyWindowPreset("4h", empty, NOW).end.toISOString()).toBe(
      "2026-10-15T23:00:00.000Z",
    );
    const later = new Date("2026-10-16T15:00:00Z");
    expect(
      applyWindowPreset(
        "1h",
        { start: later, end: null },
        NOW,
      ).end.toISOString(),
    ).toBe("2026-10-16T16:00:00.000Z");
    const t = applyWindowPreset("tonight", empty, NOW);
    expect(toBusinessLocalInput(t.start)).toBe("2026-10-15T22:00");
    expect(toBusinessLocalInput(t.end)).toBe("2026-10-16T02:00");
    // After 2 am the next night is used.
    const lateNight = new Date("2026-10-16T08:30:00Z"); // 3:30 am Central
    expect(
      toBusinessLocalInput(
        applyWindowPreset("tonight", empty, lateNight).start,
      ),
    ).toBe("2026-10-16T22:00");
  });
});

describe("windowRangeOk (WINDOW-RANGE)", () => {
  it("end after start and now, within 7 days", () => {
    const h = 3_600_000;
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    expect(windowRangeOk(NOW, at(h), NOW)).toBe(true);
    expect(windowRangeOk(at(h), NOW, NOW)).toBe(false);
    expect(windowRangeOk(NOW, at(7 * 24 * h), NOW)).toBe(true);
    expect(windowRangeOk(NOW, at(7 * 24 * h + 1), NOW)).toBe(false);
    expect(windowRangeOk(null, at(h), NOW)).toBe(false);
  });
});

describe("windowCreatedLine", () => {
  it("is the CLI line with Central", () => {
    expect(
      windowCreatedLine(
        "W-12",
        { scope: "page", orgId: "o", addon: "", page: "p", component: "" },
        { orgs: { o: "Rivera Bakery" }, pages: { p: "About us" }, addons: [] },
        {
          start: NOW,
          end: new Date("2026-10-15T21:00:00Z"),
          now: NOW,
        },
      ),
    ).toBe(
      'Window W-12 · Rivera Bakery · page "About us" · now → 4:00 pm Central · editing paused for the owner.',
    );
  });
});
