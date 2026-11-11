// The re-acceptance gate (AGR-07, CONTEXT A3-Q1/A3-Q2, D216, D287; RESEARCH Pattern 7,
// Pitfalls 13, 14; D-UI-P9-9; T-09-15-01, T-09-15-03).
//
// When an org has signed at least once and a policy (or the consent text) moved on, its
// Owner is sent to /hub/agreement?mode=reaccept&next=<where they were going> before any
// hub page or action runs. requireHubSession (lib/session.ts) redirects page loads; runAction
// (lib/action.ts) and the hub media routes (lib/media-route.ts) answer `agreement_required`
// instead, so an open editor keeps its work (review WR-C01, WR-C02). The helpers below are
// pure so they are tested directly.
//
// The top section has no server imports. getAgreementStatus (bottom) reads the database and
// is server-only: never import this module from the middleware (use lib/path-header.ts).
import {
  agreementStatus,
  type AgreementStatus,
  type OrgContext,
} from "@cds/db";
import { cache } from "react";
import { MAX_PATH_HEADER, PATH_HEADER } from "./path-header";

export { PATH_HEADER };

const HUB_PATH_RE = /^\/hub(?:[/?#]|$)/;
// C0 controls, DEL and C1 controls.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function hasUnsafeParts(v: string): boolean {
  return (
    v.includes("//") ||
    v.includes("\\") ||
    CONTROL_RE.test(v) ||
    /(?:^|\/)\.\.?(?:[/?#]|$)/.test(v)
  );
}

/**
 * A same-origin /hub path to return to, or `fallback` (D-UI-P9-9, Pitfall 13). Refuses
 * `//`, `\`, schemes, control characters and dot segments, raw or percent-encoded, and
 * anything over the path header cap.
 */
export function safeNext(
  raw: string | null | undefined,
  fallback = "/hub",
): string {
  if (typeof raw !== "string" || raw.length > MAX_PATH_HEADER) return fallback;
  if (!HUB_PATH_RE.test(raw) || hasUnsafeParts(raw)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!HUB_PATH_RE.test(decoded) || hasUnsafeParts(decoded)) return fallback;
  return raw;
}

/**
 * The one opt-out list (Pitfall 14): the agreement pages and the PDF download route stay
 * reachable so the gate can never loop. Sign-out is a Server Action that never runs the
 * gate. The hub has no Help route today (HubShell has no Help link), so no entry for it.
 */
export const AGREEMENT_GATE_OPT_OUT: readonly RegExp[] = [
  /^\/hub\/agreement\/?$/,
  /^\/hub\/agreement\/signed\/[^/]+\/?$/,
  /^\/hub\/agreement\/download\/[^/]+\/?$/,
];

/** True when `path` (pathname, optionally with ?query / #hash) is on the opt-out list. */
export function isGateExempt(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  return AGREEMENT_GATE_OPT_OUT.some((re) => re.test(pathname));
}

/** True for the paths the gate covers: /hub and below. */
export function isHubPath(path: string): boolean {
  return HUB_PATH_RE.test(path);
}

/**
 * ERR-GATE for saves (review WR-C01, WR-C02): a hub Server Action or media route refused by
 * the gate answers with this instead of a redirect, so the screen keeps the owner's work.
 */
export const AGREEMENT_GATE_COPY =
  "Our policies were updated, so saving is paused. Reload the page to review and accept them. Your unsaved changes on this screen are kept until you leave it.";

/** Where an outdated Owner is sent from `currentPath`. */
export function reacceptTarget(currentPath: string): string {
  return `/hub/agreement?mode=reaccept&next=${encodeURIComponent(safeNext(currentPath))}`;
}

// ---- server-only ------------------------------------------------------------------------

/**
 * The org's agreement status, read once per request (React cache): the gate, the setup
 * checklist item and P10's checkout share one lookup (AGR-02).
 */
export const getAgreementStatus = cache(
  (ctx: OrgContext): Promise<AgreementStatus> => agreementStatus(ctx),
);
