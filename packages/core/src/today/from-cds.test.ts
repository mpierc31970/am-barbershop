// 12-29 (COMM-02): the From CDS card's note kind outranks the platform announcement.
import { describe, expect, it } from "vitest";
import { FROM_CDS_NOTE_HREF, pickFromCds } from "./from-cds";

const now = new Date("2026-10-12T15:00:00Z");
const note = {
  id: "n1",
  title: "Your new booking page is live",
  text: "We moved the booking button to the top of the page.",
  created: "2026-10-11T10:00:00Z",
};
const announcement = {
  id: "a1",
  title: "Planned upgrade",
  text: "Faster pages next week.",
};

describe("pickFromCds note kind (12-29)", () => {
  it("a pinned note outranks the announcement", () => {
    const card = pickFromCds({ note, announcement, dismissed: [], now });
    expect(card).toEqual({
      kind: "note",
      id: "note:n1",
      title: note.title,
      text: note.text,
      link: { label: "Read the note", href: FROM_CDS_NOTE_HREF },
    });
    expect(FROM_CDS_NOTE_HREF).toBe("/hub/support?tab=messages");
  });

  it("a dismissed note falls back to the announcement", () => {
    const card = pickFromCds({
      note,
      announcement,
      dismissed: ["note:n1"],
      now,
    });
    expect(card?.kind).toBe("announcement");
    expect(card?.id).toBe("announcement:a1");
  });

  it("no note keeps the P11 order", () => {
    expect(
      pickFromCds({ note: null, announcement, dismissed: [], now })?.kind,
    ).toBe("announcement");
    expect(pickFromCds({ dismissed: [], now })).toBeNull();
  });

  it("a note outranks training and tips too", () => {
    const card = pickFromCds({
      note,
      recentAddonTraining: [
        {
          slug: "events",
          name: "Events",
          line: "Sign people up",
          installedAt: "2026-10-10T00:00:00Z",
        },
      ],
      tips: [
        {
          id: "t",
          title: "Tip",
          line: "Line",
          link: { label: "Go", href: "/hub" },
        },
      ],
      dismissed: [],
      now,
    });
    expect(card?.kind).toBe("note");
  });
});
