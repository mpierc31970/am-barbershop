// @vitest-environment jsdom
// 07-19 Task 3: Inbox hub components (CONT-25, D231, D271, D311, D-UI-P7-20; 07-UI-SPEC "Inbox";
// T-07-19-06 XSS, T-07-19-07 mailto, T-07-19-09 View contact).
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import type { MessageDetailView, MessageRowView } from "./copy";
import { InboxTable } from "./InboxTable";
import { InboxToolbar } from "./InboxToolbar";
import { MessageDrawer, type MessageDrawerProps } from "./MessageDrawer";

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
const NOW = new Date("2026-09-12T22:00:00Z");
const OK = { ok: true as const, data: null };

function row(over: Partial<MessageRowView> = {}): MessageRowView {
  return {
    id: "m1",
    form: "f1",
    formName: "Contact",
    formDeleted: false,
    from: "Maria Lopez",
    preview: "Do you do gluten-free cakes?",
    unread: false,
    spam: false,
    created: "2026-09-12T19:14:00Z",
    ...over,
  };
}

function detail(over: Partial<MessageDetailView> = {}): MessageDetailView {
  return {
    id: "m1",
    form: "f1",
    formName: "Contact",
    formDeleted: false,
    page: { id: "p1", title: "Home" },
    answers: [
      { label: "Name", value: "Maria Lopez" },
      { label: "Email", value: "maria@example.com" },
      { label: "Message", value: "Line one\nLine two" },
      { label: "Phone", value: "" },
    ],
    newsletter: true,
    email: "maria@example.com",
    contact: "c1",
    spam: false,
    readAt: "2026-09-12T20:00:00Z",
    created: "2026-09-12T19:14:00Z",
    ...over,
  };
}

function change(el: Element | null, value: string): void {
  if (!el) throw new Error("change: element not found");
  const select = el as HTMLSelectElement;
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("InboxToolbar", () => {
  const FORMS = [
    { id: "f1", name: "Contact", deleted: false },
    { id: "f2", name: "Quote", deleted: true },
  ];

  it("Form select: All forms, each form, deleted ones labelled; a change calls onChange", () => {
    const onChange = vi.fn();
    mounted = mount(
      <InboxToolbar
        tab="messages"
        forms={FORMS}
        onChange={onChange}
        onExport={vi.fn()}
      />,
    );
    const select = mounted.container.querySelector("select")!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "All forms",
      "Contact",
      "Quote (deleted)",
    ]);
    expect(
      mounted.container.querySelector(`label[for="${select.id}"]`)?.textContent,
    ).toBe("Form");
    change(select, "f2");
    expect(onChange).toHaveBeenCalledWith({ form: "f2" });
    change(select, "");
    expect(onChange).toHaveBeenLastCalledWith({ form: null });
  });

  it("no-JS GET form keeps the tab; the search box has the placeholder", () => {
    mounted = mount(
      <InboxToolbar
        tab="filtered"
        forms={FORMS}
        onChange={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    const form = mounted.container.querySelector('form[role="search"]')!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/hub/inbox");
    expect(
      form.querySelector<HTMLInputElement>('input[name="tab"]')?.value,
    ).toBe("filtered");
    expect(
      form.querySelector('input[type="search"]')?.getAttribute("placeholder"),
    ).toBe("Search messages");
  });

  it("search waits 300ms before calling onChange", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    mounted = mount(
      <InboxToolbar
        tab="messages"
        forms={FORMS}
        onChange={onChange}
        onExport={vi.fn()}
      />,
    );
    typeInto(mounted.container.querySelector('input[type="search"]'), "cake");
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledWith({ q: "cake" });
  });

  it("Export CSV is disabled with the hint until one form is chosen", () => {
    const onExport = vi.fn();
    mounted = mount(
      <InboxToolbar
        tab="messages"
        forms={FORMS}
        onChange={vi.fn()}
        onExport={onExport}
      />,
    );
    const btn = button(mounted.container, "Export CSV")!;
    expect(btn.disabled).toBe(true);
    expect(btn.className).not.toContain("bg-hub-accent");
    const hintId = btn.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)?.textContent).toBe(
      "Choose a form to export its messages.",
    );
    expect(btn.parentElement?.getAttribute("title")).toBe(
      "Choose a form to export its messages.",
    );
    mounted.unmount();
    mounted = mount(
      <InboxToolbar
        tab="messages"
        forms={FORMS}
        form="f1"
        onChange={vi.fn()}
        onExport={onExport}
      />,
    );
    const on = button(mounted.container, "Export CSV")!;
    expect(on.disabled).toBe(false);
    expect(on.hasAttribute("aria-describedby")).toBe(false);
    click(on);
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

describe("InboxTable", () => {
  it("table columns, unread row in 600 with the Unread badge, read row plain", () => {
    const onOpen = vi.fn();
    mounted = mount(
      <InboxTable
        rows={[
          row({ id: "m1", unread: true }),
          row({ id: "m2", from: "Ana Ruiz", created: "2026-09-10T15:00:00Z" }),
        ]}
        timeZone={TZ}
        now={NOW}
        onOpen={onOpen}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    );
    const el = mounted.container;
    expect(
      Array.from(el.querySelectorAll("thead th")).map((t) => t.textContent),
    ).toEqual(["From", "Form", "Preview", "Received"]);
    const unread = el.querySelector('tr[data-message-row="m1"]')!;
    expect(unread.hasAttribute("data-unread")).toBe(true);
    expect(
      unread.querySelector("button[data-message-open]")?.className,
    ).toContain("font-semibold");
    expect(unread.textContent).toContain("Unread");
    expect(unread.textContent).toContain("Today, 2:14 pm");
    const read = el.querySelector('tr[data-message-row="m2"]')!;
    expect(read.textContent).not.toContain("Unread");
    expect(read.textContent).toContain("10 Sep");
    expect(read.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-09-10T15:00:00Z",
    );
    click(read.querySelector("button[data-message-open]"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "m2" }));
    expect(button(el, "Load more")).toBeNull();
  });

  it("14-35 (P14-P40): a launch-review test message shows the neutral Test badge, still listed", () => {
    mounted = mount(
      <InboxTable
        rows={[row({ id: "m1", isTest: true }), row({ id: "m2" })]}
        timeZone={TZ}
        now={NOW}
        onOpen={vi.fn()}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    );
    const el = mounted.container;
    const test = el.querySelector('tr[data-message-row="m1"]')!;
    expect(test.textContent).toContain("Test");
    expect(test.textContent).toContain("Test message from your launch review");
    expect(test.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      "Test",
    );
    expect(test.innerHTML).toContain("bg-hub-surface-2");
    const plain = el.querySelector('tr[data-message-row="m2"]')!;
    expect(plain.textContent).not.toContain("launch review");
    const item = el.querySelector('li[data-message-item="m1"]')!;
    expect(item.textContent).toContain("Test message from your launch review");
  });

  it("deleted forms read '(deleted)'; an empty sender reads Unknown sender", () => {
    mounted = mount(
      <InboxTable
        rows={[row({ formDeleted: true, from: "" })]}
        timeZone={TZ}
        now={NOW}
        onOpen={vi.fn()}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    );
    const tr = mounted.container.querySelector("tr[data-message-row]")!;
    expect(tr.textContent).toContain("Contact (deleted)");
    expect(tr.textContent).toContain("Unknown sender");
  });

  it("stacked rows render for small screens", () => {
    mounted = mount(
      <InboxTable
        rows={[row()]}
        timeZone={TZ}
        now={NOW}
        onOpen={vi.fn()}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    );
    const li = mounted.container.querySelector("li[data-message-item]")!;
    expect(li.textContent).toContain("Maria Lopez");
    expect(li.textContent).toContain("Contact · Today, 2:14 pm");
  });

  it("hostile names and previews render as text", () => {
    mounted = mount(
      <InboxTable
        rows={[
          row({
            from: "<img src=x onerror=alert(1)>",
            preview: "<script>alert(1)</script>",
          }),
        ]}
        timeZone={TZ}
        now={NOW}
        onOpen={vi.fn()}
        hasMore={false}
        onLoadMore={vi.fn()}
      />,
    );
    expect(mounted.container.querySelector("img")).toBeNull();
    expect(mounted.container.querySelector("script")).toBeNull();
    expect(mounted.container.textContent).toContain(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("Load more shows while more exist and calls onLoadMore", () => {
    const onLoadMore = vi.fn();
    mounted = mount(
      <InboxTable
        rows={[row()]}
        timeZone={TZ}
        now={NOW}
        onOpen={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    const more = button(mounted.container, "Load more")!;
    expect(more.className).not.toContain("bg-hub-accent");
    click(more);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("5 skeleton rows while loading", () => {
    mounted = mount(
      <InboxTable
        rows={[]}
        timeZone={TZ}
        now={NOW}
        onOpen={vi.fn()}
        hasMore={false}
        onLoadMore={vi.fn()}
        loading
      />,
    );
    expect(
      mounted.container.querySelectorAll("[data-skeleton-row]"),
    ).toHaveLength(5);
  });
});

function drawer(over: Partial<MessageDrawerProps> = {}) {
  const props: MessageDrawerProps = {
    from: "Maria Lopez",
    detail: detail(),
    canWrite: true,
    timeZone: TZ,
    siteName: "Rivera Bakery",
    contactHref: "/hub/marketing?tab=contacts&contact=c1",
    onClose: vi.fn(),
    onNotSpam: vi.fn(async () => OK),
    onMarkUnread: vi.fn(async () => OK),
    onDelete: vi.fn(async () => OK),
    ...over,
  };
  mounted = mount(<MessageDrawer {...props} />);
  return props;
}

describe("MessageDrawer", () => {
  it("title, meta, answers (empty left out, line breaks kept), newsletter, View contact", () => {
    drawer();
    const dlg = document.querySelector("dialog")!;
    expect(dlg.getAttribute("aria-label")).toBe("Message from Maria Lopez");
    expect(dlg.querySelector("h2")?.textContent).toBe(
      "Message from Maria Lopez",
    );
    expect(dlg.querySelector("[data-message-meta]")?.textContent).toBe(
      "Contact form · On Home · 12 Sep, 2:14 pm",
    );
    const dts = Array.from(dlg.querySelectorAll("dl dt")).map(
      (d) => d.textContent,
    );
    expect(dts).toEqual(["Name", "Email", "Message"]);
    const msg = Array.from(dlg.querySelectorAll("dl dd"))[2]!;
    expect(msg.textContent).toBe("Line one\nLine two");
    expect(msg.className).toContain("whitespace-pre-line");
    expect(dlg.querySelector("[data-newsletter]")?.textContent).toBe(
      "Newsletter: Agreed",
    );
    const link = Array.from(dlg.querySelectorAll("a")).find(
      (a) => a.textContent === "View contact",
    );
    expect(link?.getAttribute("href")).toBe(
      "/hub/marketing?tab=contacts&contact=c1",
    );
  });

  it("14-35 (P14-P40): a test message shows the Test badge in the header", () => {
    drawer({ detail: detail({ isTest: true }) });
    const badge = document.querySelector("dialog [data-message-test]");
    expect(badge?.textContent).toBe("TestTest message from your launch review");
    mounted?.unmount();
    drawer();
    expect(document.querySelector("dialog [data-message-test]")).toBeNull();
  });

  it("10-38: each uploaded file shows name · size with a Download link to the hub route", () => {
    drawer({
      detail: detail({
        files: [
          {
            id: "file0000000001",
            label: "Your photo",
            name: "passport.pdf",
            size: 1024 * 1024,
            type: "application/pdf",
          },
        ],
      }),
    });
    const row = document.querySelector('[data-file="file0000000001"]')!;
    expect(row.querySelector("dt")?.textContent).toBe("Your photo");
    expect(row.querySelector("dd span")?.textContent).toBe(
      "passport.pdf · 1 MB",
    );
    const a = row.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/hub/api/forms/files/file0000000001");
    expect(a.hasAttribute("download")).toBe(true);
    expect(a.textContent).toBe("Download");
    expect(a.getAttribute("aria-label")).toBe("Download passport.pdf");
  });

  it("no files: no file rows", () => {
    drawer();
    expect(document.querySelector("[data-file]")).toBeNull();
  });

  it("Reply by email is the one primary, a mailto with the site subject", () => {
    drawer();
    const reply = document.querySelector<HTMLAnchorElement>("a[data-reply]")!;
    expect(reply.getAttribute("href")).toBe(
      "mailto:maria@example.com?subject=Re%3A%20your%20message%20to%20Rivera%20Bakery",
    );
    expect(reply.textContent).toBe("Reply by email");
    expect(reply.className).toContain("bg-hub-accent");
    const primaries = Array.from(
      document.querySelectorAll("dialog button, dialog a"),
    ).filter((b) => b.className.includes("bg-hub-accent"));
    expect(primaries).toHaveLength(1);
    expect(button(document.body, "Not spam")).toBeNull();
  });

  it("no valid email: no Reply; no newsletter tick: no line; no href: no View contact", () => {
    drawer({
      detail: detail({
        email: "bad\r\nBcc: x@evil.example",
        newsletter: false,
      }),
      contactHref: null,
    });
    expect(document.querySelector("a[data-reply]")).toBeNull();
    expect(document.querySelector("[data-newsletter]")).toBeNull();
    expect(
      Array.from(document.querySelectorAll("a")).some(
        (a) => a.textContent === "View contact",
      ),
    ).toBe(false);
  });

  it("a Filtered message shows Not spam instead of Reply; it calls onNotSpam", async () => {
    const p = drawer({ detail: detail({ spam: true }) });
    expect(document.querySelector("a[data-reply]")).toBeNull();
    const ns = button(document.body, "Not spam")!;
    expect(ns.className).not.toContain("bg-hub-accent");
    click(ns);
    await flush();
    expect(p.onNotSpam).toHaveBeenCalledTimes(1);
  });

  it("read-only: no Not spam and no Delete; Mark as unread stays", async () => {
    const p = drawer({ detail: detail({ spam: true }), canWrite: false });
    expect(button(document.body, "Not spam")).toBeNull();
    click(button(document.body, "More actions for message from Maria Lopez"));
    expect(button(document.body, "Delete message")).toBeNull();
    click(button(document.body, "Mark as unread"));
    await flush();
    expect(p.onMarkUnread).toHaveBeenCalledTimes(1);
  });

  it("Delete opens the danger dialog with Keep message focused; confirm calls onDelete", async () => {
    const p = drawer();
    click(button(document.body, "More actions for message from Maria Lopez"));
    click(button(document.body, "Delete message"));
    await flush();
    const dialogs = Array.from(document.querySelectorAll("dialog"));
    const confirm = dialogs.find((d) =>
      d.textContent?.includes("Delete this message from Maria Lopez?"),
    )!;
    expect(confirm.textContent).toContain(
      "It's removed from your Inbox for good. The contact stays in Contacts.",
    );
    expect(document.activeElement?.textContent).toBe("Keep message");
    const del = Array.from(confirm.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete message",
    )!;
    expect(del.className).toContain("danger");
    click(del);
    await flush();
    expect(p.onDelete).toHaveBeenCalledTimes(1);
  });

  it("a failed action shows its message", async () => {
    drawer({
      detail: detail({ spam: true }),
      onNotSpam: vi.fn(async () => ({
        ok: false as const,
        code: "forbidden",
        message: "You don't have access to that.",
      })),
    });
    click(button(document.body, "Not spam"));
    await flush();
    expect(document.body.textContent).toContain(
      "You don't have access to that.",
    );
  });

  it("skeleton body and no menu while the detail loads; opened from a link alone uses the email", () => {
    drawer({ detail: null, from: "" });
    expect(document.querySelectorAll("[data-skeleton-row]").length).toBe(4);
    expect(button(document.body, /More actions/)).toBeNull();
    expect(document.querySelector("dialog h2")?.textContent).toBe("Message");
    mounted?.unmount();
    document.body.innerHTML = "";
    drawer({ from: "" });
    expect(document.querySelector("dialog h2")?.textContent).toBe(
      "Message from maria@example.com",
    );
  });

  it("hostile answers render as text", () => {
    drawer({
      detail: detail({
        answers: [{ label: "<b>x</b>", value: "<img src=x onerror=alert(1)>" }],
      }),
    });
    expect(document.querySelector("dialog img")).toBeNull();
    expect(document.querySelector("dialog dl b")).toBeNull();
    expect(document.querySelector("dialog dd")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });
});
