// P11 today/prefs (11-12; DASH-17, DASH-22, DASH-33, DASH-36): one member_prefs row per
// (organization, user) holding that person's Today layout, tours seen, alert channels, quiet
// hours, dismissed From CDS cards and seen flags ("You're live").
//
// - Per person (Pitfall 6): every read and write is bound to `organization = ctx.orgId` and
//   `user = ctx.actor`. Nobody, the Owner included, reads a colleague's prefs (T-11-12-02).
// - Impersonation (Pitfall 7): reads return the defaults, never the owner's or the staff
//   member's row; every write throws ImpersonationDenied (T-11-12-01).
// - Upsert: the unique (organization, user) index decides; a create that loses the race
//   re-reads and updates the winner's row, so concurrent saves never leave two rows.
// - Validation: ids `^[a-z0-9:_.-]{1,80}$`, arrays and channel maps ≤ 100 entries, times
//   `HH:MM` on 30-minute steps. Unknown keys are refused.
import { ImpersonationDenied, InvalidInput } from "@cds/core";
import type { SupportRead } from "@cds/core/support";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { assertOrgContext, type OrgContext } from "../context";
import { isUniqueViolation } from "../payments/staff-alert";
import { newRecordId } from "../repository";

export type AlertChannel = "email" | "push";
export type AlertChannelPrefs = { email?: boolean; push?: boolean };
export type QuietHours = { on: boolean; from: string; until: string };

export type MemberPrefs = {
  todayLayout: { order: string[]; hidden: string[] };
  toursSeen: string[];
  alertChannels: Record<string, AlertChannelPrefs>;
  quietHours: QuietHours;
  dismissed: string[];
  seenFlags: string[];
};

export type MemberPrefsPatch = Partial<MemberPrefs>;

const COLLECTION = "member_prefs";
const ID_RE = /^[a-z0-9:_.-]{1,80}$/;
const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;
const MAX_ENTRIES = 100;
const PATCH_KEYS: readonly (keyof MemberPrefs)[] = Object.freeze([
  "todayLayout",
  "toursSeen",
  "alertChannels",
  "quietHours",
  "dismissed",
  "seenFlags",
]);

function defaults(): MemberPrefs {
  return {
    todayLayout: { order: [], hidden: [] },
    toursSeen: [],
    alertChannels: {},
    quietHours: { on: true, from: "21:00", until: "07:00" },
    dismissed: [],
    seenFlags: [],
  };
}

/** The prefs a person has before saving anything (quiet hours on, 21:00-07:00). */
export const DEFAULT_MEMBER_PREFS: Readonly<MemberPrefs> =
  Object.freeze(defaults());

// ---------------------------------------------------------------------------------------
// Validation (caller input) and normalisation (stored rows, read defensively).

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertId(v: unknown, what: string): asserts v is string {
  if (typeof v !== "string" || !ID_RE.test(v)) {
    throw new InvalidInput(`${what} must match ${ID_RE.source}`);
  }
}

function idList(v: unknown, what: string): string[] {
  if (!Array.isArray(v)) throw new InvalidInput(`${what} must be a list`);
  if (v.length > MAX_ENTRIES) {
    throw new InvalidInput(`${what} has more than ${MAX_ENTRIES} entries`);
  }
  for (const id of v) assertId(id, `${what} entry`);
  return [...new Set(v as string[])];
}

function time(v: unknown, what: string): string {
  if (typeof v !== "string" || !TIME_RE.test(v)) {
    throw new InvalidInput(`${what} must be HH:MM on a 30-minute step`);
  }
  return v;
}

function channelPrefs(v: unknown, what: string): AlertChannelPrefs {
  if (!isRecord(v)) throw new InvalidInput(`${what} must be an object`);
  const out: AlertChannelPrefs = {};
  for (const [k, on] of Object.entries(v)) {
    if (k !== "email" && k !== "push") {
      throw new InvalidInput(`${what} has an unknown channel`);
    }
    if (on === undefined) continue;
    if (typeof on !== "boolean") {
      throw new InvalidInput(`${what}.${k} must be true or false`);
    }
    out[k] = on;
  }
  return out;
}

function channelMap(v: unknown): Record<string, AlertChannelPrefs> {
  if (!isRecord(v)) throw new InvalidInput("alertChannels must be an object");
  const entries = Object.entries(v);
  if (entries.length > MAX_ENTRIES) {
    throw new InvalidInput(`alertChannels has more than ${MAX_ENTRIES} types`);
  }
  const out: Record<string, AlertChannelPrefs> = {};
  for (const [type, prefs] of entries) {
    assertId(type, "alert type");
    out[type] = channelPrefs(prefs, `alertChannels.${type}`);
  }
  return out;
}

function validatePatch(patch: unknown): MemberPrefsPatch {
  if (!isRecord(patch)) throw new InvalidInput("prefs patch must be an object");
  const out: MemberPrefsPatch = {};
  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.includes(key as keyof MemberPrefs)) {
      throw new InvalidInput(`unknown prefs key: ${key.slice(0, 40)}`);
    }
  }
  if (patch.todayLayout !== undefined) {
    const l = patch.todayLayout;
    if (!isRecord(l)) throw new InvalidInput("todayLayout must be an object");
    for (const k of Object.keys(l)) {
      if (k !== "order" && k !== "hidden") {
        throw new InvalidInput("todayLayout has an unknown key");
      }
    }
    out.todayLayout = {
      order: idList(l.order ?? [], "todayLayout.order"),
      hidden: idList(l.hidden ?? [], "todayLayout.hidden"),
    };
  }
  if (patch.quietHours !== undefined) {
    const q = patch.quietHours;
    if (!isRecord(q)) throw new InvalidInput("quietHours must be an object");
    for (const k of Object.keys(q)) {
      if (k !== "on" && k !== "from" && k !== "until") {
        throw new InvalidInput("quietHours has an unknown key");
      }
    }
    if (typeof q.on !== "boolean") {
      throw new InvalidInput("quietHours.on must be true or false");
    }
    out.quietHours = {
      on: q.on,
      from: time(q.from, "quietHours.from"),
      until: time(q.until, "quietHours.until"),
    };
  }
  if (patch.alertChannels !== undefined) {
    out.alertChannels = channelMap(patch.alertChannels);
  }
  if (patch.toursSeen !== undefined) {
    out.toursSeen = idList(patch.toursSeen, "toursSeen");
  }
  if (patch.dismissed !== undefined) {
    out.dismissed = idList(patch.dismissed, "dismissed");
  }
  if (patch.seenFlags !== undefined) {
    out.seenFlags = idList(patch.seenFlags, "seenFlags");
  }
  return out;
}

/** A stored value is trusted only when it validates; anything else falls back. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function fromRow(row: RecordModel): MemberPrefs {
  const d = defaults();
  const layout = isRecord(row.today_layout) ? row.today_layout : {};
  const quiet = isRecord(row.quiet_hours) ? row.quiet_hours : null;
  return {
    todayLayout: {
      order: safe(() => idList(layout.order ?? [], "order"), []),
      hidden: safe(() => idList(layout.hidden ?? [], "hidden"), []),
    },
    toursSeen: safe(() => idList(row.tours_seen ?? [], "toursSeen"), []),
    alertChannels: safe(() => channelMap(row.alert_channels ?? {}), {}),
    quietHours: quiet
      ? safe(
          () => validatePatch({ quietHours: quiet }).quietHours ?? d.quietHours,
          d.quietHours,
        )
      : d.quietHours,
    dismissed: safe(() => idList(row.dismissed ?? [], "dismissed"), []),
    seenFlags: safe(() => idList(row.seen_flags ?? [], "seenFlags"), []),
  };
}

function toBody(p: MemberPrefs): Record<string, unknown> {
  return {
    today_layout: p.todayLayout,
    tours_seen: p.toursSeen,
    alert_channels: p.alertChannels,
    quiet_hours: p.quietHours,
    dismissed: p.dismissed,
    seen_flags: p.seenFlags,
  };
}

// ---------------------------------------------------------------------------------------
// Storage.

async function ownRow(
  pb: PocketBase,
  ctx: OrgContext,
): Promise<RecordModel | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org} && user = {:u}", {
      org: ctx.orgId,
      u: ctx.actor,
    }),
  });
  return res.items[0] ?? null;
}

function assertWritable(ctx: OrgContext): void {
  assertOrgContext(ctx);
  if (ctx.impersonator) {
    throw new ImpersonationDenied("staff cannot change a member's preferences");
  }
  if (ctx.systemJob || !ctx.actor) {
    throw new ImpersonationDenied("preferences belong to a signed-in person");
  }
}

/**
 * Read-modify-write of the caller's own row. `change` receives the current prefs and returns
 * the next ones (already validated). A create that loses the unique-index race retries as an
 * update of the row that won.
 */
async function writeOwn(
  ctx: OrgContext,
  change: (current: MemberPrefs) => MemberPrefs,
): Promise<MemberPrefs> {
  assertWritable(ctx);
  // Review 11 IN-E02: one read-modify-write per person at a time, so two tabs appending
  // (two tours finishing together) never drop each other's id.
  return withOrgLock(`member-prefs:${ctx.orgId}:${ctx.actor}`, () =>
    writeOwnLocked(ctx, change),
  );
}

async function writeOwnLocked(
  ctx: OrgContext,
  change: (current: MemberPrefs) => MemberPrefs,
): Promise<MemberPrefs> {
  return withSuperuser(async (pb) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await ownRow(pb, ctx);
      const next = change(row ? fromRow(row) : defaults());
      if (row) {
        await pb.collection(COLLECTION).update(row.id, toBody(next));
        return next;
      }
      try {
        await pb.collection(COLLECTION).create({
          id: newRecordId(),
          organization: ctx.orgId,
          user: ctx.actor,
          ...toBody(next),
        });
        return next;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new InvalidInput("preferences are being saved elsewhere; try again");
  });
}

// ---------------------------------------------------------------------------------------
// Public API.

/** The caller's own prefs; the defaults when nothing is saved or when impersonating. */
export async function readMemberPrefs(ctx: OrgContext): Promise<MemberPrefs> {
  assertOrgContext(ctx);
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return defaults();
  const row = await withSuperuser((pb) => ownRow(pb, ctx));
  return row ? fromRow(row) : defaults();
}

/** Upserts the caller's row with a validated patch (each given key replaces the stored one). */
export async function updateMemberPrefs(
  ctx: OrgContext,
  patch: MemberPrefsPatch,
): Promise<MemberPrefs> {
  assertWritable(ctx);
  const clean = validatePatch(patch);
  return writeOwn(ctx, (cur) => ({ ...cur, ...clean }));
}

function append(list: string[], id: string): string[] {
  if (list.includes(id)) return list;
  if (list.length >= MAX_ENTRIES) {
    // Oldest first out, so the newest flag always lands.
    return [...list.slice(list.length - MAX_ENTRIES + 1), id];
  }
  return [...list, id];
}

/** Records a one-time flag ("live:celebrated", ...). Idempotent. */
export async function markSeen(
  ctx: OrgContext,
  flag: string,
): Promise<MemberPrefs> {
  assertWritable(ctx);
  assertId(flag, "seen flag");
  return writeOwn(ctx, (cur) => ({
    ...cur,
    seenFlags: append(cur.seenFlags, flag),
  }));
}

/** Records a dismissed card id (`announcement:<id>`, `tip:<id>`, ...). Idempotent. */
export async function markDismissed(
  ctx: OrgContext,
  id: string,
): Promise<MemberPrefs> {
  assertWritable(ctx);
  assertId(id, "dismissed id");
  return writeOwn(ctx, (cur) => ({
    ...cur,
    dismissed: append(cur.dismissed, id),
  }));
}

/** Records a finished (or skipped) tour id in one locked step (IN-E02). Idempotent. */
export async function markTourSeen(
  ctx: OrgContext,
  id: string,
): Promise<MemberPrefs> {
  assertWritable(ctx);
  assertId(id, "tour id");
  return writeOwn(ctx, (cur) => ({
    ...cur,
    toursSeen: append(cur.toursSeen, id),
  }));
}

/** Forgets every tour the caller has seen, so they show again (Help > Replay tours). */
export async function resetTours(ctx: OrgContext): Promise<MemberPrefs> {
  assertWritable(ctx);
  return writeOwn(ctx, (cur) => ({ ...cur, toursSeen: [] }));
}

/** Turns one channel on or off for one alert type. */
export async function setAlertChannel(
  ctx: OrgContext,
  type: string,
  channel: AlertChannel,
  on: boolean,
): Promise<MemberPrefs> {
  assertWritable(ctx);
  assertId(type, "alert type");
  if (channel !== "email" && channel !== "push") {
    throw new InvalidInput("channel must be email or push");
  }
  if (typeof on !== "boolean") {
    throw new InvalidInput("on must be true or false");
  }
  return writeOwn(ctx, (cur) => {
    const existing = cur.alertChannels[type];
    if (!existing && Object.keys(cur.alertChannels).length >= MAX_ENTRIES) {
      throw new InvalidInput(
        `alertChannels has more than ${MAX_ENTRIES} types`,
      );
    }
    return {
      ...cur,
      alertChannels: {
        ...cur.alertChannels,
        [type]: { ...(existing ?? {}), [channel]: on },
      },
    };
  });
}

// ---------------------------------------------------------------------------------------
// Support read state (12-12; COMM-01): `support_read` maps a support thread id to the time
// this person last read it. Kept beside (not inside) MemberPrefs so the Today/Profile model
// and its callers are unchanged; writeOwn never touches the field, so it survives their saves.

/** At most this many threads are remembered; the oldest read drops first. */
export const SUPPORT_READ_MAX = 200;
const THREAD_ID_RE = /^[a-z0-9]{15}$/;

/**
 * Reserved `support_read` keys for "last opened the notes / documents" (support/notes-docs.ts).
 * Keys must look like a record id (15 lowercase letters/digits), so these are fixed ids no
 * PocketBase record will ever be given in practice. 12-REVIEW IN-A01: never evicted, or every
 * note and document would show unread again once 200 threads were read after them.
 */
export const SUPPORT_READ_NOTES_KEY = "cdsnotes0000000";
export const SUPPORT_READ_DOCUMENTS_KEY = "cdsdocuments000";
const PINNED_READ_KEYS: ReadonlySet<string> = new Set([
  SUPPORT_READ_NOTES_KEY,
  SUPPORT_READ_DOCUMENTS_KEY,
]);

function supportReadOf(v: unknown): SupportRead {
  if (!isRecord(v)) return {};
  const out: SupportRead = {};
  for (const [id, at] of Object.entries(v)) {
    if (!THREAD_ID_RE.test(id) || typeof at !== "string") continue;
    if (Number.isNaN(Date.parse(at))) continue;
    out[id] = new Date(at).toISOString();
  }
  return out;
}

/** The caller's support read map; empty when impersonating, a job, or nothing saved. */
export async function readSupportRead(ctx: OrgContext): Promise<SupportRead> {
  assertOrgContext(ctx);
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return {};
  const row = await withSuperuser((pb) => ownRow(pb, ctx));
  return row ? supportReadOf(row.support_read) : {};
}

/**
 * Stores `support_read[threadId] = at` for the caller (never moves backwards). A no-op for an
 * impersonator, a system job or a context without a person (the read-path guard). The caller
 * (support/messages.ts) has already checked the thread belongs to this org.
 */
export async function recordSupportRead(
  ctx: OrgContext,
  threadId: string,
  at: Date,
): Promise<void> {
  assertOrgContext(ctx);
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return;
  if (typeof threadId !== "string" || !THREAD_ID_RE.test(threadId)) {
    throw new InvalidInput("thread id is invalid");
  }
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new InvalidInput("read time must be a valid date");
  }
  const iso = at.toISOString();
  await withOrgLock(`member-prefs:${ctx.orgId}:${ctx.actor}`, () =>
    withSuperuser(async (pb) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await ownRow(pb, ctx);
        const map = row ? supportReadOf(row.support_read) : {};
        const prev = map[threadId];
        if (prev && prev >= iso) return;
        map[threadId] = iso;
        const pinned = Object.entries(map).filter(([k]) =>
          PINNED_READ_KEYS.has(k),
        );
        const entries = Object.entries(map)
          .filter(([k]) => !PINNED_READ_KEYS.has(k))
          .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
        const next = Object.fromEntries([
          ...pinned,
          ...entries.slice(Math.max(0, entries.length - SUPPORT_READ_MAX)),
        ]);
        if (row) {
          await pb
            .collection(COLLECTION)
            .update(row.id, { support_read: next });
          return;
        }
        try {
          await pb.collection(COLLECTION).create({
            id: newRecordId(),
            organization: ctx.orgId,
            user: ctx.actor,
            ...toBody(defaults()),
            support_read: next,
          });
          return;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      throw new InvalidInput(
        "preferences are being saved elsewhere; try again",
      );
    }),
  );
}

/** Back to the defaults for every alert type (Profile > Reset alert choices). */
export async function resetAlertChannels(
  ctx: OrgContext,
): Promise<MemberPrefs> {
  assertWritable(ctx);
  return writeOwn(ctx, (cur) => ({ ...cur, alertChannels: {} }));
}
