// 14-15 (DOM-01, D57; P14-P3; T-14-15-01, T-14-15-02): the preview host is written in the
// signup batch, and backfillPreviewHosts gives older host-less orgs theirs. Real PocketBase.
import { InvalidInput } from "@cds/core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  backfillPreviewHosts,
  previewHostFor,
} from "../src/assembly/preview-host";
import { superuser } from "../src/client";
import {
  resetSignInLimitsForTests,
  resetSubmitLimitsForTests,
} from "../src/rate-limit";
import { clearResolverCache, resolveOrganization } from "../src/resolve";
import {
  bootSeededPb,
  seedQuote,
  submitWithCode,
  type SeededPb,
} from "./seeded";

let booted: SeededPb | null = null;
const tag = Math.random().toString(36).slice(2, 7);
let n = 0;

function nextEmail(): string {
  n += 1;
  return `preview-${tag}-${n}@cds.test`;
}

async function hostsOf(org: string) {
  const pb = await superuser();
  return pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:o}", { o: org }),
  });
}

async function orgsNamed(name: string) {
  const pb = await superuser();
  return pb.collection("organizations").getFullList({
    filter: pb.filter("name = {:n}", { n: name }),
  });
}

describe("preview host at signup + backfill (DOM-01)", () => {
  beforeAll(async () => {
    vi.stubEnv("CDS_PREVIEW_HOST_SUFFIX", "sites.localhost");
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await booted?.inst.stop();
  });
  beforeEach(() => {
    resetSubmitLimitsForTests();
    resetSignInLimitsForTests();
    clearResolverCache();
  });

  it("previewHostFor builds <slug>.<suffix> and refuses a non-label slug", () => {
    expect(previewHostFor("rivera-bakery")).toBe(
      "rivera-bakery.sites.localhost",
    );
    for (const bad of ["", "-x", "a.b", "A B", "x".repeat(64)]) {
      expect(() => previewHostFor(bad)).toThrow(InvalidInput);
    }
  });

  it("completeSubmit writes the preview primary row in the signup batch; the host resolves at once", async (t) => {
    if (!booted) return t.skip();
    const name = `Preview Bakery ${tag}`;
    const q = await seedQuote();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: name,
      description: "Fresh bread every morning.",
      email: nextEmail(),
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    const pb = await superuser();
    const org = await pb.collection("organizations").getOne(out.orgId);
    const rows = await hostsOf(out.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hostname: `${org.slug}.sites.localhost`,
      kind: "preview",
      primary: true,
    });
    const resolved = await resolveOrganization(`${org.slug}.sites.localhost`);
    expect(resolved?.orgId).toBe(out.orgId);
    expect(resolved?.hostKind).toBe("preview");
  });

  it("a slug whose preview host is taken moves to the next slug; no half-created org", async (t) => {
    if (!booted) return t.skip();
    const pb = await superuser();
    const name = `Taken Host ${tag}`;
    const base = `taken-host-${tag}`;
    // Another (older) org already holds the preview name this business would get.
    const other = await pb.collection("organizations").create({
      name: `Other ${tag}`,
      slug: `other-${tag}`,
      status: "active",
    });
    await pb.collection("org_hosts").create({
      hostname: `${base}.sites.localhost`,
      organization: other.id,
      kind: "preview",
      primary: true,
    });
    const q = await seedQuote();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: name,
      description: "Bread.",
      email: nextEmail(),
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    const orgs = await orgsNamed(name);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.slug).toBe(`${base}-2`);
    const rows = await hostsOf(out.orgId);
    expect(rows.map((r) => r.hostname)).toEqual([`${base}-2.sites.localhost`]);
    // The other org's host is untouched.
    expect((await hostsOf(other.id)).map((r) => r.hostname)).toEqual([
      `${base}.sites.localhost`,
    ]);
    // Every org created by signup has a host: none is hostless.
    const memberships = await pb.collection("memberships").getFullList({
      filter: pb.filter("organization = {:o}", { o: out.orgId }),
    });
    expect(memberships).toHaveLength(1);
  });

  it("backfill gives a host-less active org its preview host; a second run creates 0", async (t) => {
    if (!booted) return t.skip();
    const pb = await superuser();
    const slug = `old-org-${tag}`;
    const old = await pb.collection("organizations").create({
      name: `Old ${tag}`,
      slug,
      status: "active",
    });
    const disabled = await pb.collection("organizations").create({
      name: `Disabled ${tag}`,
      slug: `disabled-${tag}`,
      status: "disabled",
    });
    const first = await backfillPreviewHosts({ limit: 50 });
    expect(first.created).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBe(0);
    const rows = await hostsOf(old.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hostname: `${slug}.sites.localhost`,
      kind: "preview",
      primary: true,
    });
    expect(await hostsOf(disabled.id)).toHaveLength(0);

    const second = await backfillPreviewHosts({ limit: 50 });
    expect(second).toEqual({ created: 0, skipped: 0, failed: 0 });
  });

  it("backfill respects the limit, counts the rest as skipped, and counts a failing org without throwing", async (t) => {
    if (!booted) return t.skip();
    const pb = await superuser();
    const a = await pb.collection("organizations").create({
      name: `Lim A ${tag}`,
      slug: `lim-a-${tag}`,
      status: "active",
    });
    const b = await pb.collection("organizations").create({
      name: `Lim B ${tag}`,
      slug: `lim-b-${tag}`,
      status: "active",
    });
    const limited = await backfillPreviewHosts({ limit: 1 });
    expect(limited).toEqual({ created: 1, skipped: 1, failed: 0 });
    const rest = await backfillPreviewHosts();
    expect(rest).toEqual({ created: 1, skipped: 0, failed: 0 });
    expect(await hostsOf(a.id)).toHaveLength(1);
    expect(await hostsOf(b.id)).toHaveLength(1);

    // A host-less org whose preview name another org already holds: counted, never thrown.
    const clash = await pb.collection("organizations").create({
      name: `Clash ${tag}`,
      slug: `clash-${tag}`,
      status: "active",
    });
    await pb.collection("org_hosts").create({
      hostname: `clash-${tag}.sites.localhost`,
      organization: a.id,
      kind: "preview",
      primary: false,
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await backfillPreviewHosts();
    expect(failed).toEqual({ created: 0, skipped: 0, failed: 1 });
    expect(spy).toHaveBeenCalledWith(
      "[preview-host] backfill failed: InvalidInput",
    );
    spy.mockRestore();
    expect(await hostsOf(clash.id)).toHaveLength(0);
  });
});
