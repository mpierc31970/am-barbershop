// 15-23 (HUB-01, D-UI-P15-28, P15-P24): every indexed hub route has a static share image built
// through the one ogImage() helper; the Anybody 700 woff resolves; the chip hex map mirrors tokens.css.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETING_ROUTES } from "@cds/core/marketing";
import { describe, expect, it } from "vitest";
import { OG_CHIPS, OG_SIZE, ogFontPath, ogImage } from "../lib/og-image";

const root = join(import.meta.dirname, "../../..");
const MARKETING = join(root, "apps/web/app/(platform)/(marketing)");
const ogFile = (dir: string) => join(MARKETING, dir, "opengraph-image.tsx");

/** Anything that would turn a build-time OG render into a request-time one, or read data/env. */
const DYNAMIC =
  /from "next\/headers"|\bheaders\(|\bcookies\(|searchParams|process\.env|CDS_ENV|getCatalog|demoSiteUrl|isProductionHub|@cds\/db/;

describe("OG images (15-23)", { timeout: 60_000 }, () => {
  const indexed = MARKETING_ROUTES.filter((r) => r.indexed);

  it("covers the eleven indexed marketing routes", () => {
    expect(indexed).toHaveLength(11);
  });

  it.each(indexed.map((r) => [r.path, r.dir] as const))(
    "%s has a static opengraph-image.tsx that calls ogImage()",
    (_path, dir) => {
      const file = ogFile(dir);
      expect(existsSync(file)).toBe(true);
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(
        /import \{[^}]*\bogImage\b[^}]*\} from "[./]+\/lib\/og-image"/,
      );
      expect(src).toMatch(/ogImage\(\{ title: MK_(COPY|PATHS)\./);
      expect(src).toContain("export const size = OG_SIZE;");
      expect(src).toContain('export const contentType = "image/png";');
      expect(src).toMatch(/export const alt = MK_COPY\.SEO\.[A-Z_]+_TITLE;/);
      expect(src).not.toMatch(DYNAMIC);
      expect(src).not.toMatch(
        /export const (dynamic|revalidate)|generateStaticParams/,
      );
    },
  );

  it("noindex and dynamic routes have no share image of their own", () => {
    for (const r of MARKETING_ROUTES.filter((x) => !x.indexed)) {
      expect(existsSync(ogFile(r.dir))).toBe(false);
    }
    expect(existsSync(ogFile("add-ons/[slug]"))).toBe(false);
  });

  it("the helper reads no env, request or PocketBase data", () => {
    const src = readFileSync(join(root, "apps/web/lib/og-image.tsx"), "utf8");
    expect(src).not.toMatch(DYNAMIC);
  });

  it("resolves the Anybody 700 woff (Satori cannot read woff2)", () => {
    const path = ogFontPath();
    expect(path.replace(/\\/g, "/")).toMatch(
      /@fontsource\/anybody\/files\/anybody-latin-700-normal\.woff$/,
    );
    expect(readFileSync(path).subarray(0, 4).toString("latin1")).toBe("wOFF");
  });

  it("OG_CHIPS mirrors the tokens.css field scopes", () => {
    const css = readFileSync(
      join(root, "packages/ui/src/marketing/tokens.css"),
      "utf8",
    );
    const hex = (name: string) => {
      const m = css.match(new RegExp(`--mk-${name}:\\s*(#[0-9a-fA-F]{6})`));
      if (!m) throw new Error(`token ${name} missing`);
      return m[1]!.toLowerCase();
    };
    const scope = (field: string) => {
      const m = css.match(
        new RegExp(`\\[data-mk-field="${field}"\\]\\s*\\{([^}]*)\\}`),
      );
      if (!m) throw new Error(`field ${field} missing`);
      const ref = (prop: string) =>
        m[1]!.match(
          new RegExp(`--mk-${prop}:\\s*var\\(--mk-([a-z-]+)\\)`),
        )![1]!;
      return { bg: hex(ref("field-bg")), fg: hex(ref("fg")) };
    };
    for (const [field, colours] of Object.entries(OG_CHIPS)) {
      expect(colours, field).toEqual(scope(field));
    }
  });

  it("renders a 1200x630 PNG", async () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
    const res = await ogImage({ title: "Pricing", chip: "leaf" });
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});
