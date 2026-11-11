"use server";
// Today actions (11-17; DASH-33; 11-UI-SPEC "Today" § 2 You're live; D-UI-P11-26;
// T-11-17-02). Public POST endpoints: arguments are untrusted. The person and org come
// only from the session (runAction). Only allow-listed seen flags are written.
// markSeenAction under impersonation is a silent no-op ({ seen: false }): CDS staff never
// consume the owner's one-time screen, and the owner's prefs are never written by staff.
// 11-19 (DASH-22, DASH-23; T-11-19-02, T-11-19-03): saveTodayLayoutAction and
// dismissFromCdsAction refuse under impersonation (a person's Today is theirs alone); ids are
// checked here (charset, length, count) and again by updateMemberPrefs / markDismissed.
import { ImpersonationDenied } from "@cds/core";
import { markDismissed, markSeen, updateMemberPrefs } from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";

/** Seen flags Today may set (11-19 / 11-48 add theirs here). */
const SEEN_FLAGS: ReadonlySet<string> = new Set(["youre_live"]);

const BAD_FLAG_COPY = "That didn't work. Reload the page and try again.";

export async function markSeenAction(
  flag: unknown,
): Promise<ActionResult<{ seen: boolean }>> {
  if (typeof flag !== "string" || !SEEN_FLAGS.has(flag)) {
    return { ok: false, code: "invalid_input", message: BAD_FLAG_COPY };
  }
  return runAction(async ({ ctx }) => {
    if (ctx.impersonator) return { seen: false };
    await markSeen(ctx, flag);
    return { seen: true };
  });
}

/** Card and From CDS ids: the member_prefs id rule (11-12). */
const PREF_ID = /^[a-z0-9:_.-]{1,80}$/;
const MAX_IDS = 100;

/** 11-19: the layout sheet's refusal for impersonating staff (UI-SPEC IMPERSONATING pattern). */
const IMPERSONATING_LAYOUT_COPY =
  "You're viewing as support staff, so changes to Today are turned off. Only the person can change their own Today.";

function idList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_IDS) return null;
  const out: string[] = [];
  for (const id of v) {
    if (typeof id !== "string" || !PREF_ID.test(id)) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Customize Today: save this person's card order and hidden cards (DASH-22). */
export async function saveTodayLayoutAction(
  layout: unknown,
): Promise<ActionResult<{ order: string[]; hidden: string[] }>> {
  const raw =
    typeof layout === "object" && layout !== null
      ? (layout as { order?: unknown; hidden?: unknown })
      : null;
  const order = raw ? idList(raw.order) : null;
  const hidden = raw ? idList(raw.hidden) : null;
  if (!order || !hidden) {
    return { ok: false, code: "invalid_input", message: BAD_FLAG_COPY };
  }
  return runAction(
    async ({ ctx }) => {
      if (ctx.impersonator) throw new ImpersonationDenied();
      const saved = await updateMemberPrefs(ctx, {
        todayLayout: { order, hidden },
      });
      return saved.todayLayout;
    },
    { impersonation: IMPERSONATING_LAYOUT_COPY },
  );
}

/** From CDS: dismiss one card for this person (DASH-23). Never under impersonation. */
export async function dismissFromCdsAction(
  id: unknown,
): Promise<ActionResult<{ dismissed: true }>> {
  if (typeof id !== "string" || !PREF_ID.test(id)) {
    return { ok: false, code: "invalid_input", message: BAD_FLAG_COPY };
  }
  return runAction(
    async ({ ctx }) => {
      if (ctx.impersonator) throw new ImpersonationDenied();
      await markDismissed(ctx, id);
      return { dismissed: true as const };
    },
    { impersonation: IMPERSONATING_LAYOUT_COPY },
  );
}
