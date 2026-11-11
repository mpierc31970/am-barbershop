// packages/db/src/dns/health.ts (P14, DOM-06, DOM-08).
// Owner: 14-27 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Daily domain health (14-27; D13, D56, D58; monitor brief rows 43, 44, 46). Run once a UTC
// day by the `health` step of `domains:run` (14-41 claims `domains:health:<date>`).
//
// For every `dns_zones` row `active` whose org is live (never the demo org, D293):
// - Main zone (its apex or www is the org's primary custom host):
//   (a) HTTPS through the edge on the primary host: ok + certificate days left;
//   (b) delegation: the public NS names equal the zone's assigned nameservers;
//   (c) email drift: the email-class records as 1.1.1.1 and 8.8.8.8 answer them, hashed like
//       `accepted_email_hash` (CDS's own writes and 14-28's owner flow re-accept it, P14-P39);
//   (d) registry expiry (RDAP) in days; `dns_zones.expires_at` follows it.
// - Any other active zone of a live org that only serves redirect rows (the old domain of a
//   move): when its delegation left CDS, the redirect rows are deleted, the zone becomes
//   `moved` and the audit row `domain.redirect_dropped` is the staff note (T-14-27-03).
//
// Incidents (T-14-27-01): one platform_meta key per (org, kind),
// `domains:incident:<org>:<kind>` = JSON `{ opened_at }`. Opening raises the alerts once;
// closing deletes the key and never writes to the owner. A check that could not be read
// (resolver error, no NS answer, no expiry) neither opens nor closes.
//   delegation_lost  owner urgent bell + email (Owners and Admins), staff `delegation_lost`
//   email_drift      staff only (staff.health_alert; open and resolved)
//   https_failing    staff only (staff.health_alert; open and resolved)
//   cert_low         staff only, certificate < 7 days (staff.health_alert)
//   expiry_30d       owner bell + email (30 days, normal), once
//   expiry_7d        owner urgent bell + email (7 days) + staff `expiry_7d`, once
// CDS holds the DNS, never the registration: expiry mail tells the owner to act at their
// registrar (DOM-04, D56). Counts go to platform_meta `domains:health:summary` (14-45).
// Errors are logged by class name only; no host, record value or address is logged.
import {
  classifyRecord,
  fqdn,
  NEEDS_YOU,
  normalizeRecord,
  P14_COPY,
  recordKey,
  registrarFromRdapName,
  registrarName,
  type DnsRecord,
  type RType,
  type StaffDomainAlertKind,
} from "@cds/core/dns";
import { ClientResponseError, type RecordModel } from "pocketbase";
import type PocketBase from "pocketbase";
import { composeAlertTypes } from "@cds/core/alerts";
import { raiseAlert } from "../alerts/raise";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { mintSystemContext, type SystemContext } from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import { computeAcceptedEmailHash } from "../email/sending-domains/ensure";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { readPlatformMeta, writePlatformMeta } from "../platform-meta";
import { forgetHost } from "./edge";
import {
  dnsOpen,
  getDnsProvider,
  getDnsResolver,
  getHttpsProber,
  getRegistryLookup,
} from "./factory";
import {
  PUBLIC_RESOLVERS,
  type DnsProvider,
  type DnsResolver,
  type HttpsProber,
  type RegistryLookup,
} from "./ports";

// ---------------------------------------------------------------------------------------
// Contract (14-41, 14-45)
// ---------------------------------------------------------------------------------------

export const DOMAIN_HEALTH_SUMMARY_KEY = "domains:health:summary";
export const DOMAIN_INCIDENT_PREFIX = "domains:incident:";
/** Certificate days left below this is a staff incident (brief row 43 warning). */
export const DOMAIN_CERT_WARN_DAYS = 7;

export type DomainIncidentKind =
  | "delegation_lost"
  | "email_drift"
  | "https_failing"
  | "cert_low"
  | "expiry_30d"
  | "expiry_7d";

/** The §4 `domains` health counts (14-01 contract). Counts and ISO times only. */
export type DomainHealthSummary = {
  https_failing: number;
  /** Fewest certificate days left across live custom hosts; null when none was read. */
  cert_min_days: number | null;
  delegation_lost: number;
  email_drift: number;
  /** Domains expiring within 30 days (includes those within 7). */
  expiring_30d: number;
  expiring_7d: number;
  /** Main zones checked. */
  checked: number;
  /** When the run finished (ISO). */
  at: string;
};

export type DomainHealthDeps = {
  provider?: DnsProvider;
  resolver?: DnsResolver;
  prober?: HttpsProber;
  registry?: RegistryLookup;
  transport?: EmailTransport;
};

export type DomainHealthResult = {
  summary: DomainHealthSummary;
  /** Incidents opened / closed this run (0 on a dry run). */
  opened: number;
  closed: number;
  /** Old redirect domains whose rows were dropped. */
  redirectsDropped: number;
  /** Zones whose check threw (class name logged). */
  errors: number;
  dryRun: boolean;
};

export function domainIncidentKey(
  orgId: string,
  kind: DomainIncidentKind,
): string {
  return `${DOMAIN_INCIDENT_PREFIX}${orgId}:${kind}`;
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const HUB_DOMAIN = "/hub/settings?tab=domain";
const DNS_ZONES = "dns_zones";
const sysCtx = (): SystemContext => mintSystemContext({ job: "domains" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function nsName(s: string): string {
  return s.trim().toLowerCase().replace(/\.$/, "");
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a.map(nsName));
  const y = new Set(b.map(nsName));
  if (x.size !== y.size) return false;
  for (const v of x) if (!y.has(v)) return false;
  return true;
}

function registrarDisplay(raw: string | null | undefined): string {
  const id = registrarFromRdapName(raw);
  if (id !== "other") return registrarName(id);
  const name = (raw ?? "").trim();
  return name !== "" ? name.slice(0, 80) : registrarName("other");
}

function staffHref(orgId: string): string {
  return platformUrl(`/staff/sites/${orgId}?tab=domain`);
}

// ---------------------------------------------------------------------------------------
// Incidents (platform_meta)
// ---------------------------------------------------------------------------------------

type Incident = { opened_at: string };

async function readIncident(key: string): Promise<Incident | null> {
  const raw = await readPlatformMeta(key);
  if (raw === null || raw === "") return null;
  try {
    const v = JSON.parse(raw) as { opened_at?: unknown };
    return { opened_at: str(v.opened_at) };
  } catch {
    return { opened_at: "" };
  }
}

async function deleteMetaKey(key: string): Promise<void> {
  await withSuperuser(async (pb) => {
    let row: RecordModel;
    try {
      row = await pb
        .collection("platform_meta")
        .getFirstListItem(pb.filter("key = {:key}", { key }));
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return;
      throw err;
    }
    try {
      await pb.collection("platform_meta").delete(row.id);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return;
      throw err;
    }
  });
}

/** A per-run tracker: open / close a kind once; a dry run only reads. */
type Tracker = {
  dryRun: boolean;
  now: Date;
  opened: number;
  closed: number;
};

/**
 * Make the incident match `on`. Returns "opened" when it was opened by this call (the caller
 * then raises its alerts), "closed" when closed, else null. `on === null` = unknown: no change.
 */
async function settle(
  t: Tracker,
  orgId: string,
  kind: DomainIncidentKind,
  on: boolean | null,
): Promise<{ change: "opened" | "closed" | null; since: Date | null }> {
  if (on === null) return { change: null, since: null };
  const key = domainIncidentKey(orgId, kind);
  const open = await readIncident(key);
  if (on && !open) {
    if (!t.dryRun) {
      await writePlatformMeta(
        sysCtx(),
        key,
        JSON.stringify({ opened_at: t.now.toISOString() }),
      );
      t.opened++;
    }
    return { change: "opened", since: t.now };
  }
  if (!on && open) {
    if (!t.dryRun) {
      await deleteMetaKey(key);
      t.closed++;
    }
    const at = Date.parse(open.opened_at);
    return {
      change: "closed",
      since: Number.isFinite(at) ? new Date(at) : t.now,
    };
  }
  return { change: null, since: null };
}

// ---------------------------------------------------------------------------------------
// Notices (best effort; never throw)
// ---------------------------------------------------------------------------------------

type Site = {
  orgId: string;
  business: string;
  domain: string;
  registrar: string;
};

async function memberAddresses(
  orgId: string,
  admins: boolean,
): Promise<string[]> {
  const rows = await withSuperuser((pb) =>
    pb.collection("memberships").getFullList({
      filter: pb.filter(
        admins
          ? "organization = {:org} && (role = 'owner' || role = 'admin')"
          : "organization = {:org} && role = 'owner'",
        { org: orgId },
      ),
      expand: "user",
      fields: "expand.user.email",
    }),
  );
  const out = new Set<string>();
  for (const r of rows) {
    const e = str((r.expand?.user as { email?: unknown } | undefined)?.email);
    if (e !== "") out.add(e);
  }
  return [...out];
}

async function staffDomainMail(
  site: Site,
  kind: StaffDomainAlertKind,
  deps: DomainHealthDeps,
): Promise<void> {
  try {
    const to = staffAlertAddress();
    if (!to) {
      console.warn("[domains] staff alert not sent: no staff alert address");
      return;
    }
    await sendEmail(
      { kind: "cds", ctx: sysCtx() },
      "staff.domain_alert",
      to,
      {
        kind,
        business: site.business,
        orgId: site.orgId,
        domain: site.domain,
        href: staffHref(site.orgId),
      },
      {
        ...(deps.transport ? { transport: deps.transport } : {}),
        concernsOrg: site.orgId,
      },
    );
  } catch (err) {
    console.error(`[domains] staff alert failed: ${errName(err)}`);
  }
}

/** Staff health mail for HTTPS and email drift (no StaffDomainAlertKind exists for them). */
async function staffHealthMail(
  site: Site,
  state: "open" | "close",
  component: string,
  reading: string,
  threshold: string,
  since: Date,
  deps: DomainHealthDeps,
): Promise<void> {
  try {
    const to = staffAlertAddress();
    if (!to) {
      console.warn("[domains] staff alert not sent: no staff alert address");
      return;
    }
    await sendEmail(
      { kind: "cds", ctx: sysCtx() },
      "staff.health_alert",
      to,
      {
        state,
        level: "warning",
        component: `${component} · site ${site.orgId}`,
        reading,
        threshold,
        since,
        href: staffHref(site.orgId),
      },
      {
        ...(deps.transport ? { transport: deps.transport } : {}),
        concernsOrg: site.orgId,
      },
    );
  } catch (err) {
    console.error(`[domains] staff alert failed: ${errName(err)}`);
  }
}

async function ownerLostDelegation(
  site: Site,
  now: Date,
  deps: DomainHealthDeps,
): Promise<void> {
  const c = NEEDS_YOU.lostDelegation({ domain: site.domain });
  await raiseAlert(
    { orgId: site.orgId, as: sysCtx() },
    {
      type: "domain.lost_delegation",
      sourceKey: `domain:health:lost:${now.toISOString().slice(0, 10)}`,
      title: P14_COPY.LOST_T({ domain: site.domain }) || c.title,
      safeTitle: "Your domain no longer points to us",
      href: HUB_DOMAIN,
      actionLabel: c.action,
    },
    {
      now,
      dedicatedEmail: true,
      ...(deps.transport ? { transport: deps.transport } : {}),
    },
  );
  try {
    for (const addr of await memberAddresses(site.orgId, true)) {
      await sendEmail(
        { kind: "cds", ctx: sysCtx() },
        "domain.lost_delegation",
        addr,
        {
          domain: site.domain,
          registrar: site.registrar,
          href: platformUrl(HUB_DOMAIN),
        },
        {
          ...(deps.transport ? { transport: deps.transport } : {}),
          concernsOrg: site.orgId,
        },
      );
    }
  } catch (err) {
    console.error(`[domains] owner mail failed: ${errName(err)}`);
  }
}

async function ownerExpiry(
  site: Site,
  days: 30 | 7,
  expiresAt: string,
  now: Date,
  deps: DomainHealthDeps,
): Promise<void> {
  const date = DAY_MONTH.format(new Date(expiresAt));
  const c = NEEDS_YOU["renew"]({
    domain: site.domain,
    registrar: site.registrar,
    date,
  });
  // The 30-day reminder is raised as normal; the type's own level (urgent) is the 7-day one.
  const types =
    days === 30
      ? composeAlertTypes([]).map((s) =>
          s.type === "domain.expiry" ? { ...s, level: "normal" as const } : s,
        )
      : undefined;
  await raiseAlert(
    { orgId: site.orgId, as: sysCtx() },
    {
      type: "domain.expiry",
      sourceKey: `domain:health:expiry_${days}:${expiresAt.slice(0, 10)}`,
      title: c.title,
      safeTitle: "Your domain expires soon",
      href: HUB_DOMAIN,
      actionLabel: c.action,
    },
    {
      now,
      dedicatedEmail: true,
      ...(types ? { types } : {}),
      ...(deps.transport ? { transport: deps.transport } : {}),
    },
  );
  try {
    for (const addr of await memberAddresses(site.orgId, false)) {
      await sendEmail(
        { kind: "cds", ctx: sysCtx() },
        "domain.expiry",
        addr,
        {
          domain: site.domain,
          registrar: site.registrar,
          href: platformUrl(HUB_DOMAIN),
          days,
          expiresOn: new Date(expiresAt),
        },
        {
          ...(deps.transport ? { transport: deps.transport } : {}),
          concernsOrg: site.orgId,
        },
      );
    }
  } catch (err) {
    console.error(`[domains] owner mail failed: ${errName(err)}`);
  }
}

// ---------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------

/** (c) true = drift, false = matches, null = could not read (or no accepted state). */
async function emailDrift(
  zone: RecordModel,
  domain: string,
  deps: Required<Pick<DomainHealthDeps, "provider" | "resolver">>,
): Promise<boolean | null> {
  const accepted = str(zone.accepted_email_hash);
  const zoneId = str(zone.provider_zone_id);
  if (accepted === "" || zoneId === "") return null;
  const keys = (zone.cds_keys ?? {}) as Record<string, unknown>;
  const cds = strings(keys.cds);
  const ctx = { cdsKeys: new Set(cds) };
  const d = fqdn(domain);

  // The names to ask: every email-class record CDS holds, plus the apex MX/TXT and _dmarc
  // (so a record added outside CDS shows up too).
  const slots = new Map<string, { name: string; type: RType }>();
  const add = (name: string, type: RType) =>
    slots.set(`${type}\u0000${fqdn(name)}`, { name: fqdn(name), type });
  add(d, "MX");
  add(d, "TXT");
  add(`_dmarc.${d}`, "TXT");
  for (const r of await deps.provider.listRecords(zoneId)) {
    if (classifyRecord(r, d, ctx) === "email") add(r.name, r.type);
  }

  for (const server of PUBLIC_RESOLVERS) {
    const seen: DnsRecord[] = [];
    for (const s of slots.values()) {
      const a = await deps.resolver.resolve(s.name, s.type, {
        servers: [server],
      });
      if (a.status === "error") return null;
      if (a.status !== "ok") continue;
      for (const r of a.records) {
        const n = normalizeRecord(r);
        // A CNAME answered for another type is only counted when CNAME was asked.
        if (n.type !== s.type) continue;
        seen.push(n);
      }
    }
    const unique = [...new Map(seen.map((r) => [recordKey(r), r])).values()];
    if (computeAcceptedEmailHash(unique, d, cds) !== accepted) return true;
  }
  return false;
}

/** Delete a CDS zone whose delegation has left; the row patch to write (WR-A06). */
async function dropZone(
  provider: DnsProvider,
  zoneId: string,
): Promise<Record<string, unknown>> {
  if (zoneId !== "") {
    try {
      await provider.deleteZone(zoneId);
    } catch (err) {
      console.error(`[domains] zone delete failed: ${errName(err)}`);
      return { status: "moved" };
    }
  }
  return { status: "deleted", provider_zone_id: "", nameservers: [] };
}

type HostRow = { id: string; hostname: string; kind: string; primary: boolean };

async function orgHosts(pb: PocketBase, orgId: string): Promise<HostRow[]> {
  const rows = await pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "id,hostname,kind,primary",
  });
  return rows.map((r) => ({
    id: r.id,
    hostname: str(r.hostname).toLowerCase(),
    kind: str(r.kind),
    primary: r.primary === true,
  }));
}

type OrgFacts = { live: boolean; business: string };

// ---------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------

/**
 * The daily health pass (14-27). `dryRun` reads and counts only: no incident, alert, mail,
 * row or summary is written.
 */
export async function runDomainHealth(
  opts: { now?: Date; dryRun?: boolean; deps?: DomainHealthDeps } = {},
): Promise<DomainHealthResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const deps = opts.deps ?? {};
  const t: Tracker = { dryRun, now, opened: 0, closed: 0 };
  const summary: DomainHealthSummary = {
    https_failing: 0,
    cert_min_days: null,
    delegation_lost: 0,
    email_drift: 0,
    expiring_30d: 0,
    expiring_7d: 0,
    checked: 0,
    at: now.toISOString(),
  };
  // WR-A01: with domains closed (production before Cloudflare is set up) no zone can be at
  // CDS. Record an empty pass instead of throwing DOM_CLOSED every run.
  if (!deps.provider && !dnsOpen()) {
    if (!dryRun) {
      await writePlatformMeta(
        sysCtx(),
        DOMAIN_HEALTH_SUMMARY_KEY,
        JSON.stringify(summary),
      );
    }
    return {
      summary,
      opened: 0,
      closed: 0,
      redirectsDropped: 0,
      errors: 0,
      dryRun,
    };
  }
  const provider = deps.provider ?? getDnsProvider();
  const resolver = deps.resolver ?? getDnsResolver();
  let redirectsDropped = 0;
  let errors = 0;

  // WR-A06: `moved` rows left by an earlier run (or a failed delete) are cleaned up first.
  if (!dryRun) {
    const moved = await withSuperuser((pb) =>
      pb.collection(DNS_ZONES).getFullList({
        filter: "status = 'moved'",
        fields: "id,provider_zone_id",
      }),
    );
    for (const z of moved) {
      try {
        const body = await dropZone(provider, str(z.provider_zone_id));
        if (body.status === "deleted") {
          await withSuperuser((pb) =>
            pb.collection(DNS_ZONES).update(z.id, body),
          );
        }
      } catch (err) {
        errors++;
        console.error(`[domains] moved zone not removed: ${errName(err)}`);
      }
    }
  }

  const zones = await withSuperuser((pb) =>
    pb.collection(DNS_ZONES).getFullList({
      filter: "status = 'active'",
      sort: "org_id,domain",
    }),
  );
  const orgs = new Map<string, OrgFacts>();

  for (const zone of zones) {
    const orgId = str(zone.org_id);
    const domain = str(zone.domain).toLowerCase();
    if (orgId === "" || domain === "") continue;
    try {
      let facts = orgs.get(orgId);
      if (!facts) {
        const org = await withSuperuser((pb) =>
          pb
            .collection("organizations")
            .getOne(orgId, { fields: "id,name,stage,demo" }),
        );
        facts = {
          live: org.stage === "live" && org.demo !== true,
          business: str(org.name) || orgId,
        };
        orgs.set(orgId, facts);
      }
      if (!facts.live) continue;

      const hosts = await withSuperuser((pb) => orgHosts(pb, orgId));
      const primary = hosts.find((h) => h.primary && h.kind === "custom");
      const isMain =
        primary !== undefined &&
        (primary.hostname === domain || primary.hostname === `www.${domain}`);
      const ns = await resolver.resolveNsIps(domain);
      const assigned = strings(zone.nameservers);
      // (b) unknown when the NS answer or the assigned list is empty (fail safe).
      const lost =
        ns.names.length === 0 || assigned.length === 0
          ? null
          : !sameNames(ns.names, assigned);

      if (!isMain) {
        // Choice 3: an old redirect domain whose delegation left CDS.
        const redirects = hosts.filter(
          (h) =>
            h.kind === "redirect" &&
            (h.hostname === domain || h.hostname === `www.${domain}`),
        );
        if (lost === true && redirects.length > 0) {
          redirectsDropped++;
          if (!dryRun) {
            // WR-A06: the delegation already left CDS, so the CDS zone serves nobody: delete
            // it and mark the row `deleted` (a `moved` row would block offboarding and
            // retention forever). If the delete fails the row stays `moved` for the sweep.
            const zoneBody = await dropZone(
              provider,
              str(zone.provider_zone_id),
            );
            await withSuperuser(async (pb) => {
              const batch = pb.createBatch();
              for (const h of redirects) {
                batch.collection("org_hosts").delete(h.id);
              }
              batch.collection(DNS_ZONES).update(zone.id, zoneBody);
              batch.collection("audit_log").create(
                auditBody(sysCtx(), {
                  action: "domain.redirect_dropped",
                  organization: orgId,
                  targetCollection: DNS_ZONES,
                  targetId: zone.id,
                  meta: { hosts: redirects.length },
                }),
              );
              await batch.send();
            });
            for (const h of redirects) forgetHost(h.hostname);
          }
        }
        continue;
      }

      summary.checked++;
      const site: Site = {
        orgId,
        business: facts.business,
        domain,
        registrar: registrarDisplay(str(zone.registrar)),
      };

      // (a) HTTPS on the primary host.
      const probe = await (deps.prober ?? getHttpsProber()).probe(
        primary.hostname,
      );
      const certDays = probe.certDaysLeft;
      if (certDays !== null && Number.isFinite(certDays)) {
        summary.cert_min_days =
          summary.cert_min_days === null
            ? certDays
            : Math.min(summary.cert_min_days, certDays);
      }
      if (!probe.ok) summary.https_failing++;
      const https = await settle(t, orgId, "https_failing", !probe.ok);
      if (!dryRun && https.change && https.since) {
        await staffHealthMail(
          site,
          https.change === "opened" ? "open" : "close",
          "Domain HTTPS",
          probe.ok
            ? "HTTPS ok"
            : `HTTPS failing (${probe.error ?? (probe.status !== null ? `status ${probe.status}` : "no response")})`,
          "warn HTTPS failing",
          https.since,
          deps,
        );
      }
      const certLow =
        probe.ok && certDays !== null
          ? certDays < DOMAIN_CERT_WARN_DAYS
          : probe.ok
            ? false
            : null;
      const cert = await settle(t, orgId, "cert_low", certLow);
      if (!dryRun && cert.change && cert.since) {
        await staffHealthMail(
          site,
          cert.change === "opened" ? "open" : "close",
          "Domain certificate",
          certDays === null ? "certificate ok" : `${certDays} days left`,
          `warn certificate < ${DOMAIN_CERT_WARN_DAYS} days`,
          cert.since,
          deps,
        );
      }

      // (b) Delegation.
      if (lost === true) summary.delegation_lost++;
      const deleg = await settle(t, orgId, "delegation_lost", lost);
      if (!dryRun && deleg.change === "opened") {
        await ownerLostDelegation(site, now, deps);
        await staffDomainMail(site, "delegation_lost", deps);
      }

      // (c) Email drift (only while CDS serves the zone; a lost delegation is its own case).
      const drift =
        lost === false
          ? await emailDrift(zone, domain, { provider, resolver })
          : null;
      if (drift === true) summary.email_drift++;
      const em = await settle(
        t,
        orgId,
        "email_drift",
        lost === true ? false : drift,
      );
      if (!dryRun && em.change && em.since && lost !== true) {
        await staffHealthMail(
          site,
          em.change === "opened" ? "open" : "close",
          "Domain email records",
          em.change === "opened"
            ? "email records changed outside this site"
            : "email records match again",
          "warn any change since the accepted state",
          em.since,
          deps,
        );
      }

      // (d) Expiry (RDAP). CDS never acts at the registrar; the owner is told in time.
      const info = await (deps.registry ?? getRegistryLookup()).lookup(domain);
      const expiresAt =
        info.expiresAt && Number.isFinite(Date.parse(info.expiresAt))
          ? new Date(Date.parse(info.expiresAt)).toISOString()
          : null;
      if (expiresAt) {
        const days = Math.floor(
          (Date.parse(expiresAt) - now.getTime()) / DAY_MS,
        );
        const in30 = days <= 30;
        const in7 = days <= 7;
        if (in30) summary.expiring_30d++;
        if (in7) summary.expiring_7d++;
        if (!dryRun) {
          const known = str(zone.expires_at);
          if (known === "" || Date.parse(known) !== Date.parse(expiresAt)) {
            await withSuperuser((pb) =>
              pb
                .collection(DNS_ZONES)
                .update(zone.id, { expires_at: expiresAt }),
            );
          }
        }
        const e7 = await settle(t, orgId, "expiry_7d", in7);
        // Reaching 7 days first also marks the 30-day reminder as sent (one mail, not two).
        const e30 = await settle(t, orgId, "expiry_30d", in30);
        if (!dryRun && e7.change === "opened") {
          await ownerExpiry(site, 7, expiresAt, now, deps);
          await staffDomainMail(site, "expiry_7d", deps);
        } else if (!dryRun && e30.change === "opened") {
          await ownerExpiry(site, 30, expiresAt, now, deps);
        }
      }
    } catch (err) {
      errors++;
      console.error(`[domains] health check failed: ${errName(err)}`);
    }
  }

  if (!dryRun) {
    await writePlatformMeta(
      sysCtx(),
      DOMAIN_HEALTH_SUMMARY_KEY,
      JSON.stringify(summary),
    );
  }
  return {
    summary,
    opened: t.opened,
    closed: t.closed,
    redirectsDropped,
    errors,
    dryRun,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** The last stored health summary (14-45 reads it for §4 `domains`), or null before the first. */
export async function domainHealthSummary(): Promise<DomainHealthSummary | null> {
  const raw = await readPlatformMeta(DOMAIN_HEALTH_SUMMARY_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      https_failing: num(v.https_failing),
      cert_min_days:
        typeof v.cert_min_days === "number" && Number.isFinite(v.cert_min_days)
          ? v.cert_min_days
          : null,
      delegation_lost: num(v.delegation_lost),
      email_drift: num(v.email_drift),
      expiring_30d: num(v.expiring_30d),
      expiring_7d: num(v.expiring_7d),
      checked: num(v.checked),
      at: str(v.at),
    };
  } catch {
    return null;
  }
}
