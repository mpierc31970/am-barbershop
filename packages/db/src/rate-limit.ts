// App-layer sign-in rate limits (WR-01, IN-04; T-02-30).
//
// Every sign-in reaches PocketBase from the Next server (PB refuses guest `users` sign-in
// without the app key: pb_hooks/users_auth_guard.pb.js, iteration-3 CR-01), so PB sees one
// client IP and its @guest `*:auth` rule is a single bucket for the whole platform. The
// real brute-force limit lives here, keyed by the real client IP and by the account, before
// PB is called.
// In-process sliding windows: there is one app instance at the 10-50 tenant target scale
// (the same accepted limit as the members.ts mutex). Keys are never logged.
//
// Only failed attempts count (iteration-2 WR-02). An attempt takes a slot in every bucket
// before PB is called, so concurrent guesses cannot all slip past a check, and a success
// gives its slots back. A refused attempt (any bucket full) takes nothing, so an IP that is
// already over its limit cannot keep burning a named account's budget.
//
// A password attempt uses three buckets (iteration-3 WR-01):
//   - per client IP, all accounts (SIGN_IN_PER_IP)
//   - per (account, IP): tight, slows one source (SIGN_IN_PER_ACCOUNT_IP)
//   - per account, all IPs: loose, a distributed ceiling (SIGN_IN_PER_ACCOUNT)
// One IP can only fill its own (account, IP) bucket, so it cannot lock the real user out:
// that takes failures from at least SIGN_IN_PER_ACCOUNT / SIGN_IN_PER_ACCOUNT_IP sources.
// The OTP step keeps one tight bucket per otpId (SIGN_IN_PER_OTP), across all IPs.
import { RateLimited } from "@cds/core";
import { FORM_RATE_COPY } from "@cds/core/forms";
import { P13_COPY } from "@cds/core/staff";

export class SlidingWindowLimiter {
  readonly max: number;
  readonly windowMs: number;
  readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(
    max: number,
    windowMs: number,
    now: () => number = () => Date.now(),
  ) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > since);
    if (recent.length) this.hits.set(key, recent);
    else this.hits.delete(key);
    return recent;
  }

  /** True when `key` is at its limit (records nothing). */
  isFull(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  /** Record one attempt for `key`; false when the key is already at its limit. */
  hit(key: string): boolean {
    const t = this.take(key);
    return t !== null;
  }

  /**
   * Record one attempt and return its timestamp (for release), or null when full. `at` lets
   * a caller record one attempt at the same instant in several limiters (WR-A02).
   */
  take(key: string, at?: number): number | null {
    const recent = this.recent(key);
    if (recent.length >= this.max) return null;
    const t = at ?? this.now();
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(t - this.windowMs);
    return t;
  }

  /**
   * Milliseconds until `key` has room again: 0 when not full, else until its oldest recorded
   * hit leaves the window (07-32, additive).
   */
  retryAfterMs(key: string): number {
    const recent = this.recent(key);
    if (recent.length < this.max) return 0;
    const oldest = Math.min(...recent);
    return Math.max(0, oldest + this.windowMs - this.now());
  }

  /** Give back one attempt recorded at `t` (a success does not count). */
  release(key: string, t: number): void {
    const list = this.hits.get(key);
    if (!list) return;
    const i = list.indexOf(t);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this.hits.delete(key);
  }

  private sweep(since: number): void {
    for (const [k, v] of this.hits) {
      if (!v.some((x) => x > since)) this.hits.delete(k);
    }
  }

  clear(): void {
    this.hits.clear();
  }
}

/**
 * The source part of a visitor-facing bucket key (WR-A02, WR-A03). An IPv6 address is cut to
 * its /64, the block one subscriber controls, so rotating addresses inside it buys no extra
 * budget. IPv4 (and IPv4-mapped IPv6) stays whole. "" when there is no usable address.
 */
export function ipBucket(ip: unknown): string {
  if (typeof ip !== "string") return "";
  let s = ip.trim().toLowerCase();
  if (s === "") return "";
  if (!s.includes(":")) return s;
  s = s.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return mapped[1]!;
  const halves = s.split("::");
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return s;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
    return s;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

const WINDOW_MS = 10 * 60 * 1000;
/** Failed sign-in attempts per client IP per 10 minutes (all accounts). */
export const SIGN_IN_PER_IP = 30;
/** Failed password attempts per (account, client IP) per 10 minutes. */
export const SIGN_IN_PER_ACCOUNT_IP = 10;
/** Failed password attempts per account per 10 minutes, all IPs (distributed ceiling). */
export const SIGN_IN_PER_ACCOUNT = 100;
/** Failed OTP attempts per otpId per 10 minutes, all IPs. */
export const SIGN_IN_PER_OTP = 10;

const byIp = new SlidingWindowLimiter(SIGN_IN_PER_IP, WINDOW_MS);
const byAccountIp = new SlidingWindowLimiter(SIGN_IN_PER_ACCOUNT_IP, WINDOW_MS);
const byAccount = new SlidingWindowLimiter(SIGN_IN_PER_ACCOUNT, WINDOW_MS);
const byOtp = new SlidingWindowLimiter(SIGN_IN_PER_OTP, WINDOW_MS);

const TOO_MANY = "too many sign-in attempts; try again later";

type Bucket = { limiter: SlidingWindowLimiter; key: string };

/**
 * The buckets one attempt uses. Every password flow (staff and member) shares the account
 * buckets, keyed by normalized email, so no flow gives a second budget of guesses
 * (iteration-2 WR-01). A missing IP shares one "-" source per account.
 */
function bucketsFor(
  kind: "email" | "otp",
  ip: string | undefined,
  account: string,
): Bucket[] {
  const out: Bucket[] = [];
  if (ip) out.push({ limiter: byIp, key: `ip:${ip}` });
  if (kind === "otp") {
    out.push({ limiter: byOtp, key: `otp:${account}` });
  } else {
    const acct = `acct:${account.trim().toLowerCase()}`;
    out.push({ limiter: byAccountIp, key: `${acct}|ip:${ip || "-"}` });
    out.push({ limiter: byAccount, key: acct });
  }
  return out;
}

/** One in-flight sign-in attempt. Call `succeeded()` when the credentials were right. */
export type SignInAttempt = { succeeded(): void };

/**
 * Start one sign-in attempt. Throws RateLimited, recording nothing, when any bucket (client
 * IP, account from this IP, account overall, OTP) is over its limit (same message for all
 * and for known and unknown accounts: no enumeration). Otherwise the attempt counts as a
 * failure until `succeeded()` is called.
 */
export function beginSignIn(
  kind: "email" | "otp",
  ip: string | undefined,
  account: string,
): SignInAttempt {
  const buckets = bucketsFor(kind, ip, account);
  if (buckets.some((b) => b.limiter.isFull(b.key))) {
    throw new RateLimited(TOO_MANY);
  }
  // Every bucket has room (checked synchronously above), so every take succeeds.
  const taken = buckets.map((b) => ({ ...b, t: b.limiter.take(b.key) }));
  let done = false;
  return {
    succeeded() {
      if (done) return;
      done = true;
      for (const b of taken) if (b.t !== null) b.limiter.release(b.key, b.t);
    },
  };
}

/** Test-only: forget every recorded attempt. */
export function resetSignInLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetSignInLimitsForTests is test-only");
  byIp.clear();
  byAccountIp.clear();
  byAccount.clear();
  byOtp.clear();
}

// Anonymous quote actions (ONB-08, D213; PD-10; T-06-30). One bucket per kind, keyed by the
// real client IP (a missing IP shares one "-" bucket). Every call counts: these are writes.
/** Quote creations per client IP per 10 minutes. */
export const QUOTE_CREATE_PER_IP = 30;
/** Quote updates (selection changes) per client IP per 10 minutes. */
export const QUOTE_UPDATE_PER_IP = 300;
/** Quote saves (email + bot check) per client IP per 10 minutes. */
export const QUOTE_SAVE_PER_IP = 5;

const quoteLimiters = {
  create: new SlidingWindowLimiter(QUOTE_CREATE_PER_IP, WINDOW_MS),
  update: new SlidingWindowLimiter(QUOTE_UPDATE_PER_IP, WINDOW_MS),
  save: new SlidingWindowLimiter(QUOTE_SAVE_PER_IP, WINDOW_MS),
} as const;

/** UI-SPEC RATE-QUOTE / RATE-SAVE. */
export const QUOTE_RATE_COPY =
  "You're going a little fast. Wait a minute, then try again.";

/** Record one quote action for this IP; throws RateLimited when its bucket is full. */
export function beginQuoteAction(
  kind: "create" | "update" | "save",
  ip: string,
): void {
  const limiter = quoteLimiters[kind];
  if (!limiter) throw new RateLimited(QUOTE_RATE_COPY);
  const key = `ip:${typeof ip === "string" && ip !== "" ? ip : "-"}`;
  if (!limiter.hit(key)) throw new RateLimited(QUOTE_RATE_COPY);
}

/** Test-only: forget every recorded quote action. */
export function resetQuoteLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetQuoteLimitsForTests is test-only");
  quoteLimiters.create.clear();
  quoteLimiters.update.clear();
  quoteLimiters.save.clear();
}

// Submit step A and the member sign-in code request (ONB-08, D213; T-06-34, T-06-41). Every
// call counts (each one creates an OTP and may create a pending user). Both buckets are
// checked before either is taken, so a full IP cannot burn a named address's budget.
/** Code requests (Submit step A, member code) per client IP per 10 minutes. */
export const SUBMIT_PER_IP = 10;
/** Code requests per normalised email per 10 minutes, all IPs. */
export const SUBMIT_PER_EMAIL = 5;

const submitByIp = new SlidingWindowLimiter(SUBMIT_PER_IP, WINDOW_MS);
const submitByEmail = new SlidingWindowLimiter(SUBMIT_PER_EMAIL, WINDOW_MS);

/** UI-SPEC ERR-CODE-RATE. */
export const SUBMIT_RATE_COPY =
  "We've sent several codes to this address. Wait a minute, then try again.";

/** Record one code request for (IP, email); throws RateLimited when either bucket is full. */
export function beginCodeRequest(ip: string, email: string): void {
  const ipKey = `ip:${typeof ip === "string" && ip !== "" ? ip : "-"}`;
  const emailKey = `email:${String(email).trim().toLowerCase()}`;
  if (submitByIp.isFull(ipKey) || submitByEmail.isFull(emailKey)) {
    throw new RateLimited(SUBMIT_RATE_COPY);
  }
  submitByIp.hit(ipKey);
  submitByEmail.hit(emailKey);
}

/** Test-only: forget every recorded code request. */
export function resetSubmitLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetSubmitLimitsForTests is test-only");
  submitByIp.clear();
  submitByEmail.clear();
}

// Email-route confirm emails (A-WR-01 / B-WR-03; ONB-09, ONB-10). Add, change, restore and
// resend each send a confirm email to an address the caller chooses, so they share two
// buckets: per org (all addresses) and per recipient address (all orgs). Both are checked
// before either is taken. Every call counts: each one sends mail.
/** Route confirm emails per organization per hour. */
export const CONFIRM_SENDS_PER_ORG = 10;
/** Route confirm emails per recipient address per 24 hours, all orgs. */
export const CONFIRM_SENDS_PER_ADDRESS = 5;

const confirmByOrg = new SlidingWindowLimiter(
  CONFIRM_SENDS_PER_ORG,
  60 * 60 * 1000,
);
const confirmByAddress = new SlidingWindowLimiter(
  CONFIRM_SENDS_PER_ADDRESS,
  24 * 60 * 60 * 1000,
);

/** Owner-facing copy when a confirm email is refused by the limit. */
export const CONFIRM_RATE_COPY =
  "We've sent several confirmation emails already. Try again later, or check that inbox.";

/** Record one confirm email for (org, address); throws RateLimited when either bucket is full. */
export function beginConfirmSend(orgId: string, address: string): void {
  const orgKey = `org:${orgId}`;
  const addrKey = `addr:${String(address).trim().toLowerCase()}`;
  if (confirmByOrg.isFull(orgKey) || confirmByAddress.isFull(addrKey)) {
    throw new RateLimited(CONFIRM_RATE_COPY);
  }
  confirmByOrg.hit(orgKey);
  confirmByAddress.hit(addrKey);
}

/** Test-only: forget every recorded confirm send. */
export function resetConfirmSendLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetConfirmSendLimitsForTests is test-only");
  confirmByOrg.clear();
  confirmByAddress.clear();
}

// Form submits (CONT-25, D231; RESEARCH Pitfall 8; 07-15). Two buckets per form: per
// (org, form, client IP) and per (org, form), all IPs. Both are checked before either is
// taken, so a full IP burns nothing of the form's hourly budget. A send that fails
// validation gives both slots back (release), so a visitor fixing a typo is not penalised.
// In-process, one app instance (the same accepted limit as the other buckets).
/** Form submits per (org, form, client IP) per 10 minutes. */
export const FORM_SUBMITS_PER_IP_FORM = 5;
/** Form submits per (org, form) per hour, all IPs. */
export const FORM_SUBMITS_PER_FORM = 50;

const formByIp = new SlidingWindowLimiter(FORM_SUBMITS_PER_IP_FORM, WINDOW_MS);
const formByForm = new SlidingWindowLimiter(
  FORM_SUBMITS_PER_FORM,
  60 * 60 * 1000,
);

/** UI-SPEC FORM-RATE (one source of copy: @cds/core/forms). */
export { FORM_RATE_COPY };

/**
 * Take one submit slot for (org, form, IP); throws RateLimited (FORM-RATE) when full.
 * `release()` gives both slots back (a send that failed validation). `releaseForm()` gives
 * back only the form-wide slot (WR-A03): spam keeps its per-IP slot but never burns the
 * shared hourly budget real customers need. IPv6 sources are bucketed by /64 (ipBucket).
 */
export function takeFormSubmit(
  orgId: string,
  formId: string,
  ip: string,
): { release(): void; releaseForm(): void } {
  const ipPart = ipBucket(ip) || "-";
  const ipKey = `ipform:${orgId}:${formId}:${ipPart}`;
  const formKey = `form:${orgId}:${formId}`;
  if (formByIp.isFull(ipKey) || formByForm.isFull(formKey)) {
    throw new RateLimited(FORM_RATE_COPY);
  }
  const t1 = formByIp.take(ipKey);
  const t2 = formByForm.take(formKey);
  let ipHeld = true;
  let formHeld = true;
  return {
    release() {
      if (ipHeld && t1 !== null) formByIp.release(ipKey, t1);
      if (formHeld && t2 !== null) formByForm.release(formKey, t2);
      ipHeld = false;
      formHeld = false;
    },
    releaseForm() {
      if (formHeld && t2 !== null) formByForm.release(formKey, t2);
      formHeld = false;
    },
  };
}

// Forms Pro auto-reply (review CR-B01): the visitor picks the recipient, so one form could
// be used to mail any inbox from the tenant's sending identity. One auto-reply per (form,
// recipient) per 24 h; later submits from that address are stored and notified as usual,
// they just get no second reply. In-process, like the buckets above.
/** Auto-replies per (form, recipient address) per 24 hours. */
export const AUTO_REPLIES_PER_ADDRESS_FORM = 1;

const autoReplies = new SlidingWindowLimiter(
  AUTO_REPLIES_PER_ADDRESS_FORM,
  24 * 60 * 60 * 1000,
);

/** Take the auto-reply slot for (form, address); false when one was already sent. */
export function takeAutoReply(formId: string, address: string): boolean {
  const key = `autoreply:${formId}:${address.trim().toLowerCase()}`;
  if (autoReplies.isFull(key)) return false;
  autoReplies.take(key);
  return true;
}

/** Test-only: forget every recorded form submit (and auto-reply). */
export function resetFormSubmitLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetFormSubmitLimitsForTests is test-only");
  formByIp.clear();
  formByForm.clear();
  autoReplies.clear();
}

// Page gate (07-32; CONT-28, D235 #12; T-07-32-01). One bucket per (org, page, client IP): a
// wrong password takes a slot before the compare; a right one gives it back (the sign-in
// pattern above), so only wrong attempts count. gate.ts throws GateRateLimited when full, so
// this file keeps importing only @cds/core. In-process, one app instance (the accepted limit
// at the top of this file). Keys are never logged.
//
// WR-A02: a second, looser bucket per (org, page) across all IPs caps a guesser who rotates
// addresses (the sign-in "per account, all IPs" ceiling). Both are checked before either is
// taken; a right password gives both back. IPv6 sources are bucketed by /64 (ipBucket). A
// request with no client IP skips the per-IP bucket instead of sharing one "-" bucket with
// every other visitor, so one bad actor cannot lock everyone out at 10 tries.
/** Wrong page-password attempts per (org, page, client IP) per 15 minutes. */
export const PAGE_GATE_PER_IP_PAGE = 10;
/** Wrong page-password attempts per (org, page) per 15 minutes, all IPs. */
export const PAGE_GATE_PER_PAGE = 100;
export const PAGE_GATE_WINDOW_MS = 15 * 60 * 1000;

const pageGate = new SlidingWindowLimiter(
  PAGE_GATE_PER_IP_PAGE,
  PAGE_GATE_WINDOW_MS,
);
const pageGateAll = new SlidingWindowLimiter(
  PAGE_GATE_PER_PAGE,
  PAGE_GATE_WINDOW_MS,
);

function pageGateBuckets(
  orgId: string,
  pageId: string,
  ip: string,
): { limiter: SlidingWindowLimiter; key: string }[] {
  const src = ipBucket(ip);
  const out = [{ limiter: pageGateAll, key: `gate:${orgId}:${pageId}` }];
  if (src) {
    out.push({ limiter: pageGate, key: `gate:${orgId}:${pageId}:${src}` });
  }
  return out;
}

/** Take one gate attempt; its timestamp (for release), or null when a bucket is full. */
export function takePageGateAttempt(
  orgId: string,
  pageId: string,
  ip: string,
): number | null {
  const buckets = pageGateBuckets(orgId, pageId, ip);
  if (buckets.some((b) => b.limiter.isFull(b.key))) return null;
  // Every bucket has room (checked synchronously above); one instant in all of them.
  const t = Date.now();
  for (const b of buckets) b.limiter.take(b.key, t);
  return t;
}

/** Give back an attempt that turned out right. */
export function releasePageGateAttempt(
  orgId: string,
  pageId: string,
  ip: string,
  t: number,
): void {
  for (const b of pageGateBuckets(orgId, pageId, ip)) {
    b.limiter.release(b.key, t);
  }
}

/** Whole seconds until this (org, page, IP) may try again (0 when it has room). */
export function pageGateRetryAfterS(
  orgId: string,
  pageId: string,
  ip: string,
): number {
  const ms = Math.max(
    0,
    ...pageGateBuckets(orgId, pageId, ip).map((b) =>
      b.limiter.retryAfterMs(b.key),
    ),
  );
  return Math.ceil(ms / 1000);
}

/** Test-only: forget every recorded gate attempt. */
export function resetPageGateLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetPageGateLimitsForTests is test-only");
  pageGate.clear();
  pageGateAll.clear();
}

// Support actions (12-01; CONTEXT Area 6; T-12-01-03). Tickets and uploads are counted per
// org per day (key `org:<id>`), messages per person per hour (key `user:<org>:<actor>`).
// Every call counts: these are writes. A missing org, a message without an actor or an
// unknown kind fails closed. Per-process, like every limiter here.
/** New tickets per org per 24 hours. */
export const SUPPORT_TICKETS_PER_ORG = 20;
/** Messages per person (per org) per hour. */
export const SUPPORT_MESSAGES_PER_PERSON = 60;
/** File uploads per org per 24 hours. */
export const SUPPORT_UPLOADS_PER_ORG = 50;

const SUPPORT_DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORT_HOUR_MS = 60 * 60 * 1000;

const supportLimiters = {
  ticket: new SlidingWindowLimiter(SUPPORT_TICKETS_PER_ORG, SUPPORT_DAY_MS),
  message: new SlidingWindowLimiter(
    SUPPORT_MESSAGES_PER_PERSON,
    SUPPORT_HOUR_MS,
  ),
  upload: new SlidingWindowLimiter(SUPPORT_UPLOADS_PER_ORG, SUPPORT_DAY_MS),
} as const;

export type SupportActionKind = keyof typeof supportLimiters;

/** UI-SPEC RATE-TICKETS / RATE-MESSAGES / RATE-UPLOADS (verbatim). */
export const SUPPORT_RATE_COPY: Readonly<Record<SupportActionKind, string>> =
  Object.freeze({
    ticket:
      "Your site has sent a lot of tickets today. Add to an open ticket, or try again tomorrow.",
    message:
      "You've sent a lot of messages in the last hour. Try again in a few minutes. Your text is kept.",
    upload:
      "Your site has uploaded a lot of files today. Try again tomorrow, or describe it in words for now.",
  });

function supportKey(
  kind: SupportActionKind,
  who: { orgId: string; actorId?: string },
): string | null {
  const org = typeof who?.orgId === "string" ? who.orgId : "";
  if (!org) return null;
  if (kind !== "message") return `org:${org}`;
  const actor = typeof who.actorId === "string" ? who.actorId : "";
  return actor ? `user:${org}:${actor}` : null;
}

/**
 * Record one support action; throws RateLimited (with SUPPORT_RATE_COPY[kind]) when its
 * bucket is full, the kind is unknown, or the org (or, for a message, the actor) is missing.
 */
export function beginSupportAction(
  kind: SupportActionKind,
  who: { orgId: string; actorId?: string },
): void {
  const limiter = Object.hasOwn(supportLimiters, kind)
    ? supportLimiters[kind]
    : undefined;
  const copy = Object.hasOwn(SUPPORT_RATE_COPY, kind)
    ? SUPPORT_RATE_COPY[kind]
    : SUPPORT_RATE_COPY.message;
  const key = limiter ? supportKey(kind, who) : null;
  if (!limiter || !key) throw new RateLimited(copy);
  if (!limiter.hit(key)) throw new RateLimited(copy);
}

/** Test-only: forget every recorded support action. */
export function resetSupportLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetSupportLimitsForTests is test-only");
  supportLimiters.ticket.clear();
  supportLimiters.message.clear();
  supportLimiters.upload.clear();
}

// Public reports (/report; STAFF-24, D249, P13-P24; T-13-30-01). Anonymous, so the bucket
// is the client IP (IPv6 cut to its /64 by ipBucket). Every call counts, accepted or not;
// the caller takes the slot before Turnstile and the case write. In-process, one app
// instance (the accepted limit above).
/** Reports per client IP per hour. */
export const REPORT_PER_IP = 5;
const REPORT_WINDOW_MS = 60 * 60 * 1000;
const reportLimiter = new SlidingWindowLimiter(REPORT_PER_IP, REPORT_WINDOW_MS);

/** UI-SPEC RATE-REPORT (verbatim, from P13_COPY). */
export const REPORT_RATE_COPY: string = P13_COPY.RATE_REPORT;

/** Record one public report for this IP; throws RateLimited (RATE-REPORT) when full. */
export function beginReportAction(ip: string): void {
  const bucket = ipBucket(ip);
  const key = `ip:${bucket !== "" ? bucket : "-"}`;
  if (!reportLimiter.hit(key)) throw new RateLimited(REPORT_RATE_COPY);
}

// The reporter picks the receipt address, so /report could be used to mail any inbox from
// CDS (review WR-A04). A few receipts per address per day; past that the report is still
// filed, only the receipt is skipped.
/** `report.received` receipts per recipient address per 24 hours. */
export const REPORT_RECEIPTS_PER_ADDRESS = 3;
const reportReceipts = new SlidingWindowLimiter(
  REPORT_RECEIPTS_PER_ADDRESS,
  24 * 60 * 60 * 1000,
);

/** Take a receipt slot for this address; false when it already had its share today. */
export function takeReportReceipt(address: string): boolean {
  return reportReceipts.hit(`receipt:${address.trim().toLowerCase()}`);
}

/** Test-only: forget every recorded report (and receipt). */
export function resetReportLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetReportLimitsForTests is test-only");
  reportLimiter.clear();
  reportReceipts.clear();
}

// Hub /contact (15-03; A3-Q2, T-15-03-02). Anonymous, so the bucket is the client IP (IPv6 cut
// to its /64 by ipBucket); its own limiter, so contact and report never share a budget. Every
// call counts; the caller takes the slot before Turnstile and the inquiry write. In-process,
// one app instance (the accepted limit above).
/** Contact messages per client IP per hour. */
export const CONTACT_PER_IP = 5;
const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const contactLimiter = new SlidingWindowLimiter(
  CONTACT_PER_IP,
  CONTACT_WINDOW_MS,
);

/** 15-UI-SPEC Contact rate-limit error (verbatim). */
export const CONTACT_RATE_COPY =
  "Too many messages from this connection. Try again in an hour, or email hello@connectionsdesignstudios.com.";

/** Record one contact message for this IP; throws RateLimited (CONTACT_RATE_COPY) when full. */
export function beginContactAction(ip: string): void {
  const bucket = ipBucket(ip);
  const key = `ip:${bucket !== "" ? bucket : "-"}`;
  if (!contactLimiter.hit(key)) throw new RateLimited(CONTACT_RATE_COPY);
}

/** Test-only: forget every recorded contact message. */
export function resetContactLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetContactLimitsForTests is test-only");
  contactLimiter.clear();
}

// Edge ask (14-17; DOM-06, D13; T-14-17-01). Caddy's on_demand_tls asks GET /api/edge/ask
// before issuing a certificate. Caddy itself is the caller, so a per-IP bucket would be one
// shared bucket anyone could fill with random SNI names (WR-A11). Known hosts are never
// limited; only asks for names that are not allowed count, bucketed by the name's last two
// labels (the registrable domain, approximately). In-process, one app instance.
/** Asks for not-allowed names per registrable domain per minute. */
export const EDGE_ASK_MISSES_PER_DOMAIN = 120;
const EDGE_ASK_WINDOW_MS = 60 * 1000;
const edgeAskLimiter = new SlidingWindowLimiter(
  EDGE_ASK_MISSES_PER_DOMAIN,
  EDGE_ASK_WINDOW_MS,
);

function edgeAskBucket(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  return labels.slice(-2).join(".") || "-";
}

/** Record one ask for a not-allowed name; throws RateLimited when its domain is full. */
export function beginEdgeAskMiss(host: string): void {
  const key = `edge:${edgeAskBucket(typeof host === "string" ? host : "")}`;
  if (!edgeAskLimiter.hit(key)) throw new RateLimited("too many edge asks");
}

/** Test-only: forget every recorded edge ask. */
export function resetEdgeAskLimitsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetEdgeAskLimitsForTests is test-only");
  edgeAskLimiter.clear();
}
