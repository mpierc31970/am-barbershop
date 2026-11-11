// P7 contacts attacks. Owner 07-11: real writer attacks. Every contacts function is driven with
// org B's context and org A's ids (TEN-03, invariant 1, T-07-11-01..03): reads and writes are
// NotFound, a foreign organization in the input is InvalidInput. Each key keeps its read-only
// half: the generic repo has no create/update/delete for these collections. contacts has no
// ownerField, so a renter reading it through the generic repo stays Forbidden (Pitfall 11);
// a renter with no list of their own reads nothing through listContacts (D266).
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  addContactNote,
  deleteContact,
  deleteContactNote,
  getContact,
  listContactLists,
  listContacts,
  recordContactTouch,
  saveContact,
  withdrawConsent,
} from "../../src/contacts";
import { tenantRepo } from "../../src/repository";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

export function attacks(env: AttackEnv): AttackMap {
  return {
    contacts: async () => {
      await readOnlyAttack(env, "contacts")();
      const seed = env.seed();
      const B = seed.ctxB;
      const a = seed.A.contact;
      await expect(getContact(B, a)).rejects.toThrow(NotFound);
      await expect(saveContact(B, { id: a, name: "pwned" })).rejects.toThrow(
        NotFound,
      );
      await expect(withdrawConsent(B, a)).rejects.toThrow(NotFound);
      await expect(deleteContact(B, a)).rejects.toThrow(NotFound);
      await expect(
        saveContact(B, { organization: seed.A.org, email: "x@attack.test" }),
      ).rejects.toThrow(InvalidInput);
      const row = await env.pb().collection("contacts").getOne(a);
      expect(row.name).not.toBe("pwned");
      expect(row.organization).toBe(seed.A.org);

      const repo = tenantRepo("contacts");
      await expect(repo.list(seed.ctxRenterA)).rejects.toThrow(Forbidden);
      await expect(repo.get(seed.ctxRenterA, a)).rejects.toThrow(Forbidden);
      const renterPage = await listContacts(seed.ctxRenterA2);
      expect(renterPage.items).toEqual([]);
    },
    contact_lists: async () => {
      await readOnlyAttack(env, "contact_lists")();
      const seed = env.seed();
      await expect(
        listContacts(seed.ctxB, { list: seed.A.contactList }),
      ).rejects.toThrow(NotFound);
      const ids = (await listContactLists(seed.ctxB)).map((l) => l.id);
      expect(ids).not.toContain(seed.A.contactList);
      expect(ids).toContain(seed.B.contactList);
    },
    contact_list_members: async () => {
      await readOnlyAttack(env, "contact_list_members")();
      const seed = env.seed();
      const pb = env.pb();
      const count = async () =>
        (
          await pb.collection("contact_list_members").getFullList({
            filter: pb.filter("list = {:l}", { l: seed.A.contactList }),
          })
        ).length;
      const before = await count();
      await expect(
        recordContactTouch(
          seed.ctxB,
          { email: "attack-member@x.test", source: "manual" },
          seed.A.contactList,
        ),
      ).rejects.toThrow(NotFound);
      expect(await count()).toBe(before);
    },
    contact_notes: async () => {
      await readOnlyAttack(env, "contact_notes")();
      const seed = env.seed();
      const B = seed.ctxB;
      await expect(addContactNote(B, seed.A.contact, "x")).rejects.toThrow(
        NotFound,
      );
      await expect(deleteContactNote(B, seed.A.contactNote)).rejects.toThrow(
        NotFound,
      );
      await expect(
        addContactNote(B, seed.B.contact, "x", { list: seed.A.contactList }),
      ).rejects.toThrow(NotFound);
      const note = await env
        .pb()
        .collection("contact_notes")
        .getOne(seed.A.contactNote);
      expect(note.organization).toBe(seed.A.org);
    },
    contact_events: async () => {
      await readOnlyAttack(env, "contact_events")();
      const seed = env.seed();
      await expect(getContact(seed.ctxB, seed.A.contact)).rejects.toThrow(
        NotFound,
      );
      // Events are appended only by the touch / edit paths: no public event writer exists.
      const api = Object.keys(await import("../../src/contacts"));
      expect(api.filter((k) => /event/i.test(k))).toEqual([]);
    },
  };
}
