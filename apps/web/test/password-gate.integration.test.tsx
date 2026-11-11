// 07-32 Task 2 (CONT-28, CONT-33; D235 #11/#12, D255, D-UI-P7-14; choices 3-7, 11;
// T-07-32-01..05, T-07-32-07, T-07-32-09): the password gate and the tenant 404 against the
// real PocketBase 0.39.11 binary.
//
// Gate route (cookie, limiter, JSON and no-JS, origin, no open redirect), the tenant page
// (gate view with nothing of the page, noindex, no description or share image; unlocked view
// with tokenized media and no section JSON-LD; a password change re-locks; live on save), and
// the 404 (/system-404 refused, default copy, the owner's published 404, Popular pages and
// search). next/headers supplies the middleware header, the client IP and the cookie jar per
// case; next/navigation throws sentinels; next/cache is a passthrough.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearResolverCache,
  createPage,
  ensureNotFoundPage,
  publishPage,
  recordingInvalidator,
  saveNav,
  saveSection,
  saveSiteSettings,
  setPagePassword,
  updatePage,
  uploadLibraryImage,
  type PublishDeps,
} from "@cds/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TwoOrgs } from "../../../packages/db/test/fixtures";
import { resetPageGateLimitsForTests } from "../../../packages/db/test/forms-seed";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";
import { pngBytes } from "../../../packages/db/test/seo-seed";

const state = vi.hoisted(() => ({
  header: null as string | null,
  ip: "203.0.113.7",
  jar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      ...(state.header === null ? {} : { "x-cds-tenant-host": state.header }),
      "x-real-ip": state.ip,
    }),
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const pageModule = await import("../app/tenant/[host]/[[...path]]/page");
const TenantPage = pageModule.default;
const notFoundModule = await import("../app/tenant/[host]/not-found");
const gateRoute = await import("../app/tenant/[host]/api/gate/[pageId]/route");
const { SECTION_REGISTRY } = await import("../lib/section-registry");

const ENV_KEYS = ["CDS_STORAGE_DIR", "CDS_PUBLIC_STORAGE_DIR"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let inst: PbInstance | null = null;
let seed: TwoOrgs;
let privDir = "";
let pubDir = "";
let membersId = "";
let photoId = "";

const HOST_A = "a.example.com";
const HOST_B = "b.example.com";
const SECRET_WORD = "zanzibarquince";
const PW = "sourdough1";

function deps(): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  } as PublishDeps;
}

async function render(
  host: string,
  path?: string[],
  sp?: Record<string, string>,
) {
  state.header = host;
  const el = await TenantPage({
    params: Promise.resolve({ host, path }),
    ...(sp ? { searchParams: Promise.resolve(sp) } : {}),
  });
  return renderToStaticMarkup(el as ReactElement);
}

async function meta(host: string, path?: string[]) {
  state.header = host;
  return pageModule.generateMetadata({
    params: Promise.resolve({ host, path }),
  });
}

async function render404(host: string | null) {
  state.header = host;
  const el = await notFoundModule.default();
  return renderToStaticMarkup(el as ReactElement);
}

async function gate(
  host: string,
  pageId: string,
  body: string,
  init: { json?: boolean; headers?: Record<string, string> } = {},
): Promise<Response> {
  state.header = host;
  const req = new Request(`https://${host}/api/gate/${pageId}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(init.json ? { accept: "application/json" } : {}),
      ...init.headers,
    },
    body,
  });
  return gateRoute.POST(req, { params: Promise.resolve({ host, pageId }) });
}

function setCookieFrom(res: Response): { name: string; value: string } | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const [pair] = raw.split(";");
  const i = pair!.indexOf("=");
  return { name: pair!.slice(0, i), value: pair!.slice(i + 1) };
}

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-gate-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-gate-pub-"));
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;

  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: seed.A.page,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Welcome", text: "<p>Fresh bread.</p>" },
  });
  await publishPage(seed.ctxA, seed.A.page, deps());

  photoId = (
    await uploadLibraryImage(seed.ctxA, await pngBytes(800, 600), {
      alt: "Loaves",
    })
  ).asset.id;
  const members = await createPage(seed.ctxA, {
    title: "Members",
    slug: "members",
  });
  membersId = members.id;
  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: membersId,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Inside", text: `<p>${SECRET_WORD} recipes.</p>` },
  });
  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: membersId,
    section_type: "columns",
    row_layout: "full",
    content: {
      columns: [
        { items: [{ id: "i1", kind: "image", asset: photoId, alt: "Loaves" }] },
      ],
    },
  });
  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: membersId,
    section_type: "faq",
    row_layout: "full",
    content: {
      heading: "Questions",
      open_first: false,
      items: [{ id: "q1", question: "Secret?", answer: "<p>Yes.</p>" }],
    },
  });
  await updatePage(seed.ctxA, membersId, {
    seo: { meta_description: "Private recipes", share_image: photoId },
  });
  // Public publish first: the photo is promoted, so the gate must still tokenize it.
  await publishPage(seed.ctxA, membersId, deps());
  await saveNav(seed.ctxA, deps(), {
    items: [
      {
        id: "n1",
        label: "Home",
        target: `page:${seed.A.page}`,
        new_tab: false,
        children: [],
      },
      {
        id: "n2",
        label: "Members",
        target: `page:${membersId}`,
        new_tab: false,
        children: [
          {
            id: "n3",
            label: "Again",
            target: `page:${seed.A.page}`,
            new_tab: false,
          },
        ],
      },
    ],
    cta: null,
  });
  await saveSiteSettings(seed.ctxA, deps(), { show_search: true });
  await setPagePassword(seed.ctxA, membersId, { password: PW }, deps());
});

afterAll(async () => {
  await inst?.stop();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(privDir, { recursive: true, force: true });
  rmSync(pubDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearResolverCache();
  resetPageGateLimitsForTests();
  state.header = null;
  state.ip = "203.0.113.7";
  state.jar.clear();
});

describe("POST /api/gate/<pageId>", () => {
  it("right password: 303 to the page with the HttpOnly Lax cookie", async (t) => {
    if (!inst) return t.skip();
    const res = await gate(
      HOST_A,
      membersId,
      `password=${PW}&return=https://evil.example`,
      {
        headers: { "x-forwarded-proto": "https" },
      },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/members");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const raw = res.headers.get("set-cookie")!;
    expect(raw).toContain(`cds_pp_${membersId}=`);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=lax/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/Max-Age=43200/);
    const plain = await gate(HOST_A, membersId, `password=${PW}`);
    expect(plain.headers.get("set-cookie")).not.toMatch(/Secure/i);
  });

  it("wrong: ?gate=wrong without a cookie; the 11th is rate limited", async (t) => {
    if (!inst) return t.skip();
    for (let i = 0; i < 10; i++) {
      const res = await gate(HOST_A, membersId, "password=nope-nope");
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/members?gate=wrong");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    const limited = await gate(HOST_A, membersId, `password=${PW}`);
    expect(limited.headers.get("location")).toBe("/members?gate=rate&wait=15");
    const json = await gate(HOST_A, membersId, `password=${PW}`, {
      json: true,
    });
    expect(json.status).toBe(429);
    const body = (await json.json()) as { error: string; retryAfterS: number };
    expect(body.error).toBe("Too many tries. Wait 15 minutes, then try again.");
    expect(body.retryAfterS).toBeGreaterThan(0);
    state.ip = "198.51.100.1";
    expect((await gate(HOST_A, membersId, `password=${PW}`)).status).toBe(303);
  });

  it("JSON: 200 with location, 401 with GATE-WRONG", async (t) => {
    if (!inst) return t.skip();
    const ok = await gate(HOST_A, membersId, `password=${PW}`, { json: true });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, location: "/members" });
    expect(setCookieFrom(ok)?.name).toBe(`cds_pp_${membersId}`);
    const bad = await gate(HOST_A, membersId, "password=nope-nope", {
      json: true,
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({
      error: "That password isn't right. Check it and try again.",
    });
  });

  it("refuses foreign pages, unknown hosts and cross-origin posts", async (t) => {
    if (!inst) return t.skip();
    expect((await gate(HOST_B, membersId, `password=${PW}`)).status).toBe(404);
    expect(
      (await gate(HOST_A, "zzzzzzzzzzzzzzz", `password=${PW}`)).status,
    ).toBe(404);
    expect(
      (await gate("nobody.example.com", membersId, `password=${PW}`)).status,
    ).toBe(404);
    const evil = await gate(HOST_A, membersId, `password=${PW}`, {
      headers: { origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
    const same = await gate(HOST_A, membersId, `password=${PW}`, {
      headers: { origin: `https://${HOST_A}` },
    });
    expect(same.status).toBe(303);
    // WR-C03: a non-default port is still this host; a foreign host on a port is not.
    const port = await gate(HOST_A, membersId, `password=${PW}`, {
      headers: { origin: `http://${HOST_A}:3000` },
    });
    expect(port.status).toBe(303);
    const evilPort = await gate(HOST_A, membersId, `password=${PW}`, {
      headers: { origin: "http://evil.example:3000" },
    });
    expect(evilPort.status).toBe(403);
  });

  it("an unprotected page: 303 without a cookie; an over-long body is wrong", async (t) => {
    if (!inst) return t.skip();
    const home = await gate(HOST_A, seed.A.page, "password=anything");
    expect(home.headers.get("location")).toBe("/");
    expect(home.headers.get("set-cookie")).toBeNull();
    const big = await gate(HOST_A, membersId, `password=${"x".repeat(5000)}`);
    expect(big.headers.get("location")).toBe("/members?gate=wrong");
  });
});

describe("the tenant page behind the gate", () => {
  it("locked: the gate only, noindex, no description or share image", async (t) => {
    if (!inst) return t.skip();
    const html = await render(HOST_A, ["members"]);
    expect(html).toContain("data-cds-gate");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Members");
    expect(html).toContain(`action="/api/gate/${membersId}"`);
    expect(html).not.toContain(SECRET_WORD);
    expect(html).not.toContain(photoId);
    expect(html).not.toContain("application/ld+json");
    expect(html).not.toContain("Secret?");
    const m = await meta(HOST_A, ["members"]);
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.description).toBeUndefined();
    expect(m.openGraph?.images).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain(photoId);
    expect(pageModule.dynamic).toBe("force-dynamic");
  });

  it("status words: wrong, and rate with a clamped wait", async (t) => {
    if (!inst) return t.skip();
    const wrong = await render(HOST_A, ["members"], { gate: "wrong" });
    expect(wrong).toContain('aria-invalid="true"');
    expect(wrong).toContain('aria-describedby="gate-error"');
    const rate = await render(HOST_A, ["members"], {
      gate: "rate",
      wait: "14",
    });
    expect(rate).toContain("Try again in 14 minutes");
    expect(rate).toMatch(/<button type="submit" disabled=""/);
    const clamped = await render(HOST_A, ["members"], {
      gate: "rate",
      wait: "999",
    });
    expect(clamped).toContain("Try again in 15 minutes");
  });

  it("unlocked: the page with tokenized media, noindex, no section JSON-LD", async (t) => {
    if (!inst) return t.skip();
    const res = await gate(HOST_A, membersId, `password=${PW}`);
    const c = setCookieFrom(res)!;
    state.jar.set(c.name, c.value);
    const html = await render(HOST_A, ["members"]);
    expect(html).toContain(SECRET_WORD);
    const srcs = [
      ...html.matchAll(new RegExp(`/_media/[^"]*${photoId}[^"]*`, "g")),
    ].map((x) => x[0]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) {
      expect(s).toMatch(/[?&](amp;)?e=/);
      expect(s).toMatch(/[?&](amp;)?t=/);
    }
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
      html,
    );
    expect(ld?.[1] ?? "").not.toContain("FAQPage");
    expect((await meta(HOST_A, ["members"])).robots).toEqual({
      index: false,
      follow: true,
    });
    // a cookie for another page never opens this one
    state.jar.clear();
    state.jar.set(`cds_pp_${seed.A.page}`, c.value);
    expect(await render(HOST_A, ["members"])).toContain("data-cds-gate");

    // a password change locks the same cookie out
    state.jar.clear();
    state.jar.set(c.name, c.value);
    await setPagePassword(
      seed.ctxA,
      membersId,
      { password: "rye-bread-2" },
      deps(),
    );
    clearResolverCache();
    expect(await render(HOST_A, ["members"])).toContain("data-cds-gate");
    await setPagePassword(seed.ctxA, membersId, { password: PW }, deps());
  });

  it("live on save: clearing makes it public at once with plain media URLs", async (t) => {
    if (!inst) return t.skip();
    await setPagePassword(seed.ctxA, membersId, { password: null }, deps());
    clearResolverCache();
    const html = await render(HOST_A, ["members"]);
    expect(html).not.toContain("data-cds-gate");
    expect(html).toContain(SECRET_WORD);
    expect(html).not.toMatch(new RegExp(`${photoId}[^"]*[?&](amp;)?t=`));
    expect((await meta(HOST_A, ["members"])).robots).toEqual({
      index: true,
      follow: true,
    });
    await setPagePassword(seed.ctxA, membersId, { password: PW }, deps());
    clearResolverCache();
    expect(await render(HOST_A, ["members"])).toContain("data-cds-gate");
  });
});

describe("the tenant 404", () => {
  it("/system-404 is never visitable", async (t) => {
    if (!inst) return t.skip();
    await expect(render(HOST_A, ["system-404"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    await expect(render(HOST_A, ["no-such-page"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("default copy, Popular pages from the menu and the search form", async (t) => {
    if (!inst) return t.skip();
    const html = await render404(HOST_A);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("We can&#x27;t find that page");
    expect(html).toContain(
      "The page may have moved, or the address may have a typo.",
    );
    expect(html).toContain("Popular pages");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/members"');
    expect(html).toContain('role="search"');
    expect(html).toContain('action="/search"');
  });

  it("no search form when search is off; the unknown host gets the plain default", async (t) => {
    if (!inst) return t.skip();
    const b = await render404(HOST_B);
    expect(b).toContain("We can&#x27;t find that page");
    expect(b).not.toContain('role="search"');
    const none = await render404("nobody.example.com");
    expect(none).toContain("We can&#x27;t find that page");
    expect(none).not.toContain("Popular pages");
  });

  it("the owner's published 404 page renders, then the extras", async (t) => {
    if (!inst) return t.skip();
    const nf = await ensureNotFoundPage(seed.ctxA);
    await updatePage(seed.ctxA, nf.id, { title: "Lost your loaf?" });
    await publishPage(seed.ctxA, nf.id, deps());
    clearResolverCache();
    const html = await render404(HOST_A);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Lost your loaf?");
    expect(html).toContain(
      "The page may have moved, or the address may have a typo.",
    );
    expect(html).toContain("Popular pages");
    await expect(render(HOST_A, ["system-404"])).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});
