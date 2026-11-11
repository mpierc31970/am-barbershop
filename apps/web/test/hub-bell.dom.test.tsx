// @vitest-environment jsdom
// 11-21 (DASH-34, DASH-37; 11-UI-SPEC "Bell"): the shell's bell. Opening it loads the rows
// from /hub/api/alerts; opening a row marks it read first, closes the drawer, then navigates
// through the router; Mark all as read zeroes the count. Off-hub hrefs are dropped.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const calls = vi.hoisted(() => [] as string[]);
const push = vi.hoisted(() =>
  vi.fn((href: string) => {
    calls.push(`push:${href}`);
  }),
);
vi.mock("next/navigation", () => ({
  usePathname: () => "/hub/today",
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));
const actions = vi.hoisted(() => ({
  markAlertReadAction: vi.fn(async (id: string) => {
    calls.push(`read:${id}`);
    return { ok: true, data: { read: true } };
  }),
  markAllAlertsReadAction: vi.fn(async () => ({
    ok: true,
    data: { marked: 2 },
  })),
}));
vi.mock("../app/actions/alerts", () => actions);

const { HubBell, bellRowsOf } = await import("../app/(platform)/hub/HubBell");
const { NavGuardProvider } = await import("../app/(platform)/hub/nav-guard");

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  calls.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ROWS = [
  {
    id: "alertaaaaaaaaa1",
    type: "form.message",
    level: "normal",
    title: "New message from Dana Lee",
    href: "/hub/inbox?tab=messages&message=subaaaaaaaaaaa1",
    section: "inbox",
    createdAt: new Date().toISOString(),
    read: false,
    cleared: false,
  },
  {
    id: "alertaaaaaaaaa2",
    type: "billing.card_failed",
    level: "urgent",
    title: "Your payment to CDS failed. Update your card.",
    href: "/hub/settings?tab=billing",
    section: "settings",
    createdAt: new Date().toISOString(),
    read: false,
    cleared: false,
  },
];

function stubFetch(body: unknown, ok = true, countBody?: unknown) {
  const fetcher = vi.fn(async (url: unknown) =>
    ok
      ? new Response(
          JSON.stringify(
            countBody !== undefined && String(url).includes("view=count")
              ? countBody
              : body,
          ),
          { status: 200 },
        )
      : new Response("", { status: 500 }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function render() {
  mounted = mount(
    <NavGuardProvider>
      <HubBell initialCount={2} initialUrgent={1} />
    </NavGuardProvider>,
  );
}

describe("HubBell", () => {
  it("renders no drawer until opened", () => {
    render();
    expect(button(document.body, "Alerts, 2 unread, 1 urgent")).not.toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("opens, loads the rows, and a row is marked read before navigating", async () => {
    // IN-E04: after marking read the bell re-reads the true count (here 1 unread, 0 urgent:
    // a refresh landed meanwhile and another alert was read elsewhere).
    const fetcher = stubFetch(
      {
        rows: ROWS,
        count: 2,
        urgent: 1,
        timeZone: "America/Chicago",
        hasMore: false,
      },
      true,
      { count: 1, urgent: 0 },
    );
    render();
    click(button(document.body, "Alerts, 2 unread, 1 urgent"));
    await flush();
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe(
      "/hub/api/alerts",
    );
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    click(document.querySelector('[data-alert-row="alertaaaaaaaaa2"]'));
    await flush();
    expect(calls).toEqual([
      "read:alertaaaaaaaaa2",
      "push:/hub/settings?tab=billing",
    ]);
    expect(document.querySelector("dialog[open]")).toBeNull();
    await flush();
    expect(
      fetcher.mock.calls.some((c) =>
        String((c as unknown[])[0]).includes("view=count"),
      ),
    ).toBe(true);
    expect(button(document.body, "Alerts, 1 unread")).not.toBeNull();
  });

  it("Mark all as read zeroes the count; a failed load shows Try again", async () => {
    stubFetch({ rows: ROWS, count: 2, urgent: 1, timeZone: "UTC" });
    render();
    click(button(document.body, "Alerts, 2 unread, 1 urgent"));
    await flush();
    click(button(document.body, "Mark all as read"));
    await flush();
    expect(actions.markAllAlertsReadAction).toHaveBeenCalledTimes(1);
    expect(button(document.body, "Alerts")).not.toBeNull();
    expect(button(document.body, "Mark all as read")).toBeNull();

    mounted?.unmount();
    stubFetch({}, false);
    render();
    click(button(document.body, "Alerts, 2 unread, 1 urgent"));
    await flush();
    expect(button(document.body, "Try again")).not.toBeNull();
  });

  it("drops rows whose link leaves the hub", () => {
    expect(
      bellRowsOf([
        { ...ROWS[0], href: "https://evil.example/x" },
        { ...ROWS[0], id: "", href: "/hub/today" },
        ROWS[1],
      ]).map((r) => r.id),
    ).toEqual(["alertaaaaaaaaa2"]);
  });
});
