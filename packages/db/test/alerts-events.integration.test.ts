// 11-21: real events raise alerts (DASH-35; D285, D313). Each hook runs after its write
// committed and never fails the write (T-11-21-03). The billing (past_due) and Connect
// (restricted) hooks are asserted in billing-lapse and connect integration tests, which
// already drive those state machines.
import { randomBytes } from "node:crypto";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { listBell } from "../src/alerts/list";
import { raiseAlert } from "../src/alerts/raise";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator, type ContentDeps } from "../src/content/ports";
import { siteContextForHost } from "../src/content/site-context";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import { createForm, submitForm, type FormRecord } from "../src/forms";
import { setOrgStage } from "../src/org-stage";
import { resetFormSubmitLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import { bootPb, type PbInstance } from "./pb-harness";

// A pass-through spy, so one test can make raiseAlert itself throw.
vi.mock("../src/alerts/raise", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/alerts/raise")>();
  return { ...real, raiseAlert: vi.fn(real.raiseAlert) };
});

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let ipCounter = 0;

const tag = () => randomBytes(4).toString("hex");

function nextIp(): string {
  ipCounter += 1;
  return `10.9.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

function deps(): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
}

type Org = {
  org: string;
  host: string;
  owner: string;
  admin: string;
  editor: string;
  viewer: string;
  ctx: (user: string, role: OrgContext["role"]) => OrgContext;
};

async function newOrg(stage = "being_built"): Promise<Org> {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Events ${t}`,
      slug: `events-${t}`,
      status: "active",
      path: "standard",
      stage,
    })
  ).id;
  await pb.collection("business_profile").create({
    organization: org,
    time_zone: "America/Chicago",
    business_type: "bakery",
  });
  const host = `ev-${t}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: "custom",
    primary: true,
  });
  const member = async (role: string) => {
    const password = randomBytes(18).toString("hex");
    const id = (
      await pb.collection("users").create({
        email: `${role}-${tag()}@cds.test`,
        password,
        passwordConfirm: password,
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: id, organization: org, role });
    return id;
  };
  return {
    org,
    host,
    owner: await member("owner"),
    admin: await member("admin"),
    editor: await member("editor"),
    viewer: await member("viewer"),
    ctx: (user, role) =>
      mintOrgContext({
        orgId: org,
        actor: user,
        role,
        grants: [],
        ip: "1.1.1.1",
      }),
  };
}

async function alertRows(org: string, type: string) {
  return pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org} && type = {:type}", { org, type }),
    sort: "created",
  });
}

async function contactForm(o: Org): Promise<FormRecord> {
  const { form } = await createForm(o.ctx(o.owner, "owner"), deps(), {
    template: "contact",
  });
  return form;
}

function payload(
  form: FormRecord,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = (type: string) => {
    const f = form.fields.find((x) => x.type === type);
    if (!f) throw new Error(`no ${type} field`);
    return f.id;
  };
  return {
    [id("name")]: "Dana Lee",
    [id("email")]: `dana-${tag()}@example.com`,
    [id("long_text")]: "Do you deliver on Sundays?",
    website_url: "",
    _started: String(Date.now() - 10_000),
    ...over,
  };
}

async function submit(o: Org, form: FormRecord, body: Record<string, unknown>) {
  clearResolverCache();
  const site = await siteContextForHost(o.host);
  if (!site) throw new Error("no site");
  return submitForm(site, form.id, body, { ip: nextIp() });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
});

beforeEach(() => resetFormSubmitLimitsForTests());

describe("form.message", () => {
  it("a public form message alerts Owner and Admin with the inbox Needs-you key", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const form = await contactForm(o);
    const res = await submit(o, form, payload(form));

    const rows = await alertRows(o.org, "form.message");
    expect(rows.map((r) => r.user).sort()).toEqual([o.owner, o.admin].sort());
    for (const r of rows) {
      expect(r.source_key).toBe(`inbox:${res.id}`);
      expect(r.title).toBe("New message from Dana Lee");
      expect(r.safe_title).toBe("New message");
      expect(r.href).toBe(`/hub/inbox?tab=messages&message=${res.id}`);
      expect(r.section).toBe("inbox");
      // The form notification is the dedicated email; no generic alert email.
      expect(r.emailed_at).toBe("");
    }

    // The bell shows it to the Owner, unread, while the Needs-you key is present.
    const bell = await listBell(o.ctx(o.owner, "owner"), {
      needsYouKeys: [`inbox:${res.id}`],
    });
    expect(bell.map((b) => [b.type, b.read, b.cleared])).toContainEqual([
      "form.message",
      false,
      false,
    ]);
    // Editors see the message in Needs you only (D285 matrix, 11-20).
    expect(
      await listBell(o.ctx(o.editor, "editor"), {
        needsYouKeys: [`inbox:${res.id}`],
      }),
    ).toEqual([]);
  });

  it("spam is answered like a success and raises nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const form = await contactForm(o);
    await submit(
      o,
      form,
      payload(form, { website_url: "http://spam.example" }),
    );
    expect(await alertRows(o.org, "form.message")).toEqual([]);
    expect(await alertRows(o.org, "contact.new")).toEqual([]);
  });

  it("a throwing raiseAlert never fails the submission", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const form = await contactForm(o);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Both hooks of a submission (contact.new, then form.message) get a throwing raise.
    vi.mocked(raiseAlert)
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"));
    const res = await submit(o, form, payload(form));
    expect(res.id).toMatch(/^[a-z0-9]{15}$/);
    const saved = await pb.collection("form_submissions").getOne(res.id);
    expect(saved.organization).toBe(o.org);
    expect(err).toHaveBeenCalledWith("[contacts] alert failed");
    expect(err).toHaveBeenCalledWith("[forms] alert failed");
    err.mockRestore();
  });
});

describe("contact.new", () => {
  it("a new contact raises one summary alert; the same person again raises nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const form = await contactForm(o);
    const body = payload(form);
    await submit(o, form, body);
    await submit(o, form, { ...body, _started: String(Date.now() - 20_000) });

    const rows = await alertRows(o.org, "contact.new");
    expect(rows.map((r) => r.user).sort()).toEqual([o.owner, o.admin].sort());
    for (const r of rows) {
      expect(r.level).toBe("summary");
      expect(r.source_key).toMatch(/^contact:[a-z0-9]{15}$/);
      expect(r.title).toBe("New contact: Dana Lee");
      expect(r.href).toBe("/hub/marketing?tab=contacts");
      expect(r.push_state).toBe("skipped");
    }
  });
});

describe("site.stage", () => {
  it("ready_for_review and live alert Owner, Admin and Editor (Viewers: Summary only, 11-24)", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("being_built");
    const staffJob = mintSystemContext({ job: "test" });
    await setOrgStage(staffJob, o.org, "ready_for_review");
    let rows = await alertRows(o.org, "site.stage");
    expect(new Set(rows.map((r) => r.user))).toEqual(
      new Set([o.owner, o.admin, o.editor]),
    );
    expect(rows.every((r) => r.source_key === "stage:ready_for_review")).toBe(
      true,
    );
    expect(rows[0]?.title).toBe("Your site is ready for your review.");
    expect(rows[0]?.href).toBe("/hub/today");

    await setOrgStage(o.ctx(o.owner, "owner"), o.org, "live");
    rows = await alertRows(o.org, "site.stage");
    const live = rows.filter((r) => r.source_key === "stage:live");
    expect(live).toHaveLength(3);
    expect(live[0]?.title).toBe("Your site is live.");

    // A same-stage call changes nothing and raises nothing.
    await setOrgStage(staffJob, o.org, "live");
    expect(await alertRows(o.org, "site.stage")).toHaveLength(6);
  });

  it("earlier stages raise nothing", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("intake");
    await setOrgStage(mintSystemContext({ job: "test" }), o.org, "being_built");
    expect(await alertRows(o.org, "site.stage")).toEqual([]);
  });
});
