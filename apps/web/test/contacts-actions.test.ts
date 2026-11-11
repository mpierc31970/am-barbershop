// 07-16 Task 1: Contacts actions (CONTACTS-01/02, D132; T-07-16-01..05). The session and
// @cds/db are mocked; the real runAction maps refusals to copy. The actions never take a
// tenant id, and only allow-listed keys reach the chokepoint.
import { Forbidden, InvalidInput } from "@cds/core";
import { MAX_IMPORT_BYTES } from "@cds/core/csv";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const db = vi.hoisted(() => ({
  saveContact: vi.fn(),
  withdrawConsent: vi.fn(),
  deleteContact: vi.fn(),
  addContactNote: vi.fn(),
  deleteContactNote: vi.fn(),
  exportContactsCsv: vi.fn(),
  contactsCsvTemplate: vi.fn(),
  readContactImportHeader: vi.fn(),
  previewContactImport: vi.fn(),
  commitContactImport: vi.fn(),
}));

// ContactExists as 07-11 defines it: InvalidInput with the other contact's id and label.
const ContactExists = vi.hoisted(() => {
  return class ContactExistsMock extends Error {
    readonly code = "invalid_input";
    readonly contactId: string;
    readonly label: string;
    constructor(email: string, id: string, name: string) {
      super(`${email} is already a contact.`);
      this.contactId = id;
      this.label = name || email;
    }
  };
});

vi.mock("@cds/db", () => ({
  ...db,
  ContactExists,
  CONTACT_IMPORT_TARGETS: [
    "name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "tags",
    "skip",
  ],
}));

const a = await import("../app/actions/contacts");
const { revalidatePath } = await import("next/cache");

const ROW = { id: "c1", email: "maria@x.co", name: "Maria", tags: [] };

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
  vi.mocked(revalidatePath).mockClear();
});

describe("saveContactAction", () => {
  it("forwards only id, name, email, phone and tags with the session context (D132)", async () => {
    db.saveContact.mockResolvedValue(ROW);
    const res = await a.saveContactAction({
      id: "c1",
      name: "Maria",
      email: "maria@x.co",
      phone: "512",
      tags: ["VIP"],
      organization: "B",
      marketing_consent: { status: "confirmed" },
      first_source: "import",
    });
    expect(res).toEqual({ ok: true, data: { saved: ROW } });
    expect(db.saveContact).toHaveBeenCalledWith(CTX, {
      id: "c1",
      name: "Maria",
      email: "maria@x.co",
      phone: "512",
      tags: ["VIP"],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/hub/marketing");
  });

  it("adding sends no id", async () => {
    db.saveContact.mockResolvedValue(ROW);
    await a.saveContactAction({ id: "", email: "m@x.co" });
    expect(db.saveContact).toHaveBeenCalledWith(CTX, { email: "m@x.co" });
  });

  it("a duplicate email comes back as {exists} with an Open target", async () => {
    db.saveContact.mockRejectedValue(
      new ContactExists("maria@x.co", "c9", "Maria Lopez"),
    );
    const res = await a.saveContactAction({ email: "maria@x.co" });
    expect(res).toEqual({
      ok: true,
      data: {
        exists: {
          id: "c9",
          label: "Maria Lopez",
          message: "maria@x.co is already a contact.",
        },
      },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses bad tag shapes before the chokepoint", async () => {
    const cases: [unknown, RegExp][] = [
      ["VIP", /list of words/],
      [[1, 2], /list of words/],
      [Array.from({ length: 21 }, (_, i) => `t${i}`), /up to 20 tags/],
      [["x".repeat(41)], /under 40 characters/],
    ];
    for (const [tags, copy] of cases) {
      const res = await a.saveContactAction({ email: "m@x.co", tags });
      expect(res).toMatchObject({ ok: false, code: "invalid_input" });
      expect(res.ok ? "" : res.message).toMatch(copy);
    }
    expect(db.saveContact).not.toHaveBeenCalled();
  });

  it("a malformed id gets the GONE copy", async () => {
    const res = await a.saveContactAction({
      id: "../org2/c1",
      email: "m@x.co",
    });
    expect(res).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "This was removed or moved. Reload the page to see the latest.",
    });
    expect(db.saveContact).not.toHaveBeenCalled();
  });

  it("a non-object payload is refused", async () => {
    const res = await a.saveContactAction(["x"]);
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("Forbidden from the chokepoint (staff writing) is the forbidden copy", async () => {
    db.saveContact.mockImplementation(() => {
      throw new Forbidden();
    });
    const res = await a.saveContactAction({ email: "m@x.co" });
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(res.ok ? "" : res.message).toMatch(/can't make this change/);
  });

  it("signed out never reaches the chokepoint", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await a.saveContactAction({ email: "m@x.co" });
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.saveContact).not.toHaveBeenCalled();
  });
});

describe("withdraw, delete and notes", () => {
  it("withdrawConsentAction and deleteContactAction pass the checked id only", async () => {
    await a.withdrawConsentAction("c1");
    expect(db.withdrawConsent).toHaveBeenCalledWith(CTX, "c1");
    await a.deleteContactAction("c1");
    expect(db.deleteContact).toHaveBeenCalledWith(CTX, "c1");
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    const bad = await a.deleteContactAction({ id: "c1" });
    expect(bad).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("addContactNoteAction passes {list} only when list is a valid id", async () => {
    db.addContactNote.mockResolvedValue({ id: "n1" });
    await a.addContactNoteAction("c1", "Called back");
    expect(db.addContactNote).toHaveBeenLastCalledWith(
      CTX,
      "c1",
      "Called back",
    );
    await a.addContactNoteAction("c1", "Hi", "l1");
    expect(db.addContactNote).toHaveBeenLastCalledWith(CTX, "c1", "Hi", {
      list: "l1",
    });
    await a.addContactNoteAction("c1", "Hi", "../x");
    expect(db.addContactNote).toHaveBeenLastCalledWith(CTX, "c1", "Hi");
  });

  it("a non-string note body is refused", async () => {
    const res = await a.addContactNoteAction("c1", { body: "x" });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.addContactNote).not.toHaveBeenCalled();
  });

  it("deleteContactNoteAction returns what Undo needs", async () => {
    db.deleteContactNote.mockResolvedValue({
      contact: "c1",
      list: "l1",
      body: "Hi",
    });
    const res = await a.deleteContactNoteAction("n1");
    expect(res).toEqual({
      ok: true,
      data: { contact: "c1", list: "l1", body: "Hi" },
    });
    expect(db.deleteContactNote).toHaveBeenCalledWith(CTX, "n1");
  });

  it("a non-author's note delete surfaces as the forbidden copy", async () => {
    db.deleteContactNote.mockRejectedValue(new Forbidden("nope"));
    const res = await a.deleteContactNoteAction("n1");
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("CSV", () => {
  it("export and template files", async () => {
    db.exportContactsCsv.mockResolvedValue("﻿Name,Email\n");
    db.contactsCsvTemplate.mockReturnValue("Name,Email\n");
    expect(await a.exportContactsAction()).toEqual({
      ok: true,
      data: { filename: "contacts.csv", csv: "﻿Name,Email\n" },
    });
    expect(db.exportContactsCsv).toHaveBeenCalledWith(CTX);
    expect(await a.contactsTemplateAction()).toEqual({
      ok: true,
      data: { filename: "contacts-template.csv", csv: "Name,Email\n" },
    });
  });

  it("header read passes the text", async () => {
    db.readContactImportHeader.mockResolvedValue({ header: ["E-mail"] });
    await a.readContactImportHeaderAction("E-mail\na@b.co\n");
    expect(db.readContactImportHeader).toHaveBeenCalledWith(
      CTX,
      "E-mail\na@b.co\n",
    );
  });

  it("text that is not a string or is too big never reaches the chokepoint", async () => {
    for (const text of [42, null, "x".repeat(MAX_IMPORT_BYTES + 1)]) {
      const res = await a.previewContactImportAction(text, {});
      expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    }
    const res = await a.readContactImportHeaderAction({ text: "x" });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.previewContactImport).not.toHaveBeenCalled();
    expect(db.readContactImportHeader).not.toHaveBeenCalled();
  });

  it("preview forwards a checked mapping and a trimmed tagAll", async () => {
    db.previewContactImport.mockResolvedValue({ merged: 3 });
    await a.previewContactImportAction("csv", {
      mapping: ["email", "skip", "name"],
      tagAll: "  Spring fair 2026 ",
      organization: "B",
    });
    expect(db.previewContactImport).toHaveBeenCalledWith(CTX, "csv", {
      mapping: ["email", "skip", "name"],
      tagAll: "Spring fair 2026",
    });
    await a.previewContactImportAction("csv", { tagAll: "   " });
    expect(db.previewContactImport).toHaveBeenLastCalledWith(CTX, "csv", {});
    await a.previewContactImportAction("csv");
    expect(db.previewContactImport).toHaveBeenLastCalledWith(CTX, "csv", {});
  });

  it("refuses a bad mapping or tagAll", async () => {
    const bad: unknown[] = [
      { mapping: "email" },
      { mapping: ["email", "organization"] },
      { mapping: Array.from({ length: 101 }, () => "skip") },
      { mapping: [1] },
      { tagAll: "x".repeat(41) },
      { tagAll: 5 },
      ["mapping"],
    ];
    for (const extras of bad) {
      const res = await a.previewContactImportAction("csv", extras);
      expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(db.previewContactImport).not.toHaveBeenCalled();
  });

  it("commit maps {added, updated} to the dialog's ImportCommitResult and refreshes", async () => {
    db.commitContactImport.mockResolvedValue({ added: 12, updated: 30 });
    const res = await a.commitContactImportAction("csv", { tagAll: "Fair" });
    expect(res).toEqual({
      ok: true,
      data: { added: 12, updated: 30, removed: 0, backupId: "" },
    });
    expect(db.commitContactImport).toHaveBeenCalledWith(CTX, "csv", {
      tagAll: "Fair",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/hub/marketing");
  });

  it("a refused commit keeps the chokepoint's row copy and does not refresh", async () => {
    db.commitContactImport.mockRejectedValue(
      new InvalidInput("2 rows need fixing."),
    );
    const res = await a.commitContactImportAction("csv", {});
    expect(res).toEqual({
      ok: false,
      code: "invalid_input",
      message: "2 rows need fixing.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
