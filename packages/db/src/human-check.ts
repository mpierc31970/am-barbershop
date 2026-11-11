// HumanCheck port (ONB-08, D213; PD-14; T-06-30). "Is this a person?" for anonymous writes
// (quote save). The real check is Cloudflare Turnstile siteverify, called server-side only.
// GO-LIVE: "Cloudflare (DNS + Turnstile)" row: set TURNSTILE_SECRET_KEY (and the site key in
// the app). Until then, outside production, Cloudflare's always-pass test secret is used;
// production without a secret fails closed (every check returns false).
// Any error (network, non-200, bad JSON) is a failed check, never a throw and never a pass.

export interface HumanCheck {
  verify(token: string, ip: string): Promise<boolean>;
}

export const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's documented always-pass secret (dev and tests only). */
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
/** Turnstile tokens are at most 2048 characters. */
const MAX_TOKEN = 2048;
const TIMEOUT_MS = 10_000;

export function turnstileHumanCheck(
  secret: string = TURNSTILE_TEST_SECRET,
): HumanCheck {
  return {
    async verify(token: string, ip: string): Promise<boolean> {
      if (typeof token !== "string" || token.length === 0) return false;
      if (token.length > MAX_TOKEN) return false;
      const body = new URLSearchParams();
      body.set("secret", secret);
      body.set("response", token);
      if (typeof ip === "string" && ip !== "") body.set("remoteip", ip);
      try {
        const res = await fetch(TURNSTILE_VERIFY_URL, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status !== 200) return false;
        const data = (await res.json()) as { success?: unknown };
        return data?.success === true;
      } catch {
        return false;
      }
    },
  };
}

export function alwaysPass(): HumanCheck {
  return { verify: () => Promise.resolve(true) };
}

export function alwaysFail(): HumanCheck {
  return { verify: () => Promise.resolve(false) };
}

/** The configured check (PD-14). Read per call so env changes take effect in tests. */
export function getHumanCheck(): HumanCheck {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (secret) return turnstileHumanCheck(secret);
  if (process.env.CDS_ENV === "production") return alwaysFail();
  return turnstileHumanCheck(TURNSTILE_TEST_SECRET);
}
