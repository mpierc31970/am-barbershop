// submitForm: the one SiteContext write (CONT-25, D231, D236, D271, D132; RESEARCH Pattern 5,
// Pitfall 8; invariant 1; T-07-15-02..06, T-07-15-09; 07-15).
//
// Order (choice 6): total size (64 KB) -> assert site and id -> load the form (org-scoped;
// soft-deleted allowed, resolution f; held refused) -> both rate-limit slots (refused =
// RateLimited FORM-RATE, nothing stored) -> validate answers (FormErrors gives the slots back)
// -> spam signals -> one batch (submission + audit form.submitted) -> non-spam only: contact
// touch, link the contact, notification. Spam is stored flagged and answered like a success;
// it never touches Contacts and never sends mail (Pitfall 8). Contact and email failures are
// caught and logged without addresses: the message is already saved.
//
// No org lock here: touchContact takes withOrgLock itself and the lock is not re-entrant
// (07-11 rule).
//
// Forms Pro (BILL-14, D233; 10-36): `proActive` = builder-pro in the org's entitlement set at
// submit time (choice 1). While active the server re-applies the show/hide rules (a hidden
// field is never required and its answer is dropped), routes the notification by answer and
// sends the submitter the auto-reply after the message is stored (choice 2; never for spam,
// choice 3). Inactive (never bought or lapsed): the form submits as a free form and the stored
// Pro settings are left untouched (invariant 9).
//
// File uploads (BILL-14, D234; 10-38): `meta.files` (from the route's multipart parse) go
// through storeFormFiles after validation and the spam check: checked, scanned, stored
// privately under the new submission id, then written into `data` as file answers. Spam
// never stores a file. If the submission batch fails, the stored files are removed.
import { InvalidInput } from "@cds/core";
import {
  FORM_ERROR_COPY,
  FormErrors,
  MAX_PAYLOAD_BYTES,
  answersForDisplay,
  autoReplyFor,
  routeForAnswers,
  spamInputOf,
  spamSignals,
  validateSubmission,
  type FormAnswer,
} from "@cds/core/forms";
import { ClientResponseError } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { touchContact } from "../contacts/touch";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { mintSystemContext } from "../context";
import type { EmailTransport } from "../email/transport";
import { recordTestFormSubmission } from "../launch-review/marks";
import { takeAutoReply, takeFormSubmit } from "../rate-limit";
import { assertId, mapError, newRecordId } from "../repository";
import { getObjectStore } from "../storage";
import { sendAutoReply, sendSubmissionNotice } from "./notify";
import { formsProActive, loadFormForSubmit } from "./public";
import { SUBMISSIONS, formFromRow, systemCtx } from "./shared";
import {
  deleteFormFiles,
  storeFormFiles,
  type FormUploadFile,
  type UploadDeps,
} from "./uploads";

/** The whole payload is over 64 KB (the route answers 413). */
export class FormTooLarge extends InvalidInput {
  override readonly code: string = "form_too_large";
}

export type SubmitResult = {
  id: string;
  afterSubmit:
    { kind: "message"; message: string } | { kind: "page"; pageId: string };
};

export type SubmitMeta = {
  ip: string;
  pageId?: string;
  now?: Date;
  /** 10-38: files from a multipart send (Forms Pro file fields only). */
  files?: readonly FormUploadFile[];
  /**
   * 14-35 (P14-P26, P14-P40): sent under a valid owner review cookie on the preview host (the
   * route checks it). Stored as `is_test`, shown with a "Test" badge in Inbox, and ticks the
   * launch review's test-form item. Never hidden, still counted.
   */
  isTest?: boolean;
};

const PAGE_ID = /^[a-z0-9]{1,64}$/i;

function payloadBytes(payload: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(payload ?? {})).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export async function submitForm(
  site: SiteContext,
  formId: string,
  payload: unknown,
  meta: SubmitMeta,
  deps: { transport?: EmailTransport } & UploadDeps = {},
): Promise<SubmitResult> {
  if (payloadBytes(payload) > MAX_PAYLOAD_BYTES) {
    throw new FormTooLarge(FORM_ERROR_COPY);
  }
  assertSiteContext(site);
  assertId(formId);
  const orgId = site.orgId;
  const now = meta.now ?? new Date();
  const ip = typeof meta.ip === "string" ? meta.ip.slice(0, 64) : "";

  const loaded = await withSuperuser(async (pb) => {
    const row = await loadFormForSubmit(pb, orgId, formId);
    let pageId = "";
    let pageTitle: string | null = null;
    if (typeof meta.pageId === "string" && PAGE_ID.test(meta.pageId)) {
      const page = await pb
        .collection("pages")
        .getFirstListItem(
          pb.filter("id = {:id} && organization = {:org}", {
            id: meta.pageId,
            org: orgId,
          }),
          { fields: "id,title" },
        )
        .catch(() => null);
      if (page) {
        pageId = page.id;
        pageTitle = typeof page.title === "string" ? page.title : null;
      }
    }
    const proActive = await formsProActive(pb, orgId);
    return { row, pageId, pageTitle, proActive };
  }).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });

  const def = formFromRow(loaded.row);
  const formName = def.name;
  const proActive = loaded.proActive;

  const slot = takeFormSubmit(orgId, formId, ip);
  let v;
  try {
    v = validateSubmission(def, payload, { proActive });
  } catch (err) {
    if (err instanceof FormErrors) slot.release();
    throw err;
  }

  const spam = spamSignals({ ...spamInputOf(payload), now }).length > 0;
  // WR-A03: spam keeps its per-IP slot but gives the form-wide one back, so a few sources
  // cannot exhaust the form's hourly budget and lock real customers out.
  if (spam) slot.releaseForm();
  const newsletter = v.newsletter && def.newsletter_checkbox;
  const data: Record<string, FormAnswer> = { ...v.data };
  if (newsletter) data._newsletter = true;

  const id = newRecordId();
  const hasFileFields = def.fields.some((f) => f.type === "file");
  if (!spam && hasFileFields) {
    let files;
    try {
      files = await withSuperuser((pb) =>
        storeFormFiles(
          pb,
          {
            orgId,
            formId,
            submissionId: id,
            def,
            proActive,
            answers: v.data,
            files: meta.files ?? [],
          },
          deps,
        ),
      );
    } catch (err) {
      if (err instanceof FormErrors) slot.release();
      throw err;
    }
    for (const [field, answer] of Object.entries(files)) {
      data[field] = answer;
      const label = def.fields.find((f) => f.id === field)?.label;
      if (label) v.labels[field] = label;
    }
  }
  const storedFiles = Object.values(data).some(
    (a) => typeof a === "object" && a !== null && "file_id" in a,
  );
  const audit = auditBody(systemCtx("form.submit"), {
    action: "form.submitted",
    organization: orgId,
    targetCollection: SUBMISSIONS,
    targetId: id,
    meta: { form: formId, spam },
  });
  audit.ip = ip;

  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection(SUBMISSIONS).create({
      id,
      organization: orgId,
      form: formId,
      form_name: formName.slice(0, 80),
      page: loaded.pageId,
      data,
      labels: v.labels,
      spam,
      is_test: meta.isTest === true,
      read_at: "",
    });
    batch.collection("audit_log").create(audit);
    await batch.send();
  }).catch(async (err: unknown) => {
    if (storedFiles) {
      await deleteFormFiles(
        orgId,
        formId,
        id,
        deps.store ?? getObjectStore(),
      ).catch(() => undefined);
    }
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });

  // 14-35 (P14-P26): a test message ticks launch review item 5. Best effort, class-only log.
  if (!spam && meta.isTest === true) {
    try {
      await recordTestFormSubmission(orgId, id, { now });
    } catch (err) {
      console.error(
        `[forms] test form mark failed: ${err instanceof Error ? err.name : "Error"}`,
      );
    }
  }

  if (!spam) {
    if (v.email !== null) {
      try {
        const { contactId } = await touchContact(orgId, {
          email: v.email,
          ...(v.name !== null ? { name: v.name } : {}),
          ...(v.phone !== null ? { phone: v.phone } : {}),
          source: "form",
          ref: id,
          summary: `Sent the ${formName} form`,
          ...(newsletter
            ? { consent: { wording: def.newsletter_wording, form: formId } }
            : {}),
        });
        await withSuperuser((pb) =>
          pb.collection(SUBMISSIONS).update(id, { contact: contactId }),
        );
      } catch {
        console.error("[forms] contact touch failed");
      }
    }
    try {
      await sendSubmissionNotice(
        orgId,
        {
          formId,
          formName,
          notifyRoute: routeForAnswers(def, data, { proActive }),
          submissionId: id,
          pageTitle: loaded.pageTitle,
          answers: answersForDisplay(def.fields, data, v.labels).map((a) => ({
            label: a.label,
            value: a.value,
          })),
          newsletter: def.newsletter_checkbox ? newsletter : null,
          replyTo: v.email,
          submittedAt: now,
        },
        deps,
      );
    } catch {
      console.error("[forms] notification failed");
    }
    // 11-21 (DASH-35): the bell / push alert, after the submission committed. Best effort:
    // raiseAlert never throws, and the catch keeps a broken alert path off the visitor. The
    // form notification is the dedicated email, so the generic alert email is skipped.
    try {
      const who = (v.name ?? "").trim() || (v.email ?? "").trim();
      await raiseAlert(
        { orgId, as: mintSystemContext({ job: "form.submit" }) },
        {
          type: "form.message",
          sourceKey: `inbox:${id}`,
          title: who
            ? `New message from ${who}`
            : `New message from the ${formName.trim() || "contact"} form`,
          safeTitle: "New message",
          href: `/hub/inbox?tab=messages&message=${encodeURIComponent(id)}`,
          actionLabel: "Reply",
        },
        { dedicatedEmail: true },
      );
    } catch {
      console.error("[forms] alert failed");
    }
    const reply = autoReplyFor(def, v, { proActive });
    // CR-B01: one auto-reply per (form, address) per 24 h; the message itself is kept.
    if (reply && takeAutoReply(formId, reply.to)) {
      await sendAutoReply(orgId, id, reply, deps);
    }
  }

  return {
    id,
    afterSubmit:
      def.after_submit.kind === "page" && def.after_submit.page !== ""
        ? { kind: "page", pageId: def.after_submit.page }
        : { kind: "message", message: def.after_submit.message },
  };
}
