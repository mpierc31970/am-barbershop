// @vitest-environment jsdom
// 12-11 Task 1 (COMM-02, COMM-04, D187, D-UI-P12-14; 12-UI-SPEC Messages notes lines 274-292,
// Documents 503-521): CDS note cards (pinned first, Earlier notes closed) and the document list
// whose download links are minted on click, never sitting in the markup (T-12-11-02).
import type { CdsDocument, CdsNote, ThreadFile } from "@cds/core/support";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../test-support/dom";
import { SUPPORT_UI_COPY } from "../copy";
import {
  CdsNoteCard,
  DOCS_COPY,
  DocumentList,
  EarlierNotes,
  filterThreadFiles,
  type DocumentListProps,
} from "./index";

const TZ = "America/Chicago";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function note(p: Partial<CdsNote> = {}): CdsNote {
  return {
    id: "n1",
    title: "Your launch checklist",
    body: "Line one\nSee https://example.com/guide for more.",
    pinned: true,
    authorName: "Mara",
    created: "2026-10-09T15:00:00Z",
    updated: "2026-10-09T15:00:00Z",
    ...p,
  };
}

function doc(p: Partial<CdsDocument> = {}): CdsDocument {
  return {
    id: "d1",
    title: "Brand guide",
    note: "Colours and fonts for your printer.",
    filename: "brand-guide.pdf",
    size: 1_258_291,
    mime: "application/pdf",
    authorName: "Mara",
    created: "2026-10-09T15:00:00Z",
    ...p,
  };
}

function file(p: Partial<ThreadFile> = {}): ThreadFile {
  return {
    id: "f1",
    name: "screenshot.png",
    size: 20_480,
    mime: "image/png",
    scan: "clean",
    threadId: "t1",
    ticketNumber: 1042,
    authorKind: "member",
    created: "2026-10-10T15:00:00Z",
    ...p,
  };
}

function list(p: Partial<DocumentListProps> = {}) {
  const props: DocumentListProps = {
    cdsDocs: [doc()],
    files: [
      file(),
      file({
        id: "f2",
        name: "invoice.pdf",
        mime: "application/pdf",
        authorKind: "staff",
        scan: "staff",
        ticketNumber: null,
      }),
    ],
    from: "all",
    onDownload: vi.fn(async () => "/hub/api/support/files/x"),
    onFilter: vi.fn(),
    timeZone: TZ,
    navigate: vi.fn(),
    ...p,
  };
  mounted = mount(<DocumentList {...props} />);
  return { props, c: mounted.container };
}

describe("CdsNoteCard", () => {
  it("renders a pinned note inside data-cds-identity with the Pinned marker", () => {
    mounted = mount(<CdsNoteCard note={note()} timeZone={TZ} />);
    const card = mounted.container.querySelector("[data-cds-identity]");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Pinned");
    expect(card!.textContent).toContain("Your launch checklist");
    expect(card!.textContent).toContain("From Support · 9 Oct");
    expect(card!.querySelector("[data-cds-mark]")).not.toBeNull();
    const a = card!.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/guide");
  });

  it("shows New when unread and no Pinned marker on a dated note", () => {
    mounted = mount(
      <CdsNoteCard note={note({ pinned: false })} unread timeZone={TZ} />,
    );
    const t = mounted.container.textContent ?? "";
    expect(t).toContain("New");
    expect(t).not.toContain("Pinned");
  });

  it("renders markup in a note as text, never HTML", () => {
    mounted = mount(
      <CdsNoteCard
        note={note({ title: "<b>x</b>", body: "<img src=x onerror=1>" })}
        timeZone={TZ}
      />,
    );
    expect(mounted.container.querySelector("img")).toBeNull();
    expect(mounted.container.querySelector("b")).toBeNull();
  });
});

describe("EarlierNotes", () => {
  it("is a details element closed by default with the count", () => {
    mounted = mount(
      <EarlierNotes
        notes={[
          note({ id: "a", pinned: false }),
          note({ id: "b", pinned: false }),
        ]}
        timeZone={TZ}
      />,
    );
    const d = mounted.container.querySelector("details");
    expect(d).not.toBeNull();
    expect(d!.open).toBe(false);
    expect(d!.querySelector("summary")!.textContent).toBe("Earlier notes (2)");
    expect(d!.querySelectorAll("[data-cds-identity]").length).toBe(2);
  });

  it("renders nothing without notes", () => {
    mounted = mount(<EarlierNotes notes={[]} timeZone={TZ} />);
    expect(mounted.container.innerHTML).toBe("");
  });
});

describe("DocumentList", () => {
  it("wraps Shared by Support in data-cds-identity and has no signed link in the markup", () => {
    const { c } = list();
    const shared = c.querySelector("[data-cds-identity]");
    expect(shared?.textContent).toContain(DOCS_COPY.sharedHeading);
    expect(c.innerHTML).not.toContain("sig=");
    for (const a of Array.from(c.querySelectorAll("a"))) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/api\/support\/files/);
    }
  });

  it("names the Support document download with title, type and size", () => {
    const { c } = list();
    expect(button(c, "Download Brand guide, PDF, 1.2 MB")).not.toBeNull();
  });

  it("calls onDownload(id) on click, then navigates to the minted path", async () => {
    const { c, props } = list();
    click(button(c, "Download Brand guide, PDF, 1.2 MB"));
    await flush();
    expect(props.onDownload).toHaveBeenCalledWith("d1");
    expect(props.navigate).toHaveBeenCalledWith("/hub/api/support/files/x");
  });

  it("a thrown link request shows an error alert and keeps focus (12-REVIEW IN-D01)", async () => {
    let fail!: (e: Error) => void;
    const onDownload = vi.fn(
      () => new Promise<string | null>((_, rej) => (fail = rej)),
    );
    const { c } = list({ onDownload });
    const b = button(c, "Download Brand guide, PDF, 1.2 MB")!;
    b.focus();
    click(b);
    await flush();
    const row = c.querySelector('[data-doc="d1"]')!;
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(b.disabled).toBe(false);
    fail(new Error("network"));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toMatch(
      /download didn't start/,
    );
    expect(row.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it("downloads a thread file by id", async () => {
    const { c, props } = list();
    click(button(c, "Download screenshot.png"));
    await flush();
    expect(props.onDownload).toHaveBeenCalledWith("f1");
  });

  it("a checking file shows the badge and an aria-disabled download with the reason", async () => {
    const { c, props } = list({ files: [file({ scan: "pending" })] });
    const row = c.querySelector('[data-file="f1"]')!;
    expect(row.textContent).toContain("Checking file");
    const b = button(row, "Download screenshot.png")!;
    expect(b.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(
      b.getAttribute("aria-describedby") ?? "",
    );
    expect(reason?.textContent).toMatch(/still being checked/);
    click(b);
    await flush();
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  it("links a file to its ticket or to Messages", () => {
    const { c } = list();
    const links = Array.from(c.querySelectorAll("a")).map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(links).toContainEqual(["#1042", "/hub/support/tickets/1042"]);
    expect(links).toContainEqual(["In Messages", "/hub/support?tab=messages"]);
  });

  it("filters From Support / From you and calls onFilter", () => {
    const { c, props } = list();
    const you = c.querySelector('[role="radio"][data-value="you"]')!;
    click(you);
    expect(props.onFilter).toHaveBeenCalledWith("you");
    expect(filterThreadFiles(props.files, "cds").map((f) => f.id)).toEqual([
      "f2",
    ]);
    expect(filterThreadFiles(props.files, "you").map((f) => f.id)).toEqual([
      "f1",
    ]);
  });

  it("From you with none shows the empty copy", () => {
    const { c } = list({
      from: "you",
      files: [file({ authorKind: "staff", scan: "staff" })],
    });
    expect(c.textContent).toContain("No files from you yet.");
  });

  it("empty everything shows DOCS-EMPTY and the no-files copy", () => {
    const { c } = list({ cdsDocs: [], files: [] });
    expect(c.textContent).toContain(SUPPORT_UI_COPY.DOCS_EMPTY);
    expect(c.textContent).toContain(
      "No files in your tickets or messages yet.",
    );
  });

  it("shows 50 rows, then Show more", () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      file({ id: `m${i}`, name: `f${i}.txt`, mime: "text/plain" }),
    );
    const { c } = list({ files: many });
    expect(c.querySelectorAll("[data-file]").length).toBe(50);
    click(button(c, "Show more"));
    expect(c.querySelectorAll("[data-file]").length).toBe(55);
  });
});
