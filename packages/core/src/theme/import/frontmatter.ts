// DESIGN.md front matter for the theme importer (THEME-03, CONTEXT A1-Q4, RESEARCH Pitfall 7,
// T-04-19, T-04-20). NODE-ONLY SUBPATH: everything under theme/import may use yaml, node:fs
// and node:crypto, so it must never be imported by Edge code or re-exported by
// @cds/core/theme. erasableSyntaxOnly: no enums, no parameter properties (the CLI runs these
// files with --experimental-strip-types).
//
// yaml.parse runs with its safe defaults: the core schema (no custom tags, so only plain
// data), uniqueKeys, and maxAliasCount 100 (an alias bomb throws). Every parse or shape
// failure surfaces as InvalidInput.
import { parse } from "yaml";
import { InvalidInput } from "../../errors";

type Raw = Record<string, unknown>;

const FENCE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const REF = /^\{([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\}$/;
const MAX_DEPTH = 32;
/** Nodes the `{ref}`-expanded front matter may hold (a real DESIGN.md has a few hundred). */
export const MAX_NODES = 100_000;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const NO_FRONT_MATTER_COPY =
  "DESIGN.md has no front matter. Start it with a --- block (name, colors, typography, rounded, spacing).";
const NOT_A_MAPPING_COPY =
  "DESIGN.md front matter must be a mapping of keys (name, colors, typography, ...).";
const TOO_DEEP_COPY = "DESIGN.md front matter is nested too deeply.";
const TOO_LARGE_COPY = "DESIGN.md front matter expands too large.";

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

/** LF-normalize and drop a leading BOM, so Windows checkouts and CI read the same text. */
export function normalizeText(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/** Split DESIGN.md into its parsed front matter and its prose body (CRLF-safe). */
export function splitFrontMatter(md: string): {
  frontMatter: Record<string, unknown>;
  body: string;
} {
  const text = normalizeText(String(md));
  const m = FENCE.exec(text);
  if (!m) throw new InvalidInput(NO_FRONT_MATTER_COPY);
  let parsed: unknown;
  try {
    parsed = parse(m[1] ?? "");
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] : "";
    throw new InvalidInput(`DESIGN.md front matter is not valid YAML. ${why}`);
  }
  if (!isObject(parsed)) throw new InvalidInput(NOT_A_MAPPING_COPY);
  // The body keeps its prose verbatim; only the blank lines right after the fence go.
  const body = text.slice(m[0].length).replace(/^\n+/, "");
  return { frontMatter: parsed, body };
}

function lookup(root: Raw, ref: string): { found: boolean; value: unknown } {
  let cur: unknown = root;
  for (const part of ref.split(".")) {
    if (!isObject(cur) || FORBIDDEN_KEYS.has(part)) {
      return { found: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(cur, part)) {
      return { found: false, value: undefined };
    }
    cur = own(cur, part);
  }
  return { found: true, value: cur };
}

/**
 * Replace every whole-string `{a.b}` reference with the value at that path, recursively.
 * Returns a fresh structure (the input is never mutated). An unresolved reference or a
 * cycle throws InvalidInput naming the key that holds it.
 */
export function resolveRefs(
  frontMatter: Record<string, unknown>,
): Record<string, unknown> {
  const root = frontMatter;
  // WR-03: yaml's maxAliasCount stops an alias bomb, but `{ref}` expansion copies again on
  // every use, so a "billion laughs" of references is bounded here: a node budget for the
  // whole expanded output, and `depth` (object/array nesting) as well as the reference
  // chain (`stack`) capped at MAX_DEPTH, so deep YAML is an InvalidInput, never a RangeError.
  let budget = MAX_NODES;

  function walk(
    value: unknown,
    path: string,
    stack: string[],
    depth: number,
  ): unknown {
    if (stack.length > MAX_DEPTH || depth > MAX_DEPTH) {
      throw new InvalidInput(TOO_DEEP_COPY);
    }
    if (--budget < 0) throw new InvalidInput(TOO_LARGE_COPY);
    if (typeof value === "string") {
      const m = REF.exec(value.trim());
      if (!m) return value;
      const ref = m[1] ?? "";
      if (stack.includes(ref)) {
        throw new InvalidInput(
          `${path} refers to {${ref}}, which refers back to itself.`,
        );
      }
      const hit = lookup(root, ref);
      if (!hit.found) {
        throw new InvalidInput(
          `${path} refers to {${ref}}, which doesn't exist.`,
        );
      }
      return walk(hit.value, path, [...stack, ref], depth);
    }
    if (Array.isArray(value)) {
      return value.map((v, i) => walk(v, `${path}.${i}`, stack, depth + 1));
    }
    if (isObject(value)) {
      const out: Raw = {};
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        const child = path === "" ? key : `${path}.${key}`;
        out[key] = walk(own(value, key), child, stack, depth + 1);
      }
      return out;
    }
    return value;
  }

  return walk(root, "", [], 0) as Record<string, unknown>;
}
