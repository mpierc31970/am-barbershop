// P8 (08-17): the hourly assembly sweep and assemblyStatus() on the real PocketBase 0.39.11
// binary (TMPL-02, TMPL-04; CONTEXT A2-Q1, A2-Q4; D174, D175). Seeded complete-intake orgs
// at `ready_for_build`, one org still at `intake`, plus ledger states written by hand.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { templateCopy } from "@cds/core/templates";
import { TEMPLATES } from "@cds/templates";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyLedger } from "../src/assembly/ledger";
import { runAssemblyForOrg, type AssemblyRunDeps } from "../src/assembly/run";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { seedCompleteIntake, seedMinimalIntake } from "../src/dev-seed-intake";
import { captureTransport } from "../src/email";
import {
  ASSEMBLY_COUNTS_KEY,
  ASSEMBLY_HEARTBEAT_KEY,
  assemblyStatus,
  runAssemblyJobs,
} from "../src/jobs/assembly";
import { readPlatformMeta } from "../src/platform-meta";
import { resetConfirmSendLimitsForTests } from "../src/rate-limit";
import { bootPb, type PbInstance } from "./pb-harness";

const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir: string;
let n = 0;
const saved: Record<string, string | undefined> = {};
const ENV = {
  CDS_ENV: "dev",
  CDS_PREVIEW_HOST_SUFFIX: "sites.localhost",
  CDS_STAFF_ALERT_EMAIL: "staff@cds.test",
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-assembly-jobs-"));
  for (const [k, v] of Object.entries({
    ...ENV,
    CDS_STORAGE_DIR: storageDir,
  })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(storageDir, { recursive: true, force: true });
});

function deps(): AssemblyRunDeps {
  return {
    templates: TEMPLATES,
    sections,
    copy: templateCopy,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    registry: ADDON_REGISTRY,
    email: { transport: captureTransport() },
  };
}

async function readyOrg(): Promise<string> {
  n += 1;
  resetConfirmSendLimitsForTests();
  const slug = `asm-job-${n}`;
  const { orgId } = await seedCompleteIntake(
    { slug, ownerEmail: `${slug}@cds.test` },
    { registry: ADDON_REGISTRY },
  );
  return orgId;
}

async function intakeOrg(): Promise<string> {
  n += 1;
  const slug = `asm-job-intake-${n}`;
  const { orgId } = await seedMinimalIntake({
    slug,
    ownerEmail: `${slug}@cds.test`,
  });
  return orgId;
}

const stage = async (orgId: string) =>
  String((await pb.collection("organizations").getOne(orgId)).stage);

async function setLedger(
  orgId: string,
  over: Record<string, unknown>,
): Promise<void> {
  const row = await pb
    .collection("org_intake")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
  await pb
    .collection("org_intake")
    .update(row.id, { assembly: { ...emptyLedger(), ...over } });
}

async function ledgerOf(orgId: string) {
  const row = await pb
    .collection("org_intake")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
  return row.assembly as { status: string; attempts: number };
}

describe("runAssemblyJobs + assemblyStatus (throwaway PocketBase)", () => {
  it("assembles every ready org once, ignores intake orgs, honours attempts and stuck runs", async (ctx) => {
    if (!inst) return ctx.skip();
    const a = await readyOrg();
    const b = await readyOrg();
    const c = await intakeOrg();
    expect(await stage(c)).toBe("intake");

    const first = await runAssemblyJobs({ deps: deps() });
    expect(first.failedSteps).toEqual([]);
    expect(first.assembled).toBe(2);
    expect(first.failed).toBe(0);
    expect(await stage(a)).toBe("being_built");
    expect(await stage(b)).toBe("being_built");
    expect(await stage(c)).toBe("intake");
    expect(await ledgerOf(c)).toBeFalsy();

    const second = await runAssemblyJobs({ deps: deps() });
    expect(second.assembled).toBe(0);
    expect(second.failed).toBe(0);
    expect(second.stuckRecovered).toBe(0);

    // A ready org that has failed three times is left alone (staff were emailed once).
    const gaveUp = await readyOrg();
    await setLedger(gaveUp, {
      status: "failed",
      attempts: 3,
      failure_emailed: true,
      error: { code: "FORM_FAILED" },
    });
    // A run stuck `running` for 31 minutes is recovered.
    const stuck = await readyOrg();
    await setLedger(stuck, {
      status: "running",
      attempts: 1,
      started_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    });
    const third = await runAssemblyJobs({ deps: deps() });
    expect(third).toMatchObject({
      assembled: 1,
      failed: 0,
      skipped: 1,
      stuckRecovered: 1,
      failedSteps: [],
    });
    expect(await stage(gaveUp)).toBe("ready_for_build");
    expect(await ledgerOf(gaveUp)).toMatchObject({
      status: "failed",
      attempts: 3,
    });
    expect(await stage(stuck)).toBe("being_built");
    expect(await ledgerOf(stuck)).toMatchObject({
      status: "done",
      attempts: 0, // a success resets the count (WR-A03)
    });

    // Heartbeat + counts in platform_meta; counts carry no org ids.
    const last = await readPlatformMeta(ASSEMBLY_HEARTBEAT_KEY);
    expect(last).toBeTruthy();
    expect(Date.now() - Date.parse(String(last))).toBeLessThan(60_000);
    const counts = String(await readPlatformMeta(ASSEMBLY_COUNTS_KEY));
    expect(JSON.parse(counts)).toEqual(third);
    for (const id of [a, b, c, gaveUp, stuck]) {
      expect(counts).not.toContain(id);
    }

    // A second org that gave up, and one failed but still retryable.
    const gaveUp2 = await intakeOrg();
    await setLedger(gaveUp2, { status: "failed", attempts: 4 });
    const retryable = await intakeOrg();
    await setLedger(retryable, { status: "failed", attempts: 1 });

    const status = await assemblyStatus();
    expect(status.last_success).toBe(last);
    expect(status.failed_orgs).toBe(2);
    expect(JSON.stringify(status)).not.toContain(gaveUp);
  });

  it("WR-A08: a ready org with no intake row is skipped by the sweep, fails NO_INTAKE and counts as given up", async (ctx) => {
    if (!inst) return ctx.skip();
    const before = await assemblyStatus();
    const orphan = await readyOrg();
    const row = await pb
      .collection("org_intake")
      .getFirstListItem(pb.filter("organization = {:o}", { o: orphan }));
    await pb.collection("org_intake").delete(row.id);

    // A direct run returns a coded failure instead of throwing.
    const direct = await runAssemblyForOrg(orphan, deps());
    expect(direct.status).toBe("failed");
    expect(direct.errorCode).toBe("NO_INTAKE");

    const sweep = await runAssemblyJobs({ deps: deps() });
    expect(sweep.failed).toBe(0);
    expect(sweep.failedSteps).toEqual([]);
    expect(sweep.skipped).toBeGreaterThanOrEqual(1);
    expect(await stage(orphan)).toBe("ready_for_build");

    const after = await assemblyStatus();
    expect(after.failed_orgs).toBe(before.failed_orgs + 1);
    expect(JSON.stringify(after)).not.toContain(orphan);
  });
});
