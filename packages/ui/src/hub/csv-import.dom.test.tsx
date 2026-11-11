// @vitest-environment jsdom
// Shared CSV import dialog, file drop and backups drawer (05-06; ADDON-12, ADDON-13,
// ADDON-14, D126; 05-UI-SPEC "CSV import", "Backups", "Copywriting Contract").
import type { ImportMode, ImportPreview } from "@cds/core/csv";
import { MAX_IMPORT_BYTES } from "@cds/core/csv";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";
import type { BackupView, HubActionResult } from "./addon-types";
import { BackupsPanel, formatBackupDate } from "./BackupsPanel";
import {
  CsvImportDialog,
  IMPORT_FAILED_COPY,
  NOTHING_TO_DO_COPY,
  WINDOW_THRESHOLD,
} from "./CsvImportDialog";
import { FILE_TOO_BIG_COPY, FileDrop } from "./FileDrop";
import { ToastRegion } from "./Toast";

beforeAll(() => {
  // jsdom has <dialog> but not the modal API; open/close by attribute is enough here.
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

const COLUMNS = [
  { key: "quote", label: "Quote" },
  { key: "author_name", label: "Name" },
  { key: "rating", label: "Rating" },
];

function row(
  rowNumber: number,
  status: ImportPreview["rows"][number]["status"],
  messages: string[] = [],
  changed: string[] = [],
): ImportPreview["rows"][number] {
  return {
    rowNumber,
    status,
    cells: {
      quote: `Quote number ${rowNumber} that is long enough to be cut off in the table`,
      author_name: `Person ${rowNumber}`,
      rating: "5",
    },
    changed,
    messages,
  };
}

function preview(over: Partial<ImportPreview> = {}): ImportPreview {
  return {
    counts: { new: 1, updated: 1, unchanged: 1, duplicates: 0, errors: 0 },
    mode: "update",
    ignored: [],
    columns: COLUMNS,
    rows: [
      row(2, "new"),
      row(3, "updated", [], ["rating"]),
      row(4, "unchanged"),
    ],
    removals: [],
    changes: 2,
    ...over,
  };
}

const CSV = "Quote,Name,Rating\nA,B,5\nC,D,4\nE,F,3\n";

async function dropFile(root: ParentNode, text = CSV, size?: number) {
  const input = root.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], "testimonials.csv", { type: "text/csv" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(input, "files", {
    value: [file],
    configurable: true,
  });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

type PreviewFn = (
  text: string,
  mode: ImportMode,
) => Promise<HubActionResult<ImportPreview>>;

function dialog(
  onPreview: PreviewFn,
  onCommit = vi.fn(async () => ({
    ok: true as const,
    data: { added: 1, updated: 1, removed: 0, backupId: "bk1" },
  })),
) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  mounted = mount(
    <CsvImportDialog
      open
      onClose={onClose}
      title="Import testimonials"
      singular="testimonial"
      plural="testimonials"
      onPreview={onPreview}
      onCommit={onCommit}
      onTemplate={() => {}}
      onDone={onDone}
    />,
  );
  return { el: mounted.container, onDone, onClose, onCommit };
}

describe("CsvImportDialog", () => {
  it("step 1 shows the drop zone, template link and step text", () => {
    const { el } = dialog(async () => ({ ok: true, data: preview() }));
    expect(el.textContent).toContain("Step 1 of 3 · Choose a file");
    expect(el.textContent).toContain("Drop a CSV file here, or choose a file");
    const input = el.querySelector('input[type="file"]')!;
    expect(input.getAttribute("accept")).toBe(".csv,text/csv");
    expect(input.closest("label")).not.toBeNull();
    expect(button(el, "Download the template")).not.toBeNull();
    expect(el.textContent).toContain(
      "Editing a list you exported? Keep the id column so rows match.",
    );
    expect(el.querySelector("dialog")!.className).toContain("max-w-[960px]");
  });

  it("row errors disable Import, sort first and show the fix copy", async () => {
    const onPreview = vi.fn<PreviewFn>(async () => ({
      ok: true,
      data: preview({
        counts: { new: 1, updated: 0, unchanged: 0, duplicates: 0, errors: 2 },
        rows: [
          row(2, "new"),
          row(4, "error", ["Row 4: Rating must be a number from 1 to 5."]),
          row(9, "error", ["Row 9: Quote is empty. Add the testimonial text."]),
        ],
        ignored: ["Notes"],
        changes: 1,
      }),
    }));
    const { el } = dialog(onPreview);
    await dropFile(el);
    expect(onPreview).toHaveBeenCalledWith(CSV, "update");
    expect(el.textContent).toContain("Step 2 of 3 · Check");
    expect(el.textContent).toContain(
      "2 rows need fixing. Nothing is imported until every row is fixed. Fix them in your file and upload it again.",
    );
    expect(el.textContent).toContain(
      "We ignored 1 column we don't use: Notes.",
    );
    const importBtn = button(el, "Import 1 change")!;
    expect(importBtn.disabled).toBe(true);
    expect(importBtn.getAttribute("title")).toBe(
      "Fix the 2 rows with errors first",
    );
    const order = Array.from(el.querySelectorAll("tr[data-row]")).map((r) =>
      r.getAttribute("data-row"),
    );
    expect(order).toEqual(["4", "9", "2"]);
    const errRow = el.querySelector('tr[data-row="4"]')!;
    const msgId = errRow.getAttribute("aria-describedby")!;
    expect(document.getElementById(msgId)?.textContent).toBe(
      "Row 4: Rating must be a number from 1 to 5.",
    );
    expect(el.querySelector("caption")?.textContent).toBe("Rows in your file");
    // Cells are cut at 40 characters with the full text in title.
    const cell = errRow.querySelectorAll("td")[2]!;
    expect(cell.textContent!.length).toBeLessThanOrEqual(40);
    expect(cell.getAttribute("title")).toContain("cut off in the table");
  });

  it("count filters are aria-pressed toggles over the table", async () => {
    const { el } = dialog(async () => ({ ok: true, data: preview() }));
    await dropFile(el);
    expect(el.textContent).toContain(
      "1 new·1 updated·1 unchanged·0 duplicates removed·0 errors",
    );
    const updated = button(el, "1 updated")!;
    expect(updated.getAttribute("aria-pressed")).toBe("false");
    click(updated);
    expect(updated.getAttribute("aria-pressed")).toBe("true");
    expect(el.querySelectorAll("tr[data-row]")).toHaveLength(1);
    // Changed cells are weight 600.
    const changedCell = el
      .querySelector('tr[data-row="3"]')!
      .querySelectorAll("td")[4]!;
    expect(changedCell.className).toContain("font-semibold");
    click(button(el, "All"));
    expect(el.querySelectorAll("tr[data-row]")).toHaveLength(3);
  });

  it("Replace all shows the removal count and routes through the second confirm", async () => {
    const removals = Array.from({ length: 23 }, (_, i) => ({
      id: `r${i}`,
      title: `Person ${i} · 'Old words'`,
    }));
    const onPreview = vi.fn<PreviewFn>(async (_t, mode) => ({
      ok: true,
      data:
        mode === "replace"
          ? preview({ mode, removals, changes: 25 })
          : preview(),
    }));
    const onCommit = vi.fn(async () => ({
      ok: true as const,
      data: { added: 1, updated: 1, removed: 23, backupId: "bk2" },
    }));
    const { el, onDone, onClose } = dialog(onPreview, onCommit);
    await dropFile(el);
    const replace = el.querySelector(
      'input[type="radio"][value="replace"]',
    ) as HTMLInputElement;
    click(replace);
    await flush();
    expect(onPreview).toHaveBeenLastCalledWith(CSV, "replace");
    expect(el.textContent).toContain(
      "Your list becomes exactly this file. 23 testimonials not in the file will be removed.",
    );
    click(button(el, "Replace all…"));
    expect(el.querySelector("h2")?.textContent).toBe("Remove 23 testimonials?");
    const listed = el.querySelectorAll("[data-removals] li");
    expect(listed).toHaveLength(20);
    expect(listed[0]!.textContent).toBe("Person 0 · 'Old words'");
    expect(el.textContent).toContain("and 3 more");
    expect(el.textContent).toContain(
      "A backup of your current list is saved first, so you can undo this from Backups.",
    );
    const goBack = button(el, "Go back")!;
    expect(document.activeElement).toBe(goBack);
    expect(onCommit).not.toHaveBeenCalled();
    click(button(el, "Replace all and remove 23"));
    await flush();
    // The confirmed removal set goes with the commit (D126, A-WR-03).
    expect(onCommit).toHaveBeenCalledWith(
      CSV,
      "replace",
      removals.map((r) => r.id),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({
      added: 1,
      updated: 1,
      removed: 23,
      backupId: "bk2",
    });
  });

  it("zero changes disables Import and says the file already matches", async () => {
    const { el } = dialog(async () => ({
      ok: true,
      data: preview({
        counts: { new: 0, updated: 0, unchanged: 3, duplicates: 0, errors: 0 },
        rows: [row(2, "unchanged"), row(3, "unchanged"), row(4, "unchanged")],
        changes: 0,
      }),
    }));
    await dropFile(el);
    expect(button(el, "Import 0 changes")!.disabled).toBe(true);
    expect(el.textContent).toContain(NOTHING_TO_DO_COPY);
  });

  it("a failed import stays on Check with the didn't-finish copy", async () => {
    const onCommit = vi.fn(async () => ({
      ok: false as const,
      code: "save_failed",
      message: "Your changes weren't saved.",
    }));
    const { el, onDone, onClose } = dialog(
      async () => ({ ok: true, data: preview() }),
      onCommit as never,
    );
    await dropFile(el);
    click(button(el, "Import 2 changes"));
    await flush();
    expect(onCommit).toHaveBeenCalledWith(CSV, "update");
    expect(el.textContent).toContain(IMPORT_FAILED_COPY);
    expect(el.textContent).toContain("Step 2 of 3 · Check");
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a commit refused with invalid_input shows the server's copy (C-WR-04)", async () => {
    const STALE =
      "Your list changed since you checked the file. Check it again before you replace all.";
    const onCommit = vi.fn(async () => ({
      ok: false as const,
      code: "invalid_input",
      message: STALE,
    }));
    const { el, onDone } = dialog(
      async () => ({ ok: true, data: preview() }),
      onCommit as never,
    );
    await dropFile(el);
    click(button(el, "Import 2 changes"));
    await flush();
    expect(el.textContent).toContain(STALE);
    expect(el.textContent).not.toContain(IMPORT_FAILED_COPY);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a file-level error shows in place and keeps the drop zone", async () => {
    const { el } = dialog(async () => ({
      ok: false,
      code: "invalid_input",
      message:
        "This file has no rows. Add rows under the header, then upload it again.",
    }));
    await dropFile(el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      "This file has no rows.",
    );
    expect(el.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("windows the table above 200 rows", async () => {
    const many = Array.from({ length: WINDOW_THRESHOLD + 300 }, (_, i) =>
      row(i + 2, "new"),
    );
    const { el } = dialog(async () => ({
      ok: true,
      data: preview({
        rows: many,
        counts: {
          new: many.length,
          updated: 0,
          unchanged: 0,
          duplicates: 0,
          errors: 0,
        },
        changes: many.length,
      }),
    }));
    await dropFile(el);
    const rendered = el.querySelectorAll("tr[data-row]").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
  });
});

describe("FileDrop", () => {
  it("refuses a file over maxBytes before reading it", async () => {
    const onText = vi.fn();
    const onError = vi.fn();
    mounted = mount(
      <FileDrop
        onText={onText}
        onError={onError}
        maxBytes={MAX_IMPORT_BYTES}
      />,
    );
    await dropFile(mounted.container, CSV, MAX_IMPORT_BYTES + 1);
    expect(onError).toHaveBeenCalledWith(FILE_TOO_BIG_COPY);
    expect(FILE_TOO_BIG_COPY).toBe(
      "This file is too big. Import up to 2,000 rows at a time.",
    );
    expect(onText).not.toHaveBeenCalled();
  });

  it("the import dialog shows the too-big copy for an oversized file", async () => {
    const onPreview = vi.fn<PreviewFn>();
    const { el } = dialog(onPreview);
    await dropFile(el, CSV, MAX_IMPORT_BYTES + 10);
    expect(el.textContent).toContain(FILE_TOO_BIG_COPY);
    expect(onPreview).not.toHaveBeenCalled();
  });
});

describe("BackupsPanel", () => {
  const backups: BackupView[] = [
    {
      id: "b1",
      reason: "before-import",
      createdAt: "2026-09-27T14:14:00Z",
      count: 17,
    },
    { id: "b2", reason: "manual", createdAt: "2026-09-24T09:05:00Z", count: 1 },
    {
      id: "b3",
      reason: "before-restore",
      createdAt: "2026-09-20T18:30:00Z",
      count: 12,
    },
  ];

  function panel(
    restore = vi.fn(async () => ({ ok: true as const, data: null })),
  ) {
    const save = vi.fn(async () => ({
      ok: true as const,
      data: backups[0]!,
    }));
    const onRestored = vi.fn();
    mounted = mount(
      <ToastRegion>
        <BackupsPanel
          open
          onClose={() => {}}
          plural="testimonials"
          singular="testimonial"
          list={async () => ({ ok: true, data: backups })}
          save={save}
          restore={restore}
          onRestored={onRestored}
          timeZone="UTC"
        />
      </ToastRegion>,
    );
    return { el: mounted.container, save, restore, onRestored };
  }

  it("formats dates as '27 Sep, 2:14 pm'", () => {
    expect(formatBackupDate("2026-09-27T14:14:00Z", "UTC")).toBe(
      "27 Sep, 2:14 pm",
    );
    expect(formatBackupDate("2026-09-20T00:05:00Z", "UTC")).toBe(
      "20 Sep, 12:05 am",
    );
  });

  it("lists 3 backups with Restore and offers Save a backup now", async () => {
    const { el, save } = panel();
    await flush();
    expect(el.textContent).toContain(
      "A backup is saved before every import. We keep your last 3; older ones are removed automatically.",
    );
    const rows = el.querySelectorAll("[data-backup]");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Before import");
    expect(rows[0]!.textContent).toContain("27 Sep, 2:14 pm · 17 testimonials");
    expect(rows[1]!.textContent).toContain("Saved by you");
    expect(rows[1]!.textContent).toContain("1 testimonial");
    expect(rows[2]!.textContent).toContain("Before restore");
    expect(button(el, "Restore backup from 27 Sep, 2:14 pm")).not.toBeNull();
    expect(el.textContent).toContain(
      "Saving a new one removes the backup from 20 Sep.",
    );
    click(button(el, "Save a backup now"));
    await flush();
    expect(save).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Backup saved.");
  });

  it("Restore asks first with the safe choice focused, then restores", async () => {
    const { el, restore, onRestored } = panel();
    await flush();
    click(button(el, "Restore backup from 27 Sep, 2:14 pm"));
    expect(el.textContent).toContain(
      "Restore the backup from 27 Sep, 2:14 pm?",
    );
    expect(el.textContent).toContain(
      "Your testimonials go back to how they were then (17 testimonials). Your current list is backed up first.",
    );
    expect(document.activeElement).toBe(button(el, "Keep current list"));
    click(button(el, "Restore backup"));
    await flush();
    expect(restore).toHaveBeenCalledWith("b1");
    expect(onRestored).toHaveBeenCalledWith(backups[0]);
    expect(document.body.textContent).toContain(
      "Restored. Your list matches the backup from 27 Sep, 2:14 pm.",
    );
  });

  it("shows the empty copy when there are no backups", async () => {
    mounted = mount(
      <ToastRegion>
        <BackupsPanel
          open
          onClose={() => {}}
          plural="testimonials"
          list={async () => ({ ok: true, data: [] })}
          save={async () => ({ ok: true, data: backups[0]! })}
          restore={async () => ({ ok: true, data: null })}
          onRestored={() => {}}
        />
      </ToastRegion>,
    );
    await flush();
    expect(mounted.container.textContent).toContain(
      "No backups yet. One is saved automatically before your first import.",
    );
    expect(button(mounted.container, "Save a backup now")).not.toBeNull();
  });
});

describe("additive + column match (07-16)", () => {
  const HEADER = {
    header: ["E-mail Address", "Full name"],
    examples: ["maria@example.com", "Maria Lopez"],
    suggested: ["email", "name"],
    needsMatch: true,
  };
  const TARGETS = [
    { value: "name", label: "Name" },
    { value: "email", label: "Email" },
    { value: "skip", label: "Don't import" },
  ];
  const NOTE =
    "Importing adds new contacts and updates details. It never removes anyone and never changes newsletter choices.";
  type Extras = { mapping?: string[]; tagAll?: string };
  type OptPreview = (
    text: string,
    mode: ImportMode,
    extras?: Extras,
  ) => Promise<HubActionResult<ImportPreview & { merged?: number }>>;

  function contactsPreview(over: Partial<ImportPreview> = {}) {
    return {
      ...preview({
        counts: { new: 2, updated: 1, unchanged: 0, duplicates: 0, errors: 0 },
        changes: 3,
        ...over,
      }),
      merged: 2,
    };
  }

  function contactsDialog(
    readHeader: (
      text: string,
    ) => Promise<HubActionResult<typeof HEADER>> = vi.fn(async () => ({
      ok: true as const,
      data: HEADER,
    })),
    onPreview = vi.fn<OptPreview>(async () => ({
      ok: true,
      data: contactsPreview(),
    })),
  ) {
    const onCommit = vi.fn(async () => ({
      ok: true as const,
      data: { added: 2, updated: 1, removed: 0, backupId: "" },
    }));
    const onDone = vi.fn();
    mounted = mount(
      <CsvImportDialog
        open
        onClose={() => {}}
        title="Import contacts"
        singular="contact"
        plural="contacts"
        chooseHint="Exports from Mailchimp, Square or Google Contacts work too."
        columnMatch={{
          readHeader,
          targets: TARGETS,
          skipValue: "skip",
          requiredValue: "email",
          requiredCopy: "Match a column to Email. Every contact needs one.",
        }}
        additive={{
          note: NOTE,
          tagAll: {
            label: "Tag everyone in this file",
            placeholder: "like 'Spring fair 2026'",
            maxLength: 40,
          },
        }}
        onPreview={onPreview}
        onCommit={onCommit}
        onTemplate={() => {}}
        onDone={onDone}
      />,
    );
    return {
      el: mounted.container,
      readHeader,
      onPreview,
      onCommit,
      onDone,
    };
  }

  it("step 1 reads 'of 4' and shows the choose hint, not the id-column line", () => {
    const { el } = contactsDialog();
    expect(el.textContent).toContain("Step 1 of 4 · Choose a file");
    expect(el.textContent).toContain(
      "Exports from Mailchimp, Square or Google Contacts work too.",
    );
    expect(el.textContent).not.toContain("Keep the id column");
  });

  it("an unknown header shows Match columns; Next previews with the mapping", async () => {
    const { el, readHeader, onPreview } = contactsDialog();
    await dropFile(el);
    expect(readHeader).toHaveBeenCalledWith(CSV);
    expect(onPreview).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Step 2 of 4 · Match columns");
    click(button(el, "Next: check rows"));
    await flush();
    expect(onPreview).toHaveBeenCalledWith(CSV, "update", {
      mapping: ["email", "name"],
    });
    expect(el.textContent).toContain("Step 3 of 4 · Check");
  });

  it("a known header skips the match step and previews with the suggestion", async () => {
    const readHeader = vi.fn(async () => ({
      ok: true as const,
      data: { ...HEADER, needsMatch: false },
    }));
    const { el, onPreview } = contactsDialog(readHeader);
    await dropFile(el);
    expect(el.textContent).not.toContain("Match columns");
    expect(onPreview).toHaveBeenCalledWith(CSV, "update", {
      mapping: ["email", "name"],
    });
    expect(el.textContent).toContain("Step 3 of 4 · Check");
  });

  it("check: no mode radios, the note, the merged count and Import 3 contacts", async () => {
    const { el } = contactsDialog(
      vi.fn(async () => ({
        ok: true as const,
        data: { ...HEADER, needsMatch: false },
      })),
    );
    await dropFile(el);
    expect(el.textContent).not.toContain("How to import");
    expect(el.querySelector('input[type="radio"]')).toBeNull();
    expect(el.textContent).toContain(NOTE);
    expect(el.querySelector("[data-merged]")?.textContent).toBe(
      "2 merged by email",
    );
    expect(button(el, "Import 3 contacts")).not.toBeNull();
    expect(button(el, "Change column matches")).not.toBeNull();
  });

  it("Tag everyone re-runs the preview on blur only when it changed; commit sends the extras", async () => {
    const { el, onPreview, onCommit, onDone } = contactsDialog(
      vi.fn(async () => ({
        ok: true as const,
        data: { ...HEADER, needsMatch: false },
      })),
    );
    await dropFile(el);
    const input = el.querySelector<HTMLInputElement>(
      "input[placeholder=\"like 'Spring fair 2026'\"]",
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input, "Spring fair 2026");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await flush();
    expect(onPreview).toHaveBeenLastCalledWith(CSV, "update", {
      mapping: ["email", "name"],
      tagAll: "Spring fair 2026",
    });
    const calls = onPreview.mock.calls.length;
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await flush();
    expect(onPreview.mock.calls.length).toBe(calls);
    click(button(el, "Import 3 contacts"));
    await flush();
    expect(onCommit).toHaveBeenCalledWith(CSV, "update", undefined, {
      mapping: ["email", "name"],
      tagAll: "Spring fair 2026",
    });
    expect(onDone).toHaveBeenCalledWith({
      added: 2,
      updated: 1,
      removed: 0,
      backupId: "",
    });
  });

  it("Change column matches returns to the match step with the chosen mapping", async () => {
    const { el } = contactsDialog();
    await dropFile(el);
    const sel = el.querySelectorAll("select")[1] as HTMLSelectElement;
    act(() => {
      sel.value = "skip";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button(el, "Next: check rows"));
    await flush();
    click(button(el, "Change column matches"));
    expect(el.textContent).toContain("Step 2 of 4 · Match columns");
    expect(
      Array.from(el.querySelectorAll("select")).map((s) => s.value),
    ).toEqual(["email", "skip"]);
  });

  it("a header read that arrives after Choose another file is ignored", async () => {
    let resolve!: (v: HubActionResult<typeof HEADER>) => void;
    const readHeader = vi.fn(
      () =>
        new Promise<HubActionResult<typeof HEADER>>((r) => {
          resolve = r;
        }),
    );
    const { el } = contactsDialog(readHeader);
    await dropFile(el);
    expect(el.textContent).toContain("Checking");
    // Closing resets the dialog (a new seq); the late answer must not reopen a step.
    act(() => {
      el.querySelector("dialog")!.dispatchEvent(new Event("cancel"));
    });
    await act(async () => {
      resolve({ ok: true, data: HEADER });
    });
    await flush();
    expect(el.textContent).not.toContain("Match columns");
  });
});

describe("replace only (07-21)", () => {
  const TABLE_PREVIEW: ImportPreview = {
    counts: { new: 3, updated: 0, unchanged: 0, duplicates: 0, errors: 0 },
    mode: "replace",
    ignored: [],
    columns: [
      { key: "c0", label: "Plan" },
      { key: "c1", label: "Price" },
    ],
    rows: [2, 3, 4].map((n) => ({
      rowNumber: n,
      status: "new" as const,
      cells: { c0: `Plan ${n}`, c1: "$20" },
      changed: [],
      messages: [],
    })),
    removals: [],
    changes: 4,
  };

  function tableDialog() {
    const onPreview = vi.fn<PreviewFn>(async () => ({
      ok: true,
      data: TABLE_PREVIEW,
    }));
    const onCommit = vi.fn(async () => ({
      ok: true as const,
      data: { added: 4, updated: 0, removed: 0, backupId: "" },
    }));
    const onDone = vi.fn();
    mounted = mount(
      <CsvImportDialog
        open
        onClose={() => {}}
        title="Import a table"
        singular="row"
        plural="rows"
        onPreview={onPreview}
        onCommit={onCommit}
        onTemplate={() => {}}
        onDone={onDone}
        replaceOnly={{
          summary: () => "4 rows, 2 columns",
          primaryLabel: "Replace table…",
          confirmTitle: "Replace this table?",
          confirmBody: () =>
            "Your table becomes exactly this file: 4 rows, 2 columns.",
          confirmLabel: "Replace table",
          note: "Bold, italic and links aren't kept in CSV files.",
        }}
      />,
    );
    return { el: mounted.container, onPreview, onCommit, onDone };
  }

  it("step 1 has no template link and no id-column line", () => {
    const { el } = tableDialog();
    expect(button(el, "Download the template")).toBeNull();
    expect(el.textContent).not.toContain("Keep the id column");
  });

  it("check shows the summary and note, no radios, filters or status column", async () => {
    const { el, onPreview } = tableDialog();
    await dropFile(el);
    expect(onPreview).toHaveBeenCalledWith(CSV, "replace");
    expect(el.textContent).toContain("4 rows, 2 columns");
    expect(el.textContent).toContain("Bold, italic and links aren't kept");
    expect(el.textContent).not.toContain("How to import");
    expect(el.querySelector('[aria-label="Show rows"]')).toBeNull();
    expect(el.textContent).not.toContain("Status");
    expect(button(el, "Replace table…")).not.toBeNull();
  });

  it("the primary opens the table confirm with Go back focused; confirm commits", async () => {
    const { el, onCommit, onDone } = tableDialog();
    await dropFile(el);
    click(button(el, "Replace table…"));
    expect(el.querySelector("h2")?.textContent).toBe("Replace this table?");
    expect(el.textContent).toContain(
      "Your table becomes exactly this file: 4 rows, 2 columns.",
    );
    expect(el.querySelector("[data-removals]")).toBeNull();
    expect(el.textContent).not.toContain("Backups");
    expect(document.activeElement?.textContent).toBe("Go back");
    click(button(el, "Replace table"));
    await flush();
    expect(onCommit).toHaveBeenCalledWith(CSV, "replace", []);
    expect(onDone).toHaveBeenCalled();
  });
});
