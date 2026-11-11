// Shared internals of the contacts chokepoint (CONTACTS-01/02, invariant 1, RESEARCH Pitfall 11).
// Never exported from index.ts.
//   - runContactsRead(): requirePermission(ctx, "contacts", "read") (Owner / Admin / Staff /
//     Renter), then the superuser client and PB error mapping. Renters are narrowed by list
//     membership in lists.ts resolveListScope, never by an ownerField (contacts has none).
//   - runContactsWrite(): requirePermission(ctx, "contacts", "write") (Owner / Admin), the
//     per-org lock, the superuser client and PB error mapping, in that order (content/shared.ts
//     run, with the contacts feature)
//   - projections are built field by field, never spread
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import type { OrgContext } from "../context";
import { mapError, requirePermission } from "../repository";
import {
  isContactSource,
  readConsent,
  readTags,
  type ContactSource,
  type MarketingConsent,
} from "./model";

export function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** Contacts read (Owner / Admin / Staff / Renter; Editor and Viewer are refused). */
export function runContactsRead<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "contacts", "read");
  return mapped(withSuperuser(fn));
}

/** Contacts write (Owner / Admin), one writer per org at a time. */
export function runContactsWrite<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "contacts", "write");
  return mapped(withOrgLock(ctx.orgId, () => withSuperuser(fn)));
}

/** A PB unique-index refusal (or any 400) on create. */
export function isRefused(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 400;
}

export type ContactRow = {
  id: string;
  email: string;
  name: string;
  phone: string;
  tags: string[];
  first_source: ContactSource | "";
  last_seen_at: string;
  consent: MarketingConsent;
  created: string;
};

export type ContactEvent = {
  id: string;
  kind: ContactSource | "";
  ref: string;
  summary: string;
  at: string;
};

export type ContactNote = {
  id: string;
  list: string;
  body: string;
  author: string;
  /** The reader wrote it (only the author may delete it). */
  mine: boolean;
  created: string;
};

export type ContactList = {
  id: string;
  name: string;
  kind: "house" | "renter";
};

export type ContactListPage = {
  items: ContactRow[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
};

const s = (v: unknown): string => (typeof v === "string" ? v : "");

export function projectContact(r: RecordModel): ContactRow {
  const src = r.first_source;
  return {
    id: r.id,
    email: s(r.email_norm) || s(r.email),
    name: s(r.name),
    phone: s(r.phone),
    tags: readTags(r.tags),
    first_source: isContactSource(src) ? src : "",
    last_seen_at: s(r.last_seen_at),
    consent: readConsent(r.marketing_consent),
    created: s(r.created),
  };
}

export function projectEvent(r: RecordModel): ContactEvent {
  const kind = r.kind;
  return {
    id: r.id,
    kind: isContactSource(kind) ? kind : "",
    ref: s(r.ref),
    summary: s(r.summary),
    at: s(r.at),
  };
}

export function projectNote(r: RecordModel, ctx: OrgContext): ContactNote {
  const author = s(r.author);
  return {
    id: r.id,
    list: s(r.list),
    body: s(r.body),
    author,
    mine: author !== "" && author === ctx.actor,
    created: s(r.created),
  };
}

export function projectList(r: RecordModel): ContactList {
  return {
    id: r.id,
    name: s(r.name),
    kind: r.kind === "renter" ? "renter" : "house",
  };
}

/** Is `contact` a member of `list` (both in the org)? */
export async function isMember(
  pb: PocketBase,
  orgId: string,
  list: string,
  contact: string,
): Promise<boolean> {
  const res = await pb.collection("contact_list_members").getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && list = {:list} && contact = {:contact}",
      { org: orgId, list, contact },
    ),
    fields: "id",
  });
  return res.items.length > 0;
}
