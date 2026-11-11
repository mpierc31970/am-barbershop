// Countdown (CONT-10, D122, D-UI-12; RESEARCH Pitfall 8) and announcement banner
// (CONT-11, D117, D123) render contracts. node unit project, renderToStaticMarkup.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  countdownAriaLabel,
  countdownState,
  type BannerSettings,
} from "@cds/core/content";
import { Banner } from "./Banner";
import { CountdownIsland } from "./client/CountdownIsland";
import { Countdown } from "./Countdown";
import { ColumnItemRenderer } from "./ColumnItemRenderer";

const TARGET = "2026-10-12T09:00:00.000Z";
const BEFORE = new Date("2026-10-10T07:58:30.000Z"); // 2d 1h 1m 30s left
const AFTER = new Date("2026-10-12T09:00:01.000Z");
const ISLAND = readFileSync(
  join(import.meta.dirname, "client", "CountdownIsland.tsx"),
  "utf8",
);

const countdown = (now: Date, msg = "Doors are open") =>
  renderToStaticMarkup(
    <Countdown targetIso={TARGET} zeroMessage={msg} now={now} />,
  );

describe("Countdown before the target", () => {
  const out = countdown(BEFORE);

  it("is a role=timer with the long-form accessible name", () => {
    expect(out).toContain('role="timer"');
    expect(out).toContain(`aria-label="${countdownAriaLabel(TARGET)}"`);
    expect(out).toContain(
      'aria-label="Time left until 12 October 2026, 9:00 am"',
    );
  });

  it("carries a visually hidden <time dateTime>", () => {
    expect(out).toMatch(
      new RegExp(`<time datetime="${TARGET}" class="sr-only">`, "i"),
    );
  });

  it("draws four units with server-correct values", () => {
    for (const label of ["Days", "Hours", "Minutes", "Seconds"]) {
      expect(out).toContain(`>${label}<`);
    }
    expect(out).toMatch(/>2<\/span><span[^>]*>Days/);
    expect(out).toMatch(/>01<\/span><span[^>]*>Hours/);
    expect(out).toMatch(/>01<\/span><span[^>]*>Minutes/);
    expect(out).toMatch(/>30<\/span><span[^>]*>Seconds/);
    expect(out).not.toContain("Doors are open");
  });

  it("uses tabular numerals at min-width 2ch in the accent colour", () => {
    expect(out).toContain("tabular-nums");
    expect(out).toContain("min-w-[2ch]");
    expect(out).toContain("text-site-accent");
  });

  it("hides seconds under reduced motion with CSS, before any JS", () => {
    expect(out).toMatch(
      /class="[^"]*motion-reduce:hidden[^"]*"[^>]*>(<span[^>]*>30<\/span>)/,
    );
  });

  it("is not a live region", () => {
    expect(out).not.toContain("aria-live");
    expect(ISLAND).not.toContain("aria-live");
  });
});

describe("Countdown at and after the target", () => {
  it("renders the message only, with no timer", () => {
    const out = countdown(AFTER);
    expect(out).toContain("Doors are open");
    expect(out).not.toContain('role="timer"');
    expect(out).not.toContain("Seconds");
  });

  it("keeps the same min-height box so nothing shifts at zero", () => {
    const box = (s: string) => s.match(/^<div class="([^"]*)"/)?.[1];
    expect(box(countdown(AFTER))).toBe(box(countdown(BEFORE)));
    expect(box(countdown(AFTER))).toContain("min-h-[");
  });

  it("an invalid target counts as done", () => {
    const out = renderToStaticMarkup(
      <Countdown targetIso="" zeroMessage="Soon" now={BEFORE} />,
    );
    expect(out).toContain("Soon");
    expect(out).not.toContain('role="timer"');
  });
});

describe("CountdownIsland", () => {
  it("first render equals the server markup for the same initial state", () => {
    const island = renderToStaticMarkup(
      <CountdownIsland
        targetIso={TARGET}
        zeroMessage="Doors are open"
        initial={countdownState(TARGET, BEFORE)}
        label={countdownAriaLabel(TARGET)}
        when="12 October 2026, 9:00 am"
      />,
    );
    expect(island).toBe(countdown(BEFORE));
  });

  it("ticks every second, or every minute under reduced motion, and stops at zero", () => {
    expect(ISLAND).toMatch(/^"use client";/);
    expect(ISLAND).toContain("prefers-reduced-motion: reduce");
    expect(ISLAND).toContain("60_000");
    expect(ISLAND).toContain("1_000");
    expect(ISLAND).toContain("clearInterval");
    expect(ISLAND).not.toMatch(/content\/sanitize/);
  });

  it("renders through the column item for a countdown kind", () => {
    const out = renderToStaticMarkup(
      <ColumnItemRenderer
        item={{
          id: "c",
          kind: "countdown",
          target_at: TARGET,
          zero_message: "Open",
        }}
        now={AFTER}
      />,
    );
    expect(out).toContain("Open");
  });
});

describe("Announcement banner (CONT-11, D117, D123)", () => {
  const base: BannerSettings = {
    enabled: true,
    message: "Closed Monday for the holiday",
    link_text: "See hours",
    link_url: "/hours",
    starts_at: null,
    ends_at: null,
  };
  const banner = (b: BannerSettings | null, now = BEFORE) =>
    renderToStaticMarkup(<Banner banner={b} now={now} />);

  it("always-on renders an aside labelled Announcement with the message and link", () => {
    const out = banner(base);
    expect(out).toMatch(/^<aside aria-label="Announcement"/);
    expect(out).toContain("Closed Monday for the holiday");
    expect(out).toMatch(
      /<a href="\/hours" class="[^"]*font-semibold[^"]*underline/,
    );
    expect(out).toContain("bg-site-primary");
    expect(out).toContain("text-site-primary-contrast");
    expect(out).toContain("min-h-11");
  });

  it("active inside its window renders", () => {
    const out = banner({
      ...base,
      starts_at: "2026-10-01T00:00:00.000Z",
      ends_at: "2026-10-20T00:00:00.000Z",
    });
    expect(out).toContain("Announcement");
  });

  it("scheduled (before start), ended, off and null render nothing", () => {
    expect(banner({ ...base, starts_at: "2026-11-01T00:00:00.000Z" })).toBe("");
    expect(banner({ ...base, ends_at: "2026-10-01T00:00:00.000Z" })).toBe("");
    expect(banner({ ...base, enabled: false })).toBe("");
    expect(banner(null)).toBe("");
  });

  it("renders without a link when none is set", () => {
    const out = banner({ ...base, link_text: "", link_url: "" });
    expect(out).not.toContain("<a ");
  });

  it("drops an unsafe stored link", () => {
    const out = banner({ ...base, link_url: "javascript:alert(1)" });
    expect(out).not.toContain("javascript");
    expect(out).not.toContain("href");
  });
});
