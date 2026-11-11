// P11 alerts/jobs (11-23; DASH-35, DASH-36, D313). The every-5-minutes alert job. raiseAlert
// (11-20) already sends urgent/normal email and push at once; this job only does what has to
// wait. One run does, in order:
//
//   1. release   Pushes held by quiet hours or the 10-minute collapse (`push_state = held`).
//                A person still inside their quiet hours (business time) keeps theirs. A type
//                whose last push to that person went out under 10 minutes ago keeps waiting,
//                so a burst collapses. Everything else goes out as ONE push per (org, person):
//                one row = that alert; several of one type = "3 new messages" (tag = type);
//                mixed types = "{n} new alerts" (tag `alerts`). Rows become sent / failed /
//                skipped (no device, push now off, no longer a member).
//   2. retry     `failed` pushes less than 30 minutes old are tried once more, grouped the
//                same way; a second failure gives up (`skipped`) and is counted.
//   3. digest    From 07:00 business time, once per business day per person: the summary
//                alerts (level summary, digest types, not yet emailed, last 48 h) the person
//                may still see and has email on for become one `alerts.digest` email. Counts
//                only in sensitive-practice mode (T-11-23-03). Nothing to say = no email.
//                The day is claimed BEFORE the send (at most once): platform_meta
//                `alerts:digest:<org>` holds JSON { <user>: "YYYY-MM-DD" }.
//   4. prune     Read alerts older than 90 days and any alert older than 180 days (the bell
//                shows 30 days), at most PRUNE_CAP rows per run.
//   5. heartbeat platform_meta `job:alerts:last_success` (ISO; only when no step failed) and
//                `job:alerts:last_counts` (JSON of AlertJobResult). Monitor brief check 30
//                (D174, D175); change them together.
//
// Concurrency (T-11-23-02): an in-process chain plus a platform_meta lock `lock:alerts-job`,
// so the CLI and the scheduled route never overlap; a run that finds the lock busy returns
// `busy: true` and writes nothing. Batch caps bound every step. dryRun computes the same
// selections and counts and writes nothing (no push, no email, no row change, no heartbeat).
// Every filter is bound through pb.filter (T-02-13); logs carry error names only.
import {
  channelsFor,
  digestDue,
  eligibleFor,
  inQuietHours,
  COLLAPSE_WINDOW_MS,
  alertSubject,
  sensitivePracticeOn,
  type AlertChannelPrefs,
  type AlertTypeSpec,
  type QuietHours,
} from "@cds/core/alerts";
import { businessDate, businessTimeZone, isHubHref } from "@cds/core/today";
import { ORG_ROLES, type OrgRole } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { registeredAlertTypes } from "./addon-types";
import {
  assertSystemContext,
  mintSystemContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import {
  getPushSender,
  recordOutcome,
  subscriptionsForUsers,
  unreadForBadge,
  type PushPayload,
  type PushSender,
} from "./push";

export type AlertJobOptions = {
  now?: Date;
  dryRun?: boolean;
  /** Composed registry (core + add-on manifests); defaults to the core types. */
  types?: readonly AlertTypeSpec[];
  push?: PushSender;
  transport?: EmailTransport;
};

export type AlertJobResult = {
  dryRun: boolean;
  /** Another run held the lock; nothing was done. */
  busy: boolean;
  /** Pushes delivered to at least one device (one per person per org). */
  pushSent: number;
  /** Of those, pushes that bundled two or more alerts. */
  collapsed: number;
  /** Held alerts that went out (sent) this run. */
  released: number;
  /** Alerts still held because the person is inside quiet hours. */
  heldQuiet: number;
  /** Alerts still held inside the 10-minute collapse window. */
  heldCollapse: number;
  /** Failed pushes tried again. */
  retried: number;
  /** Pushes that failed on every device this run (release or retry). */
  pushFailed: number;
  /** Morning summaries sent. */
  digestsSent: number;
  /** People due a summary with nothing they can see or want by email. */
  digestsSkippedEmpty: number;
  /** Summaries whose send did not go out (suppressed or threw). */
  digestFailures: number;
  /** Old alerts deleted. */
  pruned: number;
  failedSteps: string[];
};

const COLLECTION = "alerts";
const HEARTBEAT_KEY = "job:alerts:last_success";
const COUNTS_KEY = "job:alerts:last_counts";
const LOCK_KEY = "lock:alerts-job";
const LOCK_STALE_MS = 10 * 60_000;
const DIGEST_KEY_PREFIX = "alerts:digest:";

const DAY_MS = 24 * 60 * 60_000;
const RETRY_WINDOW_MS = 30 * 60_000;
const DIGEST_LOOKBACK_MS = 2 * DAY_MS;
const READ_KEEP_MS = 90 * DAY_MS;
const ANY_KEEP_MS = 180 * DAY_MS;
/** Days a digest claim is kept in the per-org map (people who left drop out). */
const DIGEST_CLAIM_KEEP_DAYS = 7;

const HELD_CAP = 1000;
const RETRY_CAP = 500;
const DIGEST_CAP = 2000;
const PRUNE_CAP = 500;

/** Collapsed push words (UI-SPEC: "3 new messages"); other types read "{n} new alerts". */
const PUSH_NOUNS: Readonly<Record<string, string>> = Object.freeze({
  "form.message": "messages",
  "site.stage": "site updates",
  "cds.notice": "notices from Support",
  "data_export.ready": "downloads ready",
});

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function emptyResult(dryRun: boolean): AlertJobResult {
  return {
    dryRun,
    busy: false,
    pushSent: 0,
    collapsed: 0,
    released: 0,
    heldQuiet: 0,
    heldCollapse: 0,
    retried: 0,
    pushFailed: 0,
    digestsSent: 0,
    digestsSkippedEmpty: 0,
    digestFailures: 0,
    pruned: 0,
    failedSteps: [],
  };
}

// ------------------------------------------------------------------ pure helpers

/** "{n} new messages" for one type, "{n} new alerts" otherwise. */
export function collapsedPushBody(n: number, type: string | null): string {
  const noun = (type && PUSH_NOUNS[type]) || "alerts";
  return `${n} new ${noun}`;
}

type DigestRow = { type: string; title: string };

/** Digest lines: one per type; a single alert keeps its title, more read "{Label}: {n}". */
export function digestLines(
  rows: readonly DigestRow[],
  types: readonly AlertTypeSpec[],
): { text: string; safeText: string; count: number }[] {
  const byType = new Map<string, DigestRow[]>();
  for (const r of rows) {
    const list = byType.get(r.type) ?? [];
    list.push(r);
    byType.set(r.type, list);
  }
  const out: { text: string; safeText: string; count: number }[] = [];
  for (const [type, list] of byType) {
    const label = types.find((s) => s.type === type)?.label ?? "New updates";
    const n = list.length;
    const counted = `${label}: ${n}`;
    out.push({
      text: n === 1 ? list[0]!.title || counted : counted,
      safeText: counted,
      count: n,
    });
  }
  return out;
}

// ------------------------------------------------------------------ lock
let chain: Promise<unknown> = Promise.resolve();

function withJobLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ------------------------------------------------------------------ org reads
type OrgFacts = { name: string; timeZone: string; sensitive: boolean };

type Member = { role: OrgRole; grants: string[] };

type Prefs = { channels: AlertChannelPrefs; quiet: QuietHours | undefined };

type OrgView = {
  facts: OrgFacts;
  members: Map<string, Member>;
  prefs: Map<string, Prefs>;
};

function anyOf(
  field: "id" | "user",
  values: readonly string[],
): { clause: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const parts: string[] = [];
  values.forEach((v, i) => {
    params["u" + i] = v;
    parts.push(field + " = {:u" + i + "}");
  });
  return { clause: parts.join(" || "), params };
}

async function orgView(
  pb: PocketBase,
  orgId: string,
  users: readonly string[],
): Promise<OrgView> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" });
  const res = await pb.collection("business_profile").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "time_zone,business_type,sensitive_practice",
  });
  const p = res.items[0];
  const pv = str(p?.sensitive_practice);
  const facts: OrgFacts = {
    name: str(org.name),
    timeZone: businessTimeZone(str(p?.time_zone)),
    sensitive: sensitivePracticeOn(
      pv === "on" || pv === "off" ? pv : "",
      str(p?.business_type),
    ),
  };

  const members = new Map<string, Member>();
  const prefs = new Map<string, Prefs>();
  const unique = [...new Set(users.filter((u) => u))];
  if (unique.length === 0) return { facts, members, prefs };

  const u = anyOf("user", unique);
  const clause = "organization = {:org} && (" + u.clause + ")";
  const ms = await pb.collection("memberships").getFullList({
    filter: pb.filter(clause, { org: orgId, ...u.params }),
    fields: "user,role,addon_grants",
  });
  for (const m of ms) {
    const role = str(m.role);
    if (!(ORG_ROLES as readonly string[]).includes(role)) continue;
    members.set(str(m.user), {
      role: role as OrgRole,
      grants: Array.isArray(m.addon_grants)
        ? m.addon_grants.filter((g): g is string => typeof g === "string")
        : [],
    });
  }
  const rows = await pb.collection("member_prefs").getFullList({
    filter: pb.filter(clause, { org: orgId, ...u.params }),
    fields: "user,alert_channels,quiet_hours",
  });
  for (const r of rows) {
    const q = isRecord(r.quiet_hours) ? r.quiet_hours : null;
    prefs.set(str(r.user), {
      channels: isRecord(r.alert_channels)
        ? (r.alert_channels as AlertChannelPrefs)
        : {},
      quiet: q
        ? { on: q.on === true, from: str(q.from), until: str(q.until) }
        : undefined,
    });
  }
  return { facts, members, prefs };
}

function groupBy(
  rows: readonly RecordModel[],
  key: (r: RecordModel) => string,
): Map<string, RecordModel[]> {
  const out = new Map<string, RecordModel[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/** True when the person may still receive this alert (member, and eligible for known types). */
function stillEligible(
  member: Member | undefined,
  spec: AlertTypeSpec | undefined,
): boolean {
  if (!member) return false;
  if (!spec) return true; // an add-on type the caller did not compose: membership is enough
  return eligibleFor({ role: member.role, grants: member.grants }, spec);
}

// ------------------------------------------------------------------ push
async function lastSameTypePushOpen(
  pb: PocketBase,
  orgId: string,
  user: string,
  type: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - COLLAPSE_WINDOW_MS);
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter(
      "organization = {:org} && user = {:u} && type = {:type} && pushed_at != '' && pushed_at > {:since} && pushed_at <= {:now}",
      { org: orgId, u: user, type, since, now },
    ),
    fields: "id",
  });
  return res.items.length > 0;
}

/** The one push for a person's group of alerts. */
function groupPayload(
  orgId: string,
  rows: readonly RecordModel[],
  facts: OrgFacts,
  types: readonly AlertTypeSpec[],
): PushPayload {
  const urgent = rows.some((r) => str(r.level) === "urgent");
  const urgency = urgent ? ("high" as const) : ("normal" as const);
  const newest = rows[rows.length - 1]!;
  const newestHref = isHubHref(str(newest.href)) ? str(newest.href) : "";
  if (rows.length === 1) {
    const r = rows[0]!;
    const spec = types.find((s) => s.type === str(r.type));
    const alert = { title: str(r.title), safe_title: str(r.safe_title) };
    const body = spec
      ? alertSubject(spec, alert, facts.sensitive)
      : facts.sensitive
        ? alert.safe_title || "New alert"
        : alert.title;
    return {
      title: facts.name,
      org: orgId,
      body,
      href: newestHref || "/hub/today",
      // A no-collapse type (booking request) keeps its own tag, as raiseAlert sent it.
      tag:
        spec?.collapse === false
          ? `${str(r.type)}:${str(r.source_key)}`
          : str(r.type),
      urgency,
    };
  }
  const typesIn = [...new Set(rows.map((r) => str(r.type)))];
  const one = typesIn.length === 1 ? typesIn[0]! : null;
  let href = "/hub/today";
  if (one) {
    const section = str(newest.section);
    const core = `/hub/${section}`;
    if (section && !section.startsWith("addon:") && isHubHref(core)) {
      href = core;
    } else if (newestHref) {
      href = newestHref;
    }
  }
  return {
    title: facts.name,
    org: orgId,
    body: collapsedPushBody(rows.length, one),
    href,
    tag: one ?? "alerts",
    urgency,
  };
}

/** Send one group to every device of the person: sent | failed | skipped (no device). */
async function sendGroup(
  pb: PocketBase,
  orgId: string,
  user: string,
  payload: PushPayload,
  sender: PushSender,
  now: Date,
): Promise<"sent" | "failed" | "skipped"> {
  const subs = await subscriptionsForUsers(pb, orgId, [user]);
  if (subs.length === 0) return "skipped";
  let ok = false;
  let error = false;
  for (const s of subs) {
    const outcome = await sender
      .send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload)
      .catch(() => "error" as const);
    await recordOutcome(pb, s, outcome, now);
    if (outcome === "ok") ok = true;
    else if (outcome === "error") error = true;
  }
  if (ok) return "sent";
  return error ? "failed" : "skipped";
}

async function setState(
  pb: PocketBase,
  rows: readonly RecordModel[],
  state: "sent" | "failed" | "skipped" | "held",
  now: Date,
): Promise<void> {
  for (const r of rows) {
    await pb
      .collection(COLLECTION)
      .update(
        r.id,
        state === "sent"
          ? { push_state: state, pushed_at: now }
          : { push_state: state },
      );
  }
}

type PushStepCtx = {
  pb: PocketBase;
  now: Date;
  dryRun: boolean;
  types: readonly AlertTypeSpec[];
  sender: PushSender;
  result: AlertJobResult;
};

/**
 * Release (mode "release") or retry (mode "retry") a set of rows, grouped per (org, person).
 * Adds the ids it touched to `touched`, so the retry step skips rows the release step handled.
 */
async function pushRows(
  c: PushStepCtx,
  rows: readonly RecordModel[],
  mode: "release" | "retry",
  touched: Set<string>,
): Promise<void> {
  let failedOrg = false;
  const byOrg = groupBy(rows, (r) => str(r.organization));
  for (const [orgId, orgRows] of byOrg) {
    if (!orgId) continue;
    try {
      const byUser = groupBy(orgRows, (r) => str(r.user));
      const view = await orgView(c.pb, orgId, [...byUser.keys()]);
      for (const [user, userRows] of byUser) {
        const member = view.members.get(user);
        const prefs = view.prefs.get(user);
        // Quiet hours: keep (or put back) on hold until they end.
        if (member && inQuietHours(c.now, view.facts.timeZone, prefs?.quiet)) {
          c.result.heldQuiet += userRows.length;
          if (mode === "retry" && !c.dryRun) {
            await setState(c.pb, userRows, "held", c.now);
          }
          userRows.forEach((r) => touched.add(r.id));
          continue;
        }
        const drop: RecordModel[] = [];
        const ready: RecordModel[] = [];
        for (const r of userRows) {
          const spec = c.types.find((s) => s.type === str(r.type));
          const pushOn = spec
            ? channelsFor(spec, prefs?.channels).push
            : prefs?.channels?.[str(r.type)]?.push !== false;
          if (!stillEligible(member, spec) || !pushOn) drop.push(r);
          else ready.push(r);
        }
        // Collapse: a type pushed to this person under 10 minutes ago keeps collecting.
        const send: RecordModel[] = [];
        if (mode === "release") {
          const byType = groupBy(ready, (r) => str(r.type));
          for (const [type, list] of byType) {
            const spec = c.types.find((s) => s.type === type);
            if (
              spec?.collapse !== false &&
              (await lastSameTypePushOpen(c.pb, orgId, user, type, c.now))
            ) {
              c.result.heldCollapse += list.length;
            } else {
              send.push(...list);
            }
          }
        } else {
          send.push(...ready);
        }
        send.sort((a, b) => str(a.created).localeCompare(str(b.created)));
        userRows.forEach((r) => touched.add(r.id));
        if (c.dryRun) {
          if (send.length > 0) {
            if (mode === "retry") c.result.retried += 1;
            c.result.pushSent += 1;
            if (send.length > 1) c.result.collapsed += 1;
            c.result.released += mode === "release" ? send.length : 0;
          }
          continue;
        }
        if (drop.length > 0) await setState(c.pb, drop, "skipped", c.now);
        if (send.length === 0) continue;
        if (mode === "retry") c.result.retried += 1;
        const payload = {
          ...groupPayload(orgId, send, view.facts, c.types),
          badge: await unreadForBadge(c.pb, orgId, user, c.now).catch(
            () => undefined,
          ),
        };
        const outcome = await sendGroup(
          c.pb,
          orgId,
          user,
          payload,
          c.sender,
          c.now,
        );
        if (outcome === "sent") {
          c.result.pushSent += 1;
          if (send.length > 1) c.result.collapsed += 1;
          if (mode === "release") c.result.released += send.length;
          await setState(c.pb, send, "sent", c.now);
        } else if (outcome === "failed") {
          c.result.pushFailed += 1;
          // First failure waits for one retry; a failed retry gives up.
          await setState(
            c.pb,
            send,
            mode === "release" ? "failed" : "skipped",
            c.now,
          );
        } else {
          await setState(c.pb, send, "skipped", c.now);
        }
      }
    } catch (err) {
      // One org's failure never stops the others; the step is still marked failed.
      failedOrg = true;
      console.error(`[jobs/alerts] ${mode} failed for an org: ${errName(err)}`);
    }
  }
  if (failedOrg) throw new Error(`${mode} failed for at least one org`);
}

// ------------------------------------------------------------------ digest
function readClaims(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, d] of Object.entries(v)) {
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) out[k] = d;
    }
    return out;
  } catch {
    return {};
  }
}

function pruneClaims(
  claims: Record<string, string>,
  today: string,
): Record<string, string> {
  const cut = Date.parse(today) - DIGEST_CLAIM_KEEP_DAYS * DAY_MS;
  const out: Record<string, string> = {};
  for (const [k, d] of Object.entries(claims)) {
    if (Date.parse(d) >= cut) out[k] = d;
  }
  return out;
}

async function digestStep(
  ctx: SystemContext,
  pb: PocketBase,
  opts: {
    now: Date;
    dryRun: boolean;
    types: readonly AlertTypeSpec[];
    transport?: EmailTransport;
  },
  result: AlertJobResult,
): Promise<void> {
  const { now, dryRun, types } = opts;
  const since = new Date(now.getTime() - DIGEST_LOOKBACK_MS);
  const listed = await pb.collection(COLLECTION).getList(1, DIGEST_CAP, {
    filter: pb.filter(
      "level = 'summary' && emailed_at = '' && created >= {:since}",
      { since },
    ),
    sort: "created",
    fields: "id,organization,user,type,title,created",
  });
  const byOrg = groupBy(listed.items, (r) => str(r.organization));
  let failed = false;
  for (const [orgId, orgRows] of byOrg) {
    if (!orgId) continue;
    try {
      const byUser = groupBy(orgRows, (r) => str(r.user));
      const view = await orgView(pb, orgId, [...byUser.keys()]);
      const tz = view.facts.timeZone;
      const today = businessDate(now, tz);
      const claimKey = DIGEST_KEY_PREFIX + orgId;
      const claims = readClaims(await readPlatformMeta(claimKey));

      const due: { user: string; rows: RecordModel[] }[] = [];
      for (const [user, userRows] of byUser) {
        if (!digestDue(now, tz, claims[user])) continue;
        const member = view.members.get(user);
        const prefs = view.prefs.get(user);
        const rows = userRows.filter((r) => {
          const spec = types.find((s) => s.type === str(r.type));
          if (spec && spec.digest === false) return false;
          if (!stillEligible(member, spec)) return false;
          return spec
            ? channelsFor(spec, prefs?.channels).email
            : prefs?.channels?.[str(r.type)]?.email !== false;
        });
        // Claimed either way: the 7am summary is once a day, even when it had nothing.
        claims[user] = today;
        if (rows.length === 0) {
          result.digestsSkippedEmpty += 1;
          continue;
        }
        due.push({ user, rows });
      }
      if (dryRun) {
        result.digestsSent += due.length;
        continue;
      }
      // Claim before any send (at most once).
      await writePlatformMeta(
        ctx,
        claimKey,
        JSON.stringify(pruneClaims(claims, today)),
      );
      if (due.length === 0) continue;

      const ids = anyOf(
        "id",
        due.map((d) => d.user),
      );
      const accounts = await pb.collection("users").getFullList({
        filter: pb.filter(ids.clause, ids.params),
        fields: "id,email",
      });
      const emails = new Map(accounts.map((a) => [a.id, str(a.email)]));
      for (const d of due) {
        const to = emails.get(d.user) ?? "";
        try {
          if (!to) throw new Error("no email");
          const res = await sendEmail(
            { kind: "org", ctx, orgId },
            "alerts.digest",
            to,
            {
              business: view.facts.name,
              lines: digestLines(
                d.rows.map((r) => ({
                  type: str(r.type),
                  title: str(r.title),
                })),
                types,
              ),
              sensitive: view.facts.sensitive,
              href: platformUrl("/hub/today"),
              settingsHref: platformUrl("/hub/profile#alerts"),
            },
            opts.transport ? { transport: opts.transport, now } : { now },
          );
          if (res.status !== "sent") {
            result.digestFailures += 1;
            continue;
          }
          result.digestsSent += 1;
          for (const r of d.rows) {
            await pb.collection(COLLECTION).update(r.id, { emailed_at: now });
          }
        } catch (err) {
          result.digestFailures += 1;
          console.error(`[jobs/alerts] digest send failed: ${errName(err)}`);
        }
      }
    } catch (err) {
      failed = true;
      console.error(`[jobs/alerts] digest failed for an org: ${errName(err)}`);
    }
  }
  if (failed) throw new Error("digest failed for at least one org");
}

// ------------------------------------------------------------------ prune
async function pruneStep(
  pb: PocketBase,
  now: Date,
  dryRun: boolean,
  result: AlertJobResult,
): Promise<void> {
  const clause =
    "(read_at != '' && created < {:readCut}) || created < {:anyCut}";
  const params = {
    readCut: new Date(now.getTime() - READ_KEEP_MS),
    anyCut: new Date(now.getTime() - ANY_KEEP_MS),
  };
  const old = await pb.collection(COLLECTION).getList(1, PRUNE_CAP, {
    filter: pb.filter(clause, params),
    sort: "created",
    fields: "id",
  });
  if (dryRun) {
    result.pruned = old.items.length;
    return;
  }
  for (const r of old.items) {
    try {
      await pb.collection(COLLECTION).delete(r.id);
      result.pruned += 1;
    } catch (err) {
      // A concurrent delete (or a re-raise replacing the row) is fine.
      if ((err as { status?: number })?.status !== 404) throw err;
    }
  }
}

// ------------------------------------------------------------------ run
async function runOnce(opts: AlertJobOptions): Promise<AlertJobResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const ctx = mintSystemContext({ job: "alerts" });
  assertSystemContext(ctx);
  const types = opts.types ?? registeredAlertTypes();
  const result = emptyResult(dryRun);

  let token: string | null = null;
  if (!dryRun) {
    token = await acquirePlatformLock(LOCK_KEY, {
      now,
      staleMs: LOCK_STALE_MS,
    });
    if (token === null) return { ...result, busy: true };
  }

  try {
    await withSuperuser(async (pb) => {
      const pushCtx: PushStepCtx = {
        pb,
        now,
        dryRun,
        types,
        sender: opts.push ?? getPushSender(),
        result,
      };
      const step = async (name: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (err) {
          console.error(`[jobs/alerts] ${name} failed: ${errName(err)}`);
          result.failedSteps.push(name);
        }
      };

      const handled = new Set<string>();
      // 1. Release held pushes.
      await step("release", async () => {
        // IN-B03: an alert already opened in the bell is never pushed later; it is skipped.
        if (!dryRun) {
          const read = await pb.collection(COLLECTION).getList(1, HELD_CAP, {
            filter: pb.filter("push_state = {:s} && read_at != ''", {
              s: "held",
            }),
            fields: "id",
          });
          for (const r of read.items) {
            await pb
              .collection(COLLECTION)
              .update(r.id, { push_state: "skipped" });
          }
        }
        const held = await pb.collection(COLLECTION).getList(1, HELD_CAP, {
          filter: pb.filter("push_state = {:s} && read_at = ''", { s: "held" }),
          sort: "created",
          fields:
            "id,organization,user,type,level,title,safe_title,href,section,source_key,created",
        });
        await pushRows(pushCtx, held.items, "release", handled);
      });

      // 2. Retry recent failures once.
      await step("retry", async () => {
        const since = new Date(now.getTime() - RETRY_WINDOW_MS);
        const failed = await pb.collection(COLLECTION).getList(1, RETRY_CAP, {
          filter: pb.filter("push_state = {:s} && created >= {:since}", {
            s: "failed",
            since,
          }),
          sort: "created",
          fields:
            "id,organization,user,type,level,title,safe_title,href,section,source_key,created",
        });
        const fresh = failed.items.filter((r) => !handled.has(r.id));
        await pushRows(pushCtx, fresh, "retry", new Set<string>());
      });

      // 3. The 7am morning summary.
      await step("digest", () =>
        digestStep(
          ctx,
          pb,
          {
            now,
            dryRun,
            types,
            ...(opts.transport ? { transport: opts.transport } : {}),
          },
          result,
        ),
      );

      // 4. Prune old alerts.
      await step("prune", () => pruneStep(pb, now, dryRun, result));
    });

    // 5. Heartbeat (monitor brief check 30).
    if (!dryRun) {
      if (result.failedSteps.length === 0) {
        await writePlatformMeta(ctx, HEARTBEAT_KEY, now.toISOString());
      }
      await writePlatformMeta(ctx, COUNTS_KEY, JSON.stringify(result));
    }
    return result;
  } finally {
    if (token !== null) await releasePlatformLock(LOCK_KEY, token);
  }
}

/** Run the alert job once, serialised with any concurrent run (in process and across). */
export async function runAlertJobs(
  opts: AlertJobOptions = {},
): Promise<AlertJobResult> {
  return withJobLock(() => runOnce(opts));
}
