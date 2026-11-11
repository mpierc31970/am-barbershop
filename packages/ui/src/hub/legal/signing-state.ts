// Pure signing helpers and copy for @cds/ui/hub/legal (09-04; 09-UI-SPEC "Copywriting
// Contract", "SignaturePanel"; CONTEXT A2-Q1, A6-Q2; D216). One source for the copy so
// pages (09-17, 09-18, 09-20), tests and how-tos never drift from the UI-SPEC wording.
// No data access, no React: safe on the server and the client.
import {
  normalizeSignerName,
  SIGNER_NAME_MAX,
  SIGNER_NAME_MIN,
  signerNameValid,
} from "@cds/core/legal/signer-name";

export const SIGNING_COPY = {
  /** Policy accept row (one per policy, never pre-ticked, no accept-all; D216). */
  policyCheckbox: (title: string) => `I have read and agree to the ${title}.`,
  consentText:
    "I agree to sign electronically and to receive these agreements and notices electronically. I can download a copy now and ask for a paper copy at any time.",
  nameLabel: "Your full legal name",
  nameHelper:
    "Type your name as you'd sign it on paper. Typing it here is your signature.",
  nameError: "Type your full name (at least 2 characters).",
  readFullText: "Read the full text",
  hideFullText: "Hide the full text",
  openInNewTab: "Open in a new tab",
  openInNewTabLabel: (title: string) => `Open the ${title} in a new tab`,
  whatChangedLead: "What changed:",
  progressAriaLabel: "Policies accepted",
  sign: "Sign and accept",
  signing: "Signing…",
  signHeading: "Sign your agreement",
  historyCopyHeader: "Copy",
  download: "Download",
} as const;

export const TYPED_NAME_MIN = SIGNER_NAME_MIN;
export const TYPED_NAME_MAX = SIGNER_NAME_MAX;

/**
 * The live reason line under an incomplete Sign and accept button (D-UI-P9-5), or null
 * when nothing is missing.
 */
export function signingReason(
  missingBoxes: number,
  nameOk: boolean,
): string | null {
  const n = Math.max(0, Math.floor(missingBoxes));
  if (n === 0) return nameOk ? null : "Type your name to sign.";
  const boxes = n === 1 ? "Tick 1 more box" : `Tick ${n} more boxes`;
  return nameOk ? `${boxes} to sign.` : `${boxes} and type your name to sign.`;
}

/**
 * WR-B04: the server's own normaliser (@cds/core/legal/signer-name), so the live statement
 * shows exactly the name that is recorded. NFC; control/format/separator characters become
 * spaces; whitespace collapsed; trimmed.
 */
export function normalizeTypedName(raw: string): string {
  return normalizeSignerName(raw);
}

/** 2-120 characters (code points) after normalising; the same rule the server applies. */
export function typedNameValid(raw: string): boolean {
  return signerNameValid(raw);
}

/** "{n} of {m} accepted". */
export function progressLabel(done: number, total: number): string {
  return `${done} of ${total} accepted`;
}

/** The live signing statement under the name field (09-UI-SPEC "SignaturePanel"). */
export function signingStatement(opts: {
  name: string;
  onBehalfOf: string;
  dateLabel: string;
}): string {
  const rest = `signing for ${opts.onBehalfOf} on ${opts.dateLabel}. The time and your IP address are recorded with your signature.`;
  return typedNameValid(opts.name)
    ? `${normalizeTypedName(opts.name)}, you're ${rest}`
    : `You're ${rest}`;
}
