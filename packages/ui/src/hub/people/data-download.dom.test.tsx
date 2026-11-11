// @vitest-environment jsdom
// Settings › Business info › Your data in a real DOM (11-41; LIFE-04; D285; 11-UI-SPEC lines
// 886-911): Idle, Building (polls), Ready, Limited, Failed for the Owner; the Admin/Editor
// line and IMPERSONATING-DATA with no button.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../test-support/dom";
import {
  DATA_COPY,
  DataDownloadPanel,
  dataDownloadLabel,
  dataLimitCopy,
  type DataDownloadView,
} from "./DataDownloadPanel";

const mounted: Mounted[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
});

function view(over: Partial<DataDownloadView> = {}): DataDownloadView {
  return {
    viewer: "owner",
    status: "idle",
    ready: null,
    requested: null,
    limitUntil: null,
    ...over,
  };
}

const READY = view({
  status: "ready",
  ready: {
    href: "/hub/api/data-download/dlaaaaaaaaaaaa1?exp=1&sig=s",
    until: "16 Oct",
    size: "1.4 GB",
  },
  requested: "9 Oct, 2:14 pm",
});

function render(
  initial: DataDownloadView | null,
  opts: {
    onRequest?: () => Promise<
      { ok: true; view: DataDownloadView } | { ok: false; message: string }
    >;
    onRefresh?: () => Promise<DataDownloadView | null>;
  } = {},
) {
  const onRequest =
    opts.onRequest ??
    vi.fn(async () => ({
      ok: true as const,
      view: view({ status: "building" }),
    }));
  const onRefresh = opts.onRefresh ?? vi.fn(async () => null);
  const m = mount(
    <DataDownloadPanel
      initial={initial}
      onRequest={onRequest}
      onRefresh={onRefresh}
      pollMs={1000}
    />,
  );
  mounted.push(m);
  return { c: m.container, onRequest, onRefresh };
}

describe("DataDownloadPanel (11-41)", () => {
  it("Owner idle: heading, DATA-INTRO, Download my data and the hint; asking shows Building", async () => {
    const { c, onRequest } = render(view());
    const sec = c.querySelector("section#your-data")!;
    expect(sec.querySelector("h2")!.textContent).toBe("Your data");
    expect(sec.textContent).toContain(DATA_COPY.intro);
    expect(sec.textContent).toContain(DATA_COPY.idleHint);
    click(button(c, DATA_COPY.request));
    await flush();
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(c.textContent).toContain(DATA_COPY.building);
    const busy = c.querySelector("button[aria-busy]")!;
    expect(busy.textContent).toContain(DATA_COPY.preparing);
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it("Building polls every interval and stops once Ready", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const onRefresh = vi
      .fn<() => Promise<DataDownloadView | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(view({ status: "building" }))
      .mockResolvedValue(READY);
    const { c } = render(view({ status: "building" }), { onRefresh });
    expect(c.textContent).toContain(DATA_COPY.building);
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      await flush();
    }
    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(c.textContent).toContain(
      "Your download is ready. The link works until 16 Oct.",
    );
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it("Ready: primary download link with size in its name, expiry and requested time", () => {
    const { c } = render(READY);
    const link = c.querySelector<HTMLAnchorElement>("a[download]")!;
    expect(link.getAttribute("href")).toBe(READY.ready!.href);
    expect(link.getAttribute("aria-label")).toBe(
      "Download your data (zip, 1.4 GB)",
    );
    expect(dataDownloadLabel(null)).toBe("Download your data (zip)");
    expect(c.textContent).toContain("The link works until 16 Oct.");
    expect(c.textContent).toContain("Requested 9 Oct, 2:14 pm");
  });

  it("Limited: the request button is aria-disabled, described by DATA-LIMIT, and does nothing", async () => {
    const { c, onRequest } = render({
      ...READY,
      limitUntil: "2:14 pm tomorrow",
    });
    const btn = button(c, DATA_COPY.requestAgain)!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const desc = c.querySelector(
      `#${CSS.escape(btn.getAttribute("aria-describedby")!)}`,
    );
    expect(desc!.textContent).toBe(dataLimitCopy("2:14 pm tomorrow"));
    expect(desc!.textContent).toBe(
      "You can ask for a new download after 2:14 pm tomorrow.",
    );
    click(btn);
    await flush();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("Idle inside the limit shows DATA-LIMIT instead of the hint", () => {
    const { c } = render(view({ limitUntil: "9:00 am today" }));
    expect(c.textContent).toContain(
      "You can ask for a new download after 9:00 am today.",
    );
    expect(c.textContent).not.toContain(DATA_COPY.idleHint);
  });

  it("Failed: DATA-FAILED with Try again, which asks again", async () => {
    const { c, onRequest } = render(view({ status: "failed" }));
    expect(c.querySelector('[role="alert"]')!.textContent).toContain(
      DATA_COPY.failed,
    );
    click(button(c, DATA_COPY.tryAgain));
    await flush();
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("a failed request shows the message in an alert and keeps the state", async () => {
    const { c } = render(view(), {
      onRequest: async () => ({ ok: false, message: DATA_COPY.requestFailed }),
    });
    click(button(c, DATA_COPY.request));
    await flush();
    expect(c.textContent).toContain(DATA_COPY.requestFailed);
    expect(button(c, DATA_COPY.request)).not.toBeNull();
  });

  it("Admin/Editor: the owner-only line and no button", () => {
    const { c } = render(view({ viewer: "not-owner" }));
    expect(c.textContent).toContain(
      "Only the site owner can download the site's data.",
    );
    expect(c.querySelector("button")).toBeNull();
    expect(c.querySelector("a[download]")).toBeNull();
  });

  it("impersonating staff: IMPERSONATING-DATA and no button", () => {
    const { c } = render(view({ viewer: "impersonating" }));
    expect(c.textContent).toContain(
      "You're viewing as support staff, so downloads are turned off. Only the owner can download the site's data.",
    );
    expect(c.querySelector("button")).toBeNull();
  });

  it("a failed first read: ERR-SECTION with Try again", () => {
    const { c } = render(null);
    expect(c.textContent).toContain(DATA_COPY.loadFailed);
    expect(c.querySelector("a")!.textContent).toBe("Try again");
  });
});
