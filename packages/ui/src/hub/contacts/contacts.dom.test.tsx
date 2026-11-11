// @vitest-environment jsdom
// 07-16 Task 2: Contacts hub components (CONTACTS-01/02, D132, D266; 07-UI-SPEC "Contacts").
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import { ContactDrawer, type ContactDrawerProps } from "./ContactDrawer";
import { ContactFilters } from "./ContactFilters";
import { ContactsTable } from "./ContactsTable";
import { ContactTagInput } from "./ContactTagInput";
import type { ConsentStatus, ContactView } from "./copy";

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

function contact(over: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    email: "maria@example.com",
    name: "Maria Lopez",
    phone: "512 555 0142",
    tags: ["VIP"],
    first_source: "form",
    last_seen_at: "2026-09-12T19:14:00Z",
    consent: {
      status: "unconfirmed",
      at: "2026-09-12T19:14:00Z",
      source: "form",
      wording: "Send me news",
    },
    created: "2026-09-01T10:00:00Z",
    ...over,
  };
}

const DETAIL = {
  events: [
    {
      id: "e2",
      kind: "form",
      ref: "sub1",
      summary: "Sent the Contact form",
      at: "2026-09-12T19:14:00Z",
    },
    {
      id: "e1",
      kind: "import",
      ref: "",
      summary: "Imported from a spreadsheet",
      at: "2026-09-01T10:00:00Z",
    },
  ],
  notes: [
    {
      id: "n1",
      list: "h1",
      body: "Prefers mornings",
      author: "u1",
      mine: true,
      created: "2026-09-13T15:00:00Z",
    },
    {
      id: "n2",
      list: "h1",
      body: "Met at the fair",
      author: "u2",
      mine: false,
      created: "2026-09-10T15:00:00Z",
    },
  ],
};

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

function Link(
  props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
) {
  return <a {...props} />;
}

function drawer(over: Partial<ContactDrawerProps> = {}) {
  const props: ContactDrawerProps = {
    mode: "edit",
    contact: contact(),
    detail: DETAIL,
    knownTags: ["VIP", "Spring fair"],
    canWrite: true,
    timeZone: TZ,
    onSave: vi.fn(() => ok({ saved: contact() })),
    onUnsubscribe: vi.fn(() => ok(null)),
    onDelete: vi.fn(() => ok(null)),
    onAddNote: vi.fn((body: string) =>
      ok({
        id: "n9",
        list: "h1",
        body,
        author: "u1",
        mine: true,
        created: "2026-09-14T15:00:00Z",
      }),
    ),
    onDeleteNote: vi.fn(() =>
      ok({ contact: "c1", list: "h1", body: "Prefers mornings" }),
    ),
    onRestoreNote: vi.fn(() =>
      ok({
        id: "n10",
        list: "h1",
        body: "Prefers mornings",
        author: "u1",
        mine: true,
        created: "2026-09-13T15:00:00Z",
      }),
    ),
    onClose: vi.fn(),
    hrefForContact: (id: string) => `/hub/marketing?tab=contacts&contact=${id}`,
    messageHref: (ref: string) => `/hub/inbox?tab=messages&message=${ref}`,
    LinkComponent: Link,
    ...over,
  };
  mounted = mount(
    <ToastRegion>
      <ContactDrawer {...props} />
    </ToastRegion>,
  );
  return { el: mounted.container, props };
}

function wrap(ui: ReactNode) {
  mounted = mount(ui);
  return mounted.container;
}

describe("ContactDrawer", () => {
  it("titles the drawer with the name, else the email; new mode says Add contact with the helper", () => {
    let { el } = drawer();
    expect(el.querySelector("h2")?.textContent).toBe("Maria Lopez");
    mounted!.unmount();
    ({ el } = drawer({ contact: contact({ name: "" }) }));
    expect(el.querySelector("h2")?.textContent).toBe("maria@example.com");
    mounted!.unmount();
    ({ el } = drawer({ mode: "new", contact: null, detail: null }));
    expect(el.querySelector("h2")?.textContent).toBe("Add contact");
    expect(el.textContent).toContain(
      "To add people to your newsletter, they need to agree themselves",
    );
    expect(el.textContent).not.toContain("History");
  });

  it("Save contact is disabled until something changes; Discard resets", () => {
    const { el } = drawer();
    const save = button(el, "Save contact")!;
    expect(save.disabled).toBe(true);
    const name = el.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
    typeInto(name, "Maria L.");
    expect(button(el, "Save contact")!.disabled).toBe(false);
    click(button(el, "Discard changes"));
    expect(name.value).toBe("Maria Lopez");
    expect(button(el, "Save contact")!.disabled).toBe(true);
  });

  it("a duplicate email shows DUP-CONTACT with Open <label> and focuses Email", async () => {
    const onSave = vi.fn(() =>
      ok({
        exists: {
          id: "c9",
          label: "Ana Ruiz",
          message: "ana@example.com is already a contact.",
        },
      }),
    );
    const { el } = drawer({ onSave });
    const email = el.querySelector<HTMLInputElement>('input[type="email"]')!;
    typeInto(email, "ana@example.com");
    click(button(el, "Save contact"));
    await flush();
    expect(onSave).toHaveBeenCalledWith({
      id: "c1",
      name: "Maria Lopez",
      email: "ana@example.com",
      phone: "512 555 0142",
      tags: ["VIP"],
    });
    expect(el.textContent).toContain("ana@example.com is already a contact.");
    const open = Array.from(el.querySelectorAll("a")).find(
      (a) => a.textContent === "Open Ana Ruiz",
    )!;
    expect(open.getAttribute("href")).toBe(
      "/hub/marketing?tab=contacts&contact=c9",
    );
    expect(document.activeElement).toBe(email);
  });

  it("no control anywhere subscribes someone, for every consent status (D132)", () => {
    const statuses: ConsentStatus[] = [
      "none",
      "unconfirmed",
      "confirmed",
      "withdrawn",
    ];
    for (const status of statuses) {
      const { el } = drawer({
        contact: contact({ consent: { status } }),
      });
      const controls = Array.from(
        el.querySelectorAll("button, a, input, select, label"),
      ).map((n) => (n.textContent ?? "").trim());
      for (const text of controls) {
        expect(text).not.toMatch(/^(subscribe|add to newsletter|confirm)/i);
      }
      mounted!.unmount();
      mounted = null;
    }
  });

  it("Mark as unsubscribed shows only while agreed or subscribed, and only with write", () => {
    let { el } = drawer();
    expect(button(el, "Mark as unsubscribed")).not.toBeNull();
    mounted!.unmount();
    ({ el } = drawer({
      contact: contact({ consent: { status: "withdrawn" } }),
    }));
    expect(button(el, "Mark as unsubscribed")).toBeNull();
    mounted!.unmount();
    ({ el } = drawer({ canWrite: false }));
    expect(button(el, "Mark as unsubscribed")).toBeNull();
  });

  it("Mark as unsubscribed confirms in a dialog, then calls onUnsubscribe", async () => {
    const { el, props } = drawer();
    click(button(el, "Mark as unsubscribed"));
    expect(el.textContent).toContain("Mark Maria Lopez as unsubscribed?");
    const confirm = Array.from(
      el.querySelectorAll("dialog dialog button"),
    ).find((b) => b.textContent === "Mark as unsubscribed");
    click(confirm);
    await flush();
    expect(props.onUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("read-only: a <dl> of details and no footer, note form, delete or unsubscribe", () => {
    const { el } = drawer({ canWrite: false });
    expect(el.querySelector("dl")).not.toBeNull();
    expect(el.querySelector("form")).toBeNull();
    expect(button(el, "Save contact")).toBeNull();
    expect(button(el, "Add note")).toBeNull();
    expect(button(el, "Delete note")).toBeNull();
    expect(button(el, /More actions/)).toBeNull();
    expect(el.textContent).toContain("Prefers mornings");
  });

  it("history is newest first with an icon per kind and a message link for forms", () => {
    const { el } = drawer();
    const items = Array.from(el.querySelectorAll("[data-history] li"));
    expect(items.map((i) => i.getAttribute("data-event-icon"))).toEqual([
      "Mail",
      "Upload",
    ]);
    const link = items[0]!.querySelector("a")!;
    expect(link.textContent).toBe("Sent the Contact form");
    expect(link.getAttribute("href")).toBe(
      "/hub/inbox?tab=messages&message=sub1",
    );
    expect(items[1]!.querySelector("a")).toBeNull();
    expect(items[0]!.textContent).toContain("12 Sep, 2:14 pm");
  });

  it("History and Notes show skeletons until the detail arrives", () => {
    const { el } = drawer({ detail: null });
    expect(el.querySelectorAll("[data-skeleton-row]").length).toBeGreaterThan(
      0,
    );
    expect(el.querySelector("[data-history]")).toBeNull();
  });

  it("notes: author labels, Delete only on mine, Add note prepends", async () => {
    const { el, props } = drawer();
    const notes = Array.from(el.querySelectorAll("[data-note]"));
    expect(notes[0]!.textContent).toContain("You ·");
    expect(notes[1]!.textContent).toContain("A teammate ·");
    expect(notes[0]!.querySelector("button")?.textContent).toBe("Delete note");
    expect(notes[1]!.querySelector("button")).toBeNull();
    typeInto(el.querySelector("textarea"), "Call on Friday");
    click(button(el, "Add note"));
    await flush();
    expect(props.onAddNote).toHaveBeenCalledWith("Call on Friday");
    expect(el.querySelector("[data-note]")?.textContent).toContain(
      "Call on Friday",
    );
    expect(document.body.textContent).toContain("Note added.");
  });

  it("deleting a note shows an Undo toast that restores it", async () => {
    const { el, props } = drawer();
    click(el.querySelector('[data-note="n1"] button'));
    await flush();
    expect(props.onDeleteNote).toHaveBeenCalledWith("n1");
    expect(el.querySelector('[data-note="n1"]')).toBeNull();
    expect(document.body.textContent).toContain("Note deleted.");
    click(button(document.body, "Undo"));
    await flush();
    expect(props.onRestoreNote).toHaveBeenCalledWith({
      contact: "c1",
      list: "h1",
      body: "Prefers mornings",
    });
    expect(el.querySelector('[data-note="n10"]')).not.toBeNull();
  });

  it("Delete contact opens a danger dialog with Keep contact focused", async () => {
    const { el, props } = drawer();
    click(button(el, "More actions for Maria Lopez"));
    click(button(el, "Delete contact"));
    expect(el.textContent).toContain("Delete Maria Lopez?");
    expect(el.textContent).toContain(
      "Their details, notes and history are removed. Messages they sent stay in your Inbox.",
    );
    const keep = el.querySelector<HTMLButtonElement>("[data-keep-contact]")!;
    expect(document.activeElement).toBe(keep);
    const confirm = Array.from(
      el.querySelectorAll("dialog dialog button"),
    ).find((b) => b.textContent === "Delete contact");
    click(confirm);
    await flush();
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("ContactTagInput", () => {
  function tags(initial: string[] = ["VIP"]) {
    const onChange = vi.fn();
    const el = wrap(
      <ContactTagInput
        id="t"
        tags={initial}
        knownTags={["VIP", "Spring fair"]}
        onChange={onChange}
      />,
    );
    return { el, onChange, input: el.querySelector("input")! };
  }

  function key(input: HTMLInputElement, k: string) {
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true }),
      );
    });
  }

  it("Enter adds a trimmed tag; a case-insensitive repeat is ignored", () => {
    const { input, onChange } = tags();
    typeInto(input, "  Spring fair ");
    key(input, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(["VIP", "Spring fair"]);
    onChange.mockClear();
    typeInto(input, "vip");
    key(input, "Enter");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a comma adds the tag", () => {
    const { input, onChange } = tags([]);
    typeInto(input, "Fair,");
    expect(onChange).toHaveBeenLastCalledWith(["Fair"]);
  });

  it("each chip has a Remove tag button; Backspace on empty removes the last", () => {
    const { el, input, onChange } = tags(["VIP", "Fair"]);
    click(button(el, "Remove tag VIP"));
    expect(onChange).toHaveBeenLastCalledWith(["Fair"]);
    key(input, "Backspace");
    expect(onChange).toHaveBeenLastCalledWith(["VIP"]);
  });

  it("limits: over 40 characters or past 20 tags shows inline copy", () => {
    let { el, input, onChange } = tags([]);
    typeInto(input, "x".repeat(41));
    key(input, "Enter");
    expect(onChange).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Keep each tag under 40 characters.");
    mounted!.unmount();
    ({ el, input, onChange } = tags(
      Array.from({ length: 20 }, (_, i) => `t${i}`),
    ));
    typeInto(input, "one more");
    key(input, "Enter");
    expect(onChange).not.toHaveBeenCalled();
    expect(el.textContent).toContain("A contact can have up to 20 tags.");
  });

  it("offers known tags in a datalist", () => {
    const { el, input } = tags([]);
    const list = el.querySelector(`datalist#${input.getAttribute("list")}`)!;
    expect(
      Array.from(list.querySelectorAll("option")).map((o) => o.value),
    ).toEqual(["VIP", "Spring fair"]);
  });
});

describe("ContactsTable", () => {
  function table(
    rows: ContactView[],
    over: Partial<Parameters<typeof ContactsTable>[0]> = {},
  ) {
    const onOpen = vi.fn();
    const el = wrap(
      <ContactsTable
        rows={rows}
        sort="last_seen"
        page={1}
        totalPages={1}
        timeZone={TZ}
        onOpen={onOpen}
        hrefForSort={(s) => `?sort=${s}`}
        hrefForPage={(p) => `?page=${p}`}
        LinkComponent={Link}
        {...over}
      />,
    );
    return { el, onOpen };
  }

  it("sort headers carry aria-sort", () => {
    let { el } = table([contact()]);
    const ths = Array.from(el.querySelectorAll("th[aria-sort]"));
    expect(
      ths.map((t) => [t.textContent, t.getAttribute("aria-sort")]),
    ).toEqual([
      ["Name", "none"],
      ["Last activity", "descending"],
    ]);
    mounted!.unmount();
    ({ el } = table([contact()], { sort: "name" }));
    expect(el.querySelector("th[aria-sort]")!.getAttribute("aria-sort")).toBe(
      "ascending",
    );
  });

  it("shows two tag chips and +N, the badge and the date", () => {
    const { el } = table([contact({ tags: ["a", "b", "c", "d", "e"] })]);
    const row = el.querySelector("tr[data-contact-row]")!;
    expect(row.textContent).toContain("+3");
    expect(row.textContent).toContain("Not confirmed");
    expect(row.textContent).toContain("12 Sep 2026");
  });

  it("names render as text; an empty name says No name; clicking opens", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { el, onOpen } = table([
      contact({ id: "h", name: hostile }),
      contact({ id: "e", name: "" }),
    ]);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain(hostile);
    expect(el.textContent).toContain("No name");
    click(el.querySelector('table [data-contact-open="h"]'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "h" }));
  });

  it("pagination marks the current page", () => {
    const { el } = table([contact()], { page: 2, totalPages: 3 });
    const current = el.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe("2");
    expect(current[0]!.getAttribute("href")).toBe("?page=2");
    mounted!.unmount();
    mounted = null;
    const single = table([contact()]);
    expect(
      single.el.querySelector('nav[aria-label="Contact pages"]'),
    ).toBeNull();
  });
});

describe("ContactFilters", () => {
  const LISTS = [
    { id: "h1", name: "Everyone", kind: "house" as const },
    { id: "r1", name: "Ana's clients", kind: "renter" as const },
  ];

  function filters(
    values: Parameters<typeof ContactFilters>[0]["values"] = {},
    lists = LISTS.slice(0, 1),
  ) {
    const onChange = vi.fn();
    const el = wrap(
      <ContactFilters
        values={values}
        tags={["VIP"]}
        lists={lists}
        onChange={onChange}
      />,
    );
    return { el, onChange };
  }

  it("is a GET form to /hub/marketing with tab=contacts", () => {
    const { el } = filters();
    const form = el.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/hub/marketing");
    expect(
      form.querySelector<HTMLInputElement>('input[name="tab"]')!.value,
    ).toBe("contacts");
    expect(
      form.querySelector<HTMLInputElement>('input[name="q"]')!.placeholder,
    ).toBe("Search name, email or phone");
  });

  it("the List select shows only with 2+ lists", () => {
    let { el } = filters();
    expect(el.querySelector('select[name="list"]')).toBeNull();
    mounted!.unmount();
    ({ el } = filters({}, LISTS));
    expect(el.querySelector('select[name="list"]')).not.toBeNull();
  });

  it("Clear filters shows only while a filter is set, and clears them all", () => {
    const { el } = filters();
    expect(button(el, "Clear filters")).toBeNull();
    mounted!.unmount();
    mounted = null;
    const r = filters({ tag: "VIP", q: "maria" });
    click(button(r.el, "Clear filters"));
    expect(r.onChange).toHaveBeenCalledWith({
      q: null,
      source: null,
      tag: null,
      consent: null,
      list: null,
    });
  });

  it("a select change fires at once; search waits 300ms", () => {
    vi.useFakeTimers();
    const { el, onChange } = filters();
    const source = el.querySelector<HTMLSelectElement>(
      'select[name="source"]',
    )!;
    act(() => {
      source.value = "form";
      source.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ source: "form" });
    onChange.mockClear();
    typeInto(el.querySelector('input[name="q"]'), "mar");
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledWith({ q: "mar" });
  });

  it("the newsletter select maps to consent", () => {
    const { el, onChange } = filters();
    const sel = el.querySelector<HTMLSelectElement>(
      'select[name="newsletter"]',
    )!;
    act(() => {
      sel.value = "unsubscribed";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ consent: "unsubscribed" });
  });
});
