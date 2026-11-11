// POST /api/forms/<formId> on tenant hosts (07-19; CONT-25, D231, D236; RESEARCH line 931,
// Pitfall 8) against the real PocketBase 0.39.11 binary. The route is called directly with a
// Request; next/headers supplies the middleware's tenant header and X-Forwarded-For per case;
// next/cache is a passthrough so the manifest is read from the object store every time.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMAIL_ANSWER_COPY,
  FORM_ERROR_COPY,
  FORM_RATE_COPY,
} from "@cds/core/forms";
import {
  captureTransport,
  clearResolverCache,
  createForm,
  createPage,
  publishPage,
  recordingInvalidator,
  saveForm,
  saveFormDraft,
  saveSection,
  type FormRecord,
  type PublishDeps,
} from "@cds/db";
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
import {
  draftsOf,
  grantBuilderPro,
  resetFormSubmitLimitsForTests,
  submissionsOf,
} from "../../../packages/db/test/forms-seed";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({
  header: null as string | null,
  ip: "203.0.113.1",
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    const h = new Headers({ "x-forwarded-for": state.ip });
    if (state.header !== null) h.set("x-cds-tenant-host", state.header);
    return h;
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
const { POST } = await import("../app/tenant/[host]/api/forms/[formId]/route");
const { siteForRoute } = await import("../lib/tenant");

const ENV_KEYS = [
  "CDS_STORAGE_DIR",
  "CDS_PUBLIC_STORAGE_DIR",
  "TRUSTED_PROXY_HOPS",
  "CDS_FILE_SCANNER",
  "CLAMD_HOST",
  "CLAMD_PORT",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let inst: PbInstance | null = null;
let seed: TwoOrgs;
let privDir: string;
let pubDir: string;
let form: FormRecord;
let thanksForm: FormRecord;
let thanksPage: string;
let aboutPage: string;
let ipCounter = 0;

const HOST_A = "a.example.com";
const ITEM = "item-1";

function deps(): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
}

function nextIp(): string {
  ipCounter += 1;
  return `198.51.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

function fieldId(f: FormRecord, type: string): string {
  const field = f.fields.find((x) => x.type === type);
  if (!field) throw new Error(`no ${type} field`);
  return field.id;
}

function answers(
  f: FormRecord,
  over: Record<string, string> = {},
): Record<string, string> {
  return {
    [fieldId(f, "name")]: "Maria Lopez",
    [fieldId(f, "email")]: "maria@example.com",
    [fieldId(f, "long_text")]: "Hello there",
    website_url: "",
    _started: String(Date.now() - 10_000),
    _item: ITEM,
    ...over,
  };
}

async function post(
  formId: string,
  fields: Record<string, string>,
  opts: {
    json?: boolean;
    host?: string;
    header?: string | null;
    ip?: string;
    contentType?: string;
    contentLength?: string;
    rawBody?: string;
  } = {},
): Promise<Response> {
  const host = opts.host ?? HOST_A;
  state.header = opts.header === undefined ? host : opts.header;
  state.ip = opts.ip ?? nextIp();
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/x-www-form-urlencoded",
  };
  if (opts.json) headers.accept = "application/json";
  if (opts.contentLength) headers["content-length"] = opts.contentLength;
  const req = new Request(`https://${host}/api/forms/${formId}`, {
    method: "POST",
    headers,
    body: opts.rawBody ?? new URLSearchParams(fields).toString(),
  });
  return POST(req, { params: Promise.resolve({ host, formId }) });
}

const submissions = submissionsOf;

async function publishedPage(title: string, slug: string): Promise<string> {
  const page = await createPage(seed.ctxA, { title, slug });
  await saveSection(seed.ctxA, SECTION_REGISTRY, {
    pageId: page.id,
    section_type: "text-only",
    row_layout: "full",
    content: { text: `<p>${title}</p>` },
  });
  const res = await publishPage(seed.ctxA, page.id, deps());
  expect(res.status).toBe("published");
  return page.id;
}

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-forms-route-priv-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-forms-route-pub-"));
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  process.env.TRUSTED_PROXY_HOPS = "1";
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;

  aboutPage = await publishedPage("About us", "about");
  thanksPage = await publishedPage("Thank you", "thanks");
  form = (await createForm(seed.ctxA, deps(), { template: "contact" })).form;
  const created = (
    await createForm(seed.ctxA, deps(), {
      template: "contact",
      name: "Quote",
    })
  ).form;
  thanksForm = (
    await saveForm(seed.ctxA, deps(), {
      ...created,
      after_submit: { kind: "page", page: thanksPage },
    })
  ).form;
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
  resetFormSubmitLimitsForTests();
  state.header = null;
});

describe("no-JS sends (303)", () => {
  it("a send 303s back to the page it came from with sent=1", async (t) => {
    if (!inst) return t.skip();
    const res = await post(form.id, answers(form, { _page: aboutPage }));
    expect(res.status).toBe(303);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBe(
      `/about?form=${form.id}&item=${ITEM}&sent=1#form-${ITEM}`,
    );
    const [row] = await submissions(form.id);
    expect(row?.page).toBe(aboutPage);
    expect(row?.spam).toBe(false);
  });

  it("a foreign or //evil _page falls back to /", async (t) => {
    if (!inst) return t.skip();
    for (const page of [
      seed.B.page,
      "//evil.example",
      "https://evil.example",
    ]) {
      const res = await post(form.id, answers(form, { _page: page }));
      expect(res.status).toBe(303);
      const loc = res.headers.get("location") ?? "";
      expect(loc.startsWith(`/?form=${form.id}&`)).toBe(true);
      expect(loc).not.toContain("evil");
    }
  });

  it("after_submit page sends the visitor to that page", async (t) => {
    if (!inst) return t.skip();
    const res = await post(
      thanksForm.id,
      answers(thanksForm, { _page: aboutPage }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/thanks");
  });

  it("field errors travel as codes only, never the answers", async (t) => {
    if (!inst) return t.skip();
    const emailId = fieldId(form, "email");
    const res = await post(
      form.id,
      answers(form, { _page: aboutPage, [emailId]: "" }),
    );
    expect(res.status).toBe(303);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("err=fields");
    expect(loc).toContain(`f=${emailId}.r`);
    expect(loc).not.toContain("Maria");
  });

  it("a form in a pop-up (no _page) returns to /", async (t) => {
    if (!inst) return t.skip();
    const res = await post(form.id, answers(form, { _item: "popup-item" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `/?form=${form.id}&item=popup-item&sent=1#form-popup-item`,
    );
    const [row] = await submissions(form.id);
    expect(row?.page).toBe("");
  });
});

describe("JSON sends (FormEnhancer)", () => {
  it("200 with the after_submit message, or the page href", async (t) => {
    if (!inst) return t.skip();
    const res = await post(form.id, answers(form), { json: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      afterSubmit: { kind: string };
    };
    expect(body.ok).toBe(true);
    expect(body.afterSubmit.kind).toBe("message");

    const page = await post(thanksForm.id, answers(thanksForm), {
      json: true,
    });
    expect(await page.json()).toEqual({
      ok: true,
      afterSubmit: { kind: "page", href: "/thanks" },
    });
  });

  it("422 with errors keyed by field id", async (t) => {
    if (!inst) return t.skip();
    const emailId = fieldId(form, "email");
    const res = await post(form.id, answers(form, { [emailId]: "" }), {
      json: true,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      ok: boolean;
      errors: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(Object.keys(body.errors)).toContain(emailId);
  });

  it("404 for an unknown form, a foreign org's form, or an unknown host", async (t) => {
    if (!inst) return t.skip();
    expect(
      (await post("zzzzzzzzzzzzzzz", answers(form), { json: true })).status,
    ).toBe(404);
    expect(
      (await post(seed.B.form, answers(form), { json: true })).status,
    ).toBe(404);
    const unknown = await post(form.id, answers(form), {
      host: "nobody.example.com",
    });
    expect(unknown.status).toBe(404);
    const noHeader = await post(form.id, answers(form), { header: null });
    expect(noHeader.status).toBe(404);
  });

  it("the honeypot gives a response identical to a real send", async (t) => {
    if (!inst) return t.skip();
    const real = await post(form.id, answers(form), { json: true });
    const spam = await post(
      form.id,
      answers(form, { website_url: "http://spam.example" }),
      { json: true },
    );
    expect(spam.status).toBe(real.status);
    expect(await spam.text()).toBe(await real.text());
    // Stored, but flagged (never ordered by time: same-millisecond rows tie).
    const flagged = (await submissions(form.id)).filter((r) => r.spam);
    expect(flagged).toHaveLength(1);

    const realNoJs = await post(form.id, answers(form, { _page: aboutPage }));
    const spamNoJs = await post(
      form.id,
      answers(form, { _page: aboutPage, website_url: "x" }),
    );
    expect(spamNoJs.status).toBe(303);
    expect(spamNoJs.headers.get("location")).toBe(
      realNoJs.headers.get("location"),
    );
  });
});

describe("limits", () => {
  it("413 on a declared or real body over 128 KB", async (t) => {
    if (!inst) return t.skip();
    const declared = await post(form.id, answers(form), {
      json: true,
      contentLength: "200000",
    });
    expect(declared.status).toBe(413);
    const big = await post(
      form.id,
      answers(form, { [fieldId(form, "long_text")]: "x".repeat(140_000) }),
      { json: true },
    );
    expect(big.status).toBe(413);
  });

  it("415 on any other content type", async (t) => {
    if (!inst) return t.skip();
    const res = await post(form.id, answers(form), {
      json: true,
      contentType: "application/json",
      rawBody: JSON.stringify(answers(form)),
    });
    expect(res.status).toBe(415);
  });

  it("429 per client IP; another IP still gets through", async (t) => {
    if (!inst) return t.skip();
    const ip = "192.0.2.77";
    for (let i = 0; i < 5; i += 1) {
      const ok = await post(form.id, answers(form), { json: true, ip });
      expect(ok.status).toBe(200);
    }
    const limited = await post(form.id, answers(form), { json: true, ip });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      ok: false,
      message: FORM_RATE_COPY,
    });
    const noJs = await post(form.id, answers(form, { _page: aboutPage }), {
      ip,
    });
    expect(noJs.headers.get("location")).toContain("err=rate");
    const other = await post(form.id, answers(form), {
      json: true,
      ip: "192.0.2.78",
    });
    expect(other.status).toBe(200);
  });
});

// 10-38 (BILL-14, D234; choice 2): multipart sends with files. A tiny fake clamd on loopback
// answers every INSTREAM with "stream: OK" (or FOUND), so the real clamd scanner path runs.
describe("file uploads (Forms Pro)", () => {
  let clamd: Server;
  let verdict = "stream: OK";
  let uploadForm: FormRecord;

  beforeAll(async () => {
    if (!inst) return;
    clamd = createServer((sock) => {
      // Parse INSTREAM properly: "zINSTREAM\0", then 4-byte length + bytes, until length 0.
      let buf = Buffer.alloc(0);
      let at = 10;
      let done = false;
      sock.on("data", (d: Buffer) => {
        if (done) return;
        buf = Buffer.concat([buf, d]);
        while (buf.length >= at + 4) {
          const len = buf.readUInt32BE(at);
          if (len === 0) {
            done = true;
            sock.end(`${verdict}\0`);
            return;
          }
          if (buf.length < at + 4 + len) return;
          at += 4 + len;
        }
      });
      sock.on("error", () => {});
    });
    await new Promise<void>((r) => clamd.listen(0, "127.0.0.1", r));
    const addr = clamd.address();
    process.env.CDS_FILE_SCANNER = "clamd";
    process.env.CLAMD_HOST = "127.0.0.1";
    process.env.CLAMD_PORT = String(
      typeof addr === "object" && addr ? addr.port : 0,
    );
    await grantBuilderPro(seed.A.org);
    const created = (
      await createForm(seed.ctxA, deps(), {
        template: "contact",
        name: "Photo request",
      })
    ).form;
    uploadForm = (
      await saveForm(seed.ctxA, deps(), {
        ...created,
        fields: [
          ...created.fields,
          {
            id: "photo",
            type: "file",
            label: "Your photo",
            placeholder: "",
            help: "",
            required: false,
            full_width: false,
            options: [],
            content: "",
            value: "",
          },
        ],
      })
    ).form;
  });

  afterAll(async () => {
    await new Promise<void>((r) => (clamd ? clamd.close(() => r()) : r()));
  });

  function pdf(size: number): Uint8Array<ArrayBuffer> {
    const b = new Uint8Array(size);
    b.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    return b;
  }

  async function postFile(
    f: FormRecord,
    file: File,
    json = true,
  ): Promise<Response> {
    state.header = HOST_A;
    state.ip = nextIp();
    const fd = new FormData();
    for (const [k, v] of Object.entries(answers(f))) fd.set(k, v);
    fd.set("photo", file);
    const req = new Request(`https://${HOST_A}/api/forms/${f.id}`, {
      method: "POST",
      headers: json ? { accept: "application/json" } : {},
      body: fd,
    });
    return POST(req, {
      params: Promise.resolve({ host: HOST_A, formId: f.id }),
    });
  }

  function storedFor(submissionId: string): string[] {
    return (readdirSync(privDir, { recursive: true }) as string[])
      .map((p) => p.split("\\").join("/"))
      .filter(
        (p) =>
          p.includes(`/forms/`) &&
          p.includes(`/${submissionId}/`) &&
          /\.[a-z]+$/.test(p),
      );
  }

  it("stores a file sent to a form with a file field and answers as usual", async (t) => {
    if (!inst) return t.skip();
    verdict = "stream: OK";
    const res = await postFile(
      uploadForm,
      new File([pdf(300 * 1024)], "id-card.pdf", { type: "application/pdf" }),
    );
    const body = (await res.json()) as { ok: boolean };
    expect(body, JSON.stringify(body)).toMatchObject({ ok: true });
    expect(res.status).toBe(200);
    const [row] = await submissions(uploadForm.id);
    expect(row?.data.photo).toMatchObject({
      name: "id-card.pdf",
      size: 300 * 1024,
      type: "application/pdf",
    });
    expect(storedFor(row!.id)).toHaveLength(1);
  });

  it("an infected file is a 422 field error and nothing is stored", async (t) => {
    if (!inst) return t.skip();
    verdict = "stream: Eicar-Test-Signature FOUND";
    const before = (await submissions(uploadForm.id)).length;
    const res = await postFile(
      uploadForm,
      new File([pdf(2048)], "a.pdf", { type: "application/pdf" }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: Record<string, string> };
    expect(body.errors.photo).toBe(
      "This file didn't pass our safety check. Choose another file.",
    );
    expect((await submissions(uploadForm.id)).length).toBe(before);
    verdict = "stream: OK";
  });

  it("a form without a file field drops the file and keeps the 128 KB cap", async (t) => {
    if (!inst) return t.skip();
    const small = await postFile(
      form,
      new File([pdf(1024)], "a.pdf", { type: "application/pdf" }),
    );
    expect(small.status).toBe(200);
    const [row] = await submissions(form.id);
    expect(row?.data.photo).toBeUndefined();
    expect(storedFor(row!.id)).toHaveLength(0);
    const big = await postFile(
      form,
      new File([pdf(200 * 1024)], "a.pdf", { type: "application/pdf" }),
    );
    expect(big.status).toBe(413);
  });

  it("over 10 MB + 128 KB is a 413 before parsing, even on a file form", async (t) => {
    if (!inst) return t.skip();
    const res = await postFile(
      uploadForm,
      new File([pdf(10 * 1024 * 1024 + 200 * 1024)], "a.pdf", {
        type: "application/pdf",
      }),
    );
    expect(res.status).toBe(413);
  });
});

// 10-40 (BILL-14, D233; choice 3): "Save and finish later" through the same route.
describe("save and finish later (Forms Pro)", () => {
  let saveForm2: FormRecord;

  beforeAll(async () => {
    if (!inst) return;
    await grantBuilderPro(seed.A.org);
    const created = (
      await createForm(seed.ctxA, deps(), {
        template: "contact",
        name: "Catering",
      })
    ).form;
    saveForm2 = (
      await saveForm(seed.ctxA, deps(), {
        ...created,
        pro: {
          rules: [],
          steps: [],
          auto_reply: { enabled: false, subject: "", body: "" },
          routing: [],
          save_resume: true,
        },
      })
    ).form;
  });

  const saveFields = (f: FormRecord, email = "pat@example.com") => ({
    ...answers(f, { [fieldId(f, "long_text")]: "Half done" }),
    _intent: "save",
    _email: email,
  });

  it("JSON: stores one draft and answers { ok: true }; logs carry no answers", async (t) => {
    if (!inst) return t.skip();
    const errors = vi.spyOn(console, "error");
    const res = await post(saveForm2.id, saveFields(saveForm2), { json: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [draft, ...rest] = await draftsOf(saveForm2.id);
    expect(rest).toHaveLength(0);
    expect(draft?.email).toBe("pat@example.com");
    expect(draft?.data).toMatchObject({
      [fieldId(saveForm2, "long_text")]: "Half done",
    });
    expect(draft?.data).not.toHaveProperty("_intent");
    expect(draft?.data).not.toHaveProperty("_email");
    expect(await submissions(saveForm2.id)).toHaveLength(0);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("Half done");
    errors.mockRestore();
  });

  it("no JS: 303 back with saved=1", async (t) => {
    if (!inst) return t.skip();
    const res = await post(saveForm2.id, {
      ...saveFields(saveForm2, "sam@example.com"),
      _page: aboutPage,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `/about?form=${saveForm2.id}&item=${ITEM}&saved=1#form-${ITEM}`,
    );
  });

  it("a bad email is a 422 keyed _email; nothing stored", async (t) => {
    if (!inst) return t.skip();
    const before = (await draftsOf(saveForm2.id)).length;
    const res = await post(saveForm2.id, saveFields(saveForm2, "nope"), {
      json: true,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      ok: false,
      errors: { _email: EMAIL_ANSWER_COPY },
    });
    expect((await draftsOf(saveForm2.id)).length).toBe(before);
  });

  it("a form without save and finish later refuses with FORM-ERROR and no draft", async (t) => {
    if (!inst) return t.skip();
    const res = await post(form.id, saveFields(form), { json: true });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, message: FORM_ERROR_COPY });
    expect(await draftsOf(form.id)).toHaveLength(0);
    expect(await submissions(form.id).then((r) => r.length)).toBeGreaterThan(0);
    const noJs = await post(form.id, { ...saveFields(form), _page: aboutPage });
    expect(noJs.headers.get("location")).toContain("err=error");
  });

  it("saves share the form-submit rate limit (429)", async (t) => {
    if (!inst) return t.skip();
    const ip = "192.0.2.90";
    for (let i = 0; i < 5; i += 1) {
      const ok = await post(
        saveForm2.id,
        saveFields(saveForm2, `p${i}@example.com`),
        { json: true, ip },
      );
      expect(ok.status).toBe(200);
    }
    const limited = await post(saveForm2.id, saveFields(saveForm2), {
      json: true,
      ip,
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      ok: false,
      message: FORM_RATE_COPY,
    });
  });

  it("a send carrying _resume deletes that draft", async (t) => {
    if (!inst) return t.skip();
    state.header = HOST_A;
    const site = await siteForRoute(HOST_A);
    expect(site).not.toBeNull();
    const transport = captureTransport();
    const saved = await saveFormDraft(
      site!,
      saveForm2.id,
      { email: "lee@example.com", answers: answers(saveForm2) },
      { ip: nextIp() },
      { transport },
    );
    expect(saved).toEqual({ ok: true });
    const token = /[?&]resume=([A-Za-z0-9_-]{43})/.exec(
      transport.sent[0]!.text,
    )![1]!;
    const mine = async () =>
      (await draftsOf(saveForm2.id)).filter(
        (d) => d.email === "lee@example.com",
      );
    expect(await mine()).toHaveLength(1);
    const res = await post(
      saveForm2.id,
      { ...answers(saveForm2), _resume: token },
      { json: true },
    );
    expect(res.status).toBe(200);
    expect(await mine()).toHaveLength(0);
    const [row] = await submissions(saveForm2.id);
    expect(row?.data).not.toHaveProperty("_resume");
  });
});
