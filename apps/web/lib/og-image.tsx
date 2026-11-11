// Shared Open Graph renderer for the hub site (15-23; HUB-01, D-UI-P15-28, P15-P24).
// Every indexed (marketing) route has a static `opengraph-image.tsx` that calls ogImage({ title, chip }):
// 1200x630, the page's chip field as the ground, the wordmark (rivet ring + "CDS" + the full name)
// and the page H1 in Anybody 700. No dynamic API, no PocketBase, no environment read, so Next renders each one
// at build time (RESEARCH Pitfall 11: a request-time render could miss the font in standalone output).
// Satori cannot read woff2, so the font is the static `.woff` from `@fontsource/anybody`.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { MK_COPY } from "@cds/core/marketing";

export const OG_SIZE = Object.freeze({ width: 1200, height: 630 });

/**
 * Chip grounds and the text colour that reads on each. These hex values mirror the field scopes in
 * packages/ui/src/marketing/tokens.css (Satori renders outside the [data-mk] tree, so CSS variables
 * cannot reach it). This file is the one recorded hex map outside tokens.css (15-23 choice 1); it
 * sits in apps/web/lib, outside the trees tests/marketing-boundary.test.ts scans. Keep it in step
 * with tokens.css when a chip colour changes.
 */
export const OG_CHIPS = Object.freeze({
  ink: Object.freeze({ bg: "#15171e", fg: "#ffffff" }),
  stock: Object.freeze({ bg: "#eef0f4", fg: "#15171e" }),
  cobalt: Object.freeze({ bg: "#2a3fd1", fg: "#ffffff" }),
  berry: Object.freeze({ bg: "#a3165f", fg: "#ffffff" }),
  leaf: Object.freeze({ bg: "#2f7d32", fg: "#ffffff" }),
  marigold: Object.freeze({ bg: "#f5b300", fg: "#15171e" }),
});

export type OgChip = keyof typeof OG_CHIPS;

const FONT_SPEC = "@fontsource/anybody/files/anybody-latin-700-normal.woff";
const FONT_REL = `node_modules/${FONT_SPEC}`;

/**
 * Absolute path of the Anybody 700 `.woff`. Node resolution from apps/web first (a runtime
 * createRequire with a computed base, so webpack leaves it alone), then the repo-root and app
 * node_modules folders relative to the working directory (`next build` runs in apps/web; vitest
 * runs at the repo root).
 */
export function ogFontPath(): string {
  const cwd = process.cwd();
  const bases = [join(cwd, "package.json"), join(cwd, "apps/web/package.json")];
  for (const base of bases) {
    try {
      return createRequire(base).resolve(FONT_SPEC);
    } catch {
      // fall through to the next base, then the file candidates
    }
  }
  const candidates = [join(cwd, FONT_REL), join(cwd, "../..", FONT_REL)];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("OG font not found");
  return found;
}

let fontBytes: Promise<Buffer> | null = null;
function anybody700(): Promise<Buffer> {
  fontBytes ??= readFile(ogFontPath());
  return fontBytes;
}

export type OgImageInput = {
  /** The page H1, verbatim from MK_COPY / MK_PATHS. */
  title: string;
  chip: OgChip;
};

export async function ogImage({
  title,
  chip,
}: OgImageInput): Promise<ImageResponse> {
  const { bg, fg } = OG_CHIPS[chip];
  const titleSize = title.length <= 24 ? 128 : 88;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        backgroundColor: bg,
        color: fg,
        fontFamily: "Anybody",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 9999,
            border: `5px solid ${fg}`,
          }}
        />
        <div style={{ fontSize: 56, lineHeight: 1, letterSpacing: "0.02em" }}>
          CDS
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.2, marginLeft: 8 }}>
          {MK_COPY.SEO.ORG_NAME}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          maxWidth: 1000,
          fontSize: titleSize,
          lineHeight: 0.98,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        {
          name: "Anybody",
          data: await anybody700(),
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
