// packages/db/src/dns/records.ts (P14, DOM-03).
// Owner: 14-28 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Owner DNS self-service (D119, D-UI-P14-3, D-UI-P14-19, D-UI-P14-26): a classified read view
// of the CDS zone, safe add/remove of verification records, guided email setup and the main
// address choice (P14-P16). Every function takes only a context and resolves its org with
// `scopedOrgId(ctx)` (P14-P34): a record id from another org's zone is never touched.
//
// Writes: `dnsOpen()` else DOM_CLOSED; `domain:write` (Owner; staff may act under
// impersonation and are audited as the impersonator, P14-P12; Admin refused); the pure
// `ownerRecordPolicy` and a class re-check run before any provider write. Audit meta carries
// the record type and name only, never its value (T-14-28-04). Errors are logged by class.
import { authorize, CdsError, InvalidInput, NotFound } from "@cds/core";
import {
  canonicalValue,
  classifyRecord,
  detectMailProvider,
  EMAIL_PRESETS,
  fqdn,
  mailProvider,
  ownerRecordPolicy,
  P14_COPY,
  presetRecords,
  recordKey,
  type DnsRecord,
  type EmailPresetId,
  type OwnerRecordCode,
  type PresetRecordsResult,
  type RecordClass,
  type RType,
} from "@cds/core/dns";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { scopedOrgId, type OrgContext } from "../context";
import { computeAcceptedEmailHash } from "../email/sending-domains/ensure";
import { requirePermission } from "../repository";
import { forgetHost } from "./edge";
import { dnsOpen, getDnsProvider } from "./factory";
import type { DnsProvider, ProviderRecord } from "./ports";
import {
  DNS_ZONES_COLLECTION,
  toDnsZoneRow,
  type DnsZoneRow,
} from "./snapshot";

const MOVES = "domain_moves";

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------

export type OwnerRecordLabel = "cds" | "email" | "yours";
export type OwnerRecordGroupKey =
  "email" | "verification" | "site" | "sending" | "other";

/** Fixed UI order (UI-SPEC DNS records). */
export const OWNER_RECORD_GROUPS: readonly OwnerRecordGroupKey[] =
  Object.freeze(["email", "verification", "site", "sending", "other"]);

export type OwnerRecordRow = {
  /** The DNS host's record id (only valid inside this org's zone). */
  id: string;
  type: RType;
  name: string;
  value: string;
  priority?: number;
  label: OwnerRecordLabel;
  removable: boolean;
  /** Just written; shown as "Checking" until the next read. */
  pending: boolean;
};

export type OwnerDnsRecordsView = {
  domain: string;
  groups: { key: OwnerRecordGroupKey; records: OwnerRecordRow[] }[];
  canEdit: boolean;
};

/** An owner write refused by policy (UI maps `reason` to the field error). */
export class OwnerRecordRefused extends InvalidInput {
  readonly reason: OwnerRecordCode | "class";
  constructor(reason: OwnerRecordCode | "class", message: string) {
    super(message);
    this.reason = reason;
  }
}

/** A provider write failed part-way through email setup (EMAIL-WRITE-FAILED). */
export class EmailSetupWriteFailed extends CdsError {
  override readonly code = "email_write_failed";
  /** Records already written before the failure (left in place, counted in the audit). */
  readonly written: number;
  constructor(written: number) {
    super(P14_COPY.EMAIL_WRITE_FAILED);
    this.written = written;
  }
}

const POLICY_COPY: Record<OwnerRecordCode, string> = {
  name_invalid: P14_COPY.REC_NAME_INVALID,
  value_empty: P14_COPY.REC_VALUE_EMPTY,
  exists: P14_COPY.REC_EXISTS,
  protected: P14_COPY.REC_PROTECTED,
  spf: P14_COPY.REC_SPF,
  // TXT and CNAME are the only types the UI offers (REC-MX has no copy of its own).
  type: P14_COPY.REC_PROTECTED,
};

// ---------------------------------------------------------------------------------------
// Zone lookup (choice 1)
// ---------------------------------------------------------------------------------------

type OrgZone = { row: DnsZoneRow; zoneId: string };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** True when an open move of this org for `domain` has finished its zone step. */
async function zoneStepDone(
  pb: PocketBase,
  orgId: string,
  domain: string,
): Promise<boolean> {
  const moves = await pb.collection(MOVES).getFullList({
    filter: pb.filter(
      "org_id = {:org} && to_host = {:d} && status != 'cancelled'",
      { org: orgId, d: domain },
    ),
    fields: "id,steps",
  });
  return moves.some((m) => {
    const steps = Array.isArray(m.steps) ? (m.steps as unknown[]) : [];
    return steps.some((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return o.key === "zone" && o.status === "done";
    });
  });
}

/**
 * The org's CDS zone the owner sees: an `active` row first; else a `pending` row whose copy
 * exists (a move past step 2). Null when there is none (the UI hides the view).
 */
async function orgZone(orgId: string): Promise<OrgZone | null> {
  return withSuperuser(async (pb) => {
    const rows: RecordModel[] = await pb
      .collection(DNS_ZONES_COLLECTION)
      .getFullList({
        filter: pb.filter(
          "org_id = {:org} && (status = 'active' || status = 'pending')",
          { org: orgId },
        ),
        sort: "-updated",
      });
    const zones = rows
      .map(toDnsZoneRow)
      .filter((z) => z.orgId === orgId && z.providerZoneId);
    const active = zones.find((z) => z.status === "active");
    if (active) return { row: active, zoneId: active.providerZoneId as string };
    for (const z of zones) {
      if (await zoneStepDone(pb, orgId, z.domain)) {
        return { row: z, zoneId: z.providerZoneId as string };
      }
    }
    return null;
  });
}

function stripId(r: ProviderRecord): DnsRecord {
  const { id: _id, ...rest } = r;
  void _id;
  return rest;
}

// ---------------------------------------------------------------------------------------
// Classification (choice 1)
// ---------------------------------------------------------------------------------------

function groupAndLabel(
  r: DnsRecord,
  domain: string,
  cdsKeys: ReadonlySet<string>,
  ownerKeys: ReadonlySet<string>,
): { group: OwnerRecordGroupKey; label: OwnerRecordLabel; cls: RecordClass } {
  const cls = classifyRecord(r, domain, { cdsKeys });
  if (cls === "cds") {
    // CDS's own records: site records stay with the site; SES DKIM, `send.` and a CDS
    // `_dmarc` are the sending group; anything else (CAA) is "other".
    const plain = classifyRecord(r, domain);
    const group: OwnerRecordGroupKey =
      plain === "site" ? "site" : plain === "email" ? "sending" : "other";
    return { group, label: "cds", cls };
  }
  if (cls === "email") return { group: "email", label: "email", cls };
  if (cls === "site") return { group: "site", label: "cds", cls };
  if (cls === "verification") {
    return { group: "verification", label: "yours", cls };
  }
  // Owner-added CNAMEs are verification records (UI-SPEC "Yours · verification").
  if (r.type === "CNAME" && ownerKeys.has(recordKey(r))) {
    return { group: "verification", label: "yours", cls };
  }
  return { group: "other", label: "yours", cls };
}

function isRemovable(
  r: DnsRecord,
  cls: RecordClass,
  ownerKeys: ReadonlySet<string>,
): boolean {
  if (cls === "verification" && r.type === "TXT") return true;
  return (
    r.type === "CNAME" &&
    (cls === "other" || cls === "verification") &&
    ownerKeys.has(recordKey(r))
  );
}

function toRow(
  r: ProviderRecord,
  domain: string,
  cdsKeys: ReadonlySet<string>,
  ownerKeys: ReadonlySet<string>,
  pending = false,
): { group: OwnerRecordGroupKey; row: OwnerRecordRow } {
  const plain = stripId(r);
  const { group, label, cls } = groupAndLabel(
    plain,
    domain,
    cdsKeys,
    ownerKeys,
  );
  const row: OwnerRecordRow = {
    id: r.id,
    type: r.type,
    name: fqdn(r.name),
    value: canonicalValue(plain),
    label,
    removable: isRemovable(plain, cls, ownerKeys),
    pending,
  };
  if (r.priority !== undefined) row.priority = r.priority;
  return { group, row };
}

function canWrite(ctx: OrgContext): boolean {
  if (!dnsOpen()) return false;
  try {
    authorize(ctx, "domain", "write");
    return true;
  } catch {
    return false;
  }
}

/**
 * Every record of the org's CDS zone, classified and grouped (D-UI-P14-3). Owners and
 * Admins read; `canEdit` is true only for a writer while DNS is open. Null without a zone.
 */
export async function ownerDnsRecords(
  ctx: OrgContext,
  deps: { provider?: DnsProvider } = {},
): Promise<OwnerDnsRecordsView | null> {
  const orgId = scopedOrgId(ctx);
  requirePermission(ctx, "domain", "read");
  const zone = await orgZone(orgId);
  if (!zone) return null;
  const provider = deps.provider ?? getDnsProvider();
  const records = await provider.listRecords(zone.zoneId);
  const cdsKeys = new Set(zone.row.cdsKeys.cds);
  const ownerKeys = new Set(zone.row.cdsKeys.owner);
  const byGroup = new Map<OwnerRecordGroupKey, OwnerRecordRow[]>(
    OWNER_RECORD_GROUPS.map((k) => [k, []]),
  );
  for (const r of records) {
    const { group, row } = toRow(r, zone.row.domain, cdsKeys, ownerKeys);
    byGroup.get(group)?.push(row);
  }
  const sortKey = (r: OwnerRecordRow) =>
    `${r.name}\u0000${r.type}\u0000${String(r.priority ?? 0).padStart(5, "0")}\u0000${r.value}`;
  return {
    domain: zone.row.domain,
    groups: OWNER_RECORD_GROUPS.map((key) => ({
      key,
      records: (byGroup.get(key) ?? []).sort((a, b) =>
        sortKey(a) < sortKey(b) ? -1 : 1,
      ),
    })),
    canEdit: canWrite(ctx),
  };
}

// ---------------------------------------------------------------------------------------
// Writes (choice 2)
// ---------------------------------------------------------------------------------------

function assertWritable(ctx: OrgContext): string {
  const orgId = scopedOrgId(ctx);
  requirePermission(ctx, "domain", "write");
  if (!dnsOpen()) throw new InvalidInput(P14_COPY.DOM_CLOSED);
  return orgId;
}

async function requireZone(orgId: string): Promise<OrgZone> {
  const zone = await orgZone(orgId);
  if (!zone) throw new NotFound();
  return zone;
}

async function writeZonePatch(
  ctx: OrgContext,
  zone: DnsZoneRow,
  patch: Record<string, unknown>,
  audit: { action: string; meta: Record<string, unknown> },
): Promise<void> {
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    batch.collection(DNS_ZONES_COLLECTION).update(zone.id, patch);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: audit.action,
        organization: zone.orgId,
        targetCollection: DNS_ZONES_COLLECTION,
        targetId: zone.id,
        meta: audit.meta,
      }),
    );
    await batch.send();
  });
}

function cdsKeysPatch(
  zone: DnsZoneRow,
  owner: readonly string[],
): Record<string, unknown> {
  return {
    cds_keys: { cds: [...zone.cdsKeys.cds], owner: [...new Set(owner)] },
  };
}

/**
 * Add one verification TXT or CNAME (D-UI-P14-19). Policy first, then the class re-check
 * (a record that would read as email, site or CDS is refused), then the provider write.
 */
export async function ownerAddRecord(
  ctx: OrgContext,
  input: { type: "TXT" | "CNAME"; name: string; value: string },
  deps: { provider?: DnsProvider } = {},
): Promise<OwnerRecordRow> {
  const orgId = assertWritable(ctx);
  const provider = deps.provider ?? getDnsProvider();
  return withOrgLock(orgId, async () => {
    const zone = await requireZone(orgId);
    const domain = zone.row.domain;
    const current = await provider.listRecords(zone.zoneId);
    const policy = ownerRecordPolicy(
      {
        type: String(input?.type ?? ""),
        name: String(input?.name ?? ""),
        value: String(input?.value ?? ""),
      },
      domain,
      current.map(stripId),
    );
    if (!policy.ok) {
      throw new OwnerRecordRefused(policy.code, POLICY_COPY[policy.code]);
    }
    const record: DnsRecord = { ...policy.record, ttl: 3600 };
    const cdsKeys = new Set(zone.row.cdsKeys.cds);
    const cls = classifyRecord(record, domain, { cdsKeys });
    const allowed =
      record.type === "TXT" ? cls === "verification" : cls === "other";
    if (!allowed) {
      throw new OwnerRecordRefused("class", P14_COPY.REC_PROTECTED);
    }
    const stored = await provider.upsertRecord(zone.zoneId, record);
    const owner = [...zone.row.cdsKeys.owner];
    if (record.type === "CNAME") owner.push(recordKey(record));
    await writeZonePatch(ctx, zone.row, cdsKeysPatch(zone.row, owner), {
      action: "dns.record_added",
      meta: { type: record.type, name: record.name },
    });
    return toRow(stored, domain, cdsKeys, new Set(owner), true).row;
  });
}

/**
 * Remove one owner record by the DNS host's id. Only an id present in this org's own zone
 * listing is considered (else NotFound, P14-P34), and only a verification TXT or an
 * owner-added CNAME may go (else REC-PROTECTED).
 */
export async function ownerRemoveRecord(
  ctx: OrgContext,
  recordId: string,
  deps: { provider?: DnsProvider } = {},
): Promise<void> {
  const orgId = assertWritable(ctx);
  if (typeof recordId !== "string" || !recordId || recordId.length > 100) {
    throw new NotFound();
  }
  const provider = deps.provider ?? getDnsProvider();
  await withOrgLock(orgId, async () => {
    const zone = await requireZone(orgId);
    const current = await provider.listRecords(zone.zoneId);
    const target = current.find((r) => r.id === recordId);
    if (!target) throw new NotFound();
    const plain = stripId(target);
    const cdsKeys = new Set(zone.row.cdsKeys.cds);
    const ownerKeys = new Set(zone.row.cdsKeys.owner);
    const cls = classifyRecord(plain, zone.row.domain, { cdsKeys });
    if (!isRemovable(plain, cls, ownerKeys)) {
      throw new OwnerRecordRefused("protected", P14_COPY.REC_PROTECTED);
    }
    await provider.deleteRecord(zone.zoneId, target.id);
    const key = recordKey(plain);
    const owner = zone.row.cdsKeys.owner.filter((k) => k !== key);
    await writeZonePatch(ctx, zone.row, cdsKeysPatch(zone.row, owner), {
      action: "dns.record_removed",
      meta: { type: plain.type, name: fqdn(plain.name) },
    });
  });
}

// ---------------------------------------------------------------------------------------
// Email setup (choice 3)
// ---------------------------------------------------------------------------------------

export type EmailSetupValues = { verification?: string; dkim?: string };

export type EmailSetupPreview = PresetRecordsResult & {
  preset: EmailPresetId;
  provider: string;
  /** The current email provider's name (detected from the apex MX), or null. */
  currentProvider: string | null;
};

function presetId(preset: unknown): EmailPresetId {
  if (typeof preset !== "string" || !Object.hasOwn(EMAIL_PRESETS, preset)) {
    throw new InvalidInput("Unknown email provider");
  }
  return preset as EmailPresetId;
}

function currentProviderName(
  records: readonly DnsRecord[],
  domain: string,
): string | null {
  const mx = records.filter((r) => r.type === "MX" && fqdn(r.name) === domain);
  if (mx.length === 0) return null;
  const id = detectMailProvider(mx, domain);
  return id === null ? null : mailProvider(id).name;
}

function cleanValues(values: unknown): EmailSetupValues {
  const v = (values ?? {}) as Record<string, unknown>;
  const out: EmailSetupValues = {};
  if (typeof v.verification === "string") out.verification = v.verification;
  if (typeof v.dkim === "string") out.dkim = v.dkim;
  return out;
}

async function previewFor(
  zone: OrgZone,
  provider: DnsProvider,
  id: EmailPresetId,
  values: EmailSetupValues,
): Promise<{ preview: EmailSetupPreview; current: ProviderRecord[] }> {
  const current = await provider.listRecords(zone.zoneId);
  const plain = current.map(stripId);
  const result = presetRecords(id, zone.row.domain, values, plain);
  return {
    current,
    preview: {
      ...result,
      preset: id,
      provider: EMAIL_PRESETS[id].name,
      currentProvider: currentProviderName(plain, zone.row.domain),
    },
  };
}

/** What "Set up email for my domain" would write, against the live zone. No writes. */
export async function ownerEmailSetupPreview(
  ctx: OrgContext,
  preset: EmailPresetId,
  values: EmailSetupValues,
  deps: { provider?: DnsProvider } = {},
): Promise<EmailSetupPreview> {
  const orgId = scopedOrgId(ctx);
  requirePermission(ctx, "domain", "read");
  const id = presetId(preset);
  const zone = await requireZone(orgId);
  const provider = deps.provider ?? getDnsProvider();
  return (await previewFor(zone, provider, id, cleanValues(values))).preview;
}

const isSpf = (r: DnsRecord): boolean =>
  r.type === "TXT" && /^v=spf1(\s|$)/i.test(canonicalValue(r).trim());

function isDkimLike(r: DnsRecord, domain: string): boolean {
  const name = fqdn(r.name);
  return name !== domain;
}

/**
 * Write a preset (D-UI-P14-26). Replacing another provider's MX needs `replaceConfirmed`
 * (REPLACE-WARN). Order: remove old MX, add new MX, the one SPF (old removed, merged added),
 * DKIM and other named records, verification. A provider failure stops at once
 * (EmailSetupWriteFailed; earlier writes stay and are counted in the audit). Success
 * re-accepts the email-record hash so health sees no drift.
 */
export async function ownerApplyEmailSetup(
  ctx: OrgContext,
  preset: EmailPresetId,
  values: EmailSetupValues,
  opts: { replaceConfirmed: boolean },
  deps: { provider?: DnsProvider; now?: () => Date } = {},
): Promise<EmailSetupPreview> {
  const orgId = assertWritable(ctx);
  const id = presetId(preset);
  const provider = deps.provider ?? getDnsProvider();
  const now = deps.now ?? (() => new Date());
  return withOrgLock(orgId, async () => {
    const zone = await requireZone(orgId);
    const domain = zone.row.domain;
    const { preview, current } = await previewFor(
      zone,
      provider,
      id,
      cleanValues(values),
    );
    if (preview.replacesProvider !== null && opts?.replaceConfirmed !== true) {
      throw new InvalidInput(
        P14_COPY.REPLACE_WARN({
          current: preview.replacesProvider,
          next: preview.provider,
        }),
      );
    }
    const idOf = (r: DnsRecord): string | null =>
      current.find((c) => recordKey(c) === recordKey(r))?.id ?? null;
    const gone = [...preview.replace, ...preview.remove];
    const ops: (() => Promise<unknown>)[] = [];
    const del = (rs: DnsRecord[]) => {
      for (const r of rs) {
        const rid = idOf(r);
        if (rid) ops.push(() => provider.deleteRecord(zone.zoneId, rid));
      }
    };
    const put = (rs: DnsRecord[]) => {
      for (const r of rs) ops.push(() => provider.upsertRecord(zone.zoneId, r));
    };
    const verification = new Set(
      preview.add
        .filter((r) => r.type === "TXT" && fqdn(r.name) === domain && !isSpf(r))
        .map(recordKey),
    );
    // 1-2: MX
    del(gone.filter((r) => r.type === "MX"));
    put(preview.add.filter((r) => r.type === "MX"));
    // 3: the one SPF
    del(gone.filter((r) => isSpf(r) && fqdn(r.name) === domain));
    put(preview.add.filter((r) => isSpf(r) && fqdn(r.name) === domain));
    // 4: DKIM and other named records (autodiscover)
    del(gone.filter((r) => r.type !== "MX" && isDkimLike(r, domain)));
    put(preview.add.filter((r) => r.type !== "MX" && isDkimLike(r, domain)));
    // 5: verification
    put(preview.add.filter((r) => verification.has(recordKey(r))));

    let written = 0;
    for (const op of ops) {
      try {
        await op();
        written++;
      } catch (err) {
        console.error(
          `[dns] email setup write failed: ${err instanceof Error ? err.name : "Error"}`,
        );
        await writeZonePatch(
          ctx,
          zone.row,
          {},
          {
            action: "dns.email_setup_failed",
            meta: { preset: id, written },
          },
        );
        throw new EmailSetupWriteFailed(written);
      }
    }
    const after = await provider.listRecords(zone.zoneId);
    const hash = computeAcceptedEmailHash(
      after.map(stripId),
      domain,
      zone.row.cdsKeys.cds,
    );
    await writeZonePatch(
      ctx,
      zone.row,
      { accepted_email_hash: hash, accepted_at: now().toISOString() },
      { action: "dns.email_setup", meta: { preset: id, written } },
    );
    return preview;
  });
}

// ---------------------------------------------------------------------------------------
// Main address (choice 4, P14-P16)
// ---------------------------------------------------------------------------------------

export type PrimaryChoiceResult = {
  choice: "apex" | "www";
  /** True when the org is live and the org_hosts rows were swapped. */
  swapped: boolean;
  primary: string | null;
};

/**
 * The owner's main address. Before launch it is stored on the open (else last) move's
 * `primary_choice`; once live the chosen host becomes `custom primary` and the other a
 * `redirect` to it, in one batch with the audit row.
 */
export async function ownerSetPrimaryChoice(
  ctx: OrgContext,
  choice: "apex" | "www",
): Promise<PrimaryChoiceResult> {
  const orgId = assertWritable(ctx);
  if (choice !== "apex" && choice !== "www") {
    throw new InvalidInput("Choose the domain itself or www");
  }
  return withOrgLock(orgId, async () => {
    const result = await withSuperuser(async (pb) => {
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,stage" });
      const moves = await pb.collection(MOVES).getList(1, 20, {
        filter: pb.filter("org_id = {:org}", { org: orgId }),
        sort: "-created",
      });
      const open = moves.items.find(
        (m) => m.status !== "done" && m.status !== "cancelled",
      );
      const lastDone = moves.items.find((m) => m.status === "done");
      const move = open ?? moves.items[0] ?? null;
      const live = org.stage === "live";

      if (!live) {
        if (!move) throw new NotFound();
        const batch = pb.createBatch();
        batch.collection(MOVES).update(move.id, { primary_choice: choice });
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "domain.primary_changed",
            organization: orgId,
            targetCollection: MOVES,
            targetId: move.id,
            meta: { choice, live: false },
          }),
        );
        await batch.send();
        return { choice, swapped: false, primary: null, hosts: [] as string[] };
      }

      // Live: the domain is the last finished move's (else the current custom primary's).
      const hosts = await pb.collection("org_hosts").getFullList({
        filter: pb.filter("organization = {:org}", { org: orgId }),
      });
      const currentPrimary = hosts.find(
        (h) => h.primary === true && h.kind === "custom",
      );
      const domain = lastDone
        ? fqdn(str(lastDone.to_host))
        : currentPrimary
          ? fqdn(str(currentPrimary.hostname)).replace(/^www\./, "")
          : "";
      if (!domain) throw new NotFound();
      const apex = domain;
      const www = `www.${domain}`;
      const primary = choice === "www" ? www : apex;
      const secondary = choice === "www" ? apex : www;
      const pRow = hosts.find((h) => str(h.hostname) === primary);
      const sRow = hosts.find((h) => str(h.hostname) === secondary);
      if (
        !pRow ||
        !sRow ||
        str(pRow.verified_at) === "" ||
        str(sRow.verified_at) === ""
      ) {
        throw new NotFound();
      }
      const oldPrimary = currentPrimary ? str(currentPrimary.hostname) : null;
      const batch = pb.createBatch();
      const touched: string[] = [];
      for (const h of hosts) {
        const host = str(h.hostname);
        let want: Record<string, unknown> | null = null;
        if (h.id === pRow.id) {
          want = { primary: true, kind: "custom", redirect_to: "" };
        } else if (h.id === sRow.id) {
          want = { primary: false, kind: "redirect", redirect_to: primary };
        } else if (h.kind === "redirect" && str(h.redirect_to) === oldPrimary) {
          // Older hosts that sent visitors to the old main address follow it (no chains).
          want = { redirect_to: primary };
        } else if (h.primary === true) {
          want = { primary: false };
        }
        if (!want) continue;
        const changed = Object.entries(want).some(([k, v]) =>
          k === "primary" ? (h.primary === true) !== v : str(h[k]) !== v,
        );
        if (!changed) continue;
        batch.collection("org_hosts").update(h.id, want);
        touched.push(host);
      }
      if (lastDone) {
        batch.collection(MOVES).update(lastDone.id, { primary_choice: choice });
      }
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "domain.primary_changed",
          organization: orgId,
          targetCollection: "org_hosts",
          targetId: pRow.id,
          meta: { choice, live: true, hosts: touched.length },
        }),
      );
      await batch.send();
      return {
        choice,
        swapped: true,
        primary,
        hosts: [primary, secondary, ...touched],
      };
    });
    for (const h of new Set(result.hosts)) forgetHost(h);
    return {
      choice: result.choice,
      swapped: result.swapped,
      primary: result.primary,
    };
  });
}
