// P10 payments: the fake adapter's object store (PAY-09, CONTEXT A1 stand-in).
//
// Every fake provider object (customer, checkout session, subscription, invoice, Connect
// account, price, refund, portal link) is one row of the platform collection
// `payment_fake_objects`: `object_id` is the provider-style id (`cs_fake_<15>`,
// `sub_fake_<15>` …), `org_ref` the owning org (plain text) and `data` the object body.
// Platform collection, API rules null; read and written only here, through the superuser
// client with bound filters (invariant 1, T-10-45-02).
import { createHash } from "node:crypto";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import { newRecordId } from "../../repository";

const COLLECTION = "payment_fake_objects";

export type FakeKind =
  | "customer"
  | "session"
  | "subscription"
  | "invoice"
  | "account"
  | "price"
  | "refund"
  | "portal";

/** Provider-style id prefixes (Stripe shapes with a `_fake_` marker). */
export const FAKE_PREFIX: Readonly<Record<FakeKind, string>> = {
  customer: "cus_fake_",
  session: "cs_fake_",
  subscription: "sub_fake_",
  invoice: "in_fake_",
  account: "acct_fake_",
  price: "price_fake_",
  refund: "re_fake_",
  portal: "bps_fake_",
};

export type FakeObject<T = Record<string, unknown>> = {
  id: string;
  kind: FakeKind;
  orgRef: string | null;
  data: T;
  created: string;
  updated: string;
};

/** A random 15-char suffix, or a stable one derived from an idempotency key. */
export function fakeSuffix(idempotencyKey?: string): string {
  if (!idempotencyKey) return newRecordId();
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 15);
}

export function fakeId(kind: FakeKind, idempotencyKey?: string): string {
  return (
    FAKE_PREFIX[kind] +
    fakeSuffix(idempotencyKey ? `${kind}:${idempotencyKey}` : undefined)
  );
}

function toObject<T>(r: RecordModel): FakeObject<T> {
  const org = typeof r.org_ref === "string" ? r.org_ref : "";
  return {
    id: String(r.object_id),
    kind: r.kind as FakeKind,
    orgRef: org === "" ? null : org,
    data: (r.data ?? {}) as T,
    created: String(r.created ?? ""),
    updated: String(r.updated ?? ""),
  };
}

function isNotFound(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 404;
}

async function findRecord(id: string): Promise<RecordModel | null> {
  return withSuperuser(async (pb) => {
    try {
      return await pb
        .collection(COLLECTION)
        .getFirstListItem(pb.filter("object_id = {:id}", { id }));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  });
}

/**
 * Store a new object. With an idempotency key the id is derived from it, and a repeat put
 * returns the stored object unchanged (the Stripe idempotency contract).
 */
export async function putFakeObject<T extends object>(
  kind: FakeKind,
  data: T,
  orgRef: string | null,
  opts: { idempotencyKey?: string; id?: string } = {},
): Promise<FakeObject<T>> {
  const id = opts.id ?? fakeId(kind, opts.idempotencyKey);
  if (opts.idempotencyKey || opts.id) {
    const existing = await findRecord(id);
    if (existing) return toObject<T>(existing);
  }
  const rec = await withSuperuser((pb) =>
    pb.collection(COLLECTION).create({
      object_id: id,
      kind,
      org_ref: orgRef ?? "",
      data,
    }),
  );
  return toObject<T>(rec);
}

export async function getFakeObject<T = Record<string, unknown>>(
  id: string,
): Promise<FakeObject<T> | null> {
  const rec = await findRecord(id);
  return rec ? toObject<T>(rec) : null;
}

/** Shallow-merge `patch` into the object's data. Throws when the object does not exist. */
export async function updateFakeObject<T extends object>(
  id: string,
  patch: Partial<T>,
): Promise<FakeObject<T>> {
  const rec = await findRecord(id);
  if (!rec) throw new Error(`fake object ${id} not found`);
  const data = { ...((rec.data ?? {}) as T), ...patch };
  const saved = await withSuperuser((pb) =>
    pb.collection(COLLECTION).update(rec.id, { data }),
  );
  return toObject<T>(saved);
}

export async function listFakeObjects<T = Record<string, unknown>>(input: {
  kind: FakeKind;
  orgRef?: string | null;
  updatedSince?: Date;
}): Promise<FakeObject<T>[]> {
  const clauses = ["kind = {:kind}"];
  const params: Record<string, unknown> = { kind: input.kind };
  if (input.orgRef !== undefined) {
    clauses.push("org_ref = {:org}");
    params.org = input.orgRef ?? "";
  }
  if (input.updatedSince) {
    clauses.push("updated >= {:since}");
    params.since = input.updatedSince;
  }
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter: pb.filter(clauses.join(" && "), params),
      sort: "created,id",
    }),
  );
  return rows.map((r) => toObject<T>(r));
}
