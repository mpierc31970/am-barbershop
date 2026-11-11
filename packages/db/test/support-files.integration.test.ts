// 12-07 Task 2: support files on the real PocketBase binary (COMM-04, COMM-08; P12-P1,
// P12-P3; T-12-07-01..06). Stage, attach, staff files, scan states, signed links, the
// Documents list, the job helpers and support files in Download my data.
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { strFromU8, strToU8, unzipSync } from "fflate";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintSystemContext } from "../src/context";
import { requestDataDownload, runDataDownloads } from "../src/downloads";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { tenantSupportPrefix } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  SupportLinkExpired,
  attachStagedUploads,
  jobPruneStagedUploads,
  jobRescanPendingFiles,
  listThreadFiles,
  mintSupportFileLink,
  openSupportFile,
  stageSupportUpload,
  staffOpenSupportFile,
  staffStoreCdsDocumentObject,
  staffStoreSupportFile,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { fakeScanner } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

const SYS = mintSystemContext({ job: "test" });
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3,
]);
const PDF = strToU8("%PDF-1.7\nhello");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let root: string;
let tmp: string;
let store: LocalDiskStore;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb);
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cds-sf-store-"));
  tmp = await mkdtemp(join(tmpdir(), "cds-sf-tmp-"));
  store = new LocalDiskStore(root);
  resetSupportLimitsForTests();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(tmp, { recursive: true, force: true });
});

async function threadWithMessage(
  org: string,
  visibility: "public" | "internal" = "public",
): Promise<{ thread: string; message: string }> {
  const thread = (
    await pb.collection("support_threads").create({
      organization: org,
      kind: "ticket",
      number: 1000 + Math.floor(Math.random() * 1_000_000),
      type: "problem",
      subject: "Broken form",
      status: "open",
    })
  ).id;
  const message = (
    await pb.collection("support_messages").create({
      organization: org,
      thread,
      author_kind: visibility === "public" ? "member" : "staff",
      body: "See attached",
      visibility,
    })
  ).id;
  return { thread, message };
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

function linkParts(path: string): { id: string; exp: string; sig: string } {
  const u = new URL(path, "http://x");
  return {
    id: u.pathname.split("/").pop()!,
    exp: u.searchParams.get("exp")!,
    sig: u.searchParams.get("sig")!,
  };
}

describe("stageSupportUpload (choice 2)", () => {
  it("stages a clean PNG for an editor; refuses a viewer and an impersonated owner", async (t) => {
    if (!inst) return t.skip();
    const scanner = fakeScanner("clean");
    const up = await stageSupportUpload(
      s.A.ctx.editor,
      { name: "shot.png", bytes: PNG },
      { scanner, store },
    );
    expect(up).toMatchObject({
      name: "shot.png",
      size: PNG.byteLength,
      mime: "image/png",
      scan: "clean",
    });
    expect(up.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(scanner.calls).toBe(1);
    const staged = await store.list(`${tenantSupportPrefix(s.A.org)}staging/`);
    expect(staged).toHaveLength(1);

    await expect(
      stageSupportUpload(
        s.A.ctx.viewer,
        { name: "shot.png", bytes: PNG },
        { scanner, store },
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      stageSupportUpload(
        s.A.impersonatedOwner,
        { name: "shot.png", bytes: PNG },
        { scanner, store },
      ),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
  });

  it("refuses a mismatched type, a file over 10 MB and an infected file, storing nothing", async (t) => {
    if (!inst) return t.skip();
    const deps = { scanner: fakeScanner("infected"), store };
    await expect(
      stageSupportUpload(s.A.ctx.editor, { name: "a.pdf", bytes: PNG }, deps),
    ).rejects.toMatchObject({ code: "file_type" });
    await expect(
      stageSupportUpload(
        s.A.ctx.editor,
        { name: "big.png", bytes: new Uint8Array(10 * 1024 * 1024 + 1) },
        deps,
      ),
    ).rejects.toMatchObject({ code: "file_too_big" });
    await expect(
      stageSupportUpload(s.A.ctx.editor, { name: "a.png", bytes: PNG }, deps),
    ).rejects.toMatchObject({ code: "file_refused" });
    expect(await store.list(tenantSupportPrefix(s.A.org))).toHaveLength(0);
  });
});

describe("attachStagedUploads (choice 3)", () => {
  it("copies staged files to the message, removes staging and refuses foreign or too many tokens", async (t) => {
    if (!inst) return t.skip();
    const deps = { scanner: fakeScanner("clean"), store };
    const { thread, message } = await threadWithMessage(s.A.org);
    const up = await stageSupportUpload(
      s.A.ctx.editor,
      { name: "shot.png", bytes: PNG },
      deps,
    );

    // Another actor in the same org, or org B, cannot use the token.
    await expect(
      attachStagedUploads(
        pb,
        s.A.ctx.admin,
        { threadId: thread, messageId: message, tokens: [up.token] },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    const b = await threadWithMessage(s.B.org);
    await expect(
      attachStagedUploads(
        pb,
        s.B.ctx.editor,
        { threadId: b.thread, messageId: b.message, tokens: [up.token] },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    // A tampered token.
    await expect(
      attachStagedUploads(
        pb,
        s.A.ctx.editor,
        {
          threadId: thread,
          messageId: message,
          tokens: [up.token.slice(0, -2) + "AA"],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    // Six tokens.
    await expect(
      attachStagedUploads(
        pb,
        s.A.ctx.editor,
        {
          threadId: thread,
          messageId: message,
          tokens: Array(6).fill(up.token) as string[],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);

    const out = await attachStagedUploads(
      pb,
      s.A.ctx.editor,
      { threadId: thread, messageId: message, tokens: [up.token] },
      deps,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "shot.png",
      mime: "image/png",
      scan: "clean",
    });
    const row = await pb.collection("support_files").getOne(out[0]!.id);
    expect(row.organization).toBe(s.A.org);
    expect(row.author_kind).toBe("member");
    expect(row.object_key).toContain(
      `support/threads/${thread}/${message}/${out[0]!.id}.png`,
    );
    expect(await store.get(row.object_key as string)).toEqual(PNG);
    expect(
      await store.list(`${tenantSupportPrefix(s.A.org)}staging/`),
    ).toHaveLength(0);
    // The token is spent: the staging object is gone.
    await expect(
      attachStagedUploads(
        pb,
        s.A.ctx.editor,
        { threadId: thread, messageId: message, tokens: [up.token] },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
  });
});

describe("scan states, links and opening (choices 4, 6)", () => {
  it("stores a pending file when the scanner errors; tenants can't download it, staff can", async (t) => {
    if (!inst) return t.skip();
    const deps = { scanner: fakeScanner("error"), store };
    const { thread, message } = await threadWithMessage(s.A.org);
    const up = await stageSupportUpload(
      s.A.ctx.editor,
      { name: "shot.png", bytes: PNG },
      deps,
    );
    expect(up.scan).toBe("pending");
    const [file] = await attachStagedUploads(
      pb,
      s.A.ctx.editor,
      { threadId: thread, messageId: message, tokens: [up.token] },
      deps,
    );
    expect(file!.scan).toBe("pending");
    await expect(mintSupportFileLink(s.A.ctx.viewer, file!.id)).rejects.toThrow(
      "This file is still being checked. Try again later.",
    );
    const staff = await staffOpenSupportFile(s.staff.agent, file!.id, {
      store,
    });
    expect(staff.orgId).toBe(s.A.org);
    expect(await readAll(staff.stream)).toEqual(PNG);

    // The rescan job clears it once a real scanner answers clean.
    const unavailable = await jobRescanPendingFiles({
      scanner: { name: "unavailable", scan: async () => "error" },
      store,
    });
    expect(unavailable.skipped).toBe(true);
    const res = await jobRescanPendingFiles({
      scanner: fakeScanner("clean"),
      store,
    });
    expect(res.clean).toBeGreaterThanOrEqual(1);
    expect((await pb.collection("support_files").getOne(file!.id)).scan).toBe(
      "clean",
    );
    const path = await mintSupportFileLink(s.A.ctx.viewer, file!.id);
    expect(path).toMatch(
      new RegExp(`^/hub/api/support-file/${file!.id}\\?exp=\\d+&sig=`),
    );
  });

  it("opens a staff file on a valid link; foreign org, internal message, tampered and expired links fail", async (t) => {
    if (!inst) return t.skip();
    const { thread, message } = await threadWithMessage(s.A.org);
    const file = await staffStoreSupportFile(
      s.staff.agent,
      {
        orgId: s.A.org,
        threadId: thread,
        messageId: message,
        name: "Quote.pdf",
        bytes: PDF,
      },
      { store },
    );
    expect(file.scan).toBe("staff");
    const now = new Date("2026-10-12T12:00:00Z");
    const path = await mintSupportFileLink(s.A.ctx.viewer, file.id, { now });
    const link = linkParts(path);
    const opened = await openSupportFile(s.A.ctx.viewer, file.id, link, {
      store,
      now,
    });
    expect(opened).toMatchObject({
      mime: "application/pdf",
      filename: "Quote.pdf",
      inline: false,
      size: PDF.byteLength,
    });
    expect(await readAll(opened.stream)).toEqual(PDF);

    // Org B: the same NotFound as a missing id.
    const foreign = await mintSupportFileLink(s.B.ctx.owner, file.id).catch(
      (e: unknown) => e,
    );
    const missing = await mintSupportFileLink(
      s.B.ctx.owner,
      "zzzzzzzzzzzzzzz",
    ).catch((e: unknown) => e);
    expect(foreign).toBeInstanceOf(NotFound);
    expect(missing).toBeInstanceOf(NotFound);
    expect((foreign as Error).message).toBe((missing as Error).message);
    await expect(
      openSupportFile(s.B.ctx.owner, file.id, link, { store, now }),
    ).rejects.toBeInstanceOf(NotFound);

    // Tampered and expired.
    await expect(
      openSupportFile(
        s.A.ctx.viewer,
        file.id,
        { ...link, sig: link.sig.slice(0, -2) + "AA" },
        { store, now },
      ),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      openSupportFile(s.A.ctx.viewer, file.id, link, {
        store,
        now: new Date(now.getTime() + 15 * 60 * 1000 + 1),
      }),
    ).rejects.toBeInstanceOf(SupportLinkExpired);
    // Impersonating staff never downloads through the tenant route.
    await expect(
      openSupportFile(s.A.impersonatedOwner, file.id, link, { store, now }),
    ).rejects.toBeInstanceOf(NotFound);

    // A file on an internal note is invisible to the tenant.
    const internal = await threadWithMessage(s.A.org, "internal");
    const hidden = await staffStoreSupportFile(
      s.staff.agent,
      {
        orgId: s.A.org,
        threadId: internal.thread,
        messageId: internal.message,
        name: "notes.png",
        bytes: PNG,
      },
      { store },
    );
    await expect(
      mintSupportFileLink(s.A.ctx.owner, hidden.id),
    ).rejects.toBeInstanceOf(NotFound);
    const listed = await listThreadFiles(s.A.ctx.viewer, { from: "all" });
    expect(listed.some((f) => f.id === hidden.id)).toBe(false);
    expect(listed.some((f) => f.id === file.id)).toBe(true);
    const fromYou = await listThreadFiles(s.A.ctx.viewer, { from: "you" });
    expect(fromYou.some((f) => f.id === file.id)).toBe(false);
    const fromCds = await listThreadFiles(s.A.ctx.viewer, { from: "cds" });
    expect(fromCds.find((f) => f.id === file.id)).toMatchObject({
      threadId: thread,
      authorKind: "staff",
    });
    expect((await listThreadFiles(s.B.ctx.owner, {})).length).toBe(0);
  });

  it("serves images inline and opens a CDS document object by id", async (t) => {
    if (!inst) return t.skip();
    const { thread, message } = await threadWithMessage(s.A.org);
    const img = await staffStoreSupportFile(
      s.staff.agent,
      {
        orgId: s.A.org,
        threadId: thread,
        messageId: message,
        name: "x.png",
        bytes: PNG,
      },
      { store },
    );
    const now = new Date();
    const link = linkParts(await mintSupportFileLink(s.A.ctx.viewer, img.id));
    const opened = await openSupportFile(s.A.ctx.viewer, img.id, link, {
      store,
      now,
    });
    expect(opened.inline).toBe(true);
    expect(opened.mime).toBe("image/png");

    const docId = "doc" + "a".repeat(12);
    const obj = await staffStoreCdsDocumentObject(
      s.staff.agent,
      { orgId: s.A.org, docId, name: "Brand guide.pdf", bytes: PDF },
      { store },
    );
    expect(obj).toMatchObject({
      size: PDF.byteLength,
      mime: "application/pdf",
      ext: "pdf",
      filename: "Brand guide.pdf",
    });
    await pb.collection("cds_documents").create({
      id: docId,
      organization: s.A.org,
      title: "Brand guide",
      object_key: obj.object_key,
      filename: obj.filename,
      size: obj.size,
      mime: obj.mime,
      ext: obj.ext,
      shared_by: s.staff.agentUser,
      author_name: "CDS",
    });
    const dl = linkParts(await mintSupportFileLink(s.A.ctx.viewer, docId));
    const doc = await openSupportFile(s.A.ctx.viewer, docId, dl, { store });
    expect(doc.filename).toBe("Brand guide.pdf");
    expect(await readAll(doc.stream)).toEqual(PDF);
    await expect(
      mintSupportFileLink(s.B.ctx.owner, docId),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe("jobPruneStagedUploads (choice 8)", () => {
  it("removes staging objects older than 24 hours", async (t) => {
    if (!inst) return t.skip();
    await stageSupportUpload(
      s.A.ctx.editor,
      { name: "old.png", bytes: PNG },
      { scanner: fakeScanner("clean"), store },
    );
    const soon = await jobPruneStagedUploads(new Date(), { store });
    expect(soon.deleted).toBe(0);
    const later = await jobPruneStagedUploads(
      new Date(Date.now() + 25 * 60 * 60 * 1000),
      { store },
    );
    expect(later.deleted).toBe(1);
    expect(
      await store.list(`${tenantSupportPrefix(s.A.org)}staging/`),
    ).toHaveLength(0);
  });
});

describe("Download my data includes support files (choice 10)", () => {
  it("zips public attachments and CDS documents under support/ and never a key", async (t) => {
    if (!inst) return t.skip();
    const { thread, message } = await threadWithMessage(s.A.org);
    const att = await staffStoreSupportFile(
      s.staff.agent,
      {
        orgId: s.A.org,
        threadId: thread,
        messageId: message,
        name: "Receipt.pdf",
        bytes: PDF,
      },
      { store },
    );
    const internal = await threadWithMessage(s.A.org, "internal");
    const hidden = await staffStoreSupportFile(
      s.staff.agent,
      {
        orgId: s.A.org,
        threadId: internal.thread,
        messageId: internal.message,
        name: "Internal.png",
        bytes: PNG,
      },
      { store },
    );
    // 12-REVIEW WR-A03: a member file still waiting for its scan stays out of the zip.
    const scanDeps = { scanner: fakeScanner("error"), store };
    const staged = await stageSupportUpload(
      s.A.ctx.editor,
      { name: "unchecked.png", bytes: PNG },
      scanDeps,
    );
    const [pending] = await attachStagedUploads(
      pb,
      s.A.ctx.editor,
      { threadId: thread, messageId: message, tokens: [staged.token] },
      scanDeps,
    );
    expect(pending!.scan).toBe("pending");
    const { id } = await requestDataDownload(s.A.ctx.owner, { run: false });
    await runDataDownloads(SYS, { org: s.A.org, store, tmpDir: tmp });
    const row = await pb.collection("data_exports").getOne(id);
    expect(row.status).toBe("ready");
    const zipped = await store.get(row.object_key as string);
    const files = unzipSync(zipped!);
    const names = Object.keys(files);
    expect(names).toContain(`support/${att.id}-receipt.pdf`);
    expect(names.some((n) => n.startsWith(`support/${hidden.id}`))).toBe(false);
    expect(names.some((n) => n.startsWith(`support/${pending!.id}`))).toBe(
      false,
    );
    expect(strFromU8(files["README.txt"]!)).toContain(
      "1 support file is still being checked and is not included.",
    );
    expect(files[`support/${att.id}-receipt.pdf`]).toEqual(PDF);
    const attKey = (await pb.collection("support_files").getOne(att.id))
      .object_key as string;
    const csvs = names.filter((x) => x.endsWith(".csv"));
    expect(csvs).toContain("support-files.csv");
    for (const n of csvs) {
      const text = strFromU8(files[n]!);
      // No support object key in any CSV (media_assets.storage_dir is P7's own column).
      expect(text).not.toContain(attKey);
      expect(text).not.toContain("/support/");
      if (/^(support|cds)-/.test(n)) expect(text).not.toContain("tenants/");
    }
  });
});
