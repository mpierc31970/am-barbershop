import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAllowedMonitorPath,
  MONITOR_STATUS_PATHS,
  monitorKeyPaths,
} from "../packages/core/src/health/thresholds";

// 13-40 (STAFF-16, D174, D175): MONITOR-APP-BRIEF.md §4 is the monitor app's contract. Every
// top-level key and every jobs.* key the endpoint emits (MONITOR_STATUS_PATHS, which the
// monitorStatus integration test proves against the real output) must be in the §4 JSON
// block, and the shipped example must itself parse.

const repoRoot = path.resolve(import.meta.dirname, "..");
const brief = readFileSync(
  path.join(repoRoot, ".planning/design/MONITOR-APP-BRIEF.md"),
  "utf8",
).replace(/\r\n/g, "\n");

function section4(): string {
  const start = brief.indexOf("\n## 4.");
  const end = brief.indexOf("\n## 5.", start);
  expect(start).toBeGreaterThan(-1);
  return brief.slice(start, end === -1 ? undefined : end);
}

function statusJson(): Record<string, unknown> {
  const blocks = [...section4().matchAll(/```json\n([\s\S]*?)```/g)].map(
    (m) => m[1]!,
  );
  expect(blocks.length).toBeGreaterThan(0);
  return JSON.parse(blocks[0]!) as Record<string, unknown>;
}

const top = (p: string) => p.split(/[.[]/)[0]!;

describe("monitor brief §4 (13-40)", () => {
  it("the §4 JSON block parses", () => {
    expect(() => statusJson()).not.toThrow();
  });

  it("names every top-level key the endpoint emits", () => {
    const doc = statusJson();
    for (const k of new Set(MONITOR_STATUS_PATHS.map(top))) {
      expect(Object.keys(doc), k).toContain(k);
    }
  });

  it("names every jobs.* key the endpoint emits", () => {
    const jobs = statusJson().jobs as Record<string, Record<string, unknown>>;
    const emitted = MONITOR_STATUS_PATHS.filter((p) => p.startsWith("jobs."));
    for (const p of emitted) {
      const [, job, field] = p.split(".");
      expect(Object.keys(jobs), job).toContain(job);
      const name = field!.replace("[]", "");
      expect(Object.keys(jobs[job!]!), `${job}.${name}`).toContain(name);
    }
  });

  it("every emitted path appears in the §4 example (additions only, nothing renamed)", () => {
    const documented = new Set(monitorKeyPaths(statusJson()));
    const prefixOf = (p: string) =>
      [...documented].some(
        (d) =>
          d === p ||
          d.startsWith(`${p}.`) ||
          d.startsWith(`${p}[]`) ||
          p.startsWith(`${d}.`),
      );
    for (const p of MONITOR_STATUS_PATHS) {
      expect(prefixOf(p), p).toBe(true);
    }
  });

  it("the shipped notes cite the token, route and allowlist", () => {
    const s = section4();
    expect(s).toContain("MONITOR_STATUS_PATHS");
    expect(s).toContain("HEALTH_CHECKS");
    expect(brief).toContain("node scripts/gen-monitor-token.mjs");
    expect(brief).toContain("P13 (13-40)");
    expect(isAllowedMonitorPath("generated_at")).toBe(true);
  });
});
