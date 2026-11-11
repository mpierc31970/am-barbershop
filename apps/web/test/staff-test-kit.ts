// Shared staff-console test kit (13-21 choice 5). Later plans import it, never edit it (extend
// with a local helper). One module-level state (cookie jar, request headers, call log) shared
// by the mocks below, so a test file wires Next like this:
//
//   vi.mock("next/headers", async () => (await import("./staff-test-kit")).nextHeadersMock);
//   vi.mock("next/navigation", async () => (await import("./staff-test-kit")).nextNavigationMock);
//   vi.mock("next/cache", async () => (await import("./staff-test-kit")).nextCacheMock);
//   import { kit, resetStaffKit } from "./staff-test-kit";
//   beforeEach(() => resetStaffKit());
//
// (vi.mock factories are hoisted above imports, so they reach the kit through import().)
// The cookie jar implements get, getAll, has, set and delete like next/headers' cookies();
// `kit.sets` records every set with its options. next/navigation's redirect / notFound throw
// Errors whose message and digest are `NEXT_REDIRECT:<to>` / `NEXT_NOT_FOUND` (so code that
// rethrows Next control flow by digest lets them through). next/cache is a no-op passthrough.
//
// `signInStaffForTest(inst, role)` (integration only) creates a staff user and runs the real
// two sign-in actions (password, then the emailed code read with otpCodeFor); the staff cookie
// is then in the jar.

export type KitCookie = { name: string; value: string };
export type KitCookieOptions = {
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none" | boolean;
  path?: string;
  secure?: boolean;
  maxAge?: number;
  expires?: Date | number;
  domain?: string;
};

type State = {
  cookies: Map<string, string>;
  sets: { name: string; value: string; options: KitCookieOptions }[];
  deletes: string[];
  headers: Record<string, string>;
  revalidated: string[];
};

function fresh(): State {
  return {
    cookies: new Map(),
    sets: [],
    deletes: [],
    headers: { "x-real-ip": "203.0.113.21" },
    revalidated: [],
  };
}

/** The live kit state. Mutate `kit.headers` to set request headers (e.g. x-cds-path). */
export const kit: State = fresh();

export function resetStaffKit(): void {
  const f = fresh();
  kit.cookies = f.cookies;
  kit.sets = f.sets;
  kit.deletes = f.deletes;
  kit.headers = f.headers;
  kit.revalidated = f.revalidated;
}

export const cookieJar = {
  get(name: string): KitCookie | undefined {
    const value = kit.cookies.get(name);
    return value === undefined ? undefined : { name, value };
  },
  getAll(name?: string): KitCookie[] {
    return [...kit.cookies.entries()]
      .filter(([n]) => name === undefined || n === name)
      .map(([n, value]) => ({ name: n, value }));
  },
  has(name: string): boolean {
    return kit.cookies.has(name);
  },
  set(
    nameOrCookie: string | ({ name: string; value: string } & KitCookieOptions),
    value?: string,
    options: KitCookieOptions = {},
  ): void {
    const c =
      typeof nameOrCookie === "string"
        ? { name: nameOrCookie, value: value ?? "", options }
        : (() => {
            const { name, value: v, ...rest } = nameOrCookie;
            return { name, value: v, options: rest };
          })();
    kit.cookies.set(c.name, c.value);
    kit.sets.push(c);
  },
  delete(nameOrOptions: string | { name: string }): void {
    const name =
      typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;
    kit.cookies.delete(name);
    kit.deletes.push(name);
  },
};

export const nextHeadersMock = {
  cookies: async () => cookieJar,
  headers: async () => new Headers(kit.headers),
};

function nextError(message: string): Error {
  const err = new Error(message) as Error & { digest: string };
  err.digest = message;
  return err;
}

export const nextNavigationMock = {
  redirect: (to: string): never => {
    throw nextError(`NEXT_REDIRECT:${to}`);
  },
  permanentRedirect: (to: string): never => {
    throw nextError(`NEXT_REDIRECT_308:${to}`);
  },
  notFound: (): never => {
    throw nextError("NEXT_NOT_FOUND");
  },
  usePathname: () => "/staff",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
};

export const nextCacheMock = {
  revalidatePath: (path: string) => {
    kit.revalidated.push(path);
  },
  revalidateTag: (tag: string) => {
    kit.revalidated.push(`tag:${tag}`);
  },
  unstable_cache:
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A) =>
      fn(...a),
  unstable_noStore: () => {},
};

/** Run `fn` and return the thrown Next sentinel message (`NEXT_REDIRECT:/x`), else null. */
export async function nextSignal(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("NEXT_")) return msg;
    throw err;
  }
}

/** The staff cookie value in the jar (dev name), or undefined. */
export function staffCookieValue(): string | undefined {
  return kit.cookies.get("cds_staff");
}

/**
 * Integration only: a fresh test staff user signed in through the real actions
 * (staffSignInAction, then staffConfirmCodeAction with the emailed code). Leaves the staff
 * cookie in the jar and returns the token and the user's email.
 */
export async function signInStaffForTest(
  inst: import("../../../packages/db/test/pb-harness").PbInstance,
  role: "super_admin" | "support_agent",
  opts: { email?: string; next?: string } = {},
): Promise<{ token: string; email: string; password: string }> {
  const { createTestStaffUser } =
    await import("../../../packages/db/test/staff-users");
  const { otpCodeFor } = await import("../../../packages/db/test/seeded");
  const { staffSignInAction, staffConfirmCodeAction } =
    await import("../app/actions/staff/session");
  const { email, password } = await createTestStaffUser(role, opts.email);
  const started = await staffSignInAction(email, password, opts.next ?? "");
  if (!started.ok) throw new Error(`staff sign-in refused: ${started.code}`);
  const code = await otpCodeFor(inst, started.data.otpId);
  const signal = await nextSignal(() =>
    staffConfirmCodeAction({
      mfaId: started.data.mfaId,
      otpId: started.data.otpId,
      code,
      next: opts.next ?? "",
    }),
  );
  if (!signal?.startsWith("NEXT_REDIRECT:")) {
    throw new Error(`staff code confirm did not redirect: ${signal}`);
  }
  const token = staffCookieValue();
  if (!token) throw new Error("staff cookie not set");
  return { token, email, password };
}
