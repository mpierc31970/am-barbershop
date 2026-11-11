// 14-36 (DOM-10, DOM-02; D26; RESEARCH Pitfall 12; T-14-36-01, T-14-36-03): CDS final approval
// runs the prepared move's last five steps, on the real PocketBase binary over the fake DNS
// world. The approve path is the db functions approveLaunchAction calls (staffLaunchQueue for
// the review + move gate, then startCutover): a prepared move goes live on the custom domain;
// a forced HTTPS failure leaves the stage ready_for_review on the preview address; an
// unsubmitted review shows in the queue row; the org:stage CLI helper refuses `--to live`
// while a launch move exists and allows it for a site with none.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LIVE_VIA_APPROVE, liveRefusal } from "../scripts/org-stage";
import { resetClientForTests, superuser } from "../src/client";
import { mintPlatformContext, type PlatformContext } from "../src/context";
import { startCutover } from "../src/dns/cutover";
import { resetDnsForTests } from "../src/dns/factory";
import { setFakeProberProof } from "../src/dns/fake-world";
import { advanceMove, type MoveView } from "../src/dns/moves";
import { staffLaunchQueue } from "../src/staff/pipeline";
import { hostRowsFor, prepareLaunchForTests } from "./launch-seed";
import { bootPb, type PbInstance } from "./pb-harness";
import { pipelineOrgRow, seedPipelineOrg } from "./pipeline-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let staffUser = "";
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
  CDS_EDGE_IPV4: process.env.CDS_EDGE_IPV4,
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-launch-approval-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  process.env.CDS_EDGE_IPV4 = "198.18.0.99";
  resetDnsForTests();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  const password = randomBytes(18).toString("hex");
  staffUser = (
    await pb.collection("users").create({
      email: `staff-${randomBytes(4).toString("hex")}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
}, 120_000);

afterAll(async () => {
  setFakeProberProof(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await inst?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

const staff = (): PlatformContext =>
  mintPlatformContext({
    actor: staffUser,
    staffRole: "super_admin",
    ip: "2.2.2.2",
  });

async function inReview(name: string): Promise<string> {
  return (await seedPipelineOrg({ name, stage: "ready_for_review" })).orgId;
}

/** What approveLaunchAction checks before startCutover (same row, same order). */
async function approvable(orgId: string) {
  const row = (await staffLaunchQueue(staff())).find((r) => r.orgId === orgId);
  if (!row) throw new Error("not in the launch queue");
  return row;
}

async function auditActions(orgId: string): Promise<string[]> {
  const rows = await pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "created,id",
  });
  return rows.map((r) => String(r.action));
}

describe("approve launch -> cutover (14-36)", () => {
  it("a prepared move and a submitted review: approve takes the site live on its domain", async () => {
    if (!inst) return;
    const org = await inReview("Rivera Bakery");
    const l = await prepareLaunchForTests(org);

    const row = await approvable(org);
    expect(row.review.submittedAt).not.toBeNull();
    expect(row.review).toMatchObject({ done: 6, total: 6 });
    expect(row.checklist.informational).toBe(false);
    expect(row.move).toEqual({
      code: l.moveCode,
      state: "prepared",
      domain: l.domain,
      waitingOn: null,
    });

    const v = await startCutover(staff(), org);
    expect(v.status).toBe("done");
    const after = await pipelineOrgRow(org);
    expect(after.stage).toBe("live");
    expect(after.launchedAt).not.toBe("");
    const hosts = await hostRowsFor(org);
    expect(hosts[l.domain]).toEqual({ kind: "custom", primary: true });
    const preview = Object.entries(hosts).find(([, h]) => h.kind === "preview");
    expect(preview?.[1].primary).toBe(false);
    const actions = await auditActions(org);
    expect(actions).toContain("domain.cutover_started");
    expect(actions).toContain("org.stage_changed");
    // Live: the site leaves the launch queue.
    expect((await staffLaunchQueue(staff())).some((r) => r.orgId === org)).toBe(
      false,
    );
  });

  it("a forced HTTPS failure leaves the stage ready_for_review on the preview address", async () => {
    if (!inst) return;
    const org = await inReview("Failing Bakery");
    const l = await prepareLaunchForTests(org, { https: false });
    const at = { now: new Date() };
    const deps = { now: () => at.now };
    let v: MoveView = await startCutover(staff(), org, deps);
    expect(v.status).toBe("cutover_running");
    for (const wait of [1, 2, 4, 8, 15]) {
      at.now = new Date(at.now.getTime() + wait * 60_000);
      v = await advanceMove(v.id, deps);
    }
    expect(v.status).toBe("failed");
    expect(v.failedStep).toBe("https");
    expect((await pipelineOrgRow(org)).stage).toBe("ready_for_review");
    const hosts = await hostRowsFor(org);
    const preview = Object.entries(hosts).find(([, h]) => h.kind === "preview");
    expect(preview?.[1].primary).toBe(true);
    expect(hosts[l.domain]?.primary).toBe(false);
    // Staff see the failure in the queue (Failed · step 8); approve stays blocked.
    const row = await approvable(org);
    expect(row.move).toMatchObject({ state: "failed", failedStep: 8 });
    await expect(startCutover(staff(), org)).rejects.toThrow(InvalidInput);
  });

  it("WR-C03: an error in the first run after the commit reads as started, not refused", async () => {
    if (!inst) return;
    const org = await inReview("Throwing Bakery");
    const l = await prepareLaunchForTests(org);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The runner's clock throws: advanceMove fails after cutover_running committed.
      const v = await startCutover(staff(), org, {
        now: () => {
          throw new Error("boom");
        },
      });
      expect(v).toMatchObject({ code: l.moveCode, status: "cutover_running" });
      expect(quiet).toHaveBeenCalledWith(
        "[domains] first cutover run failed: Error",
      );
    } finally {
      quiet.mockRestore();
    }
    expect(await auditActions(org)).toContain("domain.cutover_started");
    // The job carries it on: the next run takes the site live.
    const done = await advanceMove(l.moveId, { force: true });
    expect(done.status).toBe("done");
    expect((await pipelineOrgRow(org)).stage).toBe("live");
  });

  it("an unsubmitted review shows in the queue row (the action refuses on it)", async () => {
    if (!inst) return;
    const org = await inReview("Not Sent Yet");
    await prepareLaunchForTests(org, { submit: false });
    const row = await approvable(org);
    expect(row.review.submittedAt).toBeNull();
    expect(row.move.state).toBe("prepared");
  });

  it("CR-D01: a page published after Ready to launch makes the send stale; startCutover refuses", async () => {
    if (!inst) return;
    const org = await inReview("Changed Since");
    await prepareLaunchForTests(org);
    const page = await pb
      .collection("pages")
      .getFirstListItem(
        pb.filter("organization = {:o} && status = 'published'", { o: org }),
      );
    // CDS republishes the page after the owner's send.
    await pb.collection("pages").update(page.id, {
      published_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const row = await approvable(org);
    expect(row.review.submittedAt).not.toBeNull();
    expect(row.review.resubmitNeeded).toHaveLength(1);
    await expect(startCutover(staff(), org)).rejects.toThrow(
      P14_COPY.APPROVE_RESEND({ count: 1 }),
    );
    expect((await pipelineOrgRow(org)).stage).toBe("ready_for_review");
    expect(row.move.state).toBe("prepared");
    expect((await approvable(org)).move.state).toBe("prepared");
  });

  it("no domain: the queue row says none; startCutover refuses with APPROVE_BLOCKED", async () => {
    if (!inst) return;
    const org = await inReview("No Domain Co");
    const row = await approvable(org);
    expect(row.move).toEqual({
      code: null,
      state: "none",
      waitingOn: "no domain is connected yet",
    });
    await expect(startCutover(staff(), org)).rejects.toThrow(
      P14_COPY.APPROVE_BLOCKED({ waitingOn: "no domain is connected yet" }),
    );
  });

  it("org:stage --to live is refused while a launch move exists, allowed without one", async () => {
    if (!inst) return;
    const withMove = await inReview("Moving Bakery");
    await prepareLaunchForTests(withMove, { submit: false });
    expect(await liveRefusal(staff(), withMove, "live")).toBe(LIVE_VIA_APPROVE);
    expect(LIVE_VIA_APPROVE).toBe(
      "Refused: this site has a domain move. Use Approve launch in the console.",
    );
    // Other targets are never refused by this check.
    expect(await liveRefusal(staff(), withMove, "being_built")).toBeNull();
    // A site with no domain move (dev, demo) can still be moved by the CLI.
    const plain = await inReview("Plain Dev Site");
    expect(await liveRefusal(staff(), plain, "live")).toBeNull();
  });
});
