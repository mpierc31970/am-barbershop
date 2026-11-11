// Forms engine on the real PocketBase 0.39.11 binary (CONT-25; D231, D233, D236, D270, D271,
// D132; RESEARCH Pattern 5, Pitfall 8; resolutions f, g; invariant 1, TEN-03;
// T-07-15-01..12).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Forbidden,
  InvalidContext,
  InvalidInput,
  NotFound,
  RateLimited,
} from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import {
  BLOCKED_FIELD_COPY,
  FILE_FIELD_PRO_COPY,
  FORM_RATE_COPY,
  FormErrors,
  type FormField,
} from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import { saveSection } from "../src/content/sections";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport, type EmailTransport } from "../src/email/transport";
import {
  countSubmissions,
  createForm,
  deleteForm,
  deleteSubmission,
  duplicateForm,
  exportSubmissionsCsv,
  formsStatus,
  formUsedOn,
  getForm,
  getSubmission,
  listForms,
  listSubmissions,
  markNotSpam,
  readPublicForms,
  saveForm,
  setSubmissionRead,
  submitForm,
  type FormRecord,
} from "../src/forms";
import {
  formsNotifyStats,
  resetFormsNotifyStatsForTests,
} from "../src/forms/notify";
import { resetFormSubmitLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const IP = "127.0.0.1";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;
let ipCounter = 0;

function deps(over: Partial<ContentDeps> = {}): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
    ...over,
  };
}

const heldDeps = () =>
  deps({
    scanner: {
      scan: () => Promise.resolve({ verdict: "held", reasons: ["test hold"] }),
    },
  });

function ctxAs(
  orgId: string,
  role: OrgContext["role"],
  actor = seed.A.owner,
): OrgContext {
  return mintOrgContext({ orgId, actor, role, grants: [], ip: IP });
}

async function site(host: string): Promise<SiteContext> {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

function idOf(form: FormRecord, type: FormField["type"]): string {
  const f = form.fields.find((x) => x.type === type);
  if (!f) throw new Error(`no ${type} field`);
  return f.id;
}

function contactPayload(
  form: FormRecord,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [idOf(form, "name")]: "Maria Lopez",
    [idOf(form, "email")]: "maria@example.com",
    [idOf(form, "long_text")]: "Hello there",
    website_url: "",
    _started: String(Date.now() - 10_000),
    ...over,
  };
}

/**
 * D275 (07-28): a form is only soft-deleted while something uses it. Place it in a draft
 * Columns block on A's page first, then delete it (soft).
 */
async function softDeleteForm(form: FormRecord): Promise<void> {
  await saveSection(
    seed.ctxA,
    registry,
    {
      pageId: seed.A.page,
      section_type: "columns",
      row_layout: "full",
      content: {
        columns: [
          { id: "c1", items: [{ id: "f1", kind: "form", form_id: form.id }] },
        ],
      },
    },
    { ownerOf: () => undefined },
  );
  expect((await deleteForm(seed.ctxA, deps(), form.id)).outcome).toBe("soft");
}

const rows = (collection: string, org: string, extra = "", params = {}) =>
  pb.collection(collection).getFullList({
    filter: pb.filter(`organization = {:org}${extra}`, { org, ...params }),
  });

async function newContactForm(name?: string): Promise<FormRecord> {
  const { form } = await createForm(seed.ctxA, deps(), {
    template: "contact",
    ...(name ? { name } : {}),
  });
  return form;
}

async function bareOrg(): Promise<{ org: string; ctx: OrgContext }> {
  const slug = `fm-${Math.random().toString(36).slice(2, 10)}`;
  const org = (
    await pb.collection("organizations").create({
      name: "Form Co",
      slug,
      status: "active",
    })
  ).id;
  return { org, ctx: ctxAs(org, "owner") };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-forms-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetFormSubmitLimitsForTests();
  resetFormsNotifyStatsForTests();
});

describe("writers", () => {
  it("creates a form from a template with notify_route inquiries", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    expect(form.template).toBe("contact");
    expect(form.notify_route).toBe("inquiries");
    expect(form.fields.map((f) => f.type)).toEqual([
      "name",
      "email",
      "phone",
      "long_text",
    ]);
    const row = await pb.collection("forms").getOne(form.id);
    expect(row.organization).toBe(seed.A.org);
    const renamed = await newContactForm("Spring quotes");
    expect(renamed.name).toBe("Spring quotes");
    await expect(
      createForm(seed.ctxA, deps(), { template: "nope" }),
    ).rejects.toThrow(InvalidInput);
  });

  it("saves edits through the validator; the template never changes", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const { form: saved, held } = await saveForm(seed.ctxA, deps(), {
      ...form,
      template: "feedback",
      name: "Contact us",
      layout: "2",
      newsletter_checkbox: true,
    });
    expect(held).toBe(false);
    expect(saved.name).toBe("Contact us");
    expect(saved.layout).toBe("2");
    expect(saved.template).toBe("contact");
    expect(saved.newsletter_wording).toMatch(/unsubscribe any time/);
  });

  it("refuses blocked fields, file fields and another org's page", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const bad = {
      ...form,
      fields: [
        ...form.fields,
        { id: "card", type: "short_text", label: "Card number" },
      ],
    };
    const err = await saveForm(seed.ctxA, deps(), bad).catch((e) => e);
    expect(err).toBeInstanceOf(FormErrors);
    expect((err as FormErrors).errors.card).toBe(BLOCKED_FIELD_COPY);
    const file = await saveForm(seed.ctxA, deps(), {
      ...form,
      fields: [{ id: "up", type: "file", label: "Upload" }],
    }).catch((e) => e);
    expect((file as FormErrors).errors.up).toMatch(/Builder Pro/);
    const foreign = await saveForm(seed.ctxA, deps(), {
      ...form,
      after_submit: { kind: "page", page: seed.B.page },
    }).catch((e) => e);
    expect(foreign).toBeInstanceOf(InvalidInput);
    const own = await saveForm(seed.ctxA, deps(), {
      ...form,
      after_submit: { kind: "page", page: seed.A.page },
    });
    expect(own.form.after_submit.page).toBe(seed.A.page);
    await expect(
      saveForm(seed.ctxA, deps(), { ...form, organization: seed.B.org }),
    ).rejects.toThrow(InvalidInput);
  });

  it("file fields follow the Builder Pro entitlement (10-17, BILL-14, D234)", async (t) => {
    if (!inst) return t.skip();
    const upload = { id: "up", type: "file", label: "Upload" };
    // Standard org without Builder Pro: refused.
    const std = await bareOrg();
    await pb.collection("organizations").update(std.org, { path: "standard" });
    const { form } = await createForm(std.ctx, deps(), { template: "contact" });
    const refused = await saveForm(std.ctx, deps(), {
      ...form,
      fields: [...form.fields, upload],
    }).catch((e) => e);
    expect(refused).toBeInstanceOf(FormErrors);
    expect((refused as FormErrors).errors.up).toBe(FILE_FIELD_PRO_COPY);

    // Active builder-pro: accepted, and it reads back.
    const row = await pb.collection("org_addons").create({
      organization: std.org,
      addon: "builder-pro",
      status: "active",
      source: "billing",
      installed_version: "1.0.0",
      installed_at: new Date().toISOString(),
    });
    const ok = await saveForm(std.ctx, deps(), {
      ...form,
      fields: [...form.fields, upload],
    });
    expect(ok.form.fields.some((f) => f.type === "file")).toBe(true);

    // Lapsed: the unchanged form re-saves (data kept); a new file field is refused.
    await pb.collection("org_addons").update(row.id, {
      status: "disabled",
      disabled_reason: "billing_lapse",
    });
    const kept = await saveForm(std.ctx, deps(), {
      ...ok.form,
      name: "Contact (renamed)",
    });
    expect(kept.form.fields.some((f) => f.id === "up")).toBe(true);
    const added = await saveForm(std.ctx, deps(), {
      ...kept.form,
      fields: [...kept.form.fields, { id: "up2", type: "file", label: "More" }],
    }).catch((e) => e);
    expect((added as FormErrors).errors.up2).toBe(FILE_FIELD_PRO_COPY);

    // Studio: Builder Pro included at $0, no row.
    const studio = await bareOrg();
    await pb.collection("organizations").update(studio.org, { path: "studio" });
    const s = await createForm(studio.ctx, deps(), { template: "contact" });
    const saved = await saveForm(studio.ctx, deps(), {
      ...s.form,
      fields: [...s.form.fields, upload],
    });
    expect(saved.form.fields.some((f) => f.type === "file")).toBe(true);
  });

  it("a held save is saved, In review and never public (D270)", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const res = await saveForm(seed.ctxA, heldDeps(), {
      ...form,
      name: "Held one",
    });
    expect(res.held).toBe(true);
    expect(res.form.inReview).toBe(true);
    expect((await getForm(seed.ctxA, form.id)).inReview).toBe(true);
    const flags = await rows(
      "content_flags",
      seed.A.org,
      " && target_id = {:t}",
      { t: form.id },
    );
    expect(flags.map((f) => f.verdict)).toEqual(["held"]);
    const siteA = await site("a.example.com");
    expect(await readPublicForms(siteA, [form.id])).toEqual({});
  });

  it("duplicates as 'Copy of <name>' with the same fields", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm("Contact");
    const { form: copy } = await duplicateForm(seed.ctxA, deps(), form.id);
    expect(copy.id).not.toBe(form.id);
    expect(copy.name).toBe("Copy of Contact");
    expect(copy.fields).toEqual(form.fields);
    const long = await newContactForm("x".repeat(80));
    const { form: copy2 } = await duplicateForm(seed.ctxA, deps(), long.id);
    expect(copy2.name).toHaveLength(80);
  });

  it("soft-deletes; lists hide it unless includeDeleted", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm("To delete");
    await softDeleteForm(form);
    const row = await pb.collection("forms").getOne(form.id);
    expect(row.deleted_at).not.toBe("");
    const list = await listForms(seed.ctxA);
    expect(list.some((f) => f.id === form.id)).toBe(false);
    const all = await listForms(seed.ctxA, { includeDeleted: true });
    const mine = all.find((f) => f.id === form.id);
    expect(mine?.deleted).toBe(true);
    expect(mine?.fieldCount).toBe(4);
    expect(mine?.unread).toBe(0);
  });

  it("refuses the 101st form", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    for (let i = 0; i < 100; i += 20) {
      await Promise.all(
        Array.from({ length: 20 }, (_, j) =>
          pb.collection("forms").create({
            organization: org,
            name: `F${i + j}`,
            template: "blank",
            layout: "1",
            fields: [],
            notify_route: "inquiries",
          }),
        ),
      );
    }
    await expect(
      createForm(ctx, deps(), { template: "blank" }),
    ).rejects.toThrow("You can have up to 100 forms.");
  });

  it("a Viewer reads but cannot write; an Editor writes", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const viewer = ctxAs(seed.A.org, "viewer");
    const editor = ctxAs(seed.A.org, "editor");
    expect((await listForms(viewer)).length).toBeGreaterThan(0);
    expect((await getForm(viewer, form.id)).id).toBe(form.id);
    await expect(
      createForm(viewer, deps(), { template: "blank" }),
    ).rejects.toThrow(Forbidden);
    await expect(saveForm(viewer, deps(), { ...form })).rejects.toThrow(
      Forbidden,
    );
    await expect(duplicateForm(viewer, deps(), form.id)).rejects.toThrow(
      Forbidden,
    );
    await expect(deleteForm(viewer, deps(), form.id)).rejects.toThrow(
      Forbidden,
    );
    const { form: made } = await createForm(editor, deps(), {
      template: "feedback",
    });
    expect(made.template).toBe("feedback");
  });

  it("formUsedOn reports no placements for a new form; foreign is NotFound", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    expect(await formUsedOn(seed.ctxA, registry, form.id)).toEqual({
      pages: [],
      inVersions: false,
      inPopups: 0,
    });
    await expect(formUsedOn(seed.ctxB, registry, form.id)).rejects.toThrow(
      NotFound,
    );
  });
});

describe("public reads", () => {
  it("returns only this org's forms, projected; hidden fields removed", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    await saveForm(seed.ctxA, deps(), {
      ...form,
      fields: [
        ...form.fields,
        { id: "src", type: "hidden", label: "Source", value: "spring-ad" },
      ],
    });
    const siteA = await site("a.example.com");
    const out = await readPublicForms(siteA, [form.id, seed.B.form, "nope", 5]);
    expect(Object.keys(out)).toEqual([form.id]);
    const pub = out[form.id]!;
    expect(pub).not.toHaveProperty("notify_route");
    expect(pub).not.toHaveProperty("deleted_at");
    expect(pub.fields.some((f) => f.type === "hidden")).toBe(false);
    expect(JSON.stringify(pub)).not.toContain("spring-ad");
    expect(Object.keys(pub.after_submit).sort()).toEqual([
      "button_text",
      "kind",
      "message",
    ]);
  });

  it("a soft-deleted form is still returned", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    await softDeleteForm(form);
    const siteA = await site("a.example.com");
    expect(Object.keys(await readPublicForms(siteA, [form.id]))).toEqual([
      form.id,
    ]);
  });

  it("refuses an unminted site", async (t) => {
    if (!inst) return t.skip();
    await expect(
      readPublicForms(
        { orgId: seed.A.org, host: "a.example.com" } as unknown as SiteContext,
        [seed.A.form],
      ),
    ).rejects.toThrow(InvalidContext);
  });
});

describe("submit", () => {
  it("saves the message, audits it, touches Contacts and emails the route", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    const ip = nextIp();
    const res = await submitForm(
      siteA,
      form.id,
      contactPayload(form, { unknown_key: "dropped" }),
      { ip, pageId: seed.A.page },
      { transport },
    );
    expect(res.afterSubmit).toEqual({
      kind: "message",
      message: "Thanks. We'll get back to you soon.",
    });
    const row = await pb.collection("form_submissions").getOne(res.id);
    expect(row.organization).toBe(seed.A.org);
    expect(row.form).toBe(form.id);
    expect(row.form_name).toBe("Contact");
    expect(row.page).toBe(seed.A.page);
    expect(row.spam).toBe(false);
    expect(Object.keys(row.data as object).sort()).toEqual(
      [idOf(form, "name"), idOf(form, "email"), idOf(form, "long_text")].sort(),
    );
    expect(JSON.stringify(row.data)).not.toContain("dropped");
    expect((row.labels as Record<string, string>)[idOf(form, "email")]).toBe(
      "Email",
    );

    const audit = await pb
      .collection("audit_log")
      .getFirstListItem(pb.filter("target_id = {:id}", { id: res.id }));
    expect(audit.action).toBe("form.submitted");
    expect(audit.organization).toBe(seed.A.org);
    expect(audit.ip).toBe(ip);
    expect(audit.meta).toMatchObject({ form: form.id, spam: false });

    const contact = await pb.collection("contacts").getFirstListItem(
      pb.filter("organization = {:org} && email_norm = 'maria@example.com'", {
        org: seed.A.org,
      }),
    );
    expect(contact.name).toBe("Maria Lopez");
    expect(row.contact).toBe(contact.id);
    const events = await rows("contact_events", seed.A.org, " && ref = {:r}", {
      r: res.id,
    });
    expect(events.map((e) => [e.kind, e.summary])).toEqual([
      ["form", "Sent the Contact form"],
    ]);

    expect(transport.sent).toHaveLength(1);
    const mail = transport.sent[0]!;
    expect(mail.type).toBe("form.submission");
    expect(mail.to).toBe("owner-a@cds.test");
    expect(mail.replyTo).toBe("maria@example.com");
    expect(mail.text).toContain("Hello there");
  });

  it("merges by email with an existing contact", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    const res = await submitForm(
      siteA,
      form.id,
      contactPayload(form, { [idOf(form, "email")]: "Visitor-A@cds.test" }),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    const row = await pb.collection("form_submissions").getOne(res.id);
    expect(row.contact).toBe(seed.A.contact);
  });

  it("newsletter tick = unconfirmed consent only when the form has the checkbox", async (t) => {
    if (!inst) return t.skip();
    const siteA = await site("a.example.com");
    const on = await newContactForm();
    await saveForm(seed.ctxA, deps(), {
      ...on,
      newsletter_checkbox: true,
      newsletter_wording: "Yes, send me news.",
    });
    await submitForm(
      siteA,
      on.id,
      contactPayload(on, {
        [idOf(on, "email")]: "news-on@example.com",
        _newsletter: "on",
      }),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    const c1 = await pb.collection("contacts").getFirstListItem(
      pb.filter("organization = {:org} && email_norm = 'news-on@example.com'", {
        org: seed.A.org,
      }),
    );
    expect(c1.marketing_consent).toMatchObject({
      status: "unconfirmed",
      wording: "Yes, send me news.",
      form: on.id,
    });

    const off = await newContactForm();
    const res = await submitForm(
      siteA,
      off.id,
      contactPayload(off, {
        [idOf(off, "email")]: "news-off@example.com",
        _newsletter: "on",
      }),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    const c2 = await pb
      .collection("contacts")
      .getFirstListItem(
        pb.filter(
          "organization = {:org} && email_norm = 'news-off@example.com'",
          { org: seed.A.org },
        ),
      );
    expect((c2.marketing_consent as { status?: string }).status ?? "none").toBe(
      "none",
    );
    const row = await pb.collection("form_submissions").getOne(res.id);
    expect(row.data).not.toHaveProperty("_newsletter");
  });

  it("after send can go to a page", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    await saveForm(seed.ctxA, deps(), {
      ...form,
      after_submit: { kind: "page", page: seed.A.page },
    });
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      contactPayload(form),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    expect(res.afterSubmit).toEqual({ kind: "page", pageId: seed.A.page });
  });

  it("answers are validated with field-keyed errors and nothing is stored", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    const before = (await rows("form_submissions", seed.A.org)).length;
    const err = await submitForm(
      siteA,
      form.id,
      contactPayload(form, { [idOf(form, "email")]: "maria@" }),
      { ip: nextIp() },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FormErrors);
    expect((err as FormErrors).errors[idOf(form, "email")]).toBe(
      "Enter an email address, like name@example.com.",
    );
    expect((await rows("form_submissions", seed.A.org)).length).toBe(before);
  });

  it("refusals write nothing: too large, foreign, fake site, unknown, held", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    const siteB = await site("b.example.com");
    const before = (await rows("form_submissions", seed.A.org)).length;
    const big = await submitForm(
      siteA,
      form.id,
      contactPayload(form, {
        [idOf(form, "long_text")]: "x".repeat(65 * 1024),
      }),
      { ip: nextIp() },
    ).catch((e) => e);
    expect(big).toBeInstanceOf(InvalidInput);
    expect((big as InvalidInput).code).toBe("form_too_large");
    await expect(
      submitForm(siteB, form.id, contactPayload(form), { ip: nextIp() }),
    ).rejects.toThrow(NotFound);
    await expect(
      submitForm(
        { orgId: seed.A.org, host: "a.example.com" } as unknown as SiteContext,
        form.id,
        contactPayload(form),
        { ip: nextIp() },
      ),
    ).rejects.toThrow(InvalidContext);
    await expect(
      submitForm(siteA, "zzzzzzzzzzzzzzz", contactPayload(form), {
        ip: nextIp(),
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      submitForm(siteA, "../x", contactPayload(form), { ip: nextIp() }),
    ).rejects.toThrow(NotFound);
    const held = await newContactForm();
    await saveForm(seed.ctxA, heldDeps(), { ...held });
    await expect(
      submitForm(siteA, held.id, contactPayload(held), { ip: nextIp() }),
    ).rejects.toThrow(NotFound);
    expect((await rows("form_submissions", seed.A.org)).length).toBe(before);
  });

  it("a soft-deleted form still accepts messages (resolution f)", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    await softDeleteForm(form);
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      contactPayload(form),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    expect((await pb.collection("form_submissions").getOne(res.id)).form).toBe(
      form.id,
    );
  });
});

describe("spam", () => {
  const cases: [string, (p: Record<string, unknown>) => void][] = [
    ["honeypot", (p) => (p.website_url = "http://spam.example")],
    ["no start", (p) => delete p._started],
    ["too fast", (p) => (p._started = String(Date.now() - 1000))],
  ];
  for (const [label, tamper] of cases) {
    it(`${label}: stored as spam, same result, no contact, no email`, async (t) => {
      if (!inst) return t.skip();
      const form = await newContactForm();
      const email = `spam-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const transport = captureTransport();
      const payload = contactPayload(form, { [idOf(form, "email")]: email });
      tamper(payload);
      const res = await submitForm(
        await site("a.example.com"),
        form.id,
        payload,
        { ip: nextIp() },
        { transport },
      );
      expect(res.afterSubmit.kind).toBe("message");
      const row = await pb.collection("form_submissions").getOne(res.id);
      expect(row.spam).toBe(true);
      expect(row.contact).toBe("");
      expect(
        await rows("contacts", seed.A.org, " && email_norm = {:e}", {
          e: email,
        }),
      ).toHaveLength(0);
      expect(transport.sent).toHaveLength(0);
      const audit = await pb
        .collection("audit_log")
        .getFirstListItem(pb.filter("target_id = {:id}", { id: res.id }));
      expect(audit.meta).toMatchObject({ spam: true });
    });
  }
});

describe("limits", () => {
  it("the 6th send from one IP in 10 minutes is FORM-RATE and stores nothing", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      await submitForm(
        siteA,
        form.id,
        contactPayload(form),
        { ip },
        {
          transport: captureTransport(),
        },
      );
    }
    const before = (await rows("form_submissions", seed.A.org)).length;
    const err = await submitForm(siteA, form.id, contactPayload(form), {
      ip,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimited);
    expect((err as Error).message).toBe(FORM_RATE_COPY);
    expect((await rows("form_submissions", seed.A.org)).length).toBe(before);
    await expect(
      submitForm(
        siteA,
        form.id,
        contactPayload(form),
        { ip: nextIp() },
        {
          transport: captureTransport(),
        },
      ),
    ).resolves.toBeTruthy();
  });

  it("spam never burns the form-wide budget real visitors need (WR-A03)", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    // 12 sources x 5 spam sends = 60, over the 50-per-hour form budget.
    for (let s = 0; s < 12; s++) {
      const ip = nextIp();
      for (let i = 0; i < 5; i++) {
        const payload = contactPayload(form);
        payload.website_url = "http://spam.example";
        await submitForm(siteA, form.id, payload, { ip });
      }
    }
    const res = await submitForm(
      siteA,
      form.id,
      contactPayload(form),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    expect((await pb.collection("form_submissions").getOne(res.id)).spam).toBe(
      false,
    );
  });

  it("a send that fails validation gives its slots back", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      await expect(
        submitForm(
          siteA,
          form.id,
          contactPayload(form, { [idOf(form, "email")]: "bad" }),
          { ip },
        ),
      ).rejects.toThrow(FormErrors);
    }
    for (let i = 0; i < 5; i++) {
      await submitForm(
        siteA,
        form.id,
        contactPayload(form),
        { ip },
        {
          transport: captureTransport(),
        },
      );
    }
  });
});

describe("notify", () => {
  it("emails every confirmed address of the form's route, else the default", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const siteA = await site("a.example.com");
    const route = await pb.collection("org_email_routes").create({
      organization: seed.A.org,
      purpose: "billing",
      address: "billing-a@cds.test",
      confirmed_at: new Date().toISOString(),
    });
    await saveForm(seed.ctxA, deps(), { ...form, notify_route: "billing" });
    const transport = captureTransport();
    await submitForm(
      siteA,
      form.id,
      contactPayload(form),
      { ip: nextIp() },
      {
        transport,
      },
    );
    expect(transport.sent.map((m) => m.to)).toEqual(["billing-a@cds.test"]);
    await pb.collection("org_email_routes").delete(route.id);
  });

  it("a failing transport keeps the message and counts the failure", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const failing: EmailTransport = {
      send: () => Promise.reject(new Error("smtp down")),
    };
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      contactPayload(form),
      { ip: nextIp() },
      { transport: failing },
    );
    expect((await pb.collection("form_submissions").getOne(res.id)).spam).toBe(
      false,
    );
    expect(formsNotifyStats().failures24h).toBe(1);
  });

  it("a bad Reply-To is ignored (sender identity kept)", async (t) => {
    if (!inst) return t.skip();
    const { sendEmail } = await import("../src/email/send");
    const { mintSystemContext } = await import("../src/context");
    const transport = captureTransport();
    const data = {
      siteName: "A",
      formName: "Contact",
      pageTitle: null,
      answers: [],
      newsletter: null,
      replyable: true,
      inboxLink: "http://localhost:3000/hub/inbox",
      submittedAt: new Date(),
    };
    const as = {
      kind: "org" as const,
      ctx: mintSystemContext({ job: "test" }),
      orgId: seed.A.org,
    };
    await sendEmail(as, "form.submission", "owner-a@cds.test", data, {
      transport,
      replyTo: "Maria@Example.com",
    });
    await sendEmail(as, "form.submission", "owner-a@cds.test", data, {
      transport,
      replyTo: "bad\r\nBcc: x@y.z",
    });
    expect(transport.sent[0]!.replyTo).toBe("maria@example.com");
    expect(transport.sent[1]!.replyTo).toBe("owner-a@cds.test");
  });
});

describe("inbox", () => {
  it("lists messages newest first, searches, filters spam and counts", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm("Inbox form");
    const siteA = await site("a.example.com");
    const send = (over: Record<string, unknown>) =>
      submitForm(
        siteA,
        form.id,
        contactPayload(form, over),
        { ip: nextIp() },
        {
          transport: captureTransport(),
        },
      );
    const first = await send({
      [idOf(form, "long_text")]: "First pineapple note",
    });
    const second = await send({
      [idOf(form, "name")]: "Sam Lee",
      [idOf(form, "email")]: "sam@example.com",
      [idOf(form, "long_text")]: "x".repeat(200),
    });
    const spam = await send({ website_url: "http://bot" });

    const page = await listSubmissions(seed.ctxA, { form: form.id });
    expect(page.items.map((r) => r.id)).toEqual([second.id, first.id]);
    const row2 = page.items[0]!;
    expect(row2.from).toBe("Sam Lee");
    expect(row2.preview.length).toBeLessThanOrEqual(80);
    expect(row2.unread).toBe(true);
    expect(row2.formName).toBe("Inbox form");
    expect(row2.formDeleted).toBe(false);
    expect(page.items[1]!.from).toBe("Maria Lopez");

    const found = await listSubmissions(seed.ctxA, {
      form: form.id,
      q: "pineapple",
    });
    expect(found.items.map((r) => r.id)).toEqual([first.id]);

    const filtered = await listSubmissions(seed.ctxA, {
      form: form.id,
      view: "filtered",
    });
    expect(filtered.items.map((r) => r.id)).toEqual([spam.id]);

    const counts = await countSubmissions(seed.ctxA);
    expect(counts.unread).toBeGreaterThanOrEqual(2);
    expect(counts.filtered).toBeGreaterThanOrEqual(1);

    const listed = (await listForms(seed.ctxA)).find((f) => f.id === form.id);
    expect(listed?.unread).toBe(2);

    await expect(
      listSubmissions(seed.ctxA, { form: seed.B.form }),
    ).rejects.toThrow(NotFound);
  });

  it("reads a message in form order; read state needs only content read", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      contactPayload(form),
      { ip: nextIp(), pageId: seed.A.page },
      { transport: captureTransport() },
    );
    const viewer = ctxAs(seed.A.org, "viewer");
    const detail = await getSubmission(viewer, res.id);
    expect(detail.answers.map((a) => a.label)).toEqual([
      "Name",
      "Email",
      "Message",
    ]);
    expect(detail.email).toBe("maria@example.com");
    expect(detail.page?.id).toBe(seed.A.page);
    expect(detail.readAt).toBeNull();
    await setSubmissionRead(viewer, res.id, true);
    expect((await getSubmission(viewer, res.id)).readAt).not.toBeNull();
    await setSubmissionRead(viewer, res.id, false);
    expect((await getSubmission(viewer, res.id)).readAt).toBeNull();
    await expect(getSubmission(seed.ctxB, res.id)).rejects.toThrow(NotFound);
  });

  it("deletes with content write; a Viewer is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      contactPayload(form),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    const viewer = ctxAs(seed.A.org, "viewer");
    await expect(deleteSubmission(viewer, res.id)).rejects.toThrow(Forbidden);
    await deleteSubmission(ctxAs(seed.A.org, "editor"), res.id);
    await expect(
      pb.collection("form_submissions").getOne(res.id),
    ).rejects.toThrow();
  });
});

describe("not spam", () => {
  it("clears the flag and saves the contact with consent; no email", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    await saveForm(seed.ctxA, deps(), { ...form, newsletter_checkbox: true });
    const transport = captureTransport();
    const email = "was-spam@example.com";
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      contactPayload(form, {
        [idOf(form, "email")]: email,
        _newsletter: "on",
        _started: String(Date.now()),
      }),
      { ip: nextIp() },
      { transport },
    );
    expect((await pb.collection("form_submissions").getOne(res.id)).spam).toBe(
      true,
    );
    const viewer = ctxAs(seed.A.org, "viewer");
    await expect(markNotSpam(viewer, res.id)).rejects.toThrow(Forbidden);
    await markNotSpam(seed.ctxA, res.id);
    const row = await pb.collection("form_submissions").getOne(res.id);
    expect(row.spam).toBe(false);
    const contact = await pb.collection("contacts").getFirstListItem(
      pb.filter("organization = {:org} && email_norm = {:e}", {
        org: seed.A.org,
        e: email,
      }),
    );
    expect(row.contact).toBe(contact.id);
    expect(contact.marketing_consent).toMatchObject({
      status: "unconfirmed",
      form: form.id,
    });
    expect(transport.sent).toHaveLength(0);
  });

  it("an Editor clears the flag but never creates a contact (WR-A07)", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm();
    const email = "editor-unspam@example.com";
    const payload = contactPayload(form, { [idOf(form, "email")]: email });
    payload.website_url = "http://spam.example";
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      payload,
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    await markNotSpam(ctxAs(seed.A.org, "editor"), res.id);
    const row = await pb.collection("form_submissions").getOne(res.id);
    expect(row.spam).toBe(false);
    expect(row.contact).toBe("");
    expect(
      await rows("contacts", seed.A.org, " && email_norm = {:e}", { e: email }),
    ).toHaveLength(0);
  });
});

describe("csv", () => {
  it("exports non-spam messages with current fields, orphans and Newsletter", async (t) => {
    if (!inst) return t.skip();
    const form = await newContactForm("Quote Form!");
    const siteA = await site("a.example.com");
    await submitForm(
      siteA,
      form.id,
      contactPayload(form, { [idOf(form, "long_text")]: "=SUM(A1)" }),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    await submitForm(
      siteA,
      form.id,
      contactPayload(form, { website_url: "bot" }),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    // Replace the message field and drop phone: the old message answer becomes an orphan.
    const msgId = idOf(form, "long_text");
    const msgField = form.fields.find((f) => f.id === msgId)!;
    await saveForm(seed.ctxA, deps(), {
      ...form,
      newsletter_checkbox: true,
      fields: [
        ...form.fields.filter((f) => f.type !== "phone" && f.id !== msgId),
        { ...msgField, id: "new-msg", label: "Your note" },
      ],
    });
    await submitForm(
      siteA,
      form.id,
      {
        [idOf(form, "name")]: "Ann",
        [idOf(form, "email")]: "ann@example.com",
        "new-msg": "Hi",
        _newsletter: "on",
        _started: String(Date.now() - 10_000),
      },
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    const { filename, csv } = await exportSubmissionsCsv(seed.ctxA, form.id);
    expect(filename).toMatch(/^quote-form-messages-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Received,Name,Email,Your note,Message,Newsletter");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("'=SUM(A1)");
    expect(lines[2]).toMatch(/,Ann,ann@example\.com,Hi,,Agreed$/);
    await expect(exportSubmissionsCsv(seed.ctxB, form.id)).rejects.toThrow(
      NotFound,
    );
  });
});

describe("status", () => {
  it("formsStatus reports the stand-in as off", async (t) => {
    if (!inst) return t.skip();
    expect(await formsStatus()).toEqual({
      scanner: "unavailable",
      scanner_status: "off",
      notify_failures_24h: 0,
    });
  });
});
