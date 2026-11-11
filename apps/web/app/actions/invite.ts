"use server";
// Join a site from an emailed invite (11-38; D-UI-P11-28, UI-SPEC "Invite page";
// T-11-38-01, T-11-38-03). Public POST endpoint: the form carries the invite token and, for
// the sign-in and new-account paths, a password (and a name). Who joins always comes from a
// session token PocketBase issued, never from the form; the invited email is read from the
// invite itself. After joining: session cookie (new sign-ins), cds_org set to the joined org,
// hub layout revalidated, redirect to /hub/today.
import { CdsError, Forbidden, InvalidInput, RateLimited } from "@cds/core";
import {
  acceptInvite,
  acceptInviteAsNewAccount,
  InviteRefused,
  listMemberOrganizations,
  readInvite,
  signInMember,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearAuthMethodCookie,
  clearOrgCookie,
  clearSessionCookie,
  clientIp,
  forgetPushDevice,
  sessionCookieName,
  setAuthMethodCookie,
  setOrgCookie,
  setSessionCookie,
} from "../../lib/session";
import { withFlash } from "../../lib/flash";

export type InviteJoinState = { error: string | null };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const WRONG_CREDENTIALS =
  "That email and password don't match. Check both and try again.";
const PASSWORD_RULE = "Use at least 10 characters for your password.";
const NAME_NEEDED = "Enter your name.";
const RATE_LIMITED = "Too many attempts. Wait 15 minutes, then try again.";
const UNAVAILABLE =
  "We couldn't add you just now. Wait a minute, then try again.";
const NOT_VALID =
  "This invite has expired or was cancelled. Ask the person who invited you to send a new one.";
const WRONG_ACCOUNT =
  "You're signed in with a different email. Sign out, then open the invite again.";
// Review 11 WR-E03: refusals where the invite itself is still good.
const ACCOUNT_EXISTS =
  "You already have an account. Reload this page and sign in to accept.";
const STAFF_REFUSED =
  "Support staff accounts can't join a site. Ask for the invite to go to a different email.";
const NAME_TOO_LONG = "Use at most 80 characters for your name.";
const PASSWORD_TOO_LONG = "Use at most 72 characters for your password.";

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

async function landInOrg(orgId: string): Promise<never> {
  await setOrgCookie(orgId);
  revalidatePath("/hub", "layout");
  // 11-50: Today shows the toast "Welcome to {org}." once (HubFlash).
  redirect(withFlash("/hub/today", "joined"));
}

/** The copy for a refusal whose invite is still good (WR-E03); null for any other error. */
function refusalCopy(err: unknown): string | null {
  if (!(err instanceof InviteRefused)) return null;
  switch (err.reason) {
    case "account_exists":
      return ACCOUNT_EXISTS;
    case "staff":
      return STAFF_REFUSED;
    case "name_missing":
      return NAME_NEEDED;
    case "name_too_long":
      return NAME_TOO_LONG;
    case "password_too_short":
      return PASSWORD_RULE;
    case "password_too_long":
      return PASSWORD_TOO_LONG;
    default:
      return null;
  }
}

/** Already a member of the invited site: nothing to join, just go there (WR-E03). */
function alreadyMemberOrg(err: unknown): string | null {
  return err instanceof InviteRefused &&
    err.reason === "already_member" &&
    err.orgId
    ? err.orgId
    : null;
}

function failFor(err: unknown, where: string): InviteJoinState {
  const copy = refusalCopy(err);
  if (copy) return { error: copy };
  if (err instanceof RateLimited) return { error: RATE_LIMITED };
  if (err instanceof Forbidden) return { error: WRONG_ACCOUNT };
  if (err instanceof InvalidInput) return { error: NOT_VALID };
  if (err instanceof CdsError) return { error: NOT_VALID };
  console.error(
    `[invite] ${where} failed`,
    err instanceof Error ? err.name : typeof err,
  );
  return { error: UNAVAILABLE };
}

/** One action for the three invite forms; `mode` picks the path. */
export async function joinInviteAction(
  _prev: InviteJoinState,
  formData: FormData,
): Promise<InviteJoinState> {
  const token = field(formData, "token");
  if (!TOKEN_RE.test(token)) return { error: NOT_VALID };
  const mode = field(formData, "mode");
  const ip = await clientIp();

  if (mode === "create") {
    const name = field(formData, "name").trim();
    const password = field(formData, "password");
    if (!name) return { error: NAME_NEEDED };
    if (password.length < 10) return { error: PASSWORD_RULE };
    let joined: { orgId: string; email: string };
    try {
      joined = await acceptInviteAsNewAccount(token, { name, password }, ip);
    } catch (err) {
      return failFor(err, "new account");
    }
    let session: string;
    try {
      ({ token: session } = await signInMember(joined.email, password, ip));
    } catch (err) {
      // Joined, but the first sign-in failed: the sign-in page works from here.
      console.error(
        "[invite] sign-in after join failed",
        err instanceof Error ? err.name : typeof err,
      );
      redirect("/sign-in");
    }
    await setSessionCookie(session);
    await setAuthMethodCookie("password", session);
    return landInOrg(joined.orgId);
  }

  if (mode === "signin") {
    const password = field(formData, "password");
    if (!password) return { error: WRONG_CREDENTIALS };
    let session = "";
    let joinedOrg: string;
    try {
      const info = await readInvite(token);
      if (!info || info.expired || info.status !== "pending") {
        return { error: NOT_VALID };
      }
      try {
        ({ token: session } = await signInMember(info.email, password, ip));
      } catch (err) {
        if (err instanceof RateLimited) return { error: RATE_LIMITED };
        if (err instanceof CdsError) return { error: WRONG_CREDENTIALS };
        throw err;
      }
      const me = await listMemberOrganizations(session);
      ({ orgId: joinedOrg } = await acceptInvite(
        token,
        { id: me.userId, email: me.email },
        ip,
      ));
    } catch (err) {
      const org = alreadyMemberOrg(err);
      if (!org || !session) return failFor(err, "sign-in join");
      joinedOrg = org;
    }
    await setSessionCookie(session);
    await setAuthMethodCookie("password", session);
    return landInOrg(joinedOrg);
  }

  // mode "join": already signed in as the invited email.
  const session = (await cookies()).get(sessionCookieName())?.value;
  if (!session) return { error: WRONG_ACCOUNT };
  let joinedOrg: string;
  try {
    const me = await listMemberOrganizations(session);
    ({ orgId: joinedOrg } = await acceptInvite(
      token,
      { id: me.userId, email: me.email },
      ip,
    ));
  } catch (err) {
    const org = alreadyMemberOrg(err);
    if (!org) return failFor(err, "join");
    joinedOrg = org;
  }
  return landInOrg(joinedOrg);
}

/** Wrong account signed in: sign out and come back to the same invite. */
export async function signOutForInviteAction(
  formData: FormData,
): Promise<void> {
  const token = field(formData, "token");
  // Review 11 WR-E01: the wrong account's push device for this browser goes too.
  await forgetPushDevice(formData);
  await clearSessionCookie();
  await clearAuthMethodCookie();
  await clearOrgCookie();
  redirect(TOKEN_RE.test(token) ? "/invite/" + token : "/sign-in");
}
