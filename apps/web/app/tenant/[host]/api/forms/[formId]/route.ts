// POST /api/forms/<formId> on tenant hosts: the public form endpoint (CONT-25, D231, D236;
// 07-19 choices 1-4; CONTEXT A3-Q2: a tenant route, not a Server Action).
//
// The site comes only from the middleware's tenant header via siteForRoute (unknown host =
// 404). Order: content type (415) -> Content-Length over 128 KB (413, before parsing) ->
// formData -> `_page` / `_item` read and removed -> payloadFromEntries (files dropped) ->
// submitForm(site, formId, payload, { ip: clientIp(), pageId }). `Accept: application/json`
// (FormEnhancer) gets JSON with a real status; anything else a 303 to a same-host path built by
// form-status.ts from this org's manifest (never from the request; RESEARCH line 931). Spam
// gets exactly the same response as a real send (Pitfall 8). Answers are never echoed and
// logs carry only the error class, never the payload or the IP. No GET export (405).
//
// Forms Pro uploads (BILL-14, D234; 10-38 choice 2): for a multipart send the body cap is
// 128 KB + 10 MB per file field that can take a file right now (formUploadSlots: Builder Pro,
// a real scanner, room under the org's 1 GB; otherwise 0 and the P7 128 KB cap holds). Files
// are passed to submitForm, which checks, scans and stores them; with no open slot they are
// dropped as in P7. A refused file comes back as a field error (JSON 422 or the no-JS codes).
//
// Save and finish later (BILL-14, D233; 10-40 choice 3): `_intent=save` + `_email` stores a
// draft through saveFormDraft (same form-submit rate limit and spam signals; spam answers
// like a save; files never saved) and answers JSON `{ ok: true }` or a 303 with `saved=1`.
// Not Pro / save off = FORM-ERROR, no draft. A `_resume` token on a successful send deletes
// that draft. Logs carry the form id or the error class only, never answers or tokens.
import { InvalidContext, InvalidInput, NotFound, RateLimited } from "@cds/core";
import { isEmail } from "@cds/core/email";
import { FormErrors, payloadFromEntries } from "@cds/core/forms";
import {
  EMAIL_ANSWER_COPY,
  FORM_ERROR_COPY,
  FORM_RATE_COPY,
  TOO_LONG_ANSWER_COPY,
} from "@cds/core/forms";
import {
  FORM_UPLOAD_MAX_BYTES,
  FormTooLarge,
  deleteFormDraft,
  formUploadSlots,
  reviewContextForToken,
  saveFormDraft,
  submitForm,
  type FormUploadFile,
} from "@cds/db";
import type { FieldErrorCode } from "@cds/ui/site";
import {
  FORM_ID_RE,
  ITEM_ID_RE,
  RESUME_TOKEN_RE,
  formReturnHref,
  formReturnPathFor,
  pagePathFor,
  type FormOutcome,
} from "../../../../../../lib/form-status";
import { readCappedFormData } from "../../../../../../lib/capped-body";
import { REVIEW_COOKIE, readCookie } from "../../../../../../lib/review-mode";
import { clientIp } from "../../../../../../lib/session";
import {
  getAddonSiteState,
  getManifest,
} from "../../../../../../lib/site-cache";
import { siteForRoute } from "../../../../../../lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 131072;
const NO_STORE = { "Cache-Control": "no-store" };

type Params = { params: Promise<{ host: string; formId: string }> };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, "Content-Type": "application/json" },
  });
}

function see(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE, Location: location },
  });
}

/** A server message -> the code that travels in the no-JS URL (never the message). */
function codeOf(message: string): FieldErrorCode {
  if (message.startsWith("Fill in ")) return "r";
  if (message === TOO_LONG_ANSWER_COPY) return "l";
  return "i";
}

/** 14-35 choice 5: a valid owner review cookie for this org on its preview host. */
async function reviewTest(
  req: Request,
  site: { orgId: string; hostKind: string },
): Promise<boolean> {
  if (site.hostKind !== "preview") return false;
  const token = readCookie(req, REVIEW_COOKIE);
  if (!token) return false;
  try {
    const ctx = await reviewContextForToken(token, { ip: await clientIp() });
    return ctx !== null && ctx.orgId === site.orgId;
  } catch {
    return false;
  }
}

function shaped(v: FormDataEntryValue | null, re: RegExp): string | null {
  return typeof v === "string" && re.test(v) ? v : null;
}

export async function POST(
  req: Request,
  { params }: Params,
): Promise<Response> {
  const { host, formId } = await params;
  const site = await siteForRoute(host);
  if (!site)
    return new Response("Not Found", { status: 404, headers: NO_STORE });

  const wantsJson = (req.headers.get("accept") ?? "").includes(
    "application/json",
  );
  let pageId: string | null = null;
  let itemId: string | null = null;
  let returnPath = "/";

  async function back(outcome: FormOutcome): Promise<Response> {
    return see(formReturnHref(returnPath, formId, itemId, outcome));
  }
  async function fail(status: number): Promise<Response> {
    return wantsJson
      ? json(status, { ok: false, message: FORM_ERROR_COPY })
      : back({ kind: "error" });
  }

  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const multipart = type.startsWith("multipart/form-data");
  if (!type.startsWith("application/x-www-form-urlencoded") && !multipart) {
    return fail(415);
  }
  // 10-38: file fields that can take a file raise the cap, decided before reading the body.
  let slots = 0;
  if (multipart) {
    try {
      slots = await formUploadSlots(site, formId);
    } catch {
      slots = 0;
    }
  }
  // WR-C05: the cap holds even with no Content-Length (chunked), before any parsing.
  let form: FormData | null;
  try {
    form = await readCappedFormData(
      req,
      MAX_BODY + slots * FORM_UPLOAD_MAX_BYTES,
    );
  } catch {
    return fail(400);
  }
  if (form === null) return fail(413);
  pageId = shaped(form.get("_page"), FORM_ID_RE);
  itemId = shaped(form.get("_item"), ITEM_ID_RE);
  form.delete("_page");
  form.delete("_item");
  // 10-40: the save intent, its email and a resume link's token never reach the answers.
  const saving = form.get("_intent") === "save";
  const saveEmail = form.get("_email");
  const resumeToken = shaped(form.get("_resume"), RESUME_TOKEN_RE);
  form.delete("_intent");
  form.delete("_email");
  form.delete("_resume");

  // WR-C02: a protected page re-gates the visitor, and the 404 page reads its status from
  // the middleware's query header, so both keep their no-JS confirmation.
  const known = site;
  async function hiddenPageIds(): Promise<string[]> {
    try {
      return (await getAddonSiteState(known)).hiddenPageIds;
    } catch {
      return [];
    }
  }
  if (pageId) {
    try {
      returnPath = formReturnPathFor(
        await getManifest(site),
        pageId,
        await hiddenPageIds(),
      );
    } catch {
      returnPath = "/";
    }
  }

  const entries: [string, string][] = [];
  const files: FormUploadFile[] = [];
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") entries.push([k, v]);
    else if (!saving && files.length < slots && v.size > 0) {
      files.push({
        field: k,
        name: v.name,
        type: v.type,
        bytes: new Uint8Array(await v.arrayBuffer()),
      });
    }
  }

  if (saving) {
    const email = typeof saveEmail === "string" ? saveEmail.trim() : "";
    try {
      const saved = await saveFormDraft(
        site,
        formId,
        {
          email,
          answers: payloadFromEntries(entries),
          ...(pageId ? { pageId } : {}),
        },
        { ip: await clientIp() },
      );
      if (saved.ok)
        return wantsJson ? json(200, { ok: true }) : back({ kind: "saved" });
      if (saved.reason === "invalid" && !isEmail(email)) {
        return wantsJson
          ? json(422, { ok: false, errors: { _email: EMAIL_ANSWER_COPY } })
          : back({ kind: "error" });
      }
      // Not on Builder Pro, save off, or answers over the cap: no draft (FORM-ERROR).
      return wantsJson
        ? json(422, { ok: false, message: FORM_ERROR_COPY })
        : back({ kind: "error" });
    } catch (err) {
      if (err instanceof RateLimited) {
        return wantsJson
          ? json(429, { ok: false, message: FORM_RATE_COPY })
          : back({ kind: "rate" });
      }
      if (
        err instanceof NotFound ||
        err instanceof InvalidInput ||
        err instanceof InvalidContext
      ) {
        return fail(404);
      }
      const name = err instanceof Error ? err.name : "unknown";
      console.error("[site] form save failed", name);
      return fail(500);
    }
  }

  try {
    const isTest = await reviewTest(req, site);
    const result = await submitForm(site, formId, payloadFromEntries(entries), {
      ip: await clientIp(),
      ...(pageId ? { pageId } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(isTest ? { isTest: true } : {}),
    });
    if (resumeToken) {
      // The answers are in; the "Finish your form" link has done its job.
      await deleteFormDraft(site, formId, resumeToken).catch(() => {
        console.error(`[site] form draft delete failed for form ${formId}`);
      });
    }
    const after = result.afterSubmit;
    if (after.kind === "page") {
      let href: string | null = null;
      try {
        href = pagePathFor(await getManifest(site), after.pageId, {
          allowProtected: true,
          hiddenPageIds: await hiddenPageIds(),
        });
      } catch {
        href = null;
      }
      if (href) {
        return wantsJson
          ? json(200, { ok: true, afterSubmit: { kind: "page", href } })
          : see(href);
      }
    }
    const message = after.kind === "message" ? after.message : null;
    if (wantsJson) {
      return json(200, {
        ok: true,
        afterSubmit: { kind: "message", ...(message ? { message } : {}) },
      });
    }
    return back({ kind: "sent" });
  } catch (err) {
    if (err instanceof FormErrors) {
      if (wantsJson) {
        return json(422, {
          ok: false,
          summary: err.message,
          errors: err.errors,
        });
      }
      const fields: Record<string, FieldErrorCode> = {};
      for (const id of Object.keys(err.errors)) {
        fields[id] = codeOf(err.errors[id] ?? "");
      }
      return back({ kind: "fields", fields });
    }
    if (err instanceof RateLimited) {
      return wantsJson
        ? json(429, { ok: false, message: FORM_RATE_COPY })
        : back({ kind: "rate" });
    }
    if (err instanceof FormTooLarge) return fail(413);
    if (
      err instanceof NotFound ||
      err instanceof InvalidInput ||
      err instanceof InvalidContext
    ) {
      return fail(404);
    }
    const name = err instanceof Error ? err.name : "unknown";
    console.error("[site] form submit failed", name);
    return fail(500);
  }
}
