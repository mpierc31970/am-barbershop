// Add-on intake, the still-needed snapshot, the P8 assembly contract and Send to CDS on the
// real PocketBase 0.39.11 binary (ONB-01, ONB-02, ONB-03; CONTEXT A3-Q3..Q5; invariant 3;
// TEN-15; T-06-60, T-06-61).
// Registers add-on collections before anything reads the composed registry (05-04).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, ImpersonationDenied, InvalidInput } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import { MAX_IMPORT_ROWS } from "@cds/core/csv";
import { AUP_TEST_TERMS } from "@cds/core/onboarding";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { removeMedia, restoreMedia } from "../src/media";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  ALREADY_SENT_COPY,
  commitAddonIntakeImport,
  getIntakeForAssembly,
  getIntakeSnapshot,
  IntakeIncomplete,
  listTeam,
  previewAddonIntakeImport,
  ADDON_INTAKE_COPY,
  removeAddonIntakeRecord,
  saveAddonIntakeFields,
  saveAddonIntakeRecord,
  saveService,
  sendToCds,
} from "../src/intake";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const HEADER =
  "Quote,Name,About them,Rating,Photo link,Photo description,Featured,Show on site";
const csv = (...rows: string[]) => `${HEADER}\r\n${rows.join("\r\n")}\r\n`;

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

/** The real registry, with a Google-reviews-link intake field on Testimonials. */
function fieldsRegistry(): AddonRegistry {
  const real = ADDON_REGISTRY.get("testimonials")!;
  const withFields = {
    ...real,
    intake: {
      ...real.intake,
      fields: [
        {
          id: "google_url",
          label: "Google reviews link",
          kind: "url" as const,
          helper: "Where customers review you.",
          fallback: "Leave empty and we won't link to your reviews.",
        },
        {
          id: "show_stars",
          label: "Show star ratings",
          kind: "switch" as const,
          helper: "",
          fallback: "Leave off and stars stay hidden.",
        },
      ],
    },
  };
  return {
    list: () => ADDON_REGISTRY.list(),
    publicList: () => ADDON_REGISTRY.publicList(),
    get: (slug) =>
      slug === "testimonials" ? withFields : ADDON_REGISTRY.get(slug),
    sections: () => ADDON_REGISTRY.sections(),
    ownerOf: (t) => ADDON_REGISTRY.ownerOf(t),
    dependentsOf: (s) => ADDON_REGISTRY.dependentsOf(s),
    conflictsOf: (s) => ADDON_REGISTRY.conflictsOf(s),
  };
}

function ctxAs(
  orgId: string,
  role: OrgContext["role"],
  impersonator?: string,
): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
    ...(impersonator ? { impersonator } : {}),
  });
}

/** An org as Submit leaves it (+ optional time zone / stage / add-ons). */
async function submittedOrg(
  opts: {
    timeZone?: string;
    stage?: "intake" | "fit_review";
    addons?: string[];
    name?: string;
  } = {},
): Promise<{ org: string; ctx: OrgContext }> {
  const org = (
    await pb.collection("organizations").create({
      name: opts.name ?? "Rivera Therapy",
      slug: `ia-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
      path: "standard",
      stage: opts.stage ?? "intake",
    })
  ).id;
  await pb.collection("business_profile").create({
    organization: org,
    business_type: "therapist",
    description: "Therapy in Austin.",
    public_email: "maria@gmail.com",
    ...(opts.timeZone ? { time_zone: opts.timeZone } : {}),
  });
  await pb.collection("org_intake").create({
    organization: org,
    selections: {
      addons: opts.addons ?? ["testimonials"],
      extras: [],
      carePlan: false,
      cadence: "monthly",
    },
  });
  await pb.collection("org_email_routes").create({
    organization: org,
    purpose: "default",
    address: "maria@gmail.com",
    confirmed_at: new Date().toISOString(),
  });
  return { org, ctx: ctxAs(org, "owner") };
}

async function testimonialRows(org: string): Promise<number> {
  return (
    await pb.collection("testimonials").getFullList({
      filter: pb.filter("organization = {:o}", { o: org }),
    })
  ).length;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
});

describe("add-on intake (CONTEXT A3-Q5, invariant 3)", () => {
  it("an import holds 3 validated records on org_intake; the add-on collection stays empty", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg();
    const text = csv(
      "Kind and clear.,Ana,Client,5,,,yes,yes",
      "Changed my week.,Ben,,4,,,no,yes",
      "Highly recommend.,Cy,,,,,,",
    );
    const preview = await previewAddonIntakeImport(
      ctx,
      ADDON_REGISTRY,
      "testimonials",
      text,
    );
    expect(preview.counts.new).toBe(3);
    expect(
      await commitAddonIntakeImport(
        ctx,
        ADDON_REGISTRY,
        "testimonials",
        text,
        "add",
      ),
    ).toEqual({ count: 3 });
    const row = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    const records = row.addon_config.testimonials.records as Record<
      string,
      unknown
    >[];
    expect(records.map((r) => r.author_name)).toEqual(["Ana", "Ben", "Cy"]);
    expect(records[0]!.rating).toBe(5);
    expect(await testimonialRows(org)).toBe(0);
    // Same file again in add mode: matched by natural key, nothing new.
    expect(
      await commitAddonIntakeImport(
        ctx,
        ADDON_REGISTRY,
        "testimonials",
        text,
        "add",
      ),
    ).toEqual({ count: 3 });
    // Replace all keeps only the file.
    expect(
      await commitAddonIntakeImport(
        ctx,
        ADDON_REGISTRY,
        "testimonials",
        csv("Only this one.,Dee,,,,,,"),
        "replace",
      ),
    ).toEqual({ count: 1 });
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'addon_intake.import'",
        {
          o: org,
        },
      ),
    });
    expect(audits).toHaveLength(3);
  });

  it("refuses an add-on not in the selections, an unknown slug, and a row with an error", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await submittedOrg({ addons: [] });
    await expect(
      commitAddonIntakeImport(
        ctx,
        ADDON_REGISTRY,
        "testimonials",
        csv("Nice.,Ana,,,,,,"),
        "add",
      ),
    ).rejects.toThrow("Add Testimonials to your quote first.");
    await expect(
      saveAddonIntakeRecord(ctx, ADDON_REGISTRY, "nope", { quote: "x" }),
    ).rejects.toThrow(InvalidInput);
    const own = await submittedOrg();
    await expect(
      commitAddonIntakeImport(
        own.ctx,
        ADDON_REGISTRY,
        "testimonials",
        csv("Nice.,Ana,,9,,,,"),
        "add",
      ),
    ).rejects.toThrow(InvalidInput);
  });

  it("refuses more than MAX_IMPORT_ROWS rows", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await submittedOrg();
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `Quote ${i},Name ${i},,,,,,`,
    );
    await expect(
      commitAddonIntakeImport(
        ctx,
        ADDON_REGISTRY,
        "testimonials",
        csv(...rows),
        "add",
      ),
    ).rejects.toThrow(InvalidInput);
  });

  it("saves, edits and removes one record at a time through the add-on's validator", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg();
    const r = ADDON_REGISTRY;
    const ana = await saveAddonIntakeRecord(ctx, r, "testimonials", {
      quote: "Great.",
      author_name: "Ana",
    });
    expect(ana.count).toBe(1);
    const ben = await saveAddonIntakeRecord(ctx, r, "testimonials", {
      quote: "Also great.",
      author_name: "Ben",
    });
    expect(ben.count).toBe(2);
    expect(ben.key).not.toBe(ana.key);
    await saveAddonIntakeRecord(
      ctx,
      r,
      "testimonials",
      { quote: "Edited.", author_name: "Ana" },
      ana.key,
    );
    await expect(
      saveAddonIntakeRecord(ctx, r, "testimonials", { quote: "No name" }),
    ).rejects.toThrow("Name is empty. Add who said it.");
    await expect(
      saveAddonIntakeRecord(
        ctx,
        r,
        "testimonials",
        { quote: "x", author_name: "y" },
        "not-a-key",
      ),
    ).rejects.toThrow(InvalidInput);
    expect(
      await removeAddonIntakeRecord(ctx, r, "testimonials", ben.key),
    ).toEqual({ count: 1, index: 1 });
    const snap = await getIntakeSnapshot(ctx);
    expect(snap.addonIntake.testimonials?.records).toBe(1);
    const a = await getIntakeForAssembly(ctx, r);
    expect(a.addonConfig.testimonials!.records[0]!.quote).toBe("Edited.");
    // The held rows are exactly the validator's output: the key lives beside them.
    expect(Object.keys(a.addonConfig.testimonials!.records[0]!)).not.toContain(
      "key",
    );
    expect(await testimonialRows(org)).toBe(0);
  });

  it("B-WR-08: a stale list never edits or removes the wrong row", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await submittedOrg();
    const r = ADDON_REGISTRY;
    const add = (name: string, at?: number) =>
      saveAddonIntakeRecord(
        ctx,
        r,
        "testimonials",
        { quote: `From ${name}.`, author_name: name },
        undefined,
        at,
      );
    const a = await add("Ana");
    const b = await add("Ben");
    const c = await add("Cy");
    // Another tab removes Ana; this tab's list still shows Ana, Ben, Cy.
    await removeAddonIntakeRecord(ctx, r, "testimonials", a.key);
    // A second remove of Ana is refused instead of taking Ben.
    await expect(
      removeAddonIntakeRecord(ctx, r, "testimonials", a.key),
    ).rejects.toThrow(ADDON_INTAKE_COPY.index);
    // Editing Cy edits Cy, although Cy moved from position 2 to 1.
    await saveAddonIntakeRecord(
      ctx,
      r,
      "testimonials",
      { quote: "Cy, edited.", author_name: "Cy" },
      c.key,
    );
    // Undo puts a row back where it was.
    const back = await add("Ana", 0);
    const held = (await getIntakeForAssembly(ctx, r)).addonConfig.testimonials!;
    expect(held.records.map((x) => x.author_name)).toEqual([
      "Ana",
      "Ben",
      "Cy",
    ]);
    expect(held.records[2]!.quote).toBe("Cy, edited.");
    expect(held.keys).toEqual([back.key, b.key, c.key]);
  });

  it("B-WR-08: an import keeps the keys of rows it matches and keys the new ones", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await submittedOrg();
    const r = ADDON_REGISTRY;
    const ana = await saveAddonIntakeRecord(ctx, r, "testimonials", {
      quote: "Great.",
      author_name: "Ana",
    });
    const before = (await getIntakeForAssembly(ctx, r)).addonConfig
      .testimonials!;
    await commitAddonIntakeImport(
      ctx,
      r,
      "testimonials",
      csv("Great.,Ana,,,,,,", "New one.,Dee,,,,,,"),
      "add",
    );
    const after = (await getIntakeForAssembly(ctx, r)).addonConfig
      .testimonials!;
    expect(after.records.map((x) => x.author_name)).toEqual(["Ana", "Dee"]);
    expect(after.keys).toHaveLength(after.records.length);
    expect(after.keys![0]).toBe(ana.key);
    expect(before.keys).toEqual([ana.key]);
    expect(new Set(after.keys).size).toBe(after.keys!.length);
  });

  it("saves declared add-on fields only, validated by kind", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await submittedOrg();
    const r = fieldsRegistry();
    await saveAddonIntakeFields(ctx, r, "testimonials", {
      google_url: " https://g.page/rivera ",
      show_stars: true,
      evil: "dropped",
    });
    await expect(
      saveAddonIntakeFields(ctx, r, "testimonials", {
        google_url: "javascript:alert(1)",
      }),
    ).rejects.toThrow(
      "Google reviews link must start with https:// or http://.",
    );
    await expect(
      saveAddonIntakeFields(ctx, r, "testimonials", { show_stars: "yes" }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      saveAddonIntakeFields(ctx, ADDON_REGISTRY, "testimonials", {
        google_url: "https://x.test",
      }),
    ).rejects.toThrow(InvalidInput);
    const snap = await getIntakeSnapshot(ctx);
    expect(snap.addonIntake.testimonials?.fields).toEqual({
      google_url: "https://g.page/rivera",
      show_stars: true,
    });
    const a = await getIntakeForAssembly(ctx, r);
    expect(a.fields.addon_testimonials_google_url).toEqual({
      value: "https://g.page/rivera",
      source: "provided",
    });
    expect(a.fields.addon_testimonials_records?.source).toBe("fallback");
  });

  it("an Editor cannot write add-on intake", async (t) => {
    if (!inst) return t.skip();
    const { org } = await submittedOrg();
    await expect(
      saveAddonIntakeRecord(
        ctxAs(org, "editor"),
        ADDON_REGISTRY,
        "testimonials",
        { quote: "x", author_name: "y" },
      ),
    ).rejects.toThrow(Forbidden);
  });
});

describe("getIntakeSnapshot (ONB-02)", () => {
  it("a fresh Submit org: name, path, public email, confirmed default, zero counts", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await submittedOrg({ name: "Fresh Co" });
    const s = await getIntakeSnapshot(ctx);
    expect(s.orgName).toBe("Fresh Co");
    expect(s.path).toBe("standard");
    expect(s.profile.public_email).toBe("maria@gmail.com");
    expect(s.profile).not.toHaveProperty("id");
    expect(s.email).toEqual({ defaultConfirmed: true, bouncing: 0 });
    expect(s.counts).toEqual({
      services: 0,
      team: 0,
      gallery: 0,
      moodboard: 0,
    });
    expect(s.media).toEqual({ logo: false, hero: false, photosMissingAlt: 0 });
    expect(s.stagesSaved).toEqual([]);
    expect(s.selections.addons).toEqual(["testimonials"]);
  });

  it("counts live media and photos missing a description; ignores removed rows", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg();
    const media = (kind: string, alt: string, removed = false) =>
      pb.collection("media_assets").create({
        organization: org,
        kind,
        storage_dir: `tenants/${org}/media/${Math.random().toString(36).slice(2)}`,
        original_ext: "jpg",
        alt,
        ...(removed ? { removed_at: new Date().toISOString() } : {}),
      });
    await media("logo", "Rivera");
    await media("gallery", "");
    await media("gallery", "Room");
    await media("gallery", "", true);
    await media("hero", "");
    await media("moodboard", "");
    const s = await getIntakeSnapshot(ctx);
    expect(s.media).toEqual({ logo: true, hero: true, photosMissingAlt: 2 });
    expect(s.counts.gallery).toBe(2);
    expect(s.counts.moodboard).toBe(1);
  });
});

describe("removed team photos (A-WR-06)", () => {
  it("a removed team photo unlinks from the member everywhere; Undo relinks it", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg();
    const photo = await pb.collection("media_assets").create({
      organization: org,
      kind: "team",
      storage_dir: `tenants/${org}/media/${Math.random().toString(36).slice(2)}`,
      original_ext: "jpg",
      alt: "",
    });
    await pb.collection("team_members").create({
      organization: org,
      name: "Ana",
      photo: photo.id,
      is_published: true,
    });
    expect((await getIntakeSnapshot(ctx)).media.photosMissingAlt).toBe(1);
    await removeMedia(ctx, photo.id);
    const a = await getIntakeForAssembly(ctx, ADDON_REGISTRY);
    expect(a.team.map((m) => m.photoId)).toEqual([null]);
    expect((await listTeam(ctx)).map((m) => m.photoId)).toEqual([null]);
    expect((await getIntakeSnapshot(ctx)).media.photosMissingAlt).toBe(0);
    await restoreMedia(ctx, photo.id);
    expect((await listTeam(ctx)).map((m) => m.photoId)).toEqual([photo.id]);
    expect((await getIntakeSnapshot(ctx)).media.photosMissingAlt).toBe(1);
  });
});

describe("getIntakeForAssembly (ONB-03, the P8 contract)", () => {
  it("a minimal org: fallbacks applied and marked, provided values marked", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ name: "Rivera Therapy" });
    await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }))
      .then((row) =>
        pb.collection("business_profile").update(row.id, {
          address: { street: "", city: "Austin", state: "TX", zip: "" },
        }),
      );
    const a = await getIntakeForAssembly(ctx, ADDON_REGISTRY);
    expect(a.orgId).toBe(org);
    expect(a.path).toBe("standard");
    expect(a.fields.org_name).toEqual({
      value: "Rivera Therapy",
      source: "provided",
    });
    expect(a.fields.logo).toEqual({
      value: "Rivera Therapy",
      source: "fallback",
    });
    expect(a.fields.about).toEqual({
      value: "Rivera Therapy is a therapy practice in Austin.",
      source: "fallback",
    });
    expect(a.fields.hours).toEqual({
      value: "Contact us for hours",
      source: "fallback",
    });
    expect(a.fields.privacy_contact).toEqual({
      value: "maria@gmail.com",
      source: "fallback",
    });
    expect(a.fields.legal_region).toEqual({ value: "TX", source: "fallback" });
    expect(a.fields.team).toEqual({ value: null, source: "fallback" });
    expect(a.fields.time_zone).toEqual({ value: null, source: "fallback" });
    expect(a.fields.addon_testimonials_records).toEqual({
      value: null,
      source: "fallback",
    });
    expect(a.media).toEqual({ logo: null, hero: null, gallery: [] });
    expect(a.team).toEqual([]);
    expect(a.services).toEqual([]);
  });

  it("a fuller org gets its provided values back", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ timeZone: "America/Chicago" });
    const row = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    await pb.collection("business_profile").update(row.id, {
      about: "We listen.",
      tagline: "Calm, clear help",
      legal_name: "Rivera Therapy LLC",
    });
    await saveService(ctx, { name: "Intake session", price_display: "free" });
    await saveAddonIntakeRecord(ctx, ADDON_REGISTRY, "testimonials", {
      quote: "Great.",
      author_name: "Ana",
    });
    const a = await getIntakeForAssembly(ctx, ADDON_REGISTRY);
    expect(a.fields.about).toEqual({ value: "We listen.", source: "provided" });
    expect(a.fields.tagline).toEqual({
      value: "Calm, clear help",
      source: "provided",
    });
    expect(a.fields.legal_name).toEqual({
      value: "Rivera Therapy LLC",
      source: "provided",
    });
    expect(a.fields.time_zone).toEqual({
      value: "America/Chicago",
      source: "provided",
    });
    expect(a.fields.contact_method).toEqual({
      value: { phone: "", email: "maria@gmail.com" },
      source: "provided",
    });
    expect(a.fields.email_delivery).toEqual({
      value: "maria@gmail.com",
      source: "provided",
    });
    expect(a.services.map((s) => s.name)).toEqual(["Intake session"]);
    expect(a.fields.services?.source).toBe("provided");
    const held = a.fields.addon_testimonials_records!;
    expect(held.source).toBe("provided");
    expect((held.value as { author_name: string }[])[0]!.author_name).toBe(
      "Ana",
    );
  });

  it("media refs carry the intake alt and alt_reviewed; removed and other-org assets never appear (08-01, A4-Q2, T-08-01-04)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ name: "Rivera Bakery" });
    const other = await submittedOrg({ name: "Other Co" });
    const media = (
      owner: string,
      kind: string,
      alt: string,
      sort: number,
      removed = false,
    ) =>
      pb.collection("media_assets").create({
        organization: owner,
        kind,
        storage_dir: `tenants/${owner}/media/${Math.random().toString(36).slice(2)}`,
        original_ext: "jpg",
        alt,
        sort_order: sort,
        ...(removed ? { removed_at: new Date().toISOString() } : {}),
      });
    const hero = await media(org, "hero", "Fresh loaves", 0);
    const g1 = await media(org, "gallery", "Counter", 1);
    const g2 = await media(org, "gallery", "", 2);
    const gone = await media(org, "gallery", "Old oven", 3, true);
    const foreign = await media(other.org, "gallery", "Not yours", 0);
    await media(other.org, "hero", "Other hero", 0);

    const a = await getIntakeForAssembly(ctx, ADDON_REGISTRY);
    expect(a.media.hero).toEqual({
      id: hero.id,
      alt: "Fresh loaves",
      alt_reviewed: true,
    });
    expect(a.media.logo).toBeNull();
    expect(a.media.gallery).toEqual([
      { id: g1.id, alt: "Counter", alt_reviewed: true },
      { id: g2.id, alt: "", alt_reviewed: false },
    ]);
    const ids = JSON.stringify(a);
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(foreign.id);
    expect(ids).not.toContain("Not yours");
    expect(ids).not.toContain("Other hero");
  });
});

describe("sendToCds (CONTEXT A3-Q4)", () => {
  it("owner with required items present: submitted_at set, stage ready_for_build, audited", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ timeZone: "America/Chicago" });
    const out = await sendToCds(ctx, ADDON_REGISTRY);
    expect(out.stage).toBe("ready_for_build");
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(intake.submitted_at).not.toBe("");
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "ready_for_build",
    );
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'intake.send'", {
        o: org,
      }),
    });
    expect(audits).toHaveLength(1);
  });

  it("an org held in fit_review stays there, but its submit time is recorded", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({
      timeZone: "America/Chicago",
      stage: "fit_review",
    });
    expect((await sendToCds(ctx, ADDON_REGISTRY)).stage).toBe("fit_review");
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "fit_review",
    );
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(intake.submitted_at).not.toBe("");
  });

  it("re-screens at Send: a never-hosted word added after Submit holds the org (A-CR-01)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ timeZone: "America/Chicago" });
    // Edited behind the chokepoint's back: Send is the backstop.
    const profile = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    await pb.collection("business_profile").update(profile.id, {
      mission: `Selling ${AUP_TEST_TERMS.blocked} goods.`,
    });
    expect((await sendToCds(ctx, ADDON_REGISTRY)).stage).toBe("fit_review");
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "fit_review",
    );
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(intake.submitted_at).not.toBe("");
    const holds = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'fit.hold'", {
        o: org,
      }),
    });
    expect(holds).toHaveLength(1);
    expect(holds[0]!.meta).toMatchObject({
      verdict: "blocked",
      trigger: "send",
    });
  });

  it("sends once, only from setup: a second send or another stage is refused (A-WR-03)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ timeZone: "America/Chicago" });
    const first = await sendToCds(ctx, ADDON_REGISTRY);
    const again = await sendToCds(ctx, ADDON_REGISTRY).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(InvalidInput);
    expect((again as Error).message).toBe(ALREADY_SENT_COPY);
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(new Date(intake.submitted_at).getTime()).toBe(
      first.submittedAt.getTime(),
    );

    for (const stage of ["", "ready_for_build"]) {
      const o = await submittedOrg({ timeZone: "America/Chicago" });
      await pb.collection("organizations").update(o.org, { stage });
      await expect(sendToCds(o.ctx, ADDON_REGISTRY)).rejects.toThrow(
        ALREADY_SENT_COPY,
      );
      expect((await pb.collection("organizations").getOne(o.org)).stage).toBe(
        stage,
      );
    }
  });

  it("an org left at intake with its intake sent: Send finishes the move (R2-WR-01)", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ timeZone: "America/Chicago" });
    // An approve raced a Send in another process: stage intake, submitted_at already set.
    const first = await sendToCds(ctx, ADDON_REGISTRY);
    await pb.collection("organizations").update(org, { stage: "intake" });
    const out = await sendToCds(ctx, ADDON_REGISTRY);
    expect(out.stage).toBe("ready_for_build");
    expect(out.submittedAt.getTime()).toBe(first.submittedAt.getTime());
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "ready_for_build",
    );
    const intake = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(new Date(intake.submitted_at).getTime()).toBe(
      first.submittedAt.getTime(),
    );
    const sends = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'intake.send'", {
        o: org,
      }),
      sort: "created",
    });
    expect(sends.map((r) => r.meta)).toContainEqual({
      stage: "ready_for_build",
      reconcile: true,
    });
  });

  it("refuses while the time zone is missing: IntakeIncomplete lists it; nothing written", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg();
    const err = await sendToCds(ctx, ADDON_REGISTRY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntakeIncomplete);
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as IntakeIncomplete).code).toBe("intake_incomplete");
    expect((err as IntakeIncomplete).missing).toEqual(["time_zone"]);
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "intake",
    );
  });

  it("a bouncing default blocks Send to CDS", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await submittedOrg({ timeZone: "America/Chicago" });
    const route = await pb
      .collection("org_email_routes")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    await pb
      .collection("org_email_routes")
      .update(route.id, { bounced_at: new Date().toISOString() });
    const err = await sendToCds(ctx, ADDON_REGISTRY).catch((e: unknown) => e);
    expect((err as IntakeIncomplete).missing).toEqual(["email_delivery"]);
  });

  it("an Admin is Forbidden; the owner under impersonation is denied (TEN-15)", async (t) => {
    if (!inst) return t.skip();
    const { org } = await submittedOrg({ timeZone: "America/Chicago" });
    await expect(
      sendToCds(ctxAs(org, "admin"), ADDON_REGISTRY),
    ).rejects.toThrow(Forbidden);
    await expect(
      sendToCds(ctxAs(org, "owner", seed.A.owner), ADDON_REGISTRY),
    ).rejects.toThrow(ImpersonationDenied);
    expect((await pb.collection("organizations").getOne(org)).stage).toBe(
      "intake",
    );
  });
});
