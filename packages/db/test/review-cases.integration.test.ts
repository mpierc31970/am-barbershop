// 13-23: review cases on the real PocketBase binary (STAFF-23, STAFF-24, STAFF-26; D249,
// P13-P8, P13-P25; T-13-23-01..04). Public report -> R-n with no ticket and two mails that never
// name the other party; the DMCA timeline order and the 10-14 business-day restore window;
// outcomes calling the suspension / unpublish functions; repeat infringers; one audit row each.
import "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { businessDeadline } from "@cds/core/support";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { captureTransport } from "../src/email/transport";
import {
  REPORT_RECEIPTS_PER_ADDRESS,
  resetReportLimitsForTests,
} from "../src/rate-limit";
import { clearResolverCache } from "../src/resolve";
import {
  createPublicReport,
  repeatInfringerFor,
  repeatInfringers,
  staffAddCaseStep,
  staffAssignCase,
  staffCaseOutcome,
  staffCreateCase,
  staffGetCase,
  staffResolveFlag,
} from "../src/staff/review";
import { getObjectStore } from "../src/storage";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z"); // Mon 12 Oct, 10:00 am Chicago
const DAY = 86_400_000;
const REPORTER = "reporter@example.test";

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let hostA: string;
let hostB: string;
let storageDir = "";
const savedStorageDir = process.env.CDS_STORAGE_DIR;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  storageDir = mkdtempSync(join(tmpdir(), "cds-review-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb
    .collection("organizations")
    .update(s.A.org, { name: "Rivera Bakery" });
  hostA = String(
    (await pb.collection("org_hosts").getOne(s.base.A.host)).hostname,
  );
  hostB = String(
    (await pb.collection("org_hosts").getOne(s.base.B.host)).hostname,
  );
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

async function threadCount(): Promise<number> {
  return (await pb.collection("support_threads").getList(1, 1)).totalItems;
}

async function outcomeAudits(targetId: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = 'review.outcome' && target_id = {:t}", {
      t: targetId,
    }),
  });
}

async function memberEmails(orgId: string): Promise<string[]> {
  const rows = await pb.collection("memberships").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    expand: "user",
  });
  return rows.map((r) =>
    String((r.expand?.user as { email?: string }).email ?? ""),
  );
}

function dmcaInput(orgId: string, path = "/gallery") {
  return {
    kind: "dmca" as const,
    orgId,
    targetUrl: `https://${hostB}${path}`,
    category: "copyright",
    description: "My photo is used without permission.",
    reporter: { name: "Pat Lens", email: REPORTER },
    dmcaStatement: { goodFaith: true, accuracy: true, signature: "Pat Lens" },
  };
}

describe("public report (STAFF-24, STAFF-26)", () => {
  it("creates R-n with steps [received], no ticket, and two mails that never cross", async (t) => {
    if (!inst) return t.skip();
    const before = await threadCount();
    const transport = captureTransport();
    const r = await createPublicReport(
      {
        targetUrl: `https://${hostA}/about`,
        category: "scam",
        description: "Fake discount codes.",
        reporterName: "Sam Reporter",
        reporterEmail: REPORTER,
      },
      { now: AT, transport },
    );
    expect(r.ref).toMatch(/^R-\d+$/);
    expect(r.orgId).toBe(s.A.org);
    expect(await threadCount()).toBe(before);

    const row = await pb
      .collection("review_cases")
      .getFirstListItem(pb.filter("seq = {:n}", { n: Number(r.ref.slice(2)) }));
    expect(row.kind).toBe("report");
    expect(row.org_id).toBe(s.A.org);
    expect(row.target_collection).toBe("pages");
    expect(row.target_id).toBe(s.A.livePage);
    expect((row.steps as { step: string }[]).map((x) => x.step)).toEqual([
      "received",
    ]);

    const received = transport.sent.filter((m) => m.type === "report.received");
    const notices = transport.sent.filter(
      (m) => m.type === "report.content_notice",
    );
    expect(received.length).toBe(1);
    expect(received[0]?.to).toBe(REPORTER);
    expect(received[0]?.text).toContain(r.ref);
    // WR-A04: the reporter's own words are never echoed back.
    expect(received[0]?.text).not.toContain("Fake discount codes.");
    expect(received[0]?.html).not.toContain("Fake discount codes.");
    expect(notices.length).toBeGreaterThanOrEqual(1);
    const owners = await memberEmails(s.A.org);
    for (const m of notices) {
      expect(m.to).not.toBe(REPORTER);
      expect(m.text).not.toContain(REPORTER);
      expect(m.text).not.toContain("Sam Reporter");
      expect(m.text).toContain("Scam or fraud");
    }
    for (const e of owners) {
      if (e) expect(received[0]?.text).not.toContain(e);
    }
    expect(r.ownerNotified).toBe(notices.length);
  });

  it("sends at most REPORT_RECEIPTS_PER_ADDRESS receipts per address a day; reports are still filed (WR-A04)", async (t) => {
    if (!inst) return t.skip();
    resetReportLimitsForTests();
    const transport = captureTransport();
    const to = "flood-target@example.com";
    const results = [];
    for (let i = 0; i < REPORT_RECEIPTS_PER_ADDRESS + 2; i++) {
      results.push(
        await createPublicReport(
          {
            targetUrl: `https://${hostA}/about`,
            category: "scam",
            description: `Report ${i}`,
            reporterEmail: to,
          },
          { now: AT, transport },
        ),
      );
    }
    expect(results.every((r) => /^R-\d+$/.test(r.ref))).toBe(true);
    expect(results.filter((r) => r.reporterNotified)).toHaveLength(
      REPORT_RECEIPTS_PER_ADDRESS,
    );
    expect(
      transport.sent.filter((m) => m.type === "report.received" && m.to === to),
    ).toHaveLength(REPORT_RECEIPTS_PER_ADDRESS);
    resetReportLimitsForTests();
  });

  it("refuses a copyright notice without both statements", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffCreateCase(s.staff.agent, {
        ...dmcaInput(s.B.org),
        dmcaStatement: { goodFaith: true, accuracy: false, signature: "x" },
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });
});

describe("DMCA timeline (D249)", () => {
  it("walks the steps in order and enforces the 10-14 business-day restore window", async (t) => {
    if (!inst) return t.skip();
    const before = await threadCount();
    const c = await staffCreateCase(s.staff.agent, dmcaInput(s.B.org), {
      now: AT,
    });
    expect(await threadCount()).toBe(before);
    const ref = c.ref;
    await staffAddCaseStep(s.staff.agent, ref, {
      step: "content_disabled",
      now: AT,
    });
    await staffAddCaseStep(s.staff.agent, ref, {
      step: "tenant_notified",
      now: AT,
    });
    // Out of order: back to an earlier step.
    await expect(
      staffAddCaseStep(s.staff.agent, ref, {
        step: "content_disabled",
        now: AT,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    // Restore before a counter-notice.
    await expect(
      staffAddCaseStep(s.staff.agent, ref, {
        step: "restore_date_set",
        restoreDate: businessDeadline(AT, 10),
        now: AT,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    const counter = await staffAddCaseStep(s.staff.agent, ref, {
      step: "counter_notice",
      now: AT,
    });
    expect(counter.status).toBe("waiting");
    await expect(
      staffAddCaseStep(s.staff.agent, ref, {
        step: "restore_date_set",
        restoreDate: businessDeadline(AT, 5),
        now: AT,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffAddCaseStep(s.staff.agent, ref, {
        step: "restore_date_set",
        restoreDate: businessDeadline(AT, 15),
        now: AT,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    const set = await staffAddCaseStep(s.staff.agent, ref, {
      step: "restore_date_set",
      restoreDate: businessDeadline(AT, 10),
      now: AT,
    });
    expect(set.currentStep).toBe("restore_date_set");
    expect(set.dueAt).not.toBeNull();

    const restored = await staffCaseOutcome(s.staff.agent, ref, "restored", {
      now: AT,
    });
    expect(restored.outcome).toBe("restored");
    const closed = await staffAddCaseStep(s.staff.agent, ref, {
      step: "closed",
      now: AT,
    });
    expect(closed.status).toBe("closed");
    expect(closed.steps.map((x) => x.step)).toEqual([
      "received",
      "content_disabled",
      "tenant_notified",
      "counter_notice",
      "restore_date_set",
      "restored",
      "closed",
    ]);
    await expect(
      staffCaseOutcome(s.staff.agent, ref, "cleared", { now: AT }),
    ).rejects.toBeInstanceOf(InvalidInput);

    // Staff read includes the reporter (staff only) and the statement.
    const got = await staffGetCase(s.staff.agent, ref, { now: AT });
    expect(got.reporterEmail).toBe(REPORTER);
    expect(got.dmcaStatement?.good_faith).toBe(true);
    expect((await outcomeAudits(got.id)).length).toBe(1);
    expect((await outcomeAudits(got.id))[0]?.organization).toBe(s.B.org);
  });

  it("refuses DMCA-only steps and outcomes on a plain report", async (t) => {
    if (!inst) return t.skip();
    const c = await staffCreateCase(
      s.staff.agent,
      {
        kind: "report",
        targetUrl: `https://${hostB}/`,
        category: "other",
        description: "Odd content",
        receivedVia: "phone",
      },
      { now: AT },
    );
    expect(c.orgId).toBe(s.B.org);
    await expect(
      staffAddCaseStep(s.staff.agent, c.ref, {
        step: "counter_notice",
        now: AT,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffCaseOutcome(s.staff.agent, c.ref, "upheld", { now: AT }),
    ).rejects.toBeInstanceOf(InvalidInput);
    const a = await staffAssignCase(s.staff.agent, c.ref, s.staff.agentUser);
    expect(a.assignee).toBe(s.staff.agentUser);
    await expect(
      staffAssignCase(s.staff.agent, c.ref, s.A.users.owner),
    ).rejects.toBeInstanceOf(InvalidInput);
  });
});

describe("outcomes call the existing functions (T-13-23-02, T-13-23-03)", () => {
  it("fix_requested sends the 3-day notice; suspended by an agent is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const c = await staffCreateCase(
      s.staff.agent,
      {
        kind: "report",
        targetUrl: `https://${hostA}/about`,
        category: "scam",
        description: "Fake discounts",
      },
      { now: AT },
    );
    await expect(
      staffCaseOutcome(s.staff.agent, c.ref, "suspended", {
        now: AT,
        note: "staff only",
      }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      staffCaseOutcome(s.staff.agent, c.ref, "fix_requested", { now: AT }),
    ).rejects.toBeInstanceOf(InvalidInput);

    const transport = captureTransport();
    const r = await staffCaseOutcome(s.staff.agent, c.ref, "fix_requested", {
      now: AT,
      message: "Remove the fake discount codes.",
      transport,
    });
    expect(r.outcome).toBe("fix_requested");
    const org = await pb.collection("organizations").getOne(s.A.org);
    expect(org.suspension.mode).toBe("notice");
    expect(
      transport.sent.some((m) => m.type === "site.suspension_notice"),
    ).toBe(true);
    const got = await staffGetCase(s.staff.agent, c.ref, { now: AT });
    expect(got.status).toBe("waiting");
    expect(got.currentStep).toBe("tenant_notified");
    const audits = await outcomeAudits(got.id);
    expect(audits.length).toBe(1);
    expect(audits[0]?.organization).toBe(s.A.org);
    expect(audits[0]?.meta).toMatchObject({
      ref: c.ref,
      outcome: "fix_requested",
    });

    // WR-A05: a second case asking for a notice while one is open completes, not fails.
    const c2 = await staffCreateCase(
      s.staff.agent,
      {
        kind: "report",
        targetUrl: `https://${hostA}/about`,
        category: "scam",
        description: "Same fake discounts",
      },
      { now: AT },
    );
    const r2 = await staffCaseOutcome(s.staff.agent, c2.ref, "fix_requested", {
      now: AT,
      message: "Remove the fake discount codes.",
      transport,
    });
    expect(r2.outcome).toBe("fix_requested");
    const got2 = await staffGetCase(s.staff.agent, c2.ref, { now: AT });
    expect(got2.currentStep).toBe("tenant_notified");
  });

  it("removed takes the reported page offline and resolves its flags", async (t) => {
    if (!inst) return t.skip();
    const c = await staffCreateCase(
      s.staff.superAdmin,
      {
        kind: "report",
        targetUrl: `https://${hostB}/about`,
        category: "illegal",
        description: "Illegal goods",
      },
      { now: AT },
    );
    const flag = await pb.collection("content_flags").create({
      organization: s.B.org,
      target_collection: "pages",
      target_id: s.B.livePage,
      verdict: "unsure",
      reasons: ['Text: matched "replica"'],
      status: "open",
    });
    const inv = recordingInvalidator();
    // WR-A05: a bad note is refused before anything changes on the site.
    const statusBefore = (await pb.collection("pages").getOne(s.B.livePage))
      .status;
    await expect(
      staffCaseOutcome(s.staff.superAdmin, c.ref, "removed", {
        now: AT,
        note: "x".repeat(5000),
        content: {
          sections: composeSectionRegistry(CORE_SECTIONS, []),
          invalidator: inv,
          store: getObjectStore(),
        },
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect((await pb.collection("pages").getOne(s.B.livePage)).status).toBe(
      statusBefore,
    );
    expect(inv.tags.length).toBe(0);
    const r = await staffCaseOutcome(s.staff.superAdmin, c.ref, "removed", {
      now: AT,
      content: {
        sections: composeSectionRegistry(CORE_SECTIONS, []),
        invalidator: inv,
        store: getObjectStore(),
      },
    });
    expect(r.flagsResolved).toBe(1);
    expect((await pb.collection("pages").getOne(s.B.livePage)).status).toBe(
      "draft",
    );
    expect((await pb.collection("content_flags").getOne(flag.id)).status).toBe(
      "resolved",
    );
    expect(inv.tags.length).toBeGreaterThan(0);
    const unpub = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'page.unpublished_by_cds' && target_id = {:t}",
        {
          t: s.B.livePage,
        },
      ),
    });
    expect(unpub.length).toBe(1);
    expect(unpub[0]?.organization).toBe(s.B.org);
    const got = await staffGetCase(s.staff.superAdmin, c.ref, { now: AT });
    expect(got.currentStep).toBe("content_disabled");
    expect((await outcomeAudits(got.id)).length).toBe(1);
  });

  it("a flag clears straight from the queue (choice 3), audited with the org", async (t) => {
    if (!inst) return t.skip();
    const flag = await pb.collection("content_flags").create({
      organization: s.A.org,
      target_collection: "testimonials",
      target_id: "abcdefghijklmno",
      verdict: "unsure",
      reasons: ['Text: matched "cure"'],
      status: "open",
    });
    const r = await staffResolveFlag(s.staff.agent, flag.id, "cleared", {
      now: AT,
    });
    expect(r.outcome).toBe("cleared");
    expect((await pb.collection("content_flags").getOne(flag.id)).status).toBe(
      "resolved",
    );
    const audits = await outcomeAudits(flag.id);
    expect(audits.length).toBe(1);
    expect(audits[0]?.organization).toBe(s.A.org);
    await expect(
      staffResolveFlag(s.staff.agent, flag.id, "cleared", { now: AT }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("refuses an org member context", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffCaseOutcome(
        s.A.ctx.owner as unknown as Parameters<typeof staffCaseOutcome>[0],
        "R-1",
        "cleared",
      ),
    ).rejects.toThrow();
  });
});

describe("repeat infringers (P13-P25)", () => {
  async function upheldCase(orgId: string, upheldAt: Date): Promise<void> {
    const c = await staffCreateCase(s.staff.agent, dmcaInput(orgId), {
      now: AT,
    });
    await staffCaseOutcome(s.staff.agent, c.ref, "upheld", { now: AT });
    const row = await pb
      .collection("review_cases")
      .getFirstListItem(pb.filter("seq = {:n}", { n: Number(c.ref.slice(2)) }));
    const steps = (row.steps as { step: string; at: string }[]).map((x) =>
      x.step === "upheld" ? { ...x, at: upheldAt.toISOString() } : x,
    );
    await pb.collection("review_cases").update(row.id, { steps });
  }

  it("flags 3 upheld in 365 days; one 400 days old does not count", async (t) => {
    if (!inst) return t.skip();
    for (const days of [10, 100, 300]) {
      await upheldCase(s.B.org, new Date(AT.getTime() - days * DAY));
    }
    for (const days of [20, 200, 400]) {
      await upheldCase(s.A.org, new Date(AT.getTime() - days * DAY));
    }
    const all = await repeatInfringers(AT);
    expect(all.has(s.B.org)).toBe(true);
    expect(all.has(s.A.org)).toBe(false);
    const sub = await repeatInfringerFor([s.A.org, s.B.org], { now: AT });
    expect([...sub]).toEqual([s.B.org]);
    expect(
      (await staffGetCase(s.staff.agent, "R-1", { now: AT })).repeatInfringer,
    ).toBe(
      (await staffGetCase(s.staff.agent, "R-1", { now: AT })).orgId === s.B.org,
    );
  });
});
