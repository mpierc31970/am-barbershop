// Phase 13 exit (13-48; ROADMAP P13 success criterion 2; STAFF-03, STAFF-05, STAFF-08,
// STAFF-09; P13-P2, P13-P11; T-13-48-01, T-13-48-02): CDS approves a build and resolves a
// ticket without touching the database. Against the PocketBase 0.39.11 binary and the real
// route tree (console pages rendered statically, real Server Actions, the shared staff test
// kit's cookie jar):
//
//   Seed (the only direct writes): org A held in fit review, org B being_built with a done
//   assembly ledger, org C live with an owner who files a Problem ticket.
//   Walk A  sign in (password + emailed code) -> Pipeline › Fit holds lists A -> approve fit
//           (step-up fresh from sign-in) -> Polish lists B -> send to review -> clock +16 min
//           -> Approve launch answers step_up_needed -> step-up with the emailed code ->
//           Approve launch -> B live with launched_at.
//           14-36: before Approve launch, setup prepares B's fake-world launch move and submits
//           the owner's launch review (launch-seed.ts; Approve launch runs the move's
//           cutover, D26), so B goes live on its custom domain. The approval itself is still
//           console-only.
//   Walk B  Inbox › Unassigned lists the ticket -> ticket page -> canned "Welcome" rendered
//           with staffCannedVarsFor -> public reply -> internal note -> Resolved. The owner's
//           ticket read shows the reply and status Resolved, never the note; rated_agent is
//           stamped.
//   Every console write left its audit row.
//
// After seeding, writes go only through actions; reads for assertions go through @cds/db
// tenant/staff reads (plus packages/db/test read-backs for staff-only fields). The clock jump
// fakes Date only (timers stay real, so PocketBase I/O and the OTP log poll keep working).
// Skips locally without the PocketBase binary; fails in CI (bootPb throws there).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCanned } from "@cds/core/staff";
import {
  fileTicket,
  resetDnsForTests,
  setFakeProberProof,
  getTicketByNumber,
  listThreadMessages,
  staffCannedVarsFor,
  staffFitHolds,
  staffListCanned,
} from "@cds/db";
import { ToastRegion } from "@cds/ui/hub";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditRowsFor } from "../../../packages/db/test/hub-member";
import {
  hostRowsFor,
  prepareLaunchForTests,
} from "../../../packages/db/test/launch-seed";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import {
  pipelineOrgRow,
  seedPipelineOrg,
} from "../../../packages/db/test/pipeline-seed";
import {
  bootSeededPb,
  orgAContextAs,
  otpCodeFor,
  setOrgStageForTests,
} from "../../../packages/db/test/seeded";
import {
  auditRowsByActor,
  ticketRatedAgent,
} from "../../../packages/db/test/staff-exit-reads";
import { resetSignInLimitsForTests } from "../../../packages/db/test/staff-users";
import { kit, resetStaffKit, signInStaffForTest } from "./staff-test-kit";

vi.mock(
  "next/headers",
  async () => (await import("./staff-test-kit")).nextHeadersMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const { approveFitAction, markReadyForReviewAction, approveLaunchAction } =
  await import("../app/actions/staff/pipeline");
const { staffReplyAction } = await import("../app/actions/staff/tickets");
const { staffRequestStepUpAction, staffConfirmStepUpAction } =
  await import("../app/actions/staff/session");
const { getStaffSession } = await import("../lib/staff-session");
const { default: PipelinePage } =
  await import("../app/(platform)/staff/(console)/pipeline/page");
const { default: TicketsPage } =
  await import("../app/(platform)/staff/(console)/tickets/page");
const { default: StaffTicketPage } =
  await import("../app/(platform)/staff/(console)/tickets/[number]/page");

const MIN = 60_000;
const HELD = "Held Tea Shop";
const BUILT = "Rivera Bakery";
const SUBJECT = "Contact form shows an error";
const NOTE = "Internal: checked the form logs, a spam rule tripped.";

let inst: PbInstance | undefined;
let orgA = "";
let orgB = "";
let orgC = "";
let ownerC: ReturnType<typeof orgAContextAs> | undefined;
let ticketNumber = 0;
let storageDir = "";
const savedEnv = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_EDGE_IPV4: process.env.CDS_EDGE_IPV4,
};

async function html(el: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(
    createElement(ToastRegion, null, (await el) as ReactElement),
  );
}

async function staff() {
  const s = await getStaffSession();
  if (!s) throw new Error("staff session missing");
  return s;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-staff-exit-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_EDGE_IPV4 = "198.18.0.99";
  resetDnsForTests();
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  resetStaffKit();
  resetSignInLimitsForTests();
  // Choice 1: the only direct setup writes.
  orgA = (
    await seedPipelineOrg({ name: HELD, stage: "fit_review", fitCase: true })
  ).orgId;
  orgB = (
    await seedPipelineOrg({
      name: BUILT,
      stage: "being_built",
      assembled: true,
    })
  ).orgId;
  orgC = booted.seed.A.org;
  await setOrgStageForTests(orgC, "live");
  ownerC = orgAContextAs(booted.seed, "owner");
  ticketNumber = (
    await fileTicket(ownerC, {
      type: "problem",
      subject: SUBJECT,
      body: "Sending the contact form says Something went wrong.",
    })
  ).number;
}, 180_000);

afterAll(async () => {
  vi.useRealTimers();
  await inst?.stop();
  setFakeProberProof(null);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(storageDir, { recursive: true, force: true });
});

describe("Phase 13 exit: approve a build and resolve a ticket from the console", () => {
  it("walk A: sign in, approve fit, send to review, step-up, approve launch", async (t) => {
    if (!inst) return t.skip();

    // Sign in at /staff/sign-in: password, then the emailed code (real actions).
    await signInStaffForTest(inst, "super_admin");
    const me = await staff();
    expect(me.stepUpFresh).toBe(true);

    // Pipeline › Fit holds lists org A.
    const fit = await html(
      PipelinePage({ searchParams: Promise.resolve({ tab: "fit" }) }),
    );
    expect(fit).toContain(`Approve fit: ${HELD}`);

    // Approve fit: step-up is still fresh from the sign-in code.
    const hold = (await staffFitHolds(me.ctx)).find((h) => h.orgId === orgA);
    expect(hold).toBeTruthy();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(
        await approveFitAction(orgA, {
          reason: "Herbal tea only, checked the menu",
          reviewed: hold!.fingerprint,
        }),
      ).toMatchObject({ ok: true });
    } finally {
      info.mockRestore();
    }
    expect((await pipelineOrgRow(orgA)).stage).not.toBe("fit_review");

    // Pipeline › Polish lists org B; send it to review.
    const polish = await html(
      PipelinePage({ searchParams: Promise.resolve({ tab: "polish" }) }),
    );
    expect(polish).toContain(`Mark ready for owner review: ${BUILT}`);
    expect(await markReadyForReviewAction(orgB)).toMatchObject({
      ok: true,
      data: { to: "ready_for_review", changed: true },
    });
    // Setup (14-36): B's prepared launch move and the owner's submitted review.
    const prepared = await prepareLaunchForTests(orgB);

    const launch = await html(
      PipelinePage({ searchParams: Promise.resolve({ tab: "launch" }) }),
    );
    expect(launch).toContain(`Approve launch: ${BUILT}`);

    // 16 minutes later the sign-in proof is stale (T-13-48-02).
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 16 * MIN });
    try {
      expect(await approveLaunchAction(orgB)).toMatchObject({
        ok: false,
        code: "step_up_needed",
      });
      expect((await pipelineOrgRow(orgB)).stage).toBe("ready_for_review");

      const requested = await staffRequestStepUpAction();
      if (!requested.ok) throw new Error(`step-up refused: ${requested.code}`);
      const code = await otpCodeFor(inst, requested.data.otpId);
      expect(
        await staffConfirmStepUpAction({ otpId: requested.data.otpId, code }),
      ).toMatchObject({ ok: true });

      expect(await approveLaunchAction(orgB)).toMatchObject({
        ok: true,
        data: {
          message: `${BUILT} is live.`,
          move: prepared.moveCode,
          status: "done",
        },
      });
    } finally {
      vi.useRealTimers();
    }
    const row = await pipelineOrgRow(orgB);
    expect(row.stage).toBe("live");
    expect(row.launchedAt).not.toBe("");
    expect((await hostRowsFor(orgB))[prepared.domain]).toEqual({
      kind: "custom",
      primary: true,
    });

    // Every console write left its audit row.
    expect(await auditRowsFor(orgA, "fit.approve")).toHaveLength(1);
    expect(await auditRowsFor(orgB, "org.stage_changed")).toHaveLength(2);
    expect(await auditRowsByActor(me.ctx.actor, "staff.step_up")).toHaveLength(
      1,
    );
  });

  it("walk B: canned reply, internal note, Resolved; the owner never sees the note", async (t) => {
    if (!inst || !ownerC) return t.skip();
    const me = await staff();

    // Inbox › Unassigned lists the owner's ticket; its page renders the thread.
    const inbox = await html(
      TicketsPage({
        searchParams: Promise.resolve({ tab: "inbox", quick: "unassigned" }),
      }),
    );
    expect(inbox).toContain(SUBJECT);
    kit.headers["x-cds-path"] = `/staff/tickets/${ticketNumber}`;
    const page = await html(
      StaffTicketPage({
        params: Promise.resolve({ number: String(ticketNumber) }),
      }),
    );
    expect(page).toContain(SUBJECT);

    // Canned "Welcome", placeholders filled from the ticket (STAFF-09).
    const welcome = (await staffListCanned(me.ctx)).find(
      (c) => c.title === "Welcome",
    );
    expect(welcome).toBeTruthy();
    const vars = await staffCannedVarsFor(me.ctx, ticketNumber);
    const body = renderCanned(welcome!.body, vars);
    expect(body).not.toMatch(/[{}]/);
    expect(body).toContain(`#${ticketNumber}`);
    expect(body).toContain(vars.business);
    expect(body).toContain("I'm Sam");

    const pub = await staffReplyAction({ number: ticketNumber, body });
    expect(pub).toMatchObject({ ok: true });
    const note = await staffReplyAction({
      number: ticketNumber,
      body: NOTE,
      internal: true,
    });
    expect(note).toMatchObject({ ok: true });
    const resolved = await staffReplyAction({
      number: ticketNumber,
      status: "resolved",
    });
    expect(resolved).toMatchObject({
      ok: true,
      data: { statusTo: "resolved" },
    });

    // The owner's view: the public reply, status Resolved, never the note (T-13-48-01).
    const ticket = await getTicketByNumber(ownerC, ticketNumber);
    expect(ticket.status).toBe("resolved");
    const { messages } = await listThreadMessages(ownerC, ticket.id);
    const bodies = messages.map((m) => m.body);
    expect(bodies).toContain(body);
    expect(bodies.some((b) => b.includes(NOTE))).toBe(false);
    expect(JSON.stringify(messages)).not.toContain(NOTE);

    // rated_agent = the last public staff replier (no assignee).
    expect(await ticketRatedAgent(ticketNumber)).toBe(me.ctx.actor);

    // One audit row per console write, on org C.
    expect(await auditRowsFor(orgC, "support.staff_reply")).toHaveLength(3);
  });
});
