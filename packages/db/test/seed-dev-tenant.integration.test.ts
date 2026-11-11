// tenants:seed-dev (DEV ONLY; CONT-08, CONT-30; T-03-63, T-03-64, T-03-65) against a
// throwaway PocketBase 0.39.11 and a temp CDS_STORAGE_DIR. Spawned with the same flags as
// the root npm script. The owner password must never appear in the output.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import { INTAKE_FIELDS } from "@cds/core/intake";
import { signInMember } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext } from "../src/context";
import {
  bootstrapDevTenant,
  REFUSE_NOT_DEV,
  REFUSE_PRODUCTION,
} from "../src/dev-seed";
import { seedCompleteIntake, seedMinimalIntake } from "../src/dev-seed-intake";
import { getIntakeForAssembly } from "../src/intake";
import { tenantSiteManifestKey } from "../src/storage/keys";
import { bootPb, type PbInstance } from "./pb-harness";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const REGISTER = pathToFileURL(
  join(PKG_DIR, "scripts", "register-ts.mjs"),
).href;
const SCRIPT = join(PKG_DIR, "scripts", "seed-dev-tenant.ts");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  REGISTER,
];
const HOST = "demo.example.com";
const HOST_B = "demo-b.example.com";
const OWNER_PASSWORD = `seed-${Math.random().toString(36).slice(2)}-pw`;

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir: string;

function childEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CDS_STORAGE_DIR: storageDir,
    SEED_OWNER_PASSWORD: OWNER_PASSWORD,
    CDS_ENV: "dev",
  };
  delete env.VITEST;
  delete env.CDS_PREVIEW_PORT;
  delete env.CDS_PREVIEW_HOST_SUFFIX;
  for (const k of Object.keys(env)) if (k.startsWith("WASABI_")) delete env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

function run(args: string[], env = childEnv()) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
}

async function count(collection: string, filter: string): Promise<number> {
  return (await pb.collection(collection).getList(1, 1, { filter })).totalItems;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-seed-"));
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

describe("tenants:seed-dev CLI", () => {
  it("--help prints usage; --dry-run prints the plan and writes nothing", async (t) => {
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.output).toContain("tenants:seed-dev");
    expect(help.output).toContain("--dry-run");
    if (!inst) return t.skip();
    const dry = run(["--dry-run", "--host", HOST, "--host-b", HOST_B]);
    expect(dry.status).toBe(0);
    expect(dry.output).toContain("DRY RUN nothing written");
    expect(dry.output).toContain(HOST);
    expect(dry.output).toContain(HOST_B);
    expect(dry.output).toContain("theme Almanac");
    expect(dry.output).toContain("theme Tidewater");
    expect(await count("organizations", "slug = 'demo-b'")).toBe(0);
    expect(listFiles(storageDir)).toEqual([]);
    expect(await count("organizations", "slug = 'demo'")).toBe(0);
  });

  it("CDS_ENV=production refuses and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const r = run(
      ["--host", HOST, "--host-b", HOST_B],
      childEnv({ CDS_ENV: "production" }),
    );
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("refusing to seed in production");
    expect(await count("organizations", "slug = 'demo'")).toBe(0);
    expect(listFiles(storageDir)).toEqual([]);
  });

  it("missing SEED_OWNER_PASSWORD fails naming the variable", async (t) => {
    if (!inst) return t.skip();
    const r = run(
      ["--host", HOST],
      childEnv({ SEED_OWNER_PASSWORD: undefined }),
    );
    expect(r.status).toBe(1);
    expect(r.output).toContain("FAIL SEED_OWNER_PASSWORD is not set");
    expect(await count("organizations", "slug = 'demo'")).toBe(0);
  });

  it("seeds org, host, owner, home page, banner and pop-up and publishes home", async (t) => {
    if (!inst) return t.skip();
    const r = run(["--host", HOST, "--host-b", HOST_B]);
    expect(r.output).toContain("PASS demo: published home");
    expect(r.output).toContain("PASS demo-b: published home");
    expect(r.output).toContain("PASS demo: theme Almanac");
    expect(r.output).toContain("PASS demo-b: theme Tidewater");
    expect(r.status).toBe(0);
    expect(r.output).not.toContain(OWNER_PASSWORD);
    expect(r.output).not.toContain(inst.password);

    const org = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'demo'");
    expect(org.status).toBe("active");
    const host = await pb
      .collection("org_hosts")
      .getFirstListItem(pb.filter("hostname = {:h}", { h: HOST }));
    expect(host.organization).toBe(org.id);
    expect(host.kind).toBe("preview");
    expect(host.primary).toBe(true);
    const owner = await pb
      .collection("users")
      .getFirstListItem("email = 'owner@demo.test'");
    const m = await pb.collection("memberships").getFirstListItem(
      pb.filter("user = {:u} && organization = {:o}", {
        u: owner.id,
        o: org.id,
      }),
    );
    expect(m.role).toBe("owner");

    const home = await pb
      .collection("pages")
      .getFirstListItem(
        pb.filter("organization = {:o} && slug = 'home'", { o: org.id }),
      );
    expect(home.status).toBe("published");
    const sections = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: home.id }),
      sort: "sort_order",
    });
    expect(sections.map((s) => s.section_type)).toEqual(["hero", "columns"]);
    expect(sections[0]!.content.heading).toBe("Welcome to Demo");
    expect(sections[1]!.row_layout).toBe("40-60");
    const items = (
      sections[1]!.content as { columns: { items: { kind: string }[] }[] }
    ).columns.flatMap((c) => c.items.map((i) => i.kind));
    expect(items).toContain("image");
    expect(items).toContain("countdown");

    const settings = await pb
      .collection("site_settings")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org.id }));
    expect(settings.banner.enabled).toBe(true);
    const popups = await pb.collection("popups").getFullList({
      filter: pb.filter("organization = {:o}", { o: org.id }),
    });
    expect(popups).toHaveLength(1);
    expect(popups[0]!.trigger).toBe("delay");
    expect(popups[0]!.enabled).toBe(true);

    const manifestPath = join(
      storageDir,
      ...tenantSiteManifestKey(org.id).split("/"),
    );
    const manifest = readFileSync(manifestPath, "utf8");
    expect(manifest).toContain('"home"');

    // 04-14: demo-b on its own host, and both themes stored (THEME-01).
    expect(org.design?.name).toBe("Almanac");
    expect(org.design?.contrast?.adjustments).toEqual([]);
    const orgB = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'demo-b'");
    expect(orgB.name).toBe("Demo B");
    expect(orgB.status).toBe("active");
    expect(orgB.design?.name).toBe("Tidewater");
    expect(orgB.design?.contrast?.adjustments).toHaveLength(1);
    expect(r.output).toContain("PASS demo-b: theme Tidewater");
    expect(r.output).toMatch(
      /PASS demo-b: theme Tidewater \([0-9a-f]{8}\), 1 adjustment/,
    );
    const hostB = await pb
      .collection("org_hosts")
      .getFirstListItem(pb.filter("hostname = {:h}", { h: HOST_B }));
    expect(hostB.organization).toBe(orgB.id);
    const ownerB = await pb
      .collection("users")
      .getFirstListItem("email = 'owner@demo-b.test'");
    const mB = await pb.collection("memberships").getFirstListItem(
      pb.filter("user = {:u} && organization = {:o}", {
        u: ownerB.id,
        o: orgB.id,
      }),
    );
    expect(mB.role).toBe("owner");
    const homeB = await pb
      .collection("pages")
      .getFirstListItem(
        pb.filter("organization = {:o} && slug = 'home'", { o: orgB.id }),
      );
    expect(homeB.status).toBe("published");
    const sectionsB = await pb.collection("page_sections").getFullList({
      filter: pb.filter("page = {:p}", { p: homeB.id }),
      sort: "sort_order",
    });
    // The same page as demo, so the side-by-side check compares one page, two themes.
    expect(sectionsB.map((s) => s.section_type)).toEqual(["hero", "columns"]);
    expect(sectionsB[0]!.content).toEqual(sections[0]!.content);
  });

  it("a second run updates and never duplicates", async (t) => {
    if (!inst) return t.skip();
    const r = run(["--host", HOST, "--host-b", HOST_B]);
    expect(r.output).toContain("updated");
    expect(r.status).toBe(0);
    const org = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'demo'");
    expect(await count("organizations", "slug = 'demo'")).toBe(1);
    expect(
      await count("org_hosts", pb.filter("hostname = {:h}", { h: HOST })),
    ).toBe(1);
    expect(await count("users", "email = 'owner@demo.test'")).toBe(1);
    const o = pb.filter("organization = {:o}", { o: org.id });
    expect(await count("memberships", o)).toBe(1);
    expect(await count("pages", o)).toBe(1);
    expect(await count("page_sections", o)).toBe(2);
    expect(await count("popups", o)).toBe(1);
    expect(await count("site_settings", o)).toBe(1);

    // demo-b is idempotent too, and both themes survive the re-run.
    expect(r.output).toMatch(/PASS demo-b: org \w+ updated/);
    expect(await count("organizations", "slug = 'demo-b'")).toBe(1);
    expect(
      await count("org_hosts", pb.filter("hostname = {:h}", { h: HOST_B })),
    ).toBe(1);
    expect(await count("users", "email = 'owner@demo-b.test'")).toBe(1);
    const orgB = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'demo-b'");
    const oB = pb.filter("organization = {:o}", { o: orgB.id });
    expect(await count("memberships", oB)).toBe(1);
    expect(await count("pages", oB)).toBe(1);
    expect(await count("page_sections", oB)).toBe(2);
    expect(await count("popups", oB)).toBe(1);
    expect(org.design?.name).toBe("Almanac");
    expect(orgB.design?.name).toBe("Tidewater");
  });

  it("never takes over an account that belongs to another organization (WR-A05)", async (t) => {
    if (!inst) return t.skip();
    const other = await pb
      .collection("organizations")
      .create({ name: "Other", slug: "other-org", status: "active" });
    const password = "victim-password-123";
    const victim = await pb.collection("users").create({
      email: "victim@other.test",
      password,
      passwordConfirm: password,
    });
    await pb
      .collection("memberships")
      .create({ user: victim.id, organization: other.id, role: "owner" });
    const saved = process.env.CDS_ENV;
    process.env.CDS_ENV = "dev";
    try {
      await expect(
        bootstrapDevTenant({
          slug: "demo",
          name: "Demo",
          host: HOST,
          ownerEmail: "victim@other.test",
          ownerPassword: "attacker-password-123",
        }),
      ).rejects.toThrow(InvalidInput);
    } finally {
      if (saved === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved;
    }
    // The victim's password still works and they own no seeded org.
    const demo = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'demo'");
    expect(
      await count(
        "memberships",
        pb.filter("user = {:u} && organization = {:o}", {
          u: victim.id,
          o: demo.id,
        }),
      ),
    ).toBe(0);
    await expect(
      signInMember("victim@other.test", password, "127.0.0.1"),
    ).resolves.toHaveProperty("token");
  });

  it("never promotes a non-owner member of the dev tenant (IN-R01)", async (t) => {
    if (!inst) return t.skip();
    const demo = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'demo'");
    const password = "editor-password-123";
    const editor = await pb.collection("users").create({
      email: "editor@demo.test",
      password,
      passwordConfirm: password,
    });
    const m = await pb
      .collection("memberships")
      .create({ user: editor.id, organization: demo.id, role: "editor" });
    const saved = process.env.CDS_ENV;
    process.env.CDS_ENV = "dev";
    try {
      await expect(
        bootstrapDevTenant({
          slug: "demo",
          name: "Demo",
          host: HOST,
          ownerEmail: "editor@demo.test",
          ownerPassword: "attacker-password-123",
        }),
      ).rejects.toThrow(InvalidInput);
    } finally {
      if (saved === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved;
    }
    expect((await pb.collection("memberships").getOne(m.id)).role).toBe(
      "editor",
    );
    await expect(
      signInMember("editor@demo.test", password, "127.0.0.1"),
    ).resolves.toHaveProperty("token");
  });

  it("CDS_ENV must be exactly dev: unset or a typo refuses and writes nothing (IN-R01)", async (t) => {
    if (!inst) return t.skip();
    const before = await count("audit_log", "id != ''");
    const unset = run(
      ["--host", HOST, "--host-b", HOST_B],
      childEnv({ CDS_ENV: undefined }),
    );
    expect(unset.status).not.toBe(0);
    expect(unset.output).toContain("set CDS_ENV=dev");
    const typo = run(
      ["--host", HOST, "--host-b", HOST_B],
      childEnv({ CDS_ENV: "prod" }),
    );
    expect(typo.status).not.toBe(0);
    expect(typo.output).toContain("refusing to seed");
    expect(await count("audit_log", "id != ''")).toBe(before);
  });

  // ------------------------------------------------------------ 06-23 intake fixtures

  it("the intake helpers refuse outside CDS_ENV=dev and write nothing (T-06-106)", async (t) => {
    if (!inst) return t.skip();
    const saved = process.env.CDS_ENV;
    try {
      for (const [env, message] of [
        ["production", REFUSE_PRODUCTION],
        [undefined, REFUSE_NOT_DEV],
        ["staging", REFUSE_NOT_DEV],
      ] as const) {
        if (env === undefined) delete process.env.CDS_ENV;
        else process.env.CDS_ENV = env;
        const opts = { slug: "refused-intake", ownerEmail: "r@refused.test" };
        const deps = { registry: ADDON_REGISTRY };
        await expect(seedCompleteIntake(opts, deps)).rejects.toThrow(message);
        await expect(seedMinimalIntake(opts)).rejects.toThrow(message);
      }
    } finally {
      if (saved === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved;
    }
    expect(await count("organizations", "slug = 'refused-intake'")).toBe(0);
    expect(await count("users", "email = 'r@refused.test'")).toBe(0);
  });

  it("--intake --dry-run prints both fixtures and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const r = run(["--intake", "both", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain('org "intake-complete"');
    expect(r.output).toContain('org "intake-minimal"');
    expect(r.output).toContain("DRY RUN nothing written");
    expect(await count("organizations", "slug ~ 'intake-'")).toBe(0);
    const bad = run(["--intake", "everything"]);
    expect(bad.status).toBe(1);
    expect(bad.output).toContain("--intake must be complete, minimal or both");
  });

  // ------------------------------------------------------------ 08-19 --assemble

  it("--assemble needs --intake; --intake both --assemble --dry-run writes nothing", async (t) => {
    if (!inst) return t.skip();
    const lone = run(["--assemble"]);
    expect(lone.status).toBe(1);
    expect(lone.output).toContain("--assemble needs --intake");
    const dry = run(["--intake", "both", "--assemble", "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.output).toContain(
      "PLAN assemble intake-complete: send to CDS, build Home and About on intake-complete.sites.localhost",
    );
    expect(dry.output).toContain(
      "PLAN assemble intake-minimal: send to CDS, build Home and About on intake-minimal.sites.localhost",
    );
    expect(dry.output).toContain("DRY RUN nothing written");
    expect(await count("organizations", "slug ~ 'intake-'")).toBe(0);
    expect(await count("org_hosts", "hostname ~ 'sites.localhost'")).toBe(0);
  });

  it("--intake both seeds a complete, sent intake and a minimal one for P8 (CONTEXT A3-Q4)", async (t) => {
    if (!inst) return t.skip();
    const r = run(["--intake", "both"]);
    expect(r.output).toContain("PASS intake complete: org");
    expect(r.output).toContain("PASS intake minimal: org");
    expect(r.status).toBe(0);
    expect(r.output).not.toContain(OWNER_PASSWORD);

    const ctxFor = async (slug: string) => {
      const org = await pb
        .collection("organizations")
        .getFirstListItem(pb.filter("slug = {:s}", { s: slug }));
      const m = await pb
        .collection("memberships")
        .getFirstListItem(pb.filter("organization = {:o}", { o: org.id }));
      expect(m.role).toBe("owner");
      return {
        org,
        ctx: mintOrgContext({
          orgId: org.id,
          actor: m.user,
          role: "owner",
          grants: [],
          ip: "127.0.0.1",
        }),
      };
    };

    // Complete: every core field provided, Testimonials records, sent to CDS.
    const full = await ctxFor("intake-complete");
    expect(full.org.stage).toBe("ready_for_build");
    const intakeRow = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: full.org.id }));
    expect(intakeRow.submitted_at).not.toBe("");
    const a = await getIntakeForAssembly(full.ctx, ADDON_REGISTRY);
    const fallbacks = INTAKE_FIELDS.filter(
      (f) => a.fields[f.id]?.source !== "provided",
    ).map((f) => f.id);
    expect(fallbacks).toEqual([]);
    expect(a.fields.addon_testimonials_records?.source).toBe("provided");
    expect(a.team).toHaveLength(2);
    expect(a.services).toHaveLength(3);
    expect(a.media.logo).not.toBeNull();
    expect(a.media.hero).not.toBeNull();
    expect(a.media.gallery).toHaveLength(3);
    expect(a.moodboardProposal).not.toBeNull();
    // The owner can sign in with the seed password (never printed).
    await expect(
      signInMember("owner@intake-complete.test", OWNER_PASSWORD, "127.0.0.1"),
    ).resolves.toHaveProperty("token");

    // Minimal: required fields only, still in intake; P8's fallbacks carry the rest.
    const min = await ctxFor("intake-minimal");
    expect(min.org.stage).toBe("intake");
    const b = await getIntakeForAssembly(min.ctx, ADDON_REGISTRY);
    for (const id of ["org_name", "path", "time_zone", "contact_method"]) {
      expect(b.fields[id]?.source, id).toBe("provided");
    }
    for (const id of ["logo", "about", "hero", "hours", "team", "services"]) {
      expect(b.fields[id]?.source, id).toBe("fallback");
    }
    expect(b.team).toEqual([]);
    expect(b.services).toEqual([]);

    // A second run leaves both untouched (no duplicate team, services or images).
    const again = run(["--intake", "both"]);
    expect(again.status).toBe(0);
    expect(again.output).toContain("already there, left untouched");
    const o = pb.filter("organization = {:o}", { o: full.org.id });
    expect(await count("team_members", o)).toBe(2);
    expect(await count("services", o)).toBe(3);
    expect(await count("organizations", "slug = 'intake-complete'")).toBe(1);
  });

  it("--intake complete --assemble builds Home and About on the preview host; a re-run changes nothing (08-19)", async (t) => {
    if (!inst) return t.skip();
    const r = run(["--intake", "complete", "--assemble"]);
    expect(r.output).toContain(
      "Assembled intake-complete: http://intake-complete.sites.localhost/",
    );
    expect(r.status).toBe(0);
    expect(r.output).not.toContain(OWNER_PASSWORD);

    const org = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'intake-complete'");
    expect(org.stage).toBe("being_built");
    const o = pb.filter("organization = {:o}", { o: org.id });
    const host = await pb.collection("org_hosts").getFirstListItem(o);
    expect(host.hostname).toBe("intake-complete.sites.localhost");
    expect(host.kind).toBe("preview");
    const pages = await pb.collection("pages").getFullList({ filter: o });
    const bySlug = new Map(pages.map((p) => [String(p.slug), p]));
    expect(bySlug.get("home")?.status).toBe("published");
    expect(bySlug.get("about")?.status).toBe("published");

    const before = {
      pages: await count("pages", o),
      sections: await count("page_sections", o),
      hosts: await count("org_hosts", o),
      forms: await count("forms", o),
    };
    const again = run(["--intake", "complete", "--assemble"]);
    expect(again.status).toBe(0);
    expect(again.output).toContain(
      "PASS intake-complete: already assembled, nothing changed: http://intake-complete.sites.localhost/",
    );
    expect({
      pages: await count("pages", o),
      sections: await count("page_sections", o),
      hosts: await count("org_hosts", o),
      forms: await count("forms", o),
    }).toEqual(before);
  });

  it("--intake both --assemble sends and assembles the minimal fixture too (08-19)", async (t) => {
    if (!inst) return t.skip();
    const r = run(["--intake", "both", "--assemble"]);
    expect(r.output).toContain(
      "Assembled intake-minimal: http://intake-minimal.sites.localhost/",
    );
    expect(r.output).toContain("intake-complete: already assembled");
    expect(r.status).toBe(0);
    const org = await pb
      .collection("organizations")
      .getFirstListItem("slug = 'intake-minimal'");
    expect(org.stage).toBe("being_built");
    const o = pb.filter("organization = {:o}", { o: org.id });
    const pages = await pb.collection("pages").getFullList({ filter: o });
    expect(pages.map((p) => String(p.slug)).sort()).toEqual(["about", "home"]);
    expect(pages.every((p) => p.status === "published")).toBe(true);
  });
});
