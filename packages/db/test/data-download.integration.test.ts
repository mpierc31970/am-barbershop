// 11-40: "Download my data" on the real PocketBase binary (LIFE-04, D284, D285; Pitfalls 5,
// 13, 14; T-11-40-01..05). Owner-only request (never impersonating), one per 24 hours, a
// streamed zip on the private store, the ready alert + email with a 7-day signed link, the
// download opener for 11-41's route, and the retention prune.
import "@cds/addon-registry/server";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidContext,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { strFromU8, unzipSync } from "fflate";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createFakePushSender,
  setPushSenderForTests,
} from "../src/alerts/push";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import {
  DownloadLinkExpired,
  openDataDownload,
  pruneDataDownloads,
  readDataDownloadState,
  requestDataDownload,
  runDataDownloads,
} from "../src/downloads";
import { captureTransport } from "../src/email/transport";
import { runRetentionJob } from "../src/jobs/retention";
import { envPrefix, tenantMediaKey, type ObjectStore } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { DAY_MS, fakeNow, MINUTE_MS } from "./helpers/fake-clock";
import { bootPb, type PbInstance } from "./pb-harness";

const SYS = mintSystemContext({ job: "test" });

let inst: PbInstance | null = null;
let pb: PocketBase;
let root: string;
let tmp: string;
let store: LocalDiskStore;

const tag = () => randomBytes(4).toString("hex");

type Org = {
  org: string;
  slug: string;
  owner: string;
  ownerEmail: string;
  editor: string;
  ctx(
    user: string,
    role: "owner" | "editor",
    impersonator?: string,
  ): OrgContext;
};

async function newUser(prefix: string): Promise<{ id: string; email: string }> {
  const password = randomBytes(18).toString("hex");
  const email = `${prefix}-${tag()}@cds.test`;
  const id = (
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
    })
  ).id;
  return { id, email };
}

async function newOrg(): Promise<Org> {
  const t = tag();
  const slug = `dl-${t}`;
  const org = (
    await pb.collection("organizations").create({
      name: `Download ${t}`,
      slug,
      status: "active",
      path: "standard",
    })
  ).id;
  const owner = await newUser("owner");
  const editor = await newUser("editor");
  await pb
    .collection("memberships")
    .create({ user: owner.id, organization: org, role: "owner" });
  await pb
    .collection("memberships")
    .create({ user: editor.id, organization: org, role: "editor" });
  return {
    org,
    slug,
    owner: owner.id,
    ownerEmail: owner.email,
    editor: editor.id,
    ctx: (user, role, impersonator) =>
      mintOrgContext({
        orgId: org,
        actor: user,
        role,
        grants: [],
        ip: "127.0.0.1",
        ...(impersonator ? { impersonator } : {}),
      }),
  };
}

async function row(id: string) {
  return pb.collection("data_exports").getOne(id);
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cds-dl-store-"));
  tmp = await mkdtemp(join(tmpdir(), "cds-dl-tmp-"));
  store = new LocalDiskStore(root);
  setPushSenderForTests(createFakePushSender());
});

afterEach(async () => {
  setPushSenderForTests(null);
  await rm(root, { recursive: true, force: true });
  await rm(tmp, { recursive: true, force: true });
});

describe("requestDataDownload rules (choice 1)", () => {
  it("refuses an Editor, impersonating staff and a second request within 24 h", async () => {
    if (!inst) return;
    const o = await newOrg();
    const clock = fakeNow("2026-10-11T15:00:00.000Z");
    await expect(
      requestDataDownload(o.ctx(o.editor, "editor"), { run: false }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      requestDataDownload(o.ctx(o.owner, "owner", "staff123456789a"), {
        run: false,
      }),
    ).rejects.toBeInstanceOf(ImpersonationDenied);

    const owner = o.ctx(o.owner, "owner");
    const { id } = await requestDataDownload(owner, {
      run: false,
      now: clock.now(),
    });
    expect((await row(id)).status).toBe("queued");
    // already queued
    await expect(
      requestDataDownload(owner, { run: false, now: clock.now() }),
    ).rejects.toBeInstanceOf(InvalidInput);

    await runDataDownloads(SYS, {
      org: o.org,
      store,
      tmpDir: tmp,
      now: clock.now(),
    });
    expect((await row(id)).status).toBe("ready");

    clock.advance(23 * 60 * MINUTE_MS);
    await expect(
      requestDataDownload(owner, { run: false, now: clock.now() }),
    ).rejects.toThrow(/after 2026-10-12T15:00:00.000Z/);
    const state = await readDataDownloadState(owner, clock.now());
    expect(state.who).toBe("owner");
    expect(state.canRequest).toBe(false);
    expect(state.nextAllowedAt).toBe("2026-10-12T15:00:00.000Z");
    expect(state.latest?.status).toBe("ready");
    expect(state.latest?.href).toMatch(
      new RegExp(`^/hub/api/data-download/${id}\\?exp=\\d+&sig=`),
    );

    clock.advance(2 * 60 * MINUTE_MS);
    const later = await readDataDownloadState(owner, clock.now());
    expect(later.canRequest).toBe(true);
    expect(later.nextAllowedAt).toBeNull();

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'data_export.requested' && target_id = {:id}",
        {
          id,
        },
      ),
    });
    expect(audit).toHaveLength(1);

    expect((await readDataDownloadState(o.ctx(o.editor, "editor"))).who).toBe(
      "not-owner",
    );
    expect(
      (await readDataDownloadState(o.ctx(o.owner, "owner", "staff123456789a")))
        .who,
    ).toBe("impersonating");
  });
});

describe("the build (choices 2-5)", () => {
  it("builds a safe zip on the store, alerts and emails the Owner, and leaves no temp file", async () => {
    if (!inst) return;
    const o = await newOrg();
    const clock = fakeNow("2026-10-11T15:00:00.000Z");
    await pb.collection("contacts").create({
      organization: o.org,
      email: "jane@example.com",
      email_norm: "jane@example.com",
      name: '=HYPERLINK("http://evil")',
    });
    const asset = await pb.collection("media_assets").create({
      organization: o.org,
      kind: "library",
      storage_dir: `tenants/${o.org}/media/x`,
      original_ext: "png",
      name: "Shop front.png",
      bytes: 4,
      status: "ready",
      source: "library",
    });
    await store.put(
      tenantMediaKey(o.org, asset.id, "original.png"),
      new Uint8Array([137, 80, 78, 71]),
    );
    await pb.collection("push_subscriptions").create({
      organization: o.org,
      user: o.owner,
      endpoint: `https://push.example.com/${tag()}`,
      p256dh: "P256DH-SECRET-VALUE",
      auth: "AUTH-SECRET-VALUE",
      ua_family: "chrome",
      fail_count: 0,
    });
    await pb
      .collection("member_invites")
      .create({
        organization: o.org,
        email: "new@example.com",
        role: "editor",
        status: "pending",
        token_hash: "INVITE-TOKEN-HASH-VALUE",
        expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
        invited_by: o.owner,
      })
      .catch(() => undefined);

    const transport = captureTransport();
    const { id } = await requestDataDownload(o.ctx(o.owner, "owner"), {
      run: false,
      now: clock.now(),
    });
    const res = await runDataDownloads(SYS, {
      org: o.org,
      store,
      tmpDir: tmp,
      transport,
      now: clock.now(),
    });
    expect(res.built).toEqual([id]);
    expect(await readdir(tmp)).toEqual([]);

    const r = await row(id);
    expect(r.status).toBe("ready");
    expect(r.object_key).toMatch(
      new RegExp(`^${envPrefix()}tenants/${o.org}/exports/download-.*\\.zip$`),
    );
    expect(r.size_bytes).toBeGreaterThan(0);
    expect(new Date(r.expires_at.replace(" ", "T")).getTime()).toBe(
      clock.now().getTime() + 7 * DAY_MS,
    );

    const files = unzipSync((await store.get(r.object_key))!);
    expect(Object.keys(files)).toContain("contacts.csv");
    expect(Object.keys(files)).toContain("pages.csv");
    expect(Object.keys(files)).toContain("README.txt");
    expect(files[`media/${asset.id}-shop-front.png`]).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    expect(Object.keys(files)).not.toContain("push-subscriptions.csv");
    const all = Object.values(files)
      .map((b) => strFromU8(b))
      .join("\n");
    expect(all).toContain("'=HYPERLINK");
    for (const secret of [
      "P256DH-SECRET-VALUE",
      "AUTH-SECRET-VALUE",
      "INVITE-TOKEN-HASH-VALUE",
      "token_hash",
    ]) {
      expect(all).not.toContain(secret);
    }

    const alerts = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:org} && type = 'data_export.ready'", {
        org: o.org,
      }),
    });
    expect(alerts.map((a) => a.user)).toEqual([o.owner]);
    expect(alerts[0]!.source_key).toBe(`export:${id}`);

    const mail = transport.sent.filter((m) => m.to.includes(o.ownerEmail));
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toBe("Your data download is ready");
    expect(mail[0]!.text).toMatch(
      new RegExp(`/hub/api/data-download/${id}\\?exp=\\d+&sig=[A-Za-z0-9_-]+`),
    );

    // The download opener (11-41's route).
    const link = /exp=(\d+)&sig=([A-Za-z0-9_-]+)/.exec(mail[0]!.text)!;
    const owner = o.ctx(o.owner, "owner");
    const opened = await openDataDownload(
      owner,
      id,
      { exp: link[1], sig: link[2] },
      { store, now: clock.now() },
    );
    expect(opened.filename).toBe(`${o.slug}-data-2026-10-11.zip`);
    expect((await readAll(opened.stream)).length).toBe(r.size_bytes);
    await expect(
      openDataDownload(
        owner,
        id,
        { exp: link[1], sig: "x" + link[2]!.slice(1) },
        { store, now: clock.now() },
      ),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      openDataDownload(
        o.ctx(o.owner, "owner", "staff123456789a"),
        id,
        { exp: link[1], sig: link[2] },
        { store, now: clock.now() },
      ),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    await expect(
      openDataDownload(
        o.ctx(o.editor, "editor"),
        id,
        { exp: link[1], sig: link[2] },
        { store, now: clock.now() },
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    const other = await newOrg();
    await expect(
      openDataDownload(
        other.ctx(other.owner, "owner"),
        id,
        { exp: link[1], sig: link[2] },
        { store, now: clock.now() },
      ),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      openDataDownload(
        owner,
        id,
        { exp: link[1], sig: link[2] },
        { store, now: new Date(clock.now().getTime() + 8 * DAY_MS) },
      ),
    ).rejects.toBeInstanceOf(DownloadLinkExpired);
  });

  it("the fire-and-forget path builds without being awaited", async () => {
    if (!inst) return;
    const o = await newOrg();
    const { id } = await requestDataDownload(o.ctx(o.owner, "owner"), {
      store,
      tmpDir: tmp,
      transport: captureTransport(),
    });
    for (let i = 0; i < 100; i++) {
      if ((await row(id)).status === "ready") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect((await row(id)).status).toBe("ready");
  });

  it("a failed upload marks the row failed, sends no alert and leaves no temp file", async () => {
    if (!inst) return;
    const o = await newOrg();
    const broken: ObjectStore = {
      put: () => Promise.reject(new Error("disk full")),
      get: (k) => store.get(k),
      list: (p) => store.list(p),
      delete: (k) => store.delete(k),
      putFile: () => Promise.reject(new TypeError("upload broke")),
    };
    const { id } = await requestDataDownload(o.ctx(o.owner, "owner"), {
      run: false,
    });
    const res = await runDataDownloads(SYS, {
      org: o.org,
      store: broken,
      tmpDir: tmp,
    });
    expect(res.failed).toEqual([{ id, errorKind: "TypeError" }]);
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.error_kind).toBe("TypeError");
    expect(await readdir(tmp)).toEqual([]);
    const alerts = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:org}", { org: o.org }),
    });
    expect(alerts).toHaveLength(0);
    // A failed build does not count toward the 24-hour limit: Try again works.
    const state = await readDataDownloadState(o.ctx(o.owner, "owner"));
    expect(state.latest?.status).toBe("failed");
    expect(state.canRequest).toBe(true);
  });

  it("stops above the size cap with error_kind too_large", async () => {
    if (!inst) return;
    const o = await newOrg();
    const { id } = await requestDataDownload(o.ctx(o.owner, "owner"), {
      run: false,
    });
    await runDataDownloads(SYS, {
      org: o.org,
      store,
      tmpDir: tmp,
      maxBytes: 200,
    });
    expect((await row(id)).error_kind).toBe("too_large");
    expect(await readdir(tmp)).toEqual([]);
  });

  it("WR-B08: a build cut off mid-way reads failed at once and a new request goes ahead", async () => {
    if (!inst) return;
    const o = await newOrg();
    const owner = o.ctx(o.owner, "owner");
    const clock = fakeNow("2026-10-11T15:00:00.000Z");
    const stuck = await pb.collection("data_exports").create({
      organization: o.org,
      requested_by: o.owner,
      status: "building",
      requested_at: clock.now().toISOString(),
    });
    // Fresh heartbeat: still being prepared.
    expect((await readDataDownloadState(owner, clock.now())).canRequest).toBe(
      false,
    );
    const spy = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 6 * MINUTE_MS);
    try {
      const state = await readDataDownloadState(owner, clock.now());
      expect(state.latest?.status).toBe("failed");
      expect(state.latest?.errorKind).toBe("interrupted");
      expect(state.canRequest).toBe(true);
      const { id } = await requestDataDownload(owner, {
        run: false,
        now: clock.now(),
      });
      expect((await row(id)).status).toBe("queued");
    } finally {
      spy.mockRestore();
    }
    expect((await row(stuck.id)).status).toBe("failed");
    expect((await row(stuck.id)).error_kind).toBe("interrupted");
  });

  it("WR-B08: a queued request nobody is building does not block the Owner", async () => {
    if (!inst) return;
    const o = await newOrg();
    const owner = o.ctx(o.owner, "owner");
    const clock = fakeNow("2026-10-11T15:00:00.000Z");
    const { id } = await requestDataDownload(owner, {
      run: false,
      now: clock.now(),
    });
    clock.advance(MINUTE_MS);
    expect((await readDataDownloadState(owner, clock.now())).canRequest).toBe(
      false,
    );
    clock.advance(2 * MINUTE_MS);
    expect((await readDataDownloadState(owner, clock.now())).canRequest).toBe(
      true,
    );
    const again = await requestDataDownload(owner, {
      run: false,
      now: clock.now(),
    });
    expect(again.id).not.toBe(id);
    expect((await row(id)).error_kind).toBe("interrupted");
  });

  it("WR-B08: a running build heartbeats its row", async () => {
    if (!inst) return;
    const o = await newOrg();
    const { id } = await requestDataDownload(o.ctx(o.owner, "owner"), {
      run: false,
    });
    const slow = Object.create(store) as typeof store;
    const delay = () => new Promise((r) => setTimeout(r, 800));
    slow.put = async (...a: Parameters<typeof store.put>) => {
      await delay();
      return store.put(...a);
    };
    if (typeof store.putFile === "function") {
      const putFile = store.putFile.bind(store);
      slow.putFile = async (
        ...a: Parameters<NonNullable<typeof store.putFile>>
      ) => {
        await delay();
        return putFile(...a);
      };
    }
    const seen = new Set<string>();
    const run = runDataDownloads(SYS, {
      org: o.org,
      store: slow,
      tmpDir: tmp,
      transport: captureTransport(),
      heartbeatMs: 100,
    });
    for (let i = 0; i < 20; i++) {
      const r = await row(id);
      if (r.status === "building") seen.add(String(r.updated));
      await new Promise((res) => setTimeout(res, 50));
    }
    await run;
    expect(seen.size).toBeGreaterThan(1);
    expect((await row(id)).status).toBe("ready");
  });

  it("the job tick builds queued rows older than 2 minutes and fails stuck builds", async () => {
    if (!inst) return;
    const o = await newOrg();
    const clock = fakeNow("2026-10-11T15:00:00.000Z");
    const { id } = await requestDataDownload(o.ctx(o.owner, "owner"), {
      run: false,
      now: clock.now(),
    });
    const fresh = await runDataDownloads(SYS, {
      store,
      tmpDir: tmp,
      now: new Date(clock.now().getTime() + MINUTE_MS),
    });
    expect(fresh.built).not.toContain(id);
    const stuck = await pb.collection("data_exports").create({
      organization: o.org,
      requested_by: o.owner,
      status: "building",
      requested_at: new Date(
        clock.now().getTime() - 4 * 3_600_000,
      ).toISOString(),
    });
    // WR-B08: "stuck" is measured from the heartbeat (`updated`, the PocketBase clock): the
    // wall clock moves 6 minutes on for the tick.
    const spy = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 6 * MINUTE_MS);
    let tick: Awaited<ReturnType<typeof runDataDownloads>>;
    try {
      tick = await runDataDownloads(SYS, {
        store,
        tmpDir: tmp,
        transport: captureTransport(),
        now: new Date(clock.now().getTime() + 3 * MINUTE_MS),
      });
    } finally {
      spy.mockRestore();
    }
    expect(tick.built).toContain(id);
    expect(tick.interrupted).toBeGreaterThanOrEqual(1);
    expect((await row(stuck.id)).error_kind).toBe("interrupted");
  });
});

describe("retention (choice 7)", () => {
  it("after 8 days the zip is deleted and the row expired; old failed rows go", async () => {
    if (!inst) return;
    const o = await newOrg();
    const clock = fakeNow("2026-10-11T15:00:00.000Z");
    const { id } = await requestDataDownload(o.ctx(o.owner, "owner"), {
      run: false,
      now: clock.now(),
    });
    await runDataDownloads(SYS, {
      org: o.org,
      store,
      tmpDir: tmp,
      transport: captureTransport(),
      now: clock.now(),
    });
    const key = (await row(id)).object_key as string;
    expect(await store.stat(key)).not.toBeNull();
    const failed = await pb.collection("data_exports").create({
      organization: o.org,
      requested_by: o.owner,
      status: "failed",
      error_kind: "Error",
      requested_at: clock.now().toISOString(),
    });

    const dry = await pruneDataDownloads(SYS, {
      now: new Date(clock.now().getTime() + 6 * DAY_MS),
      dryRun: true,
    });
    expect(dry.expired).toBe(0);

    const later = new Date(clock.now().getTime() + 8 * DAY_MS);
    const res = await runRetentionJob({
      now: later,
      deps: {
        privateStore: store,
        publicStore: new LocalDiskStore(join(root, "public")),
        agreementStore: store,
        writeMeta: () => Promise.resolve(),
      },
    });
    expect(res.failedSteps).not.toContain("data-downloads");
    expect(res.dataDownloadsExpired).toBeGreaterThanOrEqual(1);
    expect(res.dataDownloadsFailedDeleted).toBeGreaterThanOrEqual(1);
    expect(await store.stat(key)).toBeNull();
    const r = await row(id);
    expect(r.status).toBe("expired");
    expect(r.object_key).toBe("");
    await expect(row(failed.id)).rejects.toThrow();
    const state = await readDataDownloadState(o.ctx(o.owner, "owner"), later);
    expect(state.latest?.status).toBe("expired");
    expect(state.latest?.href).toBeNull();
    expect(state.canRequest).toBe(true);
  });
});

describe("job entry points need a minted SystemContext (WR-B07)", () => {
  it("runDataDownloads and pruneDataDownloads refuse a forged context", async () => {
    const forged = { job: "retention" } as unknown as typeof SYS;
    await expect(runDataDownloads(forged, {})).rejects.toBeInstanceOf(
      InvalidContext,
    );
    await expect(
      pruneDataDownloads(forged, { now: new Date(), dryRun: true }),
    ).rejects.toBeInstanceOf(InvalidContext);
  });
});
