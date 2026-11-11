// Scan coverage (13-11; STAFF-25, D270, D248; T-13-11-01). Every public-facing record's write
// path must pass through the publish scan: `screen(` / `afterLiveSave(` for text and links,
// the ImageModerator for media. Static: each PUBLIC_FACING entry names the module and the
// function that must make the call, and the test reads that function's source text.
//
// A new public collection (a TENANT_COLLECTIONS entry with a `public` list, or an add-on
// record collection) that is in neither PUBLIC_FACING nor NOT_SCREENED fails, naming D270.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddonManifest } from "@cds/core/addons";
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { describe, expect, it } from "vitest";
import { mintOrgContext } from "../src/context";
import { compositeScanner, scanOnSend } from "../src/content/scan";
import { keywordTextChecker } from "../src/content/scan/text";
import { TENANT_COLLECTIONS } from "../src/registry";

const SRC = path.resolve(import.meta.dirname, "../src");

type Entry = {
  /** The collection (and the part, for site_settings). */
  collection: string;
  what: string;
  /** Module path under packages/db/src. */
  file: string;
  /** Function (or object method) whose body must make the call. */
  fn: string;
  /** Every listed call must appear in that body. */
  calls: string[];
};

/** Core public-facing writes (CONTEXT Area 3 STAFF-25; RESEARCH line 480 callers). */
const CORE_PUBLIC_FACING: Entry[] = [
  {
    collection: "pages",
    what: "page publish (page_sections ride on it)",
    file: "content/publish.ts",
    fn: "publishLocked",
    calls: ["screen("],
  },
  {
    collection: "site_settings",
    what: "navigation (chrome)",
    file: "content/chrome/nav.ts",
    fn: "saveNav",
    calls: ["screen(", "afterLiveSave("],
  },
  {
    collection: "site_settings",
    what: "footer (chrome)",
    file: "content/chrome/footer.ts",
    fn: "saveFooter",
    calls: ["screen(", "afterLiveSave("],
  },
  {
    collection: "site_settings",
    what: "announcement banner",
    file: "content/site-settings.ts",
    fn: "saveBanner",
    calls: ["screen(", "afterLiveSave("],
  },
  {
    collection: "popups",
    what: "pop-up save",
    file: "content/popups.ts",
    fn: "savePopup",
    calls: ["screen(", "afterLiveSave("],
  },
  {
    collection: "popups",
    what: "pop-up switched on",
    file: "content/popups.ts",
    fn: "setPopupEnabled",
    calls: ["screen(", "afterLiveSave("],
  },
  {
    collection: "forms",
    what: "form create / duplicate",
    file: "forms/forms.ts",
    fn: "writeNew",
    calls: ["screen(", "afterLiveSave("],
  },
  {
    collection: "forms",
    what: "form save",
    file: "forms/forms.ts",
    fn: "saveForm",
    calls: ["screen(", "afterLiveSave("],
  },
  // 13-52 (STAFF-25, D270 gap closure): the core lists and the business profile.
  {
    collection: "team_members",
    what: "team member save / Show on site (screened inside the write)",
    file: "intake/team.ts",
    fn: "writeTeamMember",
    calls: ["screenListRow("],
  },
  {
    collection: "team_members",
    what: "team member flag + invalidate after the write",
    file: "intake/team.ts",
    fn: "saveTeamMember",
    calls: ["afterListSave("],
  },
  {
    collection: "services",
    what: "service save / Show on site",
    file: "intake/services.ts",
    fn: "saveService",
    calls: ["screenListRow(", "afterListSave("],
  },
  {
    collection: "team_members",
    what: "team / services spreadsheet import rows",
    file: "intake/list-import.ts",
    fn: "commitCoreImport",
    calls: ["screenListRow(", "afterListImport("],
  },
  {
    collection: "team_members",
    what: "the list row scan itself",
    file: "intake/list-screen.ts",
    fn: "screenListRow",
    calls: ["screen("],
  },
  {
    collection: "team_members",
    what: "list save flag + invalidate",
    file: "intake/list-screen.ts",
    fn: "afterListSave",
    calls: ["afterLiveSave("],
  },
  {
    collection: "team_members",
    what: "list import flags + invalidate",
    file: "intake/list-screen.ts",
    fn: "afterListImport",
    calls: ["afterLiveSave("],
  },
  {
    collection: "business_profile",
    what: "live business profile public text (after the fit screen stops)",
    file: "intake/business-profile.ts",
    fn: "saveBusinessProfile",
    calls: ["screen(", "afterListSave("],
  },
  {
    collection: "media_assets",
    what: "library photo upload",
    file: "media/library/upload.ts",
    fn: "uploadLibraryImage",
    calls: ["moderateImage("],
  },
  {
    collection: "media_assets",
    what: "intake photo upload",
    file: "media/assets.ts",
    fn: "uploadImage",
    calls: ["moderateImage("],
  },
  {
    collection: "media_assets",
    what: "the moderator call itself",
    file: "media/library/moderate.ts",
    fn: "moderateImage",
    calls: ["getImageModerator("],
  },
];

/**
 * The one add-on record write path (invariant 4: add-ons write only through addonRepo). Every
 * add-on record collection is covered by these, so ADDON_PUBLIC_FACING only has to name it.
 */
const ADDON_WRITE_PATH: Entry[] = [
  {
    collection: "<add-on records>",
    what: "validate + screen one record",
    file: "addons/records.ts",
    fn: "prepareRecord",
    calls: ["screen("],
  },
  {
    collection: "<add-on records>",
    what: "flag + invalidate after a record save",
    file: "addons/records.ts",
    fn: "afterRecordSave",
    calls: ["afterLiveSave("],
  },
  {
    collection: "<add-on records>",
    what: "record save",
    file: "addons/addon-repo.ts",
    fn: "save",
    calls: ["prepareRecord(", "afterRecordSave("],
  },
  {
    collection: "<add-on records>",
    what: "Show on site switched on",
    file: "addons/addon-repo.ts",
    fn: "setPublished",
    calls: ["screen(", "afterRecordSave("],
  },
  {
    collection: "<add-on records>",
    what: "install seed records",
    file: "addons/installer.ts",
    fn: "seedRecords",
    calls: ["prepareRecord("],
  },
  {
    collection: "<add-on records>",
    what: "CSV import rows",
    file: "addons/import.ts",
    fn: "prepareRow",
    calls: ["prepareRecord("],
  },
  {
    collection: "<add-on records>",
    what: "add-on backup restore",
    file: "addons/backups.ts",
    fn: "restoreAddonBackup",
    calls: ["screen("],
  },
];

/** Add-on record collections whose manifests publish records (`records` + `public`). */
const ADDON_PUBLIC_FACING: Readonly<Record<string, readonly string[]>> = {
  testimonials: ["testimonials"],
  credentials: ["credentials"],
};

/**
 * Public collections deliberately not screened on save, each with its reason. Adding a row
 * here is a D270 decision: record it in the plan SUMMARY.
 */
const NOT_SCREENED: Readonly<Record<string, string>> = {
  org_addons: "no tenant-authored text: add-on slug and status only",
};

const PUBLIC_FACING = [...CORE_PUBLIC_FACING, ...ADDON_WRITE_PATH];

/** The source text of `fn` in `file`: from its declaration to its closing brace line. */
function bodyOf(file: string, fn: string): string {
  const text = readFileSync(path.join(SRC, file), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const lines = text.split("\n");
  const decl = new RegExp(
    `^(\\s*)(?:export\\s+)?(?:async\\s+)?(?:function\\s+)?${fn}\\s*[(<]`,
  );
  // A type-only signature (interface member) ends with ";": skip it.
  const start = lines.findIndex(
    (l) => decl.test(l) && !l.trimEnd().endsWith(";"),
  );
  if (start < 0) return "";
  const indent = decl.exec(lines[start]!)![1]!;
  const close = new RegExp(`^${indent}\\}[,;]?\\s*$`);
  let end = start + 1;
  while (end < lines.length && !close.test(lines[end]!)) end += 1;
  return lines.slice(start, end + 1).join("\n");
}

/** Public collections that no list covers (the D270 check), as messages. */
function uncoveredPublicCollections(
  core: Readonly<Record<string, object>>,
  manifests: readonly Pick<AddonManifest, "slug" | "collections" | "records">[],
  covered: {
    core: readonly string[];
    addons: Readonly<Record<string, readonly string[]>>;
    exempt: Readonly<Record<string, string>>;
  },
): string[] {
  const out: string[] = [];
  for (const [name, spec] of Object.entries(core)) {
    if (!(spec as { public?: readonly string[] }).public?.length) continue;
    if (covered.core.includes(name) || name in covered.exempt) continue;
    out.push(
      `D270: public collection "${name}" has no scan coverage entry: add its write path to PUBLIC_FACING (screen() / afterLiveSave() / ImageModerator) or a reasoned NOT_SCREENED row`,
    );
  }
  for (const m of manifests) {
    const names = new Set([
      ...Object.keys(m.records ?? {}),
      ...Object.entries(m.collections ?? {})
        .filter(([, s]) => (s as { public?: readonly string[] }).public?.length)
        .map(([n]) => n),
    ]);
    for (const name of names) {
      if ((covered.addons[m.slug] ?? []).includes(name)) continue;
      out.push(
        `D270: add-on "${m.slug}" collection "${name}" publishes records but is missing from ADDON_PUBLIC_FACING`,
      );
    }
  }
  return out;
}

describe("scan coverage (STAFF-25, D270)", () => {
  it.each(PUBLIC_FACING.map((e) => [`${e.collection}: ${e.what}`, e] as const))(
    "%s calls the scan",
    (_label, entry) => {
      const body = bodyOf(entry.file, entry.fn);
      expect(body, `${entry.file} has no function ${entry.fn} (D270)`).not.toBe(
        "",
      );
      for (const call of entry.calls) {
        expect(
          body.includes(call),
          `D270: ${entry.file} ${entry.fn} must call ${call}`,
        ).toBe(true);
      }
    },
  );

  it("every public collection (core and add-on) has a coverage entry", () => {
    const missing = uncoveredPublicCollections(
      TENANT_COLLECTIONS,
      ADDON_REGISTRY.list(),
      {
        core: CORE_PUBLIC_FACING.map((e) => e.collection),
        addons: ADDON_PUBLIC_FACING,
        exempt: NOT_SCREENED,
      },
    );
    expect(missing).toEqual([]);
  });

  it("an add-on collection marked public but missing from the list fails, naming D270", () => {
    const fake = {
      slug: "fixture-public",
      collections: {
        fixture_public_items: { public: ["id", "title"] },
      },
      records: {},
    } as unknown as AddonManifest;
    const missing = uncoveredPublicCollections({}, [fake], {
      core: [],
      addons: ADDON_PUBLIC_FACING,
      exempt: {},
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("D270");
    expect(missing[0]).toContain("fixture_public_items");
  });

  it("a new core public collection without an entry fails, naming D270", () => {
    const missing = uncoveredPublicCollections(
      { brand_new: { public: ["title"] } },
      [],
      { core: [], addons: {}, exempt: {} },
    );
    expect(missing).toEqual([
      expect.stringContaining('D270: public collection "brand_new"'),
    ]);
  });

  it("no stale entries: every listed add-on collection exists in the registry", () => {
    for (const [slug, names] of Object.entries(ADDON_PUBLIC_FACING)) {
      const m = ADDON_REGISTRY.get(slug);
      expect(m, `add-on ${slug}`).toBeDefined();
      for (const n of names) expect(Object.keys(m!.collections)).toContain(n);
    }
    for (const name of Object.keys(NOT_SCREENED)) {
      expect(Object.keys(TENANT_COLLECTIONS)).toContain(name);
    }
  });
});

describe("scanOnSend seam (v1.1 Newsletter, D270)", () => {
  const ctx = mintOrgContext({
    orgId: "aaaaaaaaaaaaaaa",
    actor: "bbbbbbbbbbbbbbb",
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });

  it("a held keyword in the subject returns held", async () => {
    const res = await scanOnSend(
      ctx,
      {
        subject: "Spring news __cds_test_held__",
        html: "<p>Hello</p>",
        links: [],
        images: [],
      },
      { scanner: compositeScanner({ text: keywordTextChecker }) },
    );
    expect(res.verdict).toBe("held");
  });

  it("a clean campaign is clean and the images reach the moderator", async () => {
    const seen: string[] = [];
    const res = await scanOnSend(
      ctx,
      {
        subject: "Spring news",
        html: "<p>Hello</p>",
        links: ["https://example.com/"],
        images: ["https://cdn.example.com/a.webp"],
      },
      {
        scanner: compositeScanner({
          text: keywordTextChecker,
          image: {
            name: "spy",
            check(input) {
              seen.push(...(input.images ?? []).map((i) => i.url));
              return Promise.resolve({
                verdict: "clean",
                reasons: [],
                provider: "spy",
              });
            },
          },
        }),
      },
    );
    expect(res.verdict).toBe("clean");
    expect(seen).toEqual(["https://cdn.example.com/a.webp"]);
  });

  it("a scanner outage maps to error, never a silent pass (D248)", async () => {
    const res = await scanOnSend(
      ctx,
      { subject: "x", html: "", links: [], images: [] },
      { scanner: { scan: () => Promise.reject(new Error("down")) } },
    );
    expect(res.verdict).toBe("error");
  });

  it("defaults to the publish scanner (keyword stand-in holds)", async () => {
    const res = await scanOnSend(ctx, {
      subject: "__cds_test_held__",
      html: "",
      links: [],
      images: [],
    });
    expect(res.verdict).toBe("held");
  });
});
