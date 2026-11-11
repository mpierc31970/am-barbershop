// 14-35 (DOM-10, D172, P14-P26; T-14-35-01..04) on the real PocketBase 0.39.11 binary: review
// mode on the preview host end to end. The routes are called directly with Requests;
// next/headers supplies the middleware's tenant host, path and query headers and the cookies.
//   - a full Looks good pass over both pages ticks item 1 (pages_reviewed)
//   - Needs a change -> the note page -> a P12 change ticket on page:<id>, page marked
//   - a form sent with the review cookie is stored is_test and ticks item 5; without it, not
//   - the custom host never renders review chrome; the preview host does
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createForm,
  launchReviewView,
  recordingInvalidator,
  signReviewToken,
  type FormRecord,
} from "@cds/db";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetFormSubmitLimitsForTests } from "../../../packages/db/test/forms-seed";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import {
  reviewMarksOf,
  seedReviewSite,
  testFlagsOf,
  ticketsOf,
  type ReviewSeed,
} from "../../../packages/db/test/review-seed";
import { bootSeededPb } from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({
  header: null as string | null,
  path: null as string | null,
  cookies: {} as Record<string, string>,
  ip: 0,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    state.ip += 1;
    const h = new Headers({
      "x-forwarded-for": `198.51.100.${state.ip % 250}`,
    });
    if (state.header !== null) h.set("x-cds-tenant-host", state.header);
    if (state.path !== null) h.set("x-cds-tenant-path", state.path);
    return h;
  },
  cookies: async () => ({
    get: (name: string) =>
      state.cookies[name] === undefined
        ? undefined
        : { name, value: state.cookies[name] },
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

const { SECTION_REGISTRY } = await import("../lib/section-registry");
const { GET: start } =
  await import("../app/tenant/[host]/%5Fsite/review/start/route");
const { POST: mark } =
  await import("../app/tenant/[host]/%5Fsite/review/mark/route");
const { POST: send } =
  await import("../app/tenant/[host]/%5Fsite/review/send/route");
const { POST: formPost } =
  await import("../app/tenant/[host]/api/forms/[formId]/route");
const { default: TenantLayout } = await import("../app/tenant/[host]/layout");

let inst: PbInstance | null = null;
let storageDir = "";
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-review-mode-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.TRUSTED_PROXY_HOPS = "1";
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await inst?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

function on(host: string) {
  state.header = host;
  return { params: Promise.resolve({ host }) };
}

/** Lands the review link; returns the cds_rv cookie value. */
async function land(s: ReviewSeed): Promise<string> {
  const t = signReviewToken(s.org, s.owner, "review");
  const res = await start(
    new Request(`http://${s.preview}:3000/_site/review/start?t=${t}`),
    on(s.preview),
  );
  expect(res.status).toBe(303);
  const c = res.headers.get("set-cookie") ?? "";
  const value = /cds_rv=([^;]+)/.exec(c)?.[1];
  expect(value).toBe(t);
  return t;
}

function post(
  s: ReviewSeed,
  path: string,
  token: string,
  fields: Record<string, string>,
): Request {
  return new Request(`http://${s.preview}:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: `http://${s.preview}:3000`,
      cookie: `cds_rv=${token}`,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

const item = async (s: ReviewSeed, id: string) =>
  (await launchReviewView(s.ctx)).items.find((i) => i.id === id);

describe("review mode on the preview host (14-35)", () => {
  it("a full Looks good pass over both pages ticks item 1", async () => {
    if (!inst) return;
    const s = await seedReviewSite();
    const t = await land(s);
    const [home, about] = s.pages;
    expect((await item(s, "pages_reviewed"))?.done).toBe(false);

    let res = await mark(
      post(s, "/_site/review/mark", t, {
        page: home!.id,
        choice: "looks_good",
      }),
      on(s.preview),
    );
    expect(res.headers.get("location")).toBe(`/about?rs=marked&rp=${home!.id}`);
    res = await mark(
      post(s, "/_site/review/mark", t, {
        page: about!.id,
        choice: "looks_good",
      }),
      on(s.preview),
    );
    expect(res.headers.get("location")).toBe("/about?rs=done");
    const pages = await item(s, "pages_reviewed");
    expect(pages?.done).toBe(true);
    expect(pages?.count).toBe(2);
  });

  it("Needs a change opens the note page and files a change ticket on page:<id>", async () => {
    if (!inst) return;
    const s = await seedReviewSite();
    const t = await land(s);
    const about = s.pages[1]!;
    const res = await mark(
      post(s, "/_site/review/mark", t, {
        page: about.id,
        choice: "needs_change",
      }),
      on(s.preview),
    );
    expect(res.headers.get("location")).toBe(
      `/_site/review/note?page=${about.id}`,
    );
    const sent = await send(
      post(s, "/_site/review/send", t, {
        page: about.id,
        note: "Change the phone number in the footer.",
      }),
      on(s.preview),
    );
    expect(sent.headers.get("location")).toBe("/about?rs=sent");
    const tickets = await ticketsOf(s.org);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      type: "change",
      subject: "Change on About us",
      target: `page:${about.id}`,
    });
    expect(await reviewMarksOf(s.org)).toContainEqual({
      kind: "page",
      page: about.id,
      status: "needs_change",
    });
  });

  it("a foreign Origin is refused and writes nothing (T-14-35-01)", async () => {
    if (!inst) return;
    const s = await seedReviewSite();
    const t = await land(s);
    const req = post(s, "/_site/review/mark", t, {
      page: s.pages[0]!.id,
      choice: "looks_good",
    });
    const forged = new Request(req.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example",
        cookie: `cds_rv=${t}`,
      },
      body: new URLSearchParams({
        page: s.pages[0]!.id,
        choice: "looks_good",
      }).toString(),
    });
    expect((await mark(forged, on(s.preview))).status).toBe(403);
    expect(await reviewMarksOf(s.org)).toEqual([]);
  });

  it("a form sent with the review cookie is a test message and ticks item 5", async () => {
    if (!inst) return;
    const s = await seedReviewSite();
    const deps = {
      sections: SECTION_REGISTRY,
      invalidator: recordingInvalidator(),
      pinger: { ping: () => Promise.resolve() },
    };
    const form: FormRecord = (
      await createForm(s.ctx, deps, { template: "contact" })
    ).form;
    expect((await item(s, "test_form"))?.done).toBe(false);
    const t = await land(s);
    const answers = (): Record<string, string> => {
      const id = (type: string) => form.fields.find((f) => f.type === type)!.id;
      return {
        [id("name")]: "Maria Lopez",
        [id("email")]: "maria@example.com",
        [id("long_text")]: "Testing the contact form before launch.",
        website_url: "",
        _started: String(Date.now() - 10_000),
      };
    };
    const submit = (cookie: string | null) => {
      resetFormSubmitLimitsForTests();
      return formPost(
        new Request(`http://${s.preview}:3000/api/forms/${form.id}`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            ...(cookie ? { cookie } : {}),
          },
          body: new URLSearchParams(answers()).toString(),
        }),
        {
          params: on(s.preview).params.then((p) => ({ ...p, formId: form.id })),
        },
      );
    };
    // Without the cookie (or with a junk one) it is a normal message.
    expect((await submit(null)).status).toBe(303);
    expect((await submit("cds_rv=junk")).status).toBe(303);
    expect((await item(s, "test_form"))?.done).toBe(false);
    expect((await submit(`cds_rv=${t}`)).status).toBe(303);
    const flags = await testFlagsOf(s.org);
    expect(flags.map((f) => f.isTest)).toEqual([false, false, true]);
    expect((await item(s, "test_form"))?.done).toBe(true);
  });

  it("the custom host never renders review chrome; the preview host does (T-14-35-03)", async () => {
    if (!inst) return;
    const s = await seedReviewSite();
    const t = await land(s);
    state.cookies = { cds_rv: t };
    state.path = "/about";
    const render = async (host: string) =>
      renderToStaticMarkup(
        (await TenantLayout({
          children: <p>page</p>,
          params: on(host).params,
        })) as ReactElement,
      );
    const preview = await render(s.preview);
    expect(preview).toContain('aria-label="Page review"');
    expect(preview).toContain("Review mode · Page 2 of 2 · ");
    const custom = await render(s.custom);
    expect(custom).not.toContain("Page review");
    expect(custom).not.toContain("Preview notice");
    expect(custom).toContain("<p>page</p>");
    // The start route refuses to set the cookie on the custom host too.
    const res = await start(
      new Request(`http://${s.custom}/_site/review/start?t=${t}`),
      on(s.custom),
    );
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toBeNull();
    state.cookies = {};
    state.path = null;
  });
});
