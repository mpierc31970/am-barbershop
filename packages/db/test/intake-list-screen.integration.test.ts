// Save-time scan for team members, services and the live business profile (13-52; STAFF-25,
// D248, D270; 13-VERIFICATION gap) on the real PocketBase 0.39.11 binary:
//   - clean saves land as asked, no flag, the live tag is invalidated
//   - held saves the row hidden (is_published false) with an open "held" flag
//   - unsure saves as asked with an open "unsure" flag
//   - a scanner outage saves as asked with a queued "error" flag (source scan)
//   - switching a row off is not screened
//   - a spreadsheet import screens every new row
//   - the business profile is screened once the fit screen stops (stage live), not before
//   - the hourly rescan holds a shown team member by switching it off
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  recordingInvalidator,
  type ContentScanner,
  type ScanVerdict,
  type SearchPinger,
} from "../src/content/ports";
import { liveTag } from "../src/content/ports";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  commitCoreImport,
  saveBusinessProfile,
  saveService,
  saveTeamMember,
} from "../src/intake";
import { runReviewJob } from "../src/jobs/review";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir: string;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const pinger: SearchPinger = { ping: () => Promise.resolve() };

function answering(
  verdict: ScanVerdict,
): ContentScanner & { seen: string[][] } {
  const seen: string[][] = [];
  return {
    seen,
    scan(input) {
      seen.push(input.texts);
      return Promise.resolve({ verdict, reasons: [`stub ${verdict}`] });
    },
  };
}

const down: ContentScanner = {
  scan: () => Promise.reject(new Error("provider down")),
};

function deps(scanner: ContentScanner) {
  return { scanner, invalidator: recordingInvalidator(), pinger };
}

async function newOrg(stage = "live"): Promise<OrgContext> {
  const owner = await pb.collection("users").create({
    email: `ls-${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: "correct-horse-battery",
    passwordConfirm: "correct-horse-battery",
  });
  const org = await pb.collection("organizations").create({
    name: "Screen Co",
    slug: `screen-${Math.random().toString(36).slice(2, 10)}`,
    status: "active",
    stage,
  });
  return mintOrgContext({
    orgId: org.id,
    actor: owner.id,
    role: "owner",
    grants: [],
    ip: IP,
  });
}

async function flagsFor(targetId: string) {
  return pb.collection("content_flags").getFullList({
    filter: pb.filter("target_id = {:id}", { id: targetId }),
  });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-list-screen-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("team members: save-time scan (STAFF-25, D270)", () => {
  it("a clean save lands shown, raises no flag and drops the live tag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const scanner = answering("clean");
    const d = deps(scanner);
    const m = await saveTeamMember(
      ctx,
      { name: "Maria Lopez", role: "Owner", bio: "Bakes bread." },
      undefined,
      d,
    );
    expect(m).toMatchObject({ is_published: true, held: false });
    expect(scanner.seen).toEqual([["Maria Lopez", "Owner", "Bakes bread."]]);
    expect(await flagsFor(m.id)).toHaveLength(0);
    expect(d.invalidator.tags).toContain(liveTag(ctx.orgId));
  });

  it("held saves the member hidden with an open held flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const m = await saveTeamMember(
      ctx,
      { name: "Sam", bio: "Bad words" },
      undefined,
      deps(answering("held")),
    );
    expect(m).toMatchObject({ is_published: false, held: true });
    const row = await pb.collection("team_members").getOne(m.id);
    expect(row.is_published).toBe(false);
    const flags = await flagsFor(m.id);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      organization: ctx.orgId,
      target_collection: "team_members",
      verdict: "held",
      status: "open",
    });
  });

  it("the keyword stand-in holds the synthetic test word with no injected scanner", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const m = await saveTeamMember(ctx, {
      name: "Test",
      bio: "__cds_test_held__",
    });
    expect(m.held).toBe(true);
    expect(m.is_published).toBe(false);
    expect((await flagsFor(m.id))[0]?.verdict).toBe("held");
  });

  it("unsure saves as asked with an open unsure flag", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const m = await saveTeamMember(
      ctx,
      { name: "Ana" },
      undefined,
      deps(answering("unsure")),
    );
    expect(m).toMatchObject({ is_published: true, held: false });
    expect(await flagsFor(m.id)).toEqual([
      expect.objectContaining({ verdict: "unsure", status: "open" }),
    ]);
  });

  it("a scanner outage saves as asked and queues an error flag for the rescan", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const m = await saveTeamMember(ctx, { name: "Lee" }, undefined, deps(down));
    expect(m).toMatchObject({ is_published: true, held: false });
    expect(await flagsFor(m.id)).toEqual([
      expect.objectContaining({
        verdict: "error",
        status: "queued",
        source: "scan",
      }),
    ]);
  });

  it("Show on site on is screened; switching off is not", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const m = await saveTeamMember(
      ctx,
      { name: "Kai", is_published: false },
      undefined,
      deps(answering("clean")),
    );
    const off = answering("held");
    const stillOff = await saveTeamMember(
      ctx,
      { is_published: false },
      m.id,
      deps(off),
    );
    expect(off.seen).toHaveLength(0);
    expect(stillOff.held).toBe(false);
    const on = await saveTeamMember(
      ctx,
      { is_published: true },
      m.id,
      deps(answering("held")),
    );
    expect(on).toMatchObject({ is_published: false, held: true });
  });

  it("the hourly rescan holds a shown member by switching it off", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const m = await saveTeamMember(ctx, { name: "Rio" }, undefined, deps(down));
    expect(m.is_published).toBe(true);
    // A Tuesday, so no spot checks open.
    const res = await runReviewJob({
      now: new Date("2026-10-13T15:00:00Z"),
      scanner: answering("held"),
    });
    expect(res.failedSteps).toEqual([]);
    const row = await pb.collection("team_members").getOne(m.id);
    expect(row.is_published).toBe(false);
    expect(await flagsFor(m.id)).toEqual([
      expect.objectContaining({ verdict: "held", status: "open" }),
    ]);
  });
});

describe("services: save-time scan (STAFF-25, D270)", () => {
  it("clean, held, unsure and outage follow the records contract", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const clean = answering("clean");
    const a = await saveService(
      ctx,
      { name: "Haircut", description: "30 minutes", price_display: "free" },
      undefined,
      deps(clean),
    );
    expect(a).toMatchObject({ is_published: true, held: false });
    expect(clean.seen).toEqual([["Haircut", "30 minutes"]]);
    expect(await flagsFor(a.id)).toHaveLength(0);

    const b = await saveService(
      ctx,
      { name: "Held thing", price_display: "free" },
      undefined,
      deps(answering("held")),
    );
    expect(b).toMatchObject({ is_published: false, held: true });
    expect((await flagsFor(b.id))[0]).toMatchObject({
      target_collection: "services",
      verdict: "held",
      status: "open",
    });

    const c = await saveService(
      ctx,
      { description: "Edited" },
      a.id,
      deps(answering("unsure")),
    );
    expect(c).toMatchObject({ is_published: true, held: false });
    expect(await flagsFor(a.id)).toEqual([
      expect.objectContaining({ verdict: "unsure", status: "open" }),
    ]);

    const e = await saveService(
      ctx,
      { name: "Colour", price_display: "free" },
      undefined,
      deps(down),
    );
    expect(e.is_published).toBe(true);
    expect(await flagsFor(e.id)).toEqual([
      expect.objectContaining({ verdict: "error", status: "queued" }),
    ]);
  });

  it("a spreadsheet import screens every new row; a held row lands hidden", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const scanner: ContentScanner = {
      scan: (input) =>
        Promise.resolve(
          input.texts.includes("Bad row")
            ? { verdict: "held", reasons: ["stub"] }
            : { verdict: "clean", reasons: [] },
        ),
    };
    const csv = [
      "Name,Description,Price type,Price,Duration in minutes,Show on site",
      "Good row,,Free,,,Yes",
      "Bad row,,Free,,,Yes",
    ].join("\n");
    const counts = await commitCoreImport(
      ctx,
      "services",
      csv,
      "add",
      undefined,
      deps(scanner),
    );
    expect(counts.added).toBe(2);
    const rows = await pb.collection("services").getFullList({
      filter: pb.filter("organization = {:o}", { o: ctx.orgId }),
    });
    const bad = rows.find((r) => r.name === "Bad row")!;
    const good = rows.find((r) => r.name === "Good row")!;
    expect(bad.is_published).toBe(false);
    expect(good.is_published).toBe(true);
    expect(await flagsFor(bad.id)).toEqual([
      expect.objectContaining({ verdict: "held", status: "open" }),
    ]);
    expect(await flagsFor(good.id)).toHaveLength(0);
  });
});

describe("business profile: live save-time scan (STAFF-25, D270)", () => {
  it("a live site's public text is screened; held opens a flag, outage queues one", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("live");
    const held = answering("held");
    await saveBusinessProfile(
      ctx,
      { tagline: "Fresh bread daily" },
      deps(held),
    );
    expect(held.seen).toEqual([["Fresh bread daily"]]);
    const row = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: ctx.orgId }));
    expect(row.tagline).toBe("Fresh bread daily"); // never blocks the save (D248)
    expect(await flagsFor(row.id)).toEqual([
      expect.objectContaining({
        target_collection: "business_profile",
        verdict: "held",
        status: "open",
      }),
    ]);
    await saveBusinessProfile(ctx, { about: "Since 1990" }, deps(down));
    const flags = await flagsFor(row.id);
    expect(flags.map((f) => [f.verdict, f.status]).sort()).toEqual([
      ["error", "queued"],
      ["held", "open"],
    ]);
  });

  it("a clean live save raises no flag; a non-text save is not screened", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("live");
    const clean = answering("clean");
    await saveBusinessProfile(ctx, { headline: "Good food" }, deps(clean));
    await saveBusinessProfile(ctx, { phone: "555-0100" }, deps(clean));
    expect(clean.seen).toEqual([["Good food"]]);
    const row = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: ctx.orgId }));
    expect(await flagsFor(row.id)).toHaveLength(0);
  });

  it("during onboarding the fit screen covers it: no publish scan", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg("intake");
    const held = answering("held");
    await saveBusinessProfile(ctx, { tagline: "Fresh bread" }, deps(held));
    expect(held.seen).toHaveLength(0);
  });
});
