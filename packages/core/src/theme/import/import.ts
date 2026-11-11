// importThemeDir: an authored theme directory -> a valid, contrast-solved
// OrganizationDesign plus a human report (THEME-03, THEME-05 "at import", D45, D46;
// CONTEXT A1-Q3/Q4, A2-Q2, A3-Q3; RESEARCH Pitfalls 6-8, open question 4).
// NODE-ONLY SUBPATH (see frontmatter.ts): never imported by Edge code.
//
// Pipeline, in order:
//   1. contain the directory inside <root>/design/ (resolve + realpath, T-04-18);
//   2. size-cap each file with statSync before reading it (T-04-19);
//   3. LF-normalize, then sha256 over DESIGN.md + "\n\0\n" + design.json, so a Windows
//      checkout and CI hash the same bytes;
//   4. parse the front matter (yaml safe defaults) and resolve {a.b} references;
//   5. map colours to roles (extensions.roles, else derived from colorMeta);
//   6. map typography / rounded / shadows per UI-SPEC "Role contract", rem -> px for the px
//      tokens, clamp() kept as authored, the first family of each font stack checked
//      against the catalog;
//   7. solveContrast (the one and only place it runs: at import, never at render);
//   8. validateOrganizationDesign is the last word on every value (T-04-21).
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { InvalidInput } from "../../errors";
import { bodySuggestions, findFont, nearestFont } from "../fonts";
import type { FontRole } from "../fonts";
import { isOverlayShadow, isRadius, isSizeToken, toPx } from "../grammar";
import type { RadiusKind, SizeToken } from "../grammar";
import { NEUTRAL_DESIGN } from "../neutral";
import { ROLES } from "../roles";
import type { Role, RoleMap } from "../roles";
import { solveContrast } from "../solver";
import type { Adjustment, OrganizationDesign, PairResult } from "../types";
import {
  BAD_VALUE_COPY,
  DISPLAY_AS_BODY_COPY,
  RADIUS_RULES,
  SHADOW_RULE,
  SIZE_RULES,
  UNKNOWN_FONT_COPY,
  validateOrganizationDesign,
} from "../validate";
import { normalizeText, resolveRefs, splitFrontMatter } from "./frontmatter";
import { mapRoles } from "./map";

/** 256 KB per authored file, checked before the file is read (T-04-19). */
export const FILE_MAX_BYTES = 262144;

export const DESIGN_MD = "DESIGN.md";
export const SIDECAR_PATH = ".impeccable/design.json";

export const OVERLAY_FALLBACK_NOTE =
  "No overlay shadow in design.json; using the neutral preset's overlay.";

export type ThemeImportReport = {
  name: string;
  dir: string;
  hash8: string;
  roles: {
    role: Role;
    colorName: string;
    authored: string;
    stored: string;
    adjusted: boolean;
  }[];
  pairs: PairResult[];
  adjustments: Adjustment[];
  fonts: { heading: string; body: string };
  derivedRoles: RoleMap | null;
  notes: string[];
};

export type ThemeImportResult = {
  design: OrganizationDesign;
  report: ThemeImportReport;
};

export type ImportOptions = { root?: string; now?: () => Date };

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: unknown, key: string): unknown {
  return isObject(raw) && Object.prototype.hasOwnProperty.call(raw, key)
    ? raw[key]
    : undefined;
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function outsideCopy(dir: string): string {
  return `The theme directory must be inside design/ (got ${dir}).`;
}

function realpath(p: string, missing: string): string {
  try {
    return realpathSync(p);
  } catch {
    throw new InvalidInput(missing);
  }
}

/** Resolve and contain the theme directory (T-04-18). */
function containDir(root: string, dir: string): string {
  if (typeof dir !== "string" || dir.trim() === "") {
    throw new InvalidInput(outsideCopy(String(dir)));
  }
  const designRoot = join(root, "design");
  const abs = resolve(root, dir);
  if (!inside(designRoot, abs)) throw new InvalidInput(outsideCopy(dir));
  const realDesign = realpath(designRoot, `No design/ folder under ${root}.`);
  const realDir = realpath(abs, `No theme directory at ${dir}.`);
  if (!inside(realDesign, realDir)) throw new InvalidInput(outsideCopy(dir));
  return realDir;
}

/** Read one authored file after the containment and size checks; null when optional and absent. */
function readCapped(
  dirReal: string,
  file: string,
  required: boolean,
): string | null {
  const p = join(dirReal, file);
  let real: string;
  try {
    real = realpathSync(p);
  } catch {
    if (!required) return null;
    throw new InvalidInput(`No ${file} in the theme directory.`);
  }
  if (!inside(dirReal, real)) {
    throw new InvalidInput(`${file} points outside the theme directory.`);
  }
  const st = statSync(real);
  if (!st.isFile()) throw new InvalidInput(`${file} is not a file.`);
  if (st.size > FILE_MAX_BYTES) {
    throw new InvalidInput(
      `${file} is larger than 256 KB (FILE_MAX_BYTES). Trim it, then run again.`,
    );
  }
  return normalizeText(readFileSync(real, "utf8"));
}

function parseSidecar(text: string | null): Raw | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidInput(`${SIDECAR_PATH} is not valid JSON.`);
  }
  if (!isObject(parsed)) {
    throw new InvalidInput(`${SIDECAR_PATH} must be a JSON object.`);
  }
  return parsed;
}

/** "EB Garamond, Georgia, 'Times New Roman', serif" -> "EB Garamond". */
function firstFamily(stack: unknown): string {
  if (typeof stack !== "string") return "";
  const first = stack.split(",")[0] ?? "";
  return first
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function catalogFamily(stack: unknown, role: FontRole): string {
  const name = firstFamily(stack);
  const font = findFont(name);
  if (font === null) {
    throw new InvalidInput(
      UNKNOWN_FONT_COPY(name, nearestFont(name, role).name),
    );
  }
  if (!font.roles.includes(role)) {
    throw new InvalidInput(
      DISPLAY_AS_BODY_COPY(font.name, bodySuggestions(font.name)),
    );
  }
  return font.name;
}

function fmtPx(px: number): string {
  return `${Math.round(px * 100) / 100}px`;
}

/** A px token: rem converted to px; anything else passed through for the grammar to judge. */
function pxValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const px = toPx(v.trim());
  return px === null ? v.trim() : fmtPx(px);
}

function sizeValue(token: SizeToken, v: unknown, path: string): string {
  const value =
    token === "body" || token === "h3"
      ? pxValue(v)
      : typeof v === "string" && toPx(v.trim()) !== null
        ? pxValue(v)
        : typeof v === "string"
          ? v.trim()
          : v;
  if (!isSizeToken(token, value)) {
    throw new InvalidInput(BAD_VALUE_COPY(path, v, SIZE_RULES[token]));
  }
  return value as string;
}

function radiusValue(kind: RadiusKind, v: unknown, path: string): string {
  let value = v;
  if (typeof v === "number" && v === 0) value = "0px";
  if (typeof v === "string") {
    const t = v.trim();
    // The radius grammar allows one decimal (WR-05): round a converted rem (0.33rem =
    // 5.28px) to 5.3px instead of refusing it with an out-of-range message.
    const px = toPx(t);
    value =
      t === "0" ? "0px" : px === null ? t : `${Math.round(px * 10) / 10}px`;
  }
  if (!isRadius(kind, value)) {
    throw new InvalidInput(BAD_VALUE_COPY(path, v, RADIUS_RULES[kind]));
  }
  return value as string;
}

/** The first of `keys` present on `obj`, with its key (for error paths). */
function firstOf(obj: unknown, keys: readonly string[]): [string, unknown] {
  for (const k of keys) {
    const v = own(obj, k);
    if (v !== undefined) return [k, v];
  }
  return [keys[0] ?? "", undefined];
}

type Typo = {
  headingFamily: string;
  bodyFamily: string;
  body: string;
  h3: string;
  h2: string;
  display: string;
};

function mapTypography(fm: Raw): Typo {
  const t = own(fm, "typography");
  const display = own(t, "display");
  const [headingKey, heading] = firstOf(t, ["heading", "headline"]);
  const [subheadKey, subhead] = firstOf(t, ["subhead", "title"]);
  const body = own(t, "body");
  const headingStack = own(display, "fontFamily") ?? own(heading, "fontFamily");
  return {
    headingFamily: catalogFamily(headingStack, "heading"),
    bodyFamily: catalogFamily(own(body, "fontFamily"), "body"),
    body: sizeValue("body", own(body, "fontSize"), "typography.body.fontSize"),
    h3: sizeValue(
      "h3",
      own(subhead, "fontSize"),
      `typography.${subheadKey}.fontSize`,
    ),
    h2: sizeValue(
      "h2",
      own(heading, "fontSize"),
      `typography.${headingKey}.fontSize`,
    ),
    display: sizeValue(
      "display",
      own(display, "fontSize"),
      "typography.display.fontSize",
    ),
  };
}

function mapRounded(fm: Raw): { button: string; media: string } {
  const r = own(fm, "rounded");
  const sm = own(r, "sm");
  const buttonRef = own(
    own(own(fm, "components"), "button-primary"),
    "rounded",
  );
  const button =
    sm !== undefined
      ? radiusValue("button", sm, "rounded.sm")
      : radiusValue("button", buttonRef, "components.button-primary.rounded");
  return { button, media: radiusValue("media", own(r, "md"), "rounded.md") };
}

function namedList(sidecar: Raw | null, key: string): Raw[] {
  const list = own(own(sidecar, "extensions"), key);
  return Array.isArray(list) ? list.filter(isObject) : [];
}

function mapOverlay(sidecar: Raw | null, notes: string[]): string {
  const entry = namedList(sidecar, "shadows").find(
    (s) => own(s, "name") === "overlay",
  );
  if (entry === undefined) {
    notes.push(OVERLAY_FALLBACK_NOTE);
    return NEUTRAL_DESIGN.shadows.overlay;
  }
  const value = own(entry, "value");
  const v = typeof value === "string" ? value.trim() : value;
  if (!isOverlayShadow(v)) {
    throw new InvalidInput(
      BAD_VALUE_COPY("extensions.shadows.overlay", value, SHADOW_RULE),
    );
  }
  return v as string;
}

type Flat = Record<string, string | number | boolean>;

function primitive(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" ||
    (typeof v === "number" && Number.isFinite(v)) ||
    typeof v === "boolean"
  );
}

/** A flat object of primitives (the validator re-checks keys and sizes). */
function flatOf(obj: unknown): Flat {
  const out: Flat = {};
  if (!isObject(obj)) return out;
  for (const k of Object.keys(obj)) {
    const v = own(obj, k);
    if (primitive(v)) out[k] = v;
  }
  return out;
}

/** Sidecar motion: a list of { name, value } (DCR shape) or a flat object. */
function mapMotion(sidecar: Raw | null): Flat {
  const raw = own(own(sidecar, "extensions"), "motion");
  if (!Array.isArray(raw)) return flatOf(raw);
  const out: Flat = {};
  for (const item of raw) {
    const name = own(item, "name");
    const value = own(item, "value");
    if (typeof name === "string" && primitive(value)) out[name] = value;
  }
  return out;
}

function sha256(designMd: string, sidecar: string | null): string {
  return createHash("sha256")
    .update(`${designMd}\n\0\n${sidecar ?? ""}`, "utf8")
    .digest("hex");
}

/**
 * Import one authored theme directory. `dir` is relative to `opts.root` (default
 * process.cwd()) or absolute, and must resolve inside `<root>/design/`. Throws InvalidInput
 * with the UI-SPEC copy on any failure; never writes anything.
 */
export function importThemeDir(
  dir: string,
  opts: ImportOptions = {},
): ThemeImportResult {
  const root = resolve(opts.root ?? process.cwd());
  const now = opts.now ?? (() => new Date());

  const dirReal = containDir(root, dir);
  const mdText = readCapped(dirReal, DESIGN_MD, true) ?? "";
  const sidecarText = readCapped(dirReal, SIDECAR_PATH, false);
  const sourceHash = sha256(mdText, sidecarText);

  const { frontMatter, body } = splitFrontMatter(mdText);
  const sidecar = parseSidecar(sidecarText);
  const fm = resolveRefs(frontMatter);

  const colorsRaw = own(fm, "colors");
  const colors = (isObject(colorsRaw) ? colorsRaw : {}) as Record<
    string,
    string
  >;
  const mapping = mapRoles(colors, sidecar);
  const typography = mapTypography(fm);
  const rounded = mapRounded(fm);
  const notes: string[] = [];
  const overlay = mapOverlay(sidecar, notes);

  const solved = solveContrast(mapping.roles);

  const nameRaw = own(fm, "name");
  const draft = {
    schemaVersion: 2,
    name: typeof nameRaw === "string" ? nameRaw.trim() : "",
    source: { designMd: { frontMatter, body }, sidecar },
    roles: solved.roles,
    typography,
    rounded,
    spacing: flatOf(own(fm, "spacing")),
    shadows: { overlay },
    motion: mapMotion(sidecar),
    contrast: { pairs: solved.pairs, adjustments: solved.adjustments },
    importedAt: now().toISOString(),
    sourceHash,
  };
  const design = validateOrganizationDesign(draft);

  const report: ThemeImportReport = {
    name: design.name,
    dir: relative(realpath(root, `No folder at ${root}.`), dirReal)
      .split(sep)
      .join("/"),
    hash8: sourceHash.slice(0, 8),
    roles: ROLES.map((role) => ({
      role,
      colorName: mapping.names[role],
      authored: mapping.roles[role],
      stored: design.roles[role],
      adjusted: mapping.roles[role] !== design.roles[role],
    })),
    pairs: design.contrast.pairs,
    adjustments: design.contrast.adjustments,
    fonts: {
      heading: design.typography.headingFamily,
      body: design.typography.bodyFamily,
    },
    derivedRoles: mapping.derived,
    notes,
  };
  return { design, report };
}
