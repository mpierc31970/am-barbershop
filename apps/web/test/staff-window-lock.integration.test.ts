// 13-36 Task 1 / choice 5: STAFF-11 console path (P13-P30; D102; T-13-36-03). A support agent
// creates a page window through createWindowAction (real staff sign-in, real @cds/db); the
// Owner's save to that page is refused in the repository with TargetLocked, while the same
// save through the staff path (CDS staff viewing the hub as the Owner) succeeds. The P12 lock
// rules themselves are proven in packages/db/test/support-lock.integration.test.ts,
// support-lock-writers.integration.test.ts and support-held-drafts.integration.test.ts.
// Skips locally without the PocketBase binary; fails in CI (bootPb throws there).
import "@cds/addon-registry/server";
import { TargetLocked } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { saveSection, staffListServiceWindows } from "@cds/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";
import { resetSignInLimitsForTests } from "../../../packages/db/test/staff-users";
import { seedWindowLockSite } from "../../../packages/db/test/window-lock-seed";
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

const actions = await import("../app/actions/staff/windows");
const { getStaffSession } = await import("../lib/staff-session");

const STAFF = "cds_staff";
const HOUR = 3_600_000;
const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NO_OWNERS = { ownerOf: () => undefined };

let inst: PbInstance | undefined;
let site: Awaited<ReturnType<typeof seedWindowLockSite>>;
let agentToken = "";

const text = (pageId: string) => ({
  pageId,
  section_type: "text-only",
  row_layout: "full",
  content: { heading: "Hi", text: "<p>x</p>" },
});

beforeAll(async () => {
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  resetStaffKit();
  resetSignInLimitsForTests();
  site = await seedWindowLockSite(booted.seed);
  agentToken = (await signInStaffForTest(inst, "support_agent")).token;
}, 120_000);

afterAll(async () => {
  await inst?.stop();
});

describe("STAFF-11: a console page window locks the tenant, not staff", () => {
  it("agent window → Owner save TargetLocked; staff save ok; End now reopens", async (t) => {
    if (!inst) return t.skip();
    kit.cookies.clear();
    kit.cookies.set(STAFF, agentToken);
    const now = Date.now();
    const made = await actions.createWindowAction({
      scope: "page",
      orgId: site.orgId,
      pageId: site.pageId,
      startsAt: new Date(now - 1000).toISOString(),
      endsAt: new Date(now + 2 * HOUR).toISOString(),
      message: "Moving the booking page.",
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.data.message).toMatch(
      /^Window W-\d+ · .+ · page "About" · now → .+ Central · editing paused for the owner\.$/,
    );

    await expect(
      saveSection(site.owner, registry, text(site.pageId), NO_OWNERS),
    ).rejects.toThrow(TargetLocked);

    const staffWrite = await saveSection(
      site.impersonatedOwner,
      registry,
      text(site.pageId),
      NO_OWNERS,
    );
    expect(staffWrite.id).toBeTruthy();

    const ended = await actions.endWindowAction(made.data.code);
    expect(ended).toMatchObject({ ok: true, data: { cleared: true } });
    const ok = await saveSection(
      site.owner,
      registry,
      text(site.pageId),
      NO_OWNERS,
    );
    expect(ok.id).toBeTruthy();
  });

  it("an agent's platform window is refused and nothing is written", async (t) => {
    if (!inst) return t.skip();
    kit.cookies.clear();
    kit.cookies.set(STAFF, agentToken);
    const session = await getStaffSession();
    expect(session).not.toBeNull();
    const before = await staffListServiceWindows(session!.ctx, {
      includeEnded: true,
    });
    const res = await actions.createWindowAction({
      scope: "platform",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + HOUR).toISOString(),
      message: "Platform upgrade.",
    });
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    const after = await staffListServiceWindows(session!.ctx, {
      includeEnded: true,
    });
    expect(after.length).toBe(before.length);
  });
});
