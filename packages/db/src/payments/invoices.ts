// P10 payments: the invoice mirror (BILL-08, D82; CONTEXT A4; invariant 1).
//
// The webhook / reconcile handlers mirror every CDS invoice into `billing_invoices` so the
// hub lists invoices without calling the provider. One row per (org, provider invoice id),
// upserted from a re-fetched ProviderInvoice. The mirror holds number, date, description,
// amounts, status and the hosted / PDF links only: never card data (T-10-12-05).
// Owners read their org's rows through `listBillingInvoices(ctx)` (`billing:read`).
import { toBrowser } from "@cds/core";
import type { PaymentProvider, ProviderInvoice } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { requirePermission } from "../repository";
import type { OrgContext } from "../context";
import { INSTALLMENT_KEY } from "./accounts";

const COLLECTION = "billing_invoices";
const DESCRIPTION_MAX = 500;

export type InvoiceKind =
  "checkout" | "renewal" | "change" | "one_off" | "work_order";

export type InvoiceMirrorStatus =
  "draft" | "open" | "paid" | "uncollectible" | "void" | "refunded";

/** One mirrored invoice as an owner screen sees it (no provider ids). */
export type InvoiceMirror = {
  id: string;
  number: string;
  issuedAt: string;
  description: string;
  kind: InvoiceKind;
  /** Integer cents. */
  amountCents: number;
  /** Integer cents. */
  taxCents: number;
  /** Integer cents. */
  refundedCents: number;
  status: InvoiceMirrorStatus;
  hasInstallment: boolean;
  hostedUrl: string | null;
  pdfUrl: string | null;
};

/** Server-only: the mirror row with its provider invoice id. */
export type StoredInvoiceMirror = InvoiceMirror & {
  provider: PaymentProvider;
  providerInvoiceId: string;
  updated: string;
};

const KINDS = new Set<string>([
  "checkout",
  "renewal",
  "change",
  "one_off",
  "work_order",
]);
const STATUSES = new Set<string>([
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
  "refunded",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : 0;
}

function urlOrNull(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

export function isInvoiceKind(v: unknown): v is InvoiceKind {
  return typeof v === "string" && KINDS.has(v);
}

function toStored(r: RecordModel): StoredInvoiceMirror {
  const kind = str(r.kind);
  const status = str(r.status);
  return {
    id: r.id,
    number: str(r.number),
    issuedAt: str(r.issued_at),
    description: str(r.description),
    kind: (KINDS.has(kind) ? kind : "renewal") as InvoiceKind,
    amountCents: int(r.amount_cents),
    taxCents: int(r.tax_cents),
    refundedCents: int(r.refunded_cents),
    status: (STATUSES.has(status) ? status : "open") as InvoiceMirrorStatus,
    hasInstallment: r.has_installment === true,
    hostedUrl: urlOrNull(r.hosted_url),
    pdfUrl: urlOrNull(r.pdf_url),
    provider: r.provider === "stripe" ? "stripe" : "fake",
    providerInvoiceId: str(r.provider_invoice_id),
    updated: str(r.updated),
  };
}

function toMirror(s: StoredInvoiceMirror): InvoiceMirror {
  return {
    id: s.id,
    number: s.number,
    issuedAt: s.issuedAt,
    description: s.description,
    kind: s.kind,
    amountCents: s.amountCents,
    taxCents: s.taxCents,
    refundedCents: s.refundedCents,
    status: s.status,
    hasInstallment: s.hasInstallment,
    hostedUrl: s.hostedUrl,
    pdfUrl: s.pdfUrl,
  };
}

/**
 * An invoice line that pays a build installment (D181): the monthly installment item, the
 * remainder item, or (yearly cadence) the one-time first-month line for the installment.
 */
export function isInstallmentLine(line: {
  kind: string;
  key: string;
}): boolean {
  if (line.kind === "installment") return true;
  return line.kind === "first_month" && line.key === INSTALLMENT_KEY;
}

/** The mirror's status: a fully refunded paid invoice reads `refunded`. */
export function mirrorStatus(inv: ProviderInvoice): InvoiceMirrorStatus {
  if (
    inv.status === "paid" &&
    inv.refundedCents > 0 &&
    inv.refundedCents >= inv.totalCents
  ) {
    return "refunded";
  }
  return inv.status;
}

// ---------------------------------------------------------------------------------------
// Internal (superuser client; payment handlers only)

/** One org's mirror row for a provider invoice, or null. */
export async function invoiceMirrorOf(
  pb: PocketBase,
  orgId: string,
  providerInvoiceId: string,
): Promise<StoredInvoiceMirror | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org} && provider_invoice_id = {:inv}", {
      org: orgId,
      inv: providerInvoiceId,
    }),
  });
  const r = res.items[0];
  return r ? toStored(r) : null;
}

function invoiceRecordsOf(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel[]> {
  return pb.collection(COLLECTION).getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "-issued_at,-id",
  });
}

/** Every mirror row of one org (server-only, for recomputing installments). */
export async function invoiceMirrorsOf(
  pb: PocketBase,
  orgId: string,
): Promise<StoredInvoiceMirror[]> {
  return (await invoiceRecordsOf(pb, orgId)).map(toStored);
}

export type UpsertResult = {
  row: StoredInvoiceMirror;
  /** The row was created or a field changed. */
  changed: boolean;
  /** The status moved to `paid` with this write (drives the one receipt, choice 4). */
  becamePaid: boolean;
};

/**
 * Create or update the org's mirror row from a re-fetched invoice. Idempotent by state:
 * nothing is written when every mirrored field already matches.
 */
export async function upsertInvoiceMirror(
  pb: PocketBase,
  orgId: string,
  inv: ProviderInvoice,
  kind: InvoiceKind,
  provider: PaymentProvider,
  opts: { hasInstallment?: boolean } = {},
): Promise<UpsertResult> {
  const existing = await invoiceMirrorOf(pb, orgId, inv.id);
  const status = mirrorStatus(inv);
  const body: Record<string, unknown> = {
    provider,
    number: inv.number.slice(0, 64),
    issued_at: inv.createdAt,
    description: inv.description.slice(0, DESCRIPTION_MAX),
    kind,
    amount_cents: inv.totalCents,
    tax_cents: Math.max(0, inv.taxCents),
    refunded_cents: Math.max(0, inv.refundedCents),
    status,
    has_installment:
      opts.hasInstallment === true || inv.lines.some(isInstallmentLine),
    hosted_url: inv.hostedUrl ?? "",
    pdf_url: inv.pdfUrl ?? "",
  };
  if (!existing) {
    const r = await pb.collection(COLLECTION).create({
      organization: orgId,
      provider_invoice_id: inv.id,
      ...body,
    });
    const row = toStored(r);
    return { row, changed: true, becamePaid: status === "paid" };
  }
  const same =
    existing.provider === provider &&
    existing.number === body.number &&
    new Date(existing.issuedAt).getTime() ===
      new Date(inv.createdAt).getTime() &&
    existing.description === body.description &&
    existing.kind === kind &&
    existing.amountCents === body.amount_cents &&
    existing.taxCents === body.tax_cents &&
    existing.refundedCents === body.refunded_cents &&
    existing.status === status &&
    existing.hasInstallment === body.has_installment &&
    (existing.hostedUrl ?? "") === body.hosted_url &&
    (existing.pdfUrl ?? "") === body.pdf_url;
  if (same) return { row: existing, changed: false, becamePaid: false };
  const r = await pb.collection(COLLECTION).update(existing.id, body);
  return {
    row: toStored(r),
    changed: true,
    becamePaid: status === "paid" && existing.status !== "paid",
  };
}

// ---------------------------------------------------------------------------------------
// Public (OrgContext first, invariant 1)

/** The org's invoices, newest first (Owner only, `billing:read`, CONTEXT A4). */
export async function listBillingInvoices(
  ctx: OrgContext,
): Promise<InvoiceMirror[]> {
  requirePermission(ctx, "billing", "read");
  const rows = await withSuperuser((pb) => invoiceRecordsOf(pb, ctx.orgId));
  // BILL-05: project through the browser allowlist before mapping; provider ids never leave.
  return rows.map((r) =>
    toMirror(toStored(toBrowser(COLLECTION, r) as RecordModel)),
  );
}
