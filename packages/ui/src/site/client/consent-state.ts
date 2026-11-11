// Cookie-consent state in the browser (CONT-34, D279; 07-14 choices 6 and 10). No React.
//
// - The choice is a first-party `cds_consent=all|necessary` cookie, 180 days, Path=/,
//   SameSite=Lax (+ Secure on https). It is strictly necessary data; unknown values count as
//   no choice (parseConsentChoice, exact match).
// - "Pending" lives in the DOM: the SSR'd banner carries `data-cds-consent-pending`, so a
//   pop-up controller in the page knows to wait no matter which island's effects ran first.
// - A choice dispatches `CustomEvent("cds:consent", { detail: { choice } })` on document;
//   frames load on "all", pop-ups start their automatic triggers on any choice.
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_S,
  parseConsentChoice,
  type ConsentChoice,
} from "@cds/core/content";

export const CONSENT_EVENT = "cds:consent";
export const CONSENT_REOPEN_EVENT = "cds:consent-reopen";
export const PENDING_ATTR = "data-cds-consent-pending";

export interface ConsentEventDetail {
  choice: ConsentChoice;
}

/** The stored choice from a `document.cookie`-style string, else null. */
export function readConsent(cookieString: unknown): ConsentChoice | null {
  if (typeof cookieString !== "string" || cookieString === "") return null;
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== CONSENT_COOKIE) continue;
    return parseConsentChoice(part.slice(eq + 1).trim());
  }
  return null;
}

/** The choice stored in this browser (the one place islands read the cookie). */
export function storedConsent(doc: Document = document): ConsentChoice | null {
  return readConsent(doc.cookie);
}

export function writeConsent(
  choice: ConsentChoice,
  doc: Document = document,
): void {
  const secure =
    doc.defaultView?.location?.protocol === "https:" ? "; Secure" : "";
  doc.cookie = `${CONSENT_COOKIE}=${choice}; Path=/; Max-Age=${CONSENT_MAX_AGE_S}; SameSite=Lax${secure}`;
}

/** True while the banner is waiting for a first answer. */
export function consentPending(doc: Document = document): boolean {
  if (!doc.querySelector(`[${PENDING_ATTR}]`)) return false;
  return storedConsent(doc) === null;
}

export function announceConsent(
  choice: ConsentChoice,
  doc: Document = document,
): void {
  doc.dispatchEvent(
    new CustomEvent<ConsentEventDetail>(CONSENT_EVENT, { detail: { choice } }),
  );
}

/** The choice carried by a `cds:consent` event, validated. */
export function choiceOf(event: Event): ConsentChoice | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== "object") return null;
  return parseConsentChoice((detail as { choice?: unknown }).choice);
}

/**
 * Call `cb` once consent is no longer pending: on the next tick when nothing is pending,
 * else after the first `cds:consent` event. The returned function cancels it.
 */
export function onConsentResolved(
  cb: () => void,
  doc: Document = document,
): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cleanup();
    cb();
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onEvent = () => run();
  const cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    doc.removeEventListener(CONSENT_EVENT, onEvent);
  };
  if (consentPending(doc)) {
    doc.addEventListener(CONSENT_EVENT, onEvent);
  } else {
    timer = setTimeout(run, 0);
  }
  return () => {
    done = true;
    cleanup();
  };
}

/** Show the banner again (the footer's Cookie choices link). */
export function reopenConsent(doc: Document = document): void {
  doc.dispatchEvent(new CustomEvent(CONSENT_REOPEN_EVENT));
}

/** GA's own cookies: `_ga` and `_ga_<container>` (GA4), plus the older `_gid` / `_gat*`. */
export function isGaCookie(name: string): boolean {
  return (
    name === "_ga" ||
    name.startsWith("_ga_") ||
    name === "_gid" ||
    name.startsWith("_gat")
  );
}

/**
 * Expire every GA cookie on this host and each parent domain (gtag's `cookie_domain: auto`
 * writes to the highest domain it may, e.g. `.example.com` for `www.example.com`). A domain
 * the browser refuses (a public suffix) is simply ignored. Lives here because this module
 * is the one place islands touch cookies (review 11 WR-D06).
 */
export function clearGaCookies(doc: Document = document): void {
  const names = doc.cookie
    .split(";")
    .map((c) => c.split("=")[0]!.trim())
    .filter(isGaCookie);
  if (names.length === 0) return;
  const labels = (doc.location?.hostname ?? "").split(".");
  const domains = [""];
  for (let i = 0; i < labels.length - 1; i++) {
    domains.push(`; domain=.${labels.slice(i).join(".")}`);
  }
  for (const name of names) {
    for (const domain of domains) {
      doc.cookie = `${name}=; Max-Age=0; path=/${domain}`;
    }
  }
}
