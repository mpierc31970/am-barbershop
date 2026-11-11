// 12-23: the paid-services boundary inside tickets on the real PocketBase binary (SUPPORT-03,
// D297, D299, BILL-19, BILL-20; T-12-23-01..04). Staff mark a Change request paid, only the
// Owner chooses (quote or Care hour), no In progress before acceptance, quotes link to tickets.
import "@cds/addon-registry/server";
import { Forbidden, ImpersonationDenied, InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { logCareTime } from "../src/payments/care-time";
import {
  acceptWorkOrder,
  createWorkOrder,
  sendWorkOrder,
} from "../src/payments/work-orders";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import {
  PAID_ALREADY_CHOSEN_COPY,
  PAID_LINES,
  careHourInUseCopy,
  fileTicket,
  listThreadMessages,
  paidPanelFor,
  replyToTicket,
  staffCareTicketRef,
  requestPaidQuote,
  staffMarkPaidService,
  staffSetTicketStatus,
  useCareHourForTicket,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import {
  SUPPORT_SEED_CARE_USED,
  seedSupport,
  type SupportSeed,
} from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z"); // Monday 10:00 Chicago

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb.collection("users").update(s.A.users.owner, { name: "Maria Ruiz" });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSupportLimitsForTests();
});

const clock = { now: () => AT };

async function file(
  type: "change" | "question",
  subject: string,
  ctx = s.A.ctx.editor,
): Promise<number> {
  const r = await fileTicket(
    ctx,
    { type, subject, body: "Please update the hours on the home page." },
    { clock },
  );
  return r.number;
}

async function threadOf(number: number) {
  return pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
}

async function events(number: number, ctx = s.A.ctx.owner) {
  const row = await threadOf(number);
  const res = await listThreadMessages(ctx, row.id);
  return res.messages.map((m) => m.event).filter((e): e is string => !!e);
}

async function audit(action: string, threadId: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = {:a} && target_id = {:t}", {
      a: action,
      t: threadId,
    }),
  });
}

async function markedChange(subject: string): Promise<number> {
  const n = await file("change", subject);
  await staffMarkPaidService(
    s.staff.agent,
    { number: n, category: "design" },
    { clock, transport: captureTransport() },
  );
  return n;
}

describe("staffMarkPaidService (choice 1)", () => {
  it("a question ticket is refused; a Change request moves to Waiting on you and alerts", async (t) => {
    if (!inst) return t.skip();
    const q = await file("question", "How do I add a page?");
    await expect(
      staffMarkPaidService(s.staff.agent, { number: q, category: "design" }),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect((await threadOf(q)).paid_service).toBeNull();

    const n = await file("change", "New banner please");
    await expect(
      staffMarkPaidService(s.staff.agent, { number: n, category: "nope" }),
    ).rejects.toBeInstanceOf(InvalidInput);

    const transport = captureTransport();
    const res = await staffMarkPaidService(
      s.staff.agent,
      { number: n, category: "design" },
      { clock, transport },
    );
    expect(res.orgId).toBe(s.A.org);
    expect(res.raised).toBe(3); // filer (editor), owner, admin
    const row = await threadOf(n);
    expect(row.status).toBe("waiting_on_you");
    expect(row.paid_service).toMatchObject({
      category: "design",
      marked_at: AT.toISOString(),
    });
    expect(transport.sent.map((m) => m.subject)).toContain(
      `Ticket #${n} is now Waiting on you`,
    );
    const ev = await events(n);
    expect(ev.slice(-2)).toEqual([
      PAID_LINES.MARKED,
      "CDS changed the status to Waiting on you",
    ]);
    const rows = await audit("support.paid_marked", row.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(s.staff.agentUser);

    // Marking twice is refused; nothing changes.
    await expect(
      staffMarkPaidService(s.staff.agent, { number: n, category: "seo" }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("no In progress before a choice: staff and a tenant reply are both held", async (t) => {
    if (!inst) return t.skip();
    const n = await markedChange("Swap the hero photo");
    await expect(
      staffSetTicketStatus(s.staff.agent, { number: n, to: "in_progress" }),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect((await threadOf(n)).status).toBe("waiting_on_you");

    await replyToTicket(
      s.A.ctx.editor,
      n,
      { body: "Any update on this?" },
      { clock },
    );
    expect((await threadOf(n)).status).toBe("waiting_on_you");
  });
});

describe("owner choices (choices 2-4)", () => {
  it("Admin and an impersonating super_admin are refused; the Owner requests a quote once", async (t) => {
    if (!inst) return t.skip();
    const n = await markedChange("Redo the menu page");
    await expect(requestPaidQuote(s.A.ctx.admin, n)).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(requestPaidQuote(s.A.ctx.editor, n)).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(
      requestPaidQuote(s.A.impersonatedOwner, n),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    // Another org's owner cannot reach it.
    await expect(requestPaidQuote(s.B.ctx.owner, n)).rejects.toThrow();

    expect(await requestPaidQuote(s.A.ctx.owner, n, { clock })).toEqual({
      requested: true,
    });
    expect(await requestPaidQuote(s.A.ctx.owner, n, { clock })).toEqual({
      requested: false,
    });
    const panel = await paidPanelFor(s.A.ctx.owner, n, { clock });
    expect(panel).toMatchObject({
      state: "quote_requested",
      category: "design",
      helpId: "paid-services",
      canChoose: true,
      quoteRequested: true,
      quoteRequestedAt: AT.toISOString(),
    });
    expect(
      (await events(n)).filter((e) => e === PAID_LINES.QUOTE_REQUESTED),
    ).toHaveLength(1);
    expect((await threadOf(n)).status).toBe("waiting_on_you");
    const rows = await audit(
      "support.paid_quote_requested",
      (await threadOf(n)).id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(s.A.users.owner);
  });

  it("the panel: Owner sees Care minutes; an Editor gets care null and cannot choose", async (t) => {
    if (!inst) return t.skip();
    const n = await markedChange("New logo colours");
    const owner = await paidPanelFor(s.A.ctx.owner, n, { clock });
    expect(owner!.care).toEqual({
      onPlan: true,
      minutesLeft: 60 - SUPPORT_SEED_CARE_USED,
      minutesIncluded: 60,
      monthLabel: "October",
    });
    expect(owner!.careHourAvailable).toBe(true);
    expect(owner!.state).toBe("none");

    const editor = await paidPanelFor(s.A.ctx.editor, n, { clock });
    expect(editor!.care).toBeNull();
    expect(editor!.canChoose).toBe(false);
    expect(editor!.careHourAvailable).toBe(false);

    // Not a paid ticket: no panel. Another org's ticket: not found.
    const plain = await file("question", "Where are my invoices?");
    expect(await paidPanelFor(s.A.ctx.owner, plain, { clock })).toBeNull();
    await expect(paidPanelFor(s.B.ctx.owner, n, { clock })).rejects.toThrow();
  });

  it("the Owner uses the Care hour; then staff may start the work", async (t) => {
    if (!inst) return t.skip();
    const n = await markedChange("Add the new opening hours");
    await expect(useCareHourForTicket(s.A.ctx.admin, n)).rejects.toBeInstanceOf(
      Forbidden,
    );
    const res = await useCareHourForTicket(s.A.ctx.owner, n, { clock });
    expect(res).toMatchObject({ chosen: true, monthLabel: "October" });
    const row = await threadOf(n);
    expect(row.paid_service).toMatchObject({
      care_chosen_at: AT.toISOString(),
      care_chosen_by: s.A.users.owner,
    });
    expect((await events(n)).at(-1)).toBe("Maria chose the Care hour");
    const panel = await paidPanelFor(s.A.ctx.owner, n, { clock });
    expect(panel).toMatchObject({
      state: "care_chosen",
      accepted: true,
      careChosen: true,
      careHourAvailable: false,
    });
    // Idempotent, and a quote can no longer be requested.
    expect(
      (await useCareHourForTicket(s.A.ctx.owner, n, { clock })).chosen,
    ).toBe(false);
    await expect(requestPaidQuote(s.A.ctx.owner, n)).rejects.toBeInstanceOf(
      InvalidInput,
    );

    const moved = await staffSetTicketStatus(s.staff.agent, {
      number: n,
      to: "in_progress",
    });
    expect(moved.statusTo).toBe("in_progress");
    expect(await audit("support.paid_care_chosen", row.id)).toHaveLength(1);

    // 12-REVIEW WR-A04: choosing reserves the hour; a second open request is refused
    // until the first is resolved.
    const second = await markedChange("Fix the footer links");
    const busy = await useCareHourForTicket(s.A.ctx.owner, second, {
      clock,
    }).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(InvalidInput);
    expect((busy as Error).message).toBe(careHourInUseCopy(n));
    expect((await threadOf(second)).paid_service.care_chosen_at).toBeFalsy();
    await staffSetTicketStatus(s.staff.agent, { number: n, to: "resolved" });
  });

  it("a site without the Care Plan cannot use a Care hour", async (t) => {
    if (!inst) return t.skip();
    const n = await file("change", "Update the about page", s.B.ctx.editor);
    await staffMarkPaidService(
      s.staff.agent,
      { number: n, category: "copywriting" },
      { clock, transport: captureTransport() },
    );
    await expect(
      useCareHourForTicket(s.B.ctx.owner, n, { clock }),
    ).rejects.toBeInstanceOf(InvalidInput);
    const panel = await paidPanelFor(s.B.ctx.owner, n, { clock });
    expect(panel!.care).toMatchObject({ onPlan: false, minutesLeft: 0 });
  });
});

describe("work orders linked to tickets (choice 5)", () => {
  it("links to the same org's paid ticket; a foreign or unmarked ticket is refused; send shows View quote", async (t) => {
    if (!inst) return t.skip();
    const n = await markedChange("A new gallery page");
    const input = {
      orgId: s.A.org,
      kind: "custom_block" as const,
      title: "Gallery page",
      scope: "<p>Build the gallery page.</p>",
      totalCents: 24000,
    };
    // Org B's ticket, an unmarked ticket and junk are all refused.
    const bTicket = await file("change", "B's change", s.B.ctx.editor);
    await staffMarkPaidService(
      s.staff.agent,
      { number: bTicket, category: "page_building" },
      { clock, transport: captureTransport() },
    );
    await expect(
      createWorkOrder(s.staff.superAdmin, { ...input, ticket: bTicket }),
    ).rejects.toBeInstanceOf(InvalidInput);
    const plain = await file("change", "Not marked yet");
    await expect(
      createWorkOrder(s.staff.superAdmin, { ...input, ticket: plain }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      createWorkOrder(s.staff.superAdmin, {
        ...input,
        ticket: "1001" as unknown as number,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);

    const { id, preview } = await createWorkOrder(s.staff.superAdmin, {
      ...input,
      ticket: n,
    });
    expect(preview.ticket).toBe(n);
    expect((await pb.collection("work_orders").getOne(id)).ticket).toBe(n);
    // A draft is not shown on the ticket yet.
    expect((await paidPanelFor(s.A.ctx.owner, n, { clock }))!.state).toBe(
      "none",
    );

    await sendWorkOrder(s.staff.superAdmin, id, {
      transport: captureTransport(),
      now: () => AT,
    });
    const panel = await paidPanelFor(s.A.ctx.owner, n, { clock });
    expect(panel).toMatchObject({
      state: "quote_sent",
      quoteId: id,
      amountCents: 24000,
      sentAt: AT.toISOString(),
    });
    expect((await events(n)).at(-1)).toBe(PAID_LINES.QUOTE_SENT);
    expect((await threadOf(n)).status).toBe("waiting_on_you");
  });

  it("a sent quote cannot be accepted once the Owner chose the Care hour (WR-A04)", async (t) => {
    if (!inst) return t.skip();
    const n = await markedChange("A small pricing table");
    const { id } = await createWorkOrder(s.staff.superAdmin, {
      orgId: s.A.org,
      kind: "custom_block",
      title: "Pricing table",
      scope: "<p>Build the pricing table.</p>",
      totalCents: 12000,
      ticket: n,
    });
    await sendWorkOrder(s.staff.superAdmin, id, {
      transport: captureTransport(),
      now: () => AT,
    });
    expect(
      (await useCareHourForTicket(s.A.ctx.owner, n, { clock })).chosen,
    ).toBe(true);
    const err = await acceptWorkOrder(s.A.ctx.owner, id, {
      now: () => AT,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe(PAID_ALREADY_CHOSEN_COPY);
    expect((await pb.collection("work_orders").getOne(id)).status).toBe("sent");
    await staffSetTicketStatus(s.staff.agent, { number: n, to: "resolved" });
  });

  it("care:log records time against the ticket; an owner with 0 minutes left is refused", async (t) => {
    if (!inst) return t.skip();
    const n = await markedChange("Seasonal menu update");
    // --ticket: a ticket number must be this org's; free text passes through.
    expect(await staffCareTicketRef(s.staff.agent, s.A.org, `#${n}`)).toBe(
      String(n),
    );
    expect(await staffCareTicketRef(s.staff.agent, s.A.org, "ZD-77")).toBe(
      "ZD-77",
    );
    await expect(
      staffCareTicketRef(s.staff.agent, s.B.org, String(n)),
    ).rejects.toBeInstanceOf(InvalidInput);
    await logCareTime(
      s.staff.agent,
      {
        orgId: s.A.org,
        minutes: 60 - SUPPORT_SEED_CARE_USED,
        note: "Used the rest of the hour",
        ticketRef: String(n),
      },
      { now: () => AT },
    );
    const logged = await pb.collection("care_plan_time").getFullList({
      filter: pb.filter("organization = {:o} && ticket_ref = {:t}", {
        o: s.A.org,
        t: String(n),
      }),
    });
    expect(logged).toHaveLength(1);

    const err = await useCareHourForTicket(s.A.ctx.owner, n, { clock }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe("No Care minutes left in October.");
    const panel = await paidPanelFor(s.A.ctx.owner, n, { clock });
    expect(panel!.care).toMatchObject({ onPlan: true, minutesLeft: 0 });
    expect(panel!.careHourAvailable).toBe(false);
  });
});
