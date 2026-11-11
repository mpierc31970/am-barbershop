// Forms Pro "save and finish later" (BILL-14, D233; 10-37; invariant 1; T-10-37-01..04):
// a visitor saves a partly filled Pro form, gets a resume link by email, opens it to restore
// the answers; only the token's sha256 is stored, drafts expire after 30 days and the daily
// retention job purges them. Not entitled or save_resume off = refused, nothing stored.
import { createHash } from "node:crypto";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { FORM_DRAFT_TTL_DAYS, type FormField } from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintSystemContext, type OrgContext } from "../src/context";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { captureTransport } from "../src/email/transport";
import {
  createForm,
  deleteForm,
  saveForm,
  type FormRecord,
} from "../src/forms";
import {
  deleteFormDraft,
  purgeExpiredFormDrafts,
  resumeFormDraft,
  saveFormDraft,
} from "../src/forms/drafts";
import { runRetentionJob } from "../src/jobs/retention";
import { resetFormSubmitLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { draftsOf } from "./forms-seed";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let ipCounter = 0;

function deps(): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
}

function nextIp(): string {
  ipCounter += 1;
  return `10.8.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

async function site(host: string): Promise<SiteContext> {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

function field(
  id: string,
  type: FormField["type"],
  label: string,
  over: Partial<FormField> = {},
): FormField {
  return {
    id,
    type,
    label,
    placeholder: "",
    help: "",
    required: false,
    full_width: false,
    options: [],
    content: "",
    value: "",
    ...over,
  };
}

const FIELDS: FormField[] = [
  field("name", "name", "Name", { required: true }),
  field("email", "email", "Email", { required: true }),
  field("service", "dropdown", "Service", {
    required: true,
    options: ["Portrait", "Wedding"],
  }),
  field("details", "long_text", "Details", { required: true }),
  field("photo", "file", "Photo"),
];

function pro(saveResume: boolean) {
  return {
    rules: [],
    steps: [],
    auto_reply: { enabled: false, subject: "", body: "" },
    routing: [],
    save_resume: saveResume,
  };
}

async function proForm(
  ctx: OrgContext,
  saveResume = true,
): Promise<FormRecord> {
  const { form } = await createForm(ctx, deps(), {
    template: "blank",
    name: "Catering request",
  });
  const { form: saved } = await saveForm(ctx, deps(), {
    ...form,
    fields: FIELDS,
    notify_route: "default",
    pro: pro(saveResume),
  });
  return saved;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function tokenOf(link: string): string {
  const m = /[?&]resume=([A-Za-z0-9_-]+)/.exec(link);
  if (!m) throw new Error(`no token in ${link}`);
  return m[1]!;
}

function linkIn(text: string): string {
  const m = /https?:\/\/\S*resume=[A-Za-z0-9_-]+#form-[a-z0-9]+/.exec(text);
  if (!m) throw new Error("no resume link in email");
  return m[0];
}

const answers = (over: Record<string, unknown> = {}) => ({
  name: "Pat Rivera",
  service: "Wedding",
  photo: "evil.exe",
  _started: String(Date.now() - 10_000),
  website_url: "",
  ...over,
});

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // A: Studio (Builder Pro included at $0). B: Standard without Builder Pro.
  await pb.collection("organizations").update(seed.A.org, { path: "studio" });
  await pb.collection("organizations").update(seed.B.org, { path: "standard" });
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
});

beforeEach(() => {
  resetFormSubmitLimitsForTests();
});

describe("saveFormDraft (entitled, save_resume on)", () => {
  it("stores one hashed draft, strips file answers and emails the link", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    const res = await saveFormDraft(
      siteA,
      form.id,
      { email: "Pat@Example.com", answers: answers() },
      { ip: nextIp() },
      { transport },
    );
    expect(res).toEqual({ ok: true });

    const rows = await draftsOf(form.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.email).toBe("pat@example.com");
    expect(row.data).toEqual({ name: "Pat Rivera", service: "Wedding" });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(transport.sent).toHaveLength(1);
    const mail = transport.sent[0]!;
    expect(mail.to).toBe("pat@example.com");
    const link = linkIn(mail.text);
    expect(link).toContain(`#form-${form.id}`);
    const token = tokenOf(link);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(row.tokenHash).toBe(sha(token));
    expect(row.tokenHash).not.toBe(token);
    expect(
      JSON.stringify(await pb.collection("form_drafts").getOne(row.id)),
    ).not.toContain(token);

    const days = (new Date(row.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(FORM_DRAFT_TTL_DAYS - 1);
    expect(days).toBeLessThanOrEqual(FORM_DRAFT_TTL_DAYS);
  });

  it("saving again for the same email replaces the draft", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    const input = { email: "sam@example.com", answers: answers() };
    await saveFormDraft(siteA, form.id, input, { ip: nextIp() }, { transport });
    await saveFormDraft(
      siteA,
      form.id,
      { ...input, answers: answers({ details: "Saturday" }) },
      { ip: nextIp() },
      { transport },
    );
    const rows = await draftsOf(form.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ details: "Saturday" });
    const first = tokenOf(linkIn(transport.sent[0]!.text));
    const second = tokenOf(linkIn(transport.sent[1]!.text));
    expect(await resumeFormDraft(siteA, form.id, first)).toBeNull();
    expect(await resumeFormDraft(siteA, form.id, second)).toMatchObject({
      answers: { details: "Saturday" },
    });
  });

  it("two saves at once still leave one draft and one live link (review WR-A05)", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    const input = { email: "twin@example.com", answers: answers() };
    await Promise.all([
      saveFormDraft(siteA, form.id, input, { ip: nextIp() }, { transport }),
      saveFormDraft(siteA, form.id, input, { ip: nextIp() }, { transport }),
    ]);
    expect(await draftsOf(form.id)).toHaveLength(1);
    const live = await Promise.all(
      transport.sent.map((m) =>
        resumeFormDraft(siteA, form.id, tokenOf(linkIn(m.text))),
      ),
    );
    expect(live.filter((r) => r !== null)).toHaveLength(1);
  });

  it("the database refuses a second draft for the same form and email (review WR-A05)", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const row = (h: string) => ({
      organization: seed.A.org,
      form: form.id,
      email: "dup@example.com",
      data: {},
      token_hash: h.repeat(64),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await pb.collection("form_drafts").create(row("d"));
    await expect(
      pb.collection("form_drafts").create(row("e")),
    ).rejects.toThrow();
    expect(await draftsOf(form.id)).toHaveLength(1);
  });

  it("drops an invalid answer instead of refusing the save", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const res = await saveFormDraft(
      siteA,
      form.id,
      { email: "lee@example.com", answers: answers({ service: "Bogus" }) },
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    expect(res).toEqual({ ok: true });
    const rows = await draftsOf(form.id);
    expect(rows[0]!.data).toEqual({ name: "Pat Rivera" });
  });

  it("refuses a bad address or an oversized draft", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    expect(
      await saveFormDraft(
        siteA,
        form.id,
        { email: "not-an-email", answers: answers() },
        { ip: nextIp() },
        { transport },
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await saveFormDraft(
        siteA,
        form.id,
        {
          email: "big@example.com",
          answers: answers({ details: "x".repeat(70_000) }),
        },
        { ip: nextIp() },
        { transport },
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await draftsOf(form.id)).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
  });

  it("spam (honeypot) is answered like a success and stores nothing", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    const res = await saveFormDraft(
      siteA,
      form.id,
      {
        email: "bot@example.com",
        answers: answers({ website_url: "http://spam" }),
      },
      { ip: nextIp() },
      { transport },
    );
    expect(res).toEqual({ ok: true });
    expect(await draftsOf(form.id)).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
  });
});

describe("resumeFormDraft / deleteFormDraft", () => {
  async function saved(): Promise<{
    form: FormRecord;
    siteA: SiteContext;
    token: string;
  }> {
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    await saveFormDraft(
      siteA,
      form.id,
      { email: "kim@example.com", answers: answers() },
      { ip: nextIp() },
      { transport },
    );
    return { form, siteA, token: tokenOf(linkIn(transport.sent[0]!.text)) };
  }

  it("the raw token restores the answers; a wrong token does not", async (t) => {
    if (!inst) return t.skip();
    const { form, siteA, token } = await saved();
    expect(await resumeFormDraft(siteA, form.id, token)).toEqual({
      answers: { name: "Pat Rivera", service: "Wedding" },
      email: "kim@example.com",
    });
    expect(await resumeFormDraft(siteA, form.id, "A".repeat(43))).toBeNull();
    expect(await resumeFormDraft(siteA, form.id, "../../x")).toBeNull();
    // The stored hash itself is not a token.
    const [row] = await draftsOf(form.id);
    expect(await resumeFormDraft(siteA, form.id, row!.tokenHash)).toBeNull();
  });

  it("an expired draft resumes as null and is deleted", async (t) => {
    if (!inst) return t.skip();
    const { form, siteA, token } = await saved();
    const [row] = await draftsOf(form.id);
    await pb.collection("form_drafts").update(row!.id, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await resumeFormDraft(siteA, form.id, token)).toBeNull();
    expect(await draftsOf(form.id)).toHaveLength(0);
  });

  it("org B's site cannot resume or delete org A's draft (T-10-37-02)", async (t) => {
    if (!inst) return t.skip();
    const { form, siteA, token } = await saved();
    const siteB = await site("b.example.com");
    expect(await resumeFormDraft(siteB, form.id, token)).toBeNull();
    expect(await deleteFormDraft(siteB, form.id, token)).toBe(false);
    expect(await draftsOf(form.id)).toHaveLength(1);
    expect(await resumeFormDraft(siteA, form.id, token)).not.toBeNull();
  });

  it("deleting with the token removes the draft (the submit path)", async (t) => {
    if (!inst) return t.skip();
    const { form, siteA, token } = await saved();
    expect(await deleteFormDraft(siteA, form.id, token)).toBe(true);
    expect(await draftsOf(form.id)).toHaveLength(0);
    expect(await resumeFormDraft(siteA, form.id, token)).toBeNull();
  });

  it("hard-deleting the form takes its drafts with it (review CR-A01)", async (t) => {
    if (!inst) return t.skip();
    const { form } = await saved();
    expect(await draftsOf(form.id)).toHaveLength(1);
    expect(await deleteForm(seed.ctxA, deps(), form.id)).toEqual({
      outcome: "hard",
    });
    await expect(pb.collection("forms").getOne(form.id)).rejects.toThrow();
    expect(await draftsOf(form.id)).toHaveLength(0);
  });
});

describe("not Pro: refused, nothing stored or sent", () => {
  it("save_resume off", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA, false);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    expect(
      await saveFormDraft(
        siteA,
        form.id,
        { email: "x@example.com", answers: answers() },
        { ip: nextIp() },
        { transport },
      ),
    ).toEqual({ ok: false, reason: "not_pro" });
    expect(await draftsOf(form.id)).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
  });

  it("org not entitled to Builder Pro", async (t) => {
    if (!inst) return t.skip();
    // Saved while entitled (A is Studio), then the org is moved to Standard without Pro.
    const form = await proForm(seed.ctxA);
    await pb
      .collection("organizations")
      .update(seed.A.org, { path: "standard" });
    try {
      const siteA = await site("a.example.com");
      const transport = captureTransport();
      expect(
        await saveFormDraft(
          siteA,
          form.id,
          { email: "x@example.com", answers: answers() },
          { ip: nextIp() },
          { transport },
        ),
      ).toEqual({ ok: false, reason: "not_pro" });
      expect(await draftsOf(form.id)).toHaveLength(0);
      expect(transport.sent).toHaveLength(0);
    } finally {
      await pb
        .collection("organizations")
        .update(seed.A.org, { path: "studio" });
    }
  });

  it("a foreign form id from org B's site is refused as not found", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteB = await site("b.example.com");
    await expect(
      saveFormDraft(
        siteB,
        form.id,
        { email: "x@example.com", answers: answers() },
        { ip: nextIp() },
        { transport: captureTransport() },
      ),
    ).rejects.toThrow();
    expect(await draftsOf(form.id)).toHaveLength(0);
  });
});

describe("purgeExpiredFormDrafts (T-10-37-04)", () => {
  it("deletes only expired drafts; the retention job counts them", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    for (const email of ["old@example.com", "new@example.com"]) {
      await saveFormDraft(
        siteA,
        form.id,
        { email, answers: answers() },
        { ip: nextIp() },
        { transport: captureTransport() },
      );
    }
    const old = (await draftsOf(form.id)).find(
      (r) => r.email === "old@example.com",
    )!;
    await pb.collection("form_drafts").update(old.id, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const dry = await runRetentionJob({ dryRun: true });
    expect(dry.formDraftsPurged).toBeGreaterThanOrEqual(1);
    expect(await draftsOf(form.id)).toHaveLength(2);

    const sys = mintSystemContext({ job: "retention" });
    expect(await purgeExpiredFormDrafts(sys)).toBeGreaterThanOrEqual(1);
    const left = await draftsOf(form.id);
    expect(left.map((r) => r.email)).toEqual(["new@example.com"]);
    expect(await purgeExpiredFormDrafts(sys)).toBe(0);
  });
});
