// 13-36: the @cds/db reads and writes the Tickets › Incidents and Service windows tabs added
// (STAFF-10, STAFF-12): staffIncidentTickets (linked tickets across orgs, with business names),
// the `sites` count on staffListIncidents, staffUnlinkTicketFromIncident (clears the link,
// audited under the ticket's org; the tenant box goes away) and staffWindowTargets (one site's
// pages and active add-ons). Non-staff contexts are refused.
import "@cds/addon-registry/server";
import { Forbidden, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintPlatformContext } from "../src/context";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import {
  fileTicket,
  incidentForTicket,
  staffIncidentTickets,
  staffLinkTicketToIncident,
  staffListIncidents,
  staffOpenIncident,
  staffUnlinkTicketFromIncident,
  staffWindowTargets,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z");
const clock = { now: () => AT };

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSupportLimitsForTests();
});

describe("incident console reads and unlink", () => {
  it("lists linked tickets with names, counts sites, unlinks with an org audit row", async (t) => {
    if (!inst) return t.skip();
    const inc = await staffOpenIncident(
      s.staff.agent,
      {
        title: "Uploads failing",
        publicText: "Photo uploads fail; we're on it.",
      },
      { clock },
    );
    const file = async (ctx: typeof s.A.ctx.editor, subject: string) =>
      (
        await fileTicket(
          ctx,
          { type: "problem", subject, body: "Uploads fail." },
          { clock },
        )
      ).number;
    const a1 = await file(s.A.ctx.editor, "Upload one");
    const a2 = await file(s.A.ctx.editor, "Upload two");
    const b1 = await file(s.B.ctx.editor, "Upload three");
    for (const n of [a1, a2, b1]) {
      await staffLinkTicketToIncident(s.staff.agent, {
        incident: inc.code,
        number: n,
      });
    }
    const row = (
      await staffListIncidents(s.staff.agent, { includeResolved: true })
    ).find((r) => r.code === inc.code);
    expect(row).toMatchObject({ linked: 3, sites: 2 });

    const tickets = await staffIncidentTickets(s.staff.agent, inc.code);
    expect(tickets.map((x) => x.number)).toEqual(
      [a1, a2, b1].sort((x, y) => x - y),
    );
    expect(tickets.every((x) => x.business.length > 0)).toBe(true);
    expect(new Set(tickets.map((x) => x.orgId))).toEqual(
      new Set([s.A.org, s.B.org]),
    );

    const un = await staffUnlinkTicketFromIncident(s.staff.agent, {
      incident: inc.code,
      number: `#${a2}`,
    });
    expect(un).toMatchObject({ unlinked: true, orgId: s.A.org, number: a2 });
    expect(await incidentForTicket(s.A.ctx.owner, a2)).toBeNull();
    expect(await incidentForTicket(s.A.ctx.owner, a1)).not.toBeNull();
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.incident_unlinked' && organization = {:org}",
        { org: s.A.org },
      ),
    });
    expect(audit).toHaveLength(1);
    // Again: nothing to change.
    expect(
      (
        await staffUnlinkTicketFromIncident(s.staff.agent, {
          incident: inc.code,
          number: a2,
        })
      ).unlinked,
    ).toBe(false);
    expect(await staffIncidentTickets(s.staff.agent, inc.id)).toHaveLength(2);
    await expect(
      staffIncidentTickets(s.staff.agent, "I-999999"),
    ).rejects.toThrow(NotFound);
  });

  it("a non-staff platform context is refused", async (t) => {
    if (!inst) return t.skip();
    const nobody = mintPlatformContext({
      actor: "x",
      staffRole: "" as never,
      ip: "127.0.0.1",
    });
    await expect(staffIncidentTickets(nobody, "I-1")).rejects.toThrow(
      Forbidden,
    );
    await expect(
      staffUnlinkTicketFromIncident(nobody, { incident: "I-1", number: 1000 }),
    ).rejects.toThrow(Forbidden);
    await expect(staffWindowTargets(nobody, s.A.org)).rejects.toThrow(
      Forbidden,
    );
  });
});

describe("staffWindowTargets", () => {
  it("returns that site's pages and active add-ons only", async (t) => {
    if (!inst) return t.skip();
    const t1 = await staffWindowTargets(s.staff.agent, s.A.org);
    expect(t1.pages.some((p) => p.id === s.A.livePage)).toBe(true);
    expect(t1.activeAddons).toContain(s.A.addon);
    const t2 = await staffWindowTargets(s.staff.agent, s.B.org);
    expect(t2.pages.some((p) => p.id === s.A.livePage)).toBe(false);
    await expect(
      staffWindowTargets(s.staff.agent, "zzzzzzzzzzzzzzz"),
    ).rejects.toThrow(NotFound);
  });
});
