// packages/db/src/email/sending-domains/ensure.ts (P14, ONB-10).
// Owner: 14-24 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Own-domain sending, infrastructure half (14-24 choices 4-6; D112, P14-P19, P14-P39):
//   - only for an org with an `active` CDS zone (delegation proves control, T-14-24-02), never
//     the demo org, never in `closed` mode;
//   - writes the three SES DKIM CNAMEs and the custom MAIL FROM `send.<domain>` (one MX + its
//     own SPF) into the tenant zone; `_dmarc` `p=none` only when the zone has no `_dmarc`;
//     never edits the apex SPF or an existing DMARC (RESEARCH Pitfall 8, T-14-24-01);
//   - every key written joins `dns_zones.cds_keys.cds`, then `accepted_email_hash` is
//     recomputed, so daily health never sees CDS's own records as email drift;
//   - verified -> `sending_status = verified`, `sending_domain_verified = true` (system writes
//     only, T-14-24-04); still pending 72 h after writing -> `failed` + one staff alert.
// Bookkeeping (written-at + the keys written) lives in platform_meta `sending:<orgId>`.
// Errors are logged by class name only.
import { createHash } from "node:crypto";
import { classifyRecord, fqdn, recordKey, type DnsRecord } from "@cds/core/dns";
import { InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { appendAudit } from "../../audit";
import { withSuperuser } from "../../client";
import { withOrgLock } from "../../content/lock";
import { mintSystemContext, type SystemContext } from "../../context";
import { orgIsDemo } from "../../demo/flag";
import { getDnsProvider } from "../../dns/factory";
import type { DnsProvider } from "../../dns/ports";
import { staffAlertAddress } from "../../media/ops/alerts";
import { readPlatformMeta, writePlatformMeta } from "../../platform-meta";
import { platformUrl } from "../env";
import { sendEmail } from "../send";
import type { EmailTransport } from "../transport";
import {
  getSendingDomains,
  sendingDomainsMode,
  sendingDomainsRegion,
} from "./factory";
import { SENDING_MAIL_FROM_LABEL, type SendingDomains } from "./ports";

export const SENDING_JOB = "domains:sending";
export const SENDING_DMARC_VALUE = "v=DMARC1; p=none";
/** SES verification can take up to 72 h (RESEARCH A3). */
export const SENDING_VERIFY_WINDOW_MS = 72 * 3_600_000;
const ADVANCE_CAP = 20;
const ORG_ID = /^[a-z0-9]{15}$/;
const TTL = 3600;

export type SendingDeps = {
  provider?: DnsProvider;
  sending?: SendingDomains;
  transport?: EmailTransport;
  /** SES region for the `send.` MX target; default `sendingDomainsRegion()`. */
  region?: string;
  now?: Date;
};

export type EnsureSendingResult =
  "written" | "pending" | "verified" | "failed" | "skipped";

/**
 * The CDS sending records for one domain (pure; also the DNS records view's "Sending email
 * from your domain" group). `<t>.dkim.amazonses.com` is RESEARCH A3 (a HUMAN-CHECK).
 */
export function sendingRecords(
  domain: string,
  tokens: readonly string[],
  region: string,
  opts: { withDmarc?: boolean } = {},
): DnsRecord[] {
  const d = fqdn(domain);
  const send = `${SENDING_MAIL_FROM_LABEL}.${d}`;
  const out: DnsRecord[] = tokens.map((t) => ({
    type: "CNAME",
    name: `${t}._domainkey.${d}`,
    value: `${t}.dkim.amazonses.com`,
    ttl: TTL,
    sources: ["cds"],
  }));
  out.push(
    {
      type: "MX",
      name: send,
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
      ttl: TTL,
      sources: ["cds"],
    },
    {
      type: "TXT",
      name: send,
      value: "v=spf1 include:amazonses.com ~all",
      ttl: TTL,
      sources: ["cds"],
    },
  );
  if (opts.withDmarc) {
    out.push({
      type: "TXT",
      name: `_dmarc.${d}`,
      value: SENDING_DMARC_VALUE,
      ttl: TTL,
      sources: ["cds"],
    });
  }
  return out;
}

/**
 * sha256 (hex) of the sorted recordKeys of the zone's email-class records, with CDS-managed
 * keys classified `cds` first (P14-P39). The value stored in `dns_zones.accepted_email_hash`.
 */
export function computeAcceptedEmailHash(
  records: readonly DnsRecord[],
  domain: string,
  cdsKeys: Iterable<string>,
): string {
  const ctx = { cdsKeys: new Set(cdsKeys) };
  const keys = [
    ...new Set(
      records
        .filter((r) => classifyRecord(r, domain, ctx) === "email")
        .map((r) => recordKey(r)),
    ),
  ].sort();
  return createHash("sha256").update(keys.join("\n")).digest("hex");
}

type CdsKeys = { cds: string[]; owner: string[] } & Record<string, unknown>;

function cdsKeysOf(zone: RecordModel): CdsKeys {
  const raw = (zone.cds_keys ?? {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return { ...raw, cds: list(raw.cds), owner: list(raw.owner) };
}

type Bookkeeping = { domain: string; at: string; keys: string[] };

function metaKey(orgId: string): string {
  return `sending:${orgId}`;
}

async function readBook(orgId: string): Promise<Bookkeeping | null> {
  const v = await readPlatformMeta(metaKey(orgId));
  if (!v) return null;
  try {
    const j = JSON.parse(v) as Bookkeeping;
    return typeof j.at === "string" && Array.isArray(j.keys) ? j : null;
  } catch {
    return null;
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function systemCtx(): SystemContext {
  return mintSystemContext({ job: SENDING_JOB });
}

async function activeZone(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel | null> {
  return pb
    .collection("dns_zones")
    .getFirstListItem(
      pb.filter("org_id = {:org} && status = 'active'", { org: orgId }),
      { sort: "-delegated_at,-updated" },
    )
    .catch(() => null);
}

async function profileOf(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel | null> {
  return pb
    .collection("business_profile")
    .getFirstListItem(pb.filter("organization = {:org}", { org: orgId }))
    .catch(() => null);
}

/**
 * WR-A08: read-modify-write of `cds_keys` against the row as it is now (never a copy read at
 * the start of the run), so a concurrent owner or move write is not lost. Callers hold the
 * org lock, like every other cds_keys writer.
 */
async function patchCdsKeys(
  pb: PocketBase,
  zoneRowId: string,
  mutate: (cds: CdsKeys) => CdsKeys,
): Promise<{ zone: RecordModel; cds: CdsKeys }> {
  const zone = await pb.collection("dns_zones").getOne(zoneRowId);
  const cds = mutate(cdsKeysOf(zone));
  await pb.collection("dns_zones").update(zone.id, { cds_keys: cds });
  return { zone, cds };
}

/** Store the zone's CDS keys (re-read first, WR-A08) and re-accept its email hash. */
async function storeKeysAndHash(
  pb: PocketBase,
  zoneRowId: string,
  provider: DnsProvider,
  mutate: (cds: CdsKeys) => CdsKeys,
  now: Date,
): Promise<void> {
  const zone = await pb.collection("dns_zones").getOne(zoneRowId);
  const records = await provider.listRecords(String(zone.provider_zone_id));
  const cds = mutate(cdsKeysOf(zone));
  await pb.collection("dns_zones").update(zone.id, {
    cds_keys: cds,
    accepted_email_hash: computeAcceptedEmailHash(
      records,
      String(zone.domain),
      cds.cds,
    ),
    accepted_at: now.toISOString(),
  });
}

async function alertStaff(
  pb: PocketBase,
  orgId: string,
  domain: string,
  transport?: EmailTransport,
): Promise<void> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn("[sending-domains] alert not sent: no staff alert address");
    return;
  }
  let business = orgId;
  try {
    const org = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,name" });
    if (typeof org.name === "string" && org.name !== "") business = org.name;
  } catch {
    // The id is enough for staff to act on.
  }
  try {
    await sendEmail(
      { kind: "cds", ctx: systemCtx() },
      "staff.domain_alert",
      to,
      {
        kind: "move_failed",
        business,
        orgId,
        domain,
        href: platformUrl(`/staff/sites/${orgId}`),
      },
      transport ? { transport } : {},
    );
  } catch (err) {
    console.error(`[sending-domains] staff alert not sent: ${errName(err)}`);
  }
}

async function markFailed(
  pb: PocketBase,
  orgId: string,
  profile: RecordModel,
  domain: string,
  deps: SendingDeps,
): Promise<"failed"> {
  await pb.collection("business_profile").update(profile.id, {
    sending_status: "failed",
    sending_domain_verified: false,
  });
  await appendAudit(systemCtx(), {
    action: "email.sending_failed",
    organization: orgId,
    targetCollection: "business_profile",
    targetId: profile.id,
  });
  await alertStaff(pb, orgId, domain, deps.transport);
  return "failed";
}

/**
 * Delete `domain`'s SES identity and the CDS sending records the bookkeeping lists from the
 * org's zone for `book.domain` (or `domain`), dropping their keys and re-accepting the email
 * hash. Shared by removeSendingDomain and a domain change (WR-A09). Caller holds the lock.
 */
async function dropSending(
  pb: PocketBase,
  orgId: string,
  domain: string,
  book: Bookkeeping | null,
  deps: SendingDeps,
  now: Date,
): Promise<void> {
  if (domain !== "") {
    const sending =
      deps.sending ??
      (sendingDomainsMode() === "closed" ? null : getSendingDomains());
    if (sending) await sending.deleteIdentity(domain);
  }
  const zoneDomain = book?.domain || domain;
  if (!book || zoneDomain === "") return;
  const zone = await pb
    .collection("dns_zones")
    .getFirstListItem(
      pb.filter("org_id = {:org} && domain = {:d}", {
        org: orgId,
        d: zoneDomain,
      }),
    )
    .catch(() => null);
  if (!zone?.provider_zone_id) return;
  const provider = deps.provider ?? getDnsProvider();
  const zoneId = String(zone.provider_zone_id);
  const drop = new Set(book.keys);
  for (const r of await provider.listRecords(zoneId)) {
    if (drop.has(recordKey(r))) await provider.deleteRecord(zoneId, r.id);
  }
  await storeKeysAndHash(
    pb,
    zone.id,
    provider,
    (c) => ({ ...c, cds: c.cds.filter((k) => !drop.has(k)) }),
    now,
  );
}

/**
 * Advance own-domain sending for one org (14-24 choice 5). System-only: no owner can call it
 * (the job step `sending`, 14-41). Returns what happened.
 */
export async function ensureSendingDomain(
  orgId: string,
  deps: SendingDeps = {},
): Promise<EnsureSendingResult> {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    throw new InvalidInput("invalid organization id");
  }
  if (!deps.sending && sendingDomainsMode() === "closed") return "skipped";
  if (await orgIsDemo(orgId)) return "skipped";
  const now = deps.now ?? new Date();

  // WR-A08: under the org lock, like the owner record flows and the move runner.
  return withOrgLock(orgId, () =>
    withSuperuser(async (pb) => {
      const zone = await activeZone(pb, orgId);
      if (!zone || !zone.provider_zone_id) return "skipped";
      const profile = await profileOf(pb, orgId);
      if (!profile) return "skipped";
      const domain = fqdn(String(zone.domain));
      const sending = deps.sending ?? getSendingDomains();
      const status = String(profile.sending_status ?? "");
      const current = String(profile.sending_domain ?? "");

      if (current !== domain || status === "" || status === "none") {
        // ---- write: identity + records + keys + hash + profile (pending)
        if (current !== "" && current !== domain) {
          // WR-A09: the active domain changed (a post-launch move). Remove the old SES
          // identity and the old zone's sending records before the bookkeeping is replaced,
          // else they stay verified for a domain the tenant may no longer control. A failure
          // throws: the job logs it and retries the whole write next run.
          await dropSending(
            pb,
            orgId,
            current,
            await readBook(orgId),
            deps,
            now,
          );
          await appendAudit(systemCtx(), {
            action: "email.sending_removed",
            organization: orgId,
            targetCollection: "business_profile",
            targetId: profile.id,
            meta: { replaced: true },
          });
        }
        const provider = deps.provider ?? getDnsProvider();
        const zoneId = String(zone.provider_zone_id);
        const identity = await sending.createIdentity(domain);
        const existing = await provider.listRecords(zoneId);
        const hasDmarc = existing.some(
          (r) => fqdn(r.name) === `_dmarc.${domain}`,
        );
        const records = sendingRecords(
          domain,
          identity.dkimTokens,
          deps.region ?? sendingDomainsRegion(),
          { withDmarc: !hasDmarc },
        );
        const keys = records.map((r) => recordKey(r));
        // Keys first: should a write below fail, health still classifies them as CDS's.
        const addKeys = (c: CdsKeys): CdsKeys => ({
          ...c,
          cds: [...new Set([...c.cds, ...keys])],
        });
        await patchCdsKeys(pb, zone.id, addKeys);
        for (const r of records) await provider.upsertRecord(zoneId, r);
        await storeKeysAndHash(pb, zone.id, provider, addKeys, now);
        await pb.collection("business_profile").update(profile.id, {
          sending_domain: domain,
          sending_status: "pending",
          sending_domain_verified: false,
        });
        const book: Bookkeeping = { domain, at: now.toISOString(), keys };
        await writePlatformMeta(
          systemCtx(),
          metaKey(orgId),
          JSON.stringify(book),
        );
        await appendAudit(systemCtx(), {
          action: "email.sending_records_written",
          organization: orgId,
          targetCollection: "dns_zones",
          targetId: zone.id,
          meta: { records: records.length, dmarc: !hasDmarc },
        });
        return "written";
      }

      if (status === "verified") return "verified";
      if (status === "failed") return "failed";

      // ---- pending: poll the provider
      const s = await sending.status(domain);
      if (s === "verified") {
        await pb.collection("business_profile").update(profile.id, {
          sending_status: "verified",
          sending_domain_verified: true,
        });
        await appendAudit(systemCtx(), {
          action: "email.sending_verified",
          organization: orgId,
          targetCollection: "business_profile",
          targetId: profile.id,
        });
        return "verified";
      }
      if (s === "failed") return markFailed(pb, orgId, profile, domain, deps);
      const book = await readBook(orgId);
      const at = book ? Date.parse(book.at) : NaN;
      if (
        Number.isFinite(at) &&
        now.getTime() - at > SENDING_VERIFY_WINDOW_MS
      ) {
        return markFailed(pb, orgId, profile, domain, deps);
      }
      return "pending";
    }),
  );
}

/**
 * Job step `sending` (P14-P18): every org with an active zone whose sending is not verified
 * or failed, at most 20 per run. A failing org is logged by class name and skipped.
 */
export async function advanceSendingDomains(
  opts: { now?: Date; dryRun?: boolean; deps?: SendingDeps } = {},
): Promise<{ updated: number; verified: number; failed: number }> {
  const counts = { updated: 0, verified: 0, failed: 0 };
  if (!opts.deps?.sending && sendingDomainsMode() === "closed") return counts;
  const candidates = await withSuperuser(async (pb) => {
    const zones = await pb.collection("dns_zones").getFullList({
      filter: "status = 'active'",
      fields: "org_id",
      sort: "updated",
    });
    const orgs: string[] = [];
    for (const z of zones) {
      const org = String(z.org_id ?? "");
      if (!ORG_ID.test(org) || orgs.includes(org)) continue;
      const p = await profileOf(pb, org);
      const st = String(p?.sending_status ?? "");
      if (!p || st === "verified" || st === "failed") continue;
      orgs.push(org);
      if (orgs.length >= ADVANCE_CAP) break;
    }
    return orgs;
  });
  if (opts.dryRun) return { ...counts, updated: candidates.length };
  const deps = { ...opts.deps, now: opts.now ?? opts.deps?.now };
  for (const org of candidates) {
    try {
      const r = await ensureSendingDomain(org, deps);
      if (r === "written") counts.updated += 1;
      else if (r === "verified") counts.verified += 1;
      else if (r === "failed") counts.failed += 1;
    } catch (err) {
      console.error(`[sending-domains] org step failed: ${errName(err)}`);
    }
  }
  return counts;
}

/**
 * Undo own-domain sending (offboarding, 14-39/40; choice 6): delete the identity and CDS's
 * sending records, drop their keys, set status `none`, clear the flag and `sending_domain`
 * (the owner's `sending_local_part` stays).
 */
export async function removeSendingDomain(
  orgId: string,
  deps: SendingDeps = {},
): Promise<void> {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    throw new InvalidInput("invalid organization id");
  }
  const now = deps.now ?? new Date();
  // WR-A08: under the org lock (the cds_keys writers all take it).
  await withOrgLock(orgId, () =>
    withSuperuser(async (pb) => {
      const profile = await profileOf(pb, orgId);
      const domain = String(profile?.sending_domain ?? "");
      const book = await readBook(orgId);
      await dropSending(pb, orgId, domain, book, deps, now);
      if (profile) {
        await pb.collection("business_profile").update(profile.id, {
          sending_domain: "",
          sending_status: "none",
          sending_domain_verified: false,
        });
      }
      if (book) await writePlatformMeta(systemCtx(), metaKey(orgId), "");
      if (profile && (domain !== "" || book)) {
        await appendAudit(systemCtx(), {
          action: "email.sending_removed",
          organization: orgId,
          targetCollection: "business_profile",
          targetId: profile.id,
        });
      }
    }),
  );
}

// 14-25 (ONB-10): the owner side of own-domain sending lives with the business profile
// (intake chokepoint); re-exported here so it reaches @cds/db through this module's
// `export *` without editing the fixed barrels (P14-P1).
export {
  getSendingView,
  setSendingLocalPart,
  SENDING_LOCAL_PART_AUDIT,
  type SendingState,
  type SendingView,
} from "../../intake/business-profile";
