// Studio Booking hub + site helpers shared by the routes and actions. Plain module.
import { cookies, headers } from "next/headers";

export const STUDIO_BASE = "/hub/studio-booking";
export const STUDIO_NOTE_COOKIE = "cds_studio_note";
/** Request header the middleware copies the note into before it drops the cookie. */
export const STUDIO_NOTE_HEADER = "x-am-studio-note";

export function seatHref(seatId: string): string {
  return `${STUDIO_BASE}/seats/${seatId}`;
}

/** The one-time note an action left (cookie, 15 s), or null. */
export async function readStudioNote(): Promise<{
  tone: "success" | "danger";
  text: string;
} | null> {
  const raw =
    (await headers()).get(STUDIO_NOTE_HEADER) ??
    (await cookies()).get(STUDIO_NOTE_COOKIE)?.value ??
    "";
  const i = raw.indexOf(":");
  if (i < 1) return null;
  const kind = raw.slice(0, i);
  const text = raw.slice(i + 1);
  if (!text) return null;
  return { tone: kind === "ok" ? "success" : "danger", text };
}

/** 3500 -> "$35", 3550 -> "$35.50", 0 -> "Ask for a price". */
export function money(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "Ask for a price";
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

/** 45 -> "45 min", 90 -> "1 hr 30 min". */
export function duration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** cents -> the price field's text ("35.50"; "" for ask). */
export function priceField(cents: number): string {
  if (cents <= 0) return "";
  const d = cents / 100;
  return Number.isInteger(d) ? String(d) : d.toFixed(2);
}

/** "Friday, November 13" for a shop-local YYYY-MM-DD. */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "2:30 pm" for a shop-local HH:MM. */
export function time12(t: string): string {
  const h = Number(t.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${t.slice(3, 5)} ${h < 12 ? "am" : "pm"}`;
}
