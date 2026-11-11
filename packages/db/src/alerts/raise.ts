// P11 alerts/raise (11-20; DASH-34, DASH-35, DASH-36, DASH-37; D285, D305, D313).
// A send failure is logged, never thrown: the form submit, webhook or job that raised the
// alert has already run (T-11-20-03).
//
// 1. Look the type up in the composed registry; the href must be a hub link (T-11-20-04).
// 2. Recipients = the org's members whose role and grants cover the type (eligibleFor,
//    T-11-20-01). Staff are never members (invariant 10).
// 3. ONE PocketBase batch writes every row (Pitfall 11). A recipient with an unread row for
//    the same source_key is skipped; a read one is replaced, so the alert comes back unread
//    (the unique (organization, user, source_key) index allows one row per key). A Needs-you
//    kind (billing:fix_card, billing:finish_stripe, inbox:<id>) clears on its own without being
//    read, so its unread row is replaced too unless it is under COLLAPSE_WINDOW_MS old: a second
//    card failure next month is a new alert, pushed again (WR-B01).
// 4. After the batch, best effort per recipient: email urgent/normal at once when the
//    person's email channel is on (alert.notify, safe title in sensitive mode); push at once
//    unless the channel is off (skipped), quiet hours or a same-type push within 10 minutes
//    (held: the 11-23 job sends the release / collapsed push). A `collapse: false` type
//    (booking requests) is only held by quiet hours.
//
// 12-05 (support, RESEARCH Pattern 4) adds three opt-ins; absent, behaviour is unchanged:
// - input.audience: recipients = eligible members ∩ (named users ∪ members with a listed role).
// - deps.renotify: an unread prior row for the key is replaced (one bell row per key) and the
//   email goes again; push stays collapse-held by recentSameTypePush (Pitfall 3).
// - deps.cdsEmail: the per-person email is `support.notify` sent as CDS Support, no-reply (D97),
//   still gated by the person's email channel (alertEmailOn).
import { businessTimeZone, isHubHref } from "@cds/core/today";
import {
  alertSubject,
  channelsFor,
  COLLAPSE_WINDOW_MS,
  eligibleFor,
  inQuietHours,
  sensitivePracticeOn,
  type AlertChannelPrefs,
  type AlertTypeSpec,
  type QuietHours,
} from "@cds/core/alerts";
import { ORG_ROLES, type OrgRole } from "@cds/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { registeredAlertTypes } from "./addon-types";
import { sourceKeyIsNeedsYouKind } from "./list";
import {
  assertSystemContext,
  isOrgContext,
  mintSystemContext,
  type OrgContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import type { SupportEmailVars } from "../email/render/templates";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { isUniqueViolation } from "../payments/staff-alert";
import { newRecordId } from "../repository";
import {
  getPushSender,
  recordOutcome,
  subscriptionsForUsers,
  unreadForBadge,
  type PushSender,
} from "./push";

/**
 * Whose alert: the acting member's OrgContext, or a system job's SystemContext (minted inside
 * @cds/db) plus the org it names. A plain object without a minted context is refused (review
 * 11 WR-B07, invariant 1).
 */
export type AlertTarget = OrgContext | { orgId: string; as: SystemContext };

export type RaiseAlertInput = {
  type: string;
  /** Dedupe key, e.g. `inbox:<id>`, `billing:fix_card` (the Needs-you key when there is one). */
  sourceKey: string;
  /** Full title, shown in the hub. */
  title: string;
  /** No-names title for push and email in sensitive-practice mode. */
  safeTitle: string;
  /** Relative hub link; must pass isHubHref. */
  href: string;
  /** Defaults to the type's section. */
  section?: string;
  /** The email button ("Reply", "Fix your card"); defaults to "Open". */
  actionLabel?: string;
  /** When the event happened; informational (rows are stamped by PocketBase). */
  at?: Date;
  /**
   * 12-05: narrow the recipients to these people and roles (still within eligibleFor, so a
   * Viewer never gets a normal alert). Absent = every eligible member.
   */
  audience?: AlertAudience;
};

export type AlertAudience = {
  users?: readonly string[];
  roles?: readonly OrgRole[];
};

export type RaiseAlertDeps = {
  /** Composed registry (core + add-on manifests); defaults to the core types. */
  types?: readonly AlertTypeSpec[];
  now?: Date;
  push?: PushSender;
  transport?: EmailTransport;
  /**
   * 11-21: the caller already sends its own email for this event (form notification,
   * billing card-failed, Connect stopped), so the generic alert email is skipped.
   */
  dedicatedEmail?: boolean;
  /** 12-05: replace an unread prior row for the key and email again (support replies). */
  renotify?: true;
  /** 12-05: send this CDS Support email (no-reply) instead of `alert.notify`. */
  cdsEmail?: {
    type: "support.notify";
    vars: SupportEmailVars;
    /** 13-24: the org the mail is about (demo drop, D293); defaults to the alert's org. */
    concernsOrg?: string;
  };
  /** Called once per email actually sent (CLI counts: "2 alerts raised, 2 emailed"). */
  onEmailed?: () => void;
};

/** The person's email channel for this type (prefs override the type's default). */
export function alertEmailOn(
  spec: AlertTypeSpec,
  prefs: AlertChannelPrefs,
): boolean {
  return channelsFor(spec, prefs).email;
}

const COLLECTION = "alerts";
/** The context CDS Support mail is sent under (sendEmail's cds sender needs a minted one). */
const SUPPORT_MAIL_CTX = mintSystemContext({ job: "support-alerts" });
const SOURCE_KEY_RE = /^[A-Za-z0-9:_.\-]{1,160}$/;
const SECTION_RE = /^[a-z0-9:_-]{1,40}$/;

/** Owner words for the email preheader ("Rivera Bakery · Inbox"). */
const SECTION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  today: "Today",
  inbox: "Inbox",
  website: "Website",
  marketing: "Marketing",
  reports: "Reports",
  settings: "Settings",
  addons: "Add-ons",
  help: "Help",
  support: "Support",
});

function errName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clip(v: string, max: number): string {
  return v.length > max ? v.slice(0, max) : v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sectionWord(section: string): string {
  if (SECTION_WORDS[section]) return SECTION_WORDS[section];
  if (section.startsWith("addon:")) {
    const slug = section.slice("addon:".length).replace(/-/g, " ");
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }
  return "Your site";
}

type Recipient = {
  user: string;
  email: string;
  channels: AlertChannelPrefs;
  quiet: QuietHours | undefined;
};

type OrgFacts = {
  name: string;
  timeZone: string;
  sensitive: boolean;
};

async function orgFacts(pb: PocketBase, orgId: string): Promise<OrgFacts> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" });
  const res = await pb.collection("business_profile").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "time_zone,business_type,sensitive_practice",
  });
  const p = res.items[0];
  const pv = str(p?.sensitive_practice);
  return {
    name: str(org.name),
    timeZone: businessTimeZone(str(p?.time_zone)),
    sensitive: sensitivePracticeOn(
      pv === "on" || pv === "off" ? pv : "",
      str(p?.business_type),
    ),
  };
}

function asRole(v: unknown): OrgRole | null {
  return (ORG_ROLES as readonly string[]).includes(str(v))
    ? (v as OrgRole)
    : null;
}

function grantsOf(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((g): g is string => typeof g === "string")
    : [];
}

/** `field = {:u0} || field = {:u1} ...` with every value bound (T-02-13). */
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

/** Eligible members plus their login email (one query each, bound filters). */
async function eligibleMembers(
  pb: PocketBase,
  orgId: string,
  spec: AlertTypeSpec,
  audience?: AlertAudience,
): Promise<{ user: string; email: string }[]> {
  const memberships = await pb.collection("memberships").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "user,role,addon_grants",
  });
  const named = new Set(audience?.users ?? []);
  const roles = new Set<string>(audience?.roles ?? []);
  const users: string[] = [];
  for (const m of memberships) {
    const role = asRole(m.role);
    const user = str(m.user);
    if (!role || !user) continue;
    // 12-05: audience narrows, never widens (T-12-05-02).
    if (audience && !named.has(user) && !roles.has(role)) continue;
    if (eligibleFor({ role, grants: grantsOf(m.addon_grants) }, spec)) {
      users.push(user);
    }
  }
  const unique = [...new Set(users)];
  if (unique.length === 0) return [];
  const emails = new Map<string, string>();
  const ids = anyOf("id", unique);
  const accounts = await pb.collection("users").getFullList({
    filter: pb.filter(ids.clause, ids.params),
    fields: "id,email",
  });
  for (const a of accounts) emails.set(a.id, str(a.email));
  return unique.map((user) => ({ user, email: emails.get(user) ?? "" }));
}

/** Recipients' channel overrides and quiet hours in one bound query (member_prefs). */
async function prefsForUsers(
  pb: PocketBase,
  orgId: string,
  userIds: readonly string[],
): Promise<Map<string, Pick<Recipient, "channels" | "quiet">>> {
  const out = new Map<string, Pick<Recipient, "channels" | "quiet">>();
  if (userIds.length === 0) return out;
  const users = anyOf("user", userIds);
  const clause = "organization = {:org} && (" + users.clause + ")";
  const rows = await pb.collection("member_prefs").getFullList({
    filter: pb.filter(clause, { org: orgId, ...users.params }),
    fields: "user,alert_channels,quiet_hours",
  });
  for (const r of rows) {
    const q = isRecord(r.quiet_hours) ? r.quiet_hours : null;
    out.set(str(r.user), {
      // channelsFor ignores anything that is not a boolean.
      channels: isRecord(r.alert_channels)
        ? (r.alert_channels as AlertChannelPrefs)
        : {},
      // quietWindow falls back per end on a malformed time.
      quiet: q
        ? { on: q.on === true, from: str(q.from), until: str(q.until) }
        : undefined,
    });
  }
  return out;
}

type Planned = { recipient: Recipient; id: string };

/** PocketBase `created` ("2026-10-12 11:31:29.123Z") as epoch ms; NaN when unreadable. */
function createdMs(row: RecordModel): number {
  return Date.parse(str(row.created).replace(" ", "T"));
}

/**
 * WR-B01: an unread prior row blocks a re-raise, except a Needs-you kind whose row is older
 * than COLLAPSE_WINDOW_MS (the item cleared unread and came back). `created` is stamped by the
 * PocketBase clock, so it is compared with the wall clock, never deps.now. An unreadable
 * timestamp keeps the row (no double push).
 */
function unreadBlocks(row: RecordModel, needsYou: boolean): boolean {
  if (str(row.read_at)) return false;
  if (!needsYou) return true;
  const at = createdMs(row);
  return !Number.isFinite(at) || Date.now() - at < COLLAPSE_WINDOW_MS;
}

/**
 * One batch: create a row per recipient; skip a recipient with an unread row for the key,
 * replace a read one (or a stale unread Needs-you one, WR-B01). Returns the recipients whose
 * row was written.
 */
async function writeRows(
  pb: PocketBase,
  orgId: string,
  spec: AlertTypeSpec,
  input: RaiseAlertInput,
  section: string,
  recipients: readonly Recipient[],
  pushOn: (r: Recipient) => boolean,
  renotify: boolean,
): Promise<Planned[]> {
  const existing = await pb.collection(COLLECTION).getFullList({
    filter: pb.filter("organization = {:org} && source_key = {:key}", {
      org: orgId,
      key: input.sourceKey,
    }),
    fields: "id,user,read_at,created",
  });
  const byUser = new Map<string, RecordModel>();
  for (const r of existing) byUser.set(str(r.user), r);
  const needsYou = sourceKeyIsNeedsYouKind(spec.type, input.sourceKey);

  const batch = pb.createBatch();
  const planned: Planned[] = [];
  for (const recipient of recipients) {
    const prior = byUser.get(recipient.user);
    if (prior && !renotify && unreadBlocks(prior, needsYou)) continue;
    if (prior) batch.collection(COLLECTION).delete(prior.id);
    const id = newRecordId();
    batch.collection(COLLECTION).create({
      id,
      organization: orgId,
      user: recipient.user,
      type: spec.type,
      level: spec.level,
      title: clip(input.title, 200),
      safe_title: clip(input.safeTitle, 200),
      href: input.href,
      section,
      source_key: input.sourceKey,
      push_state: pushOn(recipient) ? "pending" : "skipped",
    });
    planned.push({ recipient, id });
  }
  if (planned.length > 0) await batch.send();
  return planned;
}

async function emailOne(
  as: OrgContext | SystemContext,
  orgId: string,
  facts: OrgFacts,
  spec: AlertTypeSpec,
  input: RaiseAlertInput,
  section: string,
  to: string,
  now: Date,
  transport: EmailTransport | undefined,
  cdsEmail: RaiseAlertDeps["cdsEmail"],
): Promise<boolean> {
  if (!to) return false;
  if (cdsEmail) {
    // CDS speaking (D83): sent as CDS Support from no-reply, never as the org (D97).
    const sent = await sendEmail(
      { kind: "cds", ctx: SUPPORT_MAIL_CTX, noReply: true },
      cdsEmail.type,
      to,
      cdsEmail.vars,
      {
        now,
        concernsOrg: cdsEmail.concernsOrg ?? orgId,
        ...(transport ? { transport } : {}),
      },
    );
    return sent.status === "sent";
  }
  const res = await sendEmail(
    { kind: "org", ctx: as, orgId },
    "alert.notify",
    to,
    {
      business: facts.name,
      section: sectionWord(section),
      title: input.title,
      safeTitle: alertSubject(
        spec,
        { title: input.title, safe_title: input.safeTitle },
        true,
      ),
      sensitive: facts.sensitive,
      actionLabel: input.actionLabel?.trim() || "Open",
      href: platformUrl(input.href),
      sentAt: now,
      alertLabel: spec.label,
      settingsHref: platformUrl("/hub/profile#alerts"),
      timeZone: facts.timeZone,
    },
    transport ? { transport, now } : { now },
  );
  return res.status === "sent";
}

async function recentSameTypePush(
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

/**
 * Push to every device of one person: "sent" | "failed" | "skipped" (no device). A "gone"
 * device (404/410) is deleted, an "error" bumps fail_count, an "ok" stamps last_ok_at (11-22).
 */
async function pushOne(
  pb: PocketBase,
  orgId: string,
  facts: OrgFacts,
  spec: AlertTypeSpec,
  input: RaiseAlertInput,
  user: string,
  sender: PushSender,
  now: Date,
): Promise<"sent" | "failed" | "skipped"> {
  const subs = await subscriptionsForUsers(pb, orgId, [user]);
  if (subs.length === 0) return "skipped";
  const payload = {
    title: facts.name,
    org: orgId,
    body: alertSubject(
      spec,
      { title: input.title, safe_title: input.safeTitle },
      facts.sensitive,
    ),
    href: input.href,
    // A no-collapse type gets its own tag (and push Topic), so the next one never replaces it.
    tag:
      spec.collapse === false ? `${spec.type}:${input.sourceKey}` : spec.type,
    urgency: spec.level === "urgent" ? ("high" as const) : ("normal" as const),
    badge: await unreadForBadge(pb, orgId, user, now).catch(() => undefined),
  };
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

async function deliver(
  pb: PocketBase,
  as: OrgContext | SystemContext,
  orgId: string,
  facts: OrgFacts,
  spec: AlertTypeSpec,
  input: RaiseAlertInput,
  section: string,
  planned: readonly Planned[],
  deps: RaiseAlertDeps,
  now: Date,
): Promise<void> {
  if (spec.level === "summary") return; // digest (11-23)
  const sender = deps.push ?? getPushSender();
  for (const { recipient, id } of planned) {
    const ch = channelsFor(spec, recipient.channels);
    if (alertEmailOn(spec, recipient.channels) && !deps.dedicatedEmail) {
      try {
        if (
          await emailOne(
            as,
            orgId,
            facts,
            spec,
            input,
            section,
            recipient.email,
            now,
            deps.transport,
            deps.cdsEmail,
          )
        ) {
          deps.onEmailed?.();
          await pb.collection(COLLECTION).update(id, { emailed_at: now });
        }
      } catch (err) {
        console.error(`[alerts] email failed ${errName(err)}`);
      }
    }
    if (ch.push) {
      try {
        let state: "held" | "sent" | "failed" | "skipped";
        if (inQuietHours(now, facts.timeZone, recipient.quiet)) {
          state = "held";
        } else if (
          spec.collapse !== false &&
          (await recentSameTypePush(pb, orgId, recipient.user, spec.type, now))
        ) {
          state = "held";
        } else {
          state = await pushOne(
            pb,
            orgId,
            facts,
            spec,
            input,
            recipient.user,
            sender,
            now,
          );
        }
        await pb
          .collection(COLLECTION)
          .update(
            id,
            state === "sent"
              ? { push_state: state, pushed_at: now }
              : { push_state: state },
          );
      } catch (err) {
        console.error(`[alerts] push failed ${errName(err)}`);
      }
    }
  }
}

function validInput(input: RaiseAlertInput): boolean {
  if (!isRecord(input)) return false;
  if (typeof input.title !== "string" || !input.title.trim()) return false;
  if (typeof input.safeTitle !== "string") return false;
  if (
    typeof input.sourceKey !== "string" ||
    !SOURCE_KEY_RE.test(input.sourceKey)
  ) {
    return false;
  }
  if (typeof input.href !== "string" || input.href.length > 300) return false;
  if (!isHubHref(input.href)) return false;
  if (input.section !== undefined && !SECTION_RE.test(input.section)) {
    return false;
  }
  if (input.audience !== undefined) {
    const a: unknown = input.audience;
    if (!isRecord(a)) return false;
    const { users, roles } = a as { users?: unknown; roles?: unknown };
    if (
      users !== undefined &&
      (!Array.isArray(users) || !users.every((u) => typeof u === "string"))
    ) {
      return false;
    }
    if (
      roles !== undefined &&
      (!Array.isArray(roles) || !roles.every((r) => asRole(r) !== null))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Raise one alert for every eligible member of the org. Never throws: a failure is logged
 * by error name only and returns `{ recipients: 0 }`.
 */
export async function raiseAlert(
  target: AlertTarget,
  input: RaiseAlertInput,
  deps: RaiseAlertDeps = {},
): Promise<{ recipients: number }> {
  try {
    const orgId = isOrgContext(target)
      ? target.orgId
      : isRecord(target)
        ? str((target as { orgId?: unknown }).orgId)
        : "";
    if (!orgId) return { recipients: 0 };
    let as: OrgContext | SystemContext;
    if (isOrgContext(target)) {
      as = target;
    } else {
      const sys = (target as { as?: unknown }).as;
      try {
        assertSystemContext(sys);
      } catch {
        console.warn(`[alerts] raise refused: no minted context`);
        return { recipients: 0 };
      }
      as = sys;
    }
    if (!validInput(input)) {
      console.warn(`[alerts] raise refused: invalid input`);
      return { recipients: 0 };
    }
    const types = deps.types ?? registeredAlertTypes();
    const spec = types.find((s) => s.type === input.type);
    if (!spec) {
      console.warn(`[alerts] raise refused: unknown type`);
      return { recipients: 0 };
    }
    const section = input.section ?? spec.section;
    const now = deps.now ?? new Date();

    return await withSuperuser(async (pb) => {
      const members = await eligibleMembers(pb, orgId, spec, input.audience);
      if (members.length === 0) return { recipients: 0 };
      const prefs = await prefsForUsers(
        pb,
        orgId,
        members.map((m) => m.user),
      );
      const recipients: Recipient[] = members.map((m) => ({
        ...m,
        channels: prefs.get(m.user)?.channels ?? {},
        quiet: prefs.get(m.user)?.quiet,
      }));
      const pushOn = (r: Recipient) => channelsFor(spec, r.channels).push;
      let planned: Planned[];
      try {
        planned = await writeRows(
          pb,
          orgId,
          spec,
          input,
          section,
          recipients,
          pushOn,
          deps.renotify === true,
        );
      } catch (err) {
        // A concurrent raise of the same key won the unique index: re-read once.
        if (!isUniqueViolation(err)) throw err;
        planned = await writeRows(
          pb,
          orgId,
          spec,
          input,
          section,
          recipients,
          pushOn,
          deps.renotify === true,
        );
      }
      if (planned.length === 0) return { recipients: 0 };
      try {
        const facts = await orgFacts(pb, orgId);
        await deliver(
          pb,
          as,
          orgId,
          facts,
          spec,
          input,
          section,
          planned,
          deps,
          now,
        );
      } catch (err) {
        console.error(`[alerts] delivery failed ${errName(err)}`);
      }
      return { recipients: planned.length };
    });
  } catch (err) {
    console.error(`[alerts] raise failed ${errName(err)}`);
    return { recipients: 0 };
  }
}
