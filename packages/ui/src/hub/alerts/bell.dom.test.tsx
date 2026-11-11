// @vitest-environment jsdom
// Bell trigger, drawer and refresh hook (11-21; DASH-34, DASH-37; 11-UI-SPEC "Bell";
// D-UI-P11-11, D-UI-P11-12).
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../test-support/dom";
import {
  ALERTS_COPY,
  AlertBell,
  AlertsPanel,
  bellLabel,
  groupBellRows,
  newAlertsText,
  useBellRefresh,
  type AlertsPanelState,
  type BellRow,
} from "./index";
import { isCdsAlertType } from "./AlertsPanel";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const TZ = "America/Chicago";
// 10:00 business time on 12 Oct 2026 (CDT, UTC-5).
const NOW = Date.parse("2026-10-12T15:00:00.000Z");

function row(over: Partial<BellRow> & { id: string }): BellRow {
  return {
    type: "form.message",
    level: "normal",
    title: "New message from Dana Lee",
    href: `/hub/inbox?tab=messages&message=${over.id}`,
    section: "inbox",
    createdAt: "2026-10-12T14:00:00.000Z",
    read: false,
    cleared: false,
    ...over,
  };
}

const ROWS: BellRow[] = [
  row({ id: "a1" }),
  row({
    id: "a2",
    type: "billing.card_failed",
    level: "urgent",
    title: "Your payment to CDS failed. Update your card.",
    href: "/hub/settings?tab=billing",
    section: "settings",
    createdAt: "2026-10-12T05:30:00.000Z", // 00:30 business time: today
  }),
  row({
    id: "a3",
    read: true,
    createdAt: "2026-10-12T04:30:00.000Z", // 23:30 the day before: yesterday
  }),
  row({
    id: "a4",
    cleared: true,
    createdAt: "2026-10-01T15:00:00.000Z",
  }),
];

describe("AlertBell", () => {
  it("names the count and urgent state; the chip is neutral with an urgent icon", () => {
    const onOpen = vi.fn();
    mounted = mount(<AlertBell count={3} urgent={1} onOpen={onOpen} />);
    const b = button(document.body, "Alerts, 3 unread, 1 urgent");
    expect(b).not.toBeNull();
    const chip = document.querySelector("[data-bell-chip]");
    expect(chip?.textContent).toBe("3");
    expect(chip?.className).toContain("bg-hub-surface-2");
    expect(chip?.className).not.toMatch(/danger|red/);
    expect(chip?.querySelector("[data-bell-urgent]")).not.toBeNull();
    click(b);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("reads 'Alerts' with no chip at zero and 9+ above nine", () => {
    mounted = mount(<AlertBell count={0} urgent={0} onOpen={() => {}} />);
    expect(button(document.body, "Alerts")).not.toBeNull();
    expect(document.querySelector("[data-bell-chip]")).toBeNull();
    mounted.unmount();
    mounted = mount(<AlertBell count={12} urgent={0} onOpen={() => {}} />);
    expect(button(document.body, "Alerts, 12 unread")).not.toBeNull();
    expect(document.querySelector("[data-bell-chip]")?.textContent).toBe("9+");
    expect(document.querySelector("[data-bell-urgent]")).toBeNull();
  });

  it("copy helpers", () => {
    expect(bellLabel(3, 0)).toBe("Alerts, 3 unread");
    expect(newAlertsText(2, 3)).toBe("1 new alert");
    expect(newAlertsText(0, 4)).toBe("4 new alerts");
    expect(newAlertsText(4, 1)).toBe("");
  });
});

function Panel({
  state = "ready",
  rows = ROWS,
  onOpenRow = () => {},
  onMarkAll = () => {},
  onRetry = () => {},
}: {
  state?: AlertsPanelState;
  rows?: BellRow[];
  onOpenRow?: (r: BellRow) => void;
  onMarkAll?: () => void;
  onRetry?: () => void;
}) {
  return (
    <AlertsPanel
      open
      onClose={() => {}}
      state={state}
      rows={rows}
      timeZone={TZ}
      now={NOW}
      onOpenRow={onOpenRow}
      onMarkAll={onMarkAll}
      onRetry={onRetry}
    />
  );
}

describe("AlertsPanel", () => {
  it("groups rows by business day: Today, Yesterday, Earlier", () => {
    const groups = groupBellRows(ROWS, TZ, NOW);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["Today", ["a1", "a2"]],
      ["Yesterday", ["a3"]],
      ["Earlier", ["a4"]],
    ]);
    mounted = mount(<Panel />);
    const heads = Array.from(document.querySelectorAll("dialog h3")).map(
      (h) => h.textContent,
    );
    expect(heads).toEqual(["Today", "Yesterday", "Earlier"]);
    expect(document.querySelector("dialog")?.getAttribute("aria-label")).toBe(
      "Alerts",
    );
  });

  it("unread rows are bold with sr Unread; urgent rows carry sr Urgent; cleared rows read Done", () => {
    mounted = mount(<Panel />);
    const a1 = document.querySelector('[data-alert-row="a1"]');
    expect(a1?.textContent).toContain("Unread:");
    expect(a1?.querySelector(".font-semibold")).not.toBeNull();
    expect(a1?.textContent).toContain("Inbox · 1 hour ago");
    expect(a1?.getAttribute("href")).toBe("/hub/inbox?tab=messages&message=a1");
    const a2 = document.querySelector('[data-alert-row="a2"]');
    expect(a2?.textContent).toContain("Urgent:");
    const a3 = document.querySelector('[data-alert-row="a3"]');
    expect(a3?.textContent).not.toContain("Unread");
    expect(a3?.querySelector(".font-semibold")).toBeNull();
    const a4 = document.querySelector('[data-alert-row="a4"]');
    expect(a4?.textContent).not.toContain("Unread");
    expect(a4?.textContent).toContain("· Done");
    const settings = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === ALERTS_COPY.settings,
    );
    expect(settings?.getAttribute("href")).toBe("/hub/profile#alerts");
  });

  it("clicking a row hands it to onOpenRow instead of following the link", () => {
    const onOpenRow = vi.fn();
    mounted = mount(<Panel onOpenRow={onOpenRow} />);
    click(document.querySelector('[data-alert-row="a2"]'));
    expect(onOpenRow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a2" }),
    );
  });

  it("Mark all as read shows only while something is unread", () => {
    const onMarkAll = vi.fn();
    mounted = mount(<Panel onMarkAll={onMarkAll} />);
    click(button(document.body, ALERTS_COPY.markAll));
    expect(onMarkAll).toHaveBeenCalledTimes(1);
    mounted.unmount();
    mounted = mount(
      <Panel
        rows={[row({ id: "r1", read: true }), row({ id: "r2", cleared: true })]}
      />,
    );
    expect(button(document.body, ALERTS_COPY.markAll)).toBeNull();
  });

  it("empty shows BELL-EMPTY; loading shows 4 skeleton rows; error shows ERR-LOAD + Try again", () => {
    mounted = mount(<Panel rows={[]} />);
    expect(document.body.textContent).toContain("No alerts yet");
    expect(document.body.textContent).toContain(
      "When something needs you, it shows here.",
    );
    mounted.unmount();
    mounted = mount(<Panel state="loading" />);
    expect(document.querySelectorAll("[data-skeleton-row]")).toHaveLength(4);
    mounted.unmount();
    const onRetry = vi.fn();
    mounted = mount(<Panel state="error" onRetry={onRetry} />);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      ALERTS_COPY.errLoad,
    );
    click(button(document.body, ALERTS_COPY.tryAgain));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

function Probe({
  fetcher,
  refreshKey,
}: {
  fetcher: typeof fetch;
  refreshKey: string;
}) {
  const bell = useBellRefresh({
    initial: { count: 1, urgent: 0 },
    refreshKey,
    fetcher,
  });
  return (
    <AlertBell
      count={bell.count}
      urgent={bell.urgent}
      announcement={bell.announcement}
      onOpen={() => {}}
    />
  );
}

function Host({ fetcher }: { fetcher: typeof fetch }) {
  const [key, setKey] = useState("/hub/today");
  return (
    <>
      <button type="button" onClick={() => setKey("/hub/inbox")}>
        navigate
      </button>
      <Probe fetcher={fetcher} refreshKey={key} />
    </>
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CDS marker on bell rows (12-29)", () => {
  it("support.reply shows the CdsMark; urgent cds.notice keeps TriangleAlert; form rows show none", () => {
    mounted = mount(
      <Panel
        rows={[
          row({
            id: "s1",
            type: "support.reply",
            title: "CDS replied to ticket #1042",
            href: "/hub/support/tickets/1042",
            section: "support",
          }),
          row({
            id: "s2",
            type: "cds.notice",
            level: "urgent",
            title: "CDS is working on your site until 4:00 pm",
            href: "/hub/support?tab=messages",
            section: "support",
          }),
          row({ id: "s3", type: "form.submission" }),
          row({ id: "s4", type: "cds.note", title: "New note from CDS: Hi" }),
        ]}
      />,
    );
    const at = (id: string) =>
      document.querySelector(`[data-alert-row="${id}"]`)!;
    const reply = at("s1").querySelector("[data-cds-mark]");
    expect(reply).not.toBeNull();
    expect(reply!.getAttribute("width")).toBe("16");
    expect(reply!.closest("[data-cds-identity]")).not.toBeNull();
    expect(at("s4").querySelector("[data-cds-mark]")).not.toBeNull();
    const notice = at("s2");
    expect(notice.querySelector("[data-cds-mark]")).toBeNull();
    expect(notice.querySelector("svg.text-hub-danger")).not.toBeNull();
    expect(notice.textContent).toContain("Urgent");
    expect(at("s3").querySelector("[data-cds-mark]")).toBeNull();
    expect(at("s3").querySelector("[data-cds-identity]")).toBeNull();
  });

  it("isCdsAlertType keys on the support and cds families only", () => {
    expect(isCdsAlertType("support.status")).toBe(true);
    expect(isCdsAlertType("cds.document")).toBe(true);
    expect(isCdsAlertType("form.message")).toBe(false);
    expect(isCdsAlertType("supportive.x")).toBe(false);
  });
});

describe("useBellRefresh", () => {
  it("re-reads on navigation and every 60s while visible, announcing a rise politely", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ count: 3, urgent: 1 }))
      .mockResolvedValueOnce(jsonResponse({ count: 3, urgent: 1 }))
      .mockResolvedValue(jsonResponse({ count: 2, urgent: 0 }));
    mounted = mount(<Host fetcher={fetcher} />);
    expect(fetcher).not.toHaveBeenCalled();

    click(button(document.body, "navigate"));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "/hub/api/alerts?view=count",
    );
    expect(button(document.body, "Alerts, 3 unread, 1 urgent")).not.toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "2 new alerts",
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Hidden: the timer skips the read.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Visible again: one read at once; a drop is not announced.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(button(document.body, "Alerts, 2 unread")).not.toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "2 new alerts",
    );
  });

  it("repeats an identical announcement by changing the live region's text (WR-D02)", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ count: 2, urgent: 0 }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, urgent: 0 }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, urgent: 0 }));
    mounted = mount(<Host fetcher={fetcher} />);
    const status = () =>
      document.querySelector('[role="status"]')?.textContent ?? "";
    click(button(document.body, "navigate"));
    await flush();
    const first = status();
    expect(first.trim()).toBe("1 new alert");

    // Down to 1 (no announcement), then up to 2 again: the same "1 new alert".
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const second = status();
    expect(second.trim()).toBe("1 new alert");
    expect(second).not.toBe(first);
  });

  it("re-seeds from a new server figure without announcing it (WR-D01)", async () => {
    const fetcher = vi.fn<typeof fetch>();
    function Seeded({ count }: { count: number }) {
      const bell = useBellRefresh({
        initial: { count, urgent: 0 },
        refreshKey: "/hub/today",
        fetcher,
      });
      return (
        <AlertBell
          count={bell.count}
          urgent={bell.urgent}
          announcement={bell.announcement}
          onOpen={() => {}}
        />
      );
    }
    function SwitchHost() {
      const [count, setCount] = useState(1);
      return (
        <>
          <button type="button" onClick={() => setCount(7)}>
            switch site
          </button>
          <Seeded count={count} />
        </>
      );
    }
    mounted = mount(<SwitchHost />);
    expect(button(document.body, "Alerts, 1 unread")).not.toBeNull();
    click(button(document.body, "switch site"));
    await flush();
    expect(button(document.body, "Alerts, 7 unread")).not.toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("");
    expect(fetcher).not.toHaveBeenCalled();

    // The baseline moved too: the next poll at 7 is not "6 new alerts".
    fetcher.mockResolvedValueOnce(jsonResponse({ count: 7, urgent: 0 }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("a failed read keeps the last count", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 500 }));
    mounted = mount(<Host fetcher={fetcher} />);
    click(button(document.body, "navigate"));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(button(document.body, "Alerts, 1 unread")).not.toBeNull();
  });
});
