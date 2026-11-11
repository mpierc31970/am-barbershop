// Announcement banner settings and schedule state (CONT-11, D117, D123; RESEARCH
// Pitfall 8, Pitfall 9; T-03-13).
//
// The banner is site chrome stored in site_settings.banner, never a page section (D117,
// invariant 6). Its schedule is evaluated at request time from the raw settings: callers
// cache the raw record (60 s) and call bannerState(settings, now) per render, so a cache
// never holds a stale on/off flag (Pitfall 9). No cron (D123).
//
// Deny by default: validateBanner builds a fresh object from own properties only. The
// link URL runs through safeHref, so javascript: and data: links never reach an href.
// Datetimes arrive as UTC ISO strings converted in the browser (Pitfall 8); they are
// parsed with Date.parse, NaN is refused, and they are re-emitted as ISO.
import { InvalidInput } from "../errors";
import { formatShortUtc } from "./countdown";
import { safeHref } from "./validate";

export const BANNER_MESSAGE_MAX = 140;
export const BANNER_LINK_TEXT_MAX = 60;

export type BannerSettings = {
  enabled: boolean;
  message: string;
  link_text: string;
  link_url: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type BannerState = "off" | "always" | "scheduled" | "active" | "ended";

const MESSAGE_COPY = "Write the message visitors see in the banner.";
const LINK_URL_COPY = "Add the address this link goes to.";
const LINK_TEXT_COPY = "Add the words visitors click for this link.";
const DATE_COPY = "Choose a valid date and time.";
const MALFORMED_COPY = "The banner settings are malformed.";

type Raw = Record<string, unknown>;

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function text(raw: Raw, key: string, max: number): string {
  const v = own(raw, key);
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > max)
    throw new InvalidInput(`Keep this under ${max} characters.`);
  return s;
}

/** null/undefined/"" -> null; a parseable string -> ISO; anything else throws. */
function instant(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidInput(DATE_COPY);
  const s = value.trim();
  if (s === "") return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw new InvalidInput(DATE_COPY);
  return new Date(ms).toISOString();
}

export function validateBanner(raw: unknown): BannerSettings {
  let r: Raw;
  if (raw === undefined || raw === null) r = {};
  else if (typeof raw === "object" && !Array.isArray(raw)) r = raw as Raw;
  else throw new InvalidInput(MALFORMED_COPY);

  const enabled = own(r, "enabled") === true;
  const message = text(r, "message", BANNER_MESSAGE_MAX);
  if (enabled && message === "") throw new InvalidInput(MESSAGE_COPY);

  const link_text = text(r, "link_text", BANNER_LINK_TEXT_MAX);
  const link_url = safeHref(own(r, "link_url"));
  if (link_text !== "" && link_url === "")
    throw new InvalidInput(LINK_URL_COPY);
  if (link_url !== "" && link_text === "")
    throw new InvalidInput(LINK_TEXT_COPY);

  const starts_at = instant(own(r, "starts_at"));
  const ends_at = instant(own(r, "ends_at"));
  if (
    starts_at !== null &&
    ends_at !== null &&
    Date.parse(ends_at) <= Date.parse(starts_at)
  ) {
    throw new InvalidInput(
      `The end time is before the start time. Pick an end after ${formatShortUtc(starts_at)}.`,
    );
  }

  return { enabled, message, link_text, link_url, starts_at, ends_at };
}

function ms(iso: string | null): number | null {
  if (iso === null) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

/**
 * Where the banner is in its schedule at `now`. The window is start-inclusive and
 * end-exclusive: starts_at <= now < ends_at. A banner with no message is off.
 */
export function bannerState(b: BannerSettings | null, now: Date): BannerState {
  if (!b || !b.enabled || b.message.trim() === "") return "off";
  const start = ms(b.starts_at);
  const end = ms(b.ends_at);
  if (start === null && end === null) return "always";
  const t = now.getTime();
  if (start !== null && t < start) return "scheduled";
  if (end !== null && t >= end) return "ended";
  return "active";
}

/** Visitors see the banner when it is "always" or "active". */
export function isBannerVisible(b: BannerSettings | null, now: Date): boolean {
  const s = bannerState(b, now);
  return s === "always" || s === "active";
}

/** The hub's status line under the banner preview (UI-SPEC "Banner tab"), times in UTC. */
export function bannerStatusLine(b: BannerSettings | null, now: Date): string {
  const state = bannerState(b, now);
  const end = b?.ends_at ? formatShortUtc(b.ends_at) : "";
  switch (state) {
    case "off":
      return "Off. Visitors don't see a banner.";
    case "always":
      return "Showing on every page now.";
    case "scheduled": {
      const start = b?.starts_at ? formatShortUtc(b.starts_at) : "";
      return end === "" ? `Starts ${start}.` : `Starts ${start}. Ends ${end}.`;
    }
    case "active":
      return end === ""
        ? "Showing on every page now."
        : `Showing now until ${end}.`;
    case "ended":
      return `Ended ${end}. Turn it off or pick new dates.`;
  }
}
