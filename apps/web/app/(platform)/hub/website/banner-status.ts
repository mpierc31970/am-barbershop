// Banner tab logic (CONT-11, D117, D123; 03-UI-SPEC "Banner tab"). Pure and DOM-free so the
// client form, the server tab and the tests share it.
//
// - bannerStatusLine: the five status strings under the live preview. The state comes from
//   @cds/core bannerState (the same function the public site uses); only the time format
//   is injected, so the hub can show the owner's zone while the core stays UTC.
// - previewBanner: the preview always shows the owner's words, whatever the schedule, so
//   they can see what visitors will get. The status line says whether it is live.
// - bannerErrorField: which field a server message belongs to (the chokepoint throws
//   InvalidInput with UI-SPEC copy but no field name).
import {
  BANNER_MESSAGE_MAX,
  bannerState,
  type BannerSettings,
} from "@cds/core/content";

export type FormatInstant = (iso: string) => string;

export const BANNER_PREVIEW_PLACEHOLDER = "Your announcement shows here.";

export const BANNER_SAVED_COPY = "Banner saved.";

export const BANNER_HELD_COPY =
  "Your banner is being reviewed, usually within 2 business days. It stays off until then.";

export const BANNER_COPY = {
  message: "Write the message visitors see in the banner.",
  messageLong: `Keep this under ${BANNER_MESSAGE_MAX} characters.`,
  linkUrl: "Add the address this link goes to.",
  linkText: "Add the words visitors click for this link.",
  date: "Choose a valid date and time.",
} as const;

export type BannerField =
  "message" | "link_text" | "link_url" | "starts_at" | "ends_at";

/** The hub status line under the banner preview (UI-SPEC "Banner tab" status table). */
export function bannerStatusLine(
  banner: BannerSettings | null,
  now: Date,
  format: FormatInstant,
): string {
  const state = bannerState(banner, now);
  const end = banner?.ends_at ? format(banner.ends_at) : "";
  switch (state) {
    case "off":
      return "Off. Visitors don't see a banner.";
    case "always":
      return "Showing on every page now.";
    case "scheduled": {
      const start = banner?.starts_at ? format(banner.starts_at) : "";
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

/** Settings the public Banner renders unconditionally: on, no window, placeholder if empty. */
export function previewBanner(banner: BannerSettings): BannerSettings {
  const message = banner.message.trim();
  return {
    ...banner,
    enabled: true,
    message: message === "" ? BANNER_PREVIEW_PLACEHOLDER : message,
    starts_at: null,
    ends_at: null,
  };
}

/** Which field a chokepoint InvalidInput message belongs to (null: form-level). */
export function bannerErrorField(message: string): BannerField | null {
  if (message === BANNER_COPY.message || message === BANNER_COPY.messageLong) {
    return "message";
  }
  if (message === BANNER_COPY.linkUrl) return "link_url";
  if (message === BANNER_COPY.linkText) return "link_text";
  if (message.startsWith("The end time is before the start time")) {
    return "ends_at";
  }
  if (message === BANNER_COPY.date) return "starts_at";
  return null;
}

export type BannerDraftCheck = {
  enabled: boolean;
  message: string;
  link_text: string;
  link_url: string;
  /** UTC ISO or "" (empty or not a real date). */
  starts_at: string;
  ends_at: string;
  /** Raw datetime-local values, to tell "empty" from "not a real date". */
  starts_local: string;
  ends_local: string;
};

/**
 * Client-side checks with the server's copy (the server re-validates everything). The
 * first entry is the first invalid field in form order.
 */
export function bannerFieldErrors(
  d: BannerDraftCheck,
  format: FormatInstant,
): Partial<Record<BannerField, string>> {
  const errors: Partial<Record<BannerField, string>> = {};
  const message = d.message.trim();
  if (message.length > BANNER_MESSAGE_MAX) {
    errors.message = BANNER_COPY.messageLong;
  } else if (d.enabled && message === "") {
    errors.message = BANNER_COPY.message;
  }
  const text = d.link_text.trim();
  const url = d.link_url.trim();
  if (text !== "" && url === "") errors.link_url = BANNER_COPY.linkUrl;
  if (url !== "" && text === "") errors.link_text = BANNER_COPY.linkText;
  if (d.starts_local.trim() !== "" && d.starts_at === "") {
    errors.starts_at = BANNER_COPY.date;
  }
  if (d.ends_local.trim() !== "" && d.ends_at === "") {
    errors.ends_at = BANNER_COPY.date;
  } else if (
    d.starts_at !== "" &&
    d.ends_at !== "" &&
    Date.parse(d.ends_at) <= Date.parse(d.starts_at)
  ) {
    errors.ends_at = `The end time is before the start time. Pick an end after ${format(d.starts_at)}.`;
  }
  return errors;
}
