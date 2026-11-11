// Forms Pro on the server (BILL-14, D233; 10-36; invariant 9; T-10-36-01..04): show/hide
// rules re-applied on submit, notification routed by answer, the submitter's auto-reply, and
// a lapsed Builder Pro falling back to a free form with the stored settings kept.
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { FormErrors, type FormField } from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import {
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { captureTransport } from "../src/email/transport";
import {
  createForm,
  getForm,
  readPublicForms,
  saveForm,
  submitForm,
  type FormRecord,
} from "../src/forms";
import { resetFormsNotifyStatsForTests } from "../src/forms/notify";
import { resetFormSubmitLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import type { OrgContext } from "../src/context";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
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
  return `10.9.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
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
  field("name", "name", "Name"),
  field("email", "email", "Email", { required: true }),
  field("service", "dropdown", "Service", {
    required: true,
    options: ["Portrait", "Wedding"],
  }),
  field("details", "long_text", "Wedding details", { required: true }),
];

const PRO = {
  rules: [
    {
      target: "details",
      action: "show",
      when: { field: "service", op: "is", value: "Wedding" },
    },
  ],
  steps: [],
  auto_reply: {
    enabled: true,
    subject: "Thanks, {name}",
    body: "Hi {name},\nWe got your message.",
  },
  routing: [{ field: "service", value: "Wedding", route: "inquiries" }],
  save_resume: true,
};

/** A Pro form saved while the org is entitled. */
async function proForm(ctx: OrgContext): Promise<FormRecord> {
  const { form } = await createForm(ctx, deps(), {
    template: "blank",
    name: "Booking enquiry",
  });
  const { form: saved } = await saveForm(ctx, deps(), {
    ...form,
    fields: FIELDS,
    notify_route: "default",
    pro: PRO,
  });
  return saved;
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Maria Lopez",
    email: "maria@example.com",
    service: "Portrait",
    website_url: "",
    _started: String(Date.now() - 10_000),
    ...over,
  };
}

async function setAddon(
  org: string,
  status: "active" | "disabled",
): Promise<void> {
  const existing = await pb
    .collection("org_addons")
    .getFirstListItem(
      pb.filter("organization = {:org} && addon = 'builder-pro'", { org }),
    )
    .catch(() => null);
  const body = {
    organization: org,
    addon: "builder-pro",
    status,
    disabled_reason: status === "disabled" ? "billing_lapse" : "",
    source: "billing",
    installed_version: "1.0.0",
    installed_at: new Date().toISOString(),
  };
  if (existing) await pb.collection("org_addons").update(existing.id, body);
  else await pb.collection("org_addons").create(body);
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // A: Studio (Builder Pro included at $0, 10-17). B: Standard, buys Builder Pro.
  await pb.collection("organizations").update(seed.A.org, { path: "studio" });
  await pb.collection("organizations").update(seed.B.org, { path: "standard" });
  await pb.collection("org_email_routes").create({
    organization: seed.A.org,
    purpose: "inquiries",
    address: "weddings-a@cds.test",
    confirmed_at: new Date().toISOString(),
  });
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
});

beforeEach(() => {
  resetFormSubmitLimitsForTests();
  resetFormsNotifyStatsForTests();
});

describe("Forms Pro active (Studio, Builder Pro included)", () => {
  it("stores the Pro settings on the form", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    expect(form.pro?.rules).toHaveLength(1);
    expect(form.pro?.auto_reply.enabled).toBe(true);
    const row = await pb.collection("forms").getOne(form.id);
    expect((row.pro as { save_resume: boolean }).save_resume).toBe(true);
  });

  it("a field hidden by a rule is not required and its answer is dropped", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const res = await submitForm(
      siteA,
      form.id,
      payload({ details: "smuggled" }),
      { ip: nextIp() },
      { transport: captureTransport() },
    );
    const row = await pb.collection("form_submissions").getOne(res.id);
    expect(Object.keys(row.data as object)).not.toContain("details");
    expect(JSON.stringify(row.data)).not.toContain("smuggled");

    const err = await submitForm(
      siteA,
      form.id,
      payload({ service: "Wedding" }),
      { ip: nextIp() },
      { transport: captureTransport() },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FormErrors);
    expect(Object.keys((err as FormErrors).errors)).toContain("details");
  });

  it("routes the notification by answer, else the form's route", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const wedding = captureTransport();
    await submitForm(
      siteA,
      form.id,
      payload({ service: "Wedding", details: "June, 80 guests" }),
      { ip: nextIp() },
      { transport: wedding },
    );
    expect(
      wedding.sent.filter((m) => m.type === "form.submission").map((m) => m.to),
    ).toEqual(["weddings-a@cds.test"]);

    const portrait = captureTransport();
    await submitForm(
      siteA,
      form.id,
      payload(),
      { ip: nextIp() },
      {
        transport: portrait,
      },
    );
    expect(
      portrait.sent
        .filter((m) => m.type === "form.submission")
        .map((m) => m.to),
    ).toEqual(["owner-a@cds.test"]);
  });

  it("sends one auto-reply to the submitter with {name} filled", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const transport = captureTransport();
    await submitForm(
      await site("a.example.com"),
      form.id,
      payload(),
      { ip: nextIp() },
      { transport },
    );
    const replies = transport.sent.filter((m) => m.type === "form.auto_reply");
    expect(replies).toHaveLength(1);
    const mail = replies[0]!;
    expect(mail.to).toBe("maria@example.com");
    // CR-B01: the subject never carries the visitor's text.
    expect(mail.subject).toBe("Thanks");
    expect(mail.text).toContain("Hi Maria Lopez,\nWe got your message.");
    expect(mail.text).toContain("you sent a form on Org A's website");
  });

  it("one auto-reply per address per form a day; the message is still kept (review CR-B01)", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const siteA = await site("a.example.com");
    const transport = captureTransport();
    const first = await submitForm(
      siteA,
      form.id,
      payload({ name: "Win cash at https://evil.example now" }),
      { ip: nextIp() },
      { transport },
    );
    const second = await submitForm(
      siteA,
      form.id,
      payload({ email: "MARIA@example.com" }),
      { ip: nextIp() },
      { transport },
    );
    const replies = transport.sent.filter((m) => m.type === "form.auto_reply");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.subject).toBe("Thanks");
    expect(replies[0]!.text).not.toContain("evil.example");
    expect(replies[0]!.text).not.toContain("http");
    expect(
      await pb.collection("form_submissions").getOne(second.id),
    ).toBeTruthy();
    expect(
      await pb.collection("form_submissions").getOne(first.id),
    ).toBeTruthy();
  });

  it("a spam-flagged submission gets no auto-reply", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const transport = captureTransport();
    const res = await submitForm(
      await site("a.example.com"),
      form.id,
      payload({ website_url: "http://spam.example" }),
      { ip: nextIp() },
      { transport },
    );
    expect((await pb.collection("form_submissions").getOne(res.id)).spam).toBe(
      true,
    );
    expect(transport.sent).toHaveLength(0);
  });

  it("the public form carries rules, steps and the save flag, never auto-reply or routing", async (t) => {
    if (!inst) return t.skip();
    const form = await proForm(seed.ctxA);
    const out = await readPublicForms(await site("a.example.com"), [form.id]);
    const pub = out[form.id]!;
    expect(pub.pro).toEqual({
      rules: PRO.rules,
      steps: [],
      save_resume: true,
    });
    const json = JSON.stringify(pub);
    expect(json).not.toContain("auto_reply");
    expect(json).not.toContain("routing");
    expect(json).not.toContain("We got your message");
  });
});

describe("Builder Pro lapsed (Standard)", () => {
  it("submits as a free form, keeps the stored settings, and restores on paying again", async (t) => {
    if (!inst) return t.skip();
    await setAddon(seed.B.org, "active");
    const form = await proForm(seed.ctxB);
    expect(form.pro?.routing).toHaveLength(1);
    await setAddon(seed.B.org, "disabled");
    const siteB = await site("b.example.com");

    // All required fields required: hidden-by-rule no longer applies.
    const err = await submitForm(
      siteB,
      form.id,
      payload(),
      { ip: nextIp() },
      { transport: captureTransport() },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FormErrors);
    expect(Object.keys((err as FormErrors).errors)).toContain("details");

    // Default route (no answer routing), no auto-reply.
    const transport = captureTransport();
    await submitForm(
      siteB,
      form.id,
      payload({ service: "Wedding", details: "June" }),
      { ip: nextIp() },
      { transport },
    );
    expect(transport.sent.map((m) => [m.type, m.to])).toEqual([
      ["form.submission", "owner-b@cds.test"],
    ]);

    // No Pro on the public form.
    const pub = (await readPublicForms(siteB, [form.id]))[form.id]!;
    expect(pub.pro ?? null).toBeNull();

    // Stored settings kept, and a lapsed save that leaves them alone keeps them.
    const stored = await getForm(seed.ctxB, form.id);
    expect(stored.pro).toEqual(form.pro);
    const { form: resaved } = await saveForm(seed.ctxB, deps(), {
      ...stored,
      name: "Booking enquiry (lapsed edit)",
    });
    expect(resaved.pro).toEqual(form.pro);

    // Paying again restores the behaviour.
    await setAddon(seed.B.org, "active");
    const back = captureTransport();
    await submitForm(
      siteB,
      form.id,
      payload(),
      { ip: nextIp() },
      {
        transport: back,
      },
    );
    expect(back.sent.map((m) => m.type).sort()).toEqual([
      "form.auto_reply",
      "form.submission",
    ]);
  });

  it("a lapsed org removing a field a rule names keeps its form and settings", async (t) => {
    if (!inst) return t.skip();
    await setAddon(seed.B.org, "active");
    const form = await proForm(seed.ctxB);
    await setAddon(seed.B.org, "disabled");
    const { form: edited } = await saveForm(seed.ctxB, deps(), {
      ...form,
      fields: form.fields.filter((f) => f.id !== "details"),
    });
    expect(edited.fields.map((f) => f.id)).toEqual([
      "name",
      "email",
      "service",
    ]);
    expect(edited.pro?.rules).toEqual(PRO.rules);
  });
});
