"use server";
// Marketing › Social actions (11-37 choice 5; DASH-14, DASH-15, DASH-16; T-11-37-01,
// T-11-37-02). Public POST endpoints: every argument is untrusted. The org comes only from the
// session (runAction); only allowlisted fields are copied, ids are checked for shape, and
// @cds/db re-checks permission (settings write: Owner, Admin) and every URL (https, platform host, not the
// site's own host) whatever the browser sent. Writes pass nextInvalidator, which drops the
// org's social and live-site cache tags so the footer icons follow on the next request.
// Each account action answers with the fresh list (fallback flags and codes come from the
// server, never the browser).
import {
  addSocialAccount,
  listSocialAccounts,
  removeSocialAccount,
  reorderSocialAccounts,
  setGrowTick,
  updateSocialAccount,
  type SocialAccount,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { nextInvalidator } from "../../lib/invalidator";

const RECORD_ID = /^[a-z0-9]{15}$/;
const TIP_ID = /^[a-z0-9-]{1,40}$/;
const MAX_ACCOUNTS = 20;
const TEXT_MAX = 600;

const BAD_ID_COPY = "That account wasn't found. Reload the page and try again.";

type Accounts = { accounts: SocialAccount[] };

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function text(v: unknown): string | undefined {
  return typeof v === "string" ? v.slice(0, TEXT_MAX) : undefined;
}

function badId(): ActionResult<never> {
  return { ok: false, code: "invalid_input", message: BAD_ID_COPY };
}

function accountInput(raw: unknown): {
  platform: unknown;
  url: unknown;
  label?: string;
} {
  const r = record(raw);
  const label = text(r.label);
  return {
    platform: text(r.platform),
    url: text(r.url),
    ...(label !== undefined ? { label } : {}),
  };
}

const deps = { invalidator: nextInvalidator };

export async function addSocialAccountAction(
  input: unknown,
): Promise<ActionResult<Accounts>> {
  const clean = accountInput(input);
  return runAction(async ({ ctx }) => {
    await addSocialAccount(ctx, clean, deps);
    return { accounts: await listSocialAccounts(ctx) };
  });
}

export async function updateSocialAccountAction(
  id: unknown,
  patch: unknown,
): Promise<ActionResult<Accounts>> {
  if (typeof id !== "string" || !RECORD_ID.test(id)) return badId();
  const r = record(patch);
  const clean: { url?: string; label?: string } = {};
  const url = text(r.url);
  const label = text(r.label);
  if (url !== undefined) clean.url = url;
  if (label !== undefined) clean.label = label;
  return runAction(async ({ ctx }) => {
    await updateSocialAccount(ctx, id, clean, deps);
    return { accounts: await listSocialAccounts(ctx) };
  });
}

export async function removeSocialAccountAction(
  id: unknown,
): Promise<ActionResult<Accounts>> {
  if (typeof id !== "string" || !RECORD_ID.test(id)) return badId();
  return runAction(async ({ ctx }) => {
    await removeSocialAccount(ctx, id, deps);
    return { accounts: await listSocialAccounts(ctx) };
  });
}

/** Undo of Remove: add the account again, then put it back at `index`. */
export async function restoreSocialAccountAction(
  input: unknown,
  index: unknown,
): Promise<ActionResult<Accounts>> {
  const clean = accountInput(input);
  const at =
    typeof index === "number" && Number.isInteger(index) && index >= 0
      ? Math.min(index, MAX_ACCOUNTS)
      : MAX_ACCOUNTS;
  return runAction(async ({ ctx }) => {
    const added = await addSocialAccount(ctx, clean, deps);
    const list = await listSocialAccounts(ctx);
    const others = list.filter((a) => a.id !== added.id).map((a) => a.id);
    const ids = [...others];
    ids.splice(Math.min(at, others.length), 0, added.id);
    if (ids.some((id, i) => list[i]?.id !== id)) {
      await reorderSocialAccounts(ctx, ids, deps);
      return { accounts: await listSocialAccounts(ctx) };
    }
    return { accounts: list };
  });
}

export async function reorderSocialAccountsAction(
  ids: unknown,
): Promise<ActionResult<Accounts>> {
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_ACCOUNTS ||
    !ids.every((id) => typeof id === "string" && RECORD_ID.test(id))
  ) {
    return badId();
  }
  const list = [...(ids as string[])];
  return runAction(async ({ ctx }) => {
    await reorderSocialAccounts(ctx, list, deps);
    return { accounts: await listSocialAccounts(ctx) };
  });
}

/** Tick or untick one Grow your social tip for the whole site. */
export async function setGrowTickAction(
  tipId: unknown,
  on: unknown,
): Promise<ActionResult<{ ticks: string[] }>> {
  if (
    typeof tipId !== "string" ||
    !TIP_ID.test(tipId) ||
    typeof on !== "boolean"
  ) {
    return {
      ok: false,
      code: "invalid_input",
      message:
        "That tip isn't on the list any more. Refresh the page and try again.",
    };
  }
  return runAction(async ({ ctx }) => {
    const state = await setGrowTick(ctx, tipId, on);
    return { ticks: state.ticks };
  });
}
