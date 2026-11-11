import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootPb, type PbInstance } from "./pb-harness";

// P2 schema proofs on the real binary: TEN-01 (collections exist, superuser only),
// TEN-05 (two auth collections, per-org end-user email), TEN-09 / D286 (one owned org per
// user, enforced by a partial unique index), plus the batch / rate-limit settings.
const P2_COLLECTIONS = [
  "organizations",
  "memberships",
  "org_hosts",
  "end_users",
  "audit_log",
  "users",
];

type Json = Record<string, unknown>;

let pb: PbInstance | null = null;
let token = "";

async function superuserToken(inst: PbInstance): Promise<string> {
  const res = await fetch(
    `${inst.url}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: inst.email, password: inst.password }),
    },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function api(
  inst: PbInstance,
  path: string,
  init: { method?: string; body?: unknown; auth?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.auth) headers.Authorization = init.auth;
  const res = await fetch(`${inst.url}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

// PB auth records always require a password, even with passwordAuth disabled (D53). End
// users never know it: the chokepoint sets a random, discarded one and signs in via OTP.
function endUser(email: string) {
  const password = randomBytes(18).toString("hex");
  return { email, password, passwordConfirm: password };
}

function create(collection: string, body: unknown) {
  return api(pb!, `/api/collections/${collection}/records`, {
    method: "POST",
    body,
    auth: token,
  });
}

describe("P2 schema (throwaway PocketBase)", () => {
  beforeAll(async () => {
    pb = await bootPb();
    if (pb) token = await superuserToken(pb);
  });

  afterAll(async () => {
    await pb?.stop();
  });

  it("boots healthy", async (ctx) => {
    if (!pb) return ctx.skip();
    const res = await fetch(`${pb.url}/api/health`);
    expect(res.status).toBe(200);
  });

  it("denies anonymous list on every P2 collection (all rules null)", async (ctx) => {
    if (!pb) return ctx.skip();
    for (const name of P2_COLLECTIONS) {
      const res = await api(pb, `/api/collections/${name}/records`);
      expect(res.status, `${name} anonymous list`).toBe(403);
      expect(res.body.items, `${name} leaked records`).toBeUndefined();
    }
  });

  it("enforces one owned org per user but allows staff grants elsewhere (TEN-09, D286)", async (ctx) => {
    if (!pb) return ctx.skip();
    const orgA = await create("organizations", {
      name: "Org A",
      slug: "org-a",
      status: "active",
    });
    const orgB = await create("organizations", {
      name: "Org B",
      slug: "org-b",
      status: "active",
    });
    expect(orgA.status).toBe(200);
    expect(orgB.status).toBe(200);

    const user = await create("users", {
      email: "owner@test.dev",
      password: "correct-horse-battery",
      passwordConfirm: "correct-horse-battery",
    });
    expect(user.status).toBe(200);

    const ownerA = await create("memberships", {
      user: user.body.id,
      organization: orgA.body.id,
      role: "owner",
    });
    expect(ownerA.status).toBe(200);

    const ownerB = await create("memberships", {
      user: user.body.id,
      organization: orgB.body.id,
      role: "owner",
    });
    expect(ownerB.status).toBe(400);
    expect(JSON.stringify(ownerB.body)).toContain("validation_not_unique");

    const staffB = await create("memberships", {
      user: user.body.id,
      organization: orgB.body.id,
      role: "staff",
    });
    expect(staffB.status).toBe(200);
  });

  it("scopes end-user email uniqueness per organization (TEN-05)", async (ctx) => {
    if (!pb) return ctx.skip();
    const orgA = await create("organizations", {
      name: "EU A",
      slug: "eu-a",
      status: "active",
    });
    const orgB = await create("organizations", {
      name: "EU B",
      slug: "eu-b",
      status: "active",
    });

    const inA = await create("end_users", {
      ...endUser("x@test.dev"),
      organization: orgA.body.id,
    });
    expect(inA.status, JSON.stringify(inA.body)).toBe(200);
    const inB = await create("end_users", {
      ...endUser("x@test.dev"),
      organization: orgB.body.id,
    });
    expect(inB.status).toBe(200);
    const dupA = await create("end_users", {
      ...endUser("x@test.dev"),
      organization: orgA.body.id,
    });
    expect(dupA.status).toBe(400);
  });

  it("gives users a staff_role select and MFA for staff", async (ctx) => {
    if (!pb) return ctx.skip();
    const res = await api(pb, "/api/collections/users", { auth: token });
    expect(res.status).toBe(200);
    const mfa = res.body.mfa as Json;
    expect(mfa.enabled).toBe(true);
    expect(mfa.rule).toBe("staff_role != ''");
    const otp = res.body.otp as Json;
    expect(otp.enabled).toBe(true);
    const fields = res.body.fields as Json[];
    const staffRole = fields.find((f) => f.name === "staff_role");
    expect(staffRole?.type).toBe("select");
    expect(staffRole?.values).toEqual(["super_admin", "support_agent"]);
    for (const rule of [
      "listRule",
      "viewRule",
      "createRule",
      "updateRule",
      "deleteRule",
    ]) {
      expect(res.body[rule], `users.${rule}`).toBeNull();
    }
  });

  it("harness default disables rate limits for functional tests", async (ctx) => {
    if (!pb) return ctx.skip();
    const res = await api(pb, "/api/settings", { auth: token });
    expect((res.body.rateLimits as Json).enabled).toBe(false);
  });
});

describe("WR-06 public end_users OTP endpoints are refused", () => {
  let inst: PbInstance | null = null;
  let su = "";
  const email = "otp-guard@cds.test";

  beforeAll(async () => {
    inst = await bootPb();
    if (!inst) return;
    su = await superuserToken(inst);
    const org = await api(inst, "/api/collections/organizations/records", {
      method: "POST",
      body: { name: "Org OTP", slug: "org-otp", status: "active" },
      auth: su,
    });
    expect(org.status).toBe(200);
    const eu = await api(inst, "/api/collections/end_users/records", {
      method: "POST",
      body: { ...endUser(email), organization: org.body.id },
      auth: su,
    });
    expect(eu.status).toBe(200);
  });

  afterAll(async () => {
    await inst?.stop();
  });

  it("a guest request-otp and auth-with-otp get 403", async (ctx) => {
    if (!inst) return ctx.skip();
    const req = await api(inst, "/api/collections/end_users/request-otp", {
      method: "POST",
      body: { email },
    });
    expect(req.status).toBe(403);
    const unknown = await api(inst, "/api/collections/end_users/request-otp", {
      method: "POST",
      body: { email: "nobody@cds.test" },
    });
    expect(unknown.status).toBe(403);
  });

  it("the superuser may request an OTP, but a guest cannot redeem it", async (ctx) => {
    if (!inst) return ctx.skip();
    const req = await api(inst, "/api/collections/end_users/request-otp", {
      method: "POST",
      body: { email },
      auth: su,
    });
    expect(req.status).toBe(200);
    const otpId = String(req.body.otpId);
    const re = new RegExp(`OTP_STANDIN end_users \\w+ ${otpId} (\\d{6})`);
    let code = "";
    for (let i = 0; i < 100 && !code; i++) {
      code = re.exec(inst.stdout())?.[1] ?? "";
      if (!code) await new Promise((r) => setTimeout(r, 50));
    }
    expect(code).toMatch(/^\d{6}$/);
    const auth = await api(inst, "/api/collections/end_users/auth-with-otp", {
      method: "POST",
      body: { otpId, password: code },
    });
    expect(auth.status).toBe(403);
    expect(auth.body.token).toBeUndefined();
  });
});

describe("P2 settings migration (rate limits kept)", () => {
  let limited: PbInstance | null = null;

  beforeAll(async () => {
    limited = await bootPb({ rateLimits: true });
  });

  afterAll(async () => {
    await limited?.stop();
  });

  it("enables batch and guest-only auth rate limits", async (ctx) => {
    if (!limited) return ctx.skip();
    const auth = await superuserToken(limited);
    const res = await api(limited, "/api/settings", { auth });
    expect(res.status).toBe(200);
    const batch = res.body.batch as Json;
    expect(batch.enabled).toBe(true);
    // 1790000310 raises 1000/30 to 5000/60 for 2,000-row CSV imports (05-03).
    expect(batch.maxRequests).toBe(5000);
    expect(batch.timeout).toBe(60);
    const rateLimits = res.body.rateLimits as {
      enabled: boolean;
      rules: {
        label: string;
        audience: string;
        duration: number;
        maxRequests: number;
      }[];
    };
    // Review iteration-2 WR-03: PB's guest auth rules are a platform-wide ceiling (one
    // bucket for all app-origin sign-ins); the per-client limit is the app's.
    for (const label of ["*:auth", "*:authWithOTP", "*:requestOTP"]) {
      const rule = rateLimits.rules.find(
        (r) => r.label === label && r.audience === "@guest",
      );
      expect(rule, label).toBeDefined();
      expect(rule!.duration, label).toBe(10);
      expect(rule!.maxRequests, label).toBe(60);
    }
    expect(rateLimits.enabled).toBe(true);
    expect(rateLimits.rules.length).toBeGreaterThan(0);
    for (const rule of rateLimits.rules) {
      expect(rule.audience, rule.label).toBe("@guest");
      expect(rule.label).toMatch(
        /(:(auth|requestOTP|authWithOTP)|^\*:create|^\/api\/)$/,
      );
    }
    // WR-01: PB's default guest limits stay on for direct public traffic.
    const labels = rateLimits.rules.map((r) => r.label);
    expect(labels).toContain("/api/");
    expect(labels).toContain("*:create");
  });
});

// P3 schema proofs (CONT-01, CONT-30, CONT-11, CONT-12, D248): five collections, all rules
// null, per-org unique slugs, hidden password_hash, required page relation, text
// section_type (invariant 5), one site_settings row per org.
const P3_COLLECTIONS = [
  "pages",
  "page_sections",
  "popups",
  "site_settings",
  "content_flags",
];

describe("P3 schema (throwaway PocketBase)", () => {
  let inst: PbInstance | null = null;
  let su = "";
  let orgA = "";
  let orgB = "";

  const post = (collection: string, body: unknown) =>
    api(inst!, `/api/collections/${collection}/records`, {
      method: "POST",
      body,
      auth: su,
    });

  const fieldsOf = async (name: string): Promise<Json[]> => {
    const res = await api(inst!, `/api/collections/${name}`, { auth: su });
    expect(res.status).toBe(200);
    return res.body.fields as Json[];
  };

  beforeAll(async () => {
    inst = await bootPb();
    if (!inst) return;
    su = await superuserToken(inst);
    const a = await post("organizations", {
      name: "P3 A",
      slug: "p3-a",
      status: "active",
    });
    const b = await post("organizations", {
      name: "P3 B",
      slug: "p3-b",
      status: "active",
    });
    orgA = String(a.body.id);
    orgB = String(b.body.id);
  });

  afterAll(async () => {
    await inst?.stop();
  });

  it("denies anonymous list on every P3 collection and every rule is null", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const name of P3_COLLECTIONS) {
      const res = await api(inst, `/api/collections/${name}/records`);
      expect(res.status, `${name} anonymous list`).toBe(403);
      expect(res.body.items, `${name} leaked records`).toBeUndefined();
      const col = await api(inst, `/api/collections/${name}`, { auth: su });
      expect(col.status, name).toBe(200);
      for (const rule of [
        "listRule",
        "viewRule",
        "createRule",
        "updateRule",
        "deleteRule",
      ]) {
        expect(col.body[rule], `${name}.${rule}`).toBeNull();
      }
    }
  });

  it("pages: slug unique per org, reusable across orgs, password_hash hidden", async (ctx) => {
    if (!inst) return ctx.skip();
    const page = {
      slug: "home",
      title: "Home",
      status: "draft",
      kind: "builder",
    };
    const first = await post("pages", { ...page, organization: orgA });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const dup = await post("pages", { ...page, organization: orgA });
    expect(dup.status).toBe(400);
    const other = await post("pages", { ...page, organization: orgB });
    expect(other.status).toBe(200);

    const fields = await fieldsOf("pages");
    const hash = fields.find((f) => f.name === "password_hash");
    expect(hash?.hidden).toBe(true);
    const status = fields.find((f) => f.name === "status");
    expect(status?.values).toEqual(["draft", "published", "held"]);
    const kind = fields.find((f) => f.name === "kind");
    // 07-01 (CONT-28) adds the one-per-org system-404 kind.
    expect(kind?.values).toEqual(["builder", "system-404"]);

    const withHash = await post("pages", {
      ...page,
      slug: "secret",
      organization: orgA,
      password_hash: "not-a-real-hash",
      password_protected: true,
    });
    // Superuser responses include hidden fields; exclusion from exports and filters is the
    // registry test (T-03-08). hidden=true keeps it out of any non-superuser response.
    expect(withHash.status).toBe(200);
  });

  it("page_sections: page is required, section_type is text, content/settings are json", async (ctx) => {
    if (!inst) return ctx.skip();
    const noPage = await post("page_sections", {
      organization: orgA,
      section_type: "text-only",
    });
    expect(noPage.status).toBe(400);

    const page = await post("pages", {
      organization: orgA,
      slug: "about",
      title: "About",
      status: "draft",
      kind: "builder",
    });
    const ok = await post("page_sections", {
      organization: orgA,
      page: page.body.id,
      page_slug: "about",
      section_type: "some-addon-type",
      row_layout: "full",
      content: { a: 1 },
      settings: {},
      sort_order: 1,
      is_published: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const fields = await fieldsOf("page_sections");
    const type = (n: string) => fields.find((f) => f.name === n)?.type;
    expect(type("section_type")).toBe("text");
    expect(type("content")).toBe("json");
    expect(type("settings")).toBe("json");
    expect(type("page")).toBe("relation");
    for (const donor of [
      "page_slug",
      "row_layout",
      "sort_order",
      "is_published",
      "legacy_id",
    ]) {
      expect(type(donor), donor).toBeDefined();
    }
  });

  it("site_settings: one row per organization", async (ctx) => {
    if (!inst) return ctx.skip();
    const one = await post("site_settings", {
      organization: orgA,
      banner: { enabled: false },
    });
    expect(one.status).toBe(200);
    const two = await post("site_settings", { organization: orgA, banner: {} });
    expect(two.status).toBe(400);
    const otherOrg = await post("site_settings", { organization: orgB });
    expect(otherOrg.status).toBe(200);
  });

  it("popups: trigger, frequency and show_on selects", async (ctx) => {
    if (!inst) return ctx.skip();
    const fields = await fieldsOf("popups");
    const values = (n: string) => fields.find((f) => f.name === n)?.values;
    expect(values("trigger")).toEqual([
      "click",
      "delay",
      "scroll",
      "exit-intent",
      "page-load",
    ]);
    expect(values("frequency")).toEqual([
      "every-visit",
      "once-per-session",
      "once-per-visitor",
    ]);
    expect(values("show_on")).toEqual([
      "button-only",
      "all-pages",
      "selected-pages",
    ]);
  });

  it("content_flags: text target_id, verdict and status selects", async (ctx) => {
    if (!inst) return ctx.skip();
    const fields = await fieldsOf("content_flags");
    const field = (n: string) => fields.find((f) => f.name === n);
    expect(field("target_id")?.type).toBe("text");
    expect(field("verdict")?.values).toEqual(["unsure", "held", "error"]);
    // 13-06 (874) adds `queued` for the D248 outage path.
    expect(field("status")?.values).toEqual(["open", "resolved", "queued"]);
  });
});

// P6 platform schema (ONB-06, ONB-08, ONB-12; CONTEXT A1-Q2, A2-Q1; PD-4, PD-5).
describe("P6 schema (throwaway PocketBase)", () => {
  let inst: PbInstance | null = null;
  let su = "";

  const fieldsOf = async (name: string): Promise<Json[]> => {
    const res = await api(inst!, `/api/collections/${name}`, { auth: su });
    expect(res.status).toBe(200);
    return res.body.fields as Json[];
  };

  beforeAll(async () => {
    inst = await bootPb();
    if (inst) su = await superuserToken(inst);
  });

  afterAll(async () => {
    await inst?.stop();
  });

  it("organizations has optional path and stage selects", async (ctx) => {
    if (!inst) return ctx.skip();
    const fields = await fieldsOf("organizations");
    const path = fields.find((f) => f.name === "path");
    const stage = fields.find((f) => f.name === "stage");
    expect(path?.values).toEqual(["standard", "studio", "shop"]);
    expect(path?.required).toBe(false);
    // being_built added by P8 migration 1790000650 (08-02); ready_for_review and live by
    // P11 migration 1790000820 (11-03).
    expect(stage?.values).toEqual([
      "intake",
      "fit_review",
      "ready_for_build",
      "being_built",
      "ready_for_review",
      "live",
    ]);
    expect(stage?.required).toBe(false);
    const org = await api(inst, "/api/collections/organizations/records", {
      method: "POST",
      body: { name: "No stage", slug: "no-stage", status: "active" },
      auth: su,
    });
    expect(org.status).toBe(200);
    expect(org.body.stage).toBe("");
  });

  it("quotes: platform collection, unique token_hash, merged_org, rules null", async (ctx) => {
    if (!inst) return ctx.skip();
    const col = await api(inst, "/api/collections/quotes", { auth: su });
    expect(col.status).toBe(200);
    const fields = col.body.fields as Json[];
    const names = fields.map((f) => f.name);
    expect(names).toContain("token_hash");
    expect(names).toContain("merged_org");
    expect(names).not.toContain("organization");
    for (const rule of [
      "listRule",
      "viewRule",
      "createRule",
      "updateRule",
      "deleteRule",
    ]) {
      expect(col.body[rule], `quotes.${rule}`).toBeNull();
    }
    const anon = await api(inst, "/api/collections/quotes/records");
    expect(anon.status).toBe(403);
    const body = { token_hash: "a".repeat(64), status: "draft" };
    const first = await api(inst, "/api/collections/quotes/records", {
      method: "POST",
      body,
      auth: su,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const dup = await api(inst, "/api/collections/quotes/records", {
      method: "POST",
      body,
      auth: su,
    });
    expect(dup.status).toBe(400);
  });

  it("price_catalog is seeded with the 18 P6 rows plus the 17 P10 rows", async (ctx) => {
    if (!inst) return ctx.skip();
    const anon = await api(inst, "/api/collections/price_catalog/records");
    expect(anon.status).toBe(403);
    const res = await api(
      inst,
      "/api/collections/price_catalog/records?perPage=100",
      { auth: su },
    );
    expect(res.status).toBe(200);
    const rows = res.body.items as Json[];
    expect(rows).toHaveLength(35);
    const find = (kind: string, key: string, path: string) =>
      rows.find(
        (r) => r.item_kind === kind && r.item_key === key && r.path === path,
      );
    // P10 (10-11, BILL-10, BILL-13, BILL-14, BILL-18).
    for (const path of ["standard", "studio"]) {
      expect(find("pack", "media-5gb", path)).toMatchObject({
        monthly_cents: 500,
        priced: true,
      });
      expect(find("pack", "media-25gb", path)).toMatchObject({
        monthly_cents: 1500,
        priced: true,
      });
      expect(find("pack", "pages-5", path)).toMatchObject({
        monthly_cents: 1000,
        priced: true,
      });
      expect(find("service", "polish-hour", path)?.priced).toBe(false);
      expect(find("setup_fee", "addon", path)).toMatchObject({
        one_time_cents: 2500,
        priced: true,
      });
    }
    expect(find("addon", "builder-pro", "standard")).toMatchObject({
      monthly_cents: 1200,
      priced: true,
    });
    expect(find("addon", "builder-pro", "studio")).toMatchObject({
      monthly_cents: 0,
      priced: true,
    });
    expect(find("addon", "studio-booking-solo", "studio")).toMatchObject({
      monthly_cents: 4900,
      priced: true,
    });
    expect(find("addon", "studio-booking-team", "studio")).toMatchObject({
      monthly_cents: 9900,
      priced: true,
    });
    expect(find("addon", "studio-booking-large-team", "studio")).toMatchObject({
      monthly_cents: 17900,
      priced: true,
    });
    expect(
      rows.some(
        (r) =>
          String(r.item_key).startsWith("studio-booking") &&
          r.path !== "studio",
      ),
    ).toBe(false);
    for (const key of ["newsletter", "landing-pages"]) {
      // WR-A02: seeded $0 but inactive until the add-on package ships.
      expect(find("addon", key, "studio")).toMatchObject({
        monthly_cents: 0,
        priced: true,
        active: false,
      });
    }
    for (const r of rows) {
      expect(r.stripe_product).toBe("");
      expect(r.stripe_price_monthly).toBe("");
      expect(r.stripe_price_yearly).toBe("");
      expect(r.stripe_price_once).toBe("");
    }
    expect(find("plan", "base", "standard")).toMatchObject({
      monthly_cents: 3900,
      priced: true,
    });
    expect(find("plan", "base", "studio")).toMatchObject({
      monthly_cents: 4900,
      priced: true,
    });
    expect(find("build_fee", "base", "standard")).toMatchObject({
      one_time_cents: 150000,
      installments: 6,
      priced: true,
    });
    expect(find("build_fee", "base", "studio")).toMatchObject({
      one_time_cents: 350000,
      installments: 6,
      priced: true,
    });
    for (const path of ["standard", "studio"]) {
      expect(find("care_plan", "care", path)).toMatchObject({
        monthly_cents: 9900,
        priced: true,
      });
      for (const key of ["testimonials", "credentials"]) {
        expect(find("addon", key, path)?.priced, key).toBe(false);
      }
      for (const key of [
        "copywriting",
        "logo-design",
        "sourced-photos",
        "rush-launch",
      ]) {
        expect(find("extra", key, path)?.priced, key).toBe(false);
      }
    }
    expect(
      rows
        .filter(
          (r) =>
            !(
              r.item_kind === "addon" &&
              r.path === "studio" &&
              ["newsletter", "landing-pages"].includes(String(r.item_key))
            ),
        )
        .every((r) => r.active === true),
    ).toBe(true);
    const dup = await api(inst, "/api/collections/price_catalog/records", {
      method: "POST",
      body: { item_kind: "plan", item_key: "base", path: "standard" },
      auth: su,
    });
    expect(dup.status).toBe(400);
  });

  it("users OTP email says 'Your sign-in code' and 5 minutes", async (ctx) => {
    if (!inst) return ctx.skip();
    const res = await api(inst, "/api/collections/users", { auth: su });
    const otp = res.body.otp as Json;
    const template = otp.emailTemplate as { subject: string; body: string };
    expect(template.subject).toBe("Your sign-in code");
    expect(template.body).toContain("{OTP}");
    expect(template.body).toContain("It expires in 5 minutes.");
    expect(template.body).not.toMatch(/<img/i);
    expect(otp.duration).toBe(300);
  });
});
