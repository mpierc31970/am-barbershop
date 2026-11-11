// @vitest-environment jsdom
// 07-16 Task 3: Marketing › Contacts (CONTACTS-01/02, D132, D236, D266, D-UI-P7-21/22;
// 07-UI-SPEC "Contacts"; T-07-16-01, T-07-16-03, T-07-16-07). The real server tab runs over a
// mocked session and @cds/db; the actions are mocked; the client panel renders in jsdom inside
// the hub ToastRegion.
import { NotFound } from "@cds/core";
import { ToastRegion } from "@cds/ui/hub";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, type ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/marketing",
  useRouter: () => ({
    push: vi.fn(),
    refresh: nav.refresh,
    replace: nav.replace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const STAFF = { orgId: "org1", actor: "u2", role: "staff", grants: ["x"] };
const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  listContacts: vi.fn(),
  listContactTags: vi.fn(),
  listContactLists: vi.fn(),
  getContact: vi.fn(),
  getBusinessProfile: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const actions = vi.hoisted(() => ({
  saveContactAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  deleteContactAction: vi.fn(),
  addContactNoteAction: vi.fn(),
  deleteContactNoteAction: vi.fn(),
  exportContactsAction: vi.fn(),
  contactsTemplateAction: vi.fn(),
  readContactImportHeaderAction: vi.fn(),
  previewContactImportAction: vi.fn(),
  commitContactImportAction: vi.fn(),
}));
vi.mock("../app/actions/contacts", () => actions);

const { ContactsTab } =
  await import("../app/(platform)/hub/marketing/ContactsTab");
const { CONTACTS_STEPS, CONTACTS_HOWTO } =
  await import("../app/(platform)/hub/marketing/contacts-steps");
const { default: MarketingLoading } =
  await import("../app/(platform)/hub/marketing/loading");

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

function row(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.com`,
    name,
    phone: "",
    tags: [],
    first_source: "form",
    last_seen_at: "2026-09-12T19:14:00Z",
    consent: { status: "none" },
    created: "2026-09-01T10:00:00Z",
    ...over,
  };
}

const ROWS = [row("c1", "Maria Lopez"), row("c2", "Ana Ruiz"), row("c3", "")];
const HOUSE = { id: "h1", name: "Everyone", kind: "house" };

function pageOf(items: unknown[], over: Record<string, unknown> = {}) {
  return {
    items,
    page: 1,
    perPage: 50,
    totalItems: items.length,
    totalPages: items.length > 0 ? 1 : 0,
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset();
  nav.replace.mockReset();
  nav.refresh.mockReset();
  sess.requireHubSession.mockResolvedValue({
    ctx: OWNER,
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.listContacts.mockResolvedValue(pageOf(ROWS));
  db.listContactTags.mockResolvedValue(["VIP"]);
  db.listContactLists.mockResolvedValue([HOUSE]);
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
});

async function render(sp: Record<string, string | string[] | undefined>) {
  const el = await ContactsTab({ tab: "contacts", ...sp });
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  await flush();
  return mounted.container;
}

function asStaff() {
  sess.requireHubSession.mockResolvedValue({
    ctx: STAFF,
    email: "s@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

describe("ContactsTab (07-16)", () => {
  it("owner: heading, how-to, count, Add contact, Import, overflow, filters and the table", async () => {
    const el = await render({});
    expect(el.querySelector("h2")?.textContent).toBe("Contacts");
    // 11-47 (D-UI-P11-16): the Marketing ScreenHeader "?" opens the how-to, not the tab header.
    expect(button(el, "How Contacts works")).toBeNull();
    expect(el.textContent).toContain("3 contacts");
    const add = button(el, "Add contact")!;
    expect(add.className).toContain("bg-hub-accent");
    expect(button(el, "Import contacts")).not.toBeNull();
    click(button(el, "More actions for Contacts"));
    expect(button(el, "Export CSV")).not.toBeNull();
    expect(button(el, "Download the template")).not.toBeNull();
    expect(el.querySelector('form[role="search"]')).not.toBeNull();
    expect(el.querySelectorAll("tr[data-contact-row]")).toHaveLength(3);
    expect(db.listContacts).toHaveBeenCalledWith(OWNER, {
      sort: "last_seen",
      perPage: 50,
    });
    expect(db.listContactTags).toHaveBeenCalledWith(OWNER, {});
    expect(db.getContact).not.toHaveBeenCalled();
  });

  it("passes the parsed filters to listContacts", async () => {
    await render({ q: "maria", newsletter: "subscribed", page: "2" });
    expect(db.listContacts).toHaveBeenCalledWith(OWNER, {
      q: "maria",
      consent: "subscribed",
      page: 2,
      perPage: 50,
      sort: "last_seen",
    });
  });

  it("an unknown newsletter value is dropped, never thrown", async () => {
    await render({ newsletter: "bogus", source: "nope", sort: "x" });
    expect(db.listContacts).toHaveBeenCalledWith(OWNER, {
      sort: "last_seen",
      perPage: 50,
    });
  });

  it("no contacts and no filters: EMPTY-CONTACTS with one primary and the import helper", async () => {
    db.listContacts.mockResolvedValue(pageOf([]));
    db.listContactTags.mockResolvedValue([]);
    const el = await render({});
    expect(el.textContent).toContain("No contacts yet");
    expect(el.textContent).toContain(
      "Everyone who sends a form on your site is saved here, merged by email. Add people yourself or import a list.",
    );
    expect(el.textContent).toContain(
      "Have a list in Excel or another mailing tool? Export it as CSV and import it here.",
    );
    const primaries = Array.from(el.querySelectorAll("button")).filter((b) =>
      b.className.includes("bg-hub-accent"),
    );
    expect(primaries.map((b) => b.textContent)).toEqual(["Add contact"]);
    expect(button(el, "Import from a spreadsheet")).not.toBeNull();
    expect(el.querySelector('form[role="search"]')).toBeNull();
  });

  it("no contacts with filters: the filtered empty line and Clear filters", async () => {
    db.listContacts.mockResolvedValue(pageOf([]));
    const el = await render({ tag: "VIP" });
    expect(el.textContent).toContain("No contacts match these filters.");
    expect(el.textContent).not.toContain("No contacts yet");
    const clear = Array.from(el.querySelectorAll("button")).filter(
      (b) => b.textContent === "Clear filters",
    );
    expect(clear.length).toBeGreaterThan(0);
    click(clear[clear.length - 1]);
    await flush();
    expect(nav.replace).toHaveBeenCalledWith("/hub/marketing?tab=contacts", {
      scroll: false,
    });
  });

  it("&contact=<id> reads the contact and opens the drawer with history and notes", async () => {
    db.getContact.mockResolvedValue({
      contact: row("c1", "Maria Lopez", {
        consent: {
          status: "unconfirmed",
          at: "2026-09-12T19:14:00Z",
          source: "form",
          wording: "Send me news",
        },
      }),
      events: [
        {
          id: "e1",
          kind: "form",
          ref: "sub1",
          summary: "Sent the Contact form",
          at: "2026-09-12T19:14:00Z",
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
      ],
      lists: [HOUSE],
    });
    const el = await render({ contact: "c1" });
    expect(db.getContact).toHaveBeenCalledWith(OWNER, "c1");
    const drawer = el.querySelector('dialog[aria-label="Maria Lopez"]')!;
    expect(drawer).not.toBeNull();
    expect(drawer.textContent).toContain("Sent the Contact form");
    expect(drawer.textContent).toContain("Prefers mornings");
    expect(drawer.textContent).toContain(
      "Agreed on a form on your site, 12 Sep, 2:14 pm",
    );
    const link = Array.from(drawer.querySelectorAll("a")).find(
      (a) => a.textContent === "Sent the Contact form",
    )!;
    expect(link.getAttribute("href")).toBe(
      "/hub/inbox?tab=messages&message=sub1",
    );
  });

  it("a contact that is gone shows the info alert and no drawer", async () => {
    db.getContact.mockRejectedValue(new NotFound());
    const el = await render({ contact: "zz9" });
    expect(el.textContent).toContain(
      "This was removed or moved. Reload the page to see the latest.",
    );
    expect(el.querySelector("dialog[aria-label='Maria Lopez']")).toBeNull();
    expect(el.querySelectorAll("tr[data-contact-row]")).toHaveLength(3);
  });

  it("any other getContact failure rethrows (the page shows ERR-LOAD)", async () => {
    db.getContact.mockRejectedValue(new Error("pb down"));
    await expect(ContactsTab({ contact: "c1" })).rejects.toThrow("pb down");
  });

  it("&contact=new opens Add contact with no getContact call", async () => {
    const el = await render({ contact: "new" });
    expect(db.getContact).not.toHaveBeenCalled();
    const drawer = el.querySelector('dialog[aria-label="Add contact"]')!;
    expect(drawer).not.toBeNull();
    expect(drawer.textContent).toContain(
      "To add people to your newsletter, they need to agree themselves",
    );
  });

  it("staff (contacts read only): no Add, Import or template; Export stays; the drawer is read-only", async () => {
    asStaff();
    db.getBusinessProfile.mockRejectedValue(new Error("forbidden"));
    db.getContact.mockResolvedValue({
      contact: row("c1", "Maria Lopez", {
        consent: { status: "confirmed", at: "2026-09-12T19:14:00Z" },
      }),
      events: [],
      notes: [],
      lists: [HOUSE],
    });
    const el = await render({ contact: "c1" });
    expect(button(el, "Add contact")).toBeNull();
    expect(button(el, "Import contacts")).toBeNull();
    expect(el.textContent).not.toContain("Import contacts");
    click(button(el, "More actions for Contacts"));
    expect(button(el, "Export CSV")).not.toBeNull();
    expect(button(el, "Download the template")).toBeNull();
    const drawer = el.querySelector('dialog[aria-label="Maria Lopez"]')!;
    expect(drawer.querySelector("dl")).not.toBeNull();
    expect(button(drawer, "Save contact")).toBeNull();
    expect(button(drawer, "Mark as unsubscribed")).toBeNull();
    expect(button(drawer, "Add note")).toBeNull();
    // The time zone read was refused: dates fall back to UTC and the page still renders.
    expect(el.textContent).toContain("12 Sep 2026");
  });

  it("the List select appears only with 2+ lists", async () => {
    let el = await render({});
    expect(el.querySelector('select[name="list"]')).toBeNull();
    mounted!.unmount();
    mounted = null;
    db.listContactLists.mockResolvedValue([
      HOUSE,
      { id: "r1", name: "Ana's clients", kind: "renter" },
    ]);
    el = await render({});
    expect(el.querySelector('select[name="list"]')).not.toBeNull();
  });

  it("a list in the URL scopes every read", async () => {
    db.getContact.mockResolvedValue({
      contact: row("c1", "Maria Lopez"),
      events: [],
      notes: [],
      lists: [HOUSE],
    });
    await render({ list: "r1", contact: "c1" });
    expect(db.listContacts).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ list: "r1" }),
    );
    expect(db.listContactTags).toHaveBeenCalledWith(OWNER, { list: "r1" });
    expect(db.getContact).toHaveBeenCalledWith(OWNER, "c1", { list: "r1" });
  });

  it("the time zone comes from the business profile", async () => {
    db.getBusinessProfile.mockResolvedValue({ time_zone: "Asia/Tokyo" });
    db.listContacts.mockResolvedValue(
      pageOf([row("c1", "M", { last_seen_at: "2026-09-12T19:14:00Z" })]),
    );
    const el = await render({});
    expect(el.textContent).toContain("13 Sep 2026");
  });

  it("clicking a name opens the drawer at once and puts contact=<id> in the URL", async () => {
    const el = await render({});
    click(el.querySelector('table [data-contact-open="c2"]'));
    await flush();
    expect(el.querySelector('dialog[aria-label="Ana Ruiz"]')).not.toBeNull();
    expect(nav.replace).toHaveBeenCalledWith(
      "/hub/marketing?tab=contacts&contact=c2",
      { scroll: false },
    );
  });

  it("saving a new contact toasts and moves the URL to the new contact", async () => {
    actions.saveContactAction.mockResolvedValue({
      ok: true,
      data: { saved: row("c9", "Ana") },
    });
    const el = await render({ contact: "new" });
    const drawer = el.querySelector('dialog[aria-label="Add contact"]')!;
    const email = drawer.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(email, "ana@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(button(drawer, "Save contact"));
    await flush();
    expect(actions.saveContactAction).toHaveBeenCalledWith({
      name: "",
      email: "ana@example.com",
      phone: "",
      tags: [],
    });
    expect(document.body.textContent).toContain("Contact saved.");
    expect(nav.replace).toHaveBeenLastCalledWith(
      "/hub/marketing?tab=contacts&contact=c9",
      { scroll: false },
    );
  });

  it("the import dialog uses column matching and additive mode", async () => {
    const el = await render({});
    click(button(el, "Import contacts"));
    expect(el.textContent).toContain("Step 1 of 4 · Choose a file");
    expect(el.textContent).toContain(
      "Exports from Mailchimp, Square or Google Contacts work too.",
    );
  });

  it("the loading state shows 8 skeleton rows of 56px", () => {
    mounted = mount(<MarketingLoading />);
    const rows = mounted.container.querySelectorAll("[data-skeleton-row]");
    expect(rows).toHaveLength(8);
    expect((rows[0] as HTMLElement).style.height).toBe("56px");
  });

  it("the baked how-to steps match docs/how-to/contacts.md (drift)", async () => {
    const gen =
      (await import("../../../packages/addon-registry/scripts/gen.mjs")) as {
        parseUseSteps: (md: string) => unknown[];
      };
    const md = readFileSync(
      path.resolve(import.meta.dirname, "../../..", CONTACTS_HOWTO),
      "utf8",
    );
    expect(gen.parseUseSteps(md)).toEqual(
      CONTACTS_STEPS.map((s) => ({ ...s })),
    );
    expect(CONTACTS_STEPS.length).toBe(10);
  });

  it("ContactsTab no longer shows the 07-03 shell", () => {
    const src = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../app/(platform)/hub/marketing/ContactsTab.tsx",
      ),
      "utf8",
    );
    expect(src).not.toContain("SHELL_PANEL_BODY");
  });
});
