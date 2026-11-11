// The one contact write path (CONTACTS-02, D236, D271, D132; invariant 1, T-07-11-04/05).
// Every touch of one email in one org ends in exactly one contacts row: the org lock serialises
// writers, and the unique (organization, email_norm) index is the backstop (a refused create
// re-reads and updates). Each touch puts the contact on the house list (plus the given list),
// appends one contact_events row, fills blank name / phone only, and never lowers consent.
//
// touchContact / touchContactInLock are in-package only (never in index.ts): for callers that
// have already done their own checks (07-15 submitForm after the spam gate, Pitfall 8; Inbox
// "Not spam"). Never call touchContact inside another withOrgLock for the same org: the lock is
// not re-entrant. Use touchContactInLock there.
import { NotFound } from "@cds/core";
import { normaliseEmail } from "@cds/core/email";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { asInput, rejectForeignOrg } from "../content/shared";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { isOrgContext, mintSystemContext, type OrgContext } from "../context";
import { assertId, newRecordId, requirePermission } from "../repository";
import { ensureHouseList } from "./lists";
import {
  clampTouch,
  fillBlanks,
  mergeConsent,
  type ContactSource,
  type ContactTouch,
} from "./model";
import { isRefused, mapped } from "./shared";

/** History line when the caller gives none (contact_events.summary). */
export const DEFAULT_SUMMARIES: Readonly<Record<ContactSource, string>> = {
  form: "Sent a form",
  booking: "Made a booking",
  subscribe: "Signed up for the newsletter",
  registration: "Registered for an event",
  purchase: "Made a purchase",
  import: "Imported from a spreadsheet",
  manual: "Added by hand",
};

async function findByEmail(
  pb: PocketBase,
  orgId: string,
  emailNorm: string,
): Promise<RecordModel | null> {
  const res = await pb.collection("contacts").getList(1, 1, {
    filter: pb.filter("organization = {:org} && email_norm = {:e}", {
      org: orgId,
      e: emailNorm,
    }),
  });
  return res.items[0] ?? null;
}

async function checkList(
  pb: PocketBase,
  orgId: string,
  listId: unknown,
): Promise<string> {
  assertId(listId);
  const res = await pb.collection("contact_lists").getList(1, 1, {
    filter: pb.filter("id = {:id} && organization = {:org}", {
      id: listId,
      org: orgId,
    }),
    fields: "id",
  });
  if (res.items.length === 0) throw new NotFound();
  return listId;
}

/** Add the membership unless present; a unique-index refusal means "already a member". */
async function ensureMember(
  pb: PocketBase,
  orgId: string,
  list: string,
  contact: string,
  at: string,
): Promise<void> {
  const res = await pb.collection("contact_list_members").getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && list = {:list} && contact = {:c}",
      { org: orgId, list, c: contact },
    ),
    fields: "id",
  });
  if (res.items.length > 0) return;
  try {
    await pb.collection("contact_list_members").create({
      id: newRecordId(),
      organization: orgId,
      list,
      contact,
      added_at: at,
    });
  } catch (err) {
    if (!isRefused(err)) throw err;
  }
}

/**
 * In-package: the touch itself. The caller holds the org lock (or deliberately runs without
 * one, as the race test does) and a superuser client.
 */
export async function touchContactInLock(
  pb: PocketBase,
  orgId: string,
  touch: ContactTouch,
  listId?: string,
): Promise<{ contactId: string; created: boolean }> {
  const emailNorm = normaliseEmail(touch.email);
  const t = clampTouch(touch);
  const lists = [await ensureHouseList(pb, orgId)];
  if (listId !== undefined) {
    const extra = await checkList(pb, orgId, listId);
    if (!lists.includes(extra)) lists.push(extra);
  }
  const at = new Date().toISOString();
  const consentIn = t.consent
    ? { wording: t.consent.wording, form: t.consent.form, source: t.source, at }
    : undefined;

  let existing = await findByEmail(pb, orgId, emailNorm);
  let created = false;
  const newId = newRecordId();
  if (!existing) {
    try {
      await pb.collection("contacts").create({
        id: newId,
        organization: orgId,
        email: emailNorm,
        email_norm: emailNorm,
        name: t.name,
        phone: t.phone,
        tags: [],
        first_source: t.source,
        last_seen_at: at,
        marketing_consent: mergeConsent(undefined, consentIn),
      });
      created = true;
    } catch (err) {
      // The unique index refused it: a concurrent touch won. Re-read and update instead.
      if (!isRefused(err)) throw err;
      existing = await findByEmail(pb, orgId, emailNorm);
      if (!existing) throw err;
    }
  }
  const contactId = existing ? existing.id : newId;

  for (const list of lists) await ensureMember(pb, orgId, list, contactId, at);

  const batch = pb.createBatch();
  if (existing) {
    batch.collection("contacts").update(existing.id, {
      last_seen_at: at,
      ...fillBlanks(
        { name: existing.name as unknown, phone: existing.phone as unknown },
        { name: t.name, phone: t.phone },
      ),
      marketing_consent: mergeConsent(existing.marketing_consent, consentIn),
      deleted_at: "",
    });
  }
  batch.collection("contact_events").create({
    id: newRecordId(),
    organization: orgId,
    contact: contactId,
    kind: t.source,
    ref: t.ref,
    summary: t.summary || DEFAULT_SUMMARIES[t.source],
    at,
  });
  await batch.send();
  return { contactId, created };
}

/**
 * In-package: touchContactInLock under the org lock with a superuser client. For callers that
 * have done their own checks (07-15 submitForm after the spam gate; Inbox "Not spam"). Never
 * call it inside another withOrgLock for the same org: the lock is not re-entrant.
 */
export async function touchContact(
  orgId: string,
  touch: ContactTouch,
  listId?: string,
): Promise<{ contactId: string; created: boolean }> {
  const r = await mapped(
    withOrgLock(orgId, () =>
      withSuperuser((pb) => touchContactInLock(pb, orgId, touch, listId)),
    ),
  );
  if (r.created) await contactAlert(orgId, r.contactId, touch);
  return r;
}

/**
 * 11-21 (DASH-35): a new contact raises a `contact.new` summary alert (bell now, digest email
 * via 11-23, never push). After the lock is released; never throws. Spreadsheet imports do
 * not come through here, so a 500-row import raises nothing.
 */
async function contactAlert(
  orgId: string,
  contactId: string,
  touch: ContactTouch,
): Promise<void> {
  try {
    const name = typeof touch.name === "string" ? touch.name.trim() : "";
    await raiseAlert(
      { orgId, as: mintSystemContext({ job: "contacts" }) },
      {
        type: "contact.new",
        sourceKey: `contact:${contactId}`,
        title: `New contact: ${name || normaliseEmail(touch.email)}`,
        safeTitle: "New contact",
        href: "/hub/marketing?tab=contacts",
      },
    );
  } catch {
    console.error("[contacts] alert failed");
  }
}

/**
 * Public: record one touch of a person. A SiteContext is the visitor path (free core Contacts,
 * D236); an OrgContext needs contacts write and may not name another org. Anything else is
 * InvalidContext.
 */
export function recordContactTouch(
  ctx: OrgContext | SiteContext,
  touch: ContactTouch,
  listId?: string,
): Promise<{ contactId: string; created: boolean }> {
  let orgId: string;
  if (isOrgContext(ctx)) {
    requirePermission(ctx, "contacts", "write");
    rejectForeignOrg(ctx, asInput(touch, "contact"));
    orgId = ctx.orgId;
  } else {
    assertSiteContext(ctx);
    orgId = ctx.orgId;
  }
  return touchContact(orgId, touch, listId);
}
