// @vitest-environment jsdom
// 12-10 Task 1 (COMM-06, COMM-08, COMM-09, SUPPORT-02; 12-UI-SPEC Tickets 355-372, Get help
// form 376-417, detail 421-455, a11y 828-850): the ticket list, type cards, target picker,
// help deflection, the meta rail and the closed panel render only what they are given.
import { act } from "react";
import {
  SUPPORT_COPY,
  buildTargetOptions,
  ticketTypesFor,
  type TenantTicket,
} from "@cds/core/support";
import { afterEach, describe, expect, it, vi } from "vitest";
import { button, click, mount, type Mounted } from "../../../test-support/dom";
import {
  ClosedTicketPanel,
  HelpDeflect,
  TICKETS_COPY,
  TargetSelect,
  TicketList,
  TicketMeta,
  TicketTypeCards,
  filterHelpDeflect,
  followUpHref,
} from "./index";

const TZ = "America/Chicago";
const NOW = Date.parse("2026-10-12T19:14:00Z");

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

function ticket(p: Partial<TenantTicket> = {}): TenantTicket {
  return {
    id: "t1",
    number: 1042,
    type: "problem",
    subject: "Contact form does not send",
    status: "open",
    target: { kind: "site", id: "site", label: "Whole site" },
    openedByCds: false,
    paid: null,
    incident: null,
    lastActivityAt: "2026-10-12T17:14:00Z",
    resolvedAt: null,
    closedAt: null,
    created: "2026-10-09T15:00:00Z",
    unread: false,
    ...p,
  };
}

describe("TicketList", () => {
  it("puts the number, subject and status badge in one row link", () => {
    mounted = mount(
      <TicketList
        tickets={[ticket({ status: "waiting_on_you" })]}
        show="open"
        now={NOW}
      />,
    );
    const links = mounted.container.querySelectorAll("a[data-ticket-row]");
    expect(links).toHaveLength(1);
    const a = links[0] as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("/hub/support/tickets/1042");
    expect(a.textContent).toContain("#1042");
    expect(a.textContent).toContain("Contact form does not send");
    expect(a.textContent).toContain("Waiting on you");
    expect(a.querySelector(".bg-hub-warning-tint")?.textContent).toContain(
      "Waiting on you",
    );
    expect(a.textContent).toContain(
      "Problem · Whole site · Updated 2 hours ago",
    );
  });

  it("marks an unread Support reply with a New reply badge and sr text", () => {
    mounted = mount(
      <TicketList tickets={[ticket({ unread: true })]} show="all" now={NOW} />,
    );
    const a = mounted.container.querySelector("a[data-ticket-row]")!;
    expect(a.textContent).toContain("New reply");
    const sr = a.querySelector(".sr-only");
    expect(sr?.textContent).toBe("New reply from Support");
  });

  it("adds Opened by Support and labels suggestions as Feature idea", () => {
    mounted = mount(
      <TicketList
        tickets={[
          ticket({ id: "a", openedByCds: true }),
          ticket({ id: "b", number: 1043, type: "suggestion" }),
        ]}
        show="all"
        now={NOW}
      />,
    );
    const rows = mounted.container.querySelectorAll("a[data-ticket-row]");
    expect(rows[0]!.textContent).toContain("· Opened by Support");
    expect(rows[1]!.textContent).toContain("Feature idea · Whole site");
  });

  it("keeps the server order and filters by show", () => {
    const list = [
      ticket({ id: "a", number: 1050, status: "waiting_on_you" }),
      ticket({ id: "b", number: 1049, status: "open" }),
      ticket({ id: "c", number: 1048, status: "closed" }),
    ];
    mounted = mount(<TicketList tickets={list} show="open" now={NOW} />);
    const nums = Array.from(
      mounted.container.querySelectorAll("a[data-ticket-row]"),
    ).map((a) => a.getAttribute("href"));
    expect(nums).toEqual([
      "/hub/support/tickets/1050",
      "/hub/support/tickets/1049",
    ]);
  });

  it("shows TICKETS-EMPTY with a Get help link, and the closed empty line", () => {
    mounted = mount(<TicketList tickets={[]} show="open" now={NOW} />);
    expect(mounted.container.textContent).toContain("No tickets");
    const get = mounted.container.querySelector(
      'a[href="/hub/support/tickets/new"]',
    );
    expect(get?.textContent).toBe("Get help");
    mounted.unmount();
    mounted = mount(<TicketList tickets={[]} show="closed" now={NOW} />);
    expect(mounted.container.textContent).toContain(TICKETS_COPY.closedEmpty);
  });
});

describe("TicketTypeCards", () => {
  function radios(root: HTMLElement): string[] {
    return Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).map((r) => r.value);
  }

  it("has four radios in order without billing (editor)", () => {
    mounted = mount(
      <TicketTypeCards
        types={ticketTypesFor("editor")}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(radios(mounted.container)).toEqual([
      "problem",
      "change",
      "question",
      "suggestion",
    ]);
    // Nothing preselected.
    expect(
      mounted.container.querySelector('input[type="radio"]:checked'),
    ).toBeNull();
  });

  it("has five with billing (owner); suggestion last and spanning", () => {
    const onChange = vi.fn();
    mounted = mount(
      <TicketTypeCards
        types={ticketTypesFor("owner")}
        value="question"
        onChange={onChange}
      />,
    );
    expect(radios(mounted.container)).toEqual([
      "problem",
      "change",
      "question",
      "billing",
      "suggestion",
    ]);
    expect(mounted.container.textContent).toContain("Something isn't working");
    expect(mounted.container.textContent).toContain("Suggest a feature");
    const last = mounted.container.querySelector(
      'label[for$="-suggestion"]',
    ) as HTMLElement;
    expect(last.className).toContain("sm:col-span-2");
    click(mounted.container.querySelector('input[value="billing"]'));
    expect(onChange).toHaveBeenCalledWith("billing");
  });

  it("TYPE-REQUIRED describes the group and marks the radios invalid (IN-D07)", () => {
    mounted = mount(
      <TicketTypeCards
        types={ticketTypesFor("owner")}
        value={null}
        onChange={() => {}}
        error="Choose what you need."
      />,
    );
    const fieldset = mounted.container.querySelector("fieldset")!;
    const id = fieldset.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.getAttribute("role")).toBe("alert");
    for (const r of Array.from(
      mounted.container.querySelectorAll('input[type="radio"]'),
    )) {
      expect(r.getAttribute("aria-invalid")).toBe("true");
    }
  });
});

describe("TargetSelect", () => {
  const options = buildTargetOptions({
    pages: [{ id: "p1", title: "Home" }],
    addons: [{ slug: "events", name: "Events" }],
  });

  it("renders four optgroups with Whole site selected by default", () => {
    mounted = mount(<TargetSelect options={options} />);
    const select = mounted.container.querySelector("select")!;
    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => g.label,
    );
    expect(groups).toEqual(["Your site", "Pages", "Add-ons", "Site parts"]);
    expect(select.value).toBe("site:site");
    expect(select.selectedOptions[0]?.textContent).toBe("Whole site");
    const label = mounted.container.querySelector(`label[for="${select.id}"]`);
    expect(label?.textContent).toBe("About");
    expect(mounted.container.textContent).toContain(
      "Pick the closest. You can explain below.",
    );
  });

  it("a stale value shows Whole site and tells a controlled parent (IN-D07)", () => {
    const onChange = vi.fn();
    mounted = mount(
      <TargetSelect
        options={options}
        value="page:deleted"
        onChange={onChange}
      />,
    );
    expect(mounted.container.querySelector("select")!.value).toBe("site:site");
    expect(onChange).toHaveBeenCalledWith("site:site");
  });

  it("preselects a given value", () => {
    mounted = mount(<TargetSelect options={options} value="addon:events" />);
    expect(mounted.container.querySelector("select")!.value).toBe(
      "addon:events",
    );
  });
});

describe("HelpDeflect", () => {
  const articles = [
    {
      id: "hours",
      title: "Change your opening hours",
      summary: "Set the hours on your site.",
      href: "/hub/help/hours",
    },
    {
      id: "pages",
      title: "Edit a page",
      summary: "Change words and photos.",
      href: "/hub/help/pages",
    },
    {
      id: "menus",
      title: "Change your menu",
      summary: "Add or reorder menu links.",
      href: "/hub/help/menus",
    },
    {
      id: "theming",
      title: "Change the look",
      summary: "Colours and fonts.",
      href: "/hub/help/theming",
    },
    {
      id: "seo",
      title: "Search and sharing",
      summary: "How your site shows on Google.",
      href: "/hub/help/seo",
    },
  ];

  it("matches words case-insensitively, best first, up to three", () => {
    const got = filterHelpDeflect(articles, "CHANGE my hours");
    expect(got.length).toBeLessThanOrEqual(3);
    expect(got[0]!.id).toBe("hours");
    expect(filterHelpDeflect(articles, "ab")).toEqual([]);
    expect(filterHelpDeflect(articles, "zzzz")).toEqual([]);
  });

  it("keeps accented words whole (IN-D05)", () => {
    const cafe = [
      { id: "cafe", title: "Café menú", summary: "x", href: "/hub/help/c" },
      { id: "other", title: "Caf stuff", summary: "x", href: "/hub/help/o" },
    ];
    expect(filterHelpDeflect(cafe, "café").map((a) => a.id)).toEqual(["cafe"]);
  });

  it("shows up to three links after the debounce, with a polite count", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    mounted = mount(
      <HelpDeflect
        query="change my hours"
        articles={articles}
        onOpen={onOpen}
      />,
    );
    expect(mounted.container.querySelectorAll("a")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(260);
    });
    const links = mounted.container.querySelectorAll("a");
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(3);
    expect(links[0]!.textContent).toContain("Change your opening hours");
    const live = mounted.container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(
      `${links.length} help articles might answer this`,
    );
    expect(mounted.container.textContent).toContain("This might answer it");
    click(links[0]);
    expect(onOpen).toHaveBeenCalledWith("hours");
  });

  it("shows nothing for a short query or when disabled (Billing)", () => {
    vi.useFakeTimers();
    mounted = mount(<HelpDeflect query="ab" articles={articles} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mounted.container.querySelectorAll("a")).toHaveLength(0);
    mounted.unmount();
    mounted = mount(
      <HelpDeflect query="change my hours" articles={articles} disabled />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mounted.container.querySelectorAll("a")).toHaveLength(0);
    expect(mounted.container.textContent).not.toContain("This might answer it");
  });
});

describe("TicketMeta", () => {
  it("shows SLA-LINE before the first Support reply and the solved button for writers", () => {
    const onSolved = vi.fn();
    mounted = mount(
      <TicketMeta
        ticket={ticket()}
        openedBy="Maria"
        firstReplyAt={null}
        canWrite
        onSolved={onSolved}
        timeZone={TZ}
        now={NOW}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(SUPPORT_COPY.SLA_LINE);
    expect(text).toContain("9 Oct by Maria");
    expect(text).toContain("2 hours ago");
    expect(mounted.container.querySelector("dl")).not.toBeNull();
    const b = button(mounted.container, "This is solved");
    expect(b).not.toBeNull();
    click(b);
    expect(onSolved).toHaveBeenCalled();
  });

  it("after the first reply shows the replied date, never missed/met wording", () => {
    mounted = mount(
      <TicketMeta
        ticket={ticket({ openedByCds: true })}
        firstReplyAt="2026-10-10T15:00:00Z"
        canWrite
        onSolved={() => {}}
        timeZone={TZ}
        now={NOW}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Support first replied 10 Oct.");
    expect(text).toContain("9 Oct by Support");
    expect(text).not.toContain(SUPPORT_COPY.SLA_LINE);
    expect(text).not.toMatch(/missed|met\b|overdue/i);
  });

  it("has no SLA line for change requests and no solved button when closed or read-only", () => {
    mounted = mount(
      <TicketMeta
        ticket={ticket({ status: "closed", type: "change" })}
        firstReplyAt={null}
        canWrite
        onSolved={() => {}}
        timeZone={TZ}
        now={NOW}
      />,
    );
    expect(mounted.container.textContent).not.toContain(SUPPORT_COPY.SLA_LINE);
    expect(button(mounted.container, "This is solved")).toBeNull();
    mounted.unmount();
    mounted = mount(
      <TicketMeta
        ticket={ticket()}
        firstReplyAt={null}
        canWrite={false}
        onSolved={() => {}}
        timeZone={TZ}
        now={NOW}
      />,
    );
    expect(button(mounted.container, "This is solved")).toBeNull();
  });
});

describe("ClosedTicketPanel", () => {
  it("links to a prefilled new ticket", () => {
    const t = ticket({
      status: "closed",
      type: "change",
      target: { kind: "page", id: "p1", label: "Home" },
    });
    expect(followUpHref(t)).toBe(
      "/hub/support/tickets/new?target=page%3Ap1&type=change&ref=1042",
    );
    mounted = mount(<ClosedTicketPanel ticket={t} />);
    expect(mounted.container.textContent).toContain(SUPPORT_COPY.CLOSED_NOTE);
    const a = mounted.container.querySelector("a")!;
    expect(a.textContent).toBe("Open a new ticket");
    expect(a.getAttribute("href")).toBe(followUpHref(t));
  });
});
