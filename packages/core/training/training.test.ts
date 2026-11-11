// Core training coverage (CONT-32, D281, D87, D110; CONTEXT A4-Q4). Every core block and
// column item kind, and each core feature, has a training entry that points at a real,
// well-formed how-to. A new core section type or item kind without one fails here.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN_ITEM_KINDS, CORE_SECTIONS } from "../src/content";
import {
  CORE_TRAINING,
  P7_FEATURES,
  P7_TRAINING_MODULES,
  P8_FEATURES,
  P8_TRAINING_MODULES,
  P11_FEATURES,
  P11_TRAINING_MODULES,
  P12_FEATURES,
  P12_TRAINING_MODULES,
  P13_FEATURES,
  P13_TRAINING_MODULES,
  P14_FEATURES,
  P14_TRAINING_MODULES,
  trainingFor,
} from "./index";
import * as p8Blocks from "./p8/blocks";
import * as p11Shell from "./p11/shell";
import * as p11Pages from "./p11/pages";
import * as p11Growth from "./p11/growth";
import * as p12Support from "./p12/support";
import * as p13Console from "./p13/console";
import * as p14Domains from "./p14/domains";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const CORE_FEATURES = [
  "banner",
  "popups",
  "publish",
  "pages",
  "theming",
  "setup",
  "team-hours",
  // 08-04: renamed from "services" so the Services block owns that id.
  "services-list",
  "email-routing",
  "mood-board",
] as const;
// P7 features come from the training/p7/* modules (07-02), so owning plans never edit this test.
// P8 features come from the training/p8/* modules (08-04), the same way.
const FEATURES: readonly string[] = [
  ...CORE_FEATURES,
  ...P7_FEATURES,
  ...P8_FEATURES,
  // P11 features come from the training/p11/* modules (11-43).
  ...P11_FEATURES,
  // P12 features come from the training/p12/* modules (12-33).
  ...P12_FEATURES,
  // P13 features come from the training/p13/* modules (13-50).
  ...P13_FEATURES,
  // P14 features come from the training/p14/* modules (14-46).
  ...P14_FEATURES,
];

function frontmatter(md: string): Record<string, string> {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.indexOf("---", 1);
  const out: Record<string, string> = {};
  for (const line of lines.slice(1, end === -1 ? 0 : end)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

describe("CORE_TRAINING coverage (CONT-32)", () => {
  it("has a block entry for every core section type", () => {
    for (const def of CORE_SECTIONS) {
      const entry = trainingFor(def.type);
      expect(entry, def.type).toBeDefined();
      expect(entry?.kind).toBe("block");
    }
  });

  it("has an item entry for every column item kind", () => {
    for (const kind of COLUMN_ITEM_KINDS) {
      const entry = trainingFor(`item:${kind}`);
      expect(entry, kind).toBeDefined();
      expect(entry?.kind).toBe("item");
    }
  });

  it("has a feature entry for banner, pop-ups, publish, pages, theming and the P6 setup features", () => {
    for (const id of FEATURES) {
      expect(trainingFor(id)?.kind, id).toBe("feature");
    }
  });

  it("has exactly one entry per block, item and feature, with unique ids", () => {
    const ids = CORE_TRAINING.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(
      CORE_SECTIONS.length + COLUMN_ITEM_KINDS.length + FEATURES.length,
    );
  });

  it("points every entry at an existing how-to with feature/phase/route", () => {
    for (const e of CORE_TRAINING) {
      expect(e.howTo, e.id).toMatch(/^docs\/how-to\/[a-z0-9-]+\.md$/);
      const file = path.join(repoRoot, e.howTo);
      expect(existsSync(file), e.howTo).toBe(true);
      const fm = frontmatter(readFileSync(file, "utf8"));
      expect(fm.feature, e.howTo).toBeTruthy();
      expect(fm.phase, e.howTo).toBeTruthy();
      expect(fm.route, e.howTo).toBeTruthy();
    }
  });

  it("ties every entry to a CONT, THEME, ONB, CONTACTS, TMPL, DASH, LIFE, COMM, SUPPORT, CUSTOM, STAFF or DOM requirement and has no video yet", () => {
    for (const e of CORE_TRAINING) {
      expect(e.requirement, e.id).toMatch(
        /^(CONT|THEME|ONB|CONTACTS|TMPL|DASH|LIFE|COMM|SUPPORT|CUSTOM|STAFF|DOM)-\d{2}$/,
      );
      expect(e.video, e.id).toBeNull();
      expect(e.title.trim(), e.id).not.toBe("");
    }
  });

  it("maps the planned requirements", () => {
    expect(trainingFor("columns")?.requirement).toBe("CONT-05");
    expect(trainingFor("hero")?.requirement).toBe("CONT-03");
    expect(trainingFor("item:text")?.requirement).toBe("CONT-09");
    expect(trainingFor("item:countdown")?.requirement).toBe("CONT-10");
    expect(trainingFor("item:button")?.requirement).toBe("CONT-12");
    expect(trainingFor("banner")?.requirement).toBe("CONT-11");
    expect(trainingFor("popups")?.requirement).toBe("CONT-12");
    expect(trainingFor("publish")?.requirement).toBe("CONT-30");
    expect(trainingFor("pages")?.requirement).toBe("CONT-08");
    expect(trainingFor("setup")?.requirement).toBe("ONB-02");
    expect(trainingFor("team-hours")?.requirement).toBe("ONB-13");
    expect(trainingFor("services-list")?.requirement).toBe("ONB-13");
    expect(trainingFor("email-routing")?.requirement).toBe("ONB-09");
    expect(trainingFor("mood-board")?.requirement).toBe("ONB-05");
  });

  it("points the P6 features at their how-tos (06-23)", () => {
    expect(trainingFor("setup")?.howTo).toBe("docs/how-to/set-up-your-site.md");
    expect(trainingFor("email-routing")?.howTo).toBe(
      "docs/how-to/email-routing.md",
    );
    expect(trainingFor("mood-board")?.howTo).toBe("docs/how-to/mood-board.md");
    for (const e of CORE_TRAINING) {
      expect(existsSync(path.join(repoRoot, e.howTo)), e.howTo).toBe(true);
    }
  });

  it("never offers a custom (raw HTML) block", () => {
    for (const e of CORE_TRAINING) {
      for (const field of [e.id, e.title, e.howTo]) {
        expect(field.toLowerCase(), e.id).not.toContain("custom");
      }
    }
    expect(trainingFor("custom")).toBeUndefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(trainingFor("item:not-a-kind")).toBeUndefined();
    expect(trainingFor("")).toBeUndefined();
  });
});

describe("P7 training modules (07-02)", () => {
  it("aggregates the 14 P7 modules into CORE_TRAINING", () => {
    expect(P7_TRAINING_MODULES).toHaveLength(14);
    for (const m of P7_TRAINING_MODULES) {
      for (const e of m.entries) expect(CORE_TRAINING).toContain(e);
    }
  });

  it("lists as features only feature-kind entries of the same module", () => {
    for (const m of P7_TRAINING_MODULES) {
      for (const id of m.features) {
        const entry = m.entries.find((e) => e.id === id);
        expect(entry, id).toBeDefined();
        expect(entry?.kind, id).toBe("feature");
      }
    }
  });

  it("keeps every entry id unique across all modules", () => {
    const ids = P7_TRAINING_MODULES.flatMap((m) => m.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("P8 training modules (08-04)", () => {
  it("wires the assembly and block modules (08-05)", () => {
    expect(P8_TRAINING_MODULES).toHaveLength(2);
    expect(P8_TRAINING_MODULES).toContain(p8Blocks);
    for (const m of P8_TRAINING_MODULES) {
      for (const e of m.entries) expect(CORE_TRAINING).toContain(e);
    }
  });

  it("renames the P6 services feature to services-list (no id collision)", () => {
    const entry = trainingFor("services-list");
    expect(entry?.kind).toBe("feature");
    expect(entry?.howTo).toBe("docs/how-to/services.md");
    expect(trainingFor("services")?.kind).toBe("block");
    expect(trainingFor("team")?.kind).toBe("block");
  });

  it("prepares the Services and Our team block entries with real how-tos", () => {
    expect(p8Blocks.features).toEqual([]);
    expect(p8Blocks.entries.map((e) => [e.id, e.kind])).toEqual([
      ["services", "block"],
      ["team", "block"],
    ]);
    for (const e of p8Blocks.entries) {
      expect(e.requirement).toBe("TMPL-01");
      expect(e.video).toBeNull();
      const file = path.join(repoRoot, e.howTo);
      expect(existsSync(file), e.howTo).toBe(true);
      const fm = frontmatter(readFileSync(file, "utf8"));
      expect(fm.feature, e.howTo).toBeTruthy();
      expect(fm.phase, e.howTo).toBe("08");
      expect(fm.route, e.howTo).toBeTruthy();
    }
  });
});

describe("P11 training modules (11-43)", () => {
  it("registers shell, pages and growth into CORE_TRAINING", () => {
    expect(P11_TRAINING_MODULES).toEqual([p11Shell, p11Pages, p11Growth]);
    for (const m of P11_TRAINING_MODULES) {
      for (const e of m.entries) expect(CORE_TRAINING).toContain(e);
      for (const id of m.features) {
        expect(m.entries.find((e) => e.id === id)?.kind, id).toBe("feature");
      }
    }
  });

  it("covers the shell, Today and alerts with phase-11 how-tos", () => {
    expect(p11Shell.features).toEqual([
      "today",
      "needs-you",
      "phone-alerts",
      "alert-settings",
      "switch-sites",
      "jump-to",
      "help",
    ]);
    for (const e of p11Shell.entries) {
      expect(e.kind, e.id).toBe("feature");
      expect(e.requirement, e.id).toMatch(/^DASH-\d{2}$/);
      const fm = frontmatter(
        readFileSync(path.join(repoRoot, e.howTo), "utf8"),
      );
      expect(fm.phase, e.howTo).toBe("11");
    }
    expect(trainingFor("today")?.howTo).toBe("docs/how-to/today.md");
    expect(trainingFor("help")?.requirement).toBe("DASH-17");
  });

  it("covers pages, reports, profile and support, linking the existing how-tos (11-44)", () => {
    expect(p11Pages.features).toEqual([
      "page-history",
      "add-pages",
      "delete-page",
      "site-report",
      "monthly-email",
      "profile",
      "support",
    ]);
    for (const e of p11Pages.entries) {
      expect(e.kind, e.id).toBe("feature");
      expect(e.requirement, e.id).toMatch(/^DASH-\d{2}$/);
      const fm = frontmatter(
        readFileSync(path.join(repoRoot, e.howTo), "utf8"),
      );
      // 12-33 rewrote cds-support.md for the full P12 CDS Support screen.
      expect(fm.phase, e.howTo).toBe(e.id === "support" ? "12" : "11");
    }
    expect(trainingFor("add-pages")?.howTo).toBe(
      "docs/how-to/page-allowance.md",
    );
    expect(trainingFor("delete-page")?.howTo).toBe(
      "docs/how-to/page-delete.md",
    );
    expect(trainingFor("site-report")?.howTo).toBe("docs/how-to/reports.md");
    expect(trainingFor("monthly-email")?.requirement).toBe("DASH-12");
    expect(p11Pages.ownerOnly).toEqual(["add-pages"]);
    // Staff procedures never reach a tenant's Help (T-11-45-01).
    for (const e of CORE_TRAINING) {
      expect(e.howTo).not.toMatch(/monthly-site-email-job|staff-/);
    }
  });

  it("covers social, growth, your data and people, linking the existing how-tos (11-45)", () => {
    expect(p11Growth.features).toEqual([
      "social-accounts",
      "grow-social",
      "download-data",
      "people-roles",
    ]);
    for (const e of p11Growth.entries) {
      expect(e.kind, e.id).toBe("feature");
      expect(e.requirement, e.id).toMatch(/^(DASH|LIFE)-\d{2}$/);
      const fm = frontmatter(
        readFileSync(path.join(repoRoot, e.howTo), "utf8"),
      );
      expect(fm.phase, e.howTo).toBe("11");
    }
    expect(trainingFor("social-accounts")?.howTo).toBe(
      "docs/how-to/social-accounts.md",
    );
    expect(trainingFor("people-roles")?.howTo).toBe(
      "docs/how-to/people-and-roles.md",
    );
    expect(trainingFor("download-data")?.requirement).toBe("LIFE-04");
    expect(p11Growth.ownerOnly).toEqual(["download-data"]);
    expect(p11Growth.ownerAdminOnly).toEqual(["people-roles"]);
    // The staff CLI how-to never reaches a tenant's Help (T-11-45-01).
    for (const e of CORE_TRAINING) {
      expect(e.howTo).not.toMatch(/dashboard-staff-clis/);
    }
  });
});

describe("P12 training modules (12-33)", () => {
  it("registers p12/support into CORE_TRAINING", () => {
    expect(P12_TRAINING_MODULES).toEqual([p12Support]);
    for (const e of p12Support.entries) expect(CORE_TRAINING).toContain(e);
  });

  it("covers every P12 tenant feature with a phase-12 how-to", () => {
    expect(p12Support.features).toEqual([
      "support.messages",
      "support.get-help",
      "support.follow-ticket",
      "support.documents",
      "support.ideas",
      "service-notices",
      "paid-services",
      "what-support-includes",
    ]);
    for (const e of p12Support.entries) {
      expect(e.kind, e.id).toBe("feature");
      expect(e.requirement, e.id).toMatch(/^(COMM|SUPPORT|CUSTOM)-\d{2}$/);
      const file = path.join(repoRoot, e.howTo);
      expect(existsSync(file), e.howTo).toBe(true);
      const fm = frontmatter(readFileSync(file, "utf8"));
      expect(fm.phase, e.howTo).toBe("12");
    }
    expect(trainingFor("what-support-includes")?.requirement).toBe(
      "SUPPORT-01",
    );
    expect(trainingFor("support.ideas")?.requirement).toBe("CUSTOM-01");
    // The CDS Support entry stays in p11, pointing at the rewritten how-to.
    expect(trainingFor("support")?.howTo).toBe("docs/how-to/cds-support.md");
  });

  it("gives the staff support CLIs no training entry (T-12-33-01)", () => {
    for (const e of CORE_TRAINING) {
      expect(e.howTo).not.toMatch(/support-staff-clis/);
    }
  });
});

describe("P13 training modules (13-50)", () => {
  it("registers p13/console into CORE_TRAINING", () => {
    expect(P13_TRAINING_MODULES).toEqual([p13Console]);
    for (const e of p13Console.entries) expect(CORE_TRAINING).toContain(e);
    expect(P13_FEATURES).toEqual(["support.rating", "site-suspension"]);
  });

  it("points every P13 entry at a phase-13 tenant how-to", () => {
    for (const e of p13Console.entries) {
      expect(e.kind, e.id).toBe("feature");
      expect(e.requirement, e.id).toMatch(/^STAFF-\d{2}$/);
      const file = path.join(repoRoot, e.howTo);
      expect(existsSync(file), e.howTo).toBe(true);
      const fm = frontmatter(readFileSync(file, "utf8"));
      expect(fm.phase, e.howTo).toBe("13");
      expect(fm.route, e.howTo).not.toMatch(/^\/staff\b/);
    }
    expect(trainingFor("support.rating")?.howTo).toBe(
      "docs/how-to/rate-a-resolved-ticket.md",
    );
    expect(trainingFor("site-suspension")?.howTo).toBe(
      "docs/how-to/content-notices-and-suspension.md",
    );
  });

  it("gives no staff how-to a training entry (T-13-50-01)", () => {
    for (const e of p13Console.entries) {
      expect(e.howTo).not.toMatch(
        /staff-|media-staff-tools|support-staff-clis|impersonation/,
      );
    }
    for (const e of CORE_TRAINING) {
      expect(e.howTo, e.id).not.toMatch(/\/staff-|media-staff-tools/);
    }
  });
});

describe("P14 training modules (14-46)", () => {
  const P14_IDS = [
    "connect-your-domain",
    "add-a-dns-record",
    "set-up-email-for-your-domain",
    "email-address",
    "review-your-site-before-launch",
    "preview-links",
    "leaving-cds",
  ];

  it("registers p14/domains into CORE_TRAINING", () => {
    expect(P14_TRAINING_MODULES).toEqual([p14Domains]);
    for (const e of p14Domains.entries) expect(CORE_TRAINING).toContain(e);
    expect(P14_FEATURES).toEqual(P14_IDS);
  });

  it("points every P14 entry at an owner how-to (no staff route)", () => {
    for (const e of p14Domains.entries) {
      expect(e.kind, e.id).toBe("feature");
      expect(e.requirement, e.id).toMatch(
        /^(DOM-02|DOM-03|DOM-07|DOM-10|LIFE-01|ONB-10)$/,
      );
      const file = path.join(repoRoot, e.howTo);
      expect(existsSync(file), e.howTo).toBe(true);
      const fm = frontmatter(readFileSync(file, "utf8"));
      // professional-email-address keeps its P6 phase; P14 adds its sending steps.
      expect(fm.phase, e.howTo).toBe(e.id === "email-address" ? "06" : "14");
      expect(fm.route, e.howTo).toMatch(/^\/hub\//);
      expect(e.howTo, e.id).not.toMatch(/\/staff-/);
    }
    expect(trainingFor("connect-your-domain")?.howTo).toBe(
      "docs/how-to/connect-your-domain.md",
    );
  });

  it("audience lists cover only P14 ids and never overlap", () => {
    const ids = new Set(P14_IDS);
    for (const id of [...p14Domains.ownerOnly, ...p14Domains.ownerAdminOnly]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(p14Domains.ownerOnly).toEqual(["leaving-cds"]);
    for (const id of p14Domains.ownerOnly) {
      expect(p14Domains.ownerAdminOnly).not.toContain(id);
    }
    expect(p14Domains.ownerAdminOnly).not.toContain("preview-links");
  });
});
