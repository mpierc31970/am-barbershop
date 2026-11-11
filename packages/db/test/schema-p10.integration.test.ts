import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSeededPb, type SeededPb } from "./seeded";

// P10 schema proofs on the real binary (10-04): five tenant collections, two platform
// collections and three organizations fields (CONTEXT A1-A4, BILL-09, PAY-01). Every API
// rule is null (invariant 1); the unique indexes are the idempotency and one-per-org
// guarantees; payment records outlive the org (BILL-09, D214).
type Json = Record<string, unknown>;

async function api(
  url: string,
  path: string,
  init: { method?: string; body?: unknown; auth?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.auth) headers.Authorization = init.auth;
  const res = await fetch(`${url}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

const idOf = (res: { status: number; body: Json }) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return String(res.body.id);
};

const RULES = [
  "listRule",
  "viewRule",
  "createRule",
  "updateRule",
  "deleteRule",
] as const;

const FIELDS: Record<string, string[]> = {
  billing_accounts: [
    "organization",
    "provider",
    "customer_id",
    "subscription_id",
    "status",
    "cadence",
    "build_plan",
    "installments_paid",
    "paid_at",
    "care_plan",
    "media_5gb_qty",
    "media_25gb_qty",
    "current_period_end",
    "lapsed_at",
    "price_locked_until",
    "checkout_session_id",
    "checkout_draft",
    "amount_due_cents",
    "card_brand",
    "card_last4",
    "card_exp",
    "declined_at",
    "restored_at",
    "created",
    "updated",
  ],
  billing_invoices: [
    "organization",
    "provider",
    "provider_invoice_id",
    "number",
    "issued_at",
    "description",
    "kind",
    "amount_cents",
    "tax_cents",
    "refunded_cents",
    "status",
    "has_installment",
    "hosted_url",
    "pdf_url",
    "retain_until",
    "work_order",
    "created",
    "updated",
  ],
  gateway_accounts: [
    "organization",
    "provider",
    "account_id",
    "charges_enabled",
    "details_submitted",
    "display_name",
    "status",
    "checked_at",
    "alerted_status",
    "created",
    "updated",
  ],
  work_orders: [
    "organization",
    "kind",
    "title",
    "scope",
    "blocks",
    "rate_cents",
    "total_cents",
    "deposit_cents",
    "balance_cents",
    "maintenance_cents",
    "addon_slug",
    "status",
    "sent_at",
    "valid_until",
    "accepted_at",
    "delivered_at",
    "paid_at",
    "declined_at",
    "accepted_by",
    "deposit_invoice_id",
    "balance_invoice_id",
    "created_by",
    "retain_until",
    "created",
    "updated",
  ],
  care_plan_time: [
    "organization",
    "minutes",
    "note",
    "ticket_ref",
    "staff",
    "logged_at",
    "created",
  ],
  payment_events: [
    "provider",
    "event_id",
    "type",
    "account",
    "org_ref",
    "received_at",
    "processed_at",
    "outcome",
    "attempts",
    "error",
    "object_ref",
    "created",
    "updated",
  ],
  payment_fake_objects: [
    "object_id",
    "kind",
    "org_ref",
    "data",
    "created",
    "updated",
  ],
};

const INDEXES: Record<string, string> = {
  billing_accounts: "idx_billing_accounts_org",
  billing_invoices: "idx_billing_invoices_org_provider_id",
  gateway_accounts: "idx_gateway_accounts_org_provider",
  care_plan_time: "idx_care_plan_time_org_logged",
  payment_events: "idx_payment_events_provider_event",
  payment_fake_objects: "idx_payment_fake_objects_object",
};

describe("P10 schema (throwaway PocketBase)", () => {
  let booted: SeededPb | null = null;
  let inst: SeededPb["inst"] | null = null;
  let su = "";

  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) return;
    inst = booted.inst;
    const auth = await api(
      inst.url,
      "/api/collections/_superusers/auth-with-password",
      {
        method: "POST",
        body: { identity: inst.email, password: inst.password },
      },
    );
    expect(auth.status).toBe(200);
    su = String(auth.body.token);
  });

  afterAll(async () => {
    await inst?.stop();
  });

  const collection = async (name: string): Promise<Json> => {
    const res = await api(inst!.url, `/api/collections/${name}`, { auth: su });
    expect(res.status, name).toBe(200);
    return res.body;
  };
  const newOrg = async (slug: string) =>
    idOf(
      await api(inst!.url, "/api/collections/organizations/records", {
        method: "POST",
        auth: su,
        body: { name: slug, slug, status: "active" },
      }),
    );
  const create = (name: string, body: Json) =>
    api(inst!.url, `/api/collections/${name}/records`, {
      method: "POST",
      auth: su,
      body,
    });

  it("each P10 collection has every field, null API rules and its named index", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const [name, fields] of Object.entries(FIELDS)) {
      const col = await collection(name);
      const names = (col.fields as Json[]).map((f) => String(f.name));
      for (const f of fields) expect(names, `${name}.${f}`).toContain(f);
      for (const rule of RULES) {
        expect(col[rule], `${name}.${rule}`).toBeNull();
      }
      const idx = INDEXES[name];
      if (idx) {
        expect((col.indexes as string[]).join("\n")).toContain(idx);
      }
    }
  });

  it("platform collections have no organization field", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const name of ["payment_events", "payment_fake_objects"]) {
      const col = await collection(name);
      const names = (col.fields as Json[]).map((f) => String(f.name));
      expect(names).not.toContain("organization");
    }
  });

  it("organizations gains billing_status, launched_at, build_started_at", async (ctx) => {
    if (!inst) return ctx.skip();
    const fields = (await collection("organizations")).fields as Json[];
    const status = fields.find((f) => f.name === "billing_status");
    expect(status?.values).toEqual(["none", "active", "past_due", "lapsed"]);
    expect(fields.find((f) => f.name === "launched_at")?.type).toBe("date");
    expect(fields.find((f) => f.name === "build_started_at")?.type).toBe(
      "date",
    );
  });

  it("billing_accounts is unique per org", async (ctx) => {
    if (!inst) return ctx.skip();
    const org = await newOrg("p10-ba");
    const row = { organization: org, provider: "fake", status: "none" };
    idOf(await create("billing_accounts", row));
    const dup = await create("billing_accounts", row);
    expect(dup.status).toBe(400);
  });

  it("payment_events is unique per (provider, event_id)", async (ctx) => {
    if (!inst) return ctx.skip();
    const row = {
      provider: "fake",
      event_id: "evt_p10_dup",
      type: "invoice.paid",
      received_at: new Date().toISOString(),
    };
    idOf(await create("payment_events", row));
    expect((await create("payment_events", row)).status).toBe(400);
    idOf(await create("payment_events", { ...row, provider: "stripe" }));
  });

  it("invoices and work orders keep a plain-text org and outlive the org row", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const name of ["billing_invoices", "work_orders"]) {
      const fields = (await collection(name)).fields as Json[];
      const org = fields.find((f) => f.name === "organization");
      expect(org?.type, name).toBe("text");
      expect(org?.required, name).toBe(true);
      expect(org?.pattern, name).toBe("^[a-z0-9]{15}$");
      expect(fields.find((f) => f.name === "retain_until")?.type).toBe("date");
    }
    const org = await newOrg("p10-outlive");
    const wo = idOf(
      await create("work_orders", {
        organization: org,
        kind: "polish",
        title: "Polish pass",
        total_cents: 20000,
        status: "sent",
      }),
    );
    const inv = idOf(
      await create("billing_invoices", {
        organization: org,
        provider: "fake",
        provider_invoice_id: "in_p10_outlive",
        issued_at: new Date().toISOString(),
        kind: "work_order",
        work_order: wo,
      }),
    );
    const del = await api(
      inst.url,
      `/api/collections/organizations/records/${org}`,
      { method: "DELETE", auth: su },
    );
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    const readInv = await api(
      inst.url,
      `/api/collections/billing_invoices/records/${inv}`,
      { auth: su },
    );
    expect(readInv.status).toBe(200);
    expect(readInv.body.organization).toBe(org);
    const readWo = await api(
      inst.url,
      `/api/collections/work_orders/records/${wo}`,
      { auth: su },
    );
    expect(readWo.status).toBe(200);
  });

  it("care_plan_time bounds minutes to 1-600", async (ctx) => {
    if (!inst) return ctx.skip();
    const org = await newOrg("p10-care");
    const base = {
      organization: org,
      note: "Fixed header",
      staff: "staff@cds.test",
      logged_at: new Date().toISOString(),
    };
    idOf(await create("care_plan_time", { ...base, minutes: 30 }));
    expect(
      (await create("care_plan_time", { ...base, minutes: 601 })).status,
    ).toBe(400);
  });
});
