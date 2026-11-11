// Forms Pro "save and finish later" (BILL-14, D233; 10-37; invariant 1; T-10-37-01..04).
//
// A visitor on the tenant host saves a partly filled Pro form; we store the answers in one
// `form_drafts` row and email a resume link. Choices (10-37 SUMMARY):
//   1. Token: 32 random bytes, base64url, only in the emailed link. The row stores its sha256
//      hex (`token_hash`, unique); lookups are by hash, scoped to the site's org and the form.
//      One draft per (form, email): saving again replaces it (and kills the old link). A
//      unique index enforces it; saves for one (form, email) run one at a time (WR-A05).
//   2. Answers are checked with validateSubmission's per-field rules in a non-required mode;
//      an invalid answer is dropped (a half-typed field never blocks a save). File and hidden
//      fields are never saved. Over 64 KB = refused.
//   3. Drafts expire after FORM_DRAFT_TTL_DAYS (30); an expired draft resumes as null and is
//      deleted; the daily retention job purges the rest (purgeExpiredFormDrafts).
//   4. Link = the page the form is on (the org's primary site URL + the page path) with
//      `?resume=<token>#form-<id>`.
// Works only while the org holds Builder Pro and the form has save_resume on; otherwise the
// save is refused ("not_pro") and resume reads null (the form behaves as free). The form-submit
// rate limit and spam signals apply to saves; spam is answered like a success, nothing stored.
// Internal: not exported from the forms barrel (10-40 wires the site routes).
import { createHash, randomBytes } from "node:crypto";
import { isEmail, normaliseEmail } from "@cds/core/email";
import {
  FORM_DRAFT_TTL_DAYS,
  FormErrors,
  MAX_PAYLOAD_BYTES,
  spamInputOf,
  spamSignals,
  validateSubmission,
  type FormField,
} from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { HOME_SLUG } from "../content/pages";
import { siteUrls } from "../content/shared";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { assertSystemContext, type SystemContext } from "../context";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { takeFormSubmit } from "../rate-limit";
import { assertId, mapError } from "../repository";
import { formsProActive, loadFormForSubmit } from "./public";
import { formFromRow, systemCtx } from "./shared";

export const FORM_DRAFTS = "form_drafts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 200;
const PAGE_ID = /^[a-z0-9]{1,64}$/i;
/** base64url of 32 bytes is 43 characters; accept nothing else. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type SaveDraftInput = {
  email: string;
  answers: unknown;
  /** The page the form is on (for the resume link); home when absent or foreign. */
  pageId?: string;
};

export type SaveDraftMeta = { ip: string; now?: Date };

export type SaveDraftResult =
  { ok: true } | { ok: false; reason: "not_pro" | "invalid" };

export type ResumedDraft = {
  answers: Record<string, unknown>;
  email: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function bytesOf(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v ?? {})).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function expiryLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Answers worth keeping: per-field shape checks, nothing required, bad answers dropped. */
function draftAnswers(
  fields: readonly FormField[],
  answers: unknown,
): Record<string, unknown> {
  let keep: FormField[] = fields
    .filter((f) => f.type !== "file" && f.type !== "hidden")
    .map((f) => ({ ...f, required: false }));
  for (let i = 0; i < 2; i += 1) {
    try {
      return { ...validateSubmission(keep, answers).data };
    } catch (err) {
      if (!(err instanceof FormErrors)) throw err;
      const bad = new Set(Object.keys(err.errors));
      keep = keep.filter((f) => !bad.has(f.id));
    }
  }
  return {};
}

async function resumeLink(
  pb: PocketBase,
  site: SiteContext,
  formId: string,
  pageId: string | undefined,
  token: string,
): Promise<string> {
  const origin =
    (await siteUrls(pb, site.orgId))[0] ??
    `https://${site.primaryHost ?? site.host}/`;
  let path = "/";
  if (typeof pageId === "string" && PAGE_ID.test(pageId)) {
    const page = await pb
      .collection("pages")
      .getFirstListItem(
        // 11-29: a page in Recently deleted links to the home page instead.
        pb.filter("id = {:id} && organization = {:org} && deleted_at = ''", {
          id: pageId,
          org: site.orgId,
        }),
        { fields: "id,slug" },
      )
      .catch(() => null);
    const slug = typeof page?.slug === "string" ? page.slug : "";
    if (slug !== "" && slug !== HOME_SLUG) path = `/${slug}`;
  }
  const url = new URL(path, origin);
  url.searchParams.set("resume", token);
  url.hash = `form-${formId}`;
  return url.toString();
}

function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/**
 * Save (or replace) the visitor's draft and email the resume link. Foreign, unknown or held
 * forms throw NotFound (as submitForm); a full rate-limit bucket throws RateLimited.
 */
export async function saveFormDraft(
  site: SiteContext,
  formId: string,
  input: SaveDraftInput,
  meta: SaveDraftMeta,
  deps: { transport?: EmailTransport } = {},
): Promise<SaveDraftResult> {
  assertSiteContext(site);
  assertId(formId);
  const orgId = site.orgId;
  const now = meta.now ?? new Date();
  const ip = typeof meta.ip === "string" ? meta.ip.slice(0, 64) : "";
  if (bytesOf(input?.answers) > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "invalid" };
  }

  const loaded = await mapped(
    withSuperuser(async (pb) => {
      const row = await loadFormForSubmit(pb, orgId, formId);
      const proActive = await formsProActive(pb, orgId);
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "name" });
      return { row, proActive, orgName: String(org.name ?? "") };
    }),
  );
  const def = formFromRow(loaded.row);
  if (!loaded.proActive || def.pro?.save_resume !== true) {
    return { ok: false, reason: "not_pro" };
  }
  if (!isEmail(input?.email)) return { ok: false, reason: "invalid" };
  const email = normaliseEmail(input.email);

  const slot = takeFormSubmit(orgId, formId, ip);
  if (spamSignals({ ...spamInputOf(input.answers), now }).length > 0) {
    // WR-A03 as on submit: spam keeps its per-IP slot, never the form-wide one.
    slot.releaseForm();
    return { ok: true };
  }
  const data = draftAnswers(def.fields, input.answers);
  if (bytesOf(data) > MAX_PAYLOAD_BYTES) {
    slot.release();
    return { ok: false, reason: "invalid" };
  }

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + FORM_DRAFT_TTL_DAYS * DAY_MS);
  // WR-A05: one live draft per (form, email). Same-process saves queue on the lock; a save
  // from another process trips the unique index, and one retry replaces its draft.
  const replace = () =>
    withSuperuser(async (pb) => {
      const old = await pb.collection(FORM_DRAFTS).getFullList({
        filter: pb.filter(
          "organization = {:org} && form = {:form} && email = {:email}",
          { org: orgId, form: formId, email },
        ),
        fields: "id",
      });
      const batch = pb.createBatch();
      for (const r of old) batch.collection(FORM_DRAFTS).delete(r.id);
      batch.collection(FORM_DRAFTS).create({
        organization: orgId,
        form: formId,
        email,
        data,
        token_hash: hashToken(token),
        expires_at: expires.toISOString(),
      });
      await batch.send();
      return resumeLink(pb, site, formId, input.pageId, token);
    });
  const link = await mapped(
    withOrgLock(`form-draft:${formId}:${email}`, () =>
      replace().catch((err: unknown) => {
        if (err instanceof ClientResponseError && err.status === 400) {
          return replace();
        }
        throw err;
      }),
    ),
  );

  try {
    await sendEmail(
      { kind: "org", ctx: systemCtx("form.draft"), orgId },
      "form.resume_link",
      email,
      {
        orgName: loaded.orgName,
        formName: def.name,
        link,
        expires: expiryLabel(expires),
      },
      { transport: deps.transport },
    );
  } catch {
    // The draft is useless without its link: remove it and log by form id only.
    console.error(`[forms] resume link failed for form ${formId}`);
    await withSuperuser((pb) =>
      pb
        .collection(FORM_DRAFTS)
        .getFirstListItem(
          pb.filter("token_hash = {:h}", { h: hashToken(token) }),
          { fields: "id" },
        )
        .then((r) => pb.collection(FORM_DRAFTS).delete(r.id)),
    ).catch(() => undefined);
    throw new Error("resume link could not be sent");
  }
  return { ok: true };
}

async function findDraft(
  pb: PocketBase,
  site: SiteContext,
  formId: string,
  token: unknown,
): Promise<RecordModel | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  return pb
    .collection(FORM_DRAFTS)
    .getFirstListItem(
      pb.filter(
        "organization = {:org} && form = {:form} && token_hash = {:h}",
        { org: site.orgId, form: formId, h: hashToken(token) },
      ),
    )
    .catch((err: unknown) => {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    });
}

/** The saved answers for this link, or null (wrong, foreign, expired, or no longer Pro). */
export async function resumeFormDraft(
  site: SiteContext,
  formId: string,
  token: string,
  opts: { now?: Date } = {},
): Promise<ResumedDraft | null> {
  assertSiteContext(site);
  assertId(formId);
  const now = opts.now ?? new Date();
  return mapped(
    withSuperuser(async (pb) => {
      const row = await findDraft(pb, site, formId, token);
      if (!row) return null;
      const expires = new Date(String(row.expires_at ?? ""));
      if (!(expires.getTime() > now.getTime())) {
        await pb.collection(FORM_DRAFTS).delete(row.id);
        return null;
      }
      if (!(await formsProActive(pb, site.orgId))) return null;
      const data = row.data;
      return {
        answers:
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : {},
        email: String(row.email ?? ""),
      };
    }),
  );
}

/** Delete the draft behind this link (after a successful submit). True when one was removed. */
export async function deleteFormDraft(
  site: SiteContext,
  formId: string,
  token: string,
): Promise<boolean> {
  assertSiteContext(site);
  assertId(formId);
  return mapped(
    withSuperuser(async (pb) => {
      const row = await findDraft(pb, site, formId, token);
      if (!row) return false;
      await pb.collection(FORM_DRAFTS).delete(row.id);
      return true;
    }),
  );
}

/** Daily retention step: delete drafts past expires_at (dryRun counts only). */
export async function purgeExpiredFormDrafts(
  sys: SystemContext,
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<number> {
  assertSystemContext(sys);
  const now = opts.now ?? new Date();
  return withSuperuser(async (pb) => {
    const filter = pb.filter("expires_at <= {:now}", { now });
    if (opts.dryRun) {
      return (await pb.collection(FORM_DRAFTS).getList(1, 1, { filter }))
        .totalItems;
    }
    let deleted = 0;
    for (;;) {
      const page = await pb
        .collection(FORM_DRAFTS)
        .getList(1, PAGE, { filter, fields: "id", skipTotal: true });
      if (page.items.length === 0) break;
      for (const r of page.items) {
        await pb.collection(FORM_DRAFTS).delete(r.id);
        deleted += 1;
      }
      if (page.items.length < PAGE) break;
    }
    return deleted;
  });
}
