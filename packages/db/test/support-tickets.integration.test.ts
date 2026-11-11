// 12-15: tenant tickets on the real PocketBase binary (COMM-06..09, SUPPORT-02; D94, D95, D211;
// T-12-15-01..06). Filing with platform-wide numbers from #1001 and the SLA due date, silent
// context, role and impersonation gates, forged targets, the same NotFound across orgs, the
// allowlist projection and list order, the 20/day limiter, and the lifecycle (reply moves,
// closed refusal, This is solved with its 30 s undo, audit rows).
import "@cds/addon-registry/server";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
  RateLimited,
} from "@cds/core";
import { SUPPORT_COPY } from "@cds/core/support";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  beginSupportAction,
  resetSupportLimitsForTests,
} from "../src/rate-limit";
import {
  TICKET_SEQ_KEY,
  ticketBrowserSummary,
  ticketFromUrl,
  fileTicket,
  getTicketByNumber,
  listThreadMessages,
  listTickets,
  markTicketSolved,
  replyToTicket,
  ticketTargets,
  undoMarkTicketSolved,
} from "../src/support";
import { readPlatformMeta } from "../src/platform-meta";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z"); // Monday 10:00 Chicago
const SATURDAY = new Date("2026-10-17T15:00:00.000Z");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

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
  return { clock: { now: () => at } };
}

function date(v: unknown): number {
  return Date.parse(String(v).replace(" ", "T"));
}

async function threadOf(number: number) {
  return pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
}

async function statusAudits(threadId: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = 'support.ticket_status' && target_id = {:t}", {
      t: threadId,
    }),
    sort: "created,id",
  });
}

describe("pure helpers", () => {
  it("keeps only same-origin /hub paths and a short browser summary", () => {
    expect(ticketFromUrl("https://evil.test/x")).toBeNull();
    expect(ticketFromUrl("//evil.test/hub")).toBeNull();
    expect(ticketFromUrl("/site")).toBeNull();
    expect(ticketFromUrl("/hub/website?tab=pages")).toBe(
      "/hub/website?tab=pages",
    );
    expect(
      ticketFromUrl("https://cds.test/hub/today", "https://cds.test"),
    ).toBe("/hub/today");
    expect(
      ticketFromUrl("https://evil.test/hub", "https://cds.test"),
    ).toBeNull();
    expect(ticketBrowserSummary(UA)).toBe("Chrome on Windows");
    expect(ticketBrowserSummary("")).toBeNull();
  });
});

describe("targets, filing and numbers (choices 1-2)", () => {
  it("lists Whole site, live pages, active add-ons and site parts", async (t) => {
    if (!inst) return t.skip();
    const groups = await ticketTargets(s.A.ctx.viewer, {
      addonNames: { [s.A.addon]: "Fixture Seed" },
    });
    expect(groups.map((g) => g.label)).toEqual([
      "Your site",
      "Pages",
      "Add-ons",
      "Site parts",
    ]);
    const pages = groups.find((g) => g.label === "Pages")!.options;
    expect(pages.map((p) => p.id)).toContain(s.A.livePage);
    expect(pages.map((p) => p.id)).not.toContain(s.B.livePage);
    const addons = groups.find((g) => g.label === "Add-ons")!.options;
    expect(addons).toContainEqual({
      kind: "addon",
      id: s.A.addon,
      label: "Fixture Seed",
    });
  });

  it("owner A files a problem: #1001, open, due in 2 business days, silent context", async (t) => {
    if (!inst) return t.skip();
    const res = await fileTicket(
      s.A.ctx.owner,
      {
        type: "problem",
        target: `page:${s.A.livePage}`,
        subject: "  The contact form is   broken ",
        body: "It shows an error when I press Send.",
        fromUrl: "https://evil.test/x",
        userAgent: UA,
      },
      clock(AT),
    );
    expect(res.number).toBe(1001);
    const row = await threadOf(1001);
    expect(row.organization).toBe(s.A.org);
    expect(row.status).toBe("open");
    expect(row.subject).toBe("The contact form is broken");
    expect(row.target).toEqual({
      kind: "page",
      id: s.A.livePage,
      label: "About",
    });
    expect(date(row.first_reply_due_at)).toBe(
      Date.parse("2026-10-14T15:00:00.000Z"),
    );
    expect(row.context).toEqual({
      url: null,
      browser: "Chrome on Windows",
      captured_at: AT.toISOString(),
    });
    expect(JSON.stringify(row.context)).not.toContain("Mozilla");
    const msgs = await listThreadMessages(s.A.ctx.viewer, row.id);
    expect(msgs.messages.map((m) => m.body)).toEqual([
      "It shows an error when I press Send.",
    ]);
    const filed = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'support.ticket_filed' && target_id = {:t}", {
        t: row.id,
      }),
    });
    expect(filed).toHaveLength(1);
    expect(filed[0]!.meta).toMatchObject({ number: 1001, type: "problem" });
    expect(JSON.stringify(filed[0]!.meta)).not.toContain("error");
    expect(await readPlatformMeta(TICKET_SEQ_KEY)).toBe("1001");
  });

  it("a question filed on Saturday is due Wednesday 00:00 Chicago; change has no due date", async (t) => {
    if (!inst) return t.skip();
    const q = await fileTicket(
      s.A.ctx.editor,
      {
        type: "question",
        subject: "How do I add a page?",
        body: "Where is the button?",
        fromUrl: "/hub/website",
      },
      clock(SATURDAY),
    );
    const row = await threadOf(q.number);
    expect(date(row.first_reply_due_at)).toBe(
      Date.parse("2026-10-21T05:00:00.000Z"),
    );
    expect(row.context.url).toBe("/hub/website");
    expect(row.target).toEqual({
      kind: "site",
      id: "site",
      label: "Whole site",
    });
    const c = await fileTicket(
      s.A.ctx.admin,
      { type: "change", subject: "New photo", body: "Swap the hero photo." },
      clock(AT),
    );
    expect((await threadOf(c.number)).first_reply_due_at).toBe("");
  });

  it("two concurrent filings get distinct consecutive numbers; org B continues the sequence", async (t) => {
    if (!inst) return t.skip();
    const before = Number(await readPlatformMeta(TICKET_SEQ_KEY));
    const [a, b] = await Promise.all([
      fileTicket(
        s.B.ctx.owner,
        { type: "question", subject: "One", body: "First" },
        clock(AT),
      ),
      fileTicket(
        s.B.ctx.admin,
        { type: "question", subject: "Two", body: "Second" },
        clock(AT),
      ),
    ]);
    expect([a.number, b.number].sort()).toEqual([before + 1, before + 2]);
    const next = await fileTicket(
      s.A.ctx.owner,
      { type: "billing", subject: "Invoice", body: "Wrong amount" },
      clock(AT),
    );
    expect(next.number).toBe(before + 3);
  });

  it("refuses editor billing, viewer, impersonation, junk types and a foreign page target", async (t) => {
    if (!inst) return t.skip();
    const base = { subject: "x", body: "y" };
    await expect(
      fileTicket(s.A.ctx.editor, { ...base, type: "billing" }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      fileTicket(s.A.ctx.owner, { ...base, type: "suggestion" }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      fileTicket(s.A.ctx.viewer, { ...base, type: "problem" }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      fileTicket(s.A.impersonatedOwner, { ...base, type: "problem" }),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    await expect(
      fileTicket(s.A.ctx.owner, {
        ...base,
        type: "problem",
        target: { kind: "page", id: s.B.livePage },
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      fileTicket(s.A.ctx.owner, {
        type: "problem",
        subject: "x".repeat(81),
        body: "y",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      fileTicket(s.A.ctx.owner, { type: "problem", subject: "x", body: " " }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("the 21st ticket in a day for org A is RateLimited", async (t) => {
    if (!inst) return t.skip();
    for (let i = 0; i < 20; i++)
      beginSupportAction("ticket", { orgId: s.A.org });
    await expect(
      fileTicket(
        s.A.ctx.owner,
        { type: "question", subject: "One more", body: "Hi" },
        clock(AT),
      ),
    ).rejects.toBeInstanceOf(RateLimited);
  });
});

describe("lookup and list (choices 3-4)", () => {
  it("org B reading #1001 gets the same NotFound as a missing number", async (t) => {
    if (!inst) return t.skip();
    const mine = await getTicketByNumber(s.A.ctx.viewer, "#1001");
    expect(mine.number).toBe(1001);
    const foreign = await getTicketByNumber(s.B.ctx.owner, 1001).catch(
      (e: unknown) => e,
    );
    const missing = await getTicketByNumber(s.B.ctx.owner, 999999).catch(
      (e: unknown) => e,
    );
    expect(foreign).toBeInstanceOf(NotFound);
    expect(missing).toBeInstanceOf(NotFound);
    expect((foreign as Error).message).toBe((missing as Error).message);
    await expect(
      getTicketByNumber(s.A.ctx.owner, "drop table"),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("the projection has no staff-only keys", async (t) => {
    if (!inst) return t.skip();
    const row = await threadOf(1001);
    await pb.collection("support_threads").update(row.id, {
      assignee: "staff1",
      priority: "urgent",
    });
    const tk = await getTicketByNumber(s.A.ctx.owner, 1001);
    for (const k of [
      "assignee",
      "priority",
      "opened_by_staff",
      "sla_warned_at",
      "first_reply_due_at",
      "context",
      "organization",
    ]) {
      expect(tk).not.toHaveProperty(k);
    }
    expect(tk).toMatchObject({
      type: "problem",
      status: "open",
      openedByCds: false,
      paid: null,
      hasIncident: false,
      firstRepliedAt: null,
    });
  });

  it("listTickets puts Waiting on you first, then newest activity, with unread", async (t) => {
    if (!inst) return t.skip();
    const wait = await threadOf(1001);
    await pb.collection("support_threads").update(wait.id, {
      status: "waiting_on_you",
      last_activity_at: "2026-01-01T00:00:00.000Z",
      last_cds_activity_at: "2026-01-01T00:00:00.000Z",
    });
    const list = await listTickets(s.A.ctx.viewer);
    expect(list[0]!.number).toBe(1001);
    expect(list[0]!.unread).toBe(true);
    const rest = list.slice(1).map((x) => Date.parse(x.lastActivityAt));
    expect([...rest].sort((a, b) => b - a)).toEqual(rest);
    expect(list.every((x) => !("assignee" in x))).toBe(true);
    const others = await listTickets(s.B.ctx.viewer, { show: "all" });
    expect(others.some((x) => x.number === 1001)).toBe(false);
    await pb.collection("support_threads").update(wait.id, {
      status: "open",
      last_cds_activity_at: "",
    });
  });
});

describe("lifecycle (choices 5-7)", () => {
  async function freshTicket(): Promise<number> {
    const r = await fileTicket(
      s.A.ctx.owner,
      { type: "problem", subject: "Lifecycle", body: "Start" },
      clock(AT),
    );
    return r.number;
  }

  it("a reply on Waiting on you moves to In progress with 'Back to CDS'", async (t) => {
    if (!inst) return t.skip();
    const n = await freshTicket();
    const row = await threadOf(n);
    await pb
      .collection("support_threads")
      .update(row.id, { status: "waiting_on_you" });
    const res = await replyToTicket(
      s.A.ctx.editor,
      n,
      { body: "Here is the info" },
      clock(AT),
    );
    expect(res.status).toBe("in_progress");
    expect((await threadOf(n)).status).toBe("in_progress");
    const page = await listThreadMessages(s.A.ctx.viewer, row.id);
    expect(page.messages.map((m) => m.event ?? m.body)).toEqual([
      "Start",
      "Here is the info",
      "Back to Support",
    ]);
    const audits = await statusAudits(row.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({
      event: "tenant_reply",
      from: "waiting_on_you",
      to: "in_progress",
    });
  });

  it("a reply on Resolved reopens ('Reopened by your reply'); open stays open", async (t) => {
    if (!inst) return t.skip();
    const n = await freshTicket();
    const row = await threadOf(n);
    const same = await replyToTicket(s.A.ctx.owner, n, { body: "More" });
    expect(same.status).toBe("open");
    expect(await statusAudits(row.id)).toHaveLength(0);
    await pb.collection("support_threads").update(row.id, {
      status: "resolved",
      resolved_at: AT.toISOString(),
    });
    const res = await replyToTicket(s.A.ctx.owner, n, { body: "Still broken" });
    expect(res.status).toBe("in_progress");
    const after = await threadOf(n);
    expect(after.resolved_at).toBe("");
    const page = await listThreadMessages(s.A.ctx.viewer, row.id);
    expect(page.messages.at(-1)!.event).toBe("Reopened by your reply");
  });

  it("a Closed ticket refuses replies with CLOSED-NOTE; Viewers cannot reply", async (t) => {
    if (!inst) return t.skip();
    const n = await freshTicket();
    const row = await threadOf(n);
    await expect(
      replyToTicket(s.A.ctx.viewer, n, { body: "Hi" }),
    ).rejects.toBeInstanceOf(Forbidden);
    await pb.collection("support_threads").update(row.id, { status: "closed" });
    const err = await replyToTicket(s.A.ctx.owner, n, { body: "Hi" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe(SUPPORT_COPY.CLOSED_NOTE);
    await expect(
      replyToTicket(s.B.ctx.owner, n, { body: "Hi" }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("This is solved from In progress, undo at +10 s restores it and removes the line; +31 s throws", async (t) => {
    if (!inst) return t.skip();
    const n = await freshTicket();
    const row = await threadOf(n);
    await pb
      .collection("support_threads")
      .update(row.id, { status: "in_progress" });
    const solved = await markTicketSolved(s.A.ctx.editor, n, AT);
    expect(solved).toEqual({ from: "in_progress", to: "resolved" });
    const r1 = await threadOf(n);
    expect(r1.status).toBe("resolved");
    expect(date(r1.resolved_at)).toBe(AT.getTime());
    let page = await listThreadMessages(s.A.ctx.viewer, row.id);
    expect(page.messages.at(-1)!.event).toBe("Marked as solved");

    const undone = await undoMarkTicketSolved(
      s.A.ctx.editor,
      n,
      new Date(AT.getTime() + 10_000),
    );
    expect(undone).toEqual({ from: "resolved", to: "in_progress" });
    const r2 = await threadOf(n);
    expect(r2.status).toBe("in_progress");
    expect(r2.resolved_at).toBe("");
    page = await listThreadMessages(s.A.ctx.viewer, row.id);
    expect(page.messages.some((m) => m.event === "Marked as solved")).toBe(
      false,
    );

    const t2 = new Date(AT.getTime() + 20_000);
    await markTicketSolved(s.A.ctx.owner, n, t2);
    await expect(
      undoMarkTicketSolved(s.A.ctx.owner, n, new Date(t2.getTime() + 31_000)),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: SUPPORT_COPY.UNDO_TOO_LATE,
    });
    expect((await threadOf(n)).status).toBe("resolved");

    const audits = await statusAudits(row.id);
    expect(audits.map((a) => (a.meta as { event: string }).event)).toEqual([
      "tenant_solved",
      "undo_solved",
      "tenant_solved",
    ]);
  });

  it("undo is refused once another message follows the line; viewers cannot mark solved", async (t) => {
    if (!inst) return t.skip();
    const n = await freshTicket();
    await expect(
      markTicketSolved(s.A.ctx.viewer, n, AT),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      markTicketSolved(s.A.impersonatedOwner, n, AT),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
    await markTicketSolved(s.A.ctx.owner, n, AT);
    // Tenant-facing refusals are UI copy, never developer strings (WR-B02).
    await expect(markTicketSolved(s.A.ctx.owner, n, AT)).rejects.toMatchObject({
      code: "invalid_input",
      message: SUPPORT_COPY.ALREADY_RESOLVED,
    });
    // A reply reopens it; the solved line is no longer the latest message.
    await replyToTicket(s.A.ctx.owner, n, { body: "Wait, not yet" });
    await expect(
      undoMarkTicketSolved(s.A.ctx.owner, n, AT),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: SUPPORT_COPY.NOTHING_TO_UNDO,
    });
  });
});
