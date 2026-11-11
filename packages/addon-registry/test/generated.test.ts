// Drift guard for the codegen'd barrels (ADDON-01; RESEARCH Pattern 1; T-05-17). The
// generator runs in memory and every committed file must match. The gates never rewrite the
// barrels (pretest/pretypecheck/prebuild and the Dockerfile run `addons:check`, B-CR-02), so
// this test sees the committed files even under `npm test`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSOLE_ROUTE,
  HEADER,
  STAFF_ROUTE,
  collect,
  discover,
  isStaffHowto,
  parseFrontMatter,
  parseStepTable,
  parseSummary,
  parseUseSteps,
  parseTitle,
  partitionHowtos,
  readHelpHowtos,
  readStaffHowtos,
  render,
  staleFiles,
} from "../scripts/gen.mjs";

const pkgDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");

const FILES = [
  "src/generated/manifests.ts",
  "src/generated/server.ts",
  "src/generated/site.ts",
  "src/generated/admin.ts",
  "src/generated/howto.ts",
  "src/generated/help.ts",
  "src/generated/staff-help.ts",
];

describe("generated add-on barrels (ADDON-01)", () => {
  const expected = render(collect(repoRoot));

  it("renders exactly the seven generated files", () => {
    expect(Object.keys(expected).sort()).toEqual([...FILES].sort());
  });

  it.each(FILES)("%s is current (run npm run addons:gen)", (rel) => {
    const onDisk = readFileSync(path.join(pkgDir, rel), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    expect(onDisk, `${rel} is stale: run npm run addons:gen`).toBe(
      expected[rel],
    );
  });

  it("starts every file with the GENERATED header and ends with a newline", () => {
    for (const content of Object.values(expected)) {
      expect(content.split("\n")[0]).toBe(HEADER);
      expect(content.endsWith("\n")).toBe(true);
    }
  });
});

describe("render (pure)", () => {
  const input = {
    addons: [
      { slug: "testimonials", name: "@cds/addon-testimonials" },
      { slug: "studio-booking", name: "@cds/addon-studio-booking" },
    ],
    howtos: [
      {
        path: "docs/how-to/addon-testimonials.md",
        text: "---\nfeature: T\n---\n\n## Activate\n\n| # | Screen / route | Action | Expected result |\n|---|---|---|---|\n| 1 | `/a` | A | B |\n\n## Use\n\n| # | Screen / route | Action | Expected result |\n|---|---|---|---|\n| 1 | `/hub/x` | Click **New** | Form opens |\n| 2 | Form | Save | Saved |\n",
      },
    ],
    runbooks: ["docs/runbooks/studio-booking.md"],
  };
  const out = render(input);

  it("imports each add-on per entry point, sorted by slug, keyed by slug", () => {
    const m = out["src/generated/manifests.ts"]!;
    expect(m.indexOf("@cds/addon-studio-booking")).toBeLessThan(
      m.indexOf("@cds/addon-testimonials"),
    );
    expect(m).toContain(
      'import addon_studio_booking from "@cds/addon-studio-booking";',
    );
    expect(out["src/generated/server.ts"]).toContain(
      'import * as addon_testimonials from "@cds/addon-testimonials/server";',
    );
    expect(out["src/generated/site.ts"]).toContain(
      '"studio-booking": addon_studio_booking,',
    );
    expect(out["src/generated/admin.ts"]).toContain(
      '"@cds/addon-testimonials/admin"',
    );
  });

  it("bakes Use steps and runbooks into howto.ts", () => {
    const h = out["src/generated/howto.ts"]!;
    expect(h).toContain('"docs/how-to/addon-testimonials.md"');
    expect(h).toContain('"action": "Click **New**"');
    expect(h).not.toContain('"action": "A"');
    expect(h).toContain('["docs/runbooks/studio-booking.md"]');
  });

  it("emits empty frozen maps with zero add-ons", () => {
    const empty = render({ addons: [], howtos: [], runbooks: [] });
    expect(empty["src/generated/server.ts"]).toContain(
      "Readonly<Record<string, never>> = Object.freeze({});",
    );
    expect(empty["src/generated/manifests.ts"]).toContain("Object.freeze([]);");
  });

  it("parses only the Use table with the canonical header", () => {
    expect(parseUseSteps(input.howtos[0]!.text)).toEqual([
      { screen: "`/hub/x`", action: "Click **New**", expected: "Form opens" },
      { screen: "Form", action: "Save", expected: "Saved" },
    ]);
    expect(
      parseUseSteps("## Use\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"),
    ).toEqual([]);
    expect(parseUseSteps("## Activate\n\nnothing\n")).toEqual([]);
  });

  it("never bakes core how-tos", () => {
    const h = expected_howto();
    expect(h).not.toContain("docs/how-to/popups.md");
  });
});

// 11-46 (DASH-17): every how-to is baked for the Help center, in a server-only file.
describe("help.ts (11-46, Help center bake)", () => {
  const help = render(collect(repoRoot))["src/generated/help.ts"]!;

  it("bakes every tenant docs/how-to/*.md except TEMPLATE and README", () => {
    expect(help).toContain('"docs/how-to/today.md"');
    expect(help).toContain('"docs/how-to/popups.md"');
    expect(help).not.toContain("docs/how-to/TEMPLATE.md");
    expect(help).not.toContain("docs/how-to/README.md");
    const paths = readHelpHowtos(repoRoot).map((h) => h.path);
    expect(paths).toContain("docs/how-to/today.md");
    expect(paths.some((p) => /TEMPLATE|README/.test(p))).toBe(false);
  });

  it("never bakes staff or operator how-tos (T-11-45-01)", () => {
    for (const f of [
      "dashboard-staff-clis.md",
      "theme-import.md",
      "assembled-site-review.md",
      "billing-staff-clis.md",
      "monthly-site-email-job.md",
      "impersonation.md",
      "media-cdn-bunny.md",
    ]) {
      expect(help).not.toContain(`"docs/how-to/${f}"`);
    }
    expect(isStaffHowto("---\nroute: terminal: npm run x\n---\n")).toBe(true);
    expect(isStaffHowto("---\nroute: /hub/today\n---\n")).toBe(false);
  });

  it("keeps the client-bundled howto.ts to add-on how-tos", () => {
    const howto = expected_howto();
    expect(howto).not.toContain("docs/how-to/today.md");
    expect(howto).not.toContain("HELP_ARTICLES");
  });

  it("imports nothing but the step type", () => {
    const imports = help.split("\n").filter((l) => l.startsWith("import"));
    expect(imports).toEqual(['import type { HowToStep } from "./howto";']);
  });

  it("parses front matter, Activate and Use tables and a plain summary", () => {
    const md =
      "---\nfeature: Thing\nroute: /hub/thing\n---\n\n# How to: Thing\n\nThese steps are the recording script for the videos.\n\nThe **Thing** lists [your pages](x.md) (CONT-08, D12). It also does more.\n\n## Activate\n\n| # | Screen / route | Action | Expected result |\n|---|---|---|---|\n| 1 | `/a` | A | B |\n\n## Use\n\n| # | Screen / route | Action | Expected result |\n|---|---|---|---|\n| 1 | `/hub/x` | Click **New** | Form opens |\n";
    expect(parseFrontMatter(md)).toEqual({
      feature: "Thing",
      route: "/hub/thing",
    });
    expect(parseStepTable(md, "Activate")).toEqual([
      { screen: "`/a`", action: "A", expected: "B" },
    ]);
    expect(parseSummary(md)).toBe("The Thing lists your pages.");
  });

  it("cuts a long first sentence at a word with an ellipsis", () => {
    const md = `# T\n\n${"word ".repeat(60)}end.\n`;
    const s = parseSummary(md);
    expect(s.length).toBeLessThanOrEqual(160);
    expect(s.endsWith("…")).toBe(true);
  });
});

// 13-01 (P13-P12, T-13-01-01): staff console how-tos never reach tenant Help; the console
// gets its own server-only STAFF_HELP map keyed by slug.
describe("staff-help.ts (13-01, staff console how-tos)", () => {
  const fm = (route: string) =>
    `---\nfeature: X\nroute: ${route}\n---\n\n# How to: Sites list\n\n## Use\n\n` +
    "| # | Screen / route | Action | Expected result |\n|---|---|---|---|\n" +
    "| 1 | `/staff/sites` | Click **Open** | Detail opens |\n";

  it("STAFF_ROUTE covers /staff and /api/monitor, not tenant routes", () => {
    for (const r of [
      "/staff/tickets",
      "/staff",
      "/api/monitor/status",
      "npm run support:list",
    ]) {
      expect(STAFF_ROUTE.test(r), r).toBe(true);
    }
    for (const r of [
      "/hub/support/tickets/1042",
      "/report",
      "/start",
      "/staffing",
      "/hub/staff",
    ]) {
      expect(STAFF_ROUTE.test(r), r).toBe(false);
    }
    expect(CONSOLE_ROUTE.test("/staff/sites")).toBe(true);
    expect(CONSOLE_ROUTE.test("/api/monitor/status")).toBe(false);
  });

  it("partitions a /staff how-to into the staff set and never into help", () => {
    const items = [
      { path: "docs/how-to/staff-sites.md", text: fm("/staff/sites") },
      { path: "docs/how-to/report.md", text: fm("/report") },
      { path: "docs/how-to/rating.md", text: fm("/hub/support/tickets/1042") },
      { path: "docs/how-to/monitor.md", text: fm("/api/monitor/status") },
      { path: "docs/how-to/cli.md", text: fm("terminal: npm run x") },
    ];
    const { help, staff } = partitionHowtos(items);
    expect(staff.map((h: { path: string }) => h.path)).toEqual([
      "docs/how-to/staff-sites.md",
    ]);
    expect(help.map((h: { path: string }) => h.path)).toEqual([
      "docs/how-to/report.md",
      "docs/how-to/rating.md",
    ]);
  });

  it("bakes STAFF_HELP keyed by slug with title, route and steps", () => {
    const out = render({
      addons: [],
      howtos: [],
      runbooks: [],
      helpHowtos: [],
      staffHowtos: [
        { path: "docs/how-to/staff-sites.md", text: fm("/staff/sites") },
      ],
    });
    const s = out["src/generated/staff-help.ts"]!;
    expect(s).toContain("export const STAFF_HELP");
    expect(s).toContain('"staff-sites": {');
    expect(s).toContain('"title": "Sites list"');
    expect(s).toContain('"route": "/staff/sites"');
    expect(s).toContain('"action": "Click **Open**"');
    expect(out["src/generated/help.ts"]).not.toContain("staff-sites");
    expect(parseTitle(fm("/staff"))).toBe("Sites list");
  });

  it("the committed staff-help.ts holds only /staff how-tos and help.ts none", () => {
    const files = render(collect(repoRoot));
    const staffPaths = readStaffHowtos(repoRoot).map(
      (h: { path: string }) => h.path,
    );
    for (const p of staffPaths) {
      expect(files["src/generated/help.ts"]).not.toContain(`"${p}"`);
    }
    expect(files["src/generated/help.ts"]).not.toContain("Staff console");
    if (staffPaths.length === 0) {
      expect(files["src/generated/staff-help.ts"]).toContain(
        "Object.freeze(\n  {},\n);",
      );
    }
    const imports = files["src/generated/staff-help.ts"]!.split("\n").filter(
      (l) => l.startsWith("import"),
    );
    expect(imports).toEqual(['import type { HowToStep } from "./howto";']);
  });
});

function expected_howto(): string {
  return render(collect(repoRoot))["src/generated/howto.ts"]!;
}

describe("discover", () => {
  it("returns sorted add-on folders whose package name matches the folder", () => {
    const found = discover(repoRoot);
    expect(found.map((a) => a.slug)).toEqual(
      [...found.map((a) => a.slug)].sort(),
    );
    for (const a of found) expect(a.name).toBe(`@cds/addon-${a.slug}`);
  });
});

// B-CR-02: the gates check, never write, so the drift test and the image see committed files.
describe("addons:check (B-CR-02)", () => {
  it("staleFiles reports changed and missing files, ignoring CRLF", () => {
    const files = { "a.ts": "x\ny\n", "b.ts": "b\n", "c.ts": "c\n" };
    const disk: Record<string, string | null> = {
      "a.ts": "x\r\ny\r\n",
      "b.ts": "changed\n",
      "c.ts": null,
    };
    expect(staleFiles(files, (rel) => disk[rel] ?? null)).toEqual([
      "b.ts",
      "c.ts",
    ]);
  });

  it("the committed barrels pass the check", () => {
    const files = render(collect(repoRoot));
    expect(
      staleFiles(files, (rel) => readFileSync(path.join(pkgDir, rel), "utf8")),
    ).toEqual([]);
  });

  it("pretypecheck, pretest and prebuild run addons:check; the Dockerfile checks before next build", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    for (const hook of ["pretypecheck", "pretest", "prebuild"]) {
      // 09-05 chains legal:check after it.
      expect(pkg.scripts[hook]).toBe(
        "npm run addons:check && npm run legal:check",
      );
    }
    expect(pkg.scripts["addons:check"]).toContain("gen.mjs --check");
    const docker = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
    expect(docker).toMatch(
      /RUN npm run addons:check && npm run legal:check && npm run build -w @cds\/web/,
    );
  });
});
