// 07-19 Task 3: Inbox copy and view helpers (CONT-25; 07-UI-SPEC "Inbox", copy table;
// T-07-19-07 mailto injection).
import { describe, expect, it } from "vitest";
import {
  DELETE_MESSAGE_COPY,
  EMPTY_INBOX,
  INBOX_EXPORT_HINT,
  INBOX_FILTERED_EMPTY,
  INBOX_SEARCH_PLACEHOLDER,
  INBOX_TOASTS,
  contactHref,
  drawerMeta,
  drawerTitle,
  filteredTabLabel,
  formLabel,
  mailtoHref,
  receivedLabel,
  senderLabel,
} from "./copy";

const TZ = "America/Chicago";

describe("Inbox copy (07-UI-SPEC)", () => {
  it("EMPTY-INBOX, Filtered empty, export hint and search placeholder are verbatim", () => {
    expect(EMPTY_INBOX).toEqual({
      heading: "No messages yet",
      body: "When someone sends a form on your site, it lands here and we email you a copy.",
      link: "Go to Forms",
    });
    expect(INBOX_FILTERED_EMPTY).toBe(
      "Nothing filtered. Messages that look like spam land here, so you can check them.",
    );
    expect(INBOX_EXPORT_HINT).toBe("Choose a form to export its messages.");
    expect(INBOX_SEARCH_PLACEHOLDER).toBe("Search messages");
  });

  it("Delete message dialog copy", () => {
    expect(DELETE_MESSAGE_COPY.title("Maria Lopez")).toBe(
      "Delete this message from Maria Lopez?",
    );
    expect(DELETE_MESSAGE_COPY.title("  ")).toBe("Delete this message?");
    expect(DELETE_MESSAGE_COPY.body).toBe(
      "It's removed from your Inbox for good. The contact stays in Contacts.",
    );
    expect(DELETE_MESSAGE_COPY.confirm).toBe("Delete message");
    expect(DELETE_MESSAGE_COPY.keep).toBe("Keep message");
  });

  it("toasts (choice 11)", () => {
    expect(INBOX_TOASTS).toEqual({
      deleted: "Message deleted.",
      notSpam: "Moved to Messages.",
      unread: "Marked as unread.",
    });
  });

  it("filteredTabLabel", () => {
    expect(filteredTabLabel(0)).toBe("Filtered");
    expect(filteredTabLabel(3)).toBe("Filtered · 3");
    expect(filteredTabLabel(-1)).toBe("Filtered");
    expect(filteredTabLabel(Number.NaN)).toBe("Filtered");
  });

  it("senderLabel falls back to Unknown sender", () => {
    expect(senderLabel("Maria Lopez")).toBe("Maria Lopez");
    expect(senderLabel("")).toBe("Unknown sender");
    expect(senderLabel(null)).toBe("Unknown sender");
  });
});

describe("receivedLabel", () => {
  const now = new Date("2026-09-12T22:00:00Z"); // 5 pm in Chicago

  it("today in the business's time zone reads Today, h:mm am/pm", () => {
    expect(receivedLabel("2026-09-12T19:14:00Z", TZ, now)).toBe(
      "Today, 2:14 pm",
    );
  });

  it("another day this year reads 12 Sep; an earlier year adds the year", () => {
    expect(receivedLabel("2026-09-11T19:14:00Z", TZ, now)).toBe("11 Sep");
    expect(receivedLabel("2025-09-12T19:14:00Z", TZ, now)).toBe("12 Sep 2025");
  });

  it("the day boundary follows the time zone, not UTC", () => {
    // 03:00 UTC on the 13th is still the 12th in Chicago.
    expect(
      receivedLabel(
        "2026-09-13T03:00:00Z",
        TZ,
        new Date("2026-09-13T04:00:00Z"),
      ),
    ).toBe("Today, 10:00 pm");
  });

  it("bad input never throws", () => {
    expect(receivedLabel("nope", TZ, now)).toBe("");
    expect(receivedLabel("", TZ, now)).toBe("");
    expect(receivedLabel("2026-09-12T19:14:00Z", "Not/AZone", now)).not.toBe(
      "",
    );
    expect(receivedLabel("2026-09-12T19:14:00Z", TZ, new Date("x"))).toBe(
      "12 Sep 2026",
    );
  });
});

describe("form labels, drawer title and meta", () => {
  it("formLabel marks deleted forms", () => {
    expect(formLabel("Contact", false)).toBe("Contact");
    expect(formLabel("Contact", true)).toBe("Contact (deleted)");
    expect(formLabel("", false)).toBe("Form");
  });

  it("drawerTitle", () => {
    expect(drawerTitle("Maria Lopez")).toBe("Message from Maria Lopez");
    expect(drawerTitle("")).toBe("Message");
    expect(drawerTitle(undefined)).toBe("Message");
  });

  it("drawerMeta: form · page · date; page left out when null", () => {
    const base = {
      formName: "Contact",
      formDeleted: false,
      pageTitle: "Home",
      created: "2026-09-12T19:14:00Z",
    };
    expect(drawerMeta(base, TZ)).toBe(
      "Contact form · On Home · 12 Sep, 2:14 pm",
    );
    expect(drawerMeta({ ...base, pageTitle: null }, TZ)).toBe(
      "Contact form · 12 Sep, 2:14 pm",
    );
    expect(drawerMeta({ ...base, formDeleted: true }, TZ)).toBe(
      "Contact form (deleted) · On Home · 12 Sep, 2:14 pm",
    );
    expect(drawerMeta({ ...base, formName: "Booking form" }, TZ)).toBe(
      "Booking form · On Home · 12 Sep, 2:14 pm",
    );
  });

  it("contactHref is the 07-16 drawer route", () => {
    expect(contactHref("abc123")).toBe(
      "/hub/marketing?tab=contacts&contact=abc123",
    );
  });
});

describe("mailtoHref (T-07-19-07)", () => {
  it("builds the reply link with an encoded subject", () => {
    expect(mailtoHref("maria@example.com", "Rivera Bakery")).toBe(
      "mailto:maria@example.com?subject=Re%3A%20your%20message%20to%20Rivera%20Bakery",
    );
  });

  it("encodes a hostile site name into the subject only", () => {
    const href = mailtoHref("maria@example.com", "A&B?cc=x@evil.example")!;
    expect(href.startsWith("mailto:maria@example.com?subject=")).toBe(true);
    expect(href.split("?")).toHaveLength(2);
    expect(href).not.toContain("&");
  });

  it("refuses anything that is not one plain address", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "not-an-email",
      "maria@example.com\r\nBcc: x@evil.example",
      "maria@example.com,x@evil.example",
      "maria@example.com?cc=x@evil.example",
      "maria@example.com&body=hi",
      " maria@example.com",
      "maria@example.com%0d%0a",
    ]) {
      expect(mailtoHref(bad, "Rivera Bakery"), String(bad)).toBeNull();
    }
  });
});
