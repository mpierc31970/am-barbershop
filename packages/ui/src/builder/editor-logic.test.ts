// Pure editor logic (03-08; CONT-05, CONT-06, CONT-07, CONT-10, CONT-12; D75-D77;
// 03-UI-SPEC "Accessibility contract", "ColumnsEditor" item 7; RESEARCH Pitfall 8).
import { describe, expect, it } from "vitest";
import {
  COLUMN_ITEM_KINDS,
  type ColumnItem,
  type ColumnsContent,
} from "@cds/core/content";
import {
  ADD_ITEM_GROUPS,
  ADD_ITEM_KINDS,
  KIND_LABELS,
  announce,
  applyLayoutChange,
  columnDropId,
  insertItemAt,
  itemFieldErrors,
  itemSummary,
  linesToList,
  listToLines,
  localInputToUtcIso,
  moveInList,
  planItemDrop,
  removeItemAt,
  replaceItemInColumns,
  shrinkNotice,
  utcIsoToLocalInput,
} from "./editor-logic";

const CHICAGO = "America/Chicago";

function newVideo(): ColumnItem & { kind: "video" } {
  return {
    id: "9",
    kind: "video",
    title: "",
    source: "media",
    asset: "",
    provider: "",
    provider_id: "",
    cover: "",
    shape: "16:9",
    controls: true,
    loop: false,
    autoplay: false,
  };
}

function newAudio(): ColumnItem & { kind: "audio" } {
  return {
    id: "10",
    kind: "audio",
    title: "",
    source: "media",
    asset: "",
    provider: "",
    provider_id: "",
  };
}

function content(...cols: string[][]): ColumnsContent {
  return {
    columns: cols.map((ids, i) => ({
      id: `c${i + 1}`,
      items: ids.map((id) => ({ id, kind: "divider" }) as ColumnItem),
    })),
  };
}

const itemIds = (c: ColumnsContent) =>
  c.columns.flatMap((col) => col.items.map((i) => i.id));

describe("announce (UI-SPEC dnd-kit announcements)", () => {
  it("pickUp", () => {
    expect(announce.pickUp("Hero block", 2, 5)).toBe(
      "Picked up Hero block. Position 2 of 5.",
    );
  });
  it("over", () => {
    expect(announce.over("Hero block", 3, 5)).toBe(
      "Hero block moved to position 3 of 5.",
    );
  });
  it("drop", () => {
    expect(announce.drop("Hero block", 3, 5)).toBe(
      "Hero block dropped at position 3 of 5.",
    );
  });
  it("cancel", () => {
    expect(announce.cancel("Hero block", 2)).toBe(
      "Move cancelled. Hero block is back at position 2.",
    );
  });
});

describe("shrinkNotice (CONT-07 copy)", () => {
  it("one surplus column", () => {
    expect(shrinkNotice(3, 2)).toBe(
      "Column 3's items moved to the end of column 2.",
    );
  });
  it("two surplus columns are named together", () => {
    expect(shrinkNotice(4, 2)).toBe(
      "Columns 3 and 4's items moved to the end of column 2.",
    );
  });
  it("three surplus columns use a list", () => {
    expect(shrinkNotice(5, 2)).toBe(
      "Columns 3, 4 and 5's items moved to the end of column 2.",
    );
  });
  it("growing or equal is null", () => {
    expect(shrinkNotice(2, 3)).toBeNull();
    expect(shrinkNotice(2, 2)).toBeNull();
  });
});

describe("applyLayoutChange (CONT-07, D77)", () => {
  it("3 columns -> 50-50 keeps every item and sets the notice", () => {
    const before = content(["a", "b"], ["c"], ["d", "e"]);
    const { content: after, notice } = applyLayoutChange(before, "50-50");
    expect(after.columns).toHaveLength(2);
    expect(itemIds(after).sort()).toEqual(itemIds(before).sort());
    expect(after.columns[1]!.items.map((i) => i.id)).toEqual(["c", "d", "e"]);
    expect(notice).toBe("Column 3's items moved to the end of column 2.");
  });
  it("keeps stored column ids and never mutates the input", () => {
    const before = content(["a"], ["b"], ["c"]);
    const snapshot = JSON.stringify(before);
    const { content: after } = applyLayoutChange(before, "50-50");
    expect(after.columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
  it("growing pads fresh columns and has no notice", () => {
    const { content: after, notice } = applyLayoutChange(
      content(["a"]),
      "33-33-33",
    );
    expect(after.columns).toHaveLength(3);
    expect(new Set(after.columns.map((c) => c.id)).size).toBe(3);
    expect(notice).toBeNull();
  });
  it("shrinking away only empty columns says nothing moved", () => {
    const { notice } = applyLayoutChange(content(["a"], ["b"], []), "50-50");
    expect(notice).toBeNull();
  });
});

describe("datetime-local <-> UTC ISO (Pitfall 8, T-03-31)", () => {
  it("Chicago summer (CDT, UTC-5)", () => {
    expect(localInputToUtcIso("2026-10-12T09:00", CHICAGO)).toBe(
      "2026-10-12T14:00:00.000Z",
    );
  });
  it("Chicago winter (CST, UTC-6)", () => {
    expect(localInputToUtcIso("2026-12-01T09:30", CHICAGO)).toBe(
      "2026-12-01T15:30:00.000Z",
    );
  });
  it("UTC input is unchanged", () => {
    expect(localInputToUtcIso("2026-10-12T09:00", "UTC")).toBe(
      "2026-10-12T09:00:00.000Z",
    );
  });
  it("round-trips through utcIsoToLocalInput", () => {
    for (const local of [
      "2026-10-12T09:00",
      "2026-03-08T12:15",
      "2026-11-01T23:45",
      "2027-01-01T00:00",
    ]) {
      expect(
        utcIsoToLocalInput(localInputToUtcIso(local, CHICAGO), CHICAGO),
      ).toBe(local);
    }
  });
  it("empty or invalid input gives an empty string", () => {
    expect(localInputToUtcIso("", CHICAGO)).toBe("");
    expect(localInputToUtcIso("not a date", CHICAGO)).toBe("");
    expect(utcIsoToLocalInput("", CHICAGO)).toBe("");
    expect(utcIsoToLocalInput("garbage", CHICAGO)).toBe("");
  });
  it("without a zone uses the runtime zone (the browser's)", () => {
    const iso = localInputToUtcIso("2026-10-12T09:00");
    expect(iso).toBe(new Date(2026, 9, 12, 9, 0).toISOString());
    expect(utcIsoToLocalInput(iso)).toBe("2026-10-12T09:00");
  });
});

describe("itemSummary (every item kind)", () => {
  const cases: [ColumnItem, string][] = [
    [
      { id: "1", kind: "heading", text: "Meet Dana", level: 2 },
      'Heading · "Meet Dana"',
    ],
    [
      { id: "2", kind: "text", html: "<p>Hello <strong>there</strong></p>" },
      'Text · "Hello there"',
    ],
    [{ id: "3", kind: "list", items: ["a", "b", "c"] }, "List · 3 items"],
    [
      { id: "4", kind: "image", url: "https://x.test/a.jpg", alt: "Dana" },
      'Image · "Dana"',
    ],
    [
      {
        id: "5",
        kind: "button",
        text: "Book now",
        link: "/book",
        style: "primary",
        action: "link",
        popup_id: "",
      },
      'Button · "Book now"',
    ],
    [{ id: "6", kind: "spacer", height: "md" }, "Spacer · Medium"],
    [{ id: "7", kind: "divider" }, "Divider"],
    [
      {
        id: "8",
        kind: "countdown",
        target_at: "2026-10-12T14:00:00.000Z",
        zero_message: "Open",
      },
      "Countdown · 12 Oct, 9:00 am",
    ],
    [{ ...newVideo(), title: "Studio tour" }, 'Video · "Studio tour"'],
    [{ ...newAudio(), title: "Episode 4" }, 'Audio · "Episode 4"'],
    [{ id: "11", kind: "form", form_id: "f1" }, "Form · Chosen"],
    [
      {
        id: "12",
        kind: "embed",
        title: "Book a consultation",
        provider: "calendly",
        provider_id: "acme",
      },
      'Booking calendar · "Book a consultation"',
    ],
  ];

  it("covers every kind", () => {
    expect(new Set(cases.map(([i]) => i.kind))).toEqual(
      new Set(COLUMN_ITEM_KINDS),
    );
  });

  it.each(cases)("%# summarises %s", (item, expected) => {
    expect(itemSummary(item, CHICAGO)).toBe(expected);
  });

  it("empty items say so", () => {
    expect(
      itemSummary({ id: "1", kind: "heading", text: "", level: 2 }, CHICAGO),
    ).toBe("Heading · Empty");
    expect(itemSummary({ id: "2", kind: "list", items: ["x"] }, CHICAGO)).toBe(
      "List · 1 item",
    );
    expect(
      itemSummary(
        { id: "3", kind: "countdown", target_at: "", zero_message: "" },
        CHICAGO,
      ),
    ).toBe("Countdown · No date yet");
  });

  it("long text is cut to 40 characters with an ellipsis", () => {
    const s = itemSummary(
      { id: "1", kind: "heading", text: "x".repeat(80), level: 2 },
      CHICAGO,
    );
    expect(s).toBe(`Heading · "${"x".repeat(40)}…"`);
  });
});

describe("list helpers (ItemListEditor, Undo delete)", () => {
  const items = ["a", "b", "c"].map(
    (id) => ({ id, kind: "divider" }) as ColumnItem,
  );
  const ids = (list: ColumnItem[]) => list.map((i) => i.id);

  it("moveInList moves and never mutates", () => {
    expect(ids(moveInList(items, 0, 2))).toEqual(["b", "c", "a"]);
    expect(ids(items)).toEqual(["a", "b", "c"]);
  });
  it("moveInList ignores out-of-range moves", () => {
    expect(moveInList(items, 0, -1)).toBe(items);
    expect(moveInList(items, 2, 3)).toBe(items);
  });
  it("removeItemAt then insertItemAt restores the list (Undo)", () => {
    const removed = removeItemAt(items, 1);
    expect(ids(removed)).toEqual(["a", "c"]);
    expect(ids(insertItemAt(removed, 1, items[1]!))).toEqual(["a", "b", "c"]);
  });
  it("insertItemAt clamps to the end", () => {
    const x = { id: "x", kind: "divider" } as ColumnItem;
    expect(ids(insertItemAt(items, 99, x))).toEqual(["a", "b", "c", "x"]);
  });
  it("replaceItemInColumns swaps one item by id", () => {
    const c = content(["a", "b"], ["c"]);
    const next = replaceItemInColumns(c, {
      id: "c",
      kind: "spacer",
      height: "lg",
    });
    expect(next.columns[1]!.items[0]).toEqual({
      id: "c",
      kind: "spacer",
      height: "lg",
    });
    expect(c.columns[1]!.items[0]!.kind).toBe("divider");
  });
  it("list items round-trip one per line, blanks dropped", () => {
    expect(linesToList("One\n\n  Two \r\nThree")).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(listToLines(["One", "Two"])).toBe("One\nTwo");
  });
});

describe("planItemDrop (items within and across stored columns)", () => {
  const c = content(["a", "b", "c"], ["d"], []);
  it("within a column", () => {
    expect(planItemDrop(c, "a", "c")).toEqual({
      fromColumnId: "c1",
      fromIndex: 0,
      toColumnId: "c1",
      toIndex: 2,
    });
  });
  it("across columns onto an item", () => {
    expect(planItemDrop(c, "b", "d")).toEqual({
      fromColumnId: "c1",
      fromIndex: 1,
      toColumnId: "c2",
      toIndex: 0,
    });
  });
  it("onto an empty column's drop area appends", () => {
    expect(planItemDrop(c, "a", columnDropId("c3"))).toEqual({
      fromColumnId: "c1",
      fromIndex: 0,
      toColumnId: "c3",
      toIndex: 0,
    });
  });
  it("no move for itself, unknown ids or no target", () => {
    expect(planItemDrop(c, "a", "a")).toBeNull();
    expect(planItemDrop(c, "zzz", "a")).toBeNull();
    expect(planItemDrop(c, "a", null)).toBeNull();
  });
});

describe("itemFieldErrors (instant field errors; the server re-validates)", () => {
  const opts = { allowPopupButton: true };
  it("image with a url needs alt text", () => {
    expect(
      itemFieldErrors(
        { id: "i", kind: "image", url: "https://x.test/a.jpg", alt: "" },
        opts,
      ),
    ).toEqual({
      alt: "Add a short description of the image for people who can't see it.",
    });
  });
  it("image url must be http(s)", () => {
    expect(
      itemFieldErrors(
        { id: "i", kind: "image", url: "javascript:x", alt: "a" },
        opts,
      ).url,
    ).toMatch(/https:\/\//);
  });
  it("countdown needs a date and a zero message", () => {
    const errors = itemFieldErrors(
      { id: "c", kind: "countdown", target_at: "", zero_message: "" },
      opts,
    );
    expect(errors.target_at).toBe(
      "Choose the date and time the countdown ends.",
    );
    expect(errors.zero_message).toBe(
      'Write what visitors see when the countdown ends, like "Doors are open."',
    );
  });
  it("pop-up button needs a pop-up; a link button needs a safe link", () => {
    const base = {
      id: "b",
      kind: "button" as const,
      text: "Go",
      link: "",
      style: "primary" as const,
      popup_id: "",
    };
    expect(itemFieldErrors({ ...base, action: "popup" }, opts).popup_id).toBe(
      "Choose which pop-up this button opens.",
    );
    expect(
      itemFieldErrors({ ...base, action: "link", link: "javascript:x" }, opts)
        .link,
    ).toMatch(/Links must start/);
    expect(
      itemFieldErrors(
        { ...base, action: "popup", popup_id: "p1" },
        { allowPopupButton: false },
      ).action,
    ).toBe("Buttons here can open links only, not pop-ups.");
  });
  it("a valid item has no errors", () => {
    expect(
      itemFieldErrors({ id: "h", kind: "heading", text: "Hi", level: 2 }, opts),
    ).toEqual({});
  });
});

describe("Add item menu groups (07-UI-SPEC Column item menu)", () => {
  it("has the four groups in order with their kinds", () => {
    expect(ADD_ITEM_GROUPS.map((g) => [g.label, [...g.kinds]])).toEqual([
      ["Text", ["heading", "text", "list"]],
      ["Photos and media", ["image", "video", "audio"]],
      ["Actions", ["button", "form", "embed"]],
      ["Other", ["countdown", "spacer", "divider"]],
    ]);
  });

  it("lists every kind exactly once, and ADD_ITEM_KINDS is the flattening", () => {
    const flat = ADD_ITEM_GROUPS.flatMap((g) => g.kinds);
    expect([...ADD_ITEM_KINDS]).toEqual(flat);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat)).toEqual(new Set(COLUMN_ITEM_KINDS));
  });

  it("labels the embed kind Booking calendar", () => {
    expect(KIND_LABELS.embed).toBe("Booking calendar");
    expect(KIND_LABELS.video).toBe("Video");
  });
});

describe("P7 item summaries and field errors (07-08)", () => {
  const opts = { allowPopupButton: true };

  it("untitled media items and unchosen forms say so", () => {
    expect(itemSummary(newVideo())).toBe("Video · No title yet");
    expect(itemSummary({ id: "f", kind: "form", form_id: "" })).toBe(
      "Form · No form yet",
    );
    expect(
      itemSummary({ id: "i", kind: "image", url: "", alt: "", asset: "a1" }),
    ).toBe("Image · Photo from your media");
  });

  it("video: title on title, missing source on link", () => {
    const e = itemFieldErrors(newVideo(), opts);
    expect(e.title).toBe(
      "Add a title. Screen readers and search engines use it.",
    );
    expect(e.link).toBe("Choose a video from your media, or paste a link.");
  });

  it("video: a stored bad provider id puts the refusal on link", () => {
    const e = itemFieldErrors(
      {
        ...newVideo(),
        title: "T",
        source: "link",
        provider: "youtube",
        provider_id: "bad",
      },
      opts,
    );
    expect(e.link).toMatch(/^We can't show videos from this site/);
    expect(e.form).toBeUndefined();
  });

  it("video with a valid link has no errors", () => {
    expect(
      itemFieldErrors(
        {
          ...newVideo(),
          title: "T",
          source: "link",
          provider: "youtube",
          provider_id: "dQw4w9WgXcQ",
        },
        opts,
      ),
    ).toEqual({});
  });

  it("audio, embed and form", () => {
    expect(itemFieldErrors(newAudio(), opts)).toEqual({
      title: "Add a title for this audio.",
      link: "Choose an MP3 from your media, or paste a link.",
    });
    expect(
      itemFieldErrors(
        { id: "e", kind: "embed", title: "", provider: "", provider_id: "" },
        opts,
      ),
    ).toEqual({
      title: 'Add a title, like "Book a consultation".',
      link: "Paste your Calendly or public Google Calendar link.",
    });
    expect(
      itemFieldErrors({ id: "f", kind: "form", form_id: "" }, opts),
    ).toEqual({
      form_id: "Choose a form. You can create one in Website › Forms.",
    });
  });

  it("image alt is required for a library asset too", () => {
    expect(
      itemFieldErrors(
        { id: "i", kind: "image", url: "", alt: "", asset: "a1" },
        opts,
      ).alt,
    ).toBe("Add a short description of the image for people who can't see it.");
  });

  it("07-17: a library photo with an empty address has no address error", () => {
    const errors = itemFieldErrors(
      { id: "i", kind: "image", url: "", alt: "Loaves", asset: "a1" },
      opts,
    );
    expect(errors.url).toBeUndefined();
    expect(errors).toEqual({});
  });

  it("07-17: a library photo's summary prefers its description", () => {
    expect(
      itemSummary({
        id: "i",
        kind: "image",
        url: "",
        alt: "Loaves",
        asset: "a1",
      }),
    ).toBe('Image · "Loaves"');
  });
});
