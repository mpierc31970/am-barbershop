// Policy compiler and lookups (AGR-01, AGR-07; RESEARCH Pattern 1, Pitfall 3).
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyLock,
  checkLegal,
  compileLegalSources,
  emitLock,
  LOCK_OUTPUT,
  lockEntries,
  writeLegal,
} from "../../scripts/legal-gen";
import { InvalidInput } from "../errors";
import { SITE_POLICY_TEMPLATES } from "./site-policies.generated";
import {
  activeConsent,
  activePolicyVersions,
  assertRequiredClauses,
  isPolicyKey,
  POLICY_KEYS,
  policyVersion,
  REQUIRED_CLAUSES,
} from "./policies";
import { POLICY_SET } from "./policies.generated";
import { retentionTableMarkdown } from "./retention";
import type { PolicySet, PolicyVersion } from "./types";

const BANNER = "**DRAFT: not yet reviewed by a lawyer.** This text may change.";
const LEGACY_BANNER =
  "**DRAFT: not yet reviewed by a lawyer.** This text will change before CDS launches.";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type Fm = Record<string, string | number | boolean | string[] | undefined>;

function md(fm: Fm, body: string): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const b of v) lines.push(`  - ${JSON.stringify(b)}`);
    } else lines.push(`${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body}`;
}

const SUMMARY = ["You pay one.", "CDS can two.", "Your site three."];

function policy(
  key: string,
  version: number,
  over: Fm = {},
  body = `${BANNER}\n\n## Terms\n\nYou agree.\n`,
) {
  return {
    path: `packages/core/src/legal/policies/${key}/v${version}.md`,
    text: md(
      {
        key,
        version,
        title: `Title ${key}`,
        summary: SUMMARY,
        effective_at: "2026-10-08",
        draft: true,
        changes: version > 1 ? "Clarified wording." : undefined,
        ...over,
      },
      body,
    ),
  };
}

function consent(version: number, over: Fm = {}) {
  return {
    path: `packages/core/src/legal/esign-consent/v${version}.md`,
    text: md(
      {
        key: "esign-consent",
        version,
        title: "Electronic signature consent",
        label: "I agree to sign electronically.",
        effective_at: "2026-10-08",
        draft: true,
        changes: version > 1 ? "Clarified wording." : undefined,
        ...over,
      },
      `${BANNER}\n\nYou can ask for paper.\n`,
    ),
  };
}

describe("compileLegalSources (fixtures)", () => {
  it("yields an empty set for no sources", () => {
    expect(compileLegalSources([])).toEqual({ policies: [], consents: [] });
  });

  it("hashes the canonical body; CRLF and LF copies hash the same", () => {
    const lf = policy("dpa", 1);
    const crlf = { ...lf, text: lf.text.replace(/\n/g, "\r\n") };
    const a = compileLegalSources([lf]).policies[0]!;
    const b = compileLegalSources([crlf]).policies[0]!;
    expect(a.sha256).toBe(sha(a.bodyMd));
    expect(b.sha256).toBe(a.sha256);
    expect(a.bodyMd.endsWith("\n")).toBe(true);
    expect(a.bodyMd.endsWith("\n\n")).toBe(false);
  });

  it("compiles two versions plus a consent, sorted, with markers stripped from html", () => {
    const body = `${BANNER}\n\n## Keep\n\n<!-- clause:retention-table -->\n{{retention_table}}\n\n## Review\n\n{{aup_review_first}}\n`;
    const set = compileLegalSources([
      policy("dpa", 2, {}, body),
      consent(1),
      policy("dpa", 1, {}, body),
    ]);
    expect(set.policies.map((p) => p.version)).toEqual([1, 2]);
    expect(set.consents).toHaveLength(1);
    for (const e of [...set.policies, ...set.consents]) {
      expect(e.sha256).toBe(sha(e.bodyMd));
      expect(e.bodyHtml).not.toContain("<!-- clause:");
    }
    const p = set.policies[0]!;
    expect(p.bodyMd).toContain(retentionTableMarkdown());
    expect(p.bodyMd).toContain("<!-- clause:retention-table -->");
    expect(p.bodyMd).not.toContain("{{");
    expect(p.changes).toBeNull();
    expect(set.policies[1]!.changes).toBe("Clarified wording.");
    expect(set.consents[0]!.label).toBe("I agree to sign electronically.");
  });

  const bad: [string, ReturnType<typeof policy>][] = [
    ["2 bullets", policy("dpa", 1, { summary: ["a.", "b."] })],
    [
      "long bullet",
      policy("dpa", 1, { summary: ["a.", "b.", "x".repeat(141)] }),
    ],
    ["version mismatch", policy("dpa", 1, { version: 2 })],
    ["key mismatch", policy("dpa", 1, { key: "acceptable-use" })],
    ["draft not boolean", policy("dpa", 1, { draft: "yes" })],
    ["v2 without changes", policy("dpa", 2, { changes: undefined })],
    ["long changes", policy("dpa", 2, { changes: "x".repeat(201) })],
    ["lint", policy("dpa", 1, {}, `${BANNER}\n\n# H1\n`)],
    ["unknown var", policy("dpa", 1, {}, `${BANNER}\n\n{{nope}}\n`)],
    ["no banner", policy("dpa", 1, {}, "## Terms\n\nYou agree.\n")],
    ["unknown key", policy("privacy", 1)],
  ];
  it.each(bad)("rejects %s with the file path", (_n, src) => {
    expect(() => compileLegalSources([src])).toThrow(src.path);
  });

  it("WR-B02: rejects v1.md next to v01.md (duplicate version)", () => {
    const a = policy("dpa", 1);
    const b = { ...a, path: a.path.replace("v1.md", "v01.md") };
    expect(() => compileLegalSources([a, b])).toThrow(
      /duplicate version: dpa v1/,
    );
    const c = consent(1);
    const d = { ...c, path: c.path.replace("v1.md", "v01.md") };
    expect(() => compileLegalSources([c, d])).toThrow(/esign-consent v1/);
  });

  it("WR-B02: assertRequiredClauses fails when a policy has no version", () => {
    const set: PolicySet = {
      policies: POLICY_SET.policies.filter((p) => p.key !== "dpa"),
      consents: POLICY_SET.consents,
    };
    expect(() => assertRequiredClauses(set)).toThrow("dpa:(no version)");
  });
});

describe("policy lookups (synthetic set)", () => {
  const entry = (
    key: PolicyVersion["key"],
    version: number,
  ): PolicyVersion => ({
    key,
    version,
    title: key,
    summary: ["a", "b", "c"],
    changes: version > 1 ? "x" : null,
    effectiveAt: "2026-10-08",
    draft: true,
    bodyMd: "x\n",
    bodyHtml: "<p>x</p>",
    sha256: sha("x\n"),
  });
  const consentEntry = (version: number) => ({
    key: "esign-consent" as const,
    version,
    title: "c",
    label: "l",
    effectiveAt: "2026-10-08",
    draft: true,
    bodyMd: "x\n",
    bodyHtml: "<p>x</p>",
    sha256: sha("x\n"),
  });
  const set: PolicySet = {
    policies: [
      entry("dpa", 2),
      entry("terms-of-service", 1),
      entry("dpa", 1),
      entry("acceptable-use", 1),
      entry("subscription-terms", 1),
      entry("service-agreement", 3),
      entry("service-agreement", 1),
    ],
    consents: [consentEntry(1), consentEntry(2)],
  };

  it("activePolicyVersions: highest per key, D216 order", () => {
    const a = activePolicyVersions(set);
    expect(a.map((p) => p.key)).toEqual([...POLICY_KEYS]);
    expect(a.map((p) => p.version)).toEqual([3, 1, 1, 1, 2]);
  });

  it("policyVersion, activeConsent, isPolicyKey", () => {
    expect(policyVersion("dpa", 1, set)?.version).toBe(1);
    expect(policyVersion("dpa", 9, set)).toBeUndefined();
    expect(activeConsent(set)?.version).toBe(2);
    expect(isPolicyKey("dpa")).toBe(true);
    expect(isPolicyKey("privacy")).toBe(false);
  });
});

describe("legal:gen --check", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  /** A complete source tree (all five policies + consent, v1) in a temp repo root. */
  function seedTree(): { src: ReturnType<typeof policy>; file: string } {
    dir = mkdtempSync(path.join(tmpdir(), "legal-gen-"));
    const put = (s: { path: string; text: string }) => {
      const f = path.join(dir, s.path);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, s.text);
      return f;
    };
    for (const key of POLICY_KEYS) {
      if (key === "dpa") continue;
      const clauses = REQUIRED_CLAUSES[key]
        .map((id) => `<!-- clause:${id} -->\nText ${id}.\n`)
        .join("\n");
      put(policy(key, 1, {}, `${BANNER}\n\n${clauses}`));
    }
    put(consent(1));
    const src = policy(
      "dpa",
      1,
      {},
      `${BANNER}\n\n<!-- clause:retention-table -->\n{{retention_table}}\n\n<!-- clause:sub-processors -->\nWe use helpers.\n`,
    );
    return { src, file: put(src) };
  }

  it("is clean after a write and stale after a markdown edit", () => {
    seedTree();
    writeLegal(dir);
    expect(checkLegal(dir)).toEqual([]);
    const out = path.join(dir, "packages/core/src/legal/policies.generated.ts");
    const before = readFileSync(out, "utf8");
    // CRLF checkouts of the generated file are not drift.
    writeFileSync(out, before.replace(/\n/g, "\r\n"));
    expect(checkLegal(dir)).toEqual([]);
    // A new version is drift (generated module + lock) until legal:gen runs.
    const v2 = policy(
      "dpa",
      2,
      {},
      `${BANNER}\n\n<!-- clause:retention-table -->\n{{retention_table}}\n\n<!-- clause:sub-processors -->\nWe use others.\n`,
    );
    const file2 = path.join(dir, v2.path);
    writeFileSync(file2, v2.text);
    expect(checkLegal(dir)).toEqual([
      "src/legal/policies.generated.ts",
      LOCK_OUTPUT,
    ]);
    // --check writes nothing.
    expect(readFileSync(out, "utf8")).toBe(before.replace(/\n/g, "\r\n"));
  });

  it("CR-B01: a locked version can never change or vanish, in gen or check", () => {
    const { src, file } = seedTree();
    writeLegal(dir);
    const lockFile = path.join(dir, "packages/core", LOCK_OUTPUT);
    const lock = JSON.parse(readFileSync(lockFile, "utf8")) as Record<
      string,
      string
    >;
    expect(Object.keys(lock)).toHaveLength(6);
    expect(lock["dpa#1"]).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(file, src.text.replace("We use helpers.", "We use others."));
    expect(() => checkLegal(dir)).toThrow(/dpa#1 changed after.*dpa v2\.md/);
    expect(() => writeLegal(dir)).toThrow(/dpa#1 changed after/);
    // The lock is untouched by the failed gen.
    expect(readFileSync(lockFile, "utf8")).toBe(emitLock(lock));
    // Restore v1, publish v2, then delete v2: a published top version cannot vanish.
    writeFileSync(file, src.text);
    const v2 = policy(
      "dpa",
      2,
      {},
      `${BANNER}\n\n<!-- clause:retention-table -->\n{{retention_table}}\n\n<!-- clause:sub-processors -->\nWe use others.\n`,
    );
    const file2 = path.join(dir, v2.path);
    writeFileSync(file2, v2.text);
    writeLegal(dir);
    rmSync(file2);
    expect(() => checkLegal(dir)).toThrow(/dpa#2 is published/);
  });

  it("WR-B02: the real tree needs every key and the consent, versions 1..N", () => {
    const { file } = seedTree();
    writeLegal(dir);
    rmSync(file);
    expect(() => checkLegal(dir)).toThrow(/dpa has no version/);
  });

  it("applyLock keeps locked entries, adds new ones sorted, rejects a changed hash", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(applyLock({ "dpa#1": a }, { "x#1": b, "dpa#1": a })).toEqual({
      "dpa#1": a,
      "x#1": b,
    });
    expect(() => applyLock({ "dpa#1": a }, { "dpa#1": b })).toThrow(
      InvalidInput,
    );
  });
});

describe("committed policies.lock.json (CR-B01)", () => {
  it("pins every committed policy, consent and site template hash", () => {
    const lock = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, "policies.lock.json"),
        "utf8",
      ),
    ) as Record<string, string>;
    expect(lock).toEqual(lockEntries(POLICY_SET, SITE_POLICY_TEMPLATES));
    expect(Object.keys(lock)).toHaveLength(16);
  });
});

describe("committed POLICY_SET (09-05 Task 2)", () => {
  it("every entry recomputes to its sha256", () => {
    const all = [...POLICY_SET.policies, ...POLICY_SET.consents];
    expect(all.length).toBe(12);
    for (const e of all)
      expect(e.sha256, `${e.key} v${e.version}`).toBe(sha(e.bodyMd));
  });

  it("five active policies in D216 order, all v2 drafts", () => {
    const a = activePolicyVersions();
    expect(a.map((p) => p.key)).toEqual([...POLICY_KEYS]);
    for (const p of a) {
      expect(p.version).toBe(2);
      expect(p.draft).toBe(true);
    }
    expect(activeConsent()?.version).toBe(2);
  });

  it("html carries no clause markers; summaries are 3 short bullets", () => {
    for (const e of [...POLICY_SET.policies, ...POLICY_SET.consents]) {
      expect(e.bodyHtml).not.toContain("<!-- clause:");
      expect(
        e.bodyMd.startsWith(e.version === 1 ? LEGACY_BANNER : BANNER),
      ).toBe(true);
    }
    for (const p of POLICY_SET.policies) {
      expect(p.summary).toHaveLength(3);
      for (const b of p.summary) expect(b.length).toBeLessThanOrEqual(140);
    }
  });
});
