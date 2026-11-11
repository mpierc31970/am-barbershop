// Contacts chokepoint on the real PocketBase 0.39.11 binary (CONTACTS-01, CONTACTS-02; D236,
// D266, D271, D132, D120, D-UI-P7-22; invariant 1, TEN-03; T-07-11-01..09).
import { Forbidden, InvalidContext, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { parseCsv } from "@cds/core/csv";
import {
  addContactNote,
  commitContactImport,
  ContactExists,
  deleteContact,
  deleteContactNote,
  exportContactsCsv,
  MATCH_EMAIL_COPY,
  previewContactImport,
  readContactImportHeader,
  getContact,
  listContactLists,
  listContacts,
  listContactTags,
  recordContactTouch,
  saveContact,
  withdrawConsent,
} from "../src/contacts";
import { touchContactInLock } from "../src/contacts/touch";
import { siteContextForHost } from "../src/content/site-context";
import { mintOrgContext, type OrgContext } from "../src/context";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

function ctxAs(
  orgId: string,
  role: OrgContext["role"],
  actor = seed.A.owner,
): OrgContext {
  return mintOrgContext({ orgId, actor, role, grants: [], ip: IP });
}

async function bareOrg(): Promise<{
  org: string;
  ctx: OrgContext;
  host: string;
}> {
  const slug = `ct-${Math.random().toString(36).slice(2, 10)}`;
  const org = (
    await pb.collection("organizations").create({
      name: "Contact Co",
      slug,
      status: "active",
    })
  ).id;
  const host = `${slug}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: "custom",
    primary: true,
  });
  return { org, ctx: ctxAs(org, "owner"), host };
}

const rows = (collection: string, org: string, extra = "") =>
  pb.collection(collection).getFullList({
    filter: pb.filter(`organization = {:org}${extra}`, { org }),
  });

async function site(host: string) {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

/** Renter list owned by renterA's membership, holding `contacts`, built by superuser. */
async function renterList(contacts: string[]): Promise<string> {
  const m = await pb.collection("memberships").getFirstListItem(
    pb.filter("user = {:u} && organization = {:o}", {
      u: seed.renterA,
      o: seed.A.org,
    }),
  );
  const list = (
    await pb.collection("contact_lists").create({
      organization: seed.A.org,
      name: "Renter A clients",
      kind: "renter",
      owner_member: m.id,
    })
  ).id;
  for (const c of contacts) {
    await pb.collection("contact_list_members").create({
      organization: seed.A.org,
      list,
      contact: c,
      added_at: new Date().toISOString(),
    });
  }
  return list;
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

describe("touch and merge", () => {
  it("first touch on a bare org creates the house list, contact, membership and event", async (t) => {
    if (!inst) return t.skip();
    const { org, host } = await bareOrg();
    const s = await site(host);
    const r = await recordContactTouch(s, {
      email: " Maria@Example.com ",
      name: "Maria",
      source: "form",
      ref: "sub123",
      summary: "Sent the Contact form",
    });
    expect(r.created).toBe(true);
    const lists = await rows("contact_lists", org);
    expect(lists).toHaveLength(1);
    expect(lists[0]!.name).toBe("Everyone");
    expect(lists[0]!.kind).toBe("house");
    const contacts = await rows("contacts", org);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.email_norm).toBe("maria@example.com");
    expect(contacts[0]!.first_source).toBe("form");
    expect(contacts[0]!.marketing_consent).toEqual({ status: "none" });
    expect(await rows("contact_list_members", org)).toHaveLength(1);
    const events = await rows("contact_events", org);
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe("Sent the Contact form");
    expect(events[0]!.ref).toBe("sub123");
  });

  it("a second touch in another case merges: one contact, name kept, two events", async (t) => {
    if (!inst) return t.skip();
    const { org, host } = await bareOrg();
    const s = await site(host);
    await recordContactTouch(s, {
      email: "maria@example.com",
      name: "Maria",
      source: "form",
    });
    const before = (await rows("contacts", org))[0]!;
    await new Promise((r) => setTimeout(r, 15));
    const r2 = await recordContactTouch(s, {
      email: "MARIA@example.com",
      name: "M. L.",
      phone: "512 555 0142",
      source: "form",
    });
    expect(r2.created).toBe(false);
    const contacts = await rows("contacts", org);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe("Maria");
    expect(contacts[0]!.phone).toBe("512 555 0142");
    expect(new Date(contacts[0]!.last_seen_at).getTime()).toBeGreaterThan(
      new Date(before.last_seen_at).getTime(),
    );
    expect(await rows("contact_events", org)).toHaveLength(2);
    expect(await rows("contact_list_members", org)).toHaveLength(1);
    const events = await rows("contact_events", org);
    expect(events.map((e) => e.summary)).toContain("Sent a form");
  });

  it("the same email in another org is a separate contact", async (t) => {
    if (!inst) return t.skip();
    const a = await bareOrg();
    const b = await bareOrg();
    await recordContactTouch(await site(a.host), {
      email: "same@x.co",
      source: "form",
    });
    await recordContactTouch(await site(b.host), {
      email: "same@x.co",
      source: "form",
    });
    expect(await rows("contacts", a.org)).toHaveLength(1);
    expect(await rows("contacts", b.org)).toHaveLength(1);
  });

  it("refuses a bad email, an unminted context, and an org context without write", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org } = await bareOrg();
    await expect(
      recordContactTouch(ctx, { email: "nope", source: "form" }),
    ).rejects.toThrow(InvalidInput);
    expect(() =>
      recordContactTouch({ orgId: org, host: "x" } as never, {
        email: "a@b.co",
        source: "form",
      }),
    ).toThrow(InvalidContext);
    expect(() =>
      recordContactTouch(ctxAs(org, "staff"), {
        email: "a@b.co",
        source: "form",
      }),
    ).toThrow(Forbidden);
    expect(() =>
      recordContactTouch(ctx, {
        email: "a@b.co",
        source: "form",
        organization: "zzz",
      } as never),
    ).toThrow(InvalidInput);
  });
});

describe("race backstop", () => {
  it("10 concurrent touches outside the lock leave one contact and one membership", async (t) => {
    if (!inst) return t.skip();
    const { org } = await bareOrg();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        touchContactInLock(pb, org, {
          email: "race@x.co",
          name: `R${i}`,
          source: "form",
        }),
      ),
    );
    expect(
      results.filter((r) => r.status === "fulfilled").length,
    ).toBeGreaterThan(0);
    expect(await rows("contacts", org)).toHaveLength(1);
    expect(await rows("contact_list_members", org)).toHaveLength(1);
    expect(await rows("contact_lists", org)).toHaveLength(1);
  });

  it("a direct duplicate (organization, email_norm) create is refused", async (t) => {
    if (!inst) return t.skip();
    await expect(
      pb.collection("contacts").create({
        organization: seed.A.org,
        email: "visitor-a@cds.test",
        email_norm: "visitor-a@cds.test",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("consent", () => {
  it("a tick stores unconfirmed with wording, source, form and at; later touches leave it", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await recordContactTouch(ctx, {
      email: "news@x.co",
      source: "form",
      consent: { wording: "Send me news.", form: "form1" },
    });
    const c1 = (await rows("contacts", org))[0]!;
    expect(c1.marketing_consent).toMatchObject({
      status: "unconfirmed",
      wording: "Send me news.",
      source: "form",
      form: "form1",
    });
    expect(typeof c1.marketing_consent.at).toBe("string");
    await recordContactTouch(ctx, { email: "news@x.co", source: "form" });
    expect((await rows("contacts", org))[0]!.marketing_consent).toEqual(
      c1.marketing_consent,
    );
  });

  it("confirmed stays confirmed after an unconfirmed touch", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const { contactId } = await recordContactTouch(ctx, {
      email: "c@x.co",
      source: "form",
    });
    const confirmed = {
      status: "confirmed",
      at: "2026-01-01T00:00:00Z",
      source: "subscribe",
    };
    await pb
      .collection("contacts")
      .update(contactId, { marketing_consent: confirmed });
    await recordContactTouch(ctx, {
      email: "c@x.co",
      source: "form",
      consent: { wording: "w" },
    });
    expect((await rows("contacts", org))[0]!.marketing_consent).toEqual(
      confirmed,
    );
  });
});

describe("membership visibility (D266)", () => {
  it("owner, admin and staff read the house list", async (t) => {
    if (!inst) return t.skip();
    for (const role of ["owner", "admin", "staff"] as const) {
      const page = await listContacts(ctxAs(seed.A.org, role));
      expect(page.items.map((c) => c.id)).toContain(seed.A.contact);
    }
    const lists = await listContactLists(seed.ctxA);
    expect(lists[0]).toMatchObject({ id: seed.A.contactList, kind: "house" });
  });

  it("a renter reads only their own renter list; another renter reads nothing", async (t) => {
    if (!inst) return t.skip();
    const extra = await recordContactTouch(seed.ctxA, {
      email: "renter-client@x.co",
      source: "manual",
    });
    const list = await renterList([extra.contactId]);
    const mine = await listContacts(seed.ctxRenterA);
    expect(mine.items.map((c) => c.id)).toEqual([extra.contactId]);
    expect((await listContactLists(seed.ctxRenterA)).map((l) => l.id)).toEqual([
      list,
    ]);
    const other = await listContacts(seed.ctxRenterA2);
    expect(other.items).toEqual([]);
    expect(other.totalItems).toBe(0);
    expect(await listContactLists(seed.ctxRenterA2)).toEqual([]);
    await expect(getContact(seed.ctxRenterA, seed.A.contact)).rejects.toThrow(
      NotFound,
    );
    await expect(getContact(seed.ctxRenterA2, extra.contactId)).rejects.toThrow(
      NotFound,
    );
    await expect(
      listContacts(seed.ctxRenterA, { list: seed.A.contactList }),
    ).rejects.toThrow(NotFound);
    expect(
      (await getContact(seed.ctxRenterA, extra.contactId)).contact.id,
    ).toBe(extra.contactId);
  });

  it("editor and viewer are refused", async (t) => {
    if (!inst) return t.skip();
    for (const role of ["editor", "viewer"] as const) {
      expect(() => listContacts(ctxAs(seed.A.org, role))).toThrow(Forbidden);
      expect(() => getContact(ctxAs(seed.A.org, role), seed.A.contact)).toThrow(
        Forbidden,
      );
    }
  });

  it("getContact returns history newest first and the visible lists", async (t) => {
    if (!inst) return t.skip();
    const d = await getContact(seed.ctxA, seed.A.contact);
    expect(d.contact.email).toBe("visitor-a@cds.test");
    expect(d.events.length).toBeGreaterThan(0);
    expect(d.lists.map((l) => l.id)).toEqual([seed.A.contactList]);
  });
});

describe("search and filters", () => {
  it("q, tag, source and consent narrow; sort and pagination work", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const ana = await saveContact(ctx, {
      name: "Ana Diaz",
      email: "ana@x.co",
      phone: "111 222",
      tags: ["VIP"],
    });
    await new Promise((r) => setTimeout(r, 10));
    const bob = await saveContact(ctx, {
      name: "Bob Ray",
      email: "bob@x.co",
      tags: ["Spring fair"],
    });
    await new Promise((r) => setTimeout(r, 10));
    const cy = await recordContactTouch(ctx, {
      email: "cy@x.co",
      name: "Cy",
      source: "form",
      consent: { wording: "w" },
    });
    await withdrawConsent(ctx, bob.id);

    const ids = async (o: Parameters<typeof listContacts>[1]) =>
      (await listContacts(ctx, o)).items.map((c) => c.id);
    // Withdrawing is the owner's action, not the person's: it never bumps Last activity.
    expect(await ids({})).toEqual([cy.contactId, bob.id, ana.id]);
    expect(await ids({ sort: "name" })).toEqual([ana.id, bob.id, cy.contactId]);
    expect(await ids({ q: "ana" })).toEqual([ana.id]);
    expect(await ids({ q: "BOB@" })).toEqual([bob.id]);
    expect(await ids({ q: "222" })).toEqual([ana.id]);
    expect(await ids({ tag: "VIP" })).toEqual([ana.id]);
    expect(await ids({ tag: "Spring fair" })).toEqual([bob.id]);
    expect(await ids({ source: "form" })).toEqual([cy.contactId]);
    expect(await ids({ source: "manual", sort: "name" })).toEqual([
      ana.id,
      bob.id,
    ]);
    expect(await ids({ consent: "unconfirmed" })).toEqual([cy.contactId]);
    expect(await ids({ consent: "unsubscribed" })).toEqual([bob.id]);
    expect(await ids({ consent: "none" })).toEqual([ana.id]);
    expect(await ids({ consent: "subscribed" })).toEqual([]);

    const p1 = await listContacts(ctx, { perPage: 2 });
    expect(p1).toMatchObject({
      page: 1,
      perPage: 2,
      totalItems: 3,
      totalPages: 2,
    });
    const p2 = await listContacts(ctx, { perPage: 2, page: 2 });
    expect(p2.items).toHaveLength(1);
    expect((await listContacts(ctx)).perPage).toBe(50);
    expect((await listContacts(ctx, { perPage: 1000 })).perPage).toBe(100);

    await expect(listContacts(ctx, { source: "hack" })).rejects.toThrow(
      InvalidInput,
    );
    await expect(listContacts(ctx, { consent: "confirmed" })).rejects.toThrow(
      InvalidInput,
    );
    await expect(listContacts(ctx, { sort: "email" as never })).rejects.toThrow(
      InvalidInput,
    );
    expect(await listContactTags(ctx)).toEqual(["Spring fair", "VIP"]);
  });

  it("a bare org with no house list yet reads empty without writing", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org } = await bareOrg();
    expect(await listContacts(ctx)).toEqual({
      items: [],
      page: 1,
      perPage: 50,
      totalItems: 0,
      totalPages: 0,
    });
    expect(await listContactLists(ctx)).toEqual([]);
    expect(await rows("contact_lists", org)).toHaveLength(0);
  });
});

describe("manual add and edit", () => {
  it("adds by hand with no consent, on the house list, with a manual event", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org } = await bareOrg();
    const c = await saveContact(ctx, {
      name: "Maria Lopez",
      email: "Maria@Example.com",
      phone: "512",
      tags: ["VIP", "vip"],
      marketing_consent: { status: "confirmed" },
      first_source: "form",
    });
    expect(c).toMatchObject({
      name: "Maria Lopez",
      email: "maria@example.com",
      phone: "512",
      tags: ["VIP"],
      first_source: "manual",
      consent: { status: "none" },
    });
    expect(await rows("contact_list_members", org)).toHaveLength(1);
    const ev = await rows("contact_events", org);
    expect(ev.map((e) => [e.kind, e.summary])).toEqual([
      ["manual", "Added by hand"],
    ]);
  });

  it("a duplicate email throws ContactExists with the contact id and label", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const first = await saveContact(ctx, {
      name: "Maria Lopez",
      email: "maria@example.com",
    });
    const err = await saveContact(ctx, { email: "MARIA@example.com" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ContactExists);
    expect((err as ContactExists).contactId).toBe(first.id);
    expect((err as ContactExists).label).toBe("Maria Lopez");
    expect((err as Error).message).toBe(
      "maria@example.com is already a contact.",
    );
    const other = await saveContact(ctx, { email: "sam@x.co" });
    await expect(
      saveContact(ctx, { id: other.id, email: "maria@example.com" }),
    ).rejects.toThrow(ContactExists);
  });

  it("staff is refused; a foreign organization is InvalidInput", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    expect(() => saveContact(ctxAs(org, "staff"), { email: "a@b.co" })).toThrow(
      Forbidden,
    );
    await expect(
      saveContact(ctx, { email: "a@b.co", organization: seed.B.org }),
    ).rejects.toThrow(InvalidInput);
  });

  it("edit updates only allowlisted fields; a foreign id is NotFound", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const c = await saveContact(ctx, {
      name: "Old",
      email: "e@x.co",
      phone: "123",
    });
    const u = await saveContact(ctx, {
      id: c.id,
      name: "New",
      marketing_consent: { status: "confirmed" },
      first_source: "form",
    });
    expect(u).toMatchObject({
      name: "New",
      phone: "123",
      first_source: "manual",
      consent: { status: "none" },
    });
    const u2 = await saveContact(ctx, {
      id: c.id,
      email: "E2@x.co",
      tags: ["A"],
    });
    expect(u2).toMatchObject({ email: "e2@x.co", tags: ["A"], name: "New" });
    await expect(
      saveContact(ctx, { id: seed.A.contact, name: "x" }),
    ).rejects.toThrow(NotFound);
    await expect(
      saveContact(ctx, { id: c.id, name: "n".repeat(121) }),
    ).rejects.toThrow(InvalidInput);
    await expect(saveContact(ctx, { id: c.id, tags: "VIP" })).rejects.toThrow(
      InvalidInput,
    );
  });
});

describe("withdraw", () => {
  it("sets withdrawn with at and source owner, and appends an event", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org } = await bareOrg();
    const { contactId } = await recordContactTouch(ctx, {
      email: "w@x.co",
      source: "form",
      consent: { wording: "w" },
    });
    const c = await withdrawConsent(ctx, contactId);
    expect(c.consent.status).toBe("withdrawn");
    expect(c.consent.source).toBe("owner");
    expect(typeof c.consent.at).toBe("string");
    const ev = await rows("contact_events", org);
    expect(ev.map((e) => e.summary)).toContain("Marked as unsubscribed");
    await expect(withdrawConsent(ctx, seed.A.contact)).rejects.toThrow(
      NotFound,
    );
  });
});

describe("delete", () => {
  it("removes the contact, memberships, notes, events; clears submissions; audits the id only", async (t) => {
    if (!inst) return t.skip();
    const { ctx, org } = await bareOrg();
    const { contactId } = await recordContactTouch(ctx, {
      email: "gone@x.co",
      name: "Gone",
      source: "form",
    });
    const list = (await rows("contact_lists", org))[0]!.id;
    await pb.collection("contact_notes").create({
      organization: org,
      contact: contactId,
      list,
      body: "note",
    });
    const form = await pb.collection("forms").create({
      organization: org,
      name: "Contact",
      template: "contact",
      layout: "1",
      fields: [],
      notify_route: "inquiries",
    });
    const sub = await pb.collection("form_submissions").create({
      organization: org,
      form: form.id,
      form_name: "Contact",
      data: {},
      labels: {},
      contact: contactId,
      spam: false,
    });
    await deleteContact(ctx, contactId);
    for (const col of [
      "contacts",
      "contact_list_members",
      "contact_notes",
      "contact_events",
    ]) {
      expect(await rows(col, org), col).toHaveLength(0);
    }
    expect(
      (await pb.collection("form_submissions").getOne(sub.id)).contact,
    ).toBe("");
    const audits = await rows(
      "audit_log",
      org,
      ' && action = "contact.delete"',
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.target_id).toBe(contactId);
    expect(JSON.stringify(audits[0]!.meta ?? null)).not.toContain("gone@x.co");
    await expect(deleteContact(ctx, seed.A.contact)).rejects.toThrow(NotFound);
  });
});

describe("per-list notes (D266)", () => {
  it("a note belongs to one list and never shows through another", async (t) => {
    if (!inst) return t.skip();
    const { contactId: c } = await recordContactTouch(seed.ctxA, {
      email: "notes@x.co",
      source: "manual",
    });
    const rl = await renterList([c]);
    const house = await addContactNote(seed.ctxA, c, "  Prefers mornings ");
    expect(house).toMatchObject({
      list: seed.A.contactList,
      body: "Prefers mornings",
      author: seed.A.owner,
      mine: true,
    });
    const renter = await addContactNote(seed.ctxA, c, "Renter note", {
      list: rl,
    });
    expect((await getContact(seed.ctxA, c)).notes.map((n) => n.id)).toEqual([
      house.id,
    ]);
    expect(
      (await getContact(seed.ctxA, c, { list: rl })).notes.map((n) => n.id),
    ).toEqual([renter.id]);
    const asRenter = await getContact(seed.ctxRenterA, c, { list: rl });
    expect(asRenter.notes.map((n) => n.id)).toEqual([renter.id]);
    expect(asRenter.notes[0]!.mine).toBe(false);
  });

  it("only the author deletes; delete returns the note for Undo", async (t) => {
    if (!inst) return t.skip();
    const { contactId: c } = await recordContactTouch(seed.ctxA, {
      email: "notes2@x.co",
      source: "manual",
    });
    const n = await addContactNote(seed.ctxA, c, "Call back");
    const otherAdmin = ctxAs(seed.A.org, "admin", seed.renterA);
    await expect(deleteContactNote(otherAdmin, n.id)).rejects.toThrow(
      Forbidden,
    );
    expect(await deleteContactNote(seed.ctxA, n.id)).toEqual({
      contact: c,
      list: seed.A.contactList,
      body: "Call back",
    });
    await expect(deleteContactNote(seed.ctxA, n.id)).rejects.toThrow(NotFound);
  });

  it("refuses a blank or too-long body, a contact not on the list, and staff", async (t) => {
    if (!inst) return t.skip();
    const { contactId: c } = await recordContactTouch(seed.ctxA, {
      email: "notes3@x.co",
      source: "manual",
    });
    await expect(addContactNote(seed.ctxA, c, "   ")).rejects.toThrow(
      "Write a note first.",
    );
    await expect(
      addContactNote(seed.ctxA, c, "x".repeat(5001)),
    ).rejects.toThrow("Keep notes under 5,000 characters.");
    const rl = await renterList([]);
    await expect(
      addContactNote(seed.ctxA, c, "x", { list: rl }),
    ).rejects.toThrow(NotFound);
    expect(() => addContactNote(ctxAs(seed.A.org, "staff"), c, "x")).toThrow(
      Forbidden,
    );
  });
});

describe("csv export", () => {
  it("BOM, header, formula guard; staff may export, editor may not", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await saveContact(ctx, {
      name: '=HYPERLINK("x")',
      email: "f@x.co",
      tags: ["VIP"],
    });
    await saveContact(ctx, { name: "Ana", email: "ana@x.co" });
    const csv = await exportContactsCsv(ctx);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(
      "﻿id,Name,Email,Phone,Tags,Newsletter,Source,Last activity,Added",
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const p = parseCsv(csv);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.rows.map((r) => r[1])).toEqual([`'=HYPERLINK("x")`, "Ana"]);
      expect(p.rows[1]![6]).toBe("Added by you");
    }
    expect(await exportContactsCsv(ctxAs(org, "staff"))).toBe(csv);
    expect(() => exportContactsCsv(ctxAs(org, "editor"))).toThrow(Forbidden);
  });
});

describe("csv import (additive, consent untouched)", () => {
  const FILE = [
    "Name,Email,Phone,Tags,Newsletter",
    "New Person,new@x.co,,VIP,Subscribed",
    ",MARIA@Example.com,,Spring fair,Subscribed",
    "New Again,new@x.co,999,Extra,",
    "Bad,maria@,,,",
  ].join("\n");
  const FIXED = FILE.replace("Bad,maria@,,,", "Bad,bad@x.co,,,");

  it("previews, refuses errors, then adds and updates without touching consent", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const maria = await saveContact(ctx, {
      name: "Maria",
      email: "maria@example.com",
      phone: "512",
      tags: ["Old"],
    });
    const opts = { tagAll: "Fair 2026" };
    const pre = await previewContactImport(ctx, FILE, opts);
    expect(pre.counts).toMatchObject({
      new: 1,
      updated: 1,
      unchanged: 0,
      errors: 1,
    });
    expect(pre.merged).toBe(1);
    expect(pre.ignored).toEqual(["Newsletter"]);
    expect(pre.rows.find((r) => r.status === "error")!.messages[0]).toBe(
      `Row 5: "maria@" isn't a complete email address.`,
    );
    await expect(commitContactImport(ctx, FILE, opts)).rejects.toThrow(
      "1 row needs fixing. Nothing is imported until every row is fixed.",
    );
    expect(await rows("contacts", org)).toHaveLength(1);

    expect(await commitContactImport(ctx, FIXED, opts)).toEqual({
      added: 2,
      updated: 1,
    });
    const all = await rows("contacts", org);
    expect(all).toHaveLength(3);
    const m = all.find((c) => c.id === maria.id)!;
    expect(m.name).toBe("Maria");
    expect(m.phone).toBe("512");
    expect(m.tags).toEqual(["Old", "Spring fair", "Fair 2026"]);
    expect(m.marketing_consent).toEqual({ status: "none" });
    const n = all.find((c) => c.email_norm === "new@x.co")!;
    expect(n).toMatchObject({
      name: "New Person",
      phone: "999",
      first_source: "import",
      marketing_consent: { status: "none" },
    });
    expect(n.tags).toEqual(["VIP", "Extra", "Fair 2026"]);
    const house = (await rows("contact_lists", org))[0]!.id;
    const members = await rows("contact_list_members", org);
    expect(
      members.filter((x) => x.contact === n.id && x.list === house),
    ).toHaveLength(1);
    expect(members).toHaveLength(3);
    const ev = await rows("contact_events", org, ' && kind = "import"');
    expect(ev).toHaveLength(3);
    expect(ev[0]!.summary).toBe("Imported from a spreadsheet");

    const audits = await rows(
      "audit_log",
      org,
      ' && action = "contacts.import"',
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({
      added: 2,
      updated: 1,
      chunk: 1,
      chunks: 1,
    });
    expect(JSON.stringify(audits[0]!.meta)).not.toMatch(/@/);

    // Re-running the same file changes nothing.
    expect(await commitContactImport(ctx, FIXED, opts)).toEqual({
      added: 0,
      updated: 0,
    });
    const again = await previewContactImport(ctx, FIXED, opts);
    expect(again.counts).toMatchObject({ new: 0, updated: 0, unchanged: 3 });
    expect(
      await rows("audit_log", org, ' && action = "contacts.import"'),
    ).toHaveLength(1);
  });

  it("no email column is MATCH-EMAIL; First + Last join into Name", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await expect(previewContactImport(ctx, "Name,Phone\nx,1")).rejects.toThrow(
      MATCH_EMAIL_COPY,
    );
    const file = "E-mail,First Name,Last Name,Notes\njo@x.co,Jo,Doe,private";
    const head = await readContactImportHeader(ctx, file);
    expect(head).toEqual({
      header: ["E-mail", "First Name", "Last Name", "Notes"],
      examples: ["jo@x.co", "Jo", "Doe", "private"],
      suggested: ["email", "first_name", "last_name", "skip"],
      needsMatch: true,
    });
    expect(await commitContactImport(ctx, file)).toEqual({
      added: 1,
      updated: 0,
    });
    expect((await rows("contacts", org))[0]!.name).toBe("Jo Doe");
    await expect(
      commitContactImport(ctx, file, { mapping: ["email", "name"] as never }),
    ).rejects.toThrow(InvalidInput);
    expect(() => readContactImportHeader(ctxAs(org, "staff"), file)).toThrow(
      Forbidden,
    );
  });
});

describe("csv round trip + formula guard", () => {
  it("re-importing the export is all unchanged; a foreign id in the file targets nothing", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await saveContact(ctx, {
      name: '=HYPERLINK("x")',
      email: "f@x.co",
      phone: "1 2 3",
      tags: ["VIP", "News"],
    });
    await saveContact(ctx, { name: "Ana", email: "ana@x.co" });
    const csv = await exportContactsCsv(ctx);
    const pre = await previewContactImport(ctx, csv);
    expect(pre.counts).toMatchObject({
      new: 0,
      updated: 0,
      unchanged: 2,
      errors: 0,
    });
    const before = await pb.collection("contacts").getOne(seed.B.contact);
    const tampered = csv.replace(
      /\r\n[a-z0-9]{15},Ana,/,
      `\r\n${seed.B.contact},Ana,`,
    );
    expect(tampered).toContain(seed.B.contact);
    expect(await commitContactImport(ctx, tampered)).toEqual({
      added: 0,
      updated: 0,
    });
    const after = await pb.collection("contacts").getOne(seed.B.contact);
    expect(after.name).toBe(before.name);
    expect(after.updated).toBe(before.updated);
  });
});
