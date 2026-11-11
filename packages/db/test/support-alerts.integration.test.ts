// 12-05: notifySupport (COMM-03, COMM-10; D97). One bell row per key, an email per event, sent
// as CDS Support from a no-reply address; filer + Owner/Admin for ticket kinds; prefs honoured;
// Viewers and other orgs never (T-12-05-02).
import { SUPPORT_COPY } from "@cds/core/support";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { bellCounts, sourceKeyIsNeedsYouKind } from "../src/alerts/list";
import { notifySupport, type SupportNotifyInput } from "../src/support/notify";
import { setAlertChannel } from "../src/today/prefs";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: SupportSeed;

const AT = new Date("2026-10-12T15:00:00.000Z");

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedSupport(pb, { now: AT });
});

afterAll(async () => {
  await inst?.stop();
});

async function rowsFor(org: string, key: string) {
  return pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org} && source_key = {:key}", {
      org,
      key,
    }),
    sort: "created",
  });
}

async function emailOf(user: string): Promise<string> {
  return String((await pb.collection("users").getOne(user)).email);
}

function reply(n: number, over: Partial<SupportNotifyInput> = {}) {
  return {
    orgId: seed.A.org,
    as: seed.staff.agent,
    type: "support.reply",
    ticket: {
      number: n,
      subject: "Menu photo is blurry",
      filer: seed.A.users.editor,
    },
    title: `CDS replied to ticket #${n}`,
    href: `/hub/support/tickets/${n}`,
    excerpt: "I swapped it for the full-size photo.",
    authorFirstName: "Mara",
    businessName: "Rivera Bakery",
    ...over,
  } satisfies SupportNotifyInput;
}

describe("notifySupport (12-05)", () => {
  it("support.reply: filer editor, owner and admin get a bell row and an email; viewer and org B nothing", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const res = await notifySupport(reply(1042), { now: AT, transport });
    expect(res).toEqual({ raised: 3, emailed: 3 });

    const rows = await rowsFor(seed.A.org, "support:ticket:1042");
    expect(rows.map((r) => r.user).sort()).toEqual(
      [seed.A.users.editor, seed.A.users.owner, seed.A.users.admin].sort(),
    );
    expect(rows.every((r) => r.type === "support.reply")).toBe(true);
    expect(rows.every((r) => r.section === "support")).toBe(true);
    expect(await rowsFor(seed.B.org, "support:ticket:1042")).toHaveLength(0);

    const to = transport.sent.map((m) => m.to).sort();
    expect(to).toEqual(
      (
        await Promise.all(
          [seed.A.users.editor, seed.A.users.owner, seed.A.users.admin].map(
            emailOf,
          ),
        )
      ).sort(),
    );
    expect(to).not.toContain(await emailOf(seed.A.users.viewer));
    for (const m of transport.sent) {
      expect(m.type).toBe("support.notify");
      expect(m.fromName).toBe("CDS Support");
      expect(m.fromAddress.startsWith("no-reply@")).toBe(true);
      expect(m.replyTo).toBeNull();
      expect(m.subject).toBe("CDS replied to ticket #1042");
      expect(m.text).toContain(SUPPORT_COPY.NO_REPLY_FOOTER);
      expect(m.text).toContain(
        'Mara from CDS replied to your ticket "Menu photo is blurry".',
      );
    }
  });

  it("two replies: two emails per person, one bell row per person", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    await notifySupport(reply(1043), { now: AT, transport });
    const second = await notifySupport(reply(1043), {
      now: new Date(AT.getTime() + 60_000),
      transport,
    });
    expect(second).toEqual({ raised: 3, emailed: 3 });
    expect(transport.sent).toHaveLength(6);
    const rows = await rowsFor(seed.A.org, "support:ticket:1043");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.read_at === "")).toBe(true);
  });

  it("a person who turned support.reply email off gets the bell row only", async (t) => {
    if (!inst) return t.skip();
    await setAlertChannel(seed.A.ctx.admin, "support.reply", "email", false);
    try {
      const transport = captureTransport();
      const res = await notifySupport(reply(1044), { now: AT, transport });
      expect(res).toEqual({ raised: 3, emailed: 2 });
      expect(transport.sent.map((m) => m.to)).not.toContain(
        await emailOf(seed.A.users.admin),
      );
      const rows = await rowsFor(seed.A.org, "support:ticket:1044");
      expect(rows.map((r) => r.user)).toContain(seed.A.users.admin);
    } finally {
      await setAlertChannel(seed.A.ctx.admin, "support.reply", "email", true);
    }
  });

  it("support.status without a filer reaches owner and admin with the status subject", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const res = await notifySupport(
      reply(1045, {
        type: "support.status",
        ticket: { number: 1045, subject: "Menu", status: "waiting_on_you" },
        title: "Ticket #1045 is now Waiting on you",
      }),
      { now: AT, transport },
    );
    expect(res.raised).toBe(2);
    expect(transport.sent[0]!.subject).toBe(
      "Ticket #1045 is now Waiting on you",
    );
  });

  it("cds.message reaches every non-viewer member under support:messages", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const res = await notifySupport(
      {
        orgId: seed.A.org,
        as: seed.staff.agent,
        type: "cds.message",
        title: "New message from CDS",
        href: "/hub/support",
        excerpt: "Your launch is booked for Monday.",
        authorFirstName: "Mara",
        businessName: "Rivera Bakery",
      },
      { now: AT, transport },
    );
    expect(res).toEqual({ raised: 3, emailed: 3 });
    const rows = await rowsFor(seed.A.org, "support:messages");
    expect(rows.map((r) => r.user)).not.toContain(seed.A.users.viewer);
    expect(transport.sent[0]!.subject).toBe("New message from CDS");
  });

  it("refuses a member context from another org and a ticket kind without a ticket", async (t) => {
    if (!inst) return t.skip();
    await expect(
      notifySupport(reply(1046, { as: seed.B.ctx.owner })),
    ).rejects.toThrow();
    await expect(
      notifySupport(reply(1046, { ticket: undefined })),
    ).rejects.toThrow();
    await expect(
      notifySupport(
        reply(1046, { as: {} as unknown as SupportNotifyInput["as"] }),
      ),
    ).rejects.toThrow();
    expect(await rowsFor(seed.A.org, "support:ticket:1046")).toHaveLength(0);
  });
});

// 12-REVIEW CR-A01: the Built notice and the "closed" status notice are plain alerts under
// their own keys, so they never replace an unread CDS message and are never born cleared.
describe("CR-A01 idea built and ticket closed notices", () => {
  it("idea built with an unread CDS message: both rows stay, badge 2; nothing unread: badge 1", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    await notifySupport(
      {
        orgId: seed.B.org,
        as: seed.staff.agent,
        type: "cds.message",
        title: "New message from CDS",
        href: "/hub/support",
        excerpt: "Hello.",
        businessName: "Second Site",
      },
      { now: AT, transport },
    );
    const res = await notifySupport(
      {
        orgId: seed.B.org,
        as: seed.staff.agent,
        type: "cds.idea_built",
        ideaId: "idea0000000001",
        itemTitle: "Loyalty points",
        title: "An idea you voted for is built: Loyalty points",
        href: "/hub/support?tab=ideas&status=built",
        businessName: "Second Site",
      },
      { now: AT, transport },
    );
    expect(res.raised).toBe(3);
    expect(await rowsFor(seed.B.org, "support:messages")).toHaveLength(3);
    const idea = await rowsFor(seed.B.org, "cds:idea:idea0000000001");
    expect(idea).toHaveLength(3);
    expect(idea[0]!.type).toBe("cds.idea_built");
    // The message is still unread in Needs-you: both count.
    expect(
      await bellCounts(seed.B.ctx.editor, ["support:messages"], AT),
    ).toEqual({ unread: 2, urgent: 0 });
    // Nothing in Needs-you: the message row clears, the Built row still counts.
    expect(await bellCounts(seed.B.ctx.editor, [], AT)).toEqual({
      unread: 1,
      urgent: 0,
    });
    const mail = transport.sent.at(-1)!;
    expect(mail.subject).toBe("An idea you voted for is built: Loyalty points");
    expect(mail.text).toContain("Loyalty points");
    expect(mail.text).not.toContain("CDS wrote:");
  });

  it("ticket closed is a plain alert that counts on the badge", async (t) => {
    if (!inst) return t.skip();
    const before = await bellCounts(seed.B.ctx.owner, [], AT);
    await notifySupport(
      {
        orgId: seed.B.org,
        as: seed.staff.agent,
        type: "support.status",
        ticket: { number: 2001, subject: "Menu", status: "closed" },
        title: "Ticket #2001 is now Closed",
        href: "/hub/support/tickets/2001",
        businessName: "Second Site",
      },
      { now: AT, transport: captureTransport() },
    );
    expect(await rowsFor(seed.B.org, "support:ticket:2001")).toHaveLength(0);
    expect(await rowsFor(seed.B.org, "support:closed:2001")).toHaveLength(2);
    expect((await bellCounts(seed.B.ctx.owner, [], AT)).unread).toBe(
      before.unread + 1,
    );
    expect(
      sourceKeyIsNeedsYouKind("support.status", "support:closed:2001"),
    ).toBe(false);
    expect(
      sourceKeyIsNeedsYouKind("support.status", "support:ticket:2001"),
    ).toBe(true);
    expect(sourceKeyIsNeedsYouKind("cds.idea_built", "cds:idea:x")).toBe(false);
  });
});
