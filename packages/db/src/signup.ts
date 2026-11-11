// Submit and member sign-in with an emailed code (ONB-08, ONB-12, ONB-01; D213, D215, D286;
// CONTEXT A1-Q4, A1-Q5; RESEARCH Pattern 2, Pitfall 4; T-06-34..T-06-38).
//
// Submit is two steps:
//   A. startSubmit: rate limit (per IP, per email) -> validate -> human check (Turnstile,
//      A-WR-02) -> refuse an address CDS's suppression list blocks (PB sends the code mail
//      itself, outside the D138 pipeline) -> write the name, sentence and email onto the
//      quote -> create a pending users row (random unusable password, verified=false) only
//      when none exists -> PB requestOTP through the app-key guest client. The reply is the
//      same shape for new and existing addresses (T-06-35).
//   B. completeSubmit: beginSignIn("otp") -> authWithOTP (PB marks the user verified) ->
//      refuse staff -> D286 (an owner gets no second owned org; the quote stays a lead) ->
//      FitChecker -> blocked (no org; quote blocked + category; the pending user row step A
//      made is deleted, B-WR-04) or ONE PB batch: org, owner
//      membership, business_profile, org_intake, confirmed default org_email_routes row,
//      quote submitted + merged_org, audit rows. The PB auth token goes to setSessionCookie.
//      An address with an earlier blocked quote is held at fit_review, never cleared.
// The member code pair (/sign-in) is the same OTP exchange but NEVER creates a user: for an
// unknown address PB answers with a decoy otpId that never verifies, and for a suppressed
// address with no user no mail is requested and a decoy id is returned the same way
// (A-WR-02). An existing user on the suppression list still gets the code they asked for
// (R2-WR-02: a sign-in code is not a cold send), and it is logged. The tarotafterdark
// donor hook that creates a user on every OTP request is not ported.
//
// PD-2: the Submit sentence is stored as business_profile.description.
// PD-3: submitted quotes stay linked by merged_org; existing-owner quotes keep their status.
// Codes, tokens and passwords are never logged. Every PB guest client is cleared in finally.
import { randomBytes } from "node:crypto";
import { CdsError, InvalidInput } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import { normaliseEmail } from "@cds/core/email";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { previewHostFor } from "./assembly/preview-host";
import { appendAudit, auditBody } from "./audit";
import { guestClient, withSuperuser } from "./client";
import { mintSystemContext } from "./context";
import { canSend } from "./email/suppressions";
import { getFitChecker, type FitChecker } from "./fit";
import { getHumanCheck, type HumanCheck } from "./human-check";
import { ERR_HUMAN, readQuoteByToken, type QuoteView } from "./quotes";
import { beginCodeRequest, beginSignIn } from "./rate-limit";
import { newRecordId } from "./repository";

// ---------------------------------------------------------------- errors (UI-SPEC copy)

/** UI-SPEC ERR-CODE. */
export const ERR_CODE =
  "That code didn't match. Check the six digits and try again, or request a new one.";
/** UI-SPEC ERR-CODE-EXPIRED. */
export const ERR_CODE_EXPIRED =
  "That code has expired. Codes last 5 minutes. Request a new one.";
/** UI-SPEC ERR-CREATE. */
export const ERR_CREATE =
  "We couldn't create your account just now. Your quote is saved. Try again in a minute.";

/** The code was wrong, or the account may not use this flow (one generic answer). */
export class SubmitCodeInvalid extends CdsError {
  override readonly code = "submit_code_invalid";
  constructor(message: string = ERR_CODE) {
    super(message);
  }
}

/** The code was right-shaped but PB's 5-minute window has passed. */
export class SubmitCodeExpired extends CdsError {
  override readonly code = "submit_code_expired";
  constructor(message: string = ERR_CODE_EXPIRED) {
    super(message);
  }
}

/** Account or org creation failed for a reason the visitor cannot fix; the quote is kept. */
export class SubmitFailed extends CdsError {
  override readonly code = "submit_failed";
  constructor(message: string = ERR_CREATE) {
    super(message);
  }
}

// ---------------------------------------------------------------- types

export type SubmitStartInput = {
  quoteToken: string;
  businessName: string;
  description: string;
  email: string;
  ip: string;
  /** The Turnstile token (`cf-turnstile-response`); a missing one fails the real check. */
  humanToken?: string;
};

/** The address is on CDS's suppression list (it bounced or complained before). */
export const SUBMIT_SUPPRESSED_COPY =
  "Emails to this address bounced before. Check the spelling, or use another address.";

export type SubmitOutcome =
  | {
      outcome: "created";
      token: string;
      orgId: string;
      stage: "intake" | "fit_review";
    }
  | { outcome: "blocked"; category: string }
  | { outcome: "existing_owner"; token: string; orgId: string };

export type SubmitDeps = { registry: AddonRegistry; fitChecker?: FitChecker };

const NAME_MAX = 120;
const DESCRIPTION_MAX = 200;
const SLUG_MAX = 40;
const SLUG_TRIES = 50;
const MERGE_TRIES = 3;
const OTP_TTL_MS = 300 * 1000;
const ID_RE = /^[a-z0-9]{1,64}$/i;

// ---------------------------------------------------------------- helpers

// A-WR-10: the name and sentence are one line of plain text; control characters (ESC and
// friends) could rewrite a staff member's terminal in fit:review / leads:list.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function text(v: unknown, max: number, what: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < 1 || s.length > max || CONTROL_RE.test(s)) {
    throw new InvalidInput(`${what} (1 to ${max} characters)`);
  }
  return s;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function requireString(v: unknown): string {
  if (typeof v !== "string" || v === "") throw new SubmitCodeInvalid();
  return v;
}

/** A quote Submit may use: draft or saved, not expired, with a path. */
async function submittableQuote(token: unknown): Promise<QuoteView> {
  if (typeof token !== "string") throw new InvalidInput(ERR_CREATE);
  const q = await readQuoteByToken(token);
  if (!q || (q.status !== "draft" && q.status !== "saved") || q.path === "") {
    throw new InvalidInput(ERR_CREATE);
  }
  return q;
}

async function findUser(email: string): Promise<RecordModel | null> {
  return withSuperuser(async (pb) => {
    const list = await pb.collection("users").getList(1, 1, {
      filter: pb.filter("email = {:e}", { e: email }),
      fields: "id,email,staff_role",
    });
    return list.items[0] ?? null;
  });
}

/** False when CDS's suppression list blocks transactional mail (a code) to this address. */
async function codeDeliverable(email: string): Promise<boolean> {
  return canSend(
    { kind: "cds", ctx: mintSystemContext({ job: "signup" }) },
    email,
    "transactional",
  );
}

/** Create the pending user unless one exists (a concurrent create is fine). */
async function ensurePendingUser(email: string): Promise<void> {
  if (await findUser(email)) return;
  const password = randomBytes(24).toString("hex"); // discarded: never usable
  try {
    await withSuperuser((pb) =>
      pb.collection("users").create({
        email,
        password,
        passwordConfirm: password,
        verified: false,
        emailVisibility: false,
        // A-WR-04: the orphan purge deletes only rows still marked pending.
        pending_signup: true,
      }),
    );
  } catch (err) {
    if (await findUser(email)) return; // lost a race: the row exists now
    console.error(
      `[signup] pending user create failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw new SubmitFailed();
  }
}

/** PB request-otp through the app-key guest client (the one allowed literal form). */
async function requestCode(email: string): Promise<string> {
  const pb = guestClient();
  try {
    const { otpId } = await pb.collection("users").requestOTP(email);
    if (typeof otpId !== "string" || otpId === "") throw new SubmitFailed();
    return otpId;
  } catch (err) {
    if (err instanceof CdsError) throw err;
    console.error(
      `[signup] request-otp failed: ${err instanceof ClientResponseError ? err.status : "error"}`,
    );
    throw new SubmitFailed();
  } finally {
    pb.authStore.clear();
  }
}

/** Why a failed code failed: expired when PB still holds an OTP row past its 5 minutes. */
async function failedCodeError(otpId: string): Promise<CdsError> {
  if (!ID_RE.test(otpId)) return new SubmitCodeInvalid();
  try {
    const row = await withSuperuser((pb) =>
      pb.collection("_otps").getOne(otpId, { fields: "id,created" }),
    );
    const created = new Date(String(row.created ?? "").replace(" ", "T"));
    if (
      !Number.isNaN(created.getTime()) &&
      Date.now() - created.getTime() > OTP_TTL_MS
    ) {
      return new SubmitCodeExpired();
    }
  } catch {
    // No row (decoy id, used or cleaned up) or not readable: the generic answer.
  }
  return new SubmitCodeInvalid();
}

/**
 * Verify an emailed code. Staff accounts are refused with the generic error (their PB MFA
 * rule makes a code alone a 401, and a staff_role on the record is refused too).
 */
async function verifyCode(
  otpId: string,
  code: string,
  ip: string,
): Promise<{ token: string; record: RecordModel; wasPending: boolean }> {
  const attempt = beginSignIn("otp", ip, otpId);
  const pb = guestClient();
  let token: string;
  let record: RecordModel;
  try {
    const res = await pb.collection("users").authWithOTP(otpId, code);
    token = res.token;
    record = res.record;
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 400) {
      throw await failedCodeError(otpId);
    }
    throw new SubmitCodeInvalid();
  } finally {
    pb.authStore.clear();
  }
  if (!token || record.staff_role) throw new SubmitCodeInvalid();
  attempt.succeeded();
  // The code proves the address. PB 0.39 does not flip `verified` on an OTP sign-in by
  // itself, so do it here, and clear the pending-signup mark the orphan purge keys on.
  const wasPending = record.pending_signup === true;
  if (record.verified !== true || wasPending) {
    await withSuperuser((su) =>
      su
        .collection("users")
        .update(record.id, { verified: true, pending_signup: false }),
    );
  }
  return { token, record, wasPending };
}

/**
 * B-WR-04: a blocked Submit must not leave an account behind. The user row Submit step A
 * created (still pending when the code was checked) is deleted when it has no membership.
 * If the delete fails it goes back to pending + unverified, so the orphan purge takes it.
 * Accounts that existed before this Submit are never touched.
 */
async function releaseBlockedUser(
  userId: string,
  wasPending: boolean,
): Promise<void> {
  if (!wasPending) return;
  try {
    await withSuperuser(async (pb) => {
      const members = await pb.collection("memberships").getList(1, 1, {
        filter: pb.filter("user = {:u}", { u: userId }),
        fields: "id",
      });
      if (members.totalItems > 0) return;
      await pb.collection("users").delete(userId);
    });
  } catch (err) {
    console.error(
      `[signup] blocked user release failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    await withSuperuser((pb) =>
      pb
        .collection("users")
        .update(userId, { verified: false, pending_signup: true }),
    ).catch(() => {});
  }
}

/** The category of an earlier blocked Submit from this address, or null (B-WR-04). */
async function priorBlockedCategory(
  email: string,
  quoteId: string,
): Promise<string | null> {
  return withSuperuser(async (pb) => {
    const list = await pb.collection("quotes").getList(1, 1, {
      filter: pb.filter("status = 'blocked' && email = {:e} && id != {:id}", {
        e: email,
        id: quoteId,
      }),
      sort: "-updated,-id",
      fields: "fit_category",
    });
    const hit = list.items[0];
    return hit ? str(hit.fit_category) : null;
  });
}

/** The fit.hold reason for a retry after a blocked Submit (staff see it in fit:review). */
export function priorBlockedReason(category: string): string {
  return category
    ? `an earlier Submit from this email was blocked: ${category}`
    : "an earlier Submit from this email was blocked";
}

async function ownedOrg(userId: string): Promise<string | null> {
  return withSuperuser(async (pb) => {
    const list = await pb.collection("memberships").getList(1, 1, {
      filter: pb.filter("user = {:u} && role = 'owner'", { u: userId }),
      fields: "organization",
    });
    const org = list.items[0]?.organization;
    return typeof org === "string" && org !== "" ? org : null;
  });
}

function slugBase(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return s || "site";
}

/**
 * The name's slug, suffixed -2, -3 ... until free (unique indexes are the final guard).
 * Since 14-15 (DOM-01) a slug is free only when its preview host is free too, so the
 * signup batch's org_hosts row does not collide on every retry.
 */
async function freeSlug(name: string): Promise<string> {
  const base = slugBase(name);
  return withSuperuser(async (pb) => {
    for (let i = 1; i <= SLUG_TRIES; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      const hit = await pb.collection("organizations").getList(1, 1, {
        filter: pb.filter("slug = {:s}", { s: candidate }),
        fields: "id",
      });
      if (hit.totalItems > 0) continue;
      const host = await pb.collection("org_hosts").getList(1, 1, {
        filter: pb.filter("hostname = {:h}", { h: previewHostFor(candidate) }),
        fields: "id",
      });
      if (host.totalItems === 0) return candidate;
    }
    return `${base}-${randomBytes(3).toString("hex")}`;
  });
}

/** Keep only add-on slugs the registry offers (the quote was cleaned already; belt and braces). */
function intakeSelections(
  registry: AddonRegistry,
  q: QuoteView,
): QuoteView["selections"] {
  const known = new Set(registry.list().map((a) => a.slug));
  return {
    ...q.selections,
    addons: q.selections.addons.filter((s) => known.has(s)),
  };
}

// ---------------------------------------------------------------- Submit

/** Submit step A: send a code to the address. Same answer for new and existing accounts. */
export async function startSubmit(
  input: SubmitStartInput,
  deps: { humanCheck?: HumanCheck } = {},
): Promise<{ otpId: string; email: string }> {
  const email = normaliseEmail(input?.email); // InvalidInput(ERR_EMAIL)
  beginCodeRequest(input.ip, email);
  const businessName = text(input.businessName, NAME_MAX, "Business name");
  const description = text(
    input.description,
    DESCRIPTION_MAX,
    "Describe the business in one sentence",
  );
  // A-WR-02: every call creates a users row and sends a code, so a person must ask.
  const human = deps.humanCheck ?? getHumanCheck();
  if (!(await human.verify(str(input.humanToken), input.ip))) {
    throw new InvalidInput(ERR_HUMAN);
  }
  if (!(await codeDeliverable(email))) {
    throw new InvalidInput(SUBMIT_SUPPRESSED_COPY);
  }
  const q = await submittableQuote(input.quoteToken);
  await withSuperuser((pb) =>
    pb.collection("quotes").update(q.id, {
      business_name: businessName,
      description,
      email,
    }),
  );
  await ensurePendingUser(email);
  const otpId = await requestCode(email);
  return { otpId, email };
}

/** Submit step B: verify the code, check fit, then create the org in one batch. */
export async function completeSubmit(
  input: { quoteToken: string; otpId: string; code: string; ip: string },
  deps: SubmitDeps,
): Promise<SubmitOutcome> {
  const otpId = requireString(input?.otpId);
  const code = requireString(input?.code);
  // Check the quote first so a refused quote never burns the visitor's code.
  const quote = await submittableQuote(input.quoteToken);
  const { token, record, wasPending } = await verifyCode(otpId, code, input.ip);

  // The code proves this address; it must be the address step A wrote on the quote.
  if (String(record.email ?? "").toLowerCase() !== quote.email.toLowerCase()) {
    throw new SubmitCodeInvalid();
  }

  // D286: an owner gets no second owned org. They are signed in; the quote stays a lead.
  const existing = await ownedOrg(record.id);
  if (existing) return { outcome: "existing_owner", token, orgId: existing };

  const checker = deps.fitChecker ?? getFitChecker();
  const screened = await checker.check({
    businessType: quote.businessType,
    businessTypeOther: quote.businessTypeOther,
    name: quote.businessName,
    description: quote.description,
  });
  // B-WR-04: rewording after a blocked Submit is not a way round it. The same address
  // trying again is held for staff instead of cleared.
  let fit = screened;
  if (screened.verdict !== "blocked") {
    const prior = await priorBlockedCategory(quote.email, quote.id);
    if (prior !== null) {
      fit = {
        verdict: "review",
        category: screened.category ?? prior,
        reasons: [...screened.reasons, priorBlockedReason(prior)],
      };
    }
  }

  const system = mintSystemContext({ job: "signup" });
  if (fit.verdict === "blocked") {
    const category = fit.category ?? "";
    await withSuperuser((pb) =>
      pb
        .collection("quotes")
        .update(quote.id, { status: "blocked", fit_category: category }),
    );
    await appendAudit(system, {
      action: "signup.blocked",
      organization: null,
      targetCollection: "quotes",
      targetId: quote.id,
      meta: { user: record.id, category },
    });
    await releaseBlockedUser(record.id, wasPending);
    return { outcome: "blocked", category };
  }

  const stage: "intake" | "fit_review" =
    fit.verdict === "review" ? "fit_review" : "intake";
  const selections = intakeSelections(deps.registry, quote);

  for (let attempt = 1; attempt <= MERGE_TRIES; attempt++) {
    const orgId = newRecordId();
    const slug = await freeSlug(quote.businessName);
    const now = new Date().toISOString();
    try {
      await withSuperuser(async (pb) => {
        const batch = pb.createBatch();
        batch.collection("organizations").create({
          id: orgId,
          name: quote.businessName,
          slug,
          status: "active",
          path: quote.path,
          stage,
        });
        batch.collection("memberships").create({
          user: record.id,
          organization: orgId,
          role: "owner",
        });
        batch.collection("business_profile").create({
          organization: orgId,
          business_type: quote.businessType,
          business_type_other: quote.businessTypeOther,
          description: quote.description,
          public_email: quote.email,
        });
        batch.collection("org_intake").create({
          organization: orgId,
          selections,
        });
        batch.collection("org_email_routes").create({
          organization: orgId,
          purpose: "default",
          address: quote.email,
          confirmed_at: now,
        });
        batch.collection("quotes").update(quote.id, {
          status: "submitted",
          merged_org: orgId,
        });
        // DOM-01 (14-15): the preview host exists from the org's first second, in the
        // same batch, so no org is ever hostless (T-14-15-02).
        batch.collection("org_hosts").create({
          hostname: previewHostFor(slug),
          organization: orgId,
          kind: "preview",
          primary: true,
        });
        batch.collection("audit_log").create(
          auditBody(system, {
            action: "signup.submit",
            organization: orgId,
            targetCollection: "organizations",
            targetId: orgId,
            meta: { user: record.id, quote: quote.id, stage },
          }),
        );
        if (stage === "fit_review") {
          batch.collection("audit_log").create(
            auditBody(system, {
              action: "fit.hold",
              organization: orgId,
              targetCollection: "organizations",
              targetId: orgId,
              meta: { reasons: fit.reasons, category: fit.category ?? "" },
            }),
          );
        }
        await batch.send();
      });
      return { outcome: "created", token, orgId, stage };
    } catch (err) {
      // A concurrent Submit may have made this user an owner (one-owner index): D286.
      const raced = await ownedOrg(record.id);
      if (raced) return { outcome: "existing_owner", token, orgId: raced };
      if (attempt === MERGE_TRIES) {
        console.error(
          `[signup] merge failed for quote ${quote.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new SubmitFailed();
      }
      // Otherwise most likely a slug race: pick again.
    }
  }
  throw new SubmitFailed();
}

// ---------------------------------------------------------------- member code sign-in

/** Send a sign-in code. Never creates a user: an unknown address gets PB's decoy otpId. */
export async function requestMemberCode(
  email: string,
  ip: string,
): Promise<{ otpId: string }> {
  const address = normaliseEmail(email);
  beginCodeRequest(ip, address);
  // R2-WR-02: suppression blocks cold and marketing mail, not a sign-in code the account
  // holder asked for. A suppressed address with no user gets the decoy id (it reads like
  // PB's for an unknown address, so nothing is disclosed). An existing user still gets the
  // code: one bounce (a full mailbox) must never lock an owner out of the hub for good,
  // since code sign-in is the only way in. The attempt is logged for staff, without the
  // address.
  if (!(await codeDeliverable(address))) {
    if (!(await findUser(address))) return { otpId: newRecordId() };
    console.warn(
      "[signup] member code requested for a suppressed address; sent anyway (existing user)",
    );
  }
  return { otpId: await requestCode(address) };
}

/** Exchange a sign-in code for a session token (members only; staff use the MFA flow). */
export async function completeMemberCode(input: {
  otpId: string;
  code: string;
  ip: string;
}): Promise<{ token: string }> {
  const otpId = requireString(input?.otpId);
  const code = requireString(input?.code);
  const { token } = await verifyCode(otpId, code, input.ip);
  return { token };
}
