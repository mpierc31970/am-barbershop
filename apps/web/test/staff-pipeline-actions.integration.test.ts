// 13-27 Task 2: Pipeline actions against PocketBase 0.39.11 (STAFF-01, STAFF-03, STAFF-04;
// P13-P11; RESEARCH Pitfalls 4-5; T-13-27-01..03). Real staff sign-in and step-up actions, real
// @cds/db, the shared staff test kit's cookie jar. After seeding, every write goes through the
// actions: an assembled being_built site goes to review, then live (launched_at, site.stage
// alert); a fit-review site is approved and the owner email is logged; an agent is refused.
// 14-36: Approve launch now runs the prepared domain move's cutover (D26), so the setup also
// prepares a fake-world launch move and submits the owner's launch review (launch-seed.ts,
// setup only); the approval itself still goes through the action alone and the site ends live
// on its custom domain.
// Skips locally without the PocketBase binary; fails in CI (bootPb throws there).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDnsForTests, setFakeProberProof, staffFitHolds } from "@cds/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { auditRowsFor } from "../../../packages/db/test/hub-member";
import {
  hostRowsFor,
  prepareLaunchForTests,
} from "../../../packages/db/test/launch-seed";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import {
  alertRowsFor,
  pipelineOrgRow,
  seedPipelineOrg,
} from "../../../packages/db/test/pipeline-seed";
import { bootSeededPb, otpCodeFor } from "../../../packages/db/test/seeded";
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

const actions = await import("../app/actions/staff/pipeline");
const { staffRequestStepUpAction, staffConfirmStepUpAction } =
  await import("../app/actions/staff/session");
const { getStaffSession } = await import("../lib/staff-session");

const STAFF = "cds_staff";

let inst: PbInstance | undefined;
let superToken = "";
let agentToken = "";
let storageDir = "";
const savedEnv = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_EDGE_IPV4: process.env.CDS_EDGE_IPV4,
};

function as(token: string): void {
  kit.cookies.clear();
  kit.cookies.set(STAFF, token);
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-pipeline-actions-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_EDGE_IPV4 = "198.18.0.99";
  resetDnsForTests();
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  resetStaffKit();
  resetSignInLimitsForTests();
  superToken = (await signInStaffForTest(inst, "super_admin")).token;
  agentToken = (await signInStaffForTest(inst, "support_agent")).token;
}, 120_000);

afterAll(async () => {
  await inst?.stop();
  setFakeProberProof(null);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(() => {
  kit.revalidated.length = 0;
});

describe("Pipeline actions (throwaway PocketBase)", () => {
  it("polish -> review -> live through the actions alone", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await seedPipelineOrg({
      name: "Rivera Bakery",
      stage: "being_built",
      assembled: true,
    });

    // An agent may not move a stage (org_stage is super_admin).
    as(agentToken);
    expect(await actions.markReadyForReviewAction(orgId)).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect((await pipelineOrgRow(orgId)).stage).toBe("being_built");

    as(superToken);
    const ready = await actions.markReadyForReviewAction(orgId);
    expect(ready).toMatchObject({
      ok: true,
      data: { to: "ready_for_review", changed: true },
    });
    expect((await pipelineOrgRow(orgId)).stage).toBe("ready_for_review");
    expect(kit.revalidated).toContain("/staff");
    // Setup (14-36): the owner's prepared launch move and submitted review.
    const launch = await prepareLaunchForTests(orgId);

    // Step-up through the real actions (the emailed code), then Approve launch.
    const requested = await staffRequestStepUpAction();
    if (!requested.ok) throw new Error(`step-up refused: ${requested.code}`);
    const code = await otpCodeFor(inst, requested.data.otpId);
    const confirmed = await staffConfirmStepUpAction({
      otpId: requested.data.otpId,
      code,
    });
    expect(confirmed.ok).toBe(true);
    expect((await getStaffSession())?.stepUpFresh).toBe(true);

    const live = await actions.approveLaunchAction(orgId);
    expect(live).toMatchObject({
      ok: true,
      data: {
        message: "Rivera Bakery is live.",
        move: launch.moveCode,
        status: "done",
      },
    });
    const row = await pipelineOrgRow(orgId);
    expect(row.stage).toBe("live");
    expect(row.launchedAt).not.toBe("");
    expect((await hostRowsFor(orgId))[launch.domain]).toEqual({
      kind: "custom",
      primary: true,
    });
    const alerts = await alertRowsFor(orgId, "site.stage");
    expect(alerts.map((a) => a.sourceKey)).toContain("stage:live");
    const moves = await auditRowsFor(orgId, "org.stage_changed");
    expect(moves).toHaveLength(2);

    // Live is final: a second approve is refused (not in review).
    expect(await actions.approveLaunchAction(orgId)).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("an un-assembled being_built site can't go to review", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await seedPipelineOrg({
      name: "Not Yet Built",
      stage: "being_built",
    });
    as(superToken);
    expect(await actions.markReadyForReviewAction(orgId)).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect((await pipelineOrgRow(orgId)).stage).toBe("being_built");
  });

  it("approve fit clears the hold through approveFit and emails the owner", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await seedPipelineOrg({
      name: "Held Tea Shop",
      stage: "fit_review",
      fitCase: true,
    });
    as(superToken);
    // A stage move never clears fit review (Pitfall 5).
    expect(
      await actions.moveStageAction(orgId, "ready_for_build"),
    ).toMatchObject({ ok: false, code: "invalid_input" });

    const session = await getStaffSession();
    const hold = (await staffFitHolds(session!.ctx)).find(
      (h) => h.orgId === orgId,
    );
    expect(hold).toBeTruthy();

    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await actions.approveFitAction(orgId, {
        reason: "Herbal tea only, checked the menu",
        reviewed: hold!.fingerprint,
      });
      expect(res).toMatchObject({ ok: true });
      const lines = info.mock.calls.map((c) => String(c[0]));
      expect(
        lines.some((l) => l.includes("[email-standin] fit.approved")),
      ).toBe(true);
    } finally {
      info.mockRestore();
    }
    expect((await pipelineOrgRow(orgId)).stage).not.toBe("fit_review");
    expect(await auditRowsFor(orgId, "fit.approve")).toHaveLength(1);
  });

  it("saves and clears the build note as an agent", async (t) => {
    if (!inst) return t.skip();
    const { orgId } = await seedPipelineOrg({
      name: "Note Studio",
      stage: "ready_for_build",
    });
    as(agentToken);
    expect(
      await actions.saveBuildNoteAction(orgId, "Writing your About page"),
    ).toMatchObject({ ok: true, data: { note: "Writing your About page" } });
    expect(await actions.saveBuildNoteAction(orgId, null)).toMatchObject({
      ok: true,
      data: { note: "" },
    });
    expect(await auditRowsFor(orgId, "org.build_note_set")).toHaveLength(2);
  });
});
