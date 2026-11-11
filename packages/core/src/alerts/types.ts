// Alert vocabulary (DASH-35, D313). Pure and browser-safe.
import type { Action } from "../roles";
import type { Feature } from "../permissions";
import type { SectionKey } from "../today/items";

/** D313 levels: urgent (all channels at once), normal (push at once, email on), summary (digest). */
export type AlertLevel = "urgent" | "normal" | "summary";
export const ALERT_LEVELS: readonly AlertLevel[] = Object.freeze([
  "urgent",
  "normal",
  "summary",
]);

/** The bell is always on; email and push are per person. */
export type AlertChannel = "bell" | "email" | "push";

export type AlertTypeSpec = {
  /** Unique type key, e.g. `form.message`; add-on types are `<slug>.`-prefixed by convention. */
  type: string;
  level: AlertLevel;
  /** Row name on the profile table ("New form message"). */
  label: string;
  /** Label under the row name ("A message from your contact form"). */
  example: string;
  /** Permission the recipient needs (D285), checked with `can()`. */
  feature: Feature;
  access: Action;
  /** Billing-style alerts reach Owners only, whatever the matrix says. */
  ownerOnly?: boolean;
  /** Hub section the alert opens. */
  section: SectionKey;
  defaultChannels: { email: boolean; push: boolean };
  /**
   * Summary types only: false keeps the type out of the 7am digest (it sends its own email,
   * e.g. `reports.monthly`). Defaults to true.
   */
  digest?: boolean;
  /**
   * false: every alert of this type pushes at once with its own notification (a booking
   * request is a different client each time), never held by the 10-minute same-type
   * collapse. Quiet hours still hold it. Defaults to true.
   */
  collapse?: boolean;
};

/** A person's channel overrides, keyed by alert type (member_prefs). */
export type AlertChannelPrefs = Readonly<
  Record<string, { email?: boolean; push?: boolean } | undefined>
>;

export type ResolvedChannels = { bell: true; email: boolean; push: boolean };

/** Quiet hours as stored per person; `from`/`until` are business-local `HH:MM`. */
export type QuietHours = { on: boolean; from: string; until: string };

/** The manifest shape composeAlertTypes reads (11-08 adds `alerts` to AddonManifest). */
export type AlertSource = {
  slug: string;
  alerts?: readonly AlertTypeSpec[];
};
