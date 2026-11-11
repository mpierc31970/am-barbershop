// Marketing › Social copy (11-37; DASH-14, DASH-15, DASH-16; 11-UI-SPEC "Marketing › Social"
// lines 803-846 and the Copywriting Contract: SOCIAL-INTRO, BIO-FALLBACK, BIO-PREVIEW,
// GROW-INTRO, ERR-SAVE). SOCIAL-URL-HTTPS / -HOST / SOCIAL-DUP come from @cds/core/social
// (SOCIAL_COPY, socialUrlErrorCopy) so the hub and the server say the same thing.
// Pure and browser-safe.
import { findPreset, type SocialAccount } from "@cds/core/social";

export const SOCIAL_UI_COPY = Object.freeze({
  heading: "My social accounts",
  intro:
    "Add the social accounts you use. They show as icons in your site's footer and help Google connect them to your business. CDS never posts for you.",
  yourAccounts: "Your accounts",
  empty: "No accounts yet. Pick one below.",
  bioPreview:
    "These links use your preview address until your site moves to its own domain. Copy them again after launch.",
  copied: "Copied",
  copyManual: "Copy this link.",
  addHeading: "Add an account",
  addAnother: "Add another",
  nameLabel: "Name",
  save: "Save account",
  discard: "Discard",
  edit: "Edit",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove",
  undo: "Undo",
  errSave: "That didn't save. Check your connection and try again.",
  customPlaceholder: "https://example.com/yourbusiness",
});

/** "Copy link for your Instagram bio" */
export function copyBioLabel(name: string): string {
  return `Copy link for your ${name} bio`;
}

/** Polite live region after a copy: "Instagram bio link copied." */
export function copiedAnnouncement(name: string): string {
  return `${name} bio link copied.`;
}

/** "Bio link: riverabakery.com/ig" (no scheme). */
export function bioLinkLine(link: string): string {
  return `Bio link: ${link.replace(/^https?:\/\//, "")}`;
}

/** BIO-FALLBACK, with the account's real codes (11-35 kept `/go/ig`, not `/go/instagram`). */
export function bioFallbackCopy(
  account: Pick<SocialAccount, "bioPath">,
): string {
  const code = account.bioPath.replace(/^\/go\//, "");
  return `Your page at /${code} uses that address, so this account's link uses /go/${code} instead.`;
}

/** "Instagram removed." (Undo toast, 8 s). */
export function removedCopy(name: string): string {
  return `${name} removed.`;
}

/** "Instagram added. It shows in your site's footer." */
export function addedCopy(name: string): string {
  return `${name} added. It shows in your site's footer.`;
}

/** "Instagram profile address" */
export function addressLabel(name: string): string {
  return `${name} profile address`;
}

/** "More for Instagram" (row overflow menu trigger). */
export function moreLabel(name: string): string {
  return `More for ${name}`;
}

/** Example address for a platform's field, e.g. "https://instagram.com/riverabakery". */
export function addressPlaceholder(platform: string): string {
  const p = findPreset(platform);
  return p
    ? `https://${p.hosts[0]}/riverabakery`
    : SOCIAL_UI_COPY.customPlaceholder;
}

export const GROW_COPY = Object.freeze({
  heading: "Grow your social",
  intro: "Small things that help people find you. Tick them off as you go.",
  everyAccount: "Every account",
  noAccounts: "Add an account above to see tips for it.",
  saved: "Saved",
  errSave: SOCIAL_UI_COPY.errSave,
});

/** "4 of 12 done" */
export function growDoneCopy(done: number, total: number): string {
  return `${done} of ${total} done`;
}
