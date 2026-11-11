// P11 reports/monthly (11-34; DASH-12, D189). The monthly "Your site this month" email job.
// It is triggered daily (POST /api/jobs/reports, `npm run reports:monthly`) and acts in the
// first days of each business month, so a missed day heals itself. One run does, per org:
//
//   1. due       The org's business-local date is in days 1..CATCH_UP_DAYS of a month and
//                the previous calendar month (the report month) has no claim yet. Later in
//                the month nothing is sent (a late "October" email in late November would
//                confuse; a first deploy mid-month never mails everyone).
//   2. skip      Not live (stage != live)              -> skippedBeforeLaunch.
//                Launched after the 1st of the report month (the first partial month, or
//                launched after it ended)               -> skippedFirstMonth.
//                Closed orgs (status disabled) are never read.
//   3. claim     platform_meta `reports:monthly:<org>:<YYYY-MM>` is written BEFORE any send,
//                so each org gets the email at most once per month (T-11-34-03). Its JSON
//                value keeps the month's SEO score, so next month can say how it moved.
//   4. send      `reports.monthly` to every member eligible for the core alert type
//                (eligibleFor: Owner, Admin, Editor, Viewer under content:read since 11-24)
//                whose email channel for it is on (member_prefs.alert_channels; default on).
//                Five lines (monthlyLines) and one tip (MONTHLY_TIPS by month number).
//   5. heartbeat platform_meta `job:reports:last_success` (ISO; only when no org failed) and
//                `job:reports:last_counts` (JSON of MonthlyReportResult). Monitor brief check
//                31 (D174, D175); change them together.
//
// Concurrency: an in-process chain plus a platform_meta lock `lock:reports-job`, so the CLI
// and the route never overlap; a busy run returns `busy: true`. dryRun computes the same
// selections and counts and writes nothing (no claim, no email, no heartbeat, no lock).
// Reads go through the org-scoped repository (readSiteStats, seoHealthFor, listPages) with
// an org context minted for the job (systemJob "reports"). Logs carry error names only.
import {
  CORE_ALERT_TYPES,
  channelsFor,
  eligibleFor,
  type AlertChannelPrefs,
  type AlertTypeSpec,
} from "@cds/core/alerts";
import type { DateRange } from "@cds/core/analytics";
import { SOCIAL_PRESETS } from "@cds/core/social";
import { businessDate, businessTimeZone } from "@cds/core/today";
import { ORG_ROLES, type OrgRole } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import {
  assertSystemContext,
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
  type SystemContext,
} from "../context";
import { listPages } from "../content/pages";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import { readSiteStats, type SiteStats } from "./daily-stats";
import { seoHealthFor } from "./seo-health";

export type MonthlyReportOptions = {
  now?: Date;
  dryRun?: boolean;
  /** Only this org (CLI `--org`). */
  org?: string;
  transport?: EmailTransport;
};

export type MonthlyReportResult = {
  dryRun: boolean;
  /** Another run held the lock; nothing was done. */
  busy: boolean;
  /** Report month label of the run ("October"), from the default business time zone. */
  month: string;
  /** Orgs that got their report this run (or would, in a dry run). */
  orgsSent: number;
  /** Emails sent (or planned, in a dry run). */
  emailsSent: number;
  /** Due orgs that are not live yet. */
  skippedBeforeLaunch: number;
  /** Due live orgs whose report month was not a full month after launch. */
  skippedFirstMonth: number;
  /** Orgs already sent this month (idempotency claim found). */
  alreadySent: number;
  /** Due orgs where nobody keeps the email on. */
  noRecipients: number;
  /** Emails that did not go out (suppressed, no address, or threw). */
  sendFailures: number;
  /** Orgs whose run failed (read or claim error). */
  failedOrgs: number;
};

/** Days of the month in which a missed report still goes out (daily trigger self-heals). */
export const CATCH_UP_DAYS = 7;

const HEARTBEAT_KEY = "job:reports:last_success";
const COUNTS_KEY = "job:reports:last_counts";
const LOCK_KEY = "lock:reports-job";
const LOCK_STALE_MS = 30 * 60_000;
const CLAIM_PREFIX = "reports:monthly:";
const ORG_CAP = 1000;
const SYSTEM_IP = "system:reports";
/** Speed is only compared when both months have this many samples (SPEED-FEW rule). */
const MIN_SPEED_SAMPLES = 20;

const ORG_ID_RE = /^[a-z0-9]{15}$/;

const MONTH_NAMES = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

/**
 * One plain tip per month (D119), picked by the report month's number (1 = January). Each
 * is one sentence with no trailing full stop (the template adds it).
 */
export const MONTHLY_TIPS: readonly string[] = Object.freeze([
  "Ask one happy customer this week for a Google review; new reviews help people find you",
  "Add a photo of you or your team to your About page; people like to see who they will meet",
  "Check your opening hours and phone number on your site and Google are the same",
  "Put your link in the bio of every social account you use, so followers can find your site",
  "Answer every message within a day; quick replies win more customers",
  "Read your home page on your phone; if anything is hard to tap or read, fix it in Pages",
  "Add a short description to each page in its settings; it is what Google shows under your link",
  "Post one before-and-after or behind-the-scenes photo this month and link to your site",
  "Look at your top page in the Site Report and make sure it tells people how to contact you",
  "Give every image a short description (alt text); it helps search and people using screen readers",
  "Add your next event, offer or seasonal news to the home page so return visitors see something new",
  "Ask a friend to find you on Google and book or message you, and tell you what felt slow",
]);

const SEARCH_LABELS: Readonly<Record<string, string>> = Object.freeze({
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  other: "Other sites",
});

const NUM = new Intl.NumberFormat("en-US");

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function emptyResult(dryRun: boolean, month: string): MonthlyReportResult {
  return {
    dryRun,
    busy: false,
    month,
    orgsSent: 0,
    emailsSent: 0,
    skippedBeforeLaunch: 0,
    skippedFirstMonth: 0,
    alreadySent: 0,
    noRecipients: 0,
    sendFailures: 0,
    failedOrgs: 0,
  };
}

// ------------------------------------------------------------------ month helpers

/** "2026-10" -> the month before ("2026-09"). */
export function previousMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** The business days of a YYYY-MM month as a stats range. */
export function monthRange(ym: string): DateRange {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** "October" for "2026-10". */
export function monthName(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTH_NAMES[m - 1] ?? ym;
}

/** The tip for a report month (rotates through MONTHLY_TIPS by month number). */
export function monthlyTip(ym: string): string {
  const m = Number(ym.slice(5, 7));
  const i = Number.isFinite(m) && m >= 1 ? (m - 1) % MONTHLY_TIPS.length : 0;
  return MONTHLY_TIPS[i]!;
}

/**
 * When the run is due for an org: its business date is in days 1..CATCH_UP_DAYS, and the
 * report month is the previous calendar month. Null otherwise.
 */
export function reportMonthFor(now: Date, timeZone: string): string | null {
  const today = businessDate(now, timeZone);
  const day = Number(today.slice(8, 10));
  if (!(day >= 1 && day <= CATCH_UP_DAYS)) return null;
  return previousMonth(today.slice(0, 7));
}

// ------------------------------------------------------------------ the five lines

/** A source label: Google, Direct, Instagram, a host. */
export function monthlySourceLabel(source: string): string {
  const s = source.trim().toLowerCase();
  if (s === "" || s === "direct") return "Direct (typed in or saved)";
  const preset = SOCIAL_PRESETS.find((p) => p.key === s);
  if (preset) return preset.label;
  return SEARCH_LABELS[s] ?? source;
}

function visits(n: number): string {
  return `${NUM.format(n)} ${n === 1 ? "visit" : "visits"}`;
}

function change(now: number, prev: number, prevMonth: string): string {
  const name = monthName(prevMonth);
  if (now === prev) return `the same as ${name}`;
  if (prev <= 0) return `up from none in ${name}`;
  const pct = Math.round((Math.abs(now - prev) / prev) * 100);
  return now > prev ? `up ${pct}% on ${name}` : `down ${pct}% on ${name}`;
}

function seconds(ms: number): string {
  return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

export type MonthlyLineInput = {
  /** The report month, YYYY-MM. */
  month: string;
  stats: SiteStats;
  /** The month before; null when it could not be read. */
  prevStats: SiteStats | null;
  /** This month's SEO score (0-100), null when unknown. */
  seoScore: number | null;
  /** The SEO score stored with last month's report, null when there was none. */
  prevSeoScore: number | null;
  /** Page titles by path ("/" is the home page). */
  titles?: ReadonlyMap<string, string>;
};

/** The speed-or-SEO line: whichever moved more; a plain status when neither moved. */
function speedOrSeoLine(i: MonthlyLineInput): string {
  const prevName = monthName(previousMonth(i.month));
  const cur = i.stats.vitals.lcp;
  const prev = i.prevStats?.vitals.lcp ?? null;
  const speedComparable =
    cur !== null &&
    prev !== null &&
    cur.samples >= MIN_SPEED_SAMPLES &&
    prev.samples >= MIN_SPEED_SAMPLES &&
    prev.p75 > 0;
  const speedMove = speedComparable
    ? Math.abs(cur.p75 - prev.p75) / prev.p75
    : 0;
  const seoComparable = i.seoScore !== null && i.prevSeoScore !== null;
  const seoMove = seoComparable
    ? Math.abs(i.seoScore! - i.prevSeoScore!) / 100
    : 0;

  if (speedComparable && speedMove > 0 && speedMove >= seoMove) {
    const diff = Math.abs(cur.p75 - prev.p75);
    const word = cur.p75 < prev.p75 ? "faster" : "slower";
    return `Speed: pages load in ${seconds(cur.p75)}, ${seconds(diff)} ${word} than in ${prevName}.`;
  }
  if (seoComparable && seoMove > 0) {
    const d = i.seoScore! - i.prevSeoScore!;
    const pts = Math.abs(d) === 1 ? "point" : "points";
    return `SEO score: ${i.seoScore} out of 100, ${d > 0 ? "up" : "down"} ${Math.abs(d)} ${pts} since last month.`;
  }
  if (i.seoScore !== null) {
    return seoComparable
      ? `SEO score: ${i.seoScore} out of 100, no change since last month.`
      : `SEO score: ${i.seoScore} out of 100.`;
  }
  if (cur !== null && cur.samples >= MIN_SPEED_SAMPLES) {
    return `Speed: pages load in ${seconds(cur.p75)}.`;
  }
  return "Speed: not enough visits yet to measure.";
}

/**
 * The five lines (UI-SPEC monthly email row): Visitors (vs last month), Top page, Top
 * source, Messages, Speed or SEO change. Plain words, numbers formatted for en-US.
 */
export function monthlyLines(i: MonthlyLineInput): string[] {
  const prevMonth = previousMonth(i.month);
  const s = i.stats;
  const p = i.prevStats;

  const visitors = p
    ? `Visitors: ${NUM.format(s.views)}, ${change(s.views, p.views, prevMonth)}.`
    : `Visitors: ${NUM.format(s.views)}.`;

  const top = s.topPages[0];
  const topTitle = top
    ? i.titles?.get(top.path) || (top.path === "/" ? "Home" : top.path)
    : "";
  const topPage = top
    ? `Top page: ${topTitle} (${visits(top.views)}).`
    : "Top page: no visits yet.";

  const src = s.sources[0];
  const topSource = src
    ? `Top source: ${monthlySourceLabel(src.source)} (${visits(src.views)}).`
    : "Top source: no visits yet.";

  const n = s.formSubmissions;
  const noun = n === 1 ? "message" : "messages";
  const messages = p
    ? `Messages: ${NUM.format(n)} ${noun}, ${change(n, p.formSubmissions, prevMonth)}.`
    : `Messages: ${NUM.format(n)} ${noun}.`;

  return [visitors, topPage, topSource, messages, speedOrSeoLine(i)];
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
type OrgRow = {
  id: string;
  name: string;
  stage: string;
  launchedAt: Date | null;
};

type Recipient = { user: string; role: OrgRole };

function dateOrNull(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? new Date(t) : null;
}

async function listOrgs(pb: PocketBase, only?: string): Promise<OrgRow[]> {
  const params: Record<string, string> = { disabled: "disabled" };
  let clause = "status != {:disabled}";
  if (only) {
    clause = clause + " && id = {:org}";
    params.org = only;
  }
  const res = await pb.collection("organizations").getList(1, ORG_CAP, {
    filter: pb.filter(clause, params),
    sort: "created",
    fields: "id,name,stage,launched_at",
  });
  return res.items.map((r: RecordModel) => ({
    id: r.id,
    name: str(r.name),
    stage: str(r.stage),
    launchedAt: dateOrNull(r.launched_at),
  }));
}

async function orgTimeZone(pb: PocketBase, orgId: string): Promise<string> {
  const res = await pb.collection("business_profile").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "time_zone",
  });
  return businessTimeZone(str(res.items[0]?.time_zone));
}

/** Members who may get the type and keep its email on (T-11-34-02). */
async function recipientsOf(
  pb: PocketBase,
  orgId: string,
  spec: AlertTypeSpec,
): Promise<{ recipients: Recipient[]; owner: string }> {
  const ms = await pb.collection("memberships").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "user,role,addon_grants",
  });
  const prefsRows = await pb.collection("member_prefs").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "user,alert_channels",
  });
  const prefs = new Map<string, AlertChannelPrefs>();
  for (const r of prefsRows) {
    if (isRecord(r.alert_channels)) {
      prefs.set(str(r.user), r.alert_channels as AlertChannelPrefs);
    }
  }
  const out: Recipient[] = [];
  const seen = new Set<string>();
  let owner = "";
  for (const m of ms) {
    const role = str(m.role);
    const user = str(m.user);
    if (!user || !(ORG_ROLES as readonly string[]).includes(role)) continue;
    if (role === "owner" && !owner) owner = user;
    if (seen.has(user)) continue;
    const grants = Array.isArray(m.addon_grants)
      ? m.addon_grants.filter((g): g is string => typeof g === "string")
      : [];
    if (!eligibleFor({ role: role as OrgRole, grants }, spec)) continue;
    if (!channelsFor(spec, prefs.get(user)).email) continue;
    seen.add(user);
    out.push({ user, role: role as OrgRole });
  }
  // Owners first, then by role order, so a partial failure reaches owners first.
  out.sort(
    (a, b) =>
      (ORG_ROLES as readonly string[]).indexOf(a.role) -
      (ORG_ROLES as readonly string[]).indexOf(b.role),
  );
  return { recipients: out, owner };
}

async function emailsOf(
  pb: PocketBase,
  users: readonly string[],
): Promise<Map<string, string>> {
  const params: Record<string, string> = {};
  const parts: string[] = [];
  users.forEach((u, i) => {
    params["u" + i] = u;
    parts.push("id = {:u" + i + "}");
  });
  if (parts.length === 0) return new Map();
  const clause = parts.join(" || ");
  const rows = await pb.collection("users").getFullList({
    filter: pb.filter(clause, params),
    fields: "id,email",
  });
  return new Map(rows.map((r) => [r.id, str(r.email)]));
}

type Claim = { sentAt: string; seo: number | null };

function parseClaim(raw: string | null): Claim | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return { sentAt: "", seo: null };
    const seo =
      typeof v.seo === "number" && Number.isFinite(v.seo) ? v.seo : null;
    return { sentAt: str(v.sentAt), seo };
  } catch {
    // Any stored value means "sent": never send twice because of a bad value.
    return { sentAt: "", seo: null };
  }
}

function claimKey(orgId: string, ym: string): string {
  return `${CLAIM_PREFIX}${orgId}:${ym}`;
}

async function settle<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error(`[jobs/reports] ${label} read failed: ${errName(err)}`);
    return null;
  }
}

// ------------------------------------------------------------------ one org
async function runOrg(
  sys: SystemContext,
  pb: PocketBase,
  org: OrgRow,
  opts: { now: Date; dryRun: boolean; transport?: EmailTransport },
  spec: AlertTypeSpec,
  result: MonthlyReportResult,
): Promise<void> {
  const tz = await orgTimeZone(pb, org.id);
  const month = reportMonthFor(opts.now, tz);
  if (!month) return; // not in the first days of a month: nothing due

  if (org.stage !== "live") {
    result.skippedBeforeLaunch += 1;
    return;
  }
  // First partial month: launched after the 1st of the report month (business time).
  if (org.launchedAt && businessDate(org.launchedAt, tz) > `${month}-01`) {
    result.skippedFirstMonth += 1;
    return;
  }

  const key = claimKey(org.id, month);
  if ((await readPlatformMeta(key)) !== null) {
    result.alreadySent += 1;
    return;
  }

  const { recipients, owner } = await recipientsOf(pb, org.id, spec);
  if (recipients.length === 0) {
    result.noRecipients += 1;
    return;
  }

  // Reads through the org-scoped repository, as the job acting for the org.
  const ctx: OrgContext = mintOrgContext({
    orgId: org.id,
    actor: owner,
    role: "owner",
    grants: [],
    systemJob: "reports",
    ip: SYSTEM_IP,
  });
  const prevMonth = previousMonth(month);
  const stats = await readSiteStats(ctx, monthRange(month));
  const [prevStats, seo, pages, lastClaim] = await Promise.all([
    settle("previous stats", readSiteStats(ctx, monthRange(prevMonth))),
    settle("seo health", seoHealthFor(ctx, { now: opts.now })),
    settle("pages", listPages(ctx)),
    readPlatformMeta(claimKey(org.id, prevMonth)),
  ]);
  const titles = new Map<string, string>();
  for (const p of pages ?? []) {
    titles.set(p.slug === "home" ? "/" : `/${p.slug}`, p.title);
  }
  const seoScore = seo ? seo.score : null;
  const lines = monthlyLines({
    month,
    stats,
    prevStats,
    seoScore,
    prevSeoScore: parseClaim(lastClaim)?.seo ?? null,
    titles,
  });

  if (opts.dryRun) {
    result.orgsSent += 1;
    result.emailsSent += recipients.length;
    return;
  }

  // Claim before any send: at most once per org per month (T-11-34-03).
  const claim: Claim = { sentAt: opts.now.toISOString(), seo: seoScore };
  await writePlatformMeta(sys, key, JSON.stringify(claim));
  result.orgsSent += 1;

  const emails = await emailsOf(
    pb,
    recipients.map((r) => r.user),
  );
  for (const r of recipients) {
    const to = emails.get(r.user) ?? "";
    try {
      if (!to) throw new Error("no email");
      const res = await sendEmail(
        { kind: "org", ctx: sys, orgId: org.id },
        "reports.monthly",
        to,
        {
          business: org.name,
          month: monthName(month),
          visitors: stats.views,
          messages: stats.formSubmissions,
          lines,
          tip: monthlyTip(month),
          href: platformUrl("/hub/reports"),
        },
        opts.transport
          ? { transport: opts.transport, now: opts.now }
          : { now: opts.now },
      );
      if (res.status === "sent") result.emailsSent += 1;
      else result.sendFailures += 1;
    } catch (err) {
      result.sendFailures += 1;
      console.error(`[jobs/reports] send failed: ${errName(err)}`);
    }
  }
}

// ------------------------------------------------------------------ run
async function runOnce(
  opts: MonthlyReportOptions,
): Promise<MonthlyReportResult> {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const dryRun = opts.dryRun === true;
  const label = monthName(
    previousMonth(businessDate(now, "America/Chicago").slice(0, 7)),
  );
  const result = emptyResult(dryRun, label);
  if (opts.org !== undefined && !ORG_ID_RE.test(opts.org)) {
    throw new Error("invalid org id");
  }
  const sys = mintSystemContext({ job: "reports" });
  assertSystemContext(sys);
  const spec = CORE_ALERT_TYPES.find((t) => t.type === "reports.monthly");
  if (!spec) throw new Error("reports.monthly alert type missing");

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
      const orgs = await listOrgs(pb, opts.org);
      for (const org of orgs) {
        try {
          await runOrg(
            sys,
            pb,
            org,
            {
              now,
              dryRun,
              ...(opts.transport ? { transport: opts.transport } : {}),
            },
            spec,
            result,
          );
        } catch (err) {
          // One org's failure never stops the others.
          result.failedOrgs += 1;
          console.error(`[jobs/reports] an org failed: ${errName(err)}`);
        }
      }
    });

    // Heartbeat (monitor brief check 31).
    if (!dryRun) {
      if (result.failedOrgs === 0) {
        await writePlatformMeta(sys, HEARTBEAT_KEY, now.toISOString());
      }
      await writePlatformMeta(sys, COUNTS_KEY, JSON.stringify(result));
    }
    return result;
  } finally {
    if (token !== null) await releasePlatformLock(LOCK_KEY, token);
  }
}

/** Run the monthly report job once, serialised with any concurrent run. */
export async function runMonthlyReports(
  opts: MonthlyReportOptions = {},
): Promise<MonthlyReportResult> {
  return withJobLock(() => runOnce(opts));
}
