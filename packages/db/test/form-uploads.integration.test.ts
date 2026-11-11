// Forms Pro file uploads (BILL-14, D233, D234; 10-38; T-10-38-01..05) against the real
// PocketBase 0.39.11 binary: type + magic-byte checks, 10 MB / 1 GB limits, scan before store
// (fail closed), private storage under tenants/<org>/forms/, hidden fields when uploads are
// closed, org-scoped download and delete-with-submission.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import {
  FILE_UPLOAD_COPY,
  FormErrors,
  isFileAnswer,
  type FormField,
} from "@cds/core/forms";
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
  deleteSubmission,
  getSubmission,
  readPublicForms,
  saveForm,
  submitForm,
  type FormRecord,
} from "../src/forms";
import type { FileScanner, FileScanVerdict } from "../src/forms/scanner-port";
import {
  FORM_UPLOAD_TYPES,
  acceptFormFiles,
  formUploadSlots,
  formUploadUsage,
  readFormFile,
} from "../src/forms/uploads";
import { unavailableScanner } from "../src/forms/scanner";
import { resetFormSubmitLimitsForTests } from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import {
  FORM_UPLOAD_ORG_MAX_BYTES,
  getObjectStore,
  tenantFormUploadPrefix,
} from "../src/storage";
import type { OrgContext } from "../src/context";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const ENV_KEYS = ["CDS_STORAGE_DIR", "CDS_PUBLIC_STORAGE_DIR"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let privDir: string;
let pubDir: string;
let ipCounter = 0;

function deps(): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
}

function scanner(verdict: FileScanVerdict): FileScanner & { calls: number } {
  const s = {
    name: "clamd" as const,
    calls: 0,
    async scan(input: AsyncIterable<Uint8Array>): Promise<FileScanVerdict> {
      s.calls += 1;
      for await (const _ of input) void _;
      return verdict;
    },
  };
  return s;
}

function nextIp(): string {
  ipCounter += 1;
  return `10.38.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
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
  field("photo", "file", "Your photo"),
];

function pdf(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
  return b;
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Maria Lopez",
    email: "maria@example.com",
    website_url: "",
    _started: String(Date.now() - 10_000),
    ...over,
  };
}

async function uploadForm(ctx: OrgContext): Promise<FormRecord> {
  const { form } = await createForm(ctx, deps(), {
    template: "blank",
    name: "Photo request",
  });
  return (
    await saveForm(ctx, deps(), {
      ...form,
      fields: FIELDS,
      notify_route: "default",
    })
  ).form;
}

async function objectsOf(orgId: string): Promise<string[]> {
  return (await getObjectStore().list(tenantFormUploadPrefix(orgId))).map(
    (o) => o.key,
  );
}

async function mediaCount(orgId: string): Promise<number> {
  return (
    await pb.collection("media_assets").getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: orgId }),
      fields: "id",
    })
  ).totalItems;
}

/** A stored submission carrying a file answer of `size` bytes (usage seeding). */
async function seedUsage(
  orgId: string,
  formId: string,
  size: number,
): Promise<string> {
  const row = await pb.collection("form_submissions").create({
    organization: orgId,
    form: formId,
    form_name: "Seed",
    data: {
      photo: {
        file_id: "seedfile0000001",
        name: "big.pdf",
        size,
        type: "application/pdf",
      },
    },
    labels: {},
    spam: false,
  });
  return row.id;
}

let formA: FormRecord;
let siteA: SiteContext;

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-form-uploads-priv-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-form-uploads-pub-"));
  process.env.CDS_STORAGE_DIR = privDir;
  process.env.CDS_PUBLIC_STORAGE_DIR = pubDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  // A: Studio (Builder Pro included at $0, 10-17). B: Standard without Builder Pro.
  await pb.collection("organizations").update(seed.A.org, { path: "studio" });
  await pb.collection("organizations").update(seed.B.org, { path: "standard" });
  formA = await uploadForm(seed.ctxA);
  siteA = await site("a.example.com");
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(privDir, { recursive: true, force: true });
  rmSync(pubDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetFormSubmitLimitsForTests();
});

describe("accept: check, scan, store privately", () => {
  it("stores a 1 MB PDF under tenants/<org>/forms/<form>/<submission>/ as a file answer", async (t) => {
    if (!inst) return t.skip();
    const media = await mediaCount(seed.A.org);
    const scan = scanner("clean");
    const res = await submitForm(
      siteA,
      formA.id,
      payload(),
      {
        ip: nextIp(),
        files: [
          {
            field: "photo",
            name: "C:\\fakepath\\passport.pdf",
            type: "application/pdf",
            bytes: pdf(1024 * 1024),
          },
        ],
      },
      { transport: captureTransport(), scanner: scan },
    );
    expect(scan.calls).toBe(1);
    const row = await pb.collection("form_submissions").getOne(res.id);
    const answer = (row.data as Record<string, unknown>).photo;
    expect(isFileAnswer(answer)).toBe(true);
    expect(answer).toMatchObject({
      name: "passport.pdf",
      size: 1024 * 1024,
      type: "application/pdf",
    });
    expect(JSON.stringify(row.data)).not.toContain("tenants/");
    const keys = await objectsOf(seed.A.org);
    const mine = keys.filter((k) =>
      k.includes(`/forms/${formA.id}/${res.id}/`),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatch(/\.pdf$/);
    // Never the public store, never the media allowance (D234).
    expect(await mediaCount(seed.A.org)).toBe(media);
    expect(await formUploadUsage(seed.ctxA)).toMatchObject({
      usedBytes: 1024 * 1024,
      level: "ok",
    });

    // The inbox detail carries the file (no key) and the owner can download it.
    const detail = await getSubmission(seed.ctxA, res.id);
    expect(detail.files).toEqual([
      {
        id: (answer as { file_id: string }).file_id,
        label: "Your photo",
        name: "passport.pdf",
        size: 1024 * 1024,
        type: "application/pdf",
      },
    ]);
    expect(detail.answers.map((a) => a.label)).not.toContain("Your photo");
    const file = await readFormFile(
      seed.ctxA,
      (answer as { file_id: string }).file_id,
    );
    expect(file.name).toBe("passport.pdf");
    const bytes = new Uint8Array(await new Response(file.stream).arrayBuffer());
    expect(bytes.byteLength).toBe(1024 * 1024);
    expect(bytes[0]).toBe(0x25);

    // Another org's context never reaches it (T-10-38-04).
    await expect(
      readFormFile(seed.ctxB, (answer as { file_id: string }).file_id),
    ).rejects.toBeInstanceOf(NotFound);

    // Deleting the submission deletes its files.
    await deleteSubmission(seed.ctxA, res.id);
    const after = await objectsOf(seed.A.org);
    expect(after.some((k) => k.includes(`/${res.id}/`))).toBe(false);
    await expect(
      readFormFile(seed.ctxA, (answer as { file_id: string }).file_id),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("refuses an oversize file, a disguised type and anything at the 1 GB limit", async (t) => {
    if (!inst) return t.skip();
    const before = await objectsOf(seed.A.org);
    const send = (bytes: Uint8Array, name = "doc.pdf") =>
      acceptFormFiles(
        siteA,
        formA.id,
        "subtest00000001",
        [{ field: "photo", name, type: "application/pdf", bytes }],
        { scanner: scanner("clean") },
      ).catch((e: unknown) => e);

    const big = await send(pdf(10 * 1024 * 1024 + 1));
    expect(big).toBeInstanceOf(FormErrors);
    expect((big as FormErrors).errors.photo).toBe(FILE_UPLOAD_COPY.size);

    const exe = new Uint8Array(4096);
    exe.set([0x4d, 0x5a, 0x90, 0x00]); // MZ: a Windows program renamed .pdf
    const disguised = await send(exe, "invoice.pdf");
    expect((disguised as FormErrors).errors.photo).toBe(FILE_UPLOAD_COPY.type);
    const wrongExt = await send(pdf(2048), "notes.exe");
    expect((wrongExt as FormErrors).errors.photo).toBe(FILE_UPLOAD_COPY.type);

    const seeded = await seedUsage(
      seed.A.org,
      formA.id,
      FORM_UPLOAD_ORG_MAX_BYTES,
    );
    try {
      const full = await send(pdf(2048));
      expect((full as FormErrors).errors.photo).toBe(FILE_UPLOAD_COPY.paused);
      expect((await formUploadUsage(siteA)).level).toBe("full");
    } finally {
      await pb.collection("form_submissions").delete(seeded);
    }
    expect(await objectsOf(seed.A.org)).toEqual(before);
  });

  it("an infected file is refused and nothing is stored; a scan error is the paused copy", async (t) => {
    if (!inst) return t.skip();
    const before = await objectsOf(seed.A.org);
    const infected = await submitForm(
      siteA,
      formA.id,
      payload(),
      {
        ip: nextIp(),
        files: [{ field: "photo", name: "a.pdf", type: "", bytes: pdf(4096) }],
      },
      { transport: captureTransport(), scanner: scanner("infected") },
    ).catch((e: unknown) => e);
    expect((infected as FormErrors).errors.photo).toBe(
      FILE_UPLOAD_COPY.infected,
    );

    const failed = await submitForm(
      siteA,
      formA.id,
      payload(),
      {
        ip: nextIp(),
        files: [{ field: "photo", name: "a.pdf", type: "", bytes: pdf(4096) }],
      },
      { transport: captureTransport(), scanner: scanner("error") },
    ).catch((e: unknown) => e);
    expect((failed as FormErrors).errors.photo).toBe(FILE_UPLOAD_COPY.paused);
    expect(await objectsOf(seed.A.org)).toEqual(before);
  });

  it("accepts each allowed type by magic bytes", async (t) => {
    if (!inst) return t.skip();
    const zip = new TextEncoder().encode(
      "PK\u0003\u0004....[Content_Types].xml....word/document.xml",
    );
    const heic = new Uint8Array(32);
    heic.set([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic")]);
    const cases: [string, Uint8Array][] = [
      ["a.pdf", pdf(64)],
      ["a.JPEG", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])],
      [
        "a.png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ],
      ["a.heic", heic],
      [
        "a.doc",
        new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]),
      ],
      ["a.docx", zip],
    ];
    expect(cases).toHaveLength(FORM_UPLOAD_TYPES.length);
    for (const [i, [name, bytes]] of cases.entries()) {
      const sub = `typetest0000${String(i).padStart(3, "0")}`;
      const out = await acceptFormFiles(
        siteA,
        formA.id,
        sub,
        [{ field: "photo", name, type: "", bytes }],
        { scanner: scanner("clean") },
      );
      expect(out.photo?.name).toBe(name);
      await getObjectStore()
        .list(`${tenantFormUploadPrefix(seed.A.org)}${formA.id}/${sub}/`)
        .then((objs) =>
          Promise.all(objs.map((o) => getObjectStore().delete(o.key))),
        );
    }
  });

  it("drops files (never stores) for spam and for an org without Builder Pro", async (t) => {
    if (!inst) return t.skip();
    const before = await objectsOf(seed.A.org);
    const res = await submitForm(
      siteA,
      formA.id,
      payload({ website_url: "http://spam.example" }),
      {
        ip: nextIp(),
        files: [{ field: "photo", name: "a.pdf", type: "", bytes: pdf(4096) }],
      },
      { transport: captureTransport(), scanner: scanner("clean") },
    );
    const row = await pb.collection("form_submissions").getOne(res.id);
    expect((row.data as Record<string, unknown>).photo).toBeUndefined();
    expect(await objectsOf(seed.A.org)).toEqual(before);

    // Lapse A: the file field stays on the form but takes no file (D233).
    await pb
      .collection("organizations")
      .update(seed.A.org, { path: "standard" });
    try {
      const lapsed = await submitForm(
        siteA,
        formA.id,
        payload(),
        {
          ip: nextIp(),
          files: [
            { field: "photo", name: "a.pdf", type: "", bytes: pdf(4096) },
          ],
        },
        { transport: captureTransport(), scanner: scanner("clean") },
      );
      const r = await pb.collection("form_submissions").getOne(lapsed.id);
      expect((r.data as Record<string, unknown>).photo).toBeUndefined();
      expect(await objectsOf(seed.A.org)).toEqual(before);
    } finally {
      await pb
        .collection("organizations")
        .update(seed.A.org, { path: "studio" });
    }
  });
});

describe("public form and usage", () => {
  it("shows file fields only while Builder Pro, a scanner and room are all there", async (t) => {
    if (!inst) return t.skip();
    const types = async (s: SiteContext, id: string, sc: FileScanner) =>
      (await readPublicForms(s, [id], { scanner: sc }))[id]?.fields.map(
        (f) => f.type,
      );
    expect(await types(siteA, formA.id, scanner("clean"))).toContain("file");
    expect(
      await formUploadSlots(siteA, formA.id, { scanner: scanner("clean") }),
    ).toBe(1);
    // Scanner unavailable (the stand-in): hidden.
    expect(await types(siteA, formA.id, unavailableScanner)).not.toContain(
      "file",
    );
    expect(
      await formUploadSlots(siteA, formA.id, { scanner: unavailableScanner }),
    ).toBe(0);
    // Full: hidden.
    const seeded = await seedUsage(
      seed.A.org,
      formA.id,
      FORM_UPLOAD_ORG_MAX_BYTES,
    );
    try {
      expect(await types(siteA, formA.id, scanner("clean"))).not.toContain(
        "file",
      );
    } finally {
      await pb.collection("form_submissions").delete(seeded);
    }
    // Not entitled: hidden.
    await pb
      .collection("organizations")
      .update(seed.A.org, { path: "standard" });
    try {
      expect(await types(siteA, formA.id, scanner("clean"))).not.toContain(
        "file",
      );
      expect(
        await formUploadSlots(siteA, formA.id, { scanner: scanner("clean") }),
      ).toBe(0);
    } finally {
      await pb
        .collection("organizations")
        .update(seed.A.org, { path: "studio" });
    }
  });

  it("formUploadUsage warns at 80% and is per org", async (t) => {
    if (!inst) return t.skip();
    const seeded = await seedUsage(
      seed.A.org,
      formA.id,
      Math.ceil(FORM_UPLOAD_ORG_MAX_BYTES * 0.8),
    );
    try {
      expect((await formUploadUsage(seed.ctxA)).level).toBe("warn");
      expect((await formUploadUsage(seed.ctxB)).usedBytes).toBe(0);
      expect((await formUploadUsage(seed.ctxA)).hasFileFields).toBe(true);
      expect((await formUploadUsage(seed.ctxB)).hasFileFields).toBe(false);
    } finally {
      await pb.collection("form_submissions").delete(seeded);
    }
  });
});
