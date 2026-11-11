// 07-16 Task 1: contacts copy and view helpers (CONTACTS-01/02, D132; 07-UI-SPEC Contacts).
import { describe, expect, it } from "vitest";
import {
  ADD_HELPER,
  CONTACT_MATCH_TARGETS,
  DELETE_CONTACT_COPY,
  EMPTY_CONTACTS,
  IMPORT_NOTE,
  NEWSLETTER_FILTER_OPTIONS,
  SOURCE_FILTER_OPTIONS,
  SOURCE_LABELS,
  canUnsubscribe,
  consentLine,
  contactLabel,
  countLine,
  eventIcon,
  formatDay,
  formatWhen,
  importedToast,
  newsletterBadge,
  noteAuthor,
  tagChips,
} from "./copy";

const AT = "2026-09-12T19:14:00Z";
const TZ = "America/Chicago";

describe("newsletterBadge", () => {
  it("maps every stored status to its UI-SPEC word and tone", () => {
    expect(newsletterBadge("confirmed")).toEqual({
      label: "Subscribed",
      tone: "confirmed",
    });
    expect(newsletterBadge("unconfirmed")).toEqual({
      label: "Not confirmed",
      tone: "waiting",
    });
    expect(newsletterBadge("withdrawn")).toEqual({
      label: "Unsubscribed",
      tone: "draft",
    });
    expect(newsletterBadge("none")).toBeNull();
  });
});

describe("labels and filter options", () => {
  it("SOURCE_LABELS covers every chokepoint source", () => {
    expect(SOURCE_LABELS).toEqual({
      form: "Form",
      import: "Import",
      manual: "Added by you",
      booking: "Booking",
      subscribe: "Newsletter",
      registration: "Registration",
      purchase: "Purchase",
    });
  });

  it("the Source filter lists the v1.0 core sources only", () => {
    expect(SOURCE_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      "All sources",
      "Form",
      "Import",
      "Added by you",
    ]);
    expect(SOURCE_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      "",
      "form",
      "import",
      "manual",
    ]);
  });

  it("the Newsletter filter maps words to the chokepoint's consent values", () => {
    expect(NEWSLETTER_FILTER_OPTIONS).toEqual([
      { value: "", label: "Any" },
      { value: "subscribed", label: "Subscribed" },
      { value: "unconfirmed", label: "Not confirmed" },
      { value: "unsubscribed", label: "Unsubscribed" },
      { value: "none", label: "Not signed up" },
    ]);
  });

  it("match targets follow UI-SPEC order and end with Don't import", () => {
    expect(CONTACT_MATCH_TARGETS.map((t) => t.label)).toEqual([
      "Name",
      "First name",
      "Last name",
      "Email",
      "Phone",
      "Tags",
      "Don't import",
    ]);
    expect(CONTACT_MATCH_TARGETS.at(-1)?.value).toBe("skip");
  });

  it("copy is verbatim from the UI-SPEC", () => {
    expect(EMPTY_CONTACTS.heading).toBe("No contacts yet");
    expect(ADD_HELPER).toMatch(/they need to agree themselves/);
    expect(IMPORT_NOTE).toBe(
      "Importing adds new contacts and updates details. It never removes anyone and never changes newsletter choices.",
    );
    expect(DELETE_CONTACT_COPY.title("Maria Lopez")).toBe(
      "Delete Maria Lopez?",
    );
    expect(importedToast({ added: 12, updated: 30 })).toBe(
      "Imported. 12 added, 30 updated.",
    );
  });
});

describe("dates", () => {
  it("formatWhen shows day, short month and a 12-hour time in the time zone", () => {
    expect(formatWhen(AT, TZ)).toBe("12 Sep, 2:14 pm");
    expect(formatWhen("2026-01-03T06:05:00Z", "UTC")).toBe("3 Jan, 6:05 am");
    expect(formatWhen("2026-01-03T00:00:00Z", "UTC")).toBe("3 Jan, 12:00 am");
    expect(formatWhen("2026-01-03T12:30:00Z", "UTC")).toBe("3 Jan, 12:30 pm");
  });

  it("formatDay shows day, month and year", () => {
    expect(formatDay(AT, TZ)).toBe("12 Sep 2026");
  });

  it("a bad date gives empty text and a bad time zone falls back to UTC", () => {
    expect(formatWhen("not a date", TZ)).toBe("");
    expect(formatDay("", TZ)).toBe("");
    expect(formatWhen(AT, "Mars/Olympus")).toBe("12 Sep, 7:14 pm");
    expect(formatDay(AT, "")).toBe("12 Sep 2026");
  });
});

describe("consentLine", () => {
  const consent = {
    status: "unconfirmed" as const,
    at: AT,
    source: "form",
    wording: "Send me news…",
  };

  it("says a form on your site when no form name is passed", () => {
    expect(consentLine(consent, { formName: null, timeZone: TZ })).toBe(
      "Not confirmed · Agreed on a form on your site, 12 Sep, 2:14 pm: 'Send me news…'",
    );
  });

  it("names the form when given", () => {
    expect(consentLine(consent, { formName: "Contact", timeZone: TZ })).toBe(
      "Not confirmed · Agreed on the Contact form, 12 Sep, 2:14 pm: 'Send me news…'",
    );
  });

  it("confirmed, withdrawn and none", () => {
    expect(
      consentLine({ ...consent, status: "confirmed" }, { timeZone: TZ }),
    ).toMatch(/^Subscribed · Agreed on a form on your site, 12 Sep/);
    expect(consentLine({ status: "withdrawn", at: AT }, { timeZone: TZ })).toBe(
      "Unsubscribed · 12 Sep, 2:14 pm",
    );
    expect(consentLine({ status: "none" }, { timeZone: TZ })).toBe(
      "Not signed up",
    );
  });

  it("long wording is shortened", () => {
    const line = consentLine(
      { ...consent, wording: "x".repeat(400) },
      { timeZone: TZ },
    );
    expect(line.length).toBeLessThan(260);
    expect(line.endsWith("…'")).toBe(true);
  });
});

describe("small helpers", () => {
  it("canUnsubscribe only for agreed or confirmed", () => {
    expect(canUnsubscribe("unconfirmed")).toBe(true);
    expect(canUnsubscribe("confirmed")).toBe(true);
    expect(canUnsubscribe("withdrawn")).toBe(false);
    expect(canUnsubscribe("none")).toBe(false);
  });

  it("tagChips shows two and counts the rest", () => {
    expect(tagChips(["a", "b", "c", "d", "e"])).toEqual({
      shown: ["a", "b"],
      more: 3,
    });
    expect(tagChips(["a"])).toEqual({ shown: ["a"], more: 0 });
  });

  it("countLine", () => {
    expect(countLine(248)).toBe("248 contacts");
    expect(countLine(1)).toBe("1 contact");
    expect(countLine(1200)).toBe("1,200 contacts");
  });

  it("eventIcon by kind", () => {
    expect(eventIcon("form")).toBe("Mail");
    expect(eventIcon("import")).toBe("Upload");
    expect(eventIcon("manual")).toBe("UserPlus");
    expect(eventIcon("booking")).toBe("Circle");
  });

  it("contactLabel and noteAuthor", () => {
    expect(contactLabel({ name: "Maria", email: "m@x.co" })).toBe("Maria");
    expect(contactLabel({ name: " ", email: "m@x.co" })).toBe("m@x.co");
    expect(noteAuthor({ mine: true })).toBe("You");
    expect(noteAuthor({ mine: false })).toBe("A teammate");
  });
});
