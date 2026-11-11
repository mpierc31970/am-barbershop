"use server";
// /start quote choices (ONB-06, ONB-08, ONB-11; CONTEXT A1-Q2; UI-SPEC "Configurator";
// T-06-69..T-06-73). One public action for every configurator choice. The first choice
// (a path) creates the server quote and sets the httpOnly quote cookie; every later choice
// updates that quote. The chokepoint validates the patch, reconciles add-ons with the path
// and recomputes totals from the catalog (06-07); per-IP limits live there too.
//
// Rules: the patch keys are allow-listed; the action never takes a tenant id; the raw
// token never leaves the server (not returned, not logged). An expired, unknown or already
// submitted quote is replaced by a new one when the choice carries a path; otherwise the
// visitor sees ERR-QUOTE and the next path choice starts fresh.
//
// 13-32 (STAFF-07, T-13-32-01): selected add-on slugs must be pickable in the merged
// catalog view (getCatalogView): a hidden, coming-soon, private or unknown slug in a
// crafted POST is refused with the bad-input copy before any @cds/db call.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput, NotFound, RateLimited } from "@cds/core";
import type { AddonPath } from "@cds/core/addons";
import {
  createQuote,
  readQuoteByToken,
  saveQuoteEmail,
  updateQuote,
  type QuoteDeps,
  type QuoteView,
} from "@cds/db";
import {
  QUOTE_BAD_INPUT_COPY,
  QUOTE_FAILED_COPY,
  QUOTE_RATE_LIMITED_COPY,
} from "../../lib/action";
import {
  CATALOG_UNAVAILABLE_COPY,
  checkAddonsPickable,
} from "../../lib/catalog-view";
import { readQuoteCookie, setQuoteCookie } from "../../lib/quote-cookie";
import { clientIp } from "../../lib/session";
import { redirect } from "next/navigation";

export type QuoteClientState = {
  quote: QuoteView | null;
  removed: string[];
  error: string | null;
};

export type QuoteChoice = {
  path?: AddonPath;
  businessType?: string;
  businessTypeOther?: string;
  selections?: unknown;
};

const ALLOWED_KEYS = new Set([
  "path",
  "businessType",
  "businessTypeOther",
  "selections",
]);

class BadChoice extends Error {}

/** Allow-listed copy of the browser's patch; anything else is refused (T-06-70). */
function cleanChoice(raw: unknown): QuoteChoice {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BadChoice();
  }
  const out: QuoteChoice = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_KEYS.has(key)) throw new BadChoice();
    if (value === undefined) continue;
    if (key === "selections") {
      out.selections = value;
      continue;
    }
    if (typeof value !== "string") throw new BadChoice();
    if (key === "path") out.path = value as AddonPath;
    if (key === "businessType") out.businessType = value;
    if (key === "businessTypeOther") out.businessTypeOther = value;
  }
  return out;
}

/**
 * Null when every selected add-on slug is pickable right now (an empty or absent list
 * passes); otherwise the refusal copy. A failed listing read refuses too (WR-D09).
 */
async function addonsRefusal(selections: unknown): Promise<string | null> {
  if (typeof selections !== "object" || selections === null) return null;
  const raw = (selections as { addons?: unknown }).addons;
  const res = await checkAddonsPickable(
    Array.isArray(raw) ? raw.filter((s) => typeof s === "string") : raw,
  );
  if (res === "ok") return null;
  return res === "unavailable"
    ? CATALOG_UNAVAILABLE_COPY
    : QUOTE_BAD_INPUT_COPY;
}

function failed(error: string): QuoteClientState {
  return { quote: null, removed: [], error };
}

/** The error's kind only: a thrown message could echo request data (T-06-73). */
function logFailure(err: unknown): void {
  const kind = err instanceof Error ? err.name : typeof err;
  console.error("[quote] choice failed:", kind);
}

/** True when the cookie's quote can no longer be changed (submitted or blocked). */
async function isReadOnly(token: string): Promise<boolean> {
  try {
    const q = await readQuoteByToken(token);
    return q?.status === "submitted" || q?.status === "blocked";
  } catch {
    return false;
  }
}

async function startQuote(
  choice: QuoteChoice & { path: AddonPath },
  ip: string,
  deps: QuoteDeps,
): Promise<QuoteClientState> {
  const { path, ...rest } = choice;
  const created = await createQuote({ path, ip }, deps);
  await setQuoteCookie(created.token);
  if (Object.keys(rest).length === 0) {
    return { quote: created.quote, removed: [], error: null };
  }
  const { quote, removed } = await updateQuote(created.token, rest, ip, deps);
  return { quote, removed, error: null };
}

export async function chooseQuoteAction(
  patch: QuoteChoice,
): Promise<QuoteClientState> {
  let choice: QuoteChoice;
  try {
    choice = cleanChoice(patch);
  } catch {
    return failed(QUOTE_BAD_INPUT_COPY);
  }

  try {
    const refusal = await addonsRefusal(choice.selections);
    if (refusal) return failed(refusal);
    const ip = await clientIp();
    const deps: QuoteDeps = { registry: ADDON_REGISTRY };
    const token = await readQuoteCookie();
    const hasPath = choice.path !== undefined;

    if (token) {
      try {
        const { quote, removed } = await updateQuote(token, choice, ip, deps);
        return { quote, removed, error: null };
      } catch (err) {
        const gone =
          err instanceof NotFound ||
          (err instanceof InvalidInput && hasPath && (await isReadOnly(token)));
        if (!gone) throw err;
      }
    }
    if (!hasPath) return failed(QUOTE_FAILED_COPY);
    return await startQuote(
      choice as QuoteChoice & { path: AddonPath },
      ip,
      deps,
    );
  } catch (err) {
    if (err instanceof RateLimited) return failed(QUOTE_RATE_LIMITED_COPY);
    if (err instanceof InvalidInput) return failed(err.message);
    logFailure(err);
    return failed(QUOTE_FAILED_COPY);
  }
}

// ---------------------------------------------------------------- save by email (06-15)

export type SaveQuoteState = {
  status: "idle" | "saved";
  email: string | null;
  error: string | null;
};

const EMAIL_MAX = 254;
const HUMAN_TOKEN_MAX = 2048;

function field(formData: FormData, name: string, max: number): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * "Save your quote? Just your email." (ONB-08, D213, CONTEXT A1-Q3; T-06-74). Reads the
 * cookie's quote, the email and the Turnstile token (`cf-turnstile-response`), and hands
 * them to the chokepoint, which rate-limits per IP, validates the address, verifies the
 * token server-side, saves and sends quote.saved. Copy: ERR-EMAIL and ERR-HUMAN come from
 * the chokepoint's InvalidInput; RATE-SAVE; anything else ERR-QUOTE. The address is never
 * logged.
 */
export async function saveQuoteAction(
  _prev: SaveQuoteState,
  formData: FormData,
): Promise<SaveQuoteState> {
  const email = field(formData, "email", EMAIL_MAX);
  const fail = (error: string): SaveQuoteState => ({
    status: "idle",
    email: null,
    error,
  });
  try {
    const token = await readQuoteCookie();
    if (!token) return fail(QUOTE_FAILED_COPY);
    const human = field(formData, "cf-turnstile-response", HUMAN_TOKEN_MAX);
    const quote = await saveQuoteEmail(token, email, human, await clientIp(), {
      registry: ADDON_REGISTRY,
    });
    return { status: "saved", email: quote.email || email, error: null };
  } catch (err) {
    if (err instanceof RateLimited) return fail(QUOTE_RATE_LIMITED_COPY);
    if (err instanceof InvalidInput) return fail(err.message);
    logFailure(err);
    return fail(QUOTE_FAILED_COPY);
  }
}

// ---------------------------------------------------------------- JS-off form (06-15)

const PATH_IDS = new Set<string>(["standard", "studio"]);
const LIST_MAX = 40;
const TEXT_MAX = 200;

function list(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((v): v is string => typeof v === "string")
    .slice(0, LIST_MAX);
}

/** The no-script form's fields as a chooseQuoteAction patch. */
function formChoice(formData: FormData): QuoteChoice {
  const patch: QuoteChoice = {};
  const path = field(formData, "path", TEXT_MAX);
  if (PATH_IDS.has(path)) patch.path = path as AddonPath;
  const type = field(formData, "businessType", TEXT_MAX);
  const other = field(formData, "businessTypeOther", TEXT_MAX);
  if (type === "other") {
    if (other !== "") {
      patch.businessType = "other";
      patch.businessTypeOther = other;
    }
  } else if (type !== "") {
    patch.businessType = type;
  }
  // Selections only when the form showed them, so an earlier step never wipes ticks.
  if (formData.get("hasSelections") === "1") {
    patch.selections = {
      addons: list(formData, "addons"),
      extras: list(formData, "extras"),
      carePlan: formData.get("carePlan") === "on",
      cadence: formData.get("cadence") === "yearly" ? "yearly" : "monthly",
    };
  }
  return patch;
}

/**
 * The JS-off configurator's submit (D-UI-P6-36): "Update my quote" posts here, the choice
 * goes through the same chooseQuoteAction path, and the page reloads with the stored quote.
 * A failure comes back as ?e=quote (ERR-QUOTE shown by the no-script form).
 */
export async function updateQuoteFormAction(formData: FormData): Promise<void> {
  const patch = formChoice(formData);
  const res =
    Object.keys(patch).length === 0
      ? { error: null }
      : await chooseQuoteAction(patch);
  redirect(res.error ? "/start?e=quote" : "/start");
}
