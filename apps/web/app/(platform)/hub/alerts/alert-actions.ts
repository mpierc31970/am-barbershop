// What an Alerts row can do in place (A&M fork). Pure: the page joins each alert to the
// booking it was raised for (source key "booking:<id>") and gets the client's contact links
// and whether Approve / Decline apply.
import type { BookingView } from "@cds/db";

export type ContactLink = { kind: "email" | "call" | "text"; href: string };

export type AlertActions = {
  booking: BookingView | null;
  contact: ContactLink[];
  /** A pending request the viewer can approve or decline. */
  decide: boolean;
};

/** "+1 (512) 555-0100" -> "+15125550100"; "" when nothing dialable is left. */
export function dialable(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? digits : "";
}

export function contactLinks(email: string, phone: string): ContactLink[] {
  const out: ContactLink[] = [];
  if (email) out.push({ kind: "email", href: `mailto:${email}` });
  const tel = dialable(phone);
  if (tel) {
    out.push({ kind: "call", href: `tel:${tel}` });
    out.push({ kind: "text", href: `sms:${tel}` });
  }
  return out;
}

export function alertActions(
  sourceKey: string,
  bookings: ReadonlyMap<string, BookingView>,
): AlertActions {
  const id = sourceKey.startsWith("booking:") ? sourceKey.slice(8) : "";
  const booking = (id && bookings.get(id)) || null;
  if (!booking) return { booking: null, contact: [], decide: false };
  return {
    booking,
    contact: contactLinks(booking.clientEmail, booking.clientPhone),
    decide: booking.status === "requested",
  };
}
