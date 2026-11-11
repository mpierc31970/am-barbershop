// 12-21: incidents on the real PocketBase binary (COMM-12, D103; T-12-21-01..03). Staff open,
// link and resolve; resolving moves every linked open ticket with one system line and one
// alert each. The tenant view is the org's own linked ticket only: title, public text, status,
// never a count or another organization.
import "@cds/addon-registry/server";
import { NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintPlatformContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import {
  INCIDENT_LINKED_LINE,
  fileTicket,
  incidentForTicket,
  listThreadMessages,
  staffLinkTicketToIncident,
  staffListIncidents,
  staffOpenIncident,
  staffResolveIncident,
  staffSetTicketStatus,
} from "../src/support";
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
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSupportLimitsForTests();
});

function clock(at: Date) {
  return { now: () => at };
}

async function fileA(subject: string): Promise<number> {
  return (
    await fileTicket(
      s.A.ctx.editor,
      { type: "problem", subject, body: "The booking page will not load." },
      { clock: clock(AT) },
    )
  ).number;
}

async function fileB(subject: string): Promise<number> {
  return (
    await fileTicket(
      s.B.ctx.editor,
      { type: "problem", subject, body: "Our booking page is blank." },
      { clock: clock(AT) },
    )
  ).number;
}

async function threadOf(number: number) {
  return pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
}

async function statusAlerts(org: string, number: number) {
  return pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org} && source_key = {:key}", {
      org,
      key: `support:ticket:${number}`,
    }),
  });
}

describe("staff incidents (choices 1-3)", () => {
  it("open → I-n, link across two orgs, resolve moves both with one line and one alert each", async (t) => {
    if (!inst) return t.skip();
    const opened = await staffOpenIncident(
      s.staff.agent,
      {
        title: "Booking pages not loading",
        publicText: "We are fixing a problem with booking pages.",
      },
      { clock: clock(AT) },
    );
    expect(opened.code).toMatch(/^I-\d+$/);
    const openAudit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.incident_opened' && target_id = {:id}",
        { id: opened.id },
      ),
    });
    expect(openAudit).toHaveLength(1);
    expect(openAudit[0]!.organization).toBe("");

    const a = await fileA("Booking down");
    const b = await fileB("Booking blank");
    const linkA = await staffLinkTicketToIncident(s.staff.agent, {
      incident: opened.code,
      number: a,
    });
    expect(linkA).toMatchObject({ linked: true, orgId: s.A.org, number: a });
    await staffLinkTicketToIncident(s.staff.agent, {
      incident: opened.id,
      number: b,
    });
    // Linking again changes nothing.
    expect(
      (
        await staffLinkTicketToIncident(s.staff.agent, {
          incident: opened.code,
          number: a,
        })
      ).linked,
    ).toBe(false);

    const rowA = await threadOf(a);
    expect(rowA.incident).toBe(opened.id);
    const msgsA = await listThreadMessages(s.A.ctx.owner, rowA.id);
    expect(
      msgsA.messages.filter((m) => m.event === INCIDENT_LINKED_LINE),
    ).toHaveLength(1);
    // Linking raises no alert.
    expect(await statusAlerts(s.A.org, a)).toHaveLength(0);
    const linkAudit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.incident_linked' && target_id = {:t}",
        { t: rowA.id },
      ),
    });
    expect(linkAudit).toHaveLength(1);
    expect(linkAudit[0]!.organization).toBe(s.A.org);

    const listed = await staffListIncidents(s.staff.agent);
    expect(listed.find((r) => r.id === opened.id)?.linked).toBe(2);

    const transport = captureTransport();
    const res = await staffResolveIncident(
      s.staff.agent,
      { incident: opened.code, message: "Fixed: booking pages load again." },
      { clock: clock(new Date(AT.getTime() + 3_600_000)), transport },
    );
    expect(res).toMatchObject({
      code: opened.code,
      moved: 2,
      alerts: 2,
      skipped: 0,
    });

    for (const [org, n, ctx] of [
      [s.A.org, a, s.A.ctx.owner],
      [s.B.org, b, s.B.ctx.owner],
    ] as const) {
      const row = await threadOf(n);
      expect(row.status).toBe("resolved");
      expect(row.resolved_at).not.toBe("");
      const msgs = await listThreadMessages(ctx, row.id);
      expect(
        msgs.messages.filter(
          (m) => m.event === "CDS changed the status to Resolved",
        ),
      ).toHaveLength(1);
      expect(
        msgs.messages.filter(
          (m) =>
            m.authorKind === "staff" &&
            m.body === "Fixed: booking pages load again.",
        ),
      ).toHaveLength(1);
      // One bell row per person for this ticket (filer, owner, admin).
      const bell = await statusAlerts(org, n);
      expect(bell.length).toBe(3);
      const audit = await pb.collection("audit_log").getFullList({
        filter: pb.filter(
          "action = 'support.ticket_status' && target_id = {:t}",
          { t: row.id },
        ),
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.organization).toBe(org);
    }
    expect(
      transport.sent.filter((m) => m.subject.includes("Resolved")).length,
    ).toBe(6);

    const inc = await pb.collection("incidents").getOne(opened.id);
    expect(inc.status).toBe("resolved");
    expect(inc.resolved_at).not.toBe("");
    // Linking to a resolved incident is refused.
    const c = await fileA("Another booking issue");
    await expect(
      staffLinkTicketToIncident(s.staff.agent, {
        incident: opened.code,
        number: c,
      }),
    ).rejects.toThrow();
  });

  it("a linked ticket already closed stays closed on resolve", async (t) => {
    if (!inst) return t.skip();
    const opened = await staffOpenIncident(s.staff.superAdmin, {
      title: "Images slow",
      publicText: "Images are loading slowly; we are on it.",
    });
    const open = await fileA("Images slow 1");
    const closed = await fileA("Images slow 2");
    for (const n of [open, closed]) {
      await staffLinkTicketToIncident(s.staff.agent, {
        incident: opened.code,
        number: n,
      });
    }
    await staffSetTicketStatus(s.staff.agent, { number: closed, to: "closed" });
    const before = await threadOf(closed);
    const res = await staffResolveIncident(
      s.staff.agent,
      { incident: opened.code },
      { transport: captureTransport() },
    );
    expect(res.moved).toBe(1);
    expect(res.alerts).toBe(1);
    expect((await threadOf(open)).status).toBe("resolved");
    const after = await threadOf(closed);
    expect(after.status).toBe("closed");
    expect(after.updated).toBe(before.updated);
    // Re-running sweeps nothing new.
    const again = await staffResolveIncident(
      s.staff.agent,
      { incident: opened.code },
      { transport: captureTransport() },
    );
    expect(again.moved).toBe(0);
  });

  it("refuses contexts without incident_run and unknown incidents", async (t) => {
    if (!inst) return t.skip();
    const noRole = mintPlatformContext({
      actor: s.staff.agentUser,
      staffRole: "" as never,
      ip: "127.0.0.1",
    });
    await expect(
      staffOpenIncident(noRole, { title: "x", publicText: "y" }),
    ).rejects.toThrow();
    await expect(
      staffResolveIncident(noRole, { incident: "I-1" }),
    ).rejects.toThrow();
    await expect(
      staffOpenIncident(s.A.ctx.owner as never, {
        title: "x",
        publicText: "y",
      }),
    ).rejects.toThrow();
    await expect(
      staffResolveIncident(s.staff.agent, { incident: "I-999999" }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      staffOpenIncident(s.staff.agent, { title: "", publicText: "y" }),
    ).rejects.toThrow();
    await expect(
      staffOpenIncident(s.staff.agent, {
        title: "x".repeat(81),
        publicText: "y",
      }),
    ).rejects.toThrow();
  });
});

describe("incidentForTicket (choices 4-5)", () => {
  it("org A sees exactly title, public_text, status; nothing about org B; B gets NotFound", async (t) => {
    if (!inst) return t.skip();
    const opened = await staffOpenIncident(s.staff.agent, {
      title: "Email delays",
      publicText: "Some emails are arriving late. We are fixing it.",
    });
    const a = await fileA("Emails late");
    const b = await fileB("Emails late too");
    const unlinked = await fileA("Unrelated");
    for (const n of [a, b]) {
      await staffLinkTicketToIncident(s.staff.agent, {
        incident: opened.code,
        number: n,
      });
    }

    const view = await incidentForTicket(s.A.ctx.viewer, a);
    expect(view).not.toBeNull();
    expect(Object.keys(view!).sort()).toEqual([
      "public_text",
      "status",
      "title",
    ]);
    expect(view).toEqual({
      title: "Email delays",
      public_text: "Some emails are arriving late. We are fixing it.",
      status: "open",
    });

    const json = JSON.stringify(view);
    const orgB = await pb.collection("organizations").getOne(s.B.org);
    expect(json).not.toContain(s.B.org);
    expect(json).not.toContain(String(orgB.name));
    expect(json).not.toContain(opened.id);
    expect(json).not.toContain(String(b));
    // No counts: no digits at all in this view.
    expect(json).not.toMatch(/\d/);

    await expect(incidentForTicket(s.B.ctx.owner, a)).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(
      incidentForTicket(s.A.ctx.owner, 9_999_999),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await incidentForTicket(s.A.ctx.owner, unlinked)).toBeNull();

    await staffResolveIncident(
      s.staff.agent,
      { incident: opened.code },
      { transport: captureTransport() },
    );
    expect((await incidentForTicket(s.B.ctx.owner, b))?.status).toBe(
      "resolved",
    );
  });
});
