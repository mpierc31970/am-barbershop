// @vitest-environment jsdom
// 13-35 Task 1 (STAFF-05, STAFF-08, STAFF-20; 13-UI-SPEC "Ticket inbox", "Ticket detail";
// T-13-35-01, T-13-35-02): inbox bulk bar + bulk CaseDialog, staff status words, the staff
// thread (internal notes marked, public replies as the owner sees them), the rail's save cycle
// and the poller's silent retries.
import { P13_COPY } from "@cds/core/staff";
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import { SUPPORT_UI_COPY } from "../../hub/support/copy";
import { flush, mount, type Mounted } from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  InboxView,
  StaffThread,
  TicketHeaderStrip,
  TicketRail,
  inboxHref,
  staffStatusEnabled,
  useTicketPoll,
  type InboxRowView,
  type InboxViewProps,
  type StaffThreadMessageView,
  type TicketRailView,
  type TicketPollResult,
} from "./index";

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
  vi.useRealTimers();
});

const NOW = "2026-10-15T15:00:00.000Z";
const TZ = "America/Chicago";
const ORG_A = "aaaaaaaaaaaaaaa";
const ORG_B = "bbbbbbbbbbbbbbb";

function wrap(ui: ReactNode): ReactNode {
  return (
    <ToastRegion>
      <StaffActionProvider
        requestStepUpCode={vi.fn()}
        confirmStepUp={vi.fn()}
        navigate={vi.fn()}
      >
        {ui}
      </StaffActionProvider>
    </ToastRegion>
  );
}

function row(over: Partial<InboxRowView>): InboxRowView {
  return {
    number: 1042,
    orgId: ORG_A,
    orgName: "Rivera Bakery",
    type: "problem",
    subject: "Contact form not sending",
    status: "open",
    priority: "normal",
    created: "2026-10-15T11:00:00.000Z",
    sla: "on_track",
    dueAt: "2026-10-16T20:00:00.000Z",
    assignee: null,
    assigneeId: null,
    openedByCds: false,
    ...over,
  };
}

function inbox(over: Partial<InboxViewProps> = {}): InboxViewProps {
  return {
    rows: [
      row({}),
      row({ number: 1043, orgId: ORG_B, orgName: "Lee Cuts" }),
      row({ number: 1044, status: "waiting_on_you", subject: "Logo swap" }),
    ],
    now: NOW,
    resultLine: "3 tickets · 0 at risk · 0 missed",
    quickFilters: [
      {
        id: "all",
        label: "All open",
        href: "/staff/tickets?tab=inbox",
        pressed: true,
      },
    ],
    filters: [],
    search: "",
    listSearch: "",
    sort: "sla",
    sortHrefs: {},
    empty: null,
    clearHref: "/staff/tickets?tab=inbox",
    moreHref: null,
    openNumber: null,
    staff: [{ id: "u00000000000001", name: "Mara" }],
    onBulk: vi.fn(),
    ...over,
  };
}

function check(label: string) {
  const box = mounted!.container.querySelector<HTMLInputElement>(
    `input[aria-label="Select ${label}"]`,
  )!;
  act(() => box.click());
}

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function selectByLabel(text: string): HTMLSelectElement {
  const label = Array.from(mounted!.container.querySelectorAll("label")).find(
    (l) => l.textContent?.startsWith(text),
  )!;
  return (label.querySelector("select") ??
    document.getElementById(label.htmlFor)) as HTMLSelectElement;
}

describe("InboxView", () => {
  it("lists every site's tickets with the staff status word 'Waiting on owner'", () => {
    mounted = mount(wrap(<InboxView {...inbox()} />));
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("#1042");
    expect(text).toContain("Lee Cuts");
    expect(text).toContain("Waiting on owner");
    expect(text).not.toContain("Waiting on you");
    expect(text).toContain("3 tickets · 0 at risk · 0 missed");
    expect(
      mounted.container.querySelector('a[href="/staff/tickets/1042"]'),
    ).not.toBeNull();
  });

  it("2 selected shows the bulk bar; Resolved opens the CaseDialog naming owners alerted", async () => {
    const onBulk = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        message: "2 tickets set to Resolved; 4 alerts raised.",
        changed: 2,
        alerted: 4,
        failed: [],
      },
    });
    mounted = mount(wrap(<InboxView {...inbox({ onBulk })} />));
    check("#1042");
    check("#1043");
    expect(mounted.container.textContent).toContain("2 selected");
    choose(selectByLabel("Status"), "resolved");
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Set 2 tickets to Resolved?");
    expect(dialog.textContent).toContain("Owners of 2 sites get an alert.");
    expect(onBulk).not.toHaveBeenCalled();
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Set status",
    )!;
    act(() => confirm.click());
    await flush();
    expect(onBulk).toHaveBeenCalledWith({
      numbers: [1042, 1043],
      status: "resolved",
    });
    expect(document.body.textContent).toContain("2 tickets set to Resolved");
  });

  it("bulk priority applies at once with an Undo toast that restores each ticket", async () => {
    const onBulk = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        message: "2 tickets set to urgent priority.",
        changed: 2,
        alerted: 0,
        failed: [],
      },
    });
    mounted = mount(
      wrap(
        <InboxView
          {...inbox({
            onBulk,
            rows: [
              row({ priority: "low" }),
              row({ number: 1043, priority: "high" }),
            ],
          })}
        />,
      ),
    );
    check("#1042");
    check("#1043");
    choose(selectByLabel("Priority"), "urgent");
    await flush();
    expect(onBulk).toHaveBeenCalledWith({
      numbers: [1042, 1043],
      priority: "urgent",
    });
    const undo = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === P13_COPY.UNDO,
    )!;
    act(() => undo.click());
    await flush();
    expect(onBulk).toHaveBeenCalledWith({ numbers: [1042], priority: "low" });
    expect(onBulk).toHaveBeenCalledWith({ numbers: [1043], priority: "high" });
  });

  it("a refused undo is not reported as undone (WR-E06)", async () => {
    const onBulk = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          message: "2 tickets set to urgent priority.",
          changed: 2,
          alerted: 0,
          failed: [],
        },
      })
      .mockResolvedValue({ ok: false, code: "forbidden", message: "No." });
    mounted = mount(
      wrap(
        <InboxView
          {...inbox({
            onBulk,
            rows: [
              row({ priority: "low" }),
              row({ number: 1043, priority: "high" }),
            ],
          })}
        />,
      ),
    );
    check("#1042");
    check("#1043");
    choose(selectByLabel("Priority"), "urgent");
    await flush();
    const undo = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === P13_COPY.UNDO,
    )!;
    act(() => undo.click());
    await flush();
    expect(document.body.textContent).not.toContain("Each ticket is back");
    expect(document.body.textContent).toContain(SUPPORT_UI_COPY.ERR_SAVE);
  });

  it("counts new tickets only for a refresh of the same list query (WR-E05)", () => {
    const base = inbox();
    mounted = mount(wrap(<InboxView {...base} />));
    const more = [...base.rows, row({ number: 1050 }), row({ number: 1051 })];
    // Another query (quick filter, sort, page): not "new tickets".
    act(() =>
      mounted!.root.render(
        wrap(<InboxView {...base} rows={more} listSearch="quick=mine" />),
      ),
    );
    expect(mounted.container.textContent).not.toContain("new ticket");
    // The 60 s refresh of that same query brings one more row.
    act(() =>
      mounted!.root.render(
        wrap(
          <InboxView
            {...base}
            rows={[...more, row({ number: 1052 })]}
            listSearch="quick=mine"
          />,
        ),
      ),
    );
    expect(mounted.container.textContent).toContain("1 new ticket");
  });

  it("empty states: INBOX-EMPTY and the filter empty line", () => {
    mounted = mount(
      wrap(<InboxView {...inbox({ rows: [], empty: "none" })} />),
    );
    expect(mounted.container.textContent).toContain(P13_COPY.INBOX_EMPTY_H);
    mounted.unmount();
    mounted = mount(
      wrap(<InboxView {...inbox({ rows: [], empty: "filtered" })} />),
    );
    expect(mounted.container.textContent).toContain(
      "No tickets match these filters.",
    );
  });

  it("split view renders the detail beside compact rows with the open row current", () => {
    mounted = mount(
      wrap(
        <InboxView
          {...inbox({ openNumber: 1042, detail: <p data-x="">detail pane</p> })}
        />,
      ),
    );
    expect(
      mounted.container.querySelector("[data-split-detail]")!.textContent,
    ).toBe("detail pane");
    expect(
      mounted.container
        .querySelector('tr[aria-current="true"]')!
        .getAttribute("data-staff-row"),
    ).toBe("1042");
    expect(mounted.container.textContent).toContain("#1042 · Rivera Bakery");
  });

  it("inboxHref keeps the filters and sets open", () => {
    expect(inboxHref("type=problem&quick=mine", 1042)).toBe(
      "/staff/tickets?tab=inbox&type=problem&quick=mine&open=1042",
    );
    expect(inboxHref("", null)).toBe("/staff/tickets?tab=inbox");
  });
});

function msg(
  p: Partial<StaffThreadMessageView> & { id: string },
): StaffThreadMessageView {
  return {
    authorKind: "member",
    authorName: "Maria",
    body: "",
    event: null,
    attachments: [],
    created: "2026-10-15T14:00:00.000Z",
    visibility: "public",
    ...p,
  };
}

describe("StaffThread", () => {
  it("marks internal notes and shows public replies as the owner sees them", () => {
    mounted = mount(
      <StaffThread
        timeZone={TZ}
        now={Date.parse(NOW)}
        onDownload={() => {}}
        messages={[
          msg({ id: "m1", body: "Form broken <b>help</b>" }),
          msg({
            id: "m2",
            authorKind: "staff",
            authorName: "Mara",
            body: "Looking now.",
          }),
          msg({
            id: "m3",
            authorKind: "staff",
            authorName: "Mara",
            body: "SES bounce on their domain.",
            visibility: "internal",
          }),
          msg({
            id: "m4",
            authorKind: "system",
            event: "Assigned to Mara by Lee",
            visibility: "internal",
          }),
        ]}
      />,
    );
    const internal = mounted.container.querySelectorAll("[data-internal]");
    expect(internal).toHaveLength(1);
    expect(internal[0]!.textContent).toContain(P13_COPY.INTERNAL_LINE);
    expect(internal[0]!.textContent).toContain("SES bounce");
    // The public CDS reply is the CdsSurface, unmarked.
    const pub = mounted.container.querySelector('[data-message="m2"]')!;
    expect(pub.hasAttribute("data-internal")).toBe(false);
    // Bodies are text, never markup (T-13-35-02).
    expect(mounted.container.querySelector("b")).toBeNull();
    expect(mounted.container.textContent).toContain("<b>help</b>");
    expect(
      mounted.container.querySelector("[data-staff-only]")!.textContent,
    ).toContain("Assigned to Mara by Lee");
  });
});

describe("TicketHeaderStrip", () => {
  it("shows #, staff status, site, Opened by CDS and Open as admin with the reason", () => {
    mounted = mount(
      <TicketHeaderStrip
        now={NOW}
        ticket={{
          number: 1042,
          subject: "Contact form not sending",
          status: "waiting_on_you",
          type: "problem",
          target: { kind: "page", label: "About us" },
          orgId: ORG_A,
          orgName: "Rivera Bakery",
          openedBy: { cds: true, name: "CDS · Mara" },
          created: "2026-10-09T15:00:00.000Z",
          sla: "met",
          dueAt: null,
          firstRepliedAt: null,
          paidLabel: null,
          incidentCode: "I-3",
        }}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(mounted.container.querySelector("h1")!.textContent).toBe(
      "Contact form not sending",
    );
    expect(text).toContain("Waiting on owner");
    expect(text).toContain("Page · About us");
    expect(text).toContain("Opened by CDS");
    expect(text).toContain("Open I-3");
    const admin = Array.from(mounted.container.querySelectorAll("a")).find(
      (a) => a.textContent === "Open as admin",
    )!;
    expect(admin.getAttribute("href")).toBe(
      `/staff/sites/${ORG_A}?tab=actions&reason=Ticket+%231042`,
    );
  });
});

function railTicket(over: Partial<TicketRailView> = {}): TicketRailView {
  return {
    id: "t00000000000001",
    number: 1042,
    status: "open",
    type: "change",
    priority: "normal",
    assigneeId: null,
    assignee: null,
    paidCategory: null,
    incidentCode: null,
    orgId: ORG_A,
    orgName: "Rivera Bakery",
    created: "2026-10-15T11:00:00.000Z",
    firstRepliedAt: null,
    dueAt: "2026-10-16T20:00:00.000Z",
    context: {
      url: "https://rivera.test/contact",
      browser: "Firefox",
      captured_at: "2026-10-15T11:00:00.000Z",
    },
    ...over,
  };
}

function rail(over: Record<string, unknown> = {}) {
  const ok = () =>
    vi.fn().mockResolvedValue({ ok: true, data: { message: "ok" } });
  return {
    ticket: railTicket(),
    staff: [{ id: "u00000000000001", name: "Mara" }],
    meId: "u00000000000002",
    incidents: [{ code: "I-3", title: "Contact forms not sending" }],
    onStatus: ok(),
    onAssign: ok(),
    onPriority: ok(),
    onPaid: ok(),
    onIncident: ok(),
    ...over,
  };
}

function railSelect(label: string): HTMLSelectElement {
  const l = Array.from(mounted!.container.querySelectorAll("label")).find(
    (x) => x.textContent === label,
  )!;
  return document.getElementById(l.htmlFor) as HTMLSelectElement;
}

describe("TicketRail", () => {
  it("a priority change calls the injected action and shows Saved", async () => {
    const props = rail();
    mounted = mount(wrap(<TicketRail {...props} />));
    choose(railSelect("Priority"), "high");
    await flush();
    expect(props.onPriority).toHaveBeenCalledWith(1042, "high");
    expect(mounted.container.textContent).toContain("Saved");
  });

  it("a refused save shows ERR-SAVE inline and reverts", async () => {
    const props = rail({
      onAssign: vi
        .fn()
        .mockResolvedValue({ ok: false, code: "unavailable", message: "x" }),
    });
    mounted = mount(wrap(<TicketRail {...props} />));
    const sel = railSelect("Assignee");
    choose(sel, "u00000000000001");
    await flush();
    expect(mounted.container.textContent).toContain(SUPPORT_UI_COPY.ERR_SAVE);
    expect(sel.value).toBe("none");
  });

  it("Resolved asks first; legal moves only", async () => {
    const props = rail();
    mounted = mount(wrap(<TicketRail {...props} />));
    const sel = railSelect("Status");
    expect(
      Array.from(sel.options).find((o) => o.value === "open")!.disabled,
    ).toBe(false); // current value stays selectable
    choose(sel, "resolved");
    expect(document.querySelector("dialog[open]")!.textContent).toContain(
      "Set #1042 to Resolved?",
    );
    expect(props.onStatus).not.toHaveBeenCalled();
    expect(staffStatusEnabled("in_progress", "open")).toBe(false);
    expect(staffStatusEnabled("closed", "resolved")).toBe(false);
    expect(staffStatusEnabled("open", "in_progress")).toBe(true);
  });

  it("paid service shows only on change requests", () => {
    mounted = mount(
      wrap(
        <TicketRail {...rail({ ticket: railTicket({ type: "problem" }) })} />,
      ),
    );
    expect(mounted.container.textContent).not.toContain("Paid service");
  });
});

function Poller(props: {
  poll: (n: number, c: string) => Promise<never>;
  onResult: (r: TicketPollResult) => void;
}) {
  const { failed } = useTicketPoll({
    number: 1042,
    cursor: "m1",
    poll: props.poll,
    onResult: props.onResult,
    intervalMs: 1000,
  });
  return <p>{failed ? "failed" : "ok"}</p>;
}

describe("useTicketPoll", () => {
  it("polls with the cursor, retries silently, then reports failure after 3", async () => {
    vi.useFakeTimers();
    const poll = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "unavailable", message: "" });
    const onResult = vi.fn();
    mounted = mount(<Poller poll={poll} onResult={onResult} />);
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(poll).toHaveBeenCalledWith(1042, "m1");
    expect(mounted.container.textContent).toBe("ok");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mounted.container.textContent).toBe("failed");
    expect(onResult).not.toHaveBeenCalled();
  });

  it("drops a poll answer for a ticket that is no longer open (CR-E01)", async () => {
    vi.useRealTimers();
    let resolveA: (v: unknown) => void = () => {};
    const poll = vi.fn((n: number) =>
      n === 1
        ? new Promise((r) => {
            resolveA = r;
          })
        : Promise.resolve({
            ok: true,
            data: { status: "open", messages: [], cursor: "b2", reset: false },
          }),
    );
    const onResult = vi.fn();
    let pollNow: () => Promise<void> = async () => {};
    function Switcher(props: { number: number; cursor: string }) {
      const h = useTicketPoll({
        number: props.number,
        cursor: props.cursor,
        poll: poll as never,
        onResult,
        intervalMs: 60_000,
      });
      pollNow = h.pollNow;
      return <p>{h.failed ? "failed" : "ok"}</p>;
    }
    mounted = mount(<Switcher number={1} cursor="a1" />);
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = pollNow();
    });
    act(() => mounted!.root.render(<Switcher number={2} cursor="b1" />));
    // B's first poll is not skipped while A's request is still running, and uses B's cursor.
    await act(async () => {
      await pollNow();
    });
    expect(poll).toHaveBeenLastCalledWith(2, "b1");
    expect(onResult).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveA({
        ok: true,
        data: {
          status: "open",
          messages: [{ id: "a9" }],
          cursor: "a9",
          reset: false,
        },
      });
      await first;
    });
    // A's late answer is never merged into B.
    expect(onResult).toHaveBeenCalledTimes(1);
    await act(async () => {
      await pollNow();
    });
    expect(poll).toHaveBeenLastCalledWith(2, "b2");
  });
});
