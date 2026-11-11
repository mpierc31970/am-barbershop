// The only PocketBase client in the platform (Invariant 1, TEN-02, D5). NEVER exported from
// index.ts. The superuser client bypasses PB API rules, so the repository chokepoint is the
// only tenant isolation there is.
//
// - Lazy: env is read on the first superuser() call, never at import, so `next build` needs
//   no PB env (same pattern as apps/web/middleware.ts).
// - autoCancellation(false): the SDK otherwise cancels duplicate concurrent requests,
//   which breaks parallel server requests (RESEARCH Pitfall 8).
// - Single-flight superuser auth, re-auth once on 401, 15 s request timeout.
// - Secrets are never logged or put into error messages.
import PocketBase, { ClientResponseError } from "pocketbase";

const REQUEST_TIMEOUT_MS = 15_000;

let client: PocketBase | undefined;
let authing: Promise<void> | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`@cds/db: environment variable ${name} is not set`);
  }
  return value;
}

function withTimeout(
  pb: PocketBase,
  extraHeaders?: Record<string, string>,
): PocketBase {
  pb.autoCancellation(false);
  pb.beforeSend = (url, options) => {
    if (!options.signal) {
      options.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    }
    if (extraHeaders) {
      options.headers = {
        ...(options.headers as Record<string, string> | undefined),
        ...extraHeaders,
      };
    }
    return { url, options };
  };
  return pb;
}

async function authenticate(pb: PocketBase): Promise<void> {
  authing ??= (async () => {
    try {
      await pb
        .collection("_superusers")
        .authWithPassword(
          requireEnv("PB_SUPERUSER_EMAIL"),
          requireEnv("PB_SUPERUSER_PASSWORD"),
        );
    } finally {
      authing = undefined;
    }
  })();
  return authing;
}

/** The module-private superuser client (lazy singleton, authenticated). */
export async function superuser(): Promise<PocketBase> {
  if (!client) {
    const pb = withTimeout(new PocketBase(requireEnv("PB_URL")));
    client = pb;
  }
  if (!client.authStore.isValid) {
    await authenticate(client);
  }
  return client;
}

/**
 * Run `fn` with the superuser client; on a 401 (expired or revoked superuser session)
 * re-authenticate once and retry.
 */
export async function withSuperuser<T>(
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  const pb = await superuser();
  try {
    return await fn(pb);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 401) {
      pb.authStore.clear();
      await authenticate(pb);
      return fn(pb);
    }
    throw err;
  }
}

/** Header the users auth guard hook checks (pb_hooks/users_auth_guard.pb.js, review CR-01). */
export const APP_KEY_HEADER = "X-CDS-App-Key";

/**
 * A fresh, unauthenticated client for end-user / staff sign-in flows (plan 06). It sends
 * PB_APP_KEY as X-CDS-App-Key: PB refuses guest `users` password / OTP sign-in without it,
 * so the app, with its rate limits, is the only guest caller (review iteration-3 CR-01).
 */
export function guestClient(): PocketBase {
  const url = requireEnv("PB_URL");
  const appKey = requireEnv("PB_APP_KEY");
  return withTimeout(new PocketBase(url), { [APP_KEY_HEADER]: appKey });
}

/** Drop the singleton so a test can point it at a new throwaway PB. */
export function resetClientForTests(): void {
  if (!process.env.VITEST) {
    throw new Error("resetClientForTests is test-only");
  }
  client?.authStore.clear();
  client = undefined;
  authing = undefined;
}
