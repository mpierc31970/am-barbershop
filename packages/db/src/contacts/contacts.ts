// Contacts reads and owner edits (CONTACTS-01/02, D236, D266, D132; invariant 1, TEN-03).
//   - every read resolves its list scope first (resolveListScope): what a member sees is decided
//     by list membership, never by an owner field (Pitfall 11)
//   - every filter is built here with pb.filter bound params; callers pass words, not filters
//   - saveContact reads exactly id, name, email, phone and tags from its input. Consent,
//     first_source, organization, deleted_at and email_norm are never read from the caller
//     (D132: nothing here can subscribe anyone; withdrawConsent is the only consent writer)
//   - deleteContact is a hard delete (the owner expects erasure), in one audited batch with the
//     contact's memberships, notes and events, and form_submissions.contact cleared
import { InvalidInput, NotFound } from "@cds/core";
import { normaliseEmail } from "@cds/core/email";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import {
  MAX_ADDON_BATCH,
  sendAudited,
  TOO_MANY_CHANGES_COPY,
} from "../addons/backups";
import {
  asInput,
  commit,
  own,
  rejectForeignOrg,
  scopedGet,
  type Op,
} from "../content/shared";
import type { OrgContext } from "../context";
import { assertId, newRecordId } from "../repository";
import { ensureHouseList, resolveListScope, visibleListIds } from "./lists";
import {
  cleanText,
  CONSENT_FILTERS,
  ContactExists,
  isContactSource,
  NAME_MAX,
  normalizeTags,
  PHONE_MAX,
  readTags,
  TAG_MAX_LEN,
} from "./model";
import { notesFor } from "./notes";
import {
  isMember,
  projectContact,
  projectEvent,
  runContactsRead,
  runContactsWrite,
  type ContactEvent,
  type ContactList,
  type ContactListPage,
  type ContactNote,
  type ContactRow,
} from "./shared";
import { DEFAULT_SUMMARIES } from "./touch";

export type ListContactsOptions = {
  list?: string;
  q?: string;
  tag?: string;
  source?: string;
  consent?: string;
  sort?: "last_seen" | "name";
  page?: number;
  perPage?: number;
};

const Q_MAX = 100;
const PER_PAGE = 50;
const EVENTS_SHOWN = 100;

function optString(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new InvalidInput(`${what} must be text.`);
  return v;
}

/** The scoped base filter plus the optional parts, all bound. */
function contactFilter(
  pb: PocketBase,
  orgId: string,
  list: string,
  opts: ListContactsOptions,
): string {
  const parts = [
    pb.filter(
      'organization = {:org} && deleted_at = "" && contact_list_members_via_contact.list ?= {:list}',
      { org: orgId, list },
    ),
  ];
  const q = optString(opts.q, "Search")?.trim().slice(0, Q_MAX);
  if (q) {
    parts.push(
      pb.filter("(name ~ {:q} || email_norm ~ {:q} || phone ~ {:q})", { q }),
    );
  }
  const tag = optString(opts.tag, "Tag")?.trim();
  if (tag) {
    if (tag.length > TAG_MAX_LEN) throw new InvalidInput("Unknown tag.");
    parts.push(pb.filter("tags ~ {:tag}", { tag: JSON.stringify(tag) }));
  }
  const source = optString(opts.source, "Source");
  if (source !== undefined) {
    if (!isContactSource(source)) throw new InvalidInput("Unknown source.");
    parts.push(pb.filter("first_source = {:src}", { src: source }));
  }
  const consent = optString(opts.consent, "Newsletter");
  if (consent !== undefined) {
    if (!Object.hasOwn(CONSENT_FILTERS, consent)) {
      throw new InvalidInput("Unknown newsletter status.");
    }
    const st = CONSENT_FILTERS[consent]!;
    parts.push(
      st === "none"
        ? '(marketing_consent.status = "none" || marketing_consent.status = "" || marketing_consent = null)'
        : pb.filter("marketing_consent.status = {:st}", { st }),
    );
  }
  return parts.join(" && ");
}

function pageArgs(opts: ListContactsOptions): {
  page: number;
  perPage: number;
  sort: string;
} {
  const page =
    typeof opts.page === "number" &&
    Number.isInteger(opts.page) &&
    opts.page > 0
      ? opts.page
      : 1;
  const raw =
    typeof opts.perPage === "number" && Number.isFinite(opts.perPage)
      ? Math.floor(opts.perPage)
      : PER_PAGE;
  const perPage = Math.min(100, Math.max(1, raw));
  if (
    opts.sort !== undefined &&
    opts.sort !== "last_seen" &&
    opts.sort !== "name"
  ) {
    throw new InvalidInput("Unknown sort.");
  }
  const sort = opts.sort === "name" ? "name,email_norm,id" : "-last_seen_at,id";
  return { page, perPage, sort };
}

const EMPTY_PAGE: ContactListPage = {
  items: [],
  page: 1,
  perPage: PER_PAGE,
  totalItems: 0,
  totalPages: 0,
};

/** Search and filter the contacts of one visible list (house list by default), 50 per page. */
export function listContacts(
  ctx: OrgContext,
  opts: ListContactsOptions = {},
): Promise<ContactListPage> {
  return runContactsRead(ctx, async (pb) => {
    const o = asInput(opts, "options") as ListContactsOptions;
    const { page, perPage, sort } = pageArgs(o);
    const list = await resolveListScope(pb, ctx, o.list);
    if (list === null) return { ...EMPTY_PAGE };
    const res = await pb.collection("contacts").getList(page, perPage, {
      filter: contactFilter(pb, ctx.orgId, list, o),
      sort,
    });
    return {
      items: res.items.map(projectContact),
      page: res.page,
      perPage: res.perPage,
      totalItems: res.totalItems,
      totalPages: res.totalPages,
    };
  });
}

/** Every visible contact of the scoped list (export and tag list), sorted by name. */
export async function scopedContacts(
  pb: PocketBase,
  ctx: OrgContext,
  listId: unknown,
): Promise<RecordModel[]> {
  const list = await resolveListScope(pb, ctx, listId);
  if (list === null) return [];
  return pb.collection("contacts").getFullList({
    filter: contactFilter(pb, ctx.orgId, list, {}),
    sort: "name,email_norm,id",
  });
}

/** The distinct tags of the visible contacts, A to Z. */
export function listContactTags(
  ctx: OrgContext,
  opts: { list?: string } = {},
): Promise<string[]> {
  return runContactsRead(ctx, async (pb) => {
    const rows = await scopedContacts(pb, ctx, opts.list);
    const byKey = new Map<string, string>();
    for (const r of rows) {
      for (const t of readTags(r.tags)) {
        if (!byKey.has(t.toLowerCase())) byKey.set(t.toLowerCase(), t);
      }
    }
    return [...byKey.values()].sort((a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" }),
    );
  });
}

export type ContactDetail = {
  contact: ContactRow;
  events: ContactEvent[];
  notes: ContactNote[];
  lists: ContactList[];
};

/** One contact read through one list: its history, that list's notes, its visible lists. */
export function getContact(
  ctx: OrgContext,
  id: unknown,
  opts: { list?: string } = {},
): Promise<ContactDetail> {
  return runContactsRead(ctx, async (pb) => {
    assertId(id);
    const list = await resolveListScope(pb, ctx, opts.list);
    if (list === null) throw new NotFound();
    const rec = await scopedGet(pb, ctx, "contacts", id);
    if (rec.deleted_at || !(await isMember(pb, ctx.orgId, list, rec.id))) {
      throw new NotFound();
    }
    const events = await pb
      .collection("contact_events")
      .getList(1, EVENTS_SHOWN, {
        filter: pb.filter("organization = {:org} && contact = {:c}", {
          org: ctx.orgId,
          c: rec.id,
        }),
        sort: "-at,-created,-id",
      });
    const visible = await visibleListIds(pb, ctx);
    const memberRows = await pb.collection("contact_list_members").getFullList({
      filter: pb.filter("organization = {:org} && contact = {:c}", {
        org: ctx.orgId,
        c: rec.id,
      }),
      expand: "list",
    });
    const lists: ContactList[] = [];
    for (const m of memberRows) {
      const l = m.expand?.list as RecordModel | undefined;
      if (!l || !visible.has(l.id) || l.organization !== ctx.orgId) continue;
      lists.push({
        id: l.id,
        name: typeof l.name === "string" ? l.name : "",
        kind: l.kind === "renter" ? "renter" : "house",
      });
    }
    lists.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "house" ? -1 : 1));
    return {
      contact: projectContact(rec),
      events: events.items.map(projectEvent),
      notes: await notesFor(pb, ctx, rec.id, list),
      lists,
    };
  });
}

function textField(v: unknown, max: number, copy: string): string {
  if (v === null) return "";
  if (typeof v !== "string") throw new InvalidInput(copy);
  const t = v
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) throw new InvalidInput(copy);
  return t;
}

async function emailOwner(
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

const NAME_COPY = `Keep the name under ${NAME_MAX} characters.`;
const PHONE_COPY = `Keep the phone number under ${PHONE_MAX} characters.`;

/**
 * Add a contact by hand, or edit one. Reads only id, name, email, phone and tags. A new contact
 * starts with no newsletter agreement (D132) and goes on the house list with a "manual" event.
 * An email that another contact already has throws ContactExists (DUP-CONTACT).
 */
export function saveContact(
  ctx: OrgContext,
  raw: unknown,
): Promise<ContactRow> {
  return runContactsWrite(ctx, async (pb) => {
    const input = asInput(raw, "contact");
    rejectForeignOrg(ctx, input);
    const id = own(input, "id");
    const nameIn = own(input, "name");
    const phoneIn = own(input, "phone");
    const emailIn = own(input, "email");
    const tagsIn = own(input, "tags");
    const name =
      nameIn === undefined ? undefined : textField(nameIn, NAME_MAX, NAME_COPY);
    const phone =
      phoneIn === undefined
        ? undefined
        : textField(phoneIn, PHONE_MAX, PHONE_COPY);
    const tags = tagsIn === undefined ? undefined : normalizeTags(tagsIn);

    if (id === undefined) {
      const email = normaliseEmail(emailIn);
      const dup = await emailOwner(pb, ctx.orgId, email);
      if (dup) {
        throw new ContactExists(email, dup.id, cleanText(dup.name, NAME_MAX));
      }
      const house = await ensureHouseList(pb, ctx.orgId);
      const contactId = newRecordId();
      const at = new Date().toISOString();
      await commit(
        pb,
        ctx,
        [
          {
            collection: "contacts",
            op: "create",
            id: contactId,
            body: {
              organization: ctx.orgId,
              email,
              email_norm: email,
              name: name ?? "",
              phone: phone ?? "",
              tags: tags ?? [],
              first_source: "manual",
              last_seen_at: at,
              marketing_consent: { status: "none" },
            },
          },
          {
            collection: "contact_list_members",
            op: "create",
            id: newRecordId(),
            body: {
              organization: ctx.orgId,
              list: house,
              contact: contactId,
              added_at: at,
            },
          },
          {
            collection: "contact_events",
            op: "create",
            id: newRecordId(),
            body: {
              organization: ctx.orgId,
              contact: contactId,
              kind: "manual",
              ref: "",
              summary: DEFAULT_SUMMARIES.manual,
              at,
            },
          },
        ],
        {
          action: "contact.create",
          targetCollection: "contacts",
          targetId: contactId,
        },
      );
      return projectContact(await pb.collection("contacts").getOne(contactId));
    }

    const rec = await scopedGet(pb, ctx, "contacts", id);
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (phone !== undefined) patch.phone = phone;
    if (tags !== undefined) patch.tags = tags;
    if (emailIn !== undefined) {
      const email = normaliseEmail(emailIn);
      if (email !== rec.email_norm) {
        const dup = await emailOwner(pb, ctx.orgId, email);
        if (dup && dup.id !== rec.id) {
          throw new ContactExists(email, dup.id, cleanText(dup.name, NAME_MAX));
        }
        patch.email = email;
        patch.email_norm = email;
      }
    }
    if (Object.keys(patch).length === 0) return projectContact(rec);
    await commit(
      pb,
      ctx,
      [{ collection: "contacts", op: "update", id: rec.id, body: patch }],
      {
        action: "contact.update",
        targetCollection: "contacts",
        targetId: rec.id,
        meta: { fields: Object.keys(patch).sort() },
      },
    );
    return projectContact(await pb.collection("contacts").getOne(rec.id));
  });
}

/** Mark someone unsubscribed. Never sets confirmed: there is no subscribe function (D132). */
export function withdrawConsent(
  ctx: OrgContext,
  id: unknown,
): Promise<ContactRow> {
  return runContactsWrite(ctx, async (pb) => {
    const rec = await scopedGet(pb, ctx, "contacts", id);
    const at = new Date().toISOString();
    await commit(
      pb,
      ctx,
      [
        {
          collection: "contacts",
          op: "update",
          id: rec.id,
          body: {
            marketing_consent: { status: "withdrawn", at, source: "owner" },
          },
        },
        {
          collection: "contact_events",
          op: "create",
          id: newRecordId(),
          body: {
            organization: ctx.orgId,
            contact: rec.id,
            kind: "manual",
            ref: "",
            summary: "Marked as unsubscribed",
            at,
          },
        },
      ],
      {
        action: "contact.withdraw",
        targetCollection: "contacts",
        targetId: rec.id,
      },
    );
    return projectContact(await pb.collection("contacts").getOne(rec.id));
  });
}

/** Erase a contact: memberships, notes, events, submission links, then the contact. Audited. */
export function deleteContact(ctx: OrgContext, id: unknown): Promise<void> {
  return runContactsWrite(ctx, async (pb) => {
    const rec = await scopedGet(pb, ctx, "contacts", id);
    const of = (collection: string) =>
      pb.collection(collection).getFullList({
        filter: pb.filter("organization = {:org} && contact = {:c}", {
          org: ctx.orgId,
          c: rec.id,
        }),
        fields: "id",
      });
    const ops: Op[] = [];
    for (const col of [
      "contact_list_members",
      "contact_notes",
      "contact_events",
    ]) {
      for (const r of await of(col))
        ops.push({ collection: col, op: "delete", id: r.id });
    }
    for (const r of await of("form_submissions")) {
      ops.push({
        collection: "form_submissions",
        op: "update",
        id: r.id,
        body: { contact: "" },
      });
    }
    ops.push({ collection: "contacts", op: "delete", id: rec.id });
    if (ops.length + 1 > MAX_ADDON_BATCH) {
      throw new InvalidInput(TOO_MANY_CHANGES_COPY);
    }
    await sendAudited(pb, ctx, ops, {
      action: "contact.delete",
      targetCollection: "contacts",
      targetId: rec.id,
    });
  });
}
