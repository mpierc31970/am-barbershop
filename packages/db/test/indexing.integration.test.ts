// 13-19 (STAFF-17, D190; T-13-19-01..02): per-site indexing state on the real PocketBase
// binary. Publishing a page on a live org records the ping result in org_indexing (the
// stand-in pinger answers "logged"); staff read the rows, Resubmit one site (sitemap check
// + audit with organization) or every live non-demo site; a member context is refused.
// 14-21 (CONT-16, D170; T-14-21-01): only custom primary hosts of live, not suspended orgs
// ever reach the pinger (a preview URL never does), and a banner save bumps sitemap lastmod.
// 14-26 (CONT-16, D190; T-14-26-02): resubmit submits the sitemap through the SitemapSubmitter
// port under the same guard and records last_submit_* (stand-in: logged).
import "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidContext } from "@cds/core";
import { parseSiteIndex } from "@cds/core/seo";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  liveOrgsForIndexing,
  pingAndRecord,
} from "../src/content/indexing-record";
import { readJson } from "../src/content/manifest";
import {
  submitAndRecord,
  type SitemapSubmitter,
} from "../src/content/sitemap-submit";
import { createPage } from "../src/content/pages";
import {
  recordingInvalidator,
  type ContentScanner,
  type SearchPinger,
} from "../src/content/ports";
import { refreshSiteIndex } from "../src/content/site-index/build";
import { saveBanner } from "../src/content/site-settings";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { loggingPinger } from "../src/content/scan-standin";
import { saveSection } from "../src/content/sections";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import {
  indexingStatus,
  staffIndexingStatus,
  staffResubmit,
  staffResubmitAllLive,
} from "../src/staff/indexing";
import { runIndexingJob } from "../src/jobs/indexing";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
} from "../src/platform-meta";
import {
  getObjectStore,
  tenantSiteIndexKey,
  type ObjectStore,
} from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

const IP = "127.0.0.1";
const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NOW = new Date("2026-10-18T06:00:00.000Z");

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir = "";
let store: ObjectStore;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const clean: ContentScanner = {
  scan: () => Promise.resolve({ verdict: "clean", reasons: [] }),
};

function deps(pinger: SearchPinger = loggingPinger): PublishDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    scanner: clean,
    pinger,
    store,
  };
}

/** A pinger that records every URL list it is handed. */
function recordingPinger(): SearchPinger & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    ping(urls: string[], opts?: { orgId?: string }) {
      calls.push([...urls]);
      return Promise.resolve({ orgId: opts?.orgId ?? "", result: "ok" });
    },
  };
}

/** A sitemap submitter that records every (site, feed) pair it is handed. */
function recordingSubmitter(
  result: "ok" | "error" | "throw" = "ok",
): SitemapSubmitter & {
  calls: [string, string][];
  props: (string | null | undefined)[];
} {
  const calls: [string, string][] = [];
  const props: (string | null | undefined)[] = [];
  return {
    name: "api",
    calls,
    props,
    submit(
      siteUrl: string,
      sitemapUrl: string,
      opts?: { gscProperty?: string | null },
    ) {
      calls.push([siteUrl, sitemapUrl]);
      props.push(opts?.gscProperty);
      if (result === "throw") return Promise.reject(new TypeError("boom"));
      return Promise.resolve({
        result,
        engines: { google: result, bing: result },
      });
    },
  };
}

let n = 0;
type Org = {
  org: string;
  owner: OrgContext;
  host: string;
  previewHost: string;
};

/**
 * A fresh org with a primary host; `stage` live unless told otherwise. `preview` makes the
 * primary host a preview host (no custom host); `withPreview` adds a non-primary preview host.
 */
async function makeOrg(
  opts: {
    stage?: string;
    demo?: boolean;
    preview?: boolean;
    withPreview?: boolean;
  } = {},
): Promise<Org> {
  n += 1;
  const tag = `${n}-${Math.random().toString(36).slice(2, 8)}`;
  const org = (
    await pb.collection("organizations").create({
      name: `Indexing ${tag}`,
      slug: `idx-${tag}`,
      status: "active",
      stage: opts.stage ?? "live",
      demo: opts.demo === true,
    })
  ).id;
  const previewHost = `idx-${tag}.sites.connectionsdesignstudios.com`;
  const host = opts.preview === true ? previewHost : `idx-${tag}.example.test`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: opts.preview === true ? "preview" : "custom",
    primary: true,
  });
  if (opts.withPreview === true) {
    await pb.collection("org_hosts").create({
      hostname: previewHost,
      organization: org,
      kind: "preview",
      primary: false,
    });
  }
  const owner = mintOrgContext({
    orgId: org,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    ip: IP,
  });
  return { org, owner, host, previewHost };
}

async function publishHome(
  o: Org,
  pinger: SearchPinger = loggingPinger,
): Promise<void> {
  const page = await createPage(
    o.owner,
    { title: "Home", slug: "home" },
    store,
  );
  await saveSection(o.owner, registry, {
    pageId: page.id,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Home", text: "<p>Hello</p>" },
  });
  const res = await publishPage(o.owner, page.id, deps(pinger));
  expect(res.status).toBe("published");
}

async function indexRow(org: string) {
  const res = await pb.collection("org_indexing").getList(1, 1, {
    filter: pb.filter("org_id = {:org}", { org }),
  });
  return res.items[0] ?? null;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-indexing-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  superCtx = await staffContext(inst, "idx-super@cds.test", "super_admin");
  agentCtx = await staffContext(inst, "idx-agent@cds.test", "support_agent");
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

describe("indexing data (13-19 task 1)", () => {
  it("publishing a page on a live org records a logged ping in org_indexing", async () => {
    if (!inst) return;
    const o = await makeOrg();
    await publishHome(o);
    const row = await indexRow(o.org);
    expect(row).not.toBeNull();
    expect(row!.last_ping_result).toBe("logged");
    expect(String(row!.last_ping_at)).not.toBe("");
  });

  it("staffResubmit checks the sitemap and writes an audit row naming the org", async () => {
    if (!inst) return;
    const o = await makeOrg();
    await publishHome(o);
    const out = await staffResubmit(agentCtx, o.org, { store, now: NOW });
    expect(out).toMatchObject({ ping: "logged", sitemap: "ok" });
    const row = await indexRow(o.org);
    expect(row!.sitemap_status).toBe("ok");
    expect(String(row!.last_resubmit_at)).toContain("2026-10-18");
    expect(row!.last_resubmit_by).toBe(agentCtx.actor);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'indexing.resubmitted' && organization = {:org}",
        { org: o.org },
      ),
    });
    expect(audit).toHaveLength(1);

    const [view] = await staffIndexingStatus(superCtx, { orgId: o.org });
    expect(view).toMatchObject({
      orgId: o.org,
      host: o.host,
      live: true,
      demo: false,
      lastPingResult: "logged",
      sitemapStatus: "ok",
      pagesIndexed: null,
    });
    expect(view!.lastResubmitAt).toBe(NOW.toISOString());
  });

  it("a site with no published page has a sitemap error", async () => {
    if (!inst) return;
    const o = await makeOrg();
    const out = await staffResubmit(superCtx, o.org, { store, now: NOW });
    expect(out.sitemap).toBe("error");
    expect((await indexingStatus()).sitemap_errors).toBeGreaterThanOrEqual(1);
  });

  it("staffResubmitAllLive resubmits live, non-demo, not suspended orgs only (WR-A14)", async () => {
    if (!inst) return;
    await makeOrg({ stage: "being_built" });
    await makeOrg({ demo: true });
    const suspended = await makeOrg();
    await pb
      .collection("organizations")
      .update(suspended.org, { suspended_at: NOW.toISOString() });
    const live = (
      await pb.collection("organizations").getFullList({
        filter:
          "stage = 'live' && status = 'active' && demo != true && suspended_at = ''",
        fields: "id",
      })
    ).length;
    const res = await staffResubmitAllLive(agentCtx, { store, now: NOW });
    expect(res.count).toBe(live);
    expect((await liveOrgsForIndexing()).map((o) => o.id)).not.toContain(
      suspended.org,
    );
    await pb
      .collection("organizations")
      .update(suspended.org, { suspended_at: "" });
    const audit = await pb.collection("audit_log").getFullList({
      filter: "action = 'indexing.resubmitted_all'",
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]!.organization).toBe("");
  });

  it("a member context is refused; support_agent is allowed", async () => {
    if (!inst) return;
    const o = await makeOrg();
    await expect(
      staffIndexingStatus(o.owner as unknown as PlatformContext),
    ).rejects.toBeInstanceOf(InvalidContext);
    await expect(
      staffResubmit(o.owner as unknown as PlatformContext, o.org),
    ).rejects.toBeInstanceOf(InvalidContext);
    const rows = await staffIndexingStatus(agentCtx);
    expect(rows.some((r) => r.orgId === o.org)).toBe(true);
  });
});

describe("eligibility guard and lastmod (14-21)", () => {
  it("a preview-only live org is never pinged: skipped, the pinger is not called", async () => {
    if (!inst) return;
    const o = await makeOrg({ preview: true });
    const pinger = recordingPinger();
    await publishHome(o, pinger);
    const direct = await pingAndRecord(
      o.org,
      [`https://${o.previewHost}/`, `https://${o.previewHost}/about`],
      { pinger },
    );
    expect(direct).toBe("skipped");
    expect(pinger.calls).toEqual([]);
    const row = await indexRow(o.org);
    expect(row!.last_ping_result).toBe("skipped");
  });

  it("a live org with a custom primary sends only custom-host URLs", async () => {
    if (!inst) return;
    const o = await makeOrg({ withPreview: true });
    const pinger = recordingPinger();
    const res = await pingAndRecord(
      o.org,
      [
        `https://${o.host}/`,
        `https://${o.previewHost}/`,
        `http://${o.host}/plain`,
        `https://elsewhere.example/`,
        `https://${o.host}/about`,
      ],
      { pinger },
    );
    expect(res).toBe("ok");
    expect(pinger.calls).toEqual([
      [`https://${o.host}/`, `https://${o.host}/about`],
    ]);
    for (const url of pinger.calls.flat()) {
      expect(url).not.toContain(o.previewHost);
    }
  });

  it("a suspended or not-yet-live org is skipped", async () => {
    if (!inst) return;
    const suspended = await makeOrg();
    await pb
      .collection("organizations")
      .update(suspended.org, { suspended_at: NOW.toISOString() });
    const building = await makeOrg({ stage: "being_built" });
    const pinger = recordingPinger();
    for (const o of [suspended, building]) {
      expect(
        await pingAndRecord(o.org, [`https://${o.host}/`], { pinger }),
      ).toBe("skipped");
    }
    expect(pinger.calls).toEqual([]);
    await pb
      .collection("organizations")
      .update(suspended.org, { suspended_at: "" });
  });

  it("WR-A07: a held or disabled (closed) live org is skipped and never listed for resubmission", async () => {
    if (!inst) return;
    const held = await makeOrg();
    await pb.collection("organizations").update(held.org, { status: "held" });
    const closed = await makeOrg();
    await pb
      .collection("organizations")
      .update(closed.org, { status: "disabled", closed_reason: "cancelled" });
    const pinger = recordingPinger();
    for (const o of [held, closed]) {
      expect(
        await pingAndRecord(o.org, [`https://${o.host}/`], { pinger }),
      ).toBe("skipped");
    }
    expect(pinger.calls).toEqual([]);
    const ids = (await liveOrgsForIndexing()).map((o) => o.id);
    expect(ids).not.toContain(held.org);
    expect(ids).not.toContain(closed.org);
    for (const o of [held, closed]) {
      await pb
        .collection("organizations")
        .update(o.org, { status: "active", closed_reason: "" });
    }
  });

  it("a banner save bumps every page's sitemap lastmod, kept by later rebuilds", async () => {
    if (!inst) return;
    const o = await makeOrg();
    await publishHome(o);
    const read = async () =>
      parseSiteIndex(await readJson(store, tenantSiteIndexKey(o.org)))!;
    const before = await read();
    expect(before.live_changed_at).toBeUndefined();
    const published = before.pages[0]!.lastmod;
    await new Promise((r) => setTimeout(r, 15));
    const pinger = recordingPinger();
    await saveBanner(o.owner, deps(pinger), {
      enabled: true,
      message: "Open late on Fridays",
    });
    const after = await read();
    expect(after.live_changed_at).toBeDefined();
    expect(Date.parse(after.live_changed_at!)).toBeGreaterThan(
      Date.parse(published),
    );
    for (const p of after.pages) expect(p.lastmod).toBe(after.live_changed_at);
    expect(pinger.calls).toEqual([[`https://${o.host}/`]]);

    expect(await refreshSiteIndex(o.org, { sections: registry, store })).toBe(
      true,
    );
    const again = await read();
    expect(again.live_changed_at).toBe(after.live_changed_at);
    expect(again.pages[0]!.lastmod).toBe(after.live_changed_at);
  });
});

describe("sitemap submission (14-26)", () => {
  it("resubmit of a live custom org records last_submit_result logged (stand-in)", async () => {
    if (!inst) return;
    const o = await makeOrg({ withPreview: true });
    await publishHome(o);
    const out = await staffResubmit(agentCtx, o.org, { store, now: NOW });
    expect(out.submit).toBe("logged");
    const row = await indexRow(o.org);
    expect(row!.last_submit_result).toBe("logged");
    expect(String(row!.last_submit_at)).toContain("2026-10-18");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'indexing.resubmitted' && organization = {:org}",
        { org: o.org },
      ),
    });
    expect(audit[0]!.meta).toMatchObject({ submit: "logged" });

    const [view] = await staffIndexingStatus(superCtx, { orgId: o.org });
    expect(view).toMatchObject({
      lastSubmitResult: "logged",
      lastSubmitAt: NOW.toISOString(),
    });
  });

  it("submits https://<custom primary>/ and its sitemap.xml only", async () => {
    if (!inst) return;
    const o = await makeOrg({ withPreview: true });
    const submitter = recordingSubmitter();
    expect(await submitAndRecord(o.org, null, { submitter, now: NOW })).toBe(
      "ok",
    );
    // WR-A12: no Search Console property recorded: Google is told to skip.
    expect(submitter.props).toEqual([null]);
    expect(submitter.calls).toEqual([
      [`https://${o.host}/`, `https://${o.host}/sitemap.xml`],
    ]);
    // Naming the preview host explicitly is refused: skipped, the submitter is not called.
    const again = recordingSubmitter();
    expect(
      await submitAndRecord(o.org, o.previewHost, { submitter: again }),
    ).toBe("skipped");
    expect(again.calls).toEqual([]);
    expect((await indexRow(o.org))!.last_submit_result).toBe("skipped");

    // With a Domain property recorded, that exact id is passed for Google.
    await pb.collection("organizations").update(o.org, {
      analytics: { gsc_site_url: `sc-domain:${o.host}` },
    });
    const withProp = recordingSubmitter();
    await submitAndRecord(o.org, null, { submitter: withProp, now: NOW });
    expect(withProp.props).toEqual([`sc-domain:${o.host}`]);
  });

  it("a preview-only live org is skipped and the submitter is not called", async () => {
    if (!inst) return;
    const o = await makeOrg({ preview: true });
    const submitter = recordingSubmitter();
    const out = await staffResubmit(superCtx, o.org, {
      store,
      now: NOW,
      submitter,
    });
    expect(out.submit).toBe("skipped");
    expect(submitter.calls).toEqual([]);
    expect((await indexRow(o.org))!.last_submit_result).toBe("skipped");
  });

  it("not live, suspended or demo orgs are skipped; the demo org records nothing", async () => {
    if (!inst) return;
    const building = await makeOrg({ stage: "being_built" });
    const suspended = await makeOrg();
    await pb
      .collection("organizations")
      .update(suspended.org, { suspended_at: NOW.toISOString() });
    const demo = await makeOrg({ demo: true });
    const submitter = recordingSubmitter();
    for (const o of [building, suspended, demo]) {
      expect(await submitAndRecord(o.org, null, { submitter })).toBe("skipped");
    }
    expect(submitter.calls).toEqual([]);
    expect((await indexRow(demo.org))?.last_submit_result ?? "").toBe("");
    await pb
      .collection("organizations")
      .update(suspended.org, { suspended_at: "" });
  });

  it("a submitter error or throw is recorded as error and never thrown", async () => {
    if (!inst) return;
    const o = await makeOrg();
    for (const mode of ["error", "throw"] as const) {
      const submitter = recordingSubmitter(mode);
      expect(await submitAndRecord(o.org, o.host, { submitter })).toBe("error");
      expect((await indexRow(o.org))!.last_submit_result).toBe("error");
    }
  });
});

describe("indexing:run job (13-19 task 2)", () => {
  async function liveNonDemo(): Promise<number> {
    return (
      await pb.collection("organizations").getFullList({
        filter: "stage = 'live' && status != 'closed' && demo != true",
        fields: "id",
      })
    ).length;
  }

  it("dry run counts and writes nothing", async () => {
    if (!inst) return;
    const before = await pb.collection("org_indexing").getFullList();
    const at = new Date("2026-10-25T06:00:00.000Z");
    const res = await runIndexingJob({ now: at, dryRun: true, store });
    expect(res.dryRun).toBe(true);
    expect(res.resubmitted).toBe(await liveNonDemo());
    expect(res.skippedDemo).toBeGreaterThanOrEqual(1);
    const after = await pb.collection("org_indexing").getFullList();
    expect(after.map((r) => String(r.updated)).sort()).toEqual(
      before.map((r) => String(r.updated)).sort(),
    );
    expect(await readPlatformMeta("job:indexing:last_counts")).toBeNull();
  });

  it("resubmits live non-demo orgs and writes both heartbeats with counts only", async () => {
    if (!inst) return;
    const o = await makeOrg();
    await publishHome(o);
    const demo = await makeOrg({ demo: true });
    const at = new Date("2026-11-01T06:00:00.000Z");
    const res = await runIndexingJob({ now: at, store });
    expect(res.busy).toBe(false);
    expect(res.failedSteps).toEqual([]);
    expect(res.resubmitted).toBe(await liveNonDemo());
    expect(res.skippedDemo).toBeGreaterThanOrEqual(1);
    expect(res.sitemapErrors).toBeGreaterThanOrEqual(1); // orgs with no published page

    const row = await indexRow(o.org);
    expect(String(row!.last_resubmit_at)).toContain("2026-11-01");
    expect(row!.last_resubmit_by).toBe("");
    expect(row!.sitemap_status).toBe("ok");
    expect(row!.last_ping_result).toBe("logged");
    const demoRow = await indexRow(demo.org);
    expect(demoRow?.last_resubmit_at ?? "").toBe("");

    expect(await readPlatformMeta("job:indexing:last_success")).toBe(
      at.toISOString(),
    );
    const counts = (await readPlatformMeta("job:indexing:last_counts")) ?? "";
    expect(Object.keys(JSON.parse(counts) as object).sort()).toEqual(
      [
        "busy",
        "dryRun",
        "failedSteps",
        "resubmitted",
        "sitemapErrors",
        "skippedDemo",
      ].sort(),
    );
    expect(counts).not.toContain(o.org);
    expect(counts).not.toContain(demo.org);
    expect((await indexingStatus()).last_weekly_resubmit).toBe(
      at.toISOString(),
    );
  });

  it("a run that finds the lock held returns busy and writes nothing", async () => {
    if (!inst) return;
    const at = new Date("2026-11-08T06:00:00.000Z");
    const token = await acquirePlatformLock("lock:indexing-job", {
      now: at,
      staleMs: 30 * 60_000,
    });
    expect(token).not.toBeNull();
    try {
      const res = await runIndexingJob({ now: at, store });
      expect(res.busy).toBe(true);
      expect(res.resubmitted).toBe(0);
      expect(await readPlatformMeta("job:indexing:last_success")).not.toBe(
        at.toISOString(),
      );
    } finally {
      await releasePlatformLock("lock:indexing-job", token!);
    }
  });
});
