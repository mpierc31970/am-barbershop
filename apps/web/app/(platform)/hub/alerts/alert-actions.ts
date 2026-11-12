// What an Alerts row can do in place (A&M fork). Pure: the page joins each alert to the
// booking it was raised for (source key "booking:<id>") or the missed booking (a client who
// lost the time to someone else, "missed:<id>") and gets the client's contact links and
// whether Approve / Decline apply.
import type { BookingView, MissedView } from "@cds/db";

export type ContactLink = { kind: "email" | "call" | "text"; href: string };

export type AlertActions = {
  booking: BookingView | null;
  /** Who to reach out to (the booking's or the missed booking's client). */
  client: { name: string; phone: string } | null;
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

const NONE: AlertActions = {
  booking: null,
  client: null,
  contact: [],
  decide: false,
};

export function alertActions(
  sourceKey: string,
  bookings: ReadonlyMap<string, BookingView>,
  missed: ReadonlyMap<string, MissedView> = new Map(),
): AlertActions {
  if (sourceKey.startsWith("missed:")) {
    const m = missed.get(sourceKey.slice(7));
    if (!m) return NONE;
    return {
      booking: null,
      client: { name: m.clientName, phone: m.clientPhone },
      contact: contactLinks(m.clientEmail, m.clientPhone),
      decide: false,
    };
  }
  const id = sourceKey.startsWith("booking:") ? sourceKey.slice(8) : "";
  const booking = (id && bookings.get(id)) || null;
  if (!booking) return NONE;
  return {
    booking,
    client: { name: booking.clientName, phone: booking.clientPhone },
    contact: contactLinks(booking.clientEmail, booking.clientPhone),
    decide: booking.status === "requested",
  };
}
