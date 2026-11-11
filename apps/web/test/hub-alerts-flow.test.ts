// A&M web app flow: Alerts is the first screen, each booking alert acts in place, and the
// profile menu lists only the person's own items.
import type { BookingView } from "@cds/db";
import { describe, expect, it } from "vitest";
import {
  alertActions,
  contactLinks,
  dialable,
} from "../app/(platform)/hub/alerts/alert-actions";
import {
  ALERTS_NAV,
  CORE_SEGMENTS,
  profileMenuLinks,
} from "../app/(platform)/hub/nav";
import { HUB_START_URL } from "../lib/hub-pwa";

const SEAT = "abcdefghijklmno";

function booking(over: Partial<BookingView> = {}): BookingView {
  return {
    id: "bkbkbkbkbkbkbkb",
    reference: "AM-ABC123",
    seatId: SEAT,
    barber: "Ana",
    service: "Cut",
    durationMinutes: 30,
    priceCents: 3000,
    startsAt: "2030-01-08T16:00:00.000Z",
    date: "2030-01-08",
    time: "10:00",
    clientName: "Client One",
    clientEmail: "one@example.com",
    clientPhone: "(512) 555-0100",
    note: "",
    status: "requested",
    ...over,
  };
}

describe("Alerts first", () => {
  it("is the sidebar item, the PWA start and a reserved hub segment", () => {
    expect(ALERTS_NAV.href).toBe("/hub/alerts");
    expect(HUB_START_URL).toBe("/hub/alerts");
    expect(CORE_SEGMENTS.has("alerts")).toBe(true);
  });
});

describe("alertActions", () => {
  const b = booking();
  const map = new Map([[b.id, b]]);

  it("a booking request: Approve / Decline plus Email, Call, Text", () => {
    const a = alertActions(`booking:${b.id}`, map);
    expect(a.booking?.id).toBe(b.id);
    expect(a.decide).toBe(true);
    expect(a.contact).toEqual([
      { kind: "email", href: "mailto:one@example.com" },
      { kind: "call", href: "tel:5125550100" },
      { kind: "text", href: "sms:5125550100" },
    ]);
  });

  it("an approved booking keeps the contact links, no decision", () => {
    const done = booking({ status: "confirmed" });
    const a = alertActions(`booking:${done.id}`, new Map([[done.id, done]]));
    expect(a.decide).toBe(false);
    expect(a.contact).toHaveLength(3);
  });

  it("anything else (or a booking this person can't see) has no actions", () => {
    expect(alertActions("form:abc", map)).toEqual({
      booking: null,
      contact: [],
      decide: false,
    });
    expect(alertActions("booking:zzzzzzzzzzzzzzz", map).booking).toBeNull();
  });

  it("no phone: email only; junk phone is not dialable", () => {
    expect(contactLinks("a@b.co", "")).toEqual([
      { kind: "email", href: "mailto:a@b.co" },
    ]);
    expect(dialable("call me")).toBe("");
    expect(dialable("+1 512-555-0100")).toBe("+15125550100");
  });
});

describe("profileMenuLinks", () => {
  it("a chair renter: only their own items, Rent included", () => {
    expect(profileMenuLinks(SEAT, "renter").map((l) => l.label)).toEqual([
      "My page",
      "My Social",
      "Services & Pricing",
      "Hours",
      "My bookings",
      "My Rent",
      "Alerts",
    ]);
    const hrefs = profileMenuLinks(SEAT, "renter").map((l) => l.href);
    expect(hrefs).toContain(`/hub/studio-booking/seats/${SEAT}#hours`);
    expect(hrefs).toContain(`/hub/studio-booking/bookings?seat=${SEAT}`);
  });

  it("the owner with their own seat: their own items, no shop-wide Rent", () => {
    const labels = profileMenuLinks(SEAT, "owner").map((l) => l.label);
    expect(labels).not.toContain("My Rent");
    expect(labels).toContain("My page");
    for (const l of profileMenuLinks(SEAT, "owner")) {
      expect(
        l.href.startsWith("/hub/studio-booking/seats/") ||
          l.href.includes(`seat=${SEAT}`) ||
          l.href === "/hub/alerts",
      ).toBe(true);
    }
  });

  it("no seat: just Alerts", () => {
    expect(profileMenuLinks(null, "admin")).toEqual([
      { href: "/hub/alerts", label: "Alerts" },
    ]);
  });
});
