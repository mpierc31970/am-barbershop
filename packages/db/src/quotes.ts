// Anonymous quote chokepoint (ONB-08, ONB-06, ONB-11; D213; CONTEXT A1-Q2, A1-Q3; RESEARCH
// Pattern 1). A /start visitor holds a raw 256-bit token (cookie or reopen link); only its
// sha256 is stored (quotes.token_hash, unique). Every anonymous function takes the raw token
// and the client IP, never an organization: a quote is a platform row until Submit (06-08).
//
// Rules (T-06-28..T-06-33):
//   - A token must match QUOTE_TOKEN_RE before it is hashed, so junk never reaches PB.
//     Unknown, malformed and expired tokens read the same (null / "expired").
//   - Totals are recomputed on the server from the price catalog on every write; client
//     totals are never stored (priceQuote over readPriceCatalog).
//   - Changing path drops add-ons that do not fit the new path and reports them.
//   - expires_at = last change + QUOTE_TTL_DAYS on every write.
//   - Submitted and blocked quotes are read-only.
//   - Saving needs a valid email and a passing HumanCheck (Turnstile), then sends quote.saved.
//   - Unsubscribe links are HMAC-signed ("unsub" purpose) and write a CDS-sender marketing
//     suppression (D138, D-UI-P6-15). Callers unsubscribe on POST only (RFC 8058, 06-16).
import { createHash, randomBytes } from "node:crypto";
import { InvalidInput, NotFound } from "@cds/core";
import {
  ADDON_PATHS,
  type AddonPath,
  type AddonRegistry,
} from "@cds/core/addons";
import { normaliseEmail } from "@cds/core/email";
import {
  EXTRAS,
  findBusinessType,
  PATHS,
  reconcileSelections,
} from "@cds/core/onboarding";
import {
  normaliseSelections,
  priceQuote,
  type QuoteSelections,
  type QuoteTotals,
} from "@cds/core/pricing";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { readPriceCatalog } from "./catalog";
import { withSuperuser } from "./client";
import { mintSystemContext } from "./context";
import { platformUrl, signLink, verifyLink } from "./email";
import { addSuppression, isSuppressed } from "./email/suppressions";
import { sendEmail } from "./email/send";
import type { EmailTransport } from "./email/transport";
import { getHumanCheck, type HumanCheck } from "./human-check";
import { beginQuoteAction } from "./rate-limit";

// Defined in @cds/core/pricing so client components can type props without @cds/db (10-18).
export type { QuoteStatus, QuoteView } from "@cds/core/pricing";
import type { QuoteStatus, QuoteView } from "@cds/core/pricing";

export type QuoteDeps = {
  registry: AddonRegistry;
  transport?: EmailTransport;
  humanCheck?: HumanCheck;
  now?: Date;
};

export type QuotePatch = {
  path?: AddonPath;
  businessType?: string;
  businessTypeOther?: string;
  selections?: unknown;
};

export const QUOTE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const QUOTE_TTL_DAYS = 30;
/** Unsubscribe links outlive the quote by this many days (a late click still works). */
export const QUOTE_UNSUB_GRACE_DAYS = 90;

const COLLECTION = "quotes";
const DAY_MS = 24 * 60 * 60 * 1000;
const UNSUB_PURPOSE = "unsub";
const REOPEN_PURPOSE = "reopen";
const ID_RE = /^[a-z0-9]{1,64}$/i;
const OTHER_MAX = 80;
/** UI-SPEC ERR-HUMAN. */
export const ERR_HUMAN =
  "We couldn't confirm you're a person. Try again, or refresh the page.";
const BAD_QUOTE =
  "That quote doesn't look right. Refresh the page and try again.";
const READ_ONLY = "This quote has been submitted and can't be changed.";
const EXPIRED = "This quote has expired.";
const EXTRA_KEYS = new Set(EXTRAS.map((e) => e.key));

const EMPTY_SELECTIONS: QuoteSelections = Object.freeze({
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
}) as QuoteSelections;

// ---------------------------------------------------------------- helpers

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

function validToken(token: unknown): token is string {
  return typeof token === "string" && QUOTE_TOKEN_RE.test(token);
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function nowOf(deps?: { now?: Date }): Date {
  return deps?.now instanceof Date ? deps.now : new Date();
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + QUOTE_TTL_DAYS * DAY_MS);
}

function sellablePath(path: unknown): AddonPath {
  if (
    typeof path !== "string" ||
    !(ADDON_PATHS as readonly string[]).includes(path)
  ) {
    throw new InvalidInput(BAD_QUOTE);
  }
  const info = PATHS.find((p) => p.id === path);
  if (!info || !info.available) throw new InvalidInput(BAD_QUOTE);
  return path as AddonPath;
}

function storedSelections(raw: unknown): QuoteSelections {
  try {
    return normaliseSelections(raw ?? EMPTY_SELECTIONS);
  } catch {
    return { ...EMPTY_SELECTIONS };
  }
}

function toView(r: RecordModel): QuoteView {
  const path = typeof r.path === "string" ? r.path : "";
  return {
    id: r.id,
    status: r.status as QuoteStatus,
    path: path as AddonPath | "",
    businessType: String(r.business_type ?? ""),
    businessTypeOther: String(r.business_type_other ?? ""),
    selections: storedSelections(r.selections),
    totals:
      r.totals && typeof r.totals === "object"
        ? (r.totals as QuoteTotals)
        : null,
    email: String(r.email ?? ""),
    savedAt: toDate(r.saved_at),
    expiresAt: toDate(r.expires_at),
    updatedAt: toDate(r.updated) ?? new Date(0),
    businessName: String(r.business_name ?? ""),
    description: String(r.description ?? ""),
  };
}

function isExpired(r: RecordModel, now: Date): boolean {
  if (r.status === "expired") return true;
  const exp = toDate(r.expires_at);
  return exp === null || exp.getTime() <= now.getTime();
}

/** The raw row for a well-shaped token, or null (unknown). Never throws on 404. */
async function rowByToken(token: string): Promise<RecordModel | null> {
  if (!validToken(token)) return null;
  const h = hashToken(token);
  return withSuperuser(async (pb) => {
    try {
      return await pb
        .collection(COLLECTION)
        .getFirstListItem(pb.filter("token_hash = {:h}", { h }));
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
}

async function rowById(id: string): Promise<RecordModel | null> {
  if (!ID_RE.test(id)) return null;
  return withSuperuser(async (pb) => {
    try {
      return await pb.collection(COLLECTION).getOne(id);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
}

/** A live, writable row, or a thrown error the UI can show. */
async function writableRow(token: string, now: Date): Promise<RecordModel> {
  const row = await rowByToken(token);
  if (!row || isExpired(row, now)) throw new NotFound(EXPIRED);
  if (row.status === "submitted" || row.status === "blocked") {
    throw new InvalidInput(READ_ONLY);
  }
  return row;
}

/**
 * Normalise client selections: shape check, drop add-on slugs the registry does not offer
 * publicly and unknown extras, then drop add-ons that do not fit the path (reported).
 */
function cleanSelections(
  registry: AddonRegistry,
  path: AddonPath,
  raw: unknown,
): { selections: QuoteSelections; removed: string[] } {
  const s = normaliseSelections(raw);
  const known = new Set(registry.publicList().map((a) => a.slug));
  const base: QuoteSelections = {
    addons: s.addons.filter((slug) => known.has(slug)),
    extras: s.extras.filter((key) => EXTRA_KEYS.has(key)),
    carePlan: s.carePlan,
    cadence: s.cadence,
  };
  return reconcileSelections(registry, path, base);
}

async function totalsFor(
  selections: QuoteSelections,
  path: AddonPath,
): Promise<QuoteTotals> {
  return priceQuote(
    await readPriceCatalog(),
    selections,
    path,
    selections.cadence,
  );
}

function checkBusinessType(
  path: AddonPath,
  businessType: string,
  other: string | undefined,
): { type: string; other: string } {
  if (businessType === "") return { type: "", other: "" };
  const t = findBusinessType(businessType);
  if (!t || !t.paths.includes(path)) {
    throw new InvalidInput("Pick a business type from the list.");
  }
  if (t.id !== "other") return { type: t.id, other: "" };
  const text = typeof other === "string" ? other.trim() : "";
  if (text.length < 1 || text.length > OTHER_MAX) {
    throw new InvalidInput(
      `Tell us what kind of business it is (up to ${OTHER_MAX} characters).`,
    );
  }
  return { type: t.id, other: text };
}

// ---------------------------------------------------------------- links

/** The reopen link for a raw token (`/start/q/<token>`). */
export function quoteReopenLink(token: string): string {
  if (!validToken(token)) throw new InvalidInput(BAD_QUOTE);
  return platformUrl(`/start/q/${token}`);
}

function unsubToken(quoteId: string, expiresAt: Date): string {
  if (typeof quoteId !== "string" || !ID_RE.test(quoteId)) {
    throw new InvalidInput("invalid quote id");
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new InvalidInput("invalid quote expiry");
  }
  const exp = Math.floor(
    (expiresAt.getTime() + QUOTE_UNSUB_GRACE_DAYS * DAY_MS) / 1000,
  );
  return signLink(UNSUB_PURPOSE, quoteId, exp);
}

/**
 * GET landing page for the reminder footer. The signed link stays valid until the quote's
 * expires_at + QUOTE_UNSUB_GRACE_DAYS.
 */
export function quoteUnsubscribeLink(quoteId: string, expiresAt: Date): string {
  return platformUrl(
    `/start/unsubscribe?t=${encodeURIComponent(unsubToken(quoteId, expiresAt))}`,
  );
}

/** RFC 8058 one-click POST target (List-Unsubscribe header); same signed token. */
export function quoteUnsubscribePostUrl(
  quoteId: string,
  expiresAt: Date,
): string {
  return platformUrl(
    `/api/email/unsubscribe?t=${encodeURIComponent(unsubToken(quoteId, expiresAt))}`,
  );
}

/**
 * 06-09: the reopen link a reminder carries. The raw token is never stored, so the job
 * cannot build `/start/q/<token>`; it signs the quote id instead ("reopen" purpose),
 * valid until the quote expires. `/start/q/s/[signed]` (06-16) resolves it.
 */
export function quoteSignedReopenLink(
  quoteId: string,
  expiresAt: Date,
): string {
  if (typeof quoteId !== "string" || !ID_RE.test(quoteId)) {
    throw new InvalidInput("invalid quote id");
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new InvalidInput("invalid quote expiry");
  }
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return platformUrl(`/start/q/s/${signLink(REOPEN_PURPOSE, quoteId, exp)}`);
}

async function signedReopenRow(
  signed: string,
  now: Date,
): Promise<
  | { state: "valid"; row: RecordModel }
  | { state: "expired" | "submitted" }
  | null
> {
  const v = verifyLink(
    signed,
    REOPEN_PURPOSE,
    Math.floor(now.getTime() / 1000),
  );
  if (!v) return null;
  const row = await rowById(v.id);
  if (!row) return null;
  if (row.status === "submitted") return { state: "submitted" };
  if (row.status === "blocked" || isExpired(row, now)) {
    return { state: "expired" };
  }
  return { state: "valid", row };
}

/**
 * What a signed reopen link points at, WITHOUT changing anything (B-WR-01). The GET page
 * uses this, so a mail link scanner or a prefetch never rotates the quote token; only the
 * page's POST (resolveSignedReopen) does. Same outcomes as resolveSignedReopen.
 */
export async function describeSignedReopen(
  signed: string,
  deps?: { now?: Date },
): Promise<"valid" | "expired" | "submitted" | null> {
  const found = await signedReopenRow(signed, nowOf(deps));
  return found ? found.state : null;
}

/**
 * Resolve a signed reopen link (T-06-45). A valid link ROTATES the quote token: a new random
 * token is generated, its hash stored, and the raw token returned once for the cookie, so
 * any older cookie or reopen link stops working. Bad, unknown or tampered links are null;
 * blocked and past-expiry quotes read "expired"; submitted quotes read "submitted".
 */
export async function resolveSignedReopen(
  signed: string,
  deps?: { now?: Date },
): Promise<
  { state: "valid"; token: string } | { state: "expired" | "submitted" } | null
> {
  const found = await signedReopenRow(signed, nowOf(deps));
  if (!found || found.state !== "valid") return found;
  const row = found.row;
  const { token, hash } = newToken();
  await withSuperuser((pb) =>
    pb.collection(COLLECTION).update(row.id, { token_hash: hash }),
  );
  return { state: "valid", token };
}

// ---------------------------------------------------------------- anonymous API

/** First choice on /start: a new draft quote. The raw token is returned once, for the cookie. */
export async function createQuote(
  input: { path: AddonPath; ip: string },
  deps: QuoteDeps,
): Promise<{ token: string; quote: QuoteView }> {
  const path = sellablePath(input?.path);
  beginQuoteAction("create", input.ip);
  const now = nowOf(deps);
  const selections: QuoteSelections = { ...EMPTY_SELECTIONS };
  const totals = await totalsFor(selections, path);
  const { token, hash } = newToken();
  const row = await withSuperuser((pb) =>
    pb.collection(COLLECTION).create({
      token_hash: hash,
      status: "draft",
      path,
      selections,
      totals,
      expires_at: expiryFrom(now).toISOString(),
    }),
  );
  return { token, quote: toView(row) };
}

/** The quote for a token; null for unknown, malformed and expired tokens alike. */
export async function readQuoteByToken(
  token: string,
  deps?: { now?: Date },
): Promise<QuoteView | null> {
  const row = await rowByToken(token);
  if (!row) return null;
  if (row.status !== "submitted" && isExpired(row, nowOf(deps))) return null;
  return toView(row);
}

/** Apply one change; totals are recomputed from the catalog. Returns add-ons dropped by a path change. */
export async function updateQuote(
  token: string,
  patch: QuotePatch,
  ip: string,
  deps: QuoteDeps,
): Promise<{ quote: QuoteView; removed: string[] }> {
  if (!validToken(token)) throw new NotFound(EXPIRED);
  if (typeof patch !== "object" || patch === null) {
    throw new InvalidInput(BAD_QUOTE);
  }
  beginQuoteAction("update", ip);
  const now = nowOf(deps);
  const row = await writableRow(token, now);

  const path =
    patch.path !== undefined
      ? sellablePath(patch.path)
      : sellablePath(row.path);
  const rawSelections =
    patch.selections !== undefined
      ? patch.selections
      : storedSelections(row.selections);
  const { selections, removed } = cleanSelections(
    deps.registry,
    path,
    rawSelections,
  );

  // Business type: explicit value wins; otherwise keep the stored one if it fits the path.
  let business: { type: string; other: string };
  if (patch.businessType !== undefined) {
    if (typeof patch.businessType !== "string") {
      throw new InvalidInput(BAD_QUOTE);
    }
    business = checkBusinessType(
      path,
      patch.businessType,
      patch.businessTypeOther,
    );
  } else {
    const current = String(row.business_type ?? "");
    const fits = findBusinessType(current)?.paths.includes(path) ?? false;
    if (!fits) {
      business = { type: "", other: "" };
    } else if (current === "other" && patch.businessTypeOther !== undefined) {
      business = checkBusinessType(path, current, patch.businessTypeOther);
    } else {
      business = {
        type: current,
        other: current === "other" ? String(row.business_type_other ?? "") : "",
      };
    }
  }

  const totals = await totalsFor(selections, path);
  const saved = await withSuperuser((pb) =>
    pb.collection(COLLECTION).update(row.id, {
      path,
      business_type: business.type,
      business_type_other: business.other,
      selections,
      totals,
      expires_at: expiryFrom(now).toISOString(),
    }),
  );
  return { quote: toView(saved), removed };
}

/**
 * Save the quote to an email (CONTEXT A1-Q3). Order: rate limit -> email -> human check ->
 * row -> quote.saved. A send failure is logged and does not undo the save.
 */
export async function saveQuoteEmail(
  token: string,
  email: string,
  humanToken: string,
  ip: string,
  deps: QuoteDeps,
): Promise<QuoteView> {
  if (!validToken(token)) throw new NotFound(EXPIRED);
  beginQuoteAction("save", ip);
  const address = normaliseEmail(email); // InvalidInput(ERR_EMAIL)
  const check = deps.humanCheck ?? getHumanCheck();
  if (!(await check.verify(humanToken, ip))) {
    throw new InvalidInput(ERR_HUMAN);
  }
  const now = nowOf(deps);
  const row = await writableRow(token, now);
  const path = sellablePath(row.path);
  const selections = storedSelections(row.selections);
  const totals = await totalsFor(selections, path);
  const expiresAt = expiryFrom(now);
  const saved = await withSuperuser((pb) =>
    pb.collection(COLLECTION).update(row.id, {
      email: address,
      status: "saved",
      saved_at: now.toISOString(),
      totals,
      expires_at: expiresAt.toISOString(),
    }),
  );

  const system = mintSystemContext({ job: "quote" });
  try {
    await sendEmail(
      { kind: "cds", ctx: system },
      "quote.saved",
      address,
      {
        pathLabel: PATHS.find((p) => p.id === path)?.label ?? path,
        addonCount: selections.addons.length,
        buildCents: totals.build.cents ?? 0,
        monthlyCents: totals.monthlyCents,
        dueCents: totals.dueAtCheckoutCents,
        expiresAt,
        link: quoteReopenLink(token),
      },
      { transport: deps.transport, now },
    );
  } catch (err) {
    // The quote is saved; the visitor still has the cookie. The address is not logged.
    console.error(
      `[quotes] quote.saved send failed for quote ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return toView(saved);
}

/** What a reopen link leads to. Unknown, malformed, blocked and expired all read "expired". */
export async function quoteLinkState(
  token: string,
  deps?: { now?: Date },
): Promise<"valid" | "expired" | "submitted"> {
  const row = await rowByToken(token);
  if (!row) return "expired";
  if (row.status === "submitted") return "submitted";
  if (row.status === "blocked") return "expired";
  return isExpired(row, nowOf(deps)) ? "expired" : "valid";
}

// ---------------------------------------------------------------- unsubscribe

async function unsubTarget(
  signed: string,
): Promise<{ row: RecordModel; email: string } | null> {
  const v = verifyLink(signed, UNSUB_PURPOSE);
  if (!v) return null;
  const row = await rowById(v.id);
  if (!row) return null;
  const email = String(row.email ?? "");
  if (email === "") return null;
  return { row, email };
}

/** For the GET confirm page: which quote, until when, and whether it is already done. */
export async function describeUnsubscribe(
  signed: string,
): Promise<{ quoteId: string; expiresAt: Date | null; done: boolean } | null> {
  const t = await unsubTarget(signed);
  if (!t) return null;
  const system = mintSystemContext({ job: "quote" });
  return {
    quoteId: t.row.id,
    expiresAt: toDate(t.row.expires_at),
    done: await isSuppressed({ kind: "cds", ctx: system }, t.email),
  };
}

/** POST only. Writes a CDS marketing suppression; true when one exists afterwards. */
export async function unsubscribeQuote(signed: string): Promise<boolean> {
  const t = await unsubTarget(signed);
  if (!t) return false;
  const system = mintSystemContext({ job: "quote" });
  await addSuppression(system, {
    organization: null,
    email: t.email,
    reason: "unsubscribe",
    scope: "marketing",
    sourceType: "quote",
  });
  return isSuppressed({ kind: "cds", ctx: system }, t.email);
}
