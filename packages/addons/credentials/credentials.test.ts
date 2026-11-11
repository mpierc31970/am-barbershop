// Credentials manifest, record rules, CSV spec, expiry helpers and block settings (ADDON-02,
// ADDON-08, ADDON-10, ADDON-12; CONTEXT A5-Q2; T-05-44, T-05-45).
import { existsSync } from "node:fs";
import path from "node:path";
import { InvalidInput } from "@cds/core";
import { composeAddonRegistry } from "@cds/core/addons";
import { CORE_SECTIONS, composeSectionRegistry } from "@cds/core/content";
import { parseCsv, templateCsv, validateRows } from "@cds/core/csv";
import type { TemplateSlotContribution } from "@cds/core/addons";
import type { TemplateSlotInput } from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import manifest from "./index";
import { CREDENTIALS_CSV } from "./csv";
import {
  dayOf,
  expiresSoon,
  formatDayMonth,
  formatDayMonthYear,
  formatMonthYear,
  formatYear,
  isExpired,
} from "./expiry";
import { CREDENTIAL_RECORDS, validateCredential } from "./records";
import {
  credentialsSection,
  validateCredentialsContent,
} from "./sections/definition";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const base = { title: "Registered Nurse", issuer: "Texas Board of Nursing" };
const v = (extra: Record<string, unknown>) =>
  validateCredential({ ...base, ...extra });

describe("record rules (validate)", () => {
  it("keeps a clean record with defaults (number hidden, shown on site)", () => {
    expect(validateCredential(base)).toEqual({
      title: "Registered Nurse",
      issuer: "Texas Board of Nursing",
      category: "",
      credential_number: "",
      show_number: false,
      issued_on: "",
      expires_on: "",
      verify_url: "",
      is_published: true,
    });
  });

  it("requires a title and an issuer, and caps their length", () => {
    expect(() => v({ title: "  " })).toThrow(
      "Title is empty. Add the credential's name.",
    );
    expect(() => v({ issuer: "" })).toThrow(
      "Issued by is empty. Add who issued it.",
    );
    expect(() => v({ title: "x".repeat(161) })).toThrow(
      "Title is longer than 160 characters.",
    );
    expect(v({ title: "x".repeat(160) }).title.length).toBe(160);
    expect(() => v({ credential_number: "1".repeat(81) })).toThrow(
      "Number is longer than 80 characters.",
    );
  });

  it("trims the group and caps it at 60", () => {
    expect(v({ category: "  Licenses  " }).category).toBe("Licenses");
    expect(() => v({ category: "g".repeat(61) })).toThrow(
      "Group is longer than 60 characters.",
    );
  });

  it("accepts YYYY-MM-DD, PocketBase dates and US dates; refuses the rest", () => {
    expect(v({ expires_on: "2027-03-14" }).expires_on).toBe("2027-03-14");
    expect(v({ expires_on: "2027-03-14 00:00:00.000Z" }).expires_on).toBe(
      "2027-03-14",
    );
    expect(v({ expires_on: "3/14/2027" }).expires_on).toBe("2027-03-14");
    expect(v({ expires_on: "" }).expires_on).toBe("");
    expect(v({ expires_on: null }).expires_on).toBe("");
    for (const bad of ["2027-02-30", "soon", "14.03.2027", 20270314]) {
      expect(() => v({ expires_on: bad })).toThrow(
        "Expires isn't a date. Use a date like 2027-03-14.",
      );
    }
    expect(() => v({ issued_on: "last year" })).toThrow("Issued isn't a date.");
  });

  it("refuses an Expires before Issued", () => {
    expect(() =>
      v({ issued_on: "2020-01-01", expires_on: "2019-12-31" }),
    ).toThrow("Expires is before Issued.");
    expect(
      v({ issued_on: "2020-01-01", expires_on: "2020-01-01" }).expires_on,
    ).toBe("2020-01-01");
  });

  it("allows http(s) verify links only (T-05-44)", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "//evil.test/x",
      "ftp://x.test/a",
      "www.bon.texas.gov",
    ]) {
      expect(() => v({ verify_url: bad })).toThrow(
        "Verify link must start with https:// or http://",
      );
    }
    expect(v({ verify_url: " https://bon.texas.gov/verify " }).verify_url).toBe(
      "https://bon.texas.gov/verify",
    );
  });

  it("drops unknown keys and refuses an organization key", () => {
    const out = v({ evil: 1, sort_order: 9, created: "x" }) as Record<
      string,
      unknown
    >;
    expect(out).not.toHaveProperty("evil");
    expect(out).not.toHaveProperty("sort_order");
    expect(() => v({ organization: "orgB" })).toThrow(InvalidInput);
    expect(() => validateCredential(["x"])).toThrow(InvalidInput);
  });

  it("screens every text and the verify link; title and group come from the record", () => {
    const rec = v({
      category: "Licenses",
      credential_number: "RN123",
      verify_url: "https://bon.test/v",
    });
    expect(CREDENTIAL_RECORDS.textsOf(rec)).toEqual([
      "Registered Nurse",
      "Texas Board of Nursing",
      "Licenses",
      "RN123",
    ]);
    expect(CREDENTIAL_RECORDS.urlsOf(rec)).toEqual(["https://bon.test/v"]);
    expect(CREDENTIAL_RECORDS.title(rec)).toBe("Registered Nurse");
    expect(CREDENTIAL_RECORDS.groupField).toBe("category");
  });
});

describe("public fields (B-WR-04, D187)", () => {
  it("gates the credential number on Show number at the chokepoint", () => {
    const spec = manifest.collections.credentials!;
    expect(spec.public).toContain("credential_number");
    expect(spec.publicWhen).toEqual({ credential_number: "show_number" });
  });
});

describe("expiry helpers", () => {
  const now = new Date("2026-09-27T15:00:00Z");

  it("isExpired: the day after expires_on, never the same day", () => {
    expect(isExpired("2026-09-26", now)).toBe(true);
    expect(isExpired("2026-09-27", now)).toBe(false);
    expect(isExpired("2026-09-27 00:00:00.000Z", now)).toBe(false);
    expect(isExpired("", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });

  it("never hides a credential before its expiry day ends locally, even in Texas (B-WR-03)", () => {
    // 19:00 CDT on 14 Mar is 00:00 UTC on 15 Mar: still the last valid day in Texas.
    expect(isExpired("2027-03-14", new Date("2027-03-15T00:00:00Z"))).toBe(
      false,
    );
    // 23:59 in Honolulu (UTC-10) on 14 Mar: still valid.
    expect(isExpired("2027-03-14", new Date("2027-03-15T09:59:00Z"))).toBe(
      false,
    );
    // 23:59 at UTC-12 on 14 Mar is the last moment anywhere on Earth.
    expect(isExpired("2027-03-14", new Date("2027-03-15T11:59:59Z"))).toBe(
      false,
    );
    expect(isExpired("2027-03-14", new Date("2027-03-15T12:00:00Z"))).toBe(
      true,
    );
    expect(expiresSoon("2027-03-14", new Date("2027-03-15T06:00:00Z"))).toBe(
      true,
    );
  });

  it("expiresSoon: within 60 days (today counts), not 61, never when expired", () => {
    expect(expiresSoon("2026-09-27", now)).toBe(true);
    expect(expiresSoon("2026-11-26", now)).toBe(true); // 60 days
    expect(expiresSoon("2026-11-27", now)).toBe(false); // 61 days
    expect(expiresSoon("2026-09-26", now)).toBe(false); // expired
    expect(expiresSoon("", now)).toBe(false);
    expect(expiresSoon("2026-10-07", now, 5)).toBe(false);
  });

  it("formats dates in fixed English", () => {
    expect(formatMonthYear("2027-03-14")).toBe("March 2027");
    expect(formatMonthYear("2027-03-14 00:00:00.000Z")).toBe("March 2027");
    expect(formatYear("2019-06-01")).toBe("2019");
    expect(formatDayMonth("2026-11-12")).toBe("12 Nov");
    expect(formatDayMonthYear("2027-03-14")).toBe("14 Mar 2027");
    expect(formatMonthYear("nope")).toBe("");
    expect(dayOf("2027-13-01")).toBe("");
  });
});

describe("CSV spec", () => {
  it("has the owner's columns and natural key", () => {
    expect(CREDENTIALS_CSV.columns.map((c) => c.label)).toEqual([
      "Title",
      "Issued by",
      "Group",
      "Number",
      "Show number",
      "Issued",
      "Expires",
      "Verify link",
      "Show on site",
    ]);
    expect(
      CREDENTIALS_CSV.columns.filter((c) => c.required).map((c) => c.label),
    ).toEqual(["Title", "Issued by"]);
    expect(CREDENTIALS_CSV.naturalKey).toEqual(["title", "issuer"]);
    const lines = templateCsv(CREDENTIALS_CSV)
      .split(/\r?\n/)
      .filter((l) => l !== "");
    expect(lines).toHaveLength(2);
  });

  it("parses yes/no and dates, and reports row errors in owner words", () => {
    const parsed = parseCsv(
      "Title,Issued by,Group,Show number,Expires,Verify link\n" +
        "RN License,Texas BON,Licenses,yes,2027-03-14,https://bon.test\n" +
        "CPR,Red Cross,,maybe,soon,javascript:alert(1)\n",
    );
    if (!parsed.ok) throw new Error("parse failed");
    const res = validateRows(parsed, CREDENTIALS_CSV);
    if (!res.ok) throw new Error("validate failed");
    expect(res.rows[0]!.values).toMatchObject({
      title: "RN License",
      issuer: "Texas BON",
      category: "Licenses",
      show_number: true,
      expires_on: "2027-03-14",
      verify_url: "https://bon.test",
    });
    expect(res.rows[1]!.errors).toEqual([
      "Row 3: Show number must be yes or no.",
      "Row 3: Expires isn't a date. Use a date like 2027-03-14.",
      "Row 3: Verify link must start with https:// or http://.",
    ]);
  });

  it("formats stored PocketBase dates back to the day for a clean round trip", () => {
    const col = CREDENTIALS_CSV.columns.find((c) => c.key === "expires_on")!;
    expect(col.format("2027-03-14 00:00:00.000Z")).toBe("2027-03-14");
    expect(col.format("")).toBe("");
  });
});

describe("block settings (section validate)", () => {
  it("trims and caps the heading, defaults it and group by category", () => {
    expect(
      validateCredentialsContent({
        heading: `  ${"h".repeat(200)} `,
        group_by_category: "yes",
        extra: 1,
      }),
    ).toEqual({ heading: "h".repeat(120), group_by_category: true });
    expect(validateCredentialsContent({})).toEqual({
      heading: "Credentials",
      group_by_category: true,
    });
    expect(
      validateCredentialsContent({ heading: "", group_by_category: false }),
    ).toEqual({ heading: "", group_by_category: false });
    expect(() => validateCredentialsContent(null)).toThrow(InvalidInput);
  });

  it("textsOf is the heading; urlsOf and refsOf are empty; never the H1 owner; full width only", () => {
    const c = credentialsSection.defaultContent();
    expect(credentialsSection.textsOf(c)).toEqual(["Credentials"]);
    expect(credentialsSection.urlsOf(c)).toEqual([]);
    expect(credentialsSection.refsOf(c)).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    expect(credentialsSection.headings.ownsH1).toBe(false);
    expect(credentialsSection.layouts).toEqual(["full"]);
  });
});

describe("manifest", () => {
  it("composes with the real registry and core sections", () => {
    const registry = composeAddonRegistry([manifest], {
      fileExists: (p) => existsSync(path.join(repoRoot, p)),
    });
    const m = registry.get("credentials")!;
    expect(m.name).toBe("Credentials");
    expect(m.category).toBe("Trust");
    expect(m.order).toBe(20);
    expect(m.premium).toBeUndefined();
    expect(m.nav).toEqual({
      placement: "tab",
      item: "website",
      label: "Credentials",
      icon: "BadgeCheck",
    });
    expect(registry.ownerOf("credentials")).toBe("credentials");
    expect(m).not.toHaveProperty("price");
    const sections = composeSectionRegistry(CORE_SECTIONS, registry.sections());
    expect(sections.get("credentials")?.label).toBe("Credentials");
  });

  it("seeds a /credentials page with one valid Credentials block and retains on removal", () => {
    expect(manifest.install.page?.slug).toBe("credentials");
    expect(manifest.install.page?.title).toBe("Credentials");
    expect(manifest.install.page?.sections).toHaveLength(1);
    const seed = manifest.install.page!.sections[0]!;
    expect(seed.section_type).toBe("credentials");
    expect(credentialsSection.validate(seed.content, "full")).toEqual(
      seed.content,
    );
    expect(manifest.install.records?.collection).toBe("credentials");
    expect(manifest.uninstall.retain).toBe("all");
  });

  it("points training at the Credentials how-to", () => {
    expect(manifest.training).toEqual([
      expect.objectContaining({
        id: "addon-credentials",
        title: "How Credentials works",
        howTo: "docs/how-to/addon-credentials.md",
        video: null,
      }),
    ]);
    expect(
      existsSync(path.join(repoRoot, "docs/how-to/addon-credentials.md")),
    ).toBe(true);
  });
});

describe("templateSlots (08-07, CONTEXT A1-Q4)", () => {
  it("contributes to proof on home and about on the About page", () => {
    const slots: readonly TemplateSlotContribution[] =
      manifest.templateSlots ?? [];
    expect(
      slots.map((s) => ({
        slot: s.slot,
        page: s.page,
        section_type: s.section_type,
      })),
    ).toEqual([
      { slot: "proof", page: "home", section_type: "credentials" },
      { slot: "about", page: "about", section_type: "credentials" },
    ]);
  });

  it("each contribution's content passes the section's own validator", () => {
    const slots: readonly TemplateSlotContribution[] =
      manifest.templateSlots ?? [];
    for (const s of slots) {
      const content = s.content({} as TemplateSlotInput);
      expect(validateCredentialsContent(content)).toEqual(content);
    }
  });
});

describe("privacyClauses (09-11, CONTEXT A5-Q1)", () => {
  it("declares one clause for credentials", () => {
    const clauses = manifest.privacyClauses ?? [];
    expect(clauses.map((c) => c.id)).toEqual(["credentials"]);
    expect(clauses[0]!.heading).toBe("Credentials");
    expect(clauses[0]!.what).toMatch(/licen[cs]e/i);
    expect(clauses[0]!.why.length).toBeGreaterThan(0);
    expect(clauses[0]!.howLong.length).toBeGreaterThan(0);
  });
});
