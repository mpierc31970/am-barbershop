// The signing chokepoint and the checkout gate (AGR-02, AGR-03, AGR-04, AGR-05, AGR-07; D80,
// D81, D283, D287; CONTEXT Area 2 A2-Q1..Q5, A3-Q1, A3-Q2; RESEARCH Pattern 2, Pattern 5).
//
// A signature is never updated; re-acceptance writes a new row and new documents. Status is
// derived from the rows, never stored.
//
// signAgreement order (Pattern 2): owner-only and impersonation-denied (policy_accept:run)
// -> signer name normalised -> per-org lock -> active set -> ERR-ALREADY when current ->
// the posted {key, version, sha256} set and the consent must equal the expected set exactly
// (ERR-STALE; nothing written) -> evidence JSON (deny-by-default, canonical, hashed) ->
// signed HTML copy (embeds the evidence hash, hashed) -> both objects putIfAbsent (write
// once) -> ONE PocketBase batch: the signature row and its audit row carrying both hashes.
// If the batch fails, the two objects stay as orphans under a never-reused id (logged with
// ids only; verify reports rows only).
import {
  AgreementRequired,
  authorize,
  authorizeStaff,
  can,
  InvalidInput,
} from "@cds/core";
import {
  canonicalJson,
  evidenceIp,
  normalizeSignerName,
  POLICY_CODES,
  renderSignedCopy,
  retainUntil,
  signedCopyFilename,
  signerNameValid,
  toEvidence,
  type PolicyVersion,
} from "@cds/core/legal";
import { ClientResponseError } from "pocketbase";
import { appendAudit, auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertOrgContext,
  assertPlatformContext,
  isOrgContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { listBillingInvoices } from "../payments/invoices";
import { mapError, newRecordId, requirePermission } from "../repository";
import {
  getAgreementStore,
  tenantAgreementKey,
  type WriteOnceObjectStore,
} from "../storage";
import { sha256Hex } from "./hash";
import { orderSnapshotFor } from "./order-snapshot";
import {
  activeConsentVersion,
  activePolicies,
  policyText,
} from "./policy-versions";

const COLLECTION = "agreement_signatures";

/** UI-SPEC ERR-STALE. */
export const AGREEMENT_STALE_COPY =
  "One of these policies was updated while you were reading. We've loaded the new version; please review it and tick it again.";
/** UI-SPEC ERR-ALREADY, first sentence (the UI adds the link). */
export const AGREEMENT_ALREADY_COPY = "You've already signed these versions.";
/** UI-SPEC NAME-ERROR. */
export const SIGNER_NAME_COPY = "Type your full name (at least 2 characters).";

/** The posted versions or consent are not the ones the org must sign now. */
export class AgreementStale extends InvalidInput {
  override readonly code: string = "agreement_stale";
  constructor() {
    super(AGREEMENT_STALE_COPY);
  }
}

/** The org has already signed the current versions (a second tab). */
export class AgreementAlreadySigned extends InvalidInput {
  override readonly code: string = "agreement_already";
  constructor() {
    super(AGREEMENT_ALREADY_COPY);
  }
}

export type PostedPolicy = { key: string; version: number; sha256: string };

export type SignInput = {
  policies: readonly PostedPolicy[];
  consent: { version: number; sha256: string };
  signerName: string;
  /** From clientIp() (trusted hops) in the Server Action, never from the form. */
  ip: string;
  userAgent: string;
  authMethod: "otp" | "password" | "unknown";
};

export type SignResult = {
  signatureId: string;
  signedAt: string;
  kind: "signup" | "reaccept";
  evidenceSha256: string;
  documentSha256: string;
  policies: readonly { key: string; version: number; title: string }[];
};

export type AgreementStatus = {
  state: "unsigned" | "current" | "outdated";
  missing: readonly {
    key: string;
    version: number;
    title: string;
    changes: string | null;
    previousVersion: number | null;
    previousSignedAt: string | null;
  }[];
  consentCurrent: boolean;
  lastSignedAt: string | null;
  lastSignerName: string | null;
};

/** One signature row as the legal area reads it (internal; 09-13 lists and emails). */
export type SignatureRow = {
  id: string;
  signer: string;
  signerName: string;
  signerEmail: string;
  orgName: string;
  signedAt: string;
  retainUntil: string;
  kind: "signup" | "reaccept";
  policies: readonly PostedPolicy[];
  consent: { version: number; sha256: string } | null;
  documentKey: string;
  documentSha256: string;
  evidenceSha256: string;
};

/** PocketBase date ("YYYY-MM-DD HH:MM:SS.mmmZ") -> ISO, or "" (Pitfall 10). */
function isoOf(v: unknown): string {
  if (typeof v !== "string" || v === "") return "";
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function postedList(v: unknown): PostedPolicy[] {
  if (!Array.isArray(v)) return [];
  const out: PostedPolicy[] = [];
  for (const raw of v) {
    if (raw === null || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.key !== "string" || typeof p.version !== "number") continue;
    out.push({
      key: p.key,
      version: p.version,
      sha256: typeof p.sha256 === "string" ? p.sha256 : "",
    });
  }
  return out;
}

function consentOf(v: unknown): SignatureRow["consent"] {
  if (v === null || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.version !== "number" || typeof c.sha256 !== "string") {
    return null;
  }
  return { version: c.version, sha256: c.sha256 };
}

/**
 * The org's signature rows, newest first (Owner and Admin, `agreements:read`; WR-A05: the
 * rows carry every signer's email and IP, so the chokepoint authorizes, not its callers).
 */
export async function listSignatureRows(
  ctx: OrgContext,
): Promise<SignatureRow[]> {
  assertOrgContext(ctx);
  authorize(ctx, "agreements", "read");
  return signatureRows(ctx);
}

/**
 * Internal, not exported: the same rows without the role check, for agreementStatus (every
 * member sees whether the owner must re-accept) and signAgreement. Org filter from ctx only
 * (invariant 1); callers must have authorized for their own purpose.
 */
async function signatureRows(ctx: OrgContext): Promise<SignatureRow[]> {
  assertOrgContext(ctx);
  const records = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      sort: "-signed_at,-id",
    }),
  ).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
  return records.map((r) => ({
    id: r.id,
    signer: String(r.signer ?? ""),
    signerName: String(r.signer_name ?? ""),
    signerEmail: String(r.signer_email ?? ""),
    orgName: String(r.org_name ?? ""),
    signedAt: isoOf(r.signed_at),
    retainUntil: isoOf(r.retain_until),
    kind: r.kind === "reaccept" ? "reaccept" : "signup",
    policies: postedList(r.policies),
    consent: consentOf(r.consent),
    documentKey: String(r.document_key ?? ""),
    documentSha256: String(r.document_sha256 ?? ""),
    evidenceSha256: String(r.evidence_sha256 ?? ""),
  }));
}

function statusFrom(
  rows: readonly SignatureRow[],
  active: readonly PolicyVersion[],
  consent: { version: number; sha256: string },
): AgreementStatus {
  const signed = (key: string, version: number) =>
    rows.some((r) =>
      r.policies.some((p) => p.key === key && p.version === version),
    );
  const missing = active
    .filter((p) => !signed(p.key, p.version))
    .map((p) => {
      // rows are newest first: the first row naming the key is the latest signing of it.
      const prevRow = rows.find((r) => r.policies.some((q) => q.key === p.key));
      const prev = prevRow?.policies.find((q) => q.key === p.key);
      return {
        key: p.key,
        version: p.version,
        title: p.title,
        changes: p.changes,
        previousVersion: prev ? prev.version : null,
        previousSignedAt: prevRow ? prevRow.signedAt || null : null,
      };
    });
  const consentCurrent = rows.some(
    (r) =>
      r.consent !== null &&
      r.consent.version === consent.version &&
      r.consent.sha256 === consent.sha256,
  );
  const last = rows[0];
  const state: AgreementStatus["state"] =
    rows.length === 0
      ? "unsigned"
      : missing.length === 0 && consentCurrent
        ? "current"
        : "outdated";
  return {
    state,
    missing,
    consentCurrent,
    lastSignedAt: last ? last.signedAt || null : null,
    lastSignerName: last ? last.signerName || null : null,
  };
}

/**
 * Unsigned / current / outdated for the org (Pattern 5). Every member role may read it (the
 * hub layout and P10 need it), so it skips authorize but always asserts the org context.
 */
export async function agreementStatus(
  ctx: OrgContext,
): Promise<AgreementStatus> {
  assertOrgContext(ctx);
  const [active, consent, rows] = await Promise.all([
    activePolicies(),
    activeConsentVersion(),
    signatureRows(ctx),
  ]);
  return statusFrom(rows, active, consent);
}

/** The checkout gate (AGR-02, D80): throws AgreementRequired unless current. */
export async function requireCurrentSignature(ctx: OrgContext): Promise<void> {
  const s = await agreementStatus(ctx);
  if (s.state !== "current") throw new AgreementRequired();
}

/** The shared normaliser (WR-B04): the client shows exactly what is recorded here. */
function normaliseName(v: unknown): string {
  if (typeof v !== "string" || !signerNameValid(v)) {
    throw new InvalidInput(SIGNER_NAME_COPY);
  }
  return normalizeSignerName(v);
}

function sameSet(
  posted: readonly PostedPolicy[],
  expected: readonly PolicyVersion[],
): boolean {
  if (!Array.isArray(posted) || posted.length !== expected.length) return false;
  return expected.every(
    (e) =>
      posted.filter(
        (p) =>
          p !== null &&
          typeof p === "object" &&
          p.key === e.key &&
          p.version === e.version &&
          p.sha256 === e.sha256,
      ).length === 1,
  );
}

/** Choice 2: the business profile's legal name when set, else the organization's name. */
async function signerFacts(
  ctx: OrgContext,
): Promise<{ email: string; orgName: string }> {
  return withSuperuser(async (pb) => {
    const user = await pb
      .collection("users")
      .getOne(ctx.actor, { fields: "id,email" });
    const org = await pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "id,name" });
    const profile = await pb.collection("business_profile").getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      fields: "legal_name",
    });
    const legal = String(profile.items[0]?.legal_name ?? "").trim();
    const orgName = legal || String(org.name ?? "").trim() || ctx.orgId;
    return { email: String(user.email ?? ""), orgName };
  });
}

/**
 * Sign the agreement (owner only; staff impersonation is refused, D287). Writes the
 * evidence JSON and signed copy write-once, then the row and its audit row in one batch.
 */
export async function signAgreement(
  ctx: OrgContext,
  input: SignInput,
  deps: {
    store?: WriteOnceObjectStore;
    now?: () => Date;
    addonNames?: Readonly<Record<string, string>>;
    /** Email transport for agreement.signed (tests); defaults to the configured one. */
    transport?: EmailTransport;
  } = {},
): Promise<SignResult> {
  requirePermission(ctx, "policy_accept", "run");
  if (input === null || typeof input !== "object") {
    throw new InvalidInput("signing input is required");
  }
  const signerName = normaliseName(input.signerName);
  return withOrgLock(ctx.orgId, async () => {
    const [active, consent, rows] = await Promise.all([
      activePolicies(),
      activeConsentVersion(),
      signatureRows(ctx),
    ]);
    const status = statusFrom(rows, active, consent);
    if (status.state === "current") throw new AgreementAlreadySigned();

    // Choice 1 (strict set): unsigned -> all active; outdated -> exactly the missing ones
    // (a consent-only change re-signs the full active set). Consent is required every time.
    const missingKeys = new Set(status.missing.map((m) => m.key));
    const expected =
      status.state === "unsigned" || missingKeys.size === 0
        ? active
        : active.filter((p) => missingKeys.has(p.key));
    const posted = input.consent;
    if (
      !sameSet(input.policies, expected) ||
      posted === null ||
      typeof posted !== "object" ||
      posted.version !== consent.version ||
      posted.sha256 !== consent.sha256
    ) {
      throw new AgreementStale();
    }

    const kind: SignResult["kind"] =
      status.state === "unsigned" ? "signup" : "reaccept";
    const facts = await signerFacts(ctx);
    const orderSnapshot = await orderSnapshotFor(ctx, {
      addonNames: deps.addonNames,
    });
    const id = newRecordId();
    const signedAtDate = (deps.now ?? (() => new Date()))();
    const signedAt = signedAtDate.toISOString();
    const retain = retainUntil(signedAtDate).toISOString();

    const evidence = toEvidence({
      format: "cds-agreement-evidence",
      format_version: 1,
      signature_id: id,
      organization: ctx.orgId,
      org_name: facts.orgName,
      signer: ctx.actor,
      signer_email: facts.email,
      signer_name: signerName,
      policies: expected.map((p) => ({
        key: p.key,
        version: p.version,
        title: p.title,
        sha256: p.sha256,
        effective_at: p.effectiveAt,
      })),
      consent: {
        key: "esign-consent",
        version: consent.version,
        sha256: consent.sha256,
      },
      consent_ticked: true,
      policies_ticked: expected.map((p) => p.key),
      ip: evidenceIp(input.ip),
      user_agent: typeof input.userAgent === "string" ? input.userAgent : "",
      auth_method: input.authMethod,
      signed_at: signedAt,
      kind,
      order_snapshot: orderSnapshot,
      retain_until: retain,
    });
    const canonical = canonicalJson(evidence);
    const evidenceSha256 = sha256Hex(canonical);
    const html = renderSignedCopy(evidence, evidenceSha256, {
      policies: expected,
      consent,
    });
    const documentSha256 = sha256Hex(html);

    const store = deps.store ?? getAgreementStore();
    const jsonKey = tenantAgreementKey(ctx.orgId, id, "json");
    const htmlKey = tenantAgreementKey(ctx.orgId, id, "html");
    for (const [key, body, type] of [
      [jsonKey, canonical, "application/json"],
      [htmlKey, html, "text/html; charset=utf-8"],
    ] as const) {
      if ((await store.putIfAbsent(key, body, type)) === "exists") {
        throw new Error(`agreement object already exists for signature ${id}`);
      }
    }

    const codes = expected
      .map((p) => `${POLICY_CODES[p.key]}${p.version}`)
      .join(" ");
    try {
      await withSuperuser(async (pb) => {
        const batch = pb.createBatch();
        batch.collection(COLLECTION).create({
          id,
          organization: ctx.orgId,
          signer: ctx.actor,
          signer_email: facts.email,
          signer_name: signerName,
          org_name: evidence.org_name,
          policies: expected.map((p) => ({
            key: p.key,
            version: p.version,
            sha256: p.sha256,
          })),
          consent: { version: consent.version, sha256: consent.sha256 },
          ip: evidence.ip,
          user_agent: evidence.user_agent,
          auth_method: evidence.auth_method,
          signed_at: signedAt,
          order_snapshot: orderSnapshot,
          document_key: htmlKey,
          document_sha256: documentSha256,
          evidence_sha256: evidenceSha256,
          retain_until: retain,
          kind,
        });
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "agreement.sign",
            targetCollection: COLLECTION,
            targetId: id,
            meta: {
              kind,
              policies: codes,
              consent_version: consent.version,
              evidence_sha256: evidenceSha256,
              document_sha256: documentSha256,
            },
          }),
        );
        await batch.send();
      });
    } catch (err) {
      // Choice 4: the write-once objects stay as orphans; ids only, never email or IP.
      console.error(
        `agreement.sign batch failed; orphan objects for signature ${id} in org ${ctx.orgId}`,
      );
      throw err;
    }
    // 09-13: the signer's record (CONTEXT A2-Q4). After commit; a failure is logged with the
    // id only and never fails the signing.
    await sendSignedEmail({
      signatureId: id,
      to: facts.email,
      signerName,
      orgName: evidence.org_name,
      signedAt,
      evidenceSha256,
      policies: expected,
      transport: deps.transport,
    });

    return {
      signatureId: id,
      signedAt,
      kind,
      evidenceSha256,
      documentSha256,
      policies: expected.map((p) => ({
        key: p.key,
        version: p.version,
        title: p.title,
      })),
    };
  }).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "8 Oct 2026" and "7:14 pm UTC", from UTC parts like the signed copy. */
function emailDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    date: `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${h12}:${mi} ${h < 12 ? "am" : "pm"} UTC`,
  };
}

/** Send agreement.signed to the signer (choice 3: transactional, signer snapshot email). */
async function sendSignedEmail(a: {
  signatureId: string;
  to: string;
  signerName: string;
  orgName: string;
  signedAt: string;
  evidenceSha256: string;
  policies: readonly { title: string; version: number }[];
  transport?: EmailTransport;
}): Promise<void> {
  try {
    const when = emailDateParts(a.signedAt);
    await sendEmail(
      { kind: "cds", ctx: mintSystemContext({ job: "agreement-signed" }) },
      "agreement.signed",
      a.to,
      {
        firstName: a.signerName.split(" ")[0] ?? a.signerName,
        orgName: a.orgName,
        signedDate: when.date,
        signedTime: when.time,
        policies: a.policies.map((p) => `${p.title}, version ${p.version}`),
        link: platformUrl(agreementDownloadPath(a.signatureId)),
        proofCode: a.evidenceSha256,
      },
      { transport: a.transport },
    );
  } catch {
    console.error(`[legal] agreement.signed email failed for ${a.signatureId}`);
  }
}

// ---------------------------------------------------------------------------------------
// 09-13: the documents read model and the signed-copy reader (AGR-04, AGR-06; CONTEXT A2-Q4,
// A3-Q3; D81, D82; D-UI-P9-11).

/** One signing in the org's documents list; P12 COMM-04 extends this union. */
export type AgreementDocument = {
  kind: "agreement";
  id: string;
  title: string;
  versions: readonly { key: string; title: string; version: number }[];
  signedAt: string;
  signerName: string;
  signerEmail: string;
  signingKind: "signup" | "reaccept";
  /** The "Proof code" (D-UI-P9-10). */
  evidenceSha256: string;
  /** Hub route that streams the copy after a session check; never a bearer link. */
  downloadUrl: string;
};

/** Relative hub route for one signed copy (choice 1, D-UI-P9-11). */
export function agreementDownloadPath(signatureId: string): string {
  return `/hub/agreement/download/${encodeURIComponent(signatureId)}`;
}

/** One CDS invoice in the org's documents list (10-12, CONTEXT A4). Owners only. */
export type InvoiceDocument = {
  kind: "invoice";
  id: string;
  /** "Invoice FAKE-ABC123" */
  label: string;
  /** ISO timestamp the invoice was issued. */
  date: string;
  status: string;
  /** Integer cents. */
  amountCents: number;
  /** The provider's hosted invoice page; null when there is none. */
  href: string | null;
};

/** Every document the hub lists (P12 COMM-04 extends this union). */
export type HubDocument = AgreementDocument | InvoiceDocument;

export function isAgreementDocument(d: HubDocument): d is AgreementDocument {
  return d.kind === "agreement";
}

function documentDate(d: HubDocument): number {
  const t = new Date(d.kind === "agreement" ? d.signedAt : d.date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The org's signings only, newest first (Owner and Admin, `agreements:read`). WR-D06: the
 * Legal screens (Legal tab, agreement page, signed confirmation) read this, so the invoice
 * mirror can never break the sign-before-checkout flow or the AGR-04 download.
 */
export async function listAgreementDocuments(
  ctx: OrgContext,
): Promise<AgreementDocument[]> {
  assertOrgContext(ctx);
  authorize(ctx, "agreements", "read");
  const rows = await signatureRows(ctx);
  return rows.map((r) => ({
    kind: "agreement",
    id: r.id,
    title: "Signed agreement",
    versions: r.policies.map((p) => ({
      key: p.key,
      title: policyText(p.key, p.version)?.title ?? p.key,
      version: p.version,
    })),
    signedAt: r.signedAt,
    signerName: r.signerName,
    signerEmail: r.signerEmail,
    signingKind: r.kind,
    evidenceSha256: r.evidenceSha256,
    downloadUrl: agreementDownloadPath(r.id),
  }));
}

/**
 * The org's documents, newest first across kinds: signings (Owner and Admin,
 * `agreements:read`) and, for the Owner only (`billing:read`, D311), mirrored invoices.
 * The combined P12 documents view; the Legal screens use listAgreementDocuments.
 */
export async function listDocuments(ctx: OrgContext): Promise<HubDocument[]> {
  const agreements = await listAgreementDocuments(ctx);
  if (!can(ctx, "billing", "read")) return agreements;
  const invoices: InvoiceDocument[] = (await listBillingInvoices(ctx)).map(
    (i) => ({
      kind: "invoice",
      id: i.id,
      label: i.number ? `Invoice ${i.number}` : "Invoice",
      date: i.issuedAt,
      status: i.status,
      amountCents: i.amountCents,
      href: i.hostedUrl,
    }),
  );
  // Stable merge: each list is already newest first; ties keep agreements first.
  return [...agreements, ...invoices].sort(
    (a, b) => documentDate(b) - documentDate(a),
  );
}

const RECORD_ID = /^[a-z0-9]{15}$/;

export type SignedCopy = {
  bytes: Uint8Array;
  filename: string;
  signedAt: string;
};

/**
 * The stored HTML copy of one signature. Tenants: OrgContext with `agreements:read`, org from
 * ctx (an `orgId` argument is ignored). Staff: PlatformContext with `agreements_verify` and an
 * explicit `orgId`, audited as `agreement.download_staff` (choice 2). Lookup is by id AND org,
 * so another org's id is null; a missing object is null (the route shows ERR-DOWNLOAD).
 */
export async function readSignedCopy(
  ctx: OrgContext | PlatformContext,
  signatureId: string,
  orgId?: string,
  deps: { store?: WriteOnceObjectStore } = {},
): Promise<SignedCopy | null> {
  let org: string;
  let staff: PlatformContext | null = null;
  if (isOrgContext(ctx)) {
    authorize(ctx, "agreements", "read");
    org = ctx.orgId;
  } else {
    assertPlatformContext(ctx);
    authorizeStaff(ctx.staffRole, "agreements_verify");
    if (typeof orgId !== "string" || !RECORD_ID.test(orgId)) {
      throw new InvalidInput("organization id is required for a staff read");
    }
    org = orgId;
    staff = ctx;
  }
  if (typeof signatureId !== "string" || !RECORD_ID.test(signatureId)) {
    return null;
  }
  const found = await withSuperuser(async (pb) => {
    const list = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter("id = {:id} && organization = {:org}", {
        id: signatureId,
        org,
      }),
      fields: "id,document_key,signed_at,org_name",
    });
    const row = list.items[0];
    if (!row) return null;
    // The org row is optional (CR-A01): a deleted org's signatures are kept 7 years, so the
    // file name falls back to the row's org_name snapshot (signedCopyFilename slugifies it).
    const orgs = await pb.collection("organizations").getList(1, 1, {
      filter: pb.filter("id = {:org}", { org }),
      fields: "id,slug",
    });
    const o = orgs.items[0];
    return {
      documentKey: String(row.document_key ?? ""),
      signedAt: isoOf(row.signed_at),
      slug: o ? String(o.slug ?? "") : String(row.org_name ?? ""),
      orgDeleted: !o,
    };
  }).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
  if (!found || found.documentKey === "" || found.signedAt === "") return null;

  // The key comes from the row (never the client) and must be this org's html copy.
  if (found.documentKey !== tenantAgreementKey(org, signatureId, "html")) {
    console.error(`[legal] signed copy key mismatch for ${signatureId}`);
    return null;
  }
  const store = deps.store ?? getAgreementStore();
  const bytes = await store.get(found.documentKey).catch(() => null);
  if (!bytes) {
    console.error(`[legal] signed copy missing for ${signatureId}`);
    return null;
  }
  if (staff) {
    await appendAudit(staff, {
      action: "agreement.download_staff",
      // A relation to a deleted org would fail validation; meta.org keeps the id.
      organization: found.orgDeleted ? null : org,
      targetCollection: COLLECTION,
      targetId: signatureId,
      meta: { org, org_deleted: found.orgDeleted },
    });
  }
  return {
    bytes,
    filename: signedCopyFilename(found.slug, found.signedAt),
    signedAt: found.signedAt,
  };
}
