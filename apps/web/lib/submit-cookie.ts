// Pending emailed-code cookies (06-17; ONB-08, D-UI-P6-3; T-06-82, T-06-86). After a code is
// sent, the server remembers which PB OTP request it belongs to (the otpId) and the address,
// so Resend and the code step survive a reload. Neither value is secret (the code is), but
// the browser never needs them: the cookie is httpOnly, SameSite=Strict, path "/", 10
// minutes (PB codes last 5), `__Host-` prefixed + Secure in production.
//
// Two cookies, one shape: `cds_submit` for /start/submit and `cds_signin_code` for the
// /sign-in code path, so a pending Submit and a pending sign-in never overwrite each other.
// A cookie that does not parse to a well-shaped value is treated as absent.
// Server-only: imports next/headers.
import { cookies } from "next/headers";

export type PendingCode = { otpId: string; email: string };

/** 10 minutes: longer than a PB code lives, short enough to go stale quickly. */
export const PENDING_CODE_MAX_AGE_S = 10 * 60;

const OTP_ID_RE = /^[A-Za-z0-9]{1,64}$/;
const EMAIL_MAX = 254;

type Kind = "submit" | "signin";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function cookieName(kind: Kind): string {
  const base = kind === "submit" ? "cds_submit" : "cds_signin_code";
  return isProduction() ? `__Host-${base}` : base;
}

export function submitCookieName(): string {
  return cookieName("submit");
}

export function signInCodeCookieName(): string {
  return cookieName("signin");
}

export function encodePendingCode(p: PendingCode): string {
  return Buffer.from(JSON.stringify({ o: p.otpId, e: p.email })).toString(
    "base64url",
  );
}

export function decodePendingCode(raw: string | undefined): PendingCode | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      o?: unknown;
      e?: unknown;
    };
    if (typeof v.o !== "string" || !OTP_ID_RE.test(v.o)) return null;
    if (
      typeof v.e !== "string" ||
      v.e.length > EMAIL_MAX ||
      !v.e.includes("@")
    ) {
      return null;
    }
    return { otpId: v.o, email: v.e };
  } catch {
    return null;
  }
}

async function read(kind: Kind): Promise<PendingCode | null> {
  return decodePendingCode((await cookies()).get(cookieName(kind))?.value);
}

async function write(kind: Kind, p: PendingCode): Promise<void> {
  (await cookies()).set(cookieName(kind), encodePendingCode(p), {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: isProduction(),
    maxAge: PENDING_CODE_MAX_AGE_S,
  });
}

async function clear(kind: Kind): Promise<void> {
  (await cookies()).delete({
    name: cookieName(kind),
    path: "/",
    secure: isProduction(),
  });
}

export const readSubmitCookie = () => read("submit");
export const setSubmitCookie = (p: PendingCode) => write("submit", p);
export const clearSubmitCookie = () => clear("submit");
export const readSignInCodeCookie = () => read("signin");
export const setSignInCodeCookie = (p: PendingCode) => write("signin", p);
export const clearSignInCodeCookie = () => clear("signin");
