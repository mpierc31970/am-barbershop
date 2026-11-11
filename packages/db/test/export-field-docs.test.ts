// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderFieldLists } from "../src/field-docs";
import { allTenantCollections } from "../src/registry";

// LIFE-03: the documented export field lists are generated from the registry. If this
// fails, run `npm run docs:fields` and commit the result.
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const docPath = path.join(repoRoot, "docs", "ops", "export-field-lists.md");

describe("export field-list doc (LIFE-03)", () => {
  it("matches the registry (run npm run docs:fields if this fails)", () => {
    const onDisk = readFileSync(docPath, "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(renderFieldLists());
  });

  it("has one sorted section per registry collection plus organizations", () => {
    const md = renderFieldLists();
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const expected = [
      ...Object.keys(allTenantCollections()),
      "organizations",
    ].sort();
    expect(headings).toEqual(expected);
  });

  it("marks end_users as never exported", () => {
    const md = renderFieldLists();
    const endUsers = md.split("## end_users")[1]!.split("\n## ")[0]!;
    expect(endUsers).toContain(
      "Never exported (auth collection). Logins return through the disaster-recovery path, not the export (LIFE-03, TEN-12).",
    );
    expect(endUsers).not.toMatch(/^- /m);
  });

  it("lists no secret-looking field", () => {
    // pages.password_protected is a boolean flag, not a secret: the one named exemption.
    // The hash itself (password_hash) must never appear.
    const md = renderFieldLists();
    expect(md).not.toContain("password_hash");
    expect(md.replaceAll("- `password_protected`", "")).not.toMatch(
      /^- `[^`\n]*(password|token|secret|hash|api_?key)[^`\n]*`$/im,
    );
  });
});
