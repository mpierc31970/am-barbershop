// 12-16: CDS notes and shared documents on the real PocketBase binary (COMM-02, COMM-04;
// T-12-16-01..03). Staff post notes (pinned or dated) and share documents to one org with a
// bell row and an audit row carrying the org; members with support:read list them with
// per-person unread state; removed ones are hidden; another org never sees them.
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput, NotFound } from "@cds/core";
import { mintPlatformContext } from "../src/context";
import { strToU8 } from "fflate";
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
import { captureTransport } from "../src/email/transport";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  listCdsDocuments,
  listCdsNotes,
  markDocumentsRead,
  markNotesRead,
  mintSupportFileLink,
  pinnedNoteForFromCds,
  staffPostNote,
  staffRemoveDocument,
  staffRemoveNote,
  staffShareDocument,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const PDF = strToU8("%PDF-1.7\nhello");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let root: string;
let store: LocalDiskStore;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: new Date() });
  await pb
    .collection("users")
    .update(s.staff.agentUser, { name: "Mara Lopez" });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cds-nd-store-"));
  store = new LocalDiskStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function bellRows(org: string, type: string) {
  return pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org} && type = {:type}", {
      org,
      type,
    }),
  });
}

async function auditFor(id: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("target_id = {:id}", { id }),
  });
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("CDS notes (choices 1, 3, 4)", () => {
  it("a pinned note reaches org A's writers in the bell and every member's list", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const res = await staffPostNote(
      s.staff.agent,
      {
        orgId: s.A.org,
        title: "  Your new menu page is live  ",
        body: "We published the menu.\nTake a look: https://example.com",
        pinned: true,
      },
      { transport },
    );
    expect(res.id).toMatch(/^[a-z0-9]{15}$/);
    expect(res.raised).toBeGreaterThanOrEqual(3);

    const rows = await bellRows(s.A.org, "cds.note");
    const users = rows.map((r) => r.user).sort();
    expect(users).toEqual(
      [s.A.users.owner, s.A.users.admin, s.A.users.editor].sort(),
    );
    expect(rows[0]?.title).toBe(
      "New note from CDS: Your new menu page is live",
    );

    const viewer = await listCdsNotes(s.A.ctx.viewer);
    expect(viewer.pinned.map((n) => n.id)).toEqual([res.id]);
    const note = viewer.pinned[0]!;
    expect(note.title).toBe("Your new menu page is live");
    expect(note.authorName).toBe("Mara");
    expect(note.unread).toBe(true);
    expect(Object.keys(note)).not.toContain("created_by");

    const other = await listCdsNotes(s.B.ctx.owner);
    expect(other.pinned).toEqual([]);
    expect(other.earlier).toEqual([]);

    const audit = await auditFor(res.id);
    expect(audit.map((a) => a.action)).toEqual(["support.note_posted"]);
    expect(audit[0]?.organization).toBe(s.A.org);
    expect(audit[0]?.actor).toBe(s.staff.agentUser);
  });

  it("dated notes list under earlier, newest first; unread clears per person", async (t) => {
    if (!inst) return t.skip();
    const one = await staffPostNote(s.staff.agent, {
      orgId: s.A.org,
      title: "Dated one",
      body: "First dated note",
      pinned: false,
    });
    await tick();
    const two = await staffPostNote(s.staff.agent, {
      orgId: s.A.org,
      title: "Dated two",
      body: "Second dated note",
      pinned: false,
    });
    const before = await listCdsNotes(s.A.ctx.admin);
    expect(before.earlier.map((n) => n.id).slice(0, 2)).toEqual([
      two.id,
      one.id,
    ]);
    expect(before.earlier.every((n) => n.unread)).toBe(true);

    await tick();
    await markNotesRead(s.A.ctx.admin, new Date());
    const after = await listCdsNotes(s.A.ctx.admin);
    expect([...after.pinned, ...after.earlier].some((n) => n.unread)).toBe(
      false,
    );
    // Another person's state is untouched.
    const owner = await listCdsNotes(s.A.ctx.owner);
    expect(owner.earlier.find((n) => n.id === two.id)?.unread).toBe(true);
  });

  it("a removed note disappears from lists; the removal is audited with the org", async (t) => {
    if (!inst) return t.skip();
    const n = await staffPostNote(s.staff.agent, {
      orgId: s.A.org,
      title: "Short-lived",
      body: "Gone soon",
      pinned: true,
    });
    await staffRemoveNote(s.staff.agent, { orgId: s.A.org, id: n.id });
    const list = await listCdsNotes(s.A.ctx.owner);
    expect([...list.pinned, ...list.earlier].map((x) => x.id)).not.toContain(
      n.id,
    );
    const audit = await auditFor(n.id);
    expect(audit.map((a) => a.action).sort()).toEqual([
      "support.note_posted",
      "support.note_removed",
    ]);
    expect(audit.every((a) => a.organization === s.A.org)).toBe(true);
    // Another org's id path refuses.
    await expect(
      staffRemoveNote(s.staff.agent, { orgId: s.B.org, id: n.id }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("pinnedNoteForFromCds returns the newest pinned note, trimmed for the card", async (t) => {
    if (!inst) return t.skip();
    await tick();
    const long =
      "Line one\nLine two\nLine three\nLine four\n" + "x".repeat(400);
    const n = await staffPostNote(s.staff.agent, {
      orgId: s.A.org,
      title: "Newest pin",
      body: long,
      pinned: true,
    });
    const card = await pinnedNoteForFromCds(s.A.ctx.viewer);
    expect(card?.id).toBe(n.id);
    expect(card?.title).toBe("Newest pin");
    expect(card!.text.split("\n").length).toBeLessThanOrEqual(3);
    expect(card!.text.length).toBeLessThanOrEqual(280);
    expect(card!.text.startsWith("Line one\nLine two\nLine three")).toBe(true);
    expect(await pinnedNoteForFromCds(s.B.ctx.owner)).toBeNull();
  });

  it("refuses an unknown org, bad input and a non-staff role", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffPostNote(s.staff.agent, {
        orgId: "zzzzzzzzzzzzzzz",
        title: "x",
        body: "y",
        pinned: false,
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      staffPostNote(s.staff.agent, {
        orgId: s.A.org,
        title: "x".repeat(81),
        body: "y",
        pinned: false,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffPostNote(s.staff.agent, {
        orgId: s.A.org,
        title: "ok",
        body: "   ",
        pinned: false,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    // Every staff role holds cds_post today; a forged role is refused by authorizeStaff.
    const forged = mintPlatformContext({
      actor: s.staff.agentUser,
      staffRole: "nobody" as never,
      ip: "127.0.0.1",
    });
    await expect(
      staffPostNote(forged, {
        orgId: s.A.org,
        title: "x",
        body: "y",
        pinned: false,
      }),
    ).rejects.toThrow();
    // A member context is not a platform context.
    await expect(
      staffPostNote(s.A.ctx.owner as never, {
        orgId: s.A.org,
        title: "x",
        body: "y",
        pinned: false,
      }),
    ).rejects.toThrow();
  });
});

describe("CDS documents (choices 2, 3)", () => {
  it("shares a PDF: staff scan, row, cds.document bell, listed without the key", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const doc = await staffShareDocument(
      s.staff.agent,
      {
        orgId: s.A.org,
        title: "Brand guide",
        note: "Colours and fonts for your site",
        filename: "Brand Guide.pdf",
        bytes: PDF,
      },
      { store, transport },
    );
    expect(doc.id).toMatch(/^[a-z0-9]{15}$/);
    const row = await pb.collection("cds_documents").getOne(doc.id);
    expect(row.organization).toBe(s.A.org);
    expect(String(row.object_key)).toContain(`tenants/${s.A.org}/`);
    expect(row.mime).toBe("application/pdf");
    expect(row.size).toBe(PDF.byteLength);
    expect(await store.get(String(row.object_key))).toBeTruthy();

    const rows = await bellRows(s.A.org, "cds.document");
    expect(
      rows.some((r) => r.title === "CDS shared a document: Brand guide"),
    ).toBe(true);
    const audit = await auditFor(doc.id);
    expect(audit.map((a) => a.action)).toEqual(["support.document_shared"]);
    expect(audit[0]?.organization).toBe(s.A.org);

    const list = await listCdsDocuments(s.A.ctx.viewer);
    const item = list.find((d) => d.id === doc.id)!;
    expect(item.title).toBe("Brand guide");
    expect(item.note).toBe("Colours and fonts for your site");
    expect(item.authorName).toBe("Mara");
    expect(item.unread).toBe(true);
    expect(JSON.stringify(item)).not.toContain("tenants/");
    expect(Object.keys(item)).not.toContain("object_key");
    expect(Object.keys(item)).not.toContain("shared_by");
    expect(await listCdsDocuments(s.B.ctx.owner)).toEqual([]);

    const link = await mintSupportFileLink(s.A.ctx.viewer, doc.id);
    expect(link).toContain(`/hub/api/support-file/${doc.id}`);
    await expect(
      mintSupportFileLink(s.B.ctx.owner, doc.id),
    ).rejects.toBeInstanceOf(NotFound);

    await tick();
    await markDocumentsRead(s.A.ctx.viewer, new Date());
    const read = await listCdsDocuments(s.A.ctx.viewer);
    expect(read.find((d) => d.id === doc.id)?.unread).toBe(false);
  });

  it("pages with limit and before", async (t) => {
    if (!inst) return t.skip();
    const ids: string[] = [];
    for (const title of ["Page one", "Page two", "Page three"]) {
      ids.push(
        (
          await staffShareDocument(
            s.staff.agent,
            { orgId: s.B.org, title, filename: "p.pdf", bytes: PDF },
            { store },
          )
        ).id,
      );
      await tick();
    }
    const first = await listCdsDocuments(s.B.ctx.owner, { limit: 2 });
    expect(first.map((d) => d.id)).toEqual([ids[2], ids[1]]);
    const next = await listCdsDocuments(s.B.ctx.owner, {
      limit: 2,
      before: first[1]!.created,
    });
    expect(next.map((d) => d.id)).toEqual([ids[0]]);
    await expect(
      listCdsDocuments(s.B.ctx.owner, { before: "not a date" }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("a removed document disappears and its link is refused", async (t) => {
    if (!inst) return t.skip();
    const doc = await staffShareDocument(
      s.staff.agent,
      { orgId: s.A.org, title: "Old contract", filename: "c.pdf", bytes: PDF },
      { store },
    );
    await staffRemoveDocument(s.staff.agent, { orgId: s.A.org, id: doc.id });
    const list = await listCdsDocuments(s.A.ctx.owner);
    expect(list.map((d) => d.id)).not.toContain(doc.id);
    await expect(
      mintSupportFileLink(s.A.ctx.owner, doc.id),
    ).rejects.toBeInstanceOf(NotFound);
    const audit = await auditFor(doc.id);
    expect(audit.map((a) => a.action).sort()).toEqual([
      "support.document_removed",
      "support.document_shared",
    ]);
  });

  it("refuses a bad file type, an unknown org and a missing title", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffShareDocument(
        s.staff.agent,
        { orgId: s.A.org, title: "x", filename: "x.exe", bytes: PDF },
        { store },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffShareDocument(
        s.staff.agent,
        { orgId: "zzzzzzzzzzzzzzz", title: "x", filename: "x.pdf", bytes: PDF },
        { store },
      ),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      staffShareDocument(
        s.staff.agent,
        { orgId: s.A.org, title: " ", filename: "x.pdf", bytes: PDF },
        { store },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
  });
});
