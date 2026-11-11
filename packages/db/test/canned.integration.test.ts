// 13-15: canned replies on the real PocketBase binary (STAFF-09, D96; T-13-15-01, T-13-15-02).
// The 8 seeds, create/edit by any staff role, placeholder refusal at save, archive/restore
// with one audit row each, no delete export, and the vars a ticket fills.
import "@cds/addon-registry/server";
import { Forbidden, InvalidInput } from "@cds/core";
import { renderCanned } from "@cds/core/staff";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintPlatformContext } from "../src/context";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import * as canned from "../src/staff/canned";
import {
  staffArchiveCanned,
  staffCannedVarsFor,
  staffListCanned,
  staffRestoreCanned,
  staffSaveCanned,
} from "../src/staff/canned";
import { fileTicket } from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb
    .collection("users")
    .update(s.staff.agentUser, { name: "Mara Lopez" });
  await pb.collection("users").update(s.A.users.editor, { name: "Dana Lee" });
});

afterAll(async () => {
  await inst?.stop();
});

async function auditRows(targetId: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter(
      "target_collection = 'canned_replies' && target_id = {:id}",
      {
        id: targetId,
      },
    ),
    sort: "created,id",
  });
}

describe("canned replies CRUD (choice 2)", () => {
  it("lists the 8 seeds sorted by title", async (t) => {
    if (!inst) return t.skip();
    const rows = await staffListCanned(s.staff.agent);
    expect(rows).toHaveLength(8);
    const titles = rows.map((r) => r.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    expect(titles).toContain("Welcome");
  });

  it("support_agent creates and edits one, with created_by / updated_by and audit", async (t) => {
    if (!inst) return t.skip();
    const made = await staffSaveCanned(s.staff.agent, {
      title: "  Domain help  ",
      body: "Hi {first_name}, about {ticket} for {business}.\n\n{agent}",
    });
    expect(made.title).toBe("Domain help");
    const raw = await pb.collection("canned_replies").getOne(made.id);
    expect(raw.created_by).toBe(s.staff.agentUser);
    expect(raw.updated_by).toBe(s.staff.agentUser);

    const edited = await staffSaveCanned(s.staff.superAdmin, {
      id: made.id,
      title: "Domain help",
      body: "Hi {first_name}, done.",
    });
    expect(edited.body).toBe("Hi {first_name}, done.");
    const raw2 = await pb.collection("canned_replies").getOne(made.id);
    expect(raw2.created_by).toBe(s.staff.agentUser);
    expect(raw2.updated_by).toBe(s.staff.superAdminUser);

    const audit = await auditRows(made.id);
    expect(audit.map((r) => r.action)).toEqual([
      "canned.saved",
      "canned.saved",
    ]);
    expect(audit[0]?.organization ?? "").toBe("");
  });

  it("refuses an unknown placeholder at save and bad lengths", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffSaveCanned(s.staff.agent, {
        title: "Price",
        body: "It costs {price}.",
      }),
    ).rejects.toThrow(
      "{price} isn't a placeholder. Use {first_name}, {business}, {ticket} or {agent}.",
    );
    await expect(
      staffSaveCanned(s.staff.agent, { title: "x".repeat(81), body: "ok" }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      staffSaveCanned(s.staff.agent, { title: "Long", body: "y".repeat(5001) }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      staffSaveCanned(s.staff.agent, { title: "", body: "ok" }),
    ).rejects.toThrow(InvalidInput);
  });

  it("archive hides it, includeArchived shows it, restore brings it back; one audit row each", async (t) => {
    if (!inst) return t.skip();
    const made = await staffSaveCanned(s.staff.agent, {
      title: "Archive me",
      body: "Hi {first_name}.",
    });
    const archived = await staffArchiveCanned(s.staff.agent, made.id, {
      now: AT,
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(
      (await staffListCanned(s.staff.agent)).map((r) => r.id),
    ).not.toContain(made.id);
    expect(
      (await staffListCanned(s.staff.agent, { includeArchived: true })).map(
        (r) => r.id,
      ),
    ).toContain(made.id);

    // Archiving twice is a no-op: no second audit row.
    await staffArchiveCanned(s.staff.agent, made.id, { now: AT });

    const restored = await staffRestoreCanned(s.staff.agent, made.id);
    expect(restored.archivedAt).toBeNull();
    expect((await staffListCanned(s.staff.agent)).map((r) => r.id)).toContain(
      made.id,
    );

    const audit = await auditRows(made.id);
    expect(audit.map((r) => r.action)).toEqual([
      "canned.saved",
      "canned.archived",
      "canned.restored",
    ]);
  });

  it("the module exports no delete function", () => {
    expect(Object.keys(canned).filter((k) => /delete|remove/i.test(k))).toEqual(
      [],
    );
  });

  it("refuses a context that is not a minted staff context, and a non-staff role", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffListCanned({
        actor: "x",
        staffRole: "super_admin",
        ip: "",
      } as never),
    ).rejects.toThrow();
    const bogus = mintPlatformContext({
      actor: s.staff.agentUser,
      staffRole: "nobody" as never,
      ip: "127.0.0.1",
    });
    await expect(staffListCanned(bogus)).rejects.toThrow(Forbidden);
  });
});

describe("staffCannedVarsFor (choice 3)", () => {
  it("returns the filer's first name, business, number and the agent's first name", async (t) => {
    if (!inst) return t.skip();
    resetSupportLimitsForTests();
    const filed = await fileTicket(
      s.A.ctx.editor,
      { type: "question", subject: "Domain", body: "How do I add my domain?" },
      { clock: { now: () => AT } },
    );
    const vars = await staffCannedVarsFor(s.staff.agent, filed.number, {
      now: AT,
    });
    const org = await pb.collection("organizations").getOne(s.A.org);
    expect(vars).toEqual({
      first_name: "Dana",
      business: String(org.name),
      ticket: filed.number,
      agent: "Mara",
    });
    expect(renderCanned("Hi {first_name}, {ticket} · {agent}", vars)).toBe(
      `Hi Dana, #${filed.number} · Mara`,
    );

    // A staff member with no name signs as CDS; a filer with no name is "there".
    await pb.collection("users").update(s.A.users.editor, { name: "" });
    const v2 = await staffCannedVarsFor(s.staff.superAdmin, filed.number, {
      now: AT,
    });
    expect(v2.first_name).toBe("there");
    expect(v2.agent).toBe("CDS");
    await pb.collection("users").update(s.A.users.editor, { name: "Dana Lee" });
  });
});
