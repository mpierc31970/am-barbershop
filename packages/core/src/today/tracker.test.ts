import { describe, expect, it } from "vitest";
import { deriveTracker, TRACKER_STEP_IDS, type TrackerStep } from "./index";

const states = (steps: TrackerStep[]) => steps.map((s) => `${s.id}:${s.state}`);

describe("deriveTracker", () => {
  it("has the five D312 steps in order", () => {
    expect(TRACKER_STEP_IDS).toEqual([
      "received",
      "assembled",
      "polishing",
      "review",
      "live",
    ]);
    const steps = deriveTracker({
      stage: "being_built",
      paidAt: "2026-10-09T10:00:00Z",
      assembly: "done",
      buildStartedAt: "2026-10-09T12:00:00Z",
    });
    expect(steps.map((s) => s.label)).toEqual([
      "Received",
      "Site assembled",
      "CDS polishing",
      "Your review",
      "Live",
    ]);
  });

  it("being_built + assembly done + build started → polishing current", () => {
    const steps = deriveTracker({
      stage: "being_built",
      paidAt: "2026-10-09T10:00:00Z",
      assembly: "done",
      buildStartedAt: "2026-10-09T12:00:00Z",
    });
    expect(states(steps)).toEqual([
      "received:done",
      "assembled:done",
      "polishing:current",
      "review:upcoming",
      "live:upcoming",
    ]);
    expect(steps[0]?.at).toBe("2026-10-09T10:00:00Z");
  });

  it("assembly running → assembled current", () => {
    const steps = deriveTracker({
      stage: "ready_for_build",
      paidAt: "2026-10-09T10:00:00Z",
      assembly: "running",
      buildStartedAt: null,
    });
    expect(states(steps).slice(0, 3)).toEqual([
      "received:done",
      "assembled:current",
      "polishing:upcoming",
    ]);
  });

  it("not paid yet → received current", () => {
    const steps = deriveTracker({
      stage: "intake",
      paidAt: null,
      assembly: "none",
      buildStartedAt: null,
    });
    expect(steps[0]?.state).toBe("current");
    expect(steps.slice(1).every((s) => s.state === "upcoming")).toBe(true);
  });

  it("ready_for_review → review current", () => {
    const steps = deriveTracker({
      stage: "ready_for_review",
      paidAt: "2026-10-09T10:00:00Z",
      assembly: "done",
      buildStartedAt: "2026-10-09T12:00:00Z",
    });
    expect(states(steps)).toEqual([
      "received:done",
      "assembled:done",
      "polishing:done",
      "review:current",
      "live:upcoming",
    ]);
  });

  it("live → all done", () => {
    const steps = deriveTracker({
      stage: "live",
      paidAt: null,
      assembly: "none",
      buildStartedAt: null,
    });
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  it("always has exactly one current step before live", () => {
    for (const assembly of ["none", "running", "done", "failed"] as const) {
      for (const stage of [
        "ready_for_build",
        "being_built",
        "ready_for_review",
      ] as const) {
        const steps = deriveTracker({
          stage,
          paidAt: "x",
          assembly,
          buildStartedAt: null,
        });
        expect(steps.filter((s) => s.state === "current")).toHaveLength(1);
      }
    }
  });

  it("gives each step its default line", () => {
    const steps = deriveTracker({
      stage: "being_built",
      paidAt: null,
      assembly: "done",
      buildStartedAt: null,
    });
    expect(steps[2]?.defaultLine).toBe(
      "CDS is refining your pages, photos and wording.",
    );
  });
});
