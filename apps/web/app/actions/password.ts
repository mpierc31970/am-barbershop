"use server";
// A&M fork: a signed-in member changes their own password from the profile page.
import { CdsError, InvalidInput, RateLimited } from "@cds/core";
import { changeMemberPassword, MEMBER_PASSWORD_MIN } from "@cds/db";
import { cookies } from "next/headers";
import {
  clientIp,
  sessionCookieName,
  setSessionCookie,
} from "../../lib/session";

export type PasswordState = { error: string | null; done: boolean };

export async function changePasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const current = formData.get("current");
  const next = formData.get("next");
  const confirm = formData.get("confirm");
  if (typeof current !== "string" || !current) {
    return { error: "Enter your current password.", done: false };
  }
  if (typeof next !== "string" || next.length < MEMBER_PASSWORD_MIN) {
    return {
      error: `Your new password needs at least ${MEMBER_PASSWORD_MIN} characters.`,
      done: false,
    };
  }
  if (next !== confirm) {
    return { error: "The new passwords don't match.", done: false };
  }
  const token = (await cookies()).get(sessionCookieName())?.value ?? "";
  try {
    const fresh = await changeMemberPassword(
      token,
      current,
      next,
      await clientIp(),
    );
    await setSessionCookie(fresh.token);
    return { error: null, done: true };
  } catch (err) {
    if (err instanceof RateLimited) {
      return {
        error: "Too many attempts. Wait 15 minutes, then try again.",
        done: false,
      };
    }
    if (err instanceof InvalidInput) {
      return {
        error: "Use 10 to 72 characters for your new password.",
        done: false,
      };
    }
    if (err instanceof CdsError) {
      return {
        error: "Your current password isn't right. Try again.",
        done: false,
      };
    }
    console.error("[password] change failed", err);
    return {
      error:
        "We couldn't change your password just now. Try again in a minute.",
      done: false,
    };
  }
}
