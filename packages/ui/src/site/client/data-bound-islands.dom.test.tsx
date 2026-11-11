// @vitest-environment jsdom
// OpenNow and ShareButtons islands (07-24; CONT-27, D257, D198; T-07-24-06).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, flush, mount, type Mounted } from "../../test-support/dom";
import { OpenNow } from "./OpenNow";
import { ShareButtons, SHARE_COPIED_MS } from "./ShareButtons";

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const nineFive = { open: true, ranges: [{ start: "09:00", end: "17:00" }] };
const shut = { open: false, ranges: [] };
const HOURS = {
  mon: nineFive,
  tue: nineFive,
  wed: nineFive,
  thu: nineFive,
  fri: nineFive,
  sat: shut,
  sun: shut,
};

describe("OpenNow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  });

  it("computes the pill after mount and refreshes every 60 s", () => {
    // Wednesday 10:00 in Chicago.
    vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    mounted = mount(<OpenNow hours={HOURS} timeZone="America/Chicago" />);
    expect(mounted.container.textContent).toBe("Open now · Closes at 5:00 pm");
    vi.setSystemTime(new Date("2026-10-07T22:01:00Z"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mounted.container.textContent).toBe(
      "Closed now · Opens Thursday at 9:00 am",
    );
  });

  it("renders nothing when there is no status", () => {
    vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    mounted = mount(<OpenNow hours={HOURS} timeZone="Not/AZone" />);
    expect(mounted.container.innerHTML).toBe("");
  });

  it("clears its interval on unmount", () => {
    const clear = vi.spyOn(globalThis, "clearInterval");
    mounted = mount(<OpenNow hours={HOURS} timeZone="America/Chicago" />);
    mounted.unmount();
    mounted = null;
    expect(clear).toHaveBeenCalled();
  });
});

describe("ShareButtons", () => {
  const share = { url: "https://rivera.example/menu", title: "Menu" };
  const nav = navigator as unknown as Record<string, unknown>;

  afterEach(() => {
    delete nav.share;
    delete nav.clipboard;
  });

  it("Copy link writes the URL and says so for 2 s", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mounted = mount(<ShareButtons targets={["copy"]} share={share} />);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const btn = [...mounted.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Copy link"),
    );
    click(btn);
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(share.url);
    const status = mounted.container.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("Link copied");
    act(() => {
      vi.advanceTimersByTime(SHARE_COPIED_MS);
    });
    expect(status.textContent).toBe("");
  });

  it("adds a first Share button when the Web Share API exists", async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareFn,
    });
    mounted = mount(
      <ShareButtons targets={["facebook", "copy"]} share={share} />,
    );
    await flush();
    const first = mounted.container.querySelector("li")!;
    expect(first.textContent).toBe("Share");
    click(first.querySelector("button"));
    expect(shareFn).toHaveBeenCalledWith({ url: share.url, title: "Menu" });
  });

  it("no Web Share API: no Share button", async () => {
    mounted = mount(<ShareButtons targets={["facebook"]} share={share} />);
    await flush();
    const labels = [...mounted.container.querySelectorAll("li")].map(
      (li) => li.textContent,
    );
    expect(labels).toEqual(["Facebook (opens in a new tab)"]);
  });

  it("an AbortError from the share sheet is ignored", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("x", "AbortError")),
    });
    mounted = mount(<ShareButtons targets={["copy"]} share={share} />);
    await flush();
    click(mounted.container.querySelector("button"));
    await flush();
    expect(mounted.container.textContent).toContain("Share");
  });
});
