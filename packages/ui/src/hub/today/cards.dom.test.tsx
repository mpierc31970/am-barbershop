// @vitest-environment jsdom
// Today cards, Customize, This week, From CDS and work-in-progress components (11-19; DASH-21,
// DASH-22, DASH-23, DASH-32, DASH-33; 11-UI-SPEC "Today" §§ 4-6, 8; D-UI-P11-9).
import type {
  FromCdsCard as FromCdsCardData,
  NeedsYouItem,
} from "@cds/core/today";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { click, flush, mount, type Mounted } from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import {
  BuildWorkCard,
  CustomizeTodaySheet,
  FromCdsCard,
  NeedsYouList,
  ThisWeek,
  TODAY_CARDS_COPY,
  TodayCard,
  TodayCards,
  applyLayout,
  layoutOf,
  weekDelta,
  weekRangeLabel,
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
  document.body.innerHTML = "";
});

const ROWS = [1, 2, 3, 4, 5].map((n) => ({
  label: `Person ${n} · Contact form`,
  value: "Tue",
  href: `/hub/inbox?message=m${n}`,
}));

const CARD = {
  title: "Inquiries",
  rows: ROWS,
  link: { label: "Open Inbox", href: "/hub/inbox" },
};

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const b = [...root.querySelectorAll("button")].find(
    (x) => x.getAttribute("aria-label") === name || x.textContent === name,
  );
  if (!b) throw new Error(`no button ${name}`);
  return b as HTMLButtonElement;
}

describe("TodayCard", () => {
  it("renders at most 4 rows and one card link", () => {
    mounted = mount(
      <TodayCard id="inquiries" data={CARD} footer="7 messages this week" />,
    );
    const root = mounted.container;
    expect(root.querySelectorAll("[data-card-row]")).toHaveLength(4);
    expect(root.querySelector("h3")!.textContent).toBe("Inquiries");
    const links = [...root.querySelectorAll("a")];
    expect(links.filter((a) => a.textContent === "Open Inbox")).toHaveLength(1);
    expect(root.textContent).toContain("7 messages this week");
  });

  it("the numbers-only variant has no links at all", () => {
    mounted = mount(<TodayCard id="inquiries" data={CARD} linked={false} />);
    expect(mounted.container.querySelectorAll("a")).toHaveLength(0);
    expect(mounted.container.querySelectorAll("[data-card-row]")).toHaveLength(
      4,
    );
  });

  it("shows the empty line when there are no rows", () => {
    mounted = mount(
      <TodayCard
        id="inquiries"
        data={{ ...CARD, rows: [] }}
        empty="No messages this week."
      />,
    );
    expect(mounted.container.textContent).toContain("No messages this week.");
  });
});

const ALL = [
  { id: "inquiries", title: "Inquiries" },
  { id: "bookings", title: "Bookings" },
  { id: "orders", title: "Orders" },
];

function sheet(over: Partial<Parameters<typeof CustomizeTodaySheet>[0]> = {}) {
  const onSave = vi.fn(async () => ({ ok: true as const, data: {} }));
  mounted = mount(
    <CustomizeTodaySheet
      open
      onClose={() => {}}
      cards={ALL}
      hidden={[]}
      defaultOrder={["inquiries", "bookings", "orders"]}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave, root: document.body };
}

function rowIds(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-customize-row]")].map((r) =>
    r.getAttribute("data-customize-row")!,
  );
}

describe("CustomizeTodaySheet", () => {
  it("Move down on the first card moves it second and saves", async () => {
    const { onSave, root } = sheet();
    click(buttonNamed(root, "Move Inquiries down"));
    await flush();
    expect(rowIds(root)).toEqual(["bookings", "inquiries", "orders"]);
    expect(onSave).toHaveBeenLastCalledWith({
      order: ["bookings", "inquiries", "orders"],
      hidden: [],
    });
  });

  it("hiding a card removes it from the saved order", async () => {
    const { onSave, root } = sheet();
    const sw = root.querySelector<HTMLInputElement>(
      'input[aria-label="Show Bookings"]',
    )!;
    expect(sw.checked).toBe(true);
    click(sw);
    await flush();
    expect(onSave).toHaveBeenLastCalledWith({
      order: ["inquiries", "orders"],
      hidden: ["bookings"],
    });
  });

  it("keyboard path: the Move buttons are focusable buttons, no pointer needed", async () => {
    const { onSave, root } = sheet();
    const up = buttonNamed(root, "Move Orders up");
    up.focus();
    expect(document.activeElement).toBe(up);
    // Keyboard activation of a native button dispatches click.
    click(up);
    await flush();
    expect(rowIds(root)).toEqual(["inquiries", "orders", "bookings"]);
    expect(onSave).toHaveBeenCalledTimes(1);
    // The top row's Move up is soft-disabled and does nothing.
    click(buttonNamed(root, "Move Inquiries up"));
    await flush();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toContain(
      "Orders moved to position 2.",
    );
  });

  it("Reset to default order saves an empty order and keeps hidden cards hidden", async () => {
    const { onSave, root } = sheet({
      cards: [ALL[2]!, ALL[0]!, ALL[1]!],
      hidden: ["bookings"],
    });
    click(buttonNamed(root, "Reset to default order"));
    await flush();
    expect(rowIds(root)).toEqual(["inquiries", "bookings", "orders"]);
    expect(onSave).toHaveBeenLastCalledWith({
      order: [],
      hidden: ["bookings"],
    });
  });

  it("impersonating: read-only, with the note, and nothing saves", async () => {
    const { onSave, root } = sheet({ impersonating: true });
    expect(root.textContent).toContain("You're viewing as support staff");
    click(buttonNamed(root, "Move Inquiries down"));
    click(root.querySelector('input[aria-label="Show Bookings"]'));
    click(buttonNamed(root, "Reset to default order"));
    await flush();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("layoutOf splits visible and hidden ids", () => {
    expect(layoutOf(["a", "b", "c"], new Set(["b"]))).toEqual({
      order: ["a", "c"],
      hidden: ["b"],
    });
  });
});

describe("TodayCards", () => {
  const views = ALL.map((c) => ({
    ...c,
    state: "ok" as const,
    data: { title: c.title, rows: [], link: { label: "Open", href: "/hub" } },
    empty: "Nothing yet.",
  }));

  it("lists the cards with a Customize button; all hidden shows the line", async () => {
    const onSave = vi.fn(async () => ({ ok: true as const, data: {} }));
    mounted = mount(
      <ToastRegion>
        <TodayCards
          cards={views}
          all={ALL}
          hidden={[]}
          defaultOrder={ALL.map((c) => c.id)}
          onSave={onSave}
        />
      </ToastRegion>,
    );
    const root = mounted.container;
    expect(root.querySelectorAll("[data-today-card]")).toHaveLength(3);
    expect(root.textContent).toContain(TODAY_CARDS_COPY.yourDay);
    mounted.unmount();
    mounted = mount(
      <TodayCards
        cards={[]}
        all={ALL}
        hidden={ALL.map((c) => c.id)}
        defaultOrder={ALL.map((c) => c.id)}
        onSave={onSave}
      />,
    );
    expect(mounted.container.textContent).toContain(
      "You've hidden all your cards.",
    );
  });

  it("a failed card shows its error line and the others render", () => {
    mounted = mount(
      <TodayCards
        cards={[
          views[0]!,
          { id: "bookings", title: "Bookings", state: "error" },
        ]}
        all={ALL}
        hidden={[]}
        defaultOrder={ALL.map((c) => c.id)}
        onSave={vi.fn()}
      />,
    );
    expect(mounted.container.querySelector("[data-card-error]")).not.toBeNull();
    expect(mounted.container.textContent).toContain(
      "We couldn't load this card.",
    );
  });

  it("applyLayout orders named ids first and drops hidden ones", () => {
    expect(
      applyLayout(views, { order: ["orders"], hidden: ["bookings"] }).map(
        (c) => c.id,
      ),
    ).toEqual(["orders", "inquiries"]);
    expect(applyLayout(views, null).map((c) => c.id)).toEqual([
      "inquiries",
      "bookings",
      "orders",
    ]);
  });
});

describe("ThisWeek", () => {
  it("before launch: the first-numbers note, no numbers and no link", () => {
    mounted = mount(
      <ThisWeek
        live={false}
        rows={[{ id: "visitors", name: "Visitors", now: 12, prev: 3 }]}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(
      "Your first numbers appear a day after launch.",
    );
    expect(root.querySelector("[data-week-row]")).toBeNull();
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).not.toContain("12");
  });

  it("live: figures with plain-word deltas and the Site Report link", () => {
    const days = [6, 7, 8, 9, 10, 11, 12].map(
      (d) => `2026-10-${String(d).padStart(2, "0")}`,
    );
    mounted = mount(
      <ThisWeek
        live
        days={days}
        rows={[
          { id: "visitors", name: "Visitors", now: 140, prev: 128 },
          { id: "messages", name: "Messages", now: 4, prev: 7 },
          { id: "bookings", name: "Bookings", now: 5, prev: 5 },
        ]}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain("Mon 6 – Sun 12 Oct");
    expect(root.textContent).toContain("12 more than last week");
    expect(root.textContent).toContain("3 fewer than last week");
    expect(root.textContent).toContain("Same as last week");
    const link = root.querySelector("a")!;
    expect(link.textContent).toBe("See your Site Report");
    expect(link.getAttribute("href")).toBe("/hub/reports");
  });

  it("weekDelta and weekRangeLabel", () => {
    expect(weekDelta(1, 0)).toEqual({
      dir: "up",
      words: "1 more than last week",
    });
    expect(weekDelta(0, 0).words).toBe("Same as last week");
    expect(
      weekRangeLabel([
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
      ]),
    ).toBe("Mon 28 Sep – Sun 4 Oct");
    expect(weekRangeLabel([])).toBe("");
  });
});

describe("FromCdsCard", () => {
  const tip: FromCdsCardData = {
    kind: "tip",
    id: "tip:reply-fast",
    title: "Reply to new messages within a day",
    text: "People who hear back the same day are far more likely to book.",
    link: { label: "Open Inbox", href: "/hub/inbox" },
  };

  it("Dismiss calls onDismiss(id) and the card leaves", () => {
    const onDismiss = vi.fn();
    mounted = mount(<FromCdsCard card={tip} onDismiss={onDismiss} />);
    const root = mounted.container;
    expect(root.querySelector("[data-cds-identity]")!.textContent).toBe(
      "From Support",
    );
    click(buttonNamed(root, "Dismiss this card"));
    expect(onDismiss).toHaveBeenCalledWith("tip:reply-fast");
    expect(root.querySelector("[data-from-cds]")).toBeNull();
  });

  it("no Dismiss when it can't be dismissed (impersonating)", () => {
    mounted = mount(
      <FromCdsCard card={tip} canDismiss={false} onDismiss={vi.fn()} />,
    );
    expect(
      mounted.container.querySelector('[aria-label="Dismiss this card"]'),
    ).toBeNull();
  });

  it("each kind's link", () => {
    mounted = mount(
      <FromCdsCard
        card={{
          kind: "addon",
          id: "addon:testimonials",
          slug: "testimonials",
          title: "Testimonials",
          text: "Show what clients say.",
          href: "/hub/add-ons/testimonials",
        }}
      />,
    );
    const a = mounted.container.querySelector("a")!;
    expect(a.textContent).toBe("See Testimonials");
    expect(a.getAttribute("href")).toBe("/hub/add-ons/testimonials");
    mounted.unmount();
    mounted = mount(
      <FromCdsCard
        card={{
          kind: "training",
          id: "training:credentials",
          slug: "credentials",
          title: "Getting started with Credentials",
          text: "Show your licenses.",
        }}
        steps={[{ screen: "Website", action: "Open it", expected: "It opens" }]}
      />,
    );
    expect(buttonNamed(mounted.container, "Show me how")).toBeTruthy();
    mounted.unmount();
    mounted = mount(
      <FromCdsCard
        card={{
          kind: "announcement",
          id: "announcement:a1",
          title: "New: phone alerts",
          text: "Turn them on in your profile.",
          link: { label: "Read more", href: "https://example.com/news" },
        }}
      />,
    );
    const ext = mounted.container.querySelector("a")!;
    expect(ext.getAttribute("target")).toBe("_blank");
    expect(ext.getAttribute("rel")).toContain("noopener");
  });

  it("note kind: title, text, Read the note, and the Support mark inside data-cds-identity (12-29)", () => {
    mounted = mount(
      <FromCdsCard
        card={{
          kind: "note",
          id: "note:n1",
          title: "Your new booking page is live",
          text: "We moved the booking button to the top.",
          link: { label: "Read the note", href: "/hub/support?tab=messages" },
        }}
        onDismiss={vi.fn()}
      />,
    );
    const root = mounted.container;
    expect(
      root.querySelector("[data-from-cds]")!.getAttribute("data-from-cds"),
    ).toBe("note");
    expect(root.textContent).toContain("Your new booking page is live");
    expect(root.textContent).toContain(
      "We moved the booking button to the top.",
    );
    const a = root.querySelector("a")!;
    expect(a.textContent).toBe("Read the note");
    expect(a.getAttribute("href")).toBe("/hub/support?tab=messages");
    const mark = root.querySelector("[data-cds-mark]")!;
    expect(mark).toBeTruthy();
    expect(mark.getAttribute("width")).toBe("20");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.closest("[data-cds-identity]")).not.toBeNull();
    expect(root.querySelector("h2")!.textContent).toBe("From Support");
  });

  it("every kind carries the Support mark before the heading", () => {
    mounted = mount(<FromCdsCard card={tip} />);
    const mark = mounted.container.querySelector("[data-cds-mark]")!;
    expect(mark.closest("[data-cds-identity]")).not.toBeNull();
  });
});

describe("NeedsYouList Support marker (12-29)", () => {
  function item(over: Partial<NeedsYouItem> & { key: string }): NeedsYouItem {
    return {
      kind: "test",
      level: "normal",
      title: `Title ${over.key}`,
      actionLabel: "Open",
      href: "/hub/support",
      section: "support",
      at: "2026-10-11T10:00:00.000Z",
      ...over,
    };
  }

  it("support: rows show the CdsMark inside data-cds-identity; urgent and tenant rows do not", () => {
    mounted = mount(
      <NeedsYouList
        items={[
          item({
            key: "support:notice:w1",
            level: "urgent",
            title: "Support is working on your site until 4:00 pm",
          }),
          item({
            key: "support:ticket:1001",
            title: "Support replied to ticket #1001",
          }),
          item({ key: "inbox:m1", section: "inbox", title: "New message" }),
        ]}
      />,
    );
    const at = (k: string) =>
      mounted!.container.querySelector(`[data-needs-you-item="${k}"]`)!;
    const mark = at("support:ticket:1001").querySelector("[data-cds-mark]");
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("width")).toBe("16");
    expect(mark!.closest("[data-cds-identity]")).not.toBeNull();
    const urgent = at("support:notice:w1");
    expect(urgent.querySelector("[data-cds-mark]")).toBeNull();
    expect(urgent.textContent).toContain("Urgent");
    expect(at("inbox:m1").querySelector("[data-cds-mark]")).toBeNull();
    expect(at("inbox:m1").querySelector("[data-cds-identity]")).toBeNull();
  });
});

describe("BuildWorkCard", () => {
  it("one row per job with the three steps and the current one marked", () => {
    mounted = mount(
      <BuildWorkCard
        jobs={[
          {
            id: "w1",
            title: "Studio Booking setup",
            step: "setting_up",
            startedLabel: "9 Oct",
            href: "/hub/settings/quotes/w1",
          },
        ]}
      />,
    );
    const root = mounted.container;
    const job = root.querySelector('[data-build-job="w1"]')!;
    expect(job.querySelectorAll("ol > li")).toHaveLength(3);
    expect(job.querySelector('[aria-current="step"]')!.textContent).toContain(
      "Support is setting it up",
    );
    expect(job.textContent).toContain("Started 9 Oct");
    expect(job.querySelector("a")!.getAttribute("href")).toBe(
      "/hub/settings/quotes/w1",
    );
  });

  it("renders nothing with no jobs", () => {
    mounted = mount(<BuildWorkCard jobs={[]} />);
    expect(mounted.container.querySelector("[data-build-work]")).toBeNull();
  });
});
