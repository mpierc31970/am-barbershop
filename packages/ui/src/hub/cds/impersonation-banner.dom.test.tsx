// @vitest-environment jsdom
// ImpersonationBanner (13-26 choice 3; STAFF-06; 13-UI-SPEC "Impersonation", BANNER, a11y).
import { P13_COPY } from "@cds/core/staff";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import {
  BANNER_REASON_MAX,
  IMPERSONATION_BANNER_COPY,
  ImpersonationBanner,
  minutesLeft,
  truncateReason,
} from "./index";

let m: Mounted | null = null;

afterEach(() => {
  m?.unmount();
  m = null;
  vi.useRealTimers();
});

const T0 = Date.parse("2026-10-15T15:00:00.000Z");
const noop = () => {};

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("ImpersonationBanner", () => {
  it("minutesLeft rounds up and never goes below 0; long reasons are cut at 40", () => {
    expect(minutesLeft(new Date(T0 + 52 * 60_000).toISOString(), T0)).toBe(52);
    expect(minutesLeft(new Date(T0 + 30_001).toISOString(), T0)).toBe(1);
    expect(minutesLeft(new Date(T0 - 1).toISOString(), T0)).toBe(0);
    expect(minutesLeft("nope", T0)).toBe(0);
    const long = "x".repeat(60);
    expect(truncateReason(long)).toHaveLength(BANNER_REASON_MAX);
    expect(truncateReason(long).endsWith("…")).toBe(true);
    expect(truncateReason("Checking the menu")).toBe("Checking the menu");
  });

  it("shows BANNER with business, view, reason and minutes, plus End", () => {
    m = mount(
      <ImpersonationBanner
        business="Rivera Bakery"
        view="admin"
        reason="Checking the menu"
        endsAt={new Date(T0 + 52 * 60_000).toISOString()}
        endAction={noop}
        now={() => T0}
      />,
    );
    const region = m.container.querySelector('[role="region"]');
    expect(region?.getAttribute("aria-label")).toBe(
      IMPERSONATION_BANNER_COPY.region,
    );
    expect(region?.hasAttribute("data-cds-identity")).toBe(true);
    expect(region?.querySelector("[data-cds-mark]")).not.toBeNull();
    expect(text(region)).toContain(
      "Viewing Rivera Bakery as CDS staff · as admin · Checking the menu · 52 min left",
    );
    const end = region?.querySelector("form button[type=submit]");
    expect(end?.textContent).toBe(P13_COPY.BANNER_END);
    expect(end?.getAttribute("aria-label")).toBe(
      IMPERSONATION_BANNER_COPY.endLabel,
    );
    // No warning yet.
    expect(text(region?.querySelector('[aria-live="polite"]'))).toBe("");
  });

  it("full reason in title when truncated; owner view says 'as owner'", () => {
    const reason = "Ticket #1042: the owner says the menu prices are all wrong";
    m = mount(
      <ImpersonationBanner
        business="Rivera Bakery"
        view="owner"
        reason={reason}
        endsAt={new Date(T0 + 30 * 60_000).toISOString()}
        endAction={noop}
        now={() => T0}
      />,
    );
    expect(m.container.querySelector(`[title="${reason}"]`)).not.toBeNull();
    expect(text(m.container)).toContain("· as owner ·");
    expect(text(m.container)).toContain(truncateReason(reason));
  });

  it("announces the 5-minute mark once and calls onExpire at 0", () => {
    vi.useFakeTimers();
    let t = T0;
    const onExpire = vi.fn();
    m = mount(
      <ImpersonationBanner
        business="Rivera Bakery"
        view="admin"
        reason="Checking the menu"
        endsAt={new Date(T0 + 6 * 60_000).toISOString()}
        endAction={noop}
        onExpire={onExpire}
        now={() => t}
      />,
    );
    const live = () => m!.container.querySelector('[aria-live="polite"]');
    expect(text(live())).toBe("");
    t = T0 + 61_000;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(text(live())).toBe("5 minutes left viewing Rivera Bakery");
    expect(text(m.container)).toContain("5 min left");
    const once = text(live());
    t = T0 + 3 * 60_000;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(text(live())).toBe(once);
    expect(onExpire).not.toHaveBeenCalled();
    t = T0 + 6 * 60_000 + 1;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
