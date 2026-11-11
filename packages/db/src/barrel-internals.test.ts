// Review WR-A07: the context-free job steps are internal to src/jobs/*. The @cds/db root
// barrel (and the staff and demo barrels) list their exports explicitly and leave them out,
// so app code cannot take a site offline, sync the fail-safe, open spot checks or evaluate
// health without a role or a job token.
import { describe, expect, it } from "vitest";
import * as db from "./index";
import * as demo from "./demo";
import * as dns from "./dns";
import * as sending from "./email/sending-domains";
import * as launchReview from "./launch-review";
import * as offboarding from "./offboarding";
import * as staff from "./staff";

const INTERNAL = [
  "jobAutoSuspend",
  "jobSyncFailsafe",
  "jobOpenSpotChecks",
  "jobEvaluateHealth",
] as const;

describe("barrels keep the job steps internal (WR-A07)", () => {
  it.each(INTERNAL)(
    "%s is not exported from @cds/db or the staff barrel",
    (name) => {
      expect(Object.keys(db)).not.toContain(name);
      expect(Object.keys(staff)).not.toContain(name);
    },
  );

  it("the staff and demo entry points are still exported", () => {
    expect(typeof db.staffSuspendNow).toBe("function");
    expect(typeof db.staffResetDemo).toBe("function");
    expect(typeof demo.resetDemoOrg).toBe("function");
  });
});

// Review 14 WR-A02 (Invariant 1): the P14 move runner, zone-row writers, handback and
// offboarding job steps and the sending-domain writers take no context. Jobs, scripts and
// sibling modules import them by relative path; @cds/db and the area barrels do not export
// them. Owners reach cancel and retry only through owner.ts, staff through dns/staff.ts.
const P14_INTERNAL = [
  "advanceMove",
  "advanceMoves",
  "cancelMove",
  "loadMoveRow",
  "recordStep",
  "retryStep",
  "zoneMayServe",
  "latestSnapshot",
  "readDnsZoneRow",
  "readSnapshot",
  "takeSnapshot",
  "upsertDnsZoneRow",
  "runGate",
  "advanceOffboardings",
  "closeAtNoticeEnd",
  "advanceHandbacks",
  "exportZoneFile",
  "advanceSendingDomains",
  "ensureSendingDomain",
  "removeSendingDomain",
  "recordTestFormSubmission",
] as const;

describe("P14 context-free entry points stay internal (WR-A02)", () => {
  it.each(P14_INTERNAL)(
    "%s is not exported from @cds/db or its area barrel",
    (name) => {
      expect(Object.keys(db)).not.toContain(name);
      expect(Object.keys(dns)).not.toContain(name);
      expect(Object.keys(offboarding)).not.toContain(name);
      expect(Object.keys(sending)).not.toContain(name);
      expect(Object.keys(launchReview)).not.toContain(name);
    },
  );

  it("the context-taking entry points are still exported", () => {
    for (const name of [
      "startMove",
      "getMove",
      "openMoveFor",
      "staffCancelMove",
      "ownerUseDifferentDomain",
      "startOffboarding",
      "chooseHandbackDestination",
      "recordHandbackDone",
      "getSendingView",
      "markPage",
      "runDomainsJob",
    ]) {
      expect(typeof (db as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

// Review 15 WR-B07 (Invariant 1): pruneHubInquiries deletes PII rows with no context and no
// role check; only jobs/retention.ts imports it, by relative path. createHubInquiry stays
// exported because it runs its own rate-limit and Turnstile gates.
describe("P15 context-free hub inquiry pruning stays internal (WR-B07)", () => {
  it("pruneHubInquiries is not exported from @cds/db", () => {
    expect(Object.keys(db)).not.toContain("pruneHubInquiries");
  });

  it("the gated and staff entry points are still exported", () => {
    expect(typeof db.createHubInquiry).toBe("function");
    expect(typeof db.listHubInquiries).toBe("function");
  });
});
