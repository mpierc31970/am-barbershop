"use server";
// Your profile and alerts actions (11-24; DASH-36, D313, D285; 11-UI-SPEC "Profile";
// T-11-24-01, T-11-24-02). Public POST endpoints: arguments are untrusted. The person and org
// come only from the session (runAction), and every write lands in that person's own
// member_prefs row (11-12).
// - Every action refuses impersonating CDS staff (a person's alerts are theirs alone).
// - Alert types must be in the person's composed, eligible list (alertTypesFor): a type the
//   person's role or grants do not cover is refused, never stored.
// - Summary types have no phone channel; the bell cannot be switched off.
import { ImpersonationDenied, InvalidInput } from "@cds/core";
import {
  readMemberPrefs,
  removePushSubscription,
  resetAlertChannels,
  resetTours,
  setAlertChannel,
  updateMemberPrefs,
  type OrgContext,
} from "@cds/db";

type ChannelMap = Record<string, { email?: boolean; push?: boolean }>;
import { runAction, type ActionResult } from "../../lib/action";
import { alertTypesFor } from "../../lib/alert-types";

const IMPERSONATING_COPY =
  "You're viewing as support staff, so alert settings are turned off. Only the person can change their own alerts.";
const BAD_INPUT_COPY = "That didn't work. Reload the page and try again.";
const COPY = { impersonation: IMPERSONATING_COPY };

const TYPE_RE = /^[a-z0-9:_.-]{1,80}$/;
const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;
const DEVICE_ID = /^[a-z0-9]{15}$/;

function bad(): Extract<ActionResult<never>, { ok: false }> {
  return { ok: false, code: "invalid_input", message: BAD_INPUT_COPY };
}

function refuseStaff(ctx: OrgContext): void {
  if (ctx.impersonator) {
    throw new ImpersonationDenied("staff cannot change a member's alerts");
  }
}

/** The type's spec when this person may choose its channels; else InvalidInput. */
async function eligibleSpec(ctx: OrgContext, type: string) {
  const spec = (await alertTypesFor(ctx)).find((t) => t.type === type);
  if (!spec) throw new InvalidInput(BAD_INPUT_COPY);
  return spec;
}

/** One switch in the Alerts table: (type, "email" | "push", on). */
export async function setAlertChannelAction(
  type: unknown,
  channel: unknown,
  on: unknown,
): Promise<ActionResult<{ saved: true }>> {
  if (
    typeof type !== "string" ||
    !TYPE_RE.test(type) ||
    (channel !== "email" && channel !== "push") ||
    typeof on !== "boolean"
  ) {
    return bad();
  }
  return runAction(async ({ ctx }) => {
    refuseStaff(ctx);
    const spec = await eligibleSpec(ctx, type);
    if (channel === "push" && spec.level === "summary") {
      throw new InvalidInput(BAD_INPUT_COPY);
    }
    await setAlertChannel(ctx, type, channel, on);
    return { saved: true as const };
  }, COPY);
}

/** Reset to defaults; returns the choices it replaced so Undo can put them back. */
export async function resetAlertChannelsAction(): Promise<
  ActionResult<{ previous: ChannelMap }>
> {
  return runAction(async ({ ctx }) => {
    refuseStaff(ctx);
    const before = await readMemberPrefs(ctx);
    await resetAlertChannels(ctx);
    return { previous: before.alertChannels };
  }, COPY);
}

/** Undo of Reset to defaults: writes a previous map back (eligible types only). */
export async function restoreAlertChannelsAction(
  previous: unknown,
): Promise<ActionResult<{ saved: true }>> {
  if (
    typeof previous !== "object" ||
    previous === null ||
    Array.isArray(previous)
  ) {
    return bad();
  }
  const entries = Object.entries(previous as Record<string, unknown>);
  if (entries.length > 100) return bad();
  return runAction(async ({ ctx }) => {
    refuseStaff(ctx);
    const allowed = new Map((await alertTypesFor(ctx)).map((t) => [t.type, t]));
    const clean: ChannelMap = {};
    for (const [type, v] of entries) {
      const spec = allowed.get(type);
      // A type no longer covered is dropped, not refused: Undo restores what still applies.
      if (!spec || typeof v !== "object" || v === null) continue;
      const o = v as { email?: unknown; push?: unknown };
      const out: { email?: boolean; push?: boolean } = {};
      if (typeof o.email === "boolean") out.email = o.email;
      if (typeof o.push === "boolean" && spec.level !== "summary") {
        out.push = o.push;
      }
      if (Object.keys(out).length > 0) clean[type] = out;
    }
    await updateMemberPrefs(ctx, { alertChannels: clean });
    return { saved: true as const };
  }, COPY);
}

/** Quiet hours: on/off and a window in 30-minute steps (business time). */
export async function setQuietHoursAction(
  input: unknown,
): Promise<ActionResult<{ on: boolean; from: string; until: string }>> {
  const raw =
    typeof input === "object" && input !== null
      ? (input as { on?: unknown; from?: unknown; until?: unknown })
      : null;
  if (
    !raw ||
    typeof raw.on !== "boolean" ||
    typeof raw.from !== "string" ||
    typeof raw.until !== "string" ||
    !TIME_RE.test(raw.from) ||
    !TIME_RE.test(raw.until)
  ) {
    return bad();
  }
  const quietHours = { on: raw.on, from: raw.from, until: raw.until };
  return runAction(async ({ ctx }) => {
    refuseStaff(ctx);
    const saved = await updateMemberPrefs(ctx, { quietHours });
    return saved.quietHours;
  }, COPY);
}

/** Turn off alerts on one of the person's own devices (another person's id -> NotFound). */
export async function removeDeviceAction(
  id: unknown,
): Promise<ActionResult<{ removed: true }>> {
  if (typeof id !== "string" || !DEVICE_ID.test(id)) return bad();
  return runAction(async ({ ctx }) => {
    refuseStaff(ctx);
    await removePushSubscription(ctx, id);
    return { removed: true as const };
  }, COPY);
}

/** Show the tours again: clears this person's tours_seen. */
export async function resetToursAction(): Promise<
  ActionResult<{ reset: true }>
> {
  return runAction(async ({ ctx }) => {
    refuseStaff(ctx);
    await resetTours(ctx);
    return { reset: true as const };
  }, COPY);
}
