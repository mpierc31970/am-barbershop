// @vitest-environment jsdom
// 12-09 Task 1 (COMM-01, COMM-05, COMM-08; 12-UI-SPEC "Thread anatomy" lines 301-333,
// a11y 828-850): the thread renders as a safe, ordered record. Message bodies are text nodes
// only (T-12-09-01); CDS identity comes from authorKind alone (T-12-09-02).
import type { TenantAttachment, TenantMessage } from "@cds/core/support";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, flush, mount, type Mounted } from "../../../test-support/dom";
import {
  AttachmentList,
  Thread,
  autolinkTokens,
  clockTime,
  dayLabel,
  screenshotName,
  THREAD_COPY,
  ThreadMessage,
} from "./index";
import { P13_COPY } from "@cds/core/staff";

const TZ = "America/Chicago";
// 2026-10-12 14:14 in Chicago (CDT, UTC-5).
const NOW = Date.parse("2026-10-12T19:14:00Z");

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function msg(p: Partial<TenantMessage> & { id: string }): TenantMessage {
  return {
    authorKind: "member",
    authorName: "Maria",
    body: "",
    event: null,
    attachments: [],
    created: "2026-10-12T19:14:00Z",
    ...p,
  };
}

function att(p: Partial<TenantAttachment> & { id: string }): TenantAttachment {
  return {
    name: "invoice.pdf",
    size: 1_258_291,
    mime: "application/pdf",
    scan: "clean",
    ...p,
  };
}

describe("autolinkTokens", () => {
  it("links http(s) URLs and keeps everything else as text", () => {
    expect(autolinkTokens("see https://x.test/a?b=1, ok")).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "url",
        text: "https://x.test/a?b=1",
        href: "https://x.test/a?b=1",
      },
      { kind: "text", text: ", ok" },
    ]);
  });

  it("never links javascript: or data: and trims trailing punctuation", () => {
    expect(autolinkTokens("javascript:alert(1)")).toEqual([
      { kind: "text", text: "javascript:alert(1)" },
    ]);
    expect(autolinkTokens("data:text/html,<b>x</b>")).toEqual([
      { kind: "text", text: "data:text/html,<b>x</b>" },
    ]);
    expect(autolinkTokens("(http://a.test/x).")).toEqual([
      { kind: "text", text: "(" },
      { kind: "url", text: "http://a.test/x", href: "http://a.test/x" },
      { kind: "text", text: ")." },
    ]);
  });

  it("keeps balanced parentheses inside a URL", () => {
    const t = autolinkTokens("https://en.test/wiki/A_(b)");
    expect(t).toEqual([
      {
        kind: "url",
        text: "https://en.test/wiki/A_(b)",
        href: "https://en.test/wiki/A_(b)",
      },
    ]);
  });
});

describe("thread time helpers", () => {
  it("clock time in business time", () => {
    expect(clockTime("2026-10-12T19:14:00Z", TZ)).toBe("2:14 pm");
    expect(clockTime("2026-10-12 05:03:00.000Z", TZ)).toBe("12:03 am");
    expect(clockTime("nope", TZ)).toBe("");
  });

  it("day labels: Today, Yesterday, then 'Thu 9 Oct'", () => {
    expect(dayLabel("2026-10-12T19:14:00Z", TZ, NOW)).toBe("Today");
    expect(dayLabel("2026-10-11T19:14:00Z", TZ, NOW)).toBe("Yesterday");
    expect(dayLabel("2026-10-09T19:14:00Z", TZ, NOW)).toBe("Fri 9 Oct");
    expect(dayLabel("2025-10-09T19:14:00Z", TZ, NOW)).toBe("Thu 9 Oct 2025");
    // 03:00Z on the 12th is still the 11th in Chicago.
    expect(dayLabel("2026-10-12T03:00:00Z", TZ, NOW)).toBe("Yesterday");
  });

  it("pasted screenshots are named by business time", () => {
    expect(screenshotName(new Date(NOW), TZ)).toBe(
      "Screenshot 12 Oct, 2:14 pm.png",
    );
  });
});

describe("Thread", () => {
  it("is an ol; each message an article labelled by its author line", () => {
    mounted = mount(
      <Thread
        messages={[
          msg({ id: "a", authorKind: "member", body: "Hi" }),
          msg({
            id: "b",
            authorKind: "staff",
            authorName: "Mara",
            body: "Hello",
          }),
        ]}
        timeZone={TZ}
        now={NOW}
        onDownload={() => {}}
      />,
    );
    const ol = mounted.container.querySelector("ol")!;
    expect(ol).not.toBeNull();
    const articles = Array.from(ol.querySelectorAll("li > article"));
    expect(articles).toHaveLength(2);
    for (const a of articles) {
      const id = a.getAttribute("aria-labelledby")!;
      expect(id).toBeTruthy();
      expect(document.getElementById(id)).not.toBeNull();
    }
    const cdsLabel = document.getElementById(
      articles[1]!.getAttribute("aria-labelledby")!,
    )!;
    expect(cdsLabel.textContent).toContain("Mara from CDS");
    expect(cdsLabel.textContent).toContain("2:14 pm");
  });

  it("a staff message sits in [data-cds-identity]; a member message does not", () => {
    mounted = mount(
      <Thread
        messages={[
          msg({
            id: "a",
            authorKind: "member",
            authorName: "Maria",
            body: "Hi",
          }),
          msg({
            id: "b",
            authorKind: "staff",
            authorName: "Mara",
            body: "Hello",
          }),
        ]}
        timeZone={TZ}
        now={NOW}
        onDownload={() => {}}
      />,
    );
    const [mine, cds] = Array.from(
      mounted.container.querySelectorAll("article"),
    );
    expect(mine!.closest("[data-cds-identity]")).toBeNull();
    expect(mine!.querySelector("[data-cds-mark]")).toBeNull();
    expect(cds!.closest("[data-cds-identity]")).not.toBeNull();
    expect(cds!.textContent).toContain("Mara from CDS");
  });

  it("a member named like CDS is still plain (identity from authorKind only)", () => {
    mounted = mount(
      <Thread
        messages={[
          msg({ id: "a", authorKind: "member", authorName: "Mara · CDS" }),
        ]}
        timeZone={TZ}
        now={NOW}
        onDownload={() => {}}
      />,
    );
    expect(mounted.container.querySelector("[data-cds-identity]")).toBeNull();
  });

  it("shows 'You' for the viewer's own messages", () => {
    mounted = mount(
      <Thread
        messages={[msg({ id: "a", authorName: "Maria", body: "Hi" })]}
        timeZone={TZ}
        now={NOW}
        isOwn={(m) => m.authorName === "Maria"}
        onDownload={() => {}}
      />,
    );
    expect(mounted.container.querySelector("article")!.textContent).toContain(
      "You",
    );
  });

  it("renders bodies as text: links for URLs, literal markup, kept line breaks", () => {
    mounted = mount(
      <Thread
        messages={[
          msg({
            id: "a",
            body: "see https://x.test <b>hi</b>\njavascript:alert(1)",
          }),
        ]}
        timeZone={TZ}
        now={NOW}
        onDownload={() => {}}
      />,
    );
    const article = mounted.container.querySelector("article")!;
    expect(article.querySelector("b")).toBeNull();
    expect(article.textContent).toContain("<b>hi</b>");
    const links = Array.from(article.querySelectorAll("a"));
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("https://x.test");
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(links[0]!.textContent).toContain(THREAD_COPY.newTab);
    const body = article.querySelector("[data-message-body]")!;
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(body.textContent).toContain("\njavascript:alert(1)");
  });

  it("system lines sit between messages with their event text and time", () => {
    mounted = mount(
      <Thread
        messages={[
          msg({ id: "a", body: "Hi" }),
          msg({
            id: "s",
            authorKind: "system",
            authorName: "CDS",
            event: "Reopened by your reply",
          }),
        ]}
        timeZone={TZ}
        now={NOW}
        onDownload={() => {}}
      />,
    );
    const line = mounted.container.querySelector("[data-system-line]")!;
    expect(line.textContent).toContain("Reopened by your reply");
    expect(line.textContent).toContain("2:14 pm");
    expect(line.querySelector("article")).toBeNull();
  });

  it("adds day separators as h3 and one unread divider above the first unread", () => {
    mounted = mount(
      <Thread
        messages={[
          msg({ id: "a", body: "old", created: "2026-10-09T15:00:00Z" }),
          msg({
            id: "b",
            authorKind: "staff",
            authorName: "Mara",
            body: "one",
            created: "2026-10-11T15:00:00Z",
          }),
          msg({
            id: "c",
            authorKind: "staff",
            authorName: "Mara",
            body: "two",
            created: "2026-10-12T15:00:00Z",
          }),
        ]}
        lastReadAt="2026-10-10T00:00:00Z"
        timeZone={TZ}
        now={NOW}
        onDownload={() => {}}
      />,
    );
    const h3s = Array.from(mounted.container.querySelectorAll("h3")).map(
      (h) => h.textContent,
    );
    expect(h3s).toEqual(["Fri 9 Oct", "Yesterday", "Today"]);
    const dividers = mounted.container.querySelectorAll(
      "[data-unread-divider]",
    );
    expect(dividers).toHaveLength(1);
    expect(dividers[0]!.textContent).toContain(THREAD_COPY.unread);
    // The divider comes right before message b.
    const items = Array.from(mounted.container.querySelectorAll("ol > li"));
    const idx = items.indexOf(dividers[0]!.closest("li")!);
    expect(items[idx + 1]!.textContent).toContain("one");
  });

  it("no unread divider when the person wrote the unread lines themselves", () => {
    mounted = mount(
      <Thread
        messages={[
          msg({ id: "a", body: "mine", created: "2026-10-12T15:00:00Z" }),
        ]}
        lastReadAt="2026-10-10T00:00:00Z"
        timeZone={TZ}
        now={NOW}
        onDownload={() => {}}
      />,
    );
    expect(mounted.container.querySelector("[data-unread-divider]")).toBeNull();
  });

  it("scrolls to the divider on first render only, never when a poll adds one (WR-D03)", () => {
    const spy = vi.fn();
    const proto = HTMLElement.prototype as unknown as {
      scrollIntoView?: unknown;
    };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = spy;
    try {
      const first = [
        msg({ id: "a", body: "mine", created: "2026-10-09T15:00:00Z" }),
      ];
      const props = {
        lastReadAt: "2026-10-10T00:00:00Z",
        timeZone: TZ,
        now: NOW,
        onDownload: () => {},
      };
      mounted = mount(<Thread messages={first} {...props} />);
      expect(spy).not.toHaveBeenCalled();
      const polled = [
        ...first,
        msg({
          id: "b",
          authorKind: "staff",
          authorName: "Mara",
          body: "new",
          created: "2026-10-12T15:00:00Z",
        }),
      ];
      act(() => mounted!.root.render(<Thread messages={polled} {...props} />));
      expect(
        mounted.container.querySelector("[data-unread-divider]"),
      ).not.toBeNull();
      expect(spy).not.toHaveBeenCalled();

      // With unread lines at mount, it does scroll once.
      mounted.unmount();
      mounted = mount(<Thread messages={polled} {...props} />);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      proto.scrollIntoView = had;
    }
  });

  it("Show earlier messages calls onLoadEarlier", () => {
    const onLoadEarlier = vi.fn();
    mounted = mount(
      <Thread
        messages={[msg({ id: "a", body: "x" })]}
        timeZone={TZ}
        now={NOW}
        hasEarlier
        onLoadEarlier={onLoadEarlier}
        onDownload={() => {}}
      />,
    );
    const btn = Array.from(mounted.container.querySelectorAll("button")).find(
      (b) => b.textContent === "Show earlier messages",
    );
    click(btn);
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });
});

describe("AttachmentList", () => {
  it("a clean file is a chip with a working Download", () => {
    const onDownload = vi.fn();
    mounted = mount(
      <AttachmentList
        attachments={[att({ id: "f1" })]}
        onDownload={onDownload}
      />,
    );
    expect(mounted.container.textContent).toContain("invoice.pdf");
    expect(mounted.container.textContent).toContain("1.2 MB");
    const dl = mounted.container.querySelector(
      'button[aria-label="Download invoice.pdf"]',
    );
    click(dl);
    expect(onDownload).toHaveBeenCalledWith("f1");
  });

  it("a thrown download shows an error alert (12-REVIEW IN-D01)", async () => {
    const onDownload = vi.fn(async () => {
      throw new Error("network");
    });
    mounted = mount(
      <AttachmentList
        attachments={[att({ id: "f1" })]}
        onDownload={onDownload}
      />,
    );
    click(
      mounted.container.querySelector(
        'button[aria-label="Download invoice.pdf"]',
      ),
    );
    await flush();
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toBe(
      THREAD_COPY.downloadFailed,
    );
  });

  it("a pending file shows Checking file and an aria-disabled download with the reason", () => {
    const onDownload = vi.fn();
    mounted = mount(
      <AttachmentList
        attachments={[att({ id: "f2", scan: "pending" })]}
        onDownload={onDownload}
      />,
    );
    expect(mounted.container.textContent).toContain(THREAD_COPY.checking);
    const dl = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Download invoice.pdf"]',
    )!;
    expect(dl.getAttribute("aria-disabled")).toBe("true");
    const reasonId = dl.getAttribute("aria-describedby")!;
    expect(document.getElementById(reasonId)!.textContent).toBe(
      THREAD_COPY.checkingReason,
    );
    click(dl);
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("a staff file needs no scan", () => {
    mounted = mount(
      <AttachmentList
        attachments={[att({ id: "f3", scan: "staff" })]}
        onDownload={() => {}}
      />,
    );
    expect(mounted.container.textContent).not.toContain(THREAD_COPY.checking);
  });

  it("clean images with a preview source render as 64px thumbnail buttons", () => {
    mounted = mount(
      <AttachmentList
        attachments={[
          att({ id: "i1", name: "screenshot.png", mime: "image/png" }),
          att({
            id: "i2",
            name: "pending.png",
            mime: "image/png",
            scan: "pending",
          }),
        ]}
        previewSrc={(a) => `/preview/${a.id}`}
        onDownload={() => {}}
      />,
    );
    const thumb = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open screenshot.png"]',
    )!;
    expect(thumb).not.toBeNull();
    expect(thumb.querySelector("img")!.getAttribute("src")).toBe("/preview/i1");
    // The checking image gets no thumbnail.
    expect(
      mounted.container.querySelector('button[aria-label="Open pending.png"]'),
    ).toBeNull();
  });
});

// 13-35 choice 1 (STAFF-08, D-UI-P13-8): the staff-only internal note surface. The default
// variants stay exactly as P12 shipped them.
describe("ThreadMessage variant", () => {
  it("internal renders the hatched dashed surface with 'Only CDS sees this.'", () => {
    mounted = mount(
      <ThreadMessage
        message={msg({
          id: "n1",
          authorKind: "staff",
          authorName: "Mara",
          body: "Owner asked twice; check the form handler.",
        })}
        timeZone={TZ}
        onDownload={() => {}}
        variant="internal"
      />,
    );
    const article = mounted.container.querySelector("article")!;
    expect(article.hasAttribute("data-internal")).toBe(true);
    expect(article.className).toContain("border-dashed");
    expect(article.className).toContain("border-hub-warning");
    expect(article.className).toContain("forced-colors:bg-none");
    expect(article.textContent).toContain("Internal note");
    expect(article.textContent).toContain(P13_COPY.INTERNAL_LINE);
    expect(article.textContent).toContain("Mara");
    expect(article.textContent).toContain("2:14 pm");
    // Never the CDS public surface.
    expect(article.hasAttribute("data-cds-identity")).toBe(false);
  });

  it("default variants are unchanged (no internal marks)", () => {
    mounted = mount(
      <>
        <ThreadMessage
          message={msg({ id: "s1", authorKind: "staff", authorName: "Mara" })}
          timeZone={TZ}
          onDownload={() => {}}
        />
        <ThreadMessage
          message={msg({ id: "m1", body: "Hi" })}
          timeZone={TZ}
          onDownload={() => {}}
        />
      </>,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).not.toContain(P13_COPY.INTERNAL_LINE);
    expect(text).not.toContain("Internal note");
    expect(mounted.container.querySelector("[data-internal]")).toBeNull();
    expect(
      mounted.container.querySelector('[data-author-kind="staff"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('[data-author-kind="member"]')!.className,
    ).not.toContain("border-dashed");
  });
});
